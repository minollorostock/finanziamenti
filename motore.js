/* Motore di calcolo per il confronto di finanziamenti.
   Funzioni pure, senza interfaccia: si usano nel browser (oggetto globale Motore)
   e in Node per i test (require).

   Convenzioni:
   - importi in euro, tassi in percentuale annua (es. 5,5 = 5,5%)
   - durata in mesi, rate mensili
   - ogni importo di riga è arrotondato al centesimo
   - le spese una tantum si pagano all'inizio (mese 0) e riducono la somma ricevuta
   - i costi per rata si pagano ogni mese, i costi annuali ai mesi 12, 24, 36...
   - ammortamento "alla francese" (rata costante), con preammortamento e rata finale facoltativi
*/
(function (radice) {
  'use strict';

  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  /* ---------- Formattazione all'italiana (senza dipendere dal sistema) ---------- */
  function formattaNumero(x, decimali) {
    var d = decimali === undefined ? 2 : decimali;
    var negativo = x < 0;
    var s = Math.abs(x).toFixed(d);
    var parti = s.split('.');
    var intero = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var out = parti.length > 1 ? intero + ',' + parti[1] : intero;
    if (negativo && Number(s) !== 0) out = '-' + out;
    return out;
  }
  function formattaEuro(x) { return formattaNumero(x, 2) + ' €'; }   // spazio che non va a capo
  function formattaPerc(x, decimali) { return formattaNumero(x, decimali === undefined ? 2 : decimali) + '%'; }

  /* ---------- Rata e tassi ---------- */
  // Rata costante per un debito P a tasso mensile i su n rate, con eventuale rata finale (balloon).
  function rataFrancese(P, i, n, balloon) {
    var b = balloon || 0;
    if (n <= 0) return 0;
    if (Math.abs(i) < 1e-12) return (P - b) / n;
    var f = Math.pow(1 + i, -n);
    return (P - b * f) * i / (1 - f);
  }

  // Dal dato "rata indicata dalla banca" ricava il tasso annuo nominale (TAN, in %).
  function tassoDaRata(P, rata, nAmmortamento, balloon) {
    var b = balloon || 0;
    if (nAmmortamento <= 0 || P <= 0 || rata <= 0) return null;
    var minRata = rataFrancese(P, 0, nAmmortamento, b);
    if (rata < minRata - 1e-9) return null;       // rata troppo bassa: tasso negativo, non gestito
    var lo = 0, hi = 1; // tasso mensile 0%..100%
    for (var k = 0; k < 200; k++) {
      var mid = (lo + hi) / 2;
      if (rataFrancese(P, mid, nAmmortamento, b) < rata) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2 * 1200;
  }

  function tanBase(p) {
    if (p.variabile) return num(p.indice) + num(p.spread);
    if (p.tan !== undefined && p.tan !== null && p.tan !== '') return num(p.tan);
    if (num(p.rataIndicata) > 0) {
      var t = tassoDaRata(num(p.importo), num(p.rataIndicata), num(p.mesi) - num(p.preamm), num(p.rataFinale));
      return t === null ? 0 : t;
    }
    return 0;
  }

  // Spese iniziali. Se una spesa è "finanziata" la banca la somma al debito invece di farla pagare subito.
  function costiUnaTantumDettaglio(p) {
    var pagati = 0, finanziati = 0, P = num(p.importo);
    (p.costiUnaTantum || []).forEach(function (c) {
      var v = num(c.importo) + P * num(c.perc) / 100;
      if (c.finanziata) finanziati += v; else pagati += v;
    });
    return { pagati: r2(pagati), finanziati: r2(finanziati), totale: r2(pagati + finanziati) };
  }
  function costiUnaTantumTotale(p) { return costiUnaTantumDettaglio(p).totale; }

  function costoPeriodico(p, mese) {
    var tot = 0;
    (p.costiPeriodici || []).forEach(function (c) {
      tot += num(c.importoRata);
      if (mese % 12 === 0) tot += num(c.importoAnno);
    });
    return r2(tot);
  }

  /* ---------- Controllo dati ---------- */
  function datiMancanti(p) {
    var m = [];
    if (!(num(p.importo) > 0)) m.push('importo finanziato');
    if (!(num(p.mesi) > 0)) m.push('durata (mesi o anni)');
    if (p.variabile) {
      if (p.indice === undefined || p.indice === null || p.indice === '') m.push('valore attuale dell\'indice (es. Euribor)');
      if (p.spread === undefined || p.spread === null || p.spread === '') m.push('spread');
    } else {
      var haTan = p.tan !== undefined && p.tan !== null && p.tan !== '';
      if (!haTan && !(num(p.rataIndicata) > 0)) m.push('tasso (TAN) oppure rata indicata dalla banca');
    }
    if (num(p.preamm) >= num(p.mesi) && num(p.mesi) > 0) m.push('preammortamento più corto della durata');
    if (num(p.rataFinale) >= num(p.importo) && num(p.importo) > 0) m.push('rata finale inferiore all\'importo');
    return m;
  }

  function avvisi(p) {
    var a = [];
    var haUnaTantum = (p.costiUnaTantum || []).some(function (c) { return num(c.importo) > 0 || num(c.perc) > 0; });
    var haPeriodici = (p.costiPeriodici || []).some(function (c) { return num(c.importoRata) > 0 || num(c.importoAnno) > 0; });
    if (!haUnaTantum && !haPeriodici) {
      a.push('Non hai inserito costi accessori (istruttoria, perizia, assicurazioni, spese di incasso): il costo reale potrebbe essere più alto.');
    }
    if (!p.variabile && p.tan !== undefined && p.tan !== null && p.tan !== '' && num(p.rataIndicata) > 0 && num(p.importo) > 0 && num(p.mesi) > 0) {
      var attesa = rataFrancese(num(p.importo), num(p.tan) / 1200, num(p.mesi) - num(p.preamm), num(p.rataFinale));
      if (Math.abs(attesa - num(p.rataIndicata)) > 1) {
        a.push('La rata indicata (' + formattaEuro(num(p.rataIndicata)) + ') non coincide con quella calcolata dal TAN (' + formattaEuro(r2(attesa)) + '): ho usato il TAN.');
      }
    }
    return a;
  }

  /* ---------- Piano di ammortamento ----------
     opzioni.scenario  : [{mese, delta}]  cambio dell'indice (in punti) dal mese indicato (solo variabile)
     opzioni.estinzioni: [{mese, importo, modo:'durata'|'rata', penalePerc}]
     Riga: {mese, rata, interessi, capitale, costi, extra, penale, debito}   */
  function piano(p, opzioni) {
    var o = opzioni || {};
    var P = r2(num(p.importo) + costiUnaTantumDettaglio(p).finanziati);   // debito su cui si pagano gli interessi
    var n = Math.round(num(p.mesi));
    var pre = Math.round(num(p.preamm));
    var balloon = r2(num(p.rataFinale));
    var tan0 = tanBase(p);
    var scenario = (p.variabile && o.scenario) ? o.scenario : [];
    var estinzioni = o.estinzioni || [];
    var righe = [];
    var debito = P, rata = null, iPrec = null, ricalcola = true;

    function tanAl(k) {
      var t = tan0;
      scenario.forEach(function (s) { if (k >= s.mese) t += num(s.delta); });
      return Math.max(t, 0);
    }

    for (var k = 1; k <= n && debito > 0.004; k++) {
      var i = tanAl(k) / 1200;
      var interessi = r2(debito * i);
      var capitale, rataK;
      if (k <= pre) {
        capitale = 0; rataK = interessi;
      } else {
        if (rata === null || ricalcola || iPrec === null || Math.abs(i - iPrec) > 1e-15) {
          rata = r2(rataFrancese(debito, i, n - k + 1, balloon));
          ricalcola = false;
        }
        iPrec = i;
        capitale = r2(rata - interessi);
        if (k === n || capitale >= debito) capitale = debito;   // l'ultima rata chiude il debito
        rataK = r2(interessi + capitale);
      }
      debito = r2(debito - capitale);
      var extra = 0, penale = 0;
      estinzioni.forEach(function (e) {
        if (e.mese === k && debito > 0) {
          var imp = Math.min(r2(num(e.importo)), debito);
          extra = r2(extra + imp);
          penale = r2(penale + imp * num(e.penalePerc) / 100);
          debito = r2(debito - imp);
          if (e.modo === 'rata') ricalcola = true;
        }
      });
      righe.push({ mese: k, rata: rataK, interessi: interessi, capitale: capitale,
                   costi: costoPeriodico(p, k), extra: extra, penale: penale, debito: debito });
    }
    return righe;
  }

  /* ---------- TAEG / TIR ---------- */
  function flussi(p, righe) {
    var f = [r2(num(p.importo) - costiUnaTantumDettaglio(p).pagati)];
    righe.forEach(function (r) { f.push(-r2(r.rata + r.costi + r.extra + r.penale)); });
    return f;
  }

  // Tasso mensile r tale che la somma dei flussi attualizzati vale zero. Null se non esiste.
  function tassoInternoMensile(f) {
    function npv(r) { var s = 0; for (var k = 0; k < f.length; k++) s += f[k] / Math.pow(1 + r, k); return s; }
    if (npv(0) >= 0) return 0;      // nessun costo: tasso zero
    var lo = 0, hi = 1;
    if (npv(hi) <= 0) return null;
    for (var j = 0; j < 300; j++) {
      var mid = (lo + hi) / 2;
      if (npv(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function taegPerc(f) {
    var r = tassoInternoMensile(f);
    return r === null ? null : (Math.pow(1 + r, 12) - 1) * 100;
  }

  // Costo attualizzato: valore oggi dei pagamenti meno la somma ricevuta.
  function costoAttualizzato(f, tassoAnnuoPerc) {
    var d = Math.pow(1 + num(tassoAnnuoPerc) / 100, 1 / 12) - 1;
    var s = 0;
    for (var k = 0; k < f.length; k++) s += f[k] / Math.pow(1 + d, k);
    return -s;
  }

  /* ---------- Riepilogo ---------- */
  function riepilogo(p, opzioni) {
    var righe = piano(p, opzioni);
    var f = flussi(p, righe);
    var interessi = 0, rate = 0, costiPer = 0, extra = 0, penali = 0;
    righe.forEach(function (r) {
      interessi += r.interessi; rate += r.rata; costiPer += r.costi; extra += r.extra; penali += r.penale;
    });
    var det = costiUnaTantumDettaglio(p);
    var unaTantum = det.totale;
    var primaRata = righe.length ? righe[Math.min(righe.length, Math.max(0, Math.round(num(p.preamm))) + 1) - 1].rata : 0;
    var accessori = r2(unaTantum + costiPer + penali);
    var totalePagato = r2(rate + extra + costiPer + penali + det.pagati);
    return {
      righe: righe,
      flussi: f,
      tan: tanBase(p),
      rataIniziale: primaRata,
      rataMassima: righe.reduce(function (m, r) { return Math.max(m, r.rata); }, 0),
      durataEffettiva: righe.length,
      importoRicevuto: r2(num(p.importo) - det.pagati),
      debitoIniziale: r2(num(p.importo) + det.finanziati),
      costiFinanziati: det.finanziati,
      interessiTotali: r2(interessi),
      costiUnaTantum: unaTantum,
      costiPeriodici: r2(costiPer),
      penali: r2(penali),
      costiAccessori: accessori,
      costoDelCredito: r2(interessi + accessori),
      totalePagato: totalePagato,
      taeg: taegPerc(f),
      taegDichiarato: (p.taegDichiarato === undefined || p.taegDichiarato === null || p.taegDichiarato === '') ? null : num(p.taegDichiarato)
    };
  }

  function perAnno(righe) {
    var anni = {};
    righe.forEach(function (r) {
      var a = Math.ceil(r.mese / 12);
      if (!anni[a]) anni[a] = { anno: a, rate: 0, interessi: 0, capitale: 0, costi: 0, debitoFinale: 0 };
      anni[a].rate = r2(anni[a].rate + r.rata + r.extra + r.penale);
      anni[a].interessi = r2(anni[a].interessi + r.interessi);
      anni[a].capitale = r2(anni[a].capitale + r.capitale + r.extra);
      anni[a].costi = r2(anni[a].costi + r.costi + r.penale);
      anni[a].debitoFinale = r.debito;
    });
    return Object.keys(anni).map(function (k) { return anni[k]; });
  }

  /* ---------- Scenari ---------- */
  // Quanto cambia il finanziamento variabile se l'indice sale o scende di "delta" punti dal mese "mese".
  function scenariVariabile(p, deltas, mese) {
    var base = riepilogo(p);
    return deltas.map(function (d) {
      var r = riepilogo(p, { scenario: [{ mese: mese, delta: d }] });
      var rataDopo = null;
      for (var k = 0; k < r.righe.length; k++) { if (r.righe[k].mese >= mese && r.righe[k].mese > num(p.preamm)) { rataDopo = r.righe[k].rata; break; } }
      return { delta: d, rataDopo: rataDopo, totalePagato: r.totalePagato, interessiTotali: r.interessiTotali,
               differenzaTotale: r2(r.totalePagato - base.totalePagato), taeg: r.taeg };
    });
  }

  // Effetto di un versamento anticipato. Confronta con il piano senza versamento.
  function estinzioneAnticipata(p, mese, importo, modo, penalePerc, opzioni) {
    var base = riepilogo(p, opzioni);
    var est = { mese: mese, importo: importo, modo: modo, penalePerc: penalePerc || 0 };
    var o = Object.assign({}, opzioni || {});
    o.estinzioni = (o.estinzioni || []).concat([est]);
    var con = riepilogo(p, o);
    var righeMese = con.righe.filter(function (r) { return r.mese === mese; })[0];
    var versato = righeMese ? righeMese.extra : 0;
    var rataDopo = null;
    for (var k = 0; k < con.righe.length; k++) { if (con.righe[k].mese > mese) { rataDopo = con.righe[k].rata; break; } }
    return {
      base: base, con: con,
      versato: versato,
      penale: righeMese ? righeMese.penale : 0,
      interessiRisparmiati: r2(base.interessiTotali - con.interessiTotali),
      risparmioNetto: r2(base.totalePagato - con.totalePagato),   // già al netto di penale e importo versato
      mesiRisparmiati: base.durataEffettiva - con.durataEffettiva,
      rataDopo: rataDopo
    };
  }

  /* ---------- Verdetto in parole semplici ---------- */
  function confronta(rA, rB, nomeA, nomeB, opzioni) {
    var o = opzioni || {};
    var nA = nomeA || 'Proposta A', nB = nomeB || 'Proposta B';
    var righe = [];
    var diff = r2(rA.costoDelCredito - rB.costoDelCredito);
    var migliore = null;
    if (Math.abs(diff) < 1) {
      righe.push('Le due proposte costano praticamente lo stesso (differenza inferiore a 1 €).');
    } else {
      migliore = diff < 0 ? nA : nB;
      var altra = diff < 0 ? nB : nA;
      righe.push(migliore + ' costa ' + formattaEuro(Math.abs(diff)) + ' in meno di ' + altra +
                 ' (interessi più spese, penali comprese).');
    }
    var dRata = r2(rA.rataIniziale - rB.rataIniziale);
    if (Math.abs(dRata) >= 1) {
      var piuBassa = dRata < 0 ? nA : nB;
      righe.push('La rata più bassa è quella di ' + piuBassa + ' (' + formattaEuro(Math.abs(dRata)) + ' al mese in meno).');
      if (migliore && migliore !== piuBassa) {
        righe.push('Attenzione: ' + migliore + ' costa meno in totale, ma ' + piuBassa + ' pesa meno ogni mese. Dipende da cosa conta di più per te.');
      }
    }
    if (rA.taeg !== null && rB.taeg !== null && Math.abs(rA.taeg - rB.taeg) >= 0.005) {
      var tMeglio = rA.taeg < rB.taeg ? nA : nB;
      var tPeggio = tMeglio === nA ? nB : nA;
      var vMeglio = Math.min(rA.taeg, rB.taeg), vPeggio = Math.max(rA.taeg, rB.taeg);
      righe.push('Il TAEG calcolato è più basso per ' + tMeglio + ' (' + formattaPerc(vMeglio) + ' contro ' +
                 formattaPerc(vPeggio) + ' di ' + tPeggio + ').');
    }
    if (rA.durataEffettiva !== rB.durataEffettiva) {
      var cA = rA.costoDelCredito / (rA.durataEffettiva / 12), cB = rB.costoDelCredito / (rB.durataEffettiva / 12);
      righe.push('Le durate sono diverse (' + rA.durataEffettiva + ' e ' + rB.durataEffettiva + ' mesi): costo medio ' +
                 formattaEuro(r2(cA)) + ' all\'anno per ' + nA + ' e ' + formattaEuro(r2(cB)) + ' per ' + nB + '.');
    }
    if (Math.abs(r2(num(rA.importoRicevuto) - num(rB.importoRicevuto))) >= 1 &&
        Math.abs(rA.flussi[0] - rB.flussi[0]) >= 1 && rA.importoRicevuto !== rB.importoRicevuto) {
      righe.push('Le somme che ricevi realmente sono diverse: ' + formattaEuro(rA.importoRicevuto) + ' contro ' + formattaEuro(rB.importoRicevuto) + '.');
    }
    var attualizzato = null;
    if (o.tassoSconto !== undefined && o.tassoSconto !== null && o.tassoSconto !== '') {
      var vA = costoAttualizzato(rA.flussi, o.tassoSconto), vB = costoAttualizzato(rB.flussi, o.tassoSconto);
      attualizzato = { A: r2(vA), B: r2(vB), differenza: r2(vA - vB) };
      var dv = vA - vB;
      if (Math.abs(dv) >= 1) {
        righe.push('Tenendo conto del valore del denaro nel tempo (sconto ' + formattaPerc(num(o.tassoSconto), 1) + ' annuo), ' +
                   (dv < 0 ? nA : nB) + ' costa ' + formattaEuro(Math.abs(r2(dv))) + ' in meno.');
      } else {
        righe.push('Tenendo conto del valore del denaro nel tempo, le due proposte si equivalgono.');
      }
    }
    return { migliore: migliore, differenzaCosto: diff, differenzaRata: dRata, attualizzato: attualizzato,
             testo: righe.join(' '), righe: righe };
  }

  var Motore = {
    r2: r2, formattaNumero: formattaNumero, formattaEuro: formattaEuro, formattaPerc: formattaPerc,
    rataFrancese: rataFrancese, tassoDaRata: tassoDaRata, tanBase: tanBase,
    costiUnaTantumTotale: costiUnaTantumTotale, costiUnaTantumDettaglio: costiUnaTantumDettaglio, datiMancanti: datiMancanti, avvisi: avvisi,
    piano: piano, flussi: flussi, tassoInternoMensile: tassoInternoMensile, taegPerc: taegPerc,
    costoAttualizzato: costoAttualizzato, riepilogo: riepilogo, perAnno: perAnno,
    scenariVariabile: scenariVariabile, estinzioneAnticipata: estinzioneAnticipata, confronta: confronta
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Motore;
  else radice.Motore = Motore;
})(typeof self !== 'undefined' ? self : this);
