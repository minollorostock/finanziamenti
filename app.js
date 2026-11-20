/* Interfaccia dell'app «Confronto finanziamenti».
   Tutti i calcoli stanno in motore.js; qui ci sono schermate, controllo dei dati e salvataggio.
   I dati restano nel telefono (localStorage): niente viene inviato da nessuna parte. */
(function () {
  'use strict';
  var M = window.Motore;
  var CH_CORRENTE = 'cf_corrente';
  var CH_SALVATI = 'cf_salvati';

  /* ---------- Utilità ---------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // «1.234,56» o «1234,56» o «1234.56» → numero; vuoto o non valido → null
  function leggiNumero(s) {
    if (s === undefined || s === null) return null;
    var t = String(s).trim().replace(/\s/g, '').replace(/€|%/g, '');
    if (t === '' || t === '-') return null;
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    var n = Number(t);
    return isFinite(n) ? n : null;
  }
  function percorso(obj, path) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length; i++) { if (o === undefined || o === null) return undefined; o = o[p[i]]; }
    return o;
  }
  function imposta(obj, path, val) {
    var p = path.split('.'), o = obj;
    for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val;
  }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function eur(x) { return M.formattaEuro(x); }
  function eur0(x) { return M.formattaNumero(x, 0) + ' €'; }   // euro interi, per le tabelle strette
  function adesso() { return new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }); }
  function nuovoId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function segno(x, formatta) { return (x > 0 ? '+' : x < 0 ? '−' : '') + formatta(Math.abs(x)); }

  /* ---------- Stato ---------- */
  function propostaVuota(nome) {
    return {
      nome: nome, tipo: 'prestito', importo: '', durata: '', unita: 'anni',
      tasso: 'fisso', tan: '', rataIndicata: '', indice: '', spread: '',
      preamm: '', rataFinale: '', taegDichiarato: '',
      iniziali: [{ descr: 'Spese di istruttoria', valore: '', unita: 'euro', finanziata: false }],
      ricorrenti: [{ descr: 'Spese di incasso rata', valore: '', unita: 'rata' }]
    };
  }
  function statoVuoto() {
    return {
      id: null, nome: 'Nuovo confronto', A: propostaVuota('Proposta A'), B: propostaVuota('Proposta B'),
      sconto: '', pianoSel: 'A', pianoMensile: false,
      scen: { sel: 'A', mese: '13', custom: '', estMese: '', estImporto: '', estModo: 'durata', estPenale: '' }
    };
  }
  var stato = statoVuoto();
  var scheda = 'proposte';

  function memoriaOk() { try { localStorage.setItem('cf_t', '1'); localStorage.removeItem('cf_t'); return true; } catch (e) { return false; } }
  var haMemoria = memoriaOk();
  function salvaCorrente() { if (haMemoria) { try { localStorage.setItem(CH_CORRENTE, JSON.stringify(stato)); } catch (e) { /* memoria piena */ } } }
  function caricaCorrente() {
    if (!haMemoria) return;
    try {
      var s = JSON.parse(localStorage.getItem(CH_CORRENTE) || 'null');
      if (s && s.A && s.B) stato = integra(s);
    } catch (e) { /* dati rovinati: si riparte da zero */ }
  }
  function integra(s) { // aggiunge i campi nuovi a uno stato salvato con una versione precedente
    var v = statoVuoto();
    ['A', 'B'].forEach(function (k) { s[k] = Object.assign(propostaVuota(v[k].nome), s[k]); });
    s.scen = Object.assign(v.scen, s.scen || {});
    return Object.assign(v, s);
  }
  function elencoSalvati() {
    if (!haMemoria) return [];
    try { return JSON.parse(localStorage.getItem(CH_SALVATI) || '[]'); } catch (e) { return []; }
  }
  function scriviSalvati(l) { try { localStorage.setItem(CH_SALVATI, JSON.stringify(l)); return true; } catch (e) { return false; } }

  /* ---------- Dal modulo ai numeri per il motore ---------- */
  function perMotore(p) {
    var d = leggiNumero(p.durata);
    var mesi = d === null ? null : Math.round(p.unita === 'anni' ? d * 12 : d);
    var o = { nome: p.nome, importo: leggiNumero(p.importo), mesi: mesi };
    if (p.tasso === 'variabile') {
      o.variabile = true;
      var ind = leggiNumero(p.indice), spr = leggiNumero(p.spread);
      if (ind !== null) o.indice = ind;
      if (spr !== null) o.spread = spr;
    } else {
      var t = leggiNumero(p.tan), r = leggiNumero(p.rataIndicata);
      if (t !== null) o.tan = t;
      if (r !== null) o.rataIndicata = r;
    }
    var pre = leggiNumero(p.preamm), bal = leggiNumero(p.rataFinale), tg = leggiNumero(p.taegDichiarato);
    if (pre !== null) o.preamm = Math.round(pre);
    if (bal !== null) o.rataFinale = bal;
    if (tg !== null) o.taegDichiarato = tg;
    o.costiUnaTantum = [];
    p.iniziali.forEach(function (c) {
      var v = leggiNumero(c.valore);
      if (v === null || v === 0) return;
      var x = { descr: c.descr, finanziata: !!c.finanziata };
      if (c.unita === 'perc') x.perc = v; else x.importo = v;
      o.costiUnaTantum.push(x);
    });
    o.costiPeriodici = [];
    p.ricorrenti.forEach(function (c) {
      var v = leggiNumero(c.valore);
      if (v === null || v === 0) return;
      var x = { descr: c.descr };
      if (c.unita === 'anno') x.importoAnno = v; else x.importoRata = v;
      o.costiPeriodici.push(x);
    });
    // se un numero è scritto male lo segnaliamo come dato mancante
    return o;
  }
  function campiIllegibili(p) {
    var m = [];
    [['importo', 'importo'], ['durata', 'durata'], ['tan', 'TAN'], ['rataIndicata', 'rata indicata'], ['indice', 'indice'],
     ['spread', 'spread'], ['preamm', 'preammortamento'], ['rataFinale', 'rata finale'], ['taegDichiarato', 'TAEG dichiarato']].forEach(function (c) {
      var v = p[c[0]];
      if (v !== '' && v !== undefined && leggiNumero(v) === null) m.push('«' + c[1] + '» non è un numero valido');
    });
    return m;
  }
  function elaboraProposta(k) {
    var p = stato[k], o = perMotore(p);
    var mancanti = campiIllegibili(p).concat(M.datiMancanti(o));
    if (mancanti.length) return { k: k, nome: p.nome || ('Proposta ' + k), mancanti: mancanti };
    return { k: k, nome: p.nome || ('Proposta ' + k), mancanti: [], dati: o, r: M.riepilogo(o), avvisi: M.avvisi(o) };
  }

  /* ---------- Pezzi di interfaccia ---------- */
  function campo(path, etichetta, aiuto, opz) {
    opz = opz || {};
    var v = percorso(stato, path);
    return '<label>' + esc(etichetta) + (aiuto ? '<span class="aiuto">' + esc(aiuto) + '</span>' : '') +
      '<input type="text" inputmode="' + (opz.testo ? 'text' : 'decimal') + '" autocomplete="off" data-path="' + path +
      '" value="' + esc(v) + '"' + (opz.segnaposto ? ' placeholder="' + esc(opz.segnaposto) + '"' : '') + '></label>';
  }
  function selezione(path, etichetta, opzioni, rirender, extraClasse) {
    var v = percorso(stato, path);
    return (etichetta ? '<label>' + esc(etichetta) : '<label class="' + (extraClasse || '') + '" style="margin:0">') +
      '<select data-path="' + path + '"' + (rirender ? ' data-rerender="1"' : '') + (etichetta ? '' : ' aria-label="unità"') + '>' +
      opzioni.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></label>';
  }
  function moduloProposta(k) {
    var p = stato[k], h = '';
    h += '<section class="carta ' + k.toLowerCase() + '"><h2>' + esc(p.nome || 'Proposta ' + k) + '</h2>';
    h += campo(k + '.nome', 'Nome della proposta', 'Per riconoscerla, ad esempio il nome della banca', { testo: true });
    h += selezione(k + '.tipo', 'Tipo di finanziamento', [['mutuo', 'Mutuo casa'], ['prestito', 'Prestito personale'], ['auto', 'Finanziamento auto'], ['altro', 'Altro']]);
    h += campo(k + '.importo', 'Importo finanziato (€)', 'La somma che chiedi alla banca', { segnaposto: 'es. 150.000' });
    h += '<label>Durata<span class="aiuto">Per quanto tempo paghi le rate</span></label><div class="riga">' +
      '<input type="text" inputmode="decimal" autocomplete="off" aria-label="durata" data-path="' + k + '.durata" value="' + esc(p.durata) + '" placeholder="es. 25">' +
      selezione(k + '.unita', '', [['anni', 'anni'], ['mesi', 'mesi']], true, 'stretto') + '</div>';
    h += selezione(k + '.tasso', 'Tipo di tasso', [['fisso', 'Fisso (non cambia)'], ['variabile', 'Variabile (indice + spread)']], true);
    if (p.tasso === 'variabile') {
      h += '<div class="riga">' + campo(k + '.indice', 'Indice oggi (%)', 'es. Euribor 3 mesi', { segnaposto: 'es. 2,5' }) +
        campo(k + '.spread', 'Spread (%)', 'Margine della banca', { segnaposto: 'es. 1,2' }) + '</div>';
    } else {
      h += campo(k + '.tan', 'TAN, tasso nominale annuo (%)', 'Senza spese. Lo trovi nel prospetto informativo (SECCI/PIES)', { segnaposto: 'es. 3,2' });
      h += campo(k + '.rataIndicata', '… oppure la rata mensile indicata (€)', 'Se non conosci il TAN, ricavo il tasso dalla rata', { segnaposto: 'es. 711,32' });
    }
    h += '<h3>Spese iniziali</h3><span class="aiuto">Istruttoria, perizia, imposta sostitutiva, notaio…</span>';
    p.iniziali.forEach(function (c, i) {
      var b = k + '.iniziali.' + i;
      h += '<div class="riga-costo"><div class="intera">' + campo(b + '.descr', 'Descrizione', '', { testo: true }).replace('<label>', '<label style="margin-top:0">') + '</div>' +
        campo(b + '.valore', 'Valore', '') + selezione(b + '.unita', 'Espresso in', [['euro', '€'], ['perc', '% dell\'importo']]) +
        '<label class="controllo intera"><input type="checkbox" data-path="' + b + '.finanziata"' + (c.finanziata ? ' checked' : '') + '> La banca la somma al finanziamento (non la pago subito)</label>' +
        '<div class="intera"><button class="piccolo pericolo" data-azione="togli-iniziale" data-k="' + k + '" data-i="' + i + '">Togli questa spesa</button></div></div>';
    });
    h += '<button class="piccolo" data-azione="aggiungi-iniziale" data-k="' + k + '">+ Aggiungi spesa iniziale</button>';
    h += '<h3>Costi ricorrenti</h3><span class="aiuto">Incasso rata, assicurazioni, gestione conto…</span>';
    p.ricorrenti.forEach(function (c, i) {
      var b = k + '.ricorrenti.' + i;
      h += '<div class="riga-costo"><div class="intera">' + campo(b + '.descr', 'Descrizione', '', { testo: true }).replace('<label>', '<label style="margin-top:0">') + '</div>' +
        campo(b + '.valore', 'Valore (€)', '') + selezione(b + '.unita', 'Si paga', [['rata', 'a ogni rata'], ['anno', 'ogni anno']]) +
        '<div class="intera"><button class="piccolo pericolo" data-azione="togli-ricorrente" data-k="' + k + '" data-i="' + i + '">Togli questo costo</button></div></div>';
    });
    h += '<button class="piccolo" data-azione="aggiungi-ricorrente" data-k="' + k + '">+ Aggiungi costo ricorrente</button>';
    var avanz = p.preamm !== '' || p.rataFinale !== '' || p.taegDichiarato !== '';
    h += '<details style="margin-top:14px"' + (avanz ? ' open' : '') + '><summary style="min-height:44px;padding:10px 0;font-weight:600">Opzioni avanzate</summary>' +
      campo(k + '.preamm', 'Preammortamento (mesi)', 'Mesi iniziali in cui paghi solo gli interessi', { segnaposto: '0' }) +
      campo(k + '.rataFinale', 'Rata finale / maxi-rata (€)', 'Tipica dei finanziamenti auto', { segnaposto: '0' }) +
      campo(k + '.taegDichiarato', 'TAEG indicato dalla banca (%)', 'Lo confronto con quello che calcolo io', { segnaposto: 'es. 3,5' }) + '</details>';
    h += '<div class="mancano" data-mancano="' + k + '" hidden></div></section>';
    return h;
  }
  function riquadroMancanti(e) {
    return '<strong>' + esc(e.nome) + ' – mancano questi dati:</strong><ul>' + e.mancanti.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }
  function aggiornaMancanti() {
    ['A', 'B'].forEach(function (k) {
      var box = document.querySelector('[data-mancano="' + k + '"]');
      if (!box) return;
      var e = elaboraProposta(k);
      var vuota = !stato[k].importo && !stato[k].durata && !stato[k].tan && !stato[k].rataIndicata;
      if (e.mancanti.length) { box.innerHTML = riquadroMancanti(e); box.hidden = false; }
      else if (!vuota) { box.innerHTML = '✔ Dati sufficienti per calcolare. Vai su «Risultati».'; box.hidden = false; box.style.background = '#14301f'; box.style.borderColor = '#2c7a4b'; box.style.color = '#c9f2d8'; }
      else box.hidden = true;
      if (e.mancanti.length) { box.style.background = ''; box.style.borderColor = ''; box.style.color = ''; }
    });
    var h2a = document.querySelectorAll('.carta h2');
    if (h2a[0]) h2a[0].textContent = stato.A.nome || 'Proposta A';
    if (h2a[1]) h2a[1].textContent = stato.B.nome || 'Proposta B';
  }

  /* ---------- Grafici (SVG, senza librerie) ---------- */
  function etichettaK(v) { return v >= 1000 ? M.formattaNumero(v / 1000, v % 1000 === 0 || v >= 100000 ? 0 : 1) + 'k' : String(Math.round(v)); }
  function grafico(titolo, serie) {
    var W = 340, H = 210, sx = 46, dx = 10, sy = 14, bs = 30;
    var maxM = 0, maxY = 0;
    serie.forEach(function (s) { maxM = Math.max(maxM, s.y.length - 1); s.y.forEach(function (v) { if (v > maxY) maxY = v; }); });
    if (maxM <= 0 || maxY <= 0) return '';
    var passo = Math.pow(10, Math.floor(Math.log10(maxY)));
    var top = Math.ceil(maxY / passo) * passo;
    if (top / passo < 2) top = passo * 2; else if (top / passo === 2 && maxY < passo * 1.4) top = passo * 1.5;
    function X(m) { return sx + (W - sx - dx) * m / maxM; }
    function Y(v) { return H - bs - (H - bs - sy) * v / top; }
    var out = '<svg class="grafico" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titolo) + '">';
    for (var g = 0; g <= 4; g++) {
      var v = top * g / 4;
      out += '<line x1="' + sx + '" x2="' + (W - dx) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#36414d" stroke-width="1"/>' +
        '<text x="' + (sx - 5) + '" y="' + (Y(v) + 4).toFixed(1) + '" fill="#b4c0cc" font-size="11" text-anchor="end">' + etichettaK(v) + '</text>';
    }
    var anni = maxM / 12, pa = anni <= 6 ? 1 : anni <= 12 ? 2 : anni <= 30 ? 5 : 10;
    if (anni < 1) { pa = 0; }
    if (pa) {
      for (var a = 0; a <= anni + 1e-9; a += pa) {
        out += '<text x="' + X(a * 12).toFixed(1) + '" y="' + (H - 12) + '" fill="#b4c0cc" font-size="11" text-anchor="middle">' + a + '</text>';
      }
      out += '<text x="' + (W - dx) + '" y="' + (H - 1) + '" fill="#b4c0cc" font-size="10" text-anchor="end">anni</text>';
    }
    serie.forEach(function (s) {
      var pts = s.y.map(function (v, m) { return X(m).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
      out += '<polyline fill="none" stroke="' + s.colore + '" stroke-width="3" stroke-linejoin="round" points="' + pts + '"/>';
    });
    out += '</svg><div class="legenda">' + serie.map(function (s) { return '<span><i style="background:' + s.colore + '"></i>' + esc(s.nome) + '</span>'; }).join('') + '</div>';
    return '<h3>' + esc(titolo) + '</h3>' + out;
  }
  function serieDebito(e) { var y = [e.r.debitoIniziale]; e.r.righe.forEach(function (r) { y.push(r.debito); }); return y; }
  function serieCumulato(e) {
    var tot = M.costiUnaTantumDettaglio(e.dati).pagati, y = [tot];
    e.r.righe.forEach(function (r) { tot += r.rata + r.costi + r.extra + r.penale; y.push(tot); });
    return y;
  }

  /* ---------- Schede ---------- */
  function schedaProposte() {
    return '<p class="piccolo-testo">Compila ciò che sai: se manca qualcosa, ti dico cosa. I dati restano solo in questo telefono.</p>' +
      moduloProposta('A') + moduloProposta('B') +
      '<div class="azioni"><button data-azione="esempio">Prova con un esempio</button></div>';
  }
  function datiEsempio() {
    var s = statoVuoto();
    s.nome = 'Esempio: mutuo da 150.000 €';
    s.A = Object.assign(s.A, { nome: 'Banca A', tipo: 'mutuo', importo: '150.000', durata: '25', unita: 'anni', tan: '3,2',
      taegDichiarato: '3,35', iniziali: [{ descr: 'Spese di istruttoria', valore: '1.200', unita: 'euro', finanziata: false }],
      ricorrenti: [{ descr: 'Spese di incasso rata', valore: '0', unita: 'rata' }] });
    s.B = Object.assign(s.B, { nome: 'Banca B', tipo: 'mutuo', importo: '150.000', durata: '25', unita: 'anni', tan: '3', taegDichiarato: '3,2',
      iniziali: [{ descr: 'Spese di istruttoria', valore: '1.500', unita: 'euro', finanziata: false }, { descr: 'Perizia', valore: '0,25', unita: 'perc', finanziata: false }],
      ricorrenti: [{ descr: 'Spese di incasso rata', valore: '2,5', unita: 'rata' }] });
    s.sconto = '2';
    return s;
  }

  var RIGHE_TABELLA = [
    ['Rata mensile', function (r) { return r.rataIniziale; }, eur, 'min', 'La prima rata di ammortamento'],
    ['Somma che ricevi', function (r) { return r.importoRicevuto; }, eur0, 'max', 'Importo meno spese pagate subito'],
    ['Interessi totali', function (r) { return r.interessiTotali; }, eur0, 'min'],
    ['Spese e costi', function (r) { return r.costiAccessori; }, eur0, 'min', 'Iniziali, ricorrenti, penali'],
    ['Costo del credito', function (r) { return r.costoDelCredito; }, eur0, 'min', 'Interessi + spese: quanto paghi in più'],
    ['Totale pagato', function (r) { return r.totalePagato; }, eur0, 'min'],
    ['TAN', function (r) { return r.tan; }, function (x) { return M.formattaPerc(x, 3); }, 'min'],
    ['TAEG calcolato', function (r) { return r.taeg; }, function (x) { return M.formattaPerc(x, 3); }, 'min', 'Con tutte le spese'],
    ['Durata (mesi)', function (r) { return r.durataEffettiva; }, function (x) { return String(x); }, null]
  ];
  function tabellaConfronto(eA, eB) {
    var h = '<div class="scorri"><table><thead><tr><th></th><th class="col-a">' + esc(eA.nome) + '</th><th class="col-b">' + esc(eB.nome) + '</th><th>A − B</th></tr></thead><tbody>';
    RIGHE_TABELLA.forEach(function (rg) {
      var a = rg[1](eA.r), b = rg[1](eB.r), f = rg[2];
      if (a === null || b === null || a === undefined || b === undefined) {
        h += '<tr><td>' + rg[0] + '</td><td>' + (a === null ? 'n.d.' : f(a)) + '</td><td>' + (b === null ? 'n.d.' : f(b)) + '</td><td>—</td></tr>'; return;
      }
      var cA = '', cB = '';
      if (rg[3] && Math.abs(a - b) > 0.0049) {
        var aMeglio = rg[3] === 'min' ? a < b : a > b;
        if (aMeglio) cA = 'meglio'; else cB = 'meglio';
      }
      h += '<tr><td>' + rg[0] + (rg[4] ? '<br><span class="piccolo-testo">' + rg[4] + '</span>' : '') + '</td><td class="' + cA + '">' + f(a) + '</td><td class="' + cB + '">' + f(b) + '</td><td>' + segno(a - b, f) + '</td></tr>';
    });
    var dA = eA.r.taegDichiarato, dB = eB.r.taegDichiarato;
    if (dA !== null || dB !== null) {
      h += '<tr><td>TAEG dichiarato</td><td>' + (dA === null ? '—' : M.formattaPerc(dA, 3)) + '</td><td>' + (dB === null ? '—' : M.formattaPerc(dB, 3)) + '</td><td>—</td></tr>';
    }
    return h + '</tbody></table></div>';
  }
  function avvisiTaeg(e) {
    var out = [];
    if (e.r.taegDichiarato !== null && e.r.taeg !== null && Math.abs(e.r.taegDichiarato - e.r.taeg) > 0.15) {
      out.push(e.nome + ': il TAEG dichiarato dalla banca (' + M.formattaPerc(e.r.taegDichiarato, 3) + ') è diverso da quello calcolato (' +
        M.formattaPerc(e.r.taeg, 3) + '). Controlla che siano indicate tutte le spese, o chiedi alla banca come lo ha calcolato.');
    }
    return out;
  }
  function schedaRisultati() {
    var eA = elaboraProposta('A'), eB = elaboraProposta('B'), h = '';
    var viste = [eA, eB];
    viste.forEach(function (e) { if (e.mancanti.length) h += '<div class="mancano">' + riquadroMancanti(e) + '</div>'; });
    if (eA.mancanti.length && eB.mancanti.length) {
      return h + '<p class="vuoto">Compila i dati nella scheda «Proposte» per vedere i risultati.</p>';
    }
    if (!eA.mancanti.length && !eB.mancanti.length) {
      var sc = leggiNumero(stato.sconto);
      var v = M.confronta(eA.r, eB.r, eA.nome, eB.nome, sc === null ? {} : { tassoSconto: sc });
      h += '<div class="verdetto"><h2 style="margin-top:0">In parole semplici</h2>' +
        v.righe.map(function (r, i) { return '<p>' + (i === 0 && v.migliore ? esc(r).replace(esc(v.migliore), '<strong>' + esc(v.migliore) + '</strong>') : esc(r)) + '</p>'; }).join('') + '</div>';
      h += '<section class="carta"><h2>Confronto</h2>' + tabellaConfronto(eA, eB) +
        '<p class="piccolo-testo">In verde il valore più conveniente.</p></section>';
      var avv = eA.avvisi.map(function (a) { return eA.nome + ': ' + a; }).concat(eB.avvisi.map(function (a) { return eB.nome + ': ' + a; }), avvisiTaeg(eA), avvisiTaeg(eB));
      avv.forEach(function (a) { h += '<div class="avviso">' + esc(a) + '</div>'; });
      h += '<section class="carta"><h2>Grafici</h2>' +
        grafico('Debito che resta da pagare (€)', [{ nome: eA.nome, colore: '#5aa9ff', y: serieDebito(eA) }, { nome: eB.nome, colore: '#ffb454', y: serieDebito(eB) }]) +
        grafico('Totale pagato fino a quel momento (€)', [{ nome: eA.nome, colore: '#5aa9ff', y: serieCumulato(eA) }, { nome: eB.nome, colore: '#ffb454', y: serieCumulato(eB) }]) + '</section>';
      h += '<section class="carta"><h2>Valore del denaro nel tempo</h2>' +
        campo('sconto', 'Tasso di sconto annuo (%) – facoltativo', 'Un euro tra 10 anni vale meno di un euro oggi. Con es. 2 il verdetto ne tiene conto.', { segnaposto: 'es. 2' }) + '</section>';
      h += '<div class="azioni"><button class="principale" data-azione="condividi">Condividi il riepilogo</button></div>';
    } else {
      var ok = eA.mancanti.length ? eB : eA;
      h += '<section class="carta ' + ok.k.toLowerCase() + '"><h2>' + esc(ok.nome) + '</h2><div class="scorri"><table><tbody>' +
        RIGHE_TABELLA.map(function (rg) { var x = rg[1](ok.r); return '<tr><td>' + rg[0] + '</td><td>' + (x === null ? 'n.d.' : rg[2](x)) + '</td></tr>'; }).join('') +
        '</tbody></table></div></section>';
      ok.avvisi.concat(avvisiTaeg(ok)).forEach(function (a) { h += '<div class="avviso">' + esc(a) + '</div>'; });
      h += '<p class="piccolo-testo">Completa anche l\'altra proposta per avere il confronto e il verdetto.</p>';
    }
    h += '<p class="disclaimer">I risultati dipendono dai dati inseriti: è uno strumento di calcolo, non una consulenza. Fanno fede i documenti informativi della banca (SECCI/PIES) e il contratto.</p>';
    return h;
  }

  function sceltaProposta(path, eA, eB) {
    return '<label>Quale proposta?<select data-path="' + path + '" data-rerender="1">' +
      '<option value="A"' + (percorso(stato, path) === 'A' ? ' selected' : '') + '>' + esc(eA.nome) + '</option>' +
      '<option value="B"' + (percorso(stato, path) === 'B' ? ' selected' : '') + '>' + esc(eB.nome) + '</option></select></label>';
  }
  function schedaPiano() {
    var eA = elaboraProposta('A'), eB = elaboraProposta('B');
    if (eA.mancanti.length && eB.mancanti.length) return '<p class="vuoto">Compila almeno una proposta nella scheda «Proposte».</p>';
    if (stato.pianoSel === 'A' && eA.mancanti.length) stato.pianoSel = 'B';
    if (stato.pianoSel === 'B' && eB.mancanti.length) stato.pianoSel = 'A';
    var e = stato.pianoSel === 'A' ? eA : eB;
    var h = sceltaProposta('pianoSel', eA, eB);
    h += '<section class="carta ' + e.k.toLowerCase() + '"><h2>Anno per anno</h2><div class="scorri"><table><thead><tr><th>Anno</th><th>Versato</th><th>Interessi</th><th>Capitale</th><th>Debito finale</th></tr></thead><tbody>' +
      M.perAnno(e.r.righe).map(function (a) {
        return '<tr><td>' + a.anno + '</td><td>' + eur(a.rate + a.costi) + '</td><td>' + eur(a.interessi) + '</td><td>' + eur(a.capitale) + '</td><td>' + eur(a.debitoFinale) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    h += '<div class="azioni"><button data-azione="piano-mensile">' + (stato.pianoMensile ? 'Nascondi le rate mese per mese' : 'Mostra le rate mese per mese') + '</button>' +
      '<button data-azione="copia-piano">Copia il piano come testo</button></div>';
    if (stato.pianoMensile) {
      h += '<section class="carta"><div class="scorri"><table><thead><tr><th>Mese</th><th>Rata</th><th>Capitale</th><th>Interessi</th><th>Costi</th><th>Debito</th></tr></thead><tbody>' +
        e.r.righe.map(function (r) {
          return '<tr><td>' + r.mese + '</td><td>' + M.formattaNumero(r.rata) + '</td><td>' + M.formattaNumero(r.capitale + r.extra) + '</td><td>' + M.formattaNumero(r.interessi) + '</td><td>' + M.formattaNumero(r.costi + r.penale) + '</td><td>' + M.formattaNumero(r.debito) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    return h;
  }

  function risultatiScenari() {
    var k = stato.scen.sel, e = elaboraProposta(k), s = stato.scen, h = '';
    if (e.mancanti.length) return '<div class="mancano">' + riquadroMancanti(e) + '</div>';
    var rataBase = e.r.rataIniziale;
    if (e.dati.variabile) {
      var mese = Math.max(1, Math.round(leggiNumero(s.mese) || 13));
      var deltas = [-2, -1, -0.5, 0.5, 1, 2], c = leggiNumero(s.custom);
      if (c !== null && deltas.indexOf(c) < 0) deltas.push(c);
      deltas.sort(function (x, y) { return x - y; });
      var rs = M.scenariVariabile(e.dati, deltas, mese);
      h += '<section class="carta ' + k.toLowerCase() + '"><h2>Se l\'indice cambia dal mese ' + mese + '</h2>' +
        '<p class="piccolo-testo">Rata oggi: ' + eur(rataBase) + '. Totale pagato senza variazioni: ' + eur(e.r.totalePagato) + '.</p>' +
        '<div class="scorri"><table><thead><tr><th>Indice</th><th>Nuova rata</th><th>Totale pagato</th><th>Differenza</th></tr></thead><tbody>' +
        rs.map(function (x) {
          return '<tr><td>' + segno(x.delta, function (v) { return M.formattaNumero(v, 2); }) + ' punti</td><td>' + (x.rataDopo === null ? '—' : eur(x.rataDopo)) + '</td><td>' + eur(x.totalePagato) +
            '</td><td class="' + (x.differenzaTotale < 0 ? 'meglio' : '') + '">' + segno(x.differenzaTotale, eur) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    } else {
      h += '<div class="avviso">Questa proposta è a tasso fisso: la rata non cambia nel tempo. Gli scenari sull\'indice valgono solo per i tassi variabili.</div>';
    }
    var em = Math.round(leggiNumero(s.estMese) || 0), ei = leggiNumero(s.estImporto);
    if (em > 0 && ei !== null && ei > 0) {
      if (em >= e.r.durataEffettiva) {
        h += '<div class="mancano">Il mese del versamento deve essere precedente alla fine del finanziamento (' + e.r.durataEffettiva + ' mesi).</div>';
      } else {
        var x = M.estinzioneAnticipata(e.dati, em, ei, s.estModo, leggiNumero(s.estPenale) || 0);
        var buono = x.risparmioNetto > 0;
        h += '<section class="carta ' + k.toLowerCase() + '"><h2>Versamento anticipato</h2>' +
          '<div class="' + (buono ? 'verdetto' : 'avviso') + '"><p>Versando ' + eur(x.versato) + ' al mese ' + em + (x.penale ? ' (penale ' + eur(x.penale) + ')' : '') + ': ' +
          '<strong>' + (buono ? 'risparmi ' + eur(x.risparmioNetto) : 'non ci guadagni (' + segno(x.risparmioNetto, eur) + ')') + '</strong> sul totale che avresti pagato.</p>' +
          '<p>Interessi risparmiati: ' + eur(x.interessiRisparmiati) + '. ' +
          (s.estModo === 'durata' ? 'Finisci ' + x.mesiRisparmiati + ' mesi prima.' : 'La rata passa da ' + eur(rataBase) + ' a ' + (x.rataDopo === null ? '—' : eur(x.rataDopo)) + '.') + '</p></div></section>';
      }
    }
    return h;
  }
  function schedaScenari() {
    var eA = elaboraProposta('A'), eB = elaboraProposta('B');
    if (eA.mancanti.length && eB.mancanti.length) return '<p class="vuoto">Compila almeno una proposta nella scheda «Proposte».</p>';
    var s = stato.scen;
    if (s.sel === 'A' && eA.mancanti.length) s.sel = 'B';
    if (s.sel === 'B' && eB.mancanti.length) s.sel = 'A';
    var e = s.sel === 'A' ? eA : eB;
    var h = sceltaProposta('scen.sel', eA, eB);
    if (e.dati && e.dati.variabile) {
      h += '<section class="carta"><h2>Tasso variabile</h2>' +
        campo('scen.mese', 'Da quale mese cambia l\'indice?', 'Il mese 13 è l\'inizio del 2° anno', { segnaposto: '13' }) +
        campo('scen.custom', 'Una variazione tua (punti) – facoltativo', 'es. 1,5 oppure -0,75', { segnaposto: '1,5' }) + '</section>';
    }
    h += '<section class="carta"><h2>Versamento anticipato</h2><p class="piccolo-testo">Se versi in una volta una somma extra, quanto risparmi?</p>' +
      campo('scen.estMese', 'In quale mese versi?', '', { segnaposto: 'es. 36' }) +
      campo('scen.estImporto', 'Quanto versi (€)?', '', { segnaposto: 'es. 20.000' }) +
      selezione('scen.estModo', 'Dopo il versamento', [['durata', 'Finisco prima (rata uguale)'], ['rata', 'Pago meno ogni mese (stessa durata)']]) +
      campo('scen.estPenale', 'Penale sul versamento (%)', 'Facoltativa; chiedila alla banca', { segnaposto: '0' }) + '</section>';
    h += '<div id="ris-scenari">' + risultatiScenari() + '</div>';
    return h;
  }

  function schedaSalvati() {
    var l = elencoSalvati(), h = '';
    if (!haMemoria) h += '<div class="mancano">Il telefono non permette di salvare i dati in questa modalità (navigazione privata?). Il confronto non verrà conservato.</div>';
    h += '<section class="carta"><h2>Questo confronto</h2>' + campo('nome', 'Nome', 'Ad esempio «Mutuo casa – banche X e Y»', { testo: true }) +
      '<div class="azioni"><button class="principale" data-azione="salva">' + (stato.id ? 'Aggiorna il salvataggio' : 'Salva') + '</button>' +
      '<button data-azione="nuovo">Nuovo confronto</button></div></section>';
    h += '<h2>Confronti salvati</h2>';
    if (!l.length) h += '<p class="vuoto">Nessun confronto salvato.</p>';
    else h += '<ul class="elenco-salvati">' + l.map(function (c) {
      return '<li><div class="nome">' + esc(c.nome) + '</div><div class="data">' + esc(c.data) + '</div><div class="azioni">' +
        '<button class="piccolo" data-azione="apri" data-id="' + c.id + '">Apri</button>' +
        '<button class="piccolo" data-azione="duplica" data-id="' + c.id + '">Duplica</button>' +
        '<button class="piccolo pericolo" data-azione="elimina" data-id="' + c.id + '">Elimina</button></div></li>';
    }).join('') + '</ul>';
    h += '<p class="disclaimer">I confronti restano solo in questo telefono, nel browser. Se cancelli i dati del browser o disinstalli l\'app, si perdono.</p>';
    return h;
  }

  /* ---------- Testo di riepilogo ---------- */
  function testoRiepilogo() {
    var eA = elaboraProposta('A'), eB = elaboraProposta('B'), t = [stato.nome, ''];
    [eA, eB].forEach(function (e) {
      t.push(e.nome);
      if (e.mancanti.length) { t.push('  dati mancanti: ' + e.mancanti.join(', ')); }
      else {
        t.push('  rata ' + eur(e.r.rataIniziale) + ', durata ' + e.r.durataEffettiva + ' mesi');
        t.push('  interessi ' + eur(e.r.interessiTotali) + ', spese e costi ' + eur(e.r.costiAccessori));
        t.push('  costo del credito ' + eur(e.r.costoDelCredito) + ', totale pagato ' + eur(e.r.totalePagato));
        t.push('  TAN ' + M.formattaPerc(e.r.tan, 3) + ', TAEG calcolato ' + (e.r.taeg === null ? 'n.d.' : M.formattaPerc(e.r.taeg, 3)));
      }
      t.push('');
    });
    if (!eA.mancanti.length && !eB.mancanti.length) {
      var sc = leggiNumero(stato.sconto);
      t.push(M.confronta(eA.r, eB.r, eA.nome, eB.nome, sc === null ? {} : { tassoSconto: sc }).testo);
      t.push('');
    }
    t.push('Calcolo indicativo: fanno fede i documenti della banca.');
    return t.join('\n');
  }
  function testoPiano(e) {
    var t = [e.nome + ' – piano di ammortamento', 'Mese\tRata\tCapitale\tInteressi\tCosti\tDebito residuo'];
    e.r.righe.forEach(function (r) {
      t.push([r.mese, r.rata, r.capitale + r.extra, r.interessi, r.costi + r.penale, r.debito].map(function (x) { return typeof x === 'number' ? M.formattaNumero(x) : x; }).join('\t'));
    });
    return t.join('\n');
  }
  function copiaTesto(testo, messaggio) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = testo; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(messaggio); } catch (e) { toast('Non riesco a copiare'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(testo).then(function () { toast(messaggio); }, fallback);
    else fallback();
  }
  var tTimer;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(tTimer); tTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- Disegno e eventi ---------- */
  var SCHEDE = { proposte: schedaProposte, risultati: schedaRisultati, piano: schedaPiano, scenari: schedaScenari, salvati: schedaSalvati };
  function disegna(vaInCima) {
    var main = document.getElementById('contenuto');
    var y = window.scrollY;
    main.innerHTML = SCHEDE[scheda]();
    document.querySelectorAll('.barra button').forEach(function (b) { b.classList.toggle('attiva', b.dataset.scheda === scheda); });
    document.getElementById('titolo-confronto').textContent = stato.nome || '';
    if (scheda === 'proposte') aggiornaMancanti();
    window.scrollTo(0, vaInCima ? 0 : y);
    salvaCorrente();
  }
  function vai(s) { scheda = s; disegna(true); }

  document.querySelector('.barra').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-scheda]'); if (b) vai(b.dataset.scheda);
  });

  function applica(el) {
    var path = el.dataset.path; if (!path) return false;
    imposta(stato, path, el.type === 'checkbox' ? el.checked : el.value);
    salvaCorrente();
    return true;
  }
  var main = document.getElementById('contenuto');
  main.addEventListener('input', function (ev) {
    var el = ev.target; if (!applica(el)) return;
    if (scheda === 'proposte') aggiornaMancanti();
    else if (scheda === 'scenari') document.getElementById('ris-scenari').innerHTML = risultatiScenari();
    else if (scheda === 'salvati') document.getElementById('titolo-confronto').textContent = stato.nome;
  });
  main.addEventListener('change', function (ev) {
    var el = ev.target; if (!applica(el)) return;
    if (el.dataset.rerender) disegna(false);
    else if (scheda === 'proposte') aggiornaMancanti();
    else if (scheda === 'risultati') disegna(false);
    else if (scheda === 'scenari') document.getElementById('ris-scenari').innerHTML = risultatiScenari();
  });
  main.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-azione]'); if (!b) return;
    var a = b.dataset.azione, k = b.dataset.k, i = Number(b.dataset.i);
    if (a === 'aggiungi-iniziale') { stato[k].iniziali.push({ descr: '', valore: '', unita: 'euro', finanziata: false }); disegna(false); }
    else if (a === 'aggiungi-ricorrente') { stato[k].ricorrenti.push({ descr: '', valore: '', unita: 'rata' }); disegna(false); }
    else if (a === 'togli-iniziale') { if (confirm('Togliere questa spesa?')) { stato[k].iniziali.splice(i, 1); disegna(false); } }
    else if (a === 'togli-ricorrente') { if (confirm('Togliere questo costo?')) { stato[k].ricorrenti.splice(i, 1); disegna(false); } }
    else if (a === 'esempio') { stato = datiEsempio(); disegna(true); toast('Esempio caricato: guarda «Risultati»'); }
    else if (a === 'piano-mensile') { stato.pianoMensile = !stato.pianoMensile; disegna(false); }
    else if (a === 'copia-piano') { var e = elaboraProposta(stato.pianoSel); if (!e.mancanti.length) copiaTesto(testoPiano(e), 'Piano copiato'); }
    else if (a === 'condividi') {
      var testo = testoRiepilogo();
      if (navigator.share) navigator.share({ title: stato.nome, text: testo }).catch(function () { /* annullato */ });
      else copiaTesto(testo, 'Riepilogo copiato negli appunti');
    }
    else if (a === 'salva') {
      var l = elencoSalvati(), nome = (stato.nome || '').trim() || 'Confronto senza nome', d = adesso();
      if (!stato.id) stato.id = nuovoId();
      var voce = { id: stato.id, nome: nome, data: d, stato: copia(stato) };
      var pos = l.findIndex(function (c) { return c.id === stato.id; });
      if (pos >= 0) l[pos] = voce; else l.unshift(voce);
      if (scriviSalvati(l)) { toast('Salvato'); disegna(false); } else toast('Non riesco a salvare: memoria piena o non disponibile');
    }
    else if (a === 'nuovo') {
      if (confirm('Iniziare un nuovo confronto? Quello attuale, se non l\'hai salvato, andrà perso.')) { stato = statoVuoto(); vai('proposte'); }
    }
    else if (a === 'apri' || a === 'duplica' || a === 'elimina') {
      var lista = elencoSalvati(), id = b.dataset.id, c = lista.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (a === 'apri') { stato = integra(copia(c.stato)); stato.id = c.id; vai('proposte'); }
      else if (a === 'duplica') {
        var n = copia(c); n.id = nuovoId(); n.nome = c.nome + ' (copia)'; n.stato.id = n.id; n.stato.nome = n.nome; n.data = adesso();
        lista.unshift(n); scriviSalvati(lista); toast('Duplicato'); disegna(false);
      } else if (confirm('Eliminare «' + c.nome + '»? Non si può annullare.')) {
        scriviSalvati(lista.filter(function (x) { return x.id !== id; }));
        if (stato.id === id) stato.id = null;
        disegna(false);
      }
    }
  });

  caricaCorrente();
  var daLink = location.hash.replace('#', '');
  if (SCHEDE[daLink]) scheda = daLink;
  if (location.search.indexOf('esempio') >= 0) { stato = datiEsempio(); }
  disegna(true);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* l'app funziona comunque */ });
  }
})();
