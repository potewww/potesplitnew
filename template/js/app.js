// ============================================================
// app.js — caricamento dati, rendering tabelle, form di gestione
// ============================================================

let STATE = { persone: [], spese: [], rimborsi: [], cene: [], config: {} };

const euro = v => (Math.round(v * 100) / 100).toFixed(2) + " €";
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

// ---------- VALIDAZIONE E SICUREZZA TESTI INSERITI DALL'UTENTE ----------
// Impedisce di salvare caratteri che romperebbero il rendering HTML della pagina
// (es. < > " ' inseriti in un nome che poi viene stampato dentro a tag/attributi).
// Usata su ogni campo testuale libero prima di scrivere su GitHub.
const REGEX_CARATTERI_VIETATI = /[<>"'`\\]/;
function nomeValido(str) {
  return typeof str === "string" && str.length > 0 && !REGEX_CARATTERI_VIETATI.test(str);
}
// Mostra un popup di errore e restituisce false se il testo contiene caratteri vietati;
// va chiamata su ogni input libero prima di procedere con il salvataggio.
function validaOAvvisa(str, nomeCampo) {
  if (!nomeValido(str)) {
    alert(`Il campo "${nomeCampo}" contiene un carattere non consentito (uno tra < > " ' \` \\ ). Rimuovilo e riprova: questi caratteri possono rompere il rendering del sito.`);
    return false;
  }
  return true;
}
// Difesa aggiuntiva: quando un testo viene inserito dentro innerHTML, questa funzione
// lo rende innocuo (usata come rete di sicurezza in più anche se l'inserimento è già validato).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Identificatore univoco usato per raggruppare più voci di spese.json che in realtà
// rappresentano UNA SOLA spesa con più persone che hanno anticipato i soldi: tutte le
// voci generate insieme condividono lo stesso gruppoId, così la UI le mostra/modifica/
// elimina come un'unica spesa.
function generaId() {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeScrollIntoView(elx) {
  try { if (elx && typeof elx.scrollIntoView === "function") elx.scrollIntoView({ behavior: "smooth", block: "center" }); }
  catch (e) { /* non bloccante: se il browser non supporta lo scroll animato, si ignora */ }
}

// Titolo "di base" di una spesa: rimuove il suffisso automatico " [NE]" usato per le
// spese non eque, così da poter confrontare i titoli a prescindere dal metodo di divisione.
function baseTitolo(desc) {
  return (desc || "").replace(/\s*\[NE\]\s*$/, "").trim();
}

// ---------- CARICAMENTO DATI (lettura statica, nessun bisogno di token) ----------
async function loadAllData() {
  const bust = "?t=" + Date.now();
  const [persone, spese, rimborsi, cene, config] = await Promise.all([
    fetch("data/persone.json" + bust).then(r => r.json()),
    fetch("data/spese.json" + bust).then(r => r.json()),
    fetch("data/rimborsi.json" + bust).then(r => r.json()),
    fetch("data/cene.json" + bust).then(r => r.json()),
    fetch("data/config.json" + bust).then(r => r.json())
  ]);
  STATE = { persone, spese, rimborsi, cene, config };
}

function ricalcola() {
  STATE.stato = calcolaStatoGlobale(STATE.persone, STATE.spese, STATE.rimborsi, STATE.cene);
}

// ---------- NOMI UNIVOCI TRA CENE E SPESE ----------
// Il titolo di una cena, di una spesa e di una spesa non equa condividono lo stesso
// "spazio dei nomi": non possono coincidere (a meno di maiuscole/spazi), altrimenti
// diventerebbe ambiguo capire a cosa ci si riferisce nel registro.
// escludi: { gruppoSpesaId, indiceCena } — usati in modifica, per non confrontare una
// voce con se stessa.
function titoloGiaUsato(titolo, escludi) {
  const base = baseTitolo(titolo).toLowerCase();
  if (!base) return false;
  const opts = escludi || {};
  const collSpesa = raggruppaSpese().some(g =>
    g.gruppoId !== opts.gruppoSpesaId && baseTitolo(g.descrizione).toLowerCase() === base);
  const collCena = STATE.cene.some((c, i) =>
    i !== opts.indiceCena && (c.titolo || "").toLowerCase() === base);
  return collSpesa || collCena;
}

// ---------- RENDER: SEZIONE PRINCIPALE ----------
// Mostra "Tutti" non solo quando l'array partecipanti è vuoto, ma anche quando elenca
// esplicitamente TUTTE le persone esistenti.
function formatPartecipanti(partecipanti) {
  if (!partecipanti || partecipanti.length === 0) return "Tutti";
  const set = new Set(partecipanti);
  const tuttiPresenti = STATE.persone.length > 0 && set.size === STATE.persone.length && STATE.persone.every(p => set.has(p));
  if (tuttiPresenti) return "Tutti";
  return [...partecipanti].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(", ");
}

function renderRegistroSpese() {
  const tbody = document.querySelector("#tbl-registro tbody");
  tbody.innerHTML = "";
  // Usa l'elenco calcolato (STATE.stato.spese), che include anche le voci [NE] generate
  // automaticamente da ogni cena — non il solo STATE.spese "grezzo" da spese.json.
  const tutte = STATE.stato.spese;
  const ordinate = [...tutte].sort((a, b) => {
    const an = a.nome.toLowerCase(), bn = b.nome.toLowerCase();
    if (an === bn) return a.descrizione.toLowerCase().localeCompare(b.descrizione.toLowerCase());
    return an.localeCompare(bn);
  });
  ordinate.forEach((s, i) => {
    const part = formatPartecipanti(s.partecipanti);
    const tr = el("tr", null, `<td>${i + 1}</td><td>${escapeHtml(s.nome)}</td><td>${escapeHtml(s.descrizione)}</td><td class="num">${euro(s.importo)}</td><td>${escapeHtml(part)}</td>`);
    tbody.appendChild(tr);
  });
}

function renderRimborsiEffettuati() {
  const tbody = document.querySelector("#tbl-rimborsi tbody");
  tbody.innerHTML = "";
  if (STATE.rimborsi.length === 0) {
    tbody.appendChild(el("tr", null, `<td colspan="4"><em>Nessun rimborso ancora effettuato.</em></td>`));
    return;
  }
  STATE.rimborsi.forEach((r, i) => {
    tbody.appendChild(el("tr", null, `<td>${i + 1}</td><td>${escapeHtml(r.da)}</td><td>${escapeHtml(r.a)}</td><td class="num">${euro(r.importo)}</td>`));
  });
}

function renderTotaliPersona() {
  const tbody = document.querySelector("#tbl-totali tbody");
  tbody.innerHTML = "";
  const { nomi, totaliPersona, spesaEffettiva, rimborsatoDA, rimborsatoA, saldi } = STATE.stato;
  nomi.forEach((nome, i) => {
    const saldo = saldi[nome];
    const cls = saldo < -0.005 ? "row-red" : saldo > 0.005 ? "row-green" : "row-gray";
    const tr = el("tr", cls, `<td>${i + 1}</td><td>${escapeHtml(nome)}</td><td class="num">${euro(totaliPersona[nome])}</td>
      <td class="num">${euro(spesaEffettiva[nome])}</td><td class="num">${euro(rimborsatoDA[nome])}</td>
      <td class="num">${euro(rimborsatoA[nome])}</td><td class="num"><strong>${euro(saldo)}</strong></td>`);
    tbody.appendChild(tr);
  });
}

function renderTransazioni() {
  const tbody = document.querySelector("#tbl-transazioni tbody");
  tbody.innerHTML = "";
  const trans = STATE.stato.transazioni;
  if (trans.length === 0) {
    tbody.appendChild(el("tr", null, `<td colspan="4"><em>Nessuna transazione necessaria!</em></td>`));
    return;
  }
  let colorIndex = 0, ultimoDA = "";
  trans.forEach((t, i) => {
    if (t.da !== ultimoDA) { ultimoDA = t.da; colorIndex++; }
    const cls = colorIndex % 2 === 0 ? "row-stripe" : "";
    tbody.appendChild(el("tr", cls, `<td>${i + 1}.</td><td>${escapeHtml(t.da)}</td><td>${escapeHtml(t.a)}</td><td class="num">${euro(t.importo)}</td>`));
  });
}

function renderTitolo() {
  const t = STATE.config.titolo;
  if (!t) return;
  document.title = t;
  const h1 = document.querySelector("#page-title");
  if (h1) h1.textContent = t; // textContent: già sicuro di suo, nessun rischio di HTML injection
  // Il titolo dell'evento (e i tag <title>/og:title/twitter:title statici in index.html, letti
  // dai crawler tipo WhatsApp) vengono gestiti da un'altra modalità (fuori da questa pagina);
  // qui ci limitiamo a tenere sincronizzati gli elementi già nel DOM con quanto salvato in
  // data/config.json, senza offrire un secondo punto di modifica.
  document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(m => m.setAttribute("content", t));
}

function renderHomeLink() {
  const btn = document.querySelector("#btn-home-link");
  if (!btn) return;
  if (CONFIG.homeUrl && CONFIG.homeUrl !== "URL-HOME-POTESPLIT") {
    btn.href = CONFIG.homeUrl;
  } else {
    btn.style.display = "none"; // non configurato: nascondi invece di puntare a un link rotto
  }
}

function renderCredenziali() {
  const box = document.querySelector("#credenziali-list");
  box.innerHTML = "";
  const elenco = STATE.config.credenziali || [];
  if (elenco.length === 0) {
    box.innerHTML = `<li><em>Nessuna credenziale di rimborso inserita.</em></li>`;
    return;
  }
  elenco.forEach(c => {
    let dettaglio;
    if (c.tipo === "iban") {
      dettaglio = `IBAN: <strong>${escapeHtml(c.iban)}</strong> — Intestatario: <strong>${escapeHtml(c.intestatario)}</strong>`;
    } else {
      dettaglio = `Link PayPal: <a href="${escapeHtml(c.paypal)}" target="_blank" rel="noopener">${escapeHtml(c.paypal)}</a>`;
    }
    box.appendChild(el("li", null, `<strong>${escapeHtml(c.nome)}</strong> — ${dettaglio}`));
  });
}

// ---------- MESSAGGIO SOLATA / CONTROSOLATA ----------
function messaggioEventoSolata(evento) {
  if (!evento) {
    return `<div class="evento-solata tipo-nessuna">Nessuna solata/controsolata: il totale anticipato coincide con il dovuto calcolato.</div>`;
  }
  if (evento.tipo === "solata") {
    return `<div class="evento-solata tipo-solata">💰 <strong>Solata applicata:</strong> è stato pagato ${euro(evento.importo)} in più rispetto al dovuto; l'importo corretto sarebbe stato <strong>${euro(evento.dovutoCorretto)}</strong>. Il surplus è stato ridistribuito equamente tra i partecipanti (colonna "Solata").</div>`;
  }
  return `<div class="evento-solata tipo-controsolata">📉 <strong>Controsolata applicata:</strong> è stato pagato ${euro(evento.importo)} in meno rispetto al dovuto; l'importo corretto sarebbe stato <strong>${euro(evento.dovutoCorretto)}</strong>. Il deficit è stato ridistribuito equamente tra i partecipanti (colonna "Controsolata").</div>`;
}

// ---------- RENDER: CENE ----------
function fmtVal(v, cat, sconti) {
  if (!v) return "";
  const s = applicaSconto(v, cat, sconti);
  if ((sconti[cat] || 0) > 0) {
    return `<span class="disc">${s.toFixed(2)}</span> <span class="orig">(${v.toFixed(2)})</span>`;
  }
  return s.toFixed(2);
}
function fmtCellCondivisa(vInd, vCond, cat, sconti) {
  const ind = vInd !== 0 ? fmtVal(vInd, cat, sconti) : "";
  const cond = vCond !== 0 ? fmtVal(vCond, cat, sconti) : "";
  if (ind && cond) return ind + " + " + cond;
  return ind || cond || "";
}

function renderCategoriaTabella(container, cena, categorie, header) {
  header = header || CAT_LABELS;
  const { quoteColonna } = calcolaQuoteComplete(cena);
  let html = `<div class="table-wrap"><table class="cena-table"><thead><tr><th>Persona</th>${categorie.map(c => `<th>${header[c] || c}</th>`).join("")}<th>Parziale</th></tr></thead><tbody>`;
  const totCol = {}, totColOrig = {};
  categorie.forEach(c => { totCol[c] = 0; totColOrig[c] = 0; });
  let totRiga = 0, totRigaOrig = 0;

  cena.persone.forEach(p => {
    const qc = quoteColonna[p.nome] || {};
    let rigaTot = 0, rigaTotOrig = 0;
    const celle = categorie.map(cat => {
      const vInd = p[cat] || 0, vCond = qc[cat] || 0;
      const sInd = applicaSconto(vInd, cat, cena.sconti), sCond = applicaSconto(vCond, cat, cena.sconti);
      rigaTot += sInd + sCond; rigaTotOrig += vInd + vCond;
      totCol[cat] += sInd + sCond; totColOrig[cat] += vInd + vCond;
      return `<td>${fmtCellCondivisa(vInd, vCond, cat, cena.sconti)}</td>`;
    });
    totRiga += rigaTot; totRigaOrig += rigaTotOrig;
    const hasSc = Math.abs(rigaTot - rigaTotOrig) > 0.001;
    const totStr = hasSc ? `<span class="disc">${rigaTot.toFixed(2)}</span> <span class="orig">(${rigaTotOrig.toFixed(2)})</span>` : rigaTot.toFixed(2);
    html += `<tr><td>${escapeHtml(p.nome)}</td>${celle.join("")}<td class="tot-cell">${totStr}</td></tr>`;
  });

  const cellsTot = categorie.map(cat => {
    if (totColOrig[cat] === 0) return `<td class="tot-cell"></td>`;
    const hasSc = Math.abs(totCol[cat] - totColOrig[cat]) > 0.001;
    return hasSc
      ? `<td class="tot-cell"><span class="disc">${totCol[cat].toFixed(2)}</span> <span class="orig">(${totColOrig[cat].toFixed(2)})</span></td>`
      : `<td class="tot-cell">${totCol[cat].toFixed(2)}</td>`;
  });
  const hasScTot = Math.abs(totRiga - totRigaOrig) > 0.001;
  const totFinale = hasScTot
    ? `<span class="disc">${totRiga.toFixed(2)}</span> <span class="orig">(${totRigaOrig.toFixed(2)})</span>`
    : totRiga.toFixed(2);
  html += `<tr class="tot-row"><td><strong>Totale</strong></td>${cellsTot.join("")}<td class="tot-cell"><strong>${totFinale}</strong></td></tr>`;
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function renderCondivise(container, cena) {
  const separate = (cena.speseCondivise || []).filter(s => !s.colonna);
  if (separate.length === 0) { container.innerHTML = "<p><em>Nessuna spesa condivisa separata.</em></p>"; return; }
  const { quoteSeparate } = calcolaQuoteCondivise(cena.persone, cena.speseCondivise, cena.sconti);
  let html = `<div class="table-wrap"><table class="cena-table"><thead><tr><th>Persona</th>${separate.map(s => `<th>${escapeHtml(s.descrizione)}</th>`).join("")}</tr></thead><tbody>`;
  cena.persone.forEach(p => {
    const qs = quoteSeparate[p.nome] || {};
    const cells = separate.map(s => `<td>${qs[s.descrizione] !== undefined ? qs[s.descrizione].toFixed(2) : ""}</td>`);
    html += `<tr><td>${escapeHtml(p.nome)}</td>${cells.join("")}</tr>`;
  });
  html += "</tbody></table></div>";
  container.innerHTML = html;
}

function renderTotaliECena(container, cena) {
  const d = calcolaDettaglioCena(cena);
  let html = `<div class="table-wrap"><table class="cena-table"><thead><tr><th>Persona</th><th>Dovuto</th><th>Pagato</th><th>Saldo pasto</th></tr></thead><tbody>`;
  d.righe.forEach(r => {
    const cls = r.saldo > 0.005 ? "row-green" : r.saldo < -0.005 ? "row-red" : "";
    html += `<tr class="${cls}"><td>${escapeHtml(r.nome)}</td><td class="num">${euro(r.dovuto)}</td><td class="num">${euro(r.pagato)}</td><td class="num">${euro(r.saldo)}</td></tr>`;
  });
  if (d.hasSconti) {
    html += `<tr class="tot-row"><td><strong>TOTALE (senza sconti)</strong></td><td class="num">${euro(d.totgenSenzaSconti)}</td><td class="num">${euro(d.totpagato)}</td><td class="num">${euro(d.totgenSenzaSconti - d.totpagato)}</td></tr>`;
    html += `<tr class="tot-row"><td><strong>TOTALE (con sconti)</strong></td><td class="num">${euro(d.totgen)}</td><td class="num">${euro(d.totpagato)}</td><td class="num">${euro(d.totpagato - d.totgen)}</td></tr>`;
  } else {
    html += `<tr class="tot-row"><td><strong>TOTALE GENERALE</strong></td><td class="num">${euro(d.totgen)}</td><td class="num">${euro(d.totpagato)}</td><td class="num">${euro(d.totpagato - d.totgen)}</td></tr>`;
  }
  html += "</tbody></table></div>";

  html += messaggioEventoSolata(d.eventoSolata);

  html += `<h5>Rimborsi consigliati per pareggiare i conti di questa cena</h5>`;
  if (d.transazioniCena.length === 0) {
    html += "<p><em>Nessun rimborso necessario</em></p>";
  } else {
    html += `<div class="table-wrap"><table class="cena-table"><thead><tr><th>Da</th><th>A</th><th>Importo</th></tr></thead><tbody>`;
    d.transazioniCena.forEach(t => html += `<tr><td>${escapeHtml(t.da)}</td><td>${escapeHtml(t.a)}</td><td class="num">${euro(t.importo)}</td></tr>`);
    html += "</tbody></table></div>";
  }
  container.innerHTML = html;
}

function renderCene() {
  const container = document.querySelector("#cene-container");
  container.innerHTML = "";
  if (STATE.cene.length === 0) { container.innerHTML = `<p class="empty-note">Nessuna cena inserita.</p>`; return; }
  STATE.cene.forEach((cena, idx) => {
    const hasSconti = Object.values(cena.sconti).some(v => v > 0);
    const wrap = el("details", "cena-block");
    wrap.innerHTML = `<summary>${escapeHtml(cena.titolo)}</summary>
      <div class="cena-body">
        ${hasSconti ? `<p class="sconti-info"><strong>Sconti applicati:</strong> ${Object.entries(cena.sconti).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}%`).join(", ")}</p>` : `<p class="sconti-info"><em>Nessuno sconto applicato</em></p>`}
        <h5>Cibo</h5><div class="tbl-cibo"></div>
        <h5>Bevande</h5><div class="tbl-bevande"></div>
        <h5>Altro</h5><div class="tbl-altro"></div>
        <h5>Spese condivise</h5><div class="tbl-condivise"></div>
        <h5>Totali per persona</h5><div class="tbl-totali-cena"></div>
      </div>`;
    container.appendChild(wrap);
    renderCategoriaTabella(wrap.querySelector(".tbl-cibo"), cena, CAT_CIBO);
    renderCategoriaTabella(wrap.querySelector(".tbl-bevande"), cena, CAT_BEVANDE);
    renderCategoriaTabella(wrap.querySelector(".tbl-altro"), cena, CAT_ALTRO);
    renderCondivise(wrap.querySelector(".tbl-condivise"), cena);
    renderTotaliECena(wrap.querySelector(".tbl-totali-cena"), cena);
  });
}

// Raggruppa STATE.stato.dettaglioSpese per gruppoId, escludendo le voci generate dalle
// cene (che hanno già la loro sezione dedicata sopra) e restituisce, per ciascun gruppo,
// chi ha anticipato quanto, i partecipanti e (se non equa) le quote inserite manualmente.
function raggruppaDettaglioSpeseGenerali() {
  const gruppi = [];
  const mappa = {};
  (STATE.stato.dettaglioSpese || []).forEach((s, i) => {
    if (s.gruppoId && s.gruppoId.startsWith("__cena_")) return;
    const gid = s.gruppoId || `__voce_singola_${i}`;
    if (!mappa[gid]) {
      const g = { gruppoId: gid, descrizione: s.descrizione, isNE: !!s.quote, pagatori: [], partecipanti: s.partecipanti || [] };
      mappa[gid] = g;
      gruppi.push(g);
    }
    mappa[gid].pagatori.push({ nome: s.nome, importo: s.importo });
  });
  return gruppi;
}

// Tabella unica di riepilogo per una singola spesa (equa o non equa): Partecipanti |
// Ha pagato | Ha speso | Centesimini | Solata | Controsolata | Saldo, più i rimborsi
// consigliati per pareggiare solo quella spesa, ed eventuale messaggio di solata/controsolata.
// IMPORTANTE: per le spese non eque riusa lo STESSO riepilogo già calcolato una volta in
// calcolaStatoGlobale (STATE.stato.riepilogoGruppi), invece di richiamare di nuovo
// calcolaRiepilogoGruppoSpesa da zero: altrimenti questa tabella potrebbe mostrare numeri
// diversi da quelli usati per "Totali per persona" e "Transazioni da effettuare" nel Riepilogo.
function renderRiepilogoGruppoSpesa(container, g) {
  const r = (g.isNE && STATE.stato.riepilogoGruppi && STATE.stato.riepilogoGruppi[g.gruppoId])
    ? STATE.stato.riepilogoGruppi[g.gruppoId]
    : calcolaRiepilogoGruppoSpesa(g);
  let html = `<div class="table-wrap"><table class="cena-table"><thead><tr>
    <th>Partecipanti</th><th class="num">Ha pagato</th><th class="num">Ha speso</th>
    <th class="num">Centesimini</th><th class="num">Solata</th><th class="num">Controsolata</th><th class="num">Saldo</th>
    </tr></thead><tbody>`;
  r.partecipanti.forEach(nome => {
    const saldo = r.saldi[nome] || 0;
    const cls = saldo > 0.005 ? "row-green" : saldo < -0.005 ? "row-red" : "";
    const centStr = formatEspressioneContributi(r.centesiminiDettaglio[nome]) || (r.centesimini[nome] ? r.centesimini[nome].toFixed(2) : "");
    html += `<tr class="${cls}"><td>${escapeHtml(nome)}</td>
      <td class="num">${r.pagato[nome] ? euro(r.pagato[nome]) : ""}</td>
      <td class="num">${euro(r.dovutoFinale[nome] || 0)}</td>
      <td class="num">${centStr}</td>
      <td class="num">${r.solata[nome] ? euro(r.solata[nome]) : ""}</td>
      <td class="num">${r.controsolata[nome] ? euro(r.controsolata[nome]) : ""}</td>
      <td class="num"><strong>${euro(saldo)}</strong></td></tr>`;
  });
  const totCentesimini = r.partecipanti.reduce((a, n) => a + (r.centesimini[n] || 0), 0);
  const totSolata = r.partecipanti.reduce((a, n) => a + (r.solata[n] || 0), 0);
  const totControsolata = r.partecipanti.reduce((a, n) => a + (r.controsolata[n] || 0), 0);
  html += `<tr class="tot-row"><td><strong>Totale</strong></td><td class="num">${euro(r.totali.pagato)}</td><td class="num">${euro(r.totali.dovuto)}</td>
    <td class="num">${totCentesimini ? euro(totCentesimini) : ""}</td>
    <td class="num">${totSolata ? euro(totSolata) : ""}</td>
    <td class="num">${totControsolata ? euro(totControsolata) : ""}</td>
    <td class="num">${euro(r.totali.pagato - r.totali.dovuto)}</td></tr>`;
  html += `</tbody></table></div>`;

  html += messaggioEventoSolata(r.eventoSolata);

  html += `<h5>Rimborsi consigliati per pareggiare i conti di questa spesa</h5>`;
  if (r.transazioni.length === 0) {
    html += "<p><em>Nessun rimborso necessario</em></p>";
  } else {
    html += `<div class="table-wrap"><table class="cena-table"><thead><tr><th>Da</th><th>A</th><th>Importo</th></tr></thead><tbody>`;
    r.transazioni.forEach(t => html += `<tr><td>${escapeHtml(t.da)}</td><td>${escapeHtml(t.a)}</td><td class="num">${euro(t.importo)}</td></tr>`);
    html += "</tbody></table></div>";
  }
  container.innerHTML = html;
}

function renderSpeseDettaglio() {
  const container = document.querySelector("#spese-dettaglio-container");
  if (!container) return;
  container.innerHTML = "";
  const gruppi = raggruppaDettaglioSpeseGenerali();
  if (gruppi.length === 0) { container.innerHTML = `<p class="empty-note">Nessuna altra spesa inserita.</p>`; return; }
  gruppi.forEach(g => {
    const totalePagato = g.pagatori.reduce((a, p) => a + p.importo, 0);
    const wrap = el("details", "cena-block");
    wrap.innerHTML = `<summary>${escapeHtml(baseTitolo(g.descrizione))} — ${euro(totalePagato)}${g.isNE ? " [NE]" : " (divisa in parti uguali)"}</summary>
      <div class="cena-body">
        <div class="tbl-riepilogo-spesa"></div>
      </div>`;
    container.appendChild(wrap);
    renderRiepilogoGruppoSpesa(wrap.querySelector(".tbl-riepilogo-spesa"), g);
  });
}

// ---------- RENDER TUTTO ----------
function renderAll() {
  ricalcola();
  renderTitolo();
  renderRegistroSpese();
  renderRimborsiEffettuati();
  renderTotaliPersona();
  renderTransazioni();
  renderCredenziali();
  renderCene();
  renderSpeseDettaglio();
  populateFormSelects();
  refreshSpesaPartecipantiCheckboxes();
  refreshSpesaPagatoriCheckboxes();
  refreshCenaPersoneCheckboxes();
  refreshCenaPagatoriCheckboxes();
  renderListaPersone();
  renderListaSpese();
  renderListaRimborsi();
  renderListaCene();
  renderListaCredenziali();
}

// ============================================================
// GESTIONE (form -> GitHub API)
// ============================================================

function populateFormSelects() {
  const persone = [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const selects = document.querySelectorAll("select.persona-select");
  selects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = persone.map(p => `<option value="${p}">${p}</option>`).join("");
    if (current) sel.value = current;
  });
  const checkboxContainers = document.querySelectorAll(".persona-checkboxes");
  checkboxContainers.forEach(box => {
    const checked = new Set(getCheckedValues(box)); // preserva selezioni già fatte
    box.innerHTML = persone.map(p =>
      `<label class="chk"><input type="checkbox" value="${p}" ${checked.has(p) ? "checked" : ""}> ${p}</label>`).join("");
  });
}

function showToast(msg, isError) {
  let box = document.querySelector("#toast-box");
  if (!box) {
    box = el("div", "toast-box");
    box.id = "toast-box";
    document.body.appendChild(box);
  }
  const toast = el("div", "toast " + (isError ? "toast-error" : "toast-ok"), msg);
  box.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, isError ? 6000 : 3500);
}

function setStatus(elId, msg, isError) {
  const box = document.querySelector(elId);
  box.textContent = msg;
  box.className = "status " + (isError ? "status-error" : "status-ok");
  showToast(msg, isError);
}

function getCheckedValues(container) {
  return Array.from(container.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
}

// ---------- STATO DI MODIFICA (edit in corso) ----------
let editingSpesaGruppoId = null;
let editingRimborsoIndex = null;
let editingCenaIndex = null;
let editingCredenzialeIndex = null;

// ---------- ELENCHI MODIFICABILI ----------
// Conta in quante spese (raggruppate), rimborsi e cene compare una persona: usato per
// avvisare l'utente prima di una cancellazione, che è "a cascata" (vedi più sotto).
function impattoEliminazionePersona(nome) {
  const gruppiSpeseCoinvolti = new Set();
  STATE.spese.forEach((s, i) => {
    const coinvolge = s.nome === nome
      || (s.partecipanti && s.partecipanti.includes(nome))
      || (s.quote && Object.prototype.hasOwnProperty.call(s.quote, nome));
    if (coinvolge) gruppiSpeseCoinvolti.add(s.gruppoId || `__idx_${i}`);
  });
  const rimborsi = STATE.rimborsi.filter(r => r.da === nome || r.a === nome).length;
  const cene = STATE.cene.filter(c => c.persone.some(p => p.nome === nome)).length;
  return { spese: gruppiSpeseCoinvolti.size, rimborsi, cene };
}

// Rimuove una persona e, A CASCATA, tutte le spese (intere, non solo la sua quota),
// i rimborsi e le cene in cui compare: lasciare quei dati "a metà" (con un partecipante
// fantasma) renderebbe i conteggi sbagliati per tutti gli altri, quindi si eliminano
// interamente le voci coinvolte invece di provare a "correggerle" automaticamente.
function rimuoviPersonaACascata(nome) {
  const nuovePersone = STATE.persone.filter(p => p !== nome);

  const gruppiDaRimuovere = new Set();
  STATE.spese.forEach((s, i) => {
    const coinvolge = s.nome === nome
      || (s.partecipanti && s.partecipanti.includes(nome))
      || (s.quote && Object.prototype.hasOwnProperty.call(s.quote, nome));
    if (coinvolge) gruppiDaRimuovere.add(s.gruppoId || `__idx_${i}`);
  });
  const nuoveSpese = STATE.spese.filter((s, i) => !gruppiDaRimuovere.has(s.gruppoId || `__idx_${i}`));

  const nuoviRimborsi = STATE.rimborsi.filter(r => r.da !== nome && r.a !== nome);

  const nuoveCene = STATE.cene.filter(c => !c.persone.some(p => p.nome === nome));

  return { nuovePersone, nuoveSpese, nuoviRimborsi, nuoveCene };
}

function renderListaPersone() {
  const box = document.querySelector("#lista-persone");
  box.innerHTML = "";
  if (STATE.persone.length === 0) { box.innerHTML = `<div class="empty-note">Nessuna persona inserita.</div>`; return; }
  [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(nome => {
    const row = el("div", "list-row");
    row.innerHTML = `
      <div class="rename-box">
        <input type="text" class="rename-input" value="${escapeHtml(nome)}">
      </div>
      <div class="list-actions">
        <button class="btn-icon edit" type="button">Rinomina</button>
        <button class="btn-icon delete" type="button">Elimina</button>
      </div>`;
    const input = row.querySelector(".rename-input");
    row.querySelector(".edit").addEventListener("click", async () => {
      const nuovo = input.value.trim();
      if (!nuovo || nuovo === nome) return;
      if (!validaOAvvisa(nuovo, "Nome persona")) return;
      if (STATE.persone.includes(nuovo)) { alert("Esiste già una persona con questo nome."); return; }
      if (!confirm(`Rinominare "${nome}" in "${nuovo}"? Verranno aggiornati anche i riferimenti in spese, rimborsi e cene.`)) return;
      await rinominaPersona(nome, nuovo);
    });
    row.querySelector(".delete").addEventListener("click", async () => {
      const imp = impattoEliminazionePersona(nome);
      const dettagli = [];
      if (imp.spese > 0) dettagli.push(`${imp.spese} spesa/e`);
      if (imp.rimborsi > 0) dettagli.push(`${imp.rimborsi} rimborso/i`);
      if (imp.cene > 0) dettagli.push(`${imp.cene} cena/e`);
      const msg = dettagli.length > 0
        ? `Eliminare "${nome}"?\n\nVerranno eliminate ANCHE tutte le voci in cui compare: ${dettagli.join(", ")}. Non solo la sua quota: l'intera spesa/rimborso/cena, per non lasciare i conti sbagliati per gli altri. Questa azione non si può annullare. Procedere?`
        : `Eliminare "${nome}"?`;
      if (!confirm(msg)) return;
      try {
        const { nuovePersone, nuoveSpese, nuoviRimborsi, nuoveCene } = rimuoviPersonaACascata(nome);
        await GH.writeJSON("data/persone.json", nuovePersone, `Rimuove persona: ${nome}`);
        await GH.writeJSON("data/spese.json", nuoveSpese, `Rimuove spese/rimborsi/cene legate a: ${nome}`);
        await GH.writeJSON("data/rimborsi.json", nuoviRimborsi, `Rimuove rimborsi legati a: ${nome}`);
        await GH.writeJSON("data/cene.json", nuoveCene, `Rimuove cene legate a: ${nome}`);
        await loadAllData(); renderAll();
      } catch (err) { alert(err.message); }
    });
    box.appendChild(row);
  });
}

async function rinominaPersona(vecchio, nuovo) {
  try {
    const nuovePersone = STATE.persone.map(p => p === vecchio ? nuovo : p);
    const nuoveSpese = STATE.spese.map(s => {
      const nuova = {
        ...s,
        nome: s.nome === vecchio ? nuovo : s.nome,
        partecipanti: (s.partecipanti || []).map(p => p === vecchio ? nuovo : p)
      };
      if (s.quote && Object.prototype.hasOwnProperty.call(s.quote, vecchio)) {
        const nuoveQuote = { ...s.quote };
        nuoveQuote[nuovo] = nuoveQuote[vecchio];
        delete nuoveQuote[vecchio];
        nuova.quote = nuoveQuote;
      }
      return nuova;
    });
    const nuoviRimborsi = STATE.rimborsi.map(r => ({
      ...r,
      da: r.da === vecchio ? nuovo : r.da,
      a: r.a === vecchio ? nuovo : r.a
    }));
    const nuoveCene = STATE.cene.map(c => ({
      ...c,
      persone: c.persone.map(p => p.nome === vecchio ? { ...p, nome: nuovo } : p),
      speseCondivise: (c.speseCondivise || []).map(s => ({
        ...s,
        partecipanti: (s.partecipanti || []).map(p => p === vecchio ? nuovo : p)
      }))
    }));

    await GH.writeJSON("data/persone.json", nuovePersone, `Rinomina persona: ${vecchio} -> ${nuovo}`);
    await GH.writeJSON("data/spese.json", nuoveSpese, `Aggiorna riferimenti a ${vecchio} in spese`);
    await GH.writeJSON("data/rimborsi.json", nuoviRimborsi, `Aggiorna riferimenti a ${vecchio} in rimborsi`);
    await GH.writeJSON("data/cene.json", nuoveCene, `Aggiorna riferimenti a ${vecchio} in cene`);
    await loadAllData(); renderAll();
  } catch (err) { alert(err.message); }
}

// Raggruppa le voci di STATE.spese che rappresentano UNA SOLA spesa (stesso gruppoId):
// serve solo per la UI di "Gestisci dati" (una riga sola, modifica/elimina come gruppo).
// Il registro spese del Riepilogo, invece, continua a mostrare una riga per pagatore.
function raggruppaSpese() {
  const gruppi = [];
  const mappa = {};
  STATE.spese.forEach((s, i) => {
    const gid = s.gruppoId || `__idx_${i}`;
    if (!mappa[gid]) {
      const g = { gruppoId: gid, voci: [], isNE: !!s.quote, descrizione: s.descrizione, partecipanti: s.partecipanti || [], quote: s.quote || null };
      mappa[gid] = g;
      gruppi.push(g);
    }
    mappa[gid].voci.push(s);
  });
  gruppi.forEach(g => { g.totale = g.voci.reduce((a, s) => a + s.importo, 0); });
  return gruppi;
}

function renderListaSpese() {
  const box = document.querySelector("#lista-spese");
  box.innerHTML = "";
  const gruppi = raggruppaSpese();
  if (gruppi.length === 0) { box.innerHTML = `<div class="empty-note">Nessuna spesa inserita.</div>`; return; }
  gruppi.forEach(g => {
    const chiPaga = g.voci.map(s => `${escapeHtml(s.nome)} (${euro(s.importo)})`).join(", ");
    const part = formatPartecipanti(g.partecipanti);
    const isEditing = editingSpesaGruppoId === g.gruppoId;
    const row = el("div", "list-row" + (isEditing ? " editing" : ""));
    row.innerHTML = `
      <div class="list-main">${chiPaga} — ${escapeHtml(baseTitolo(g.descrizione))}${g.isNE ? " [NE]" : ""} <strong>${euro(g.totale)}</strong><br><span class="list-sub">Partecipanti: ${escapeHtml(part)}</span></div>
      <div class="list-actions">
        <button class="btn-icon edit" type="button">Modifica</button>
        <button class="btn-icon delete" type="button">Elimina</button>
      </div>`;
    row.querySelector(".edit").addEventListener("click", () => modificaSpesa(g.gruppoId));
    row.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Eliminare la spesa "${baseTitolo(g.descrizione)}" (${euro(g.totale)})?`)) return;
      try {
        const nuovoElenco = STATE.spese.filter((s, i) => (s.gruppoId || `__idx_${i}`) !== g.gruppoId);
        await GH.writeJSON("data/spese.json", nuovoElenco, `Rimuove spesa: ${g.descrizione}`);
        await loadAllData(); renderAll();
      } catch (err) { alert(err.message); }
    });
    box.appendChild(row);
  });
}

function renderListaRimborsi() {
  const box = document.querySelector("#lista-rimborsi");
  box.innerHTML = "";
  if (STATE.rimborsi.length === 0) { box.innerHTML = `<div class="empty-note">Nessun rimborso inserito.</div>`; return; }
  STATE.rimborsi.forEach((r, i) => {
    const row = el("div", "list-row" + (editingRimborsoIndex === i ? " editing" : ""));
    row.innerHTML = `
      <div class="list-main">${escapeHtml(r.da)} → ${escapeHtml(r.a)}: <strong>${euro(r.importo)}</strong></div>
      <div class="list-actions">
        <button class="btn-icon edit" type="button">Modifica</button>
        <button class="btn-icon delete" type="button">Elimina</button>
      </div>`;
    row.querySelector(".edit").addEventListener("click", () => modificaRimborso(i));
    row.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Eliminare il rimborso ${r.da} → ${r.a} (${euro(r.importo)})?`)) return;
      try {
        const nuovoElenco = STATE.rimborsi.filter((_, idx) => idx !== i);
        await GH.writeJSON("data/rimborsi.json", nuovoElenco, `Rimuove rimborso: ${r.da} -> ${r.a}`);
        await loadAllData(); renderAll();
      } catch (err) { alert(err.message); }
    });
    box.appendChild(row);
  });
}

function modificaRimborso(i) {
  const r = STATE.rimborsi[i];
  editingRimborsoIndex = i;
  document.querySelector("#sec-rimborso").classList.remove("collapsed");
  document.querySelector("#f-rimb-da").value = r.da;
  document.querySelector("#f-rimb-a").value = r.a;
  document.querySelector("#f-rimb-importo").value = r.importo;
  document.querySelector("#btn-rimborso-submit").textContent = "Salva modifiche";
  document.querySelector("#btn-rimborso-annulla").style.display = "inline-block";
  safeScrollIntoView(document.querySelector("#f-rimborso-form"));
  renderListaRimborsi();
}

function annullaModificaRimborso() {
  editingRimborsoIndex = null;
  document.querySelector("#f-rimborso-form").reset();
  document.querySelector("#btn-rimborso-submit").textContent = "Aggiungi rimborso";
  document.querySelector("#btn-rimborso-annulla").style.display = "none";
  renderListaRimborsi();
}

function renderListaCene() {
  const box = document.querySelector("#lista-cene");
  box.innerHTML = "";
  if (STATE.cene.length === 0) { box.innerHTML = `<div class="empty-note">Nessuna cena inserita.</div>`; return; }
  STATE.cene.forEach((c, i) => {
    const row = el("div", "list-row" + (editingCenaIndex === i ? " editing" : ""));
    row.innerHTML = `
      <div class="list-main">${escapeHtml(c.titolo)} <span class="list-sub">(${c.persone.length} persone)</span></div>
      <div class="list-actions">
        <button class="btn-icon edit" type="button">Modifica</button>
        <button class="btn-icon delete" type="button">Elimina</button>
      </div>`;
    row.querySelector(".edit").addEventListener("click", () => modificaCena(i));
    row.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Eliminare la cena "${c.titolo}"? Verranno rimosse anche le relative voci [NE] dal registro spese generale.`)) return;
      try {
        const nuovoElenco = STATE.cene.filter((_, idx) => idx !== i);
        await GH.writeJSON("data/cene.json", nuovoElenco, `Rimuove cena: ${c.titolo}`);
        await loadAllData(); renderAll();
      } catch (err) { alert(err.message); }
    });
    box.appendChild(row);
  });
}

function modificaCena(i) {
  const c = STATE.cene[i];
  editingCenaIndex = i;
  document.querySelector("#sec-cena").classList.remove("collapsed");
  document.querySelector("#f-cena-titolo").value = c.titolo;

  cenaPersoneDati = {};
  c.persone.forEach(p => {
    const dati = {};
    CAT_INPUT.forEach(cat => dati[cat] = p[cat] || 0);
    cenaPersoneDati[p.nome] = dati;
  });
  setCenaPersoneSelezionate(c.persone.map(p => p.nome));
  const dettagli = document.querySelector("#cena-persone-details");
  if (dettagli) dettagli.classList.remove("collapsed");

  cenaPagatoDati = {};
  (c.pagatori || []).forEach(p => { cenaPagatoDati[p.nome] = p.importo; });
  setCenaPagatoriSelezionati((c.pagatori || []).map(p => p.nome));

  CAT_INPUT.forEach(cat => {
    const inp = document.querySelector(`#f-sconto-${cat}`);
    if (inp) inp.value = (c.sconti && c.sconti[cat]) || 0;
  });

  document.querySelector("#cena-spese-rows").innerHTML = "";
  cenaSpeseRows = [];
  (c.speseCondivise || []).forEach(s => addCenaSpesaRow(s));

  document.querySelector("#btn-cena-submit").textContent = "Salva modifiche";
  document.querySelector("#btn-cena-annulla").style.display = "inline-block";
  safeScrollIntoView(document.querySelector("#f-cena-form"));
  renderListaCene();
}

function annullaModificaCena() {
  editingCenaIndex = null;
  document.querySelector("#f-cena-form").reset();
  cenaPersoneDati = {};
  document.querySelectorAll("#cena-persone-checkboxes input[type=checkbox]").forEach(cb => cb.checked = true);
  renderCenaPersoneRows();
  const dettagli = document.querySelector("#cena-persone-details");
  if (dettagli) dettagli.classList.add("collapsed");
  document.querySelector("#cena-spese-rows").innerHTML = "";
  cenaSpeseRows = [];
  cenaPagatoDati = {};
  setCenaPagatoriSelezionati([]); // nessun pagatore spuntato di default
  document.querySelector("#btn-cena-submit").textContent = "Salva cena";
  document.querySelector("#btn-cena-annulla").style.display = "none";
  renderListaCene();
}

// --- Aggiungi persona/e ---
function buildPersonaNomiInputs(n) {
  const box = document.querySelector("#f-persona-nomi-container");
  const existing = Array.from(box.querySelectorAll("input.f-persona-nome-input")).map(i => i.value);
  box.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "f-persona-nome-input";
    inp.placeholder = "Es. Mario Rossi";
    inp.required = true;
    if (existing[i]) inp.value = existing[i];
    box.appendChild(inp);
  }
}

async function submitPersona(e) {
  e.preventDefault();
  const nomi = Array.from(document.querySelectorAll("#f-persona-nomi-container .f-persona-nome-input"))
    .map(i => i.value.trim())
    .filter(v => v);
  if (nomi.length === 0) { setStatus("#status-persona", "Inserisci almeno un nome.", true); return; }
  for (const n of nomi) { if (!validaOAvvisa(n, "Nome e cognome")) return; }

  const setNomiLower = new Set(nomi.map(n => n.toLowerCase()));
  if (setNomiLower.size !== nomi.length) { setStatus("#status-persona", "Hai inserito lo stesso nome più di una volta.", true); return; }

  const giaEsistenti = nomi.filter(n => STATE.persone.includes(n));
  if (giaEsistenti.length > 0) { setStatus("#status-persona", `Esistono già: ${giaEsistenti.join(", ")}.`, true); return; }

  try {
    const nuovoElenco = [...STATE.persone, ...nomi];
    const msg = nomi.length > 1 ? `Aggiunge ${nomi.length} persone: ${nomi.join(", ")}` : `Aggiunge persona: ${nomi[0]}`;
    await GH.writeJSON("data/persone.json", nuovoElenco, msg);
    setStatus("#status-persona", (nomi.length > 1 ? "Persone aggiunte!" : "Persona aggiunta!") + " Ricarico i dati…", false);
    document.querySelector("#f-persona-quante").value = "1";
    buildPersonaNomiInputs(1);
    await loadAllData(); renderAll();
  } catch (err) { setStatus("#status-persona", err.message, true); }
}

// ============================================================
// AGGIUNGI SPESA (unificata: equa o non equa)
// ============================================================
// Componente riusato due volte in questo form:
//  1) i PARTECIPANTI alla spesa: checkbox-list, tutte spuntate di default;
//  2) CHI HA ANTICIPATO i soldi: stessa identica checkbox-list, ma NON spuntata di
//     default; per ciascuna persona spuntata compare poi una riga con l'importo pagato.
// Lo stesso pattern (checkbox-list -> righe dinamiche per i soli spuntati, con cache dei
// valori già inseriti) è usato anche per le QUOTE nel caso di divisione non equa.

let spesaPartecipantiKnownNames = new Set();
let spesaPagatoriKnownNames = new Set();
let spesaQuoteDati = {};   // nome -> quota (usato solo in modalità non equa)
let spesaPagatoDati = {};  // nome -> importo pagato

function catturaSpesaQuoteDati() {
  document.querySelectorAll("#f-spesa-quote-righe .spesa-ne-row").forEach(row => {
    const nome = row.dataset.nome;
    if (!nome) return;
    const v = parseFloat(row.querySelector(".sne-quota").value);
    spesaQuoteDati[nome] = isNaN(v) ? 0 : v;
  });
}

function catturaSpesaPagatoDati() {
  document.querySelectorAll("#f-spesa-pagatori-righe .spesa-ne-row").forEach(row => {
    const nome = row.dataset.nome;
    if (!nome) return;
    const v = parseFloat(row.querySelector(".pag-importo").value);
    spesaPagatoDati[nome] = isNaN(v) ? 0 : v;
  });
}

function spesaModoAttuale() {
  const r = document.querySelector('input[name="f-spesa-modo"]:checked');
  return r ? r.value : "equa";
}

function aggiornaVisibilitaModoSpesa() {
  const box = document.querySelector("#f-spesa-quote-box");
  if (box) box.style.display = spesaModoAttuale() === "nonequa" ? "" : "none";
}

// Righe "quota dovuta" per i soli partecipanti attualmente spuntati (solo modalità non equa)
function renderSpesaQuoteRighe() {
  const box = document.querySelector("#f-spesa-quote-righe");
  if (!box) return;
  box.innerHTML = "";
  const checkboxBox = document.querySelector("#f-spesa-partecipanti");
  const checked = checkboxBox ? getCheckedValues(checkboxBox).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : [];
  checked.forEach(nome => {
    const row = el("div", "spesa-ne-row");
    row.dataset.nome = nome;
    const valore = spesaQuoteDati[nome] !== undefined ? spesaQuoteDati[nome] : "";
    row.innerHTML = `
      <div class="cp-persona-titolo" style="margin:0;">${escapeHtml(nome)}</div>
      <input type="number" step="0.01" min="0" class="sne-quota" placeholder="Quota €" value="${valore}">
      <span></span>`;
    row.querySelector(".sne-quota").addEventListener("input", () => { catturaSpesaQuoteDati(); aggiornaTotaliSpesaForm(); });
    box.appendChild(row);
  });
  aggiornaTotaliSpesaForm();
}

function onSpesaPartecipantiChange() {
  catturaSpesaQuoteDati();
  renderSpesaQuoteRighe();
}

// Checkbox-list dei partecipanti alla spesa: le persone nuove vengono spuntate di
// default (come richiesto), chi era già presente mantiene lo stato di spunta attuale.
function refreshSpesaPartecipantiCheckboxes() {
  const box = document.querySelector("#f-spesa-partecipanti");
  if (!box) return;
  catturaSpesaQuoteDati();
  const attuali = new Set(getCheckedValues(box));
  const ordinati = [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  box.innerHTML = ordinati.map(p => {
    const spuntata = spesaPartecipantiKnownNames.has(p) ? attuali.has(p) : true;
    return `<label class="chk"><input type="checkbox" value="${escapeHtml(p)}" ${spuntata ? "checked" : ""}> ${escapeHtml(p)}</label>`;
  }).join("");
  spesaPartecipantiKnownNames = new Set(ordinati);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", onSpesaPartecipantiChange));
  renderSpesaQuoteRighe();
}

function setSpesaPartecipantiSelezionati(nomi) {
  const box = document.querySelector("#f-spesa-partecipanti");
  if (!box) return;
  const set = new Set(nomi);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = set.has(cb.value); });
  renderSpesaQuoteRighe();
}

// Righe "importo pagato" per i soli pagatori attualmente spuntati
function renderSpesaPagatoriRighe() {
  const box = document.querySelector("#f-spesa-pagatori-righe");
  if (!box) return;
  box.innerHTML = "";
  const checkboxBox = document.querySelector("#f-spesa-pagatori-check");
  const checked = checkboxBox ? getCheckedValues(checkboxBox).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : [];
  checked.forEach(nome => {
    const row = el("div", "spesa-ne-row");
    row.dataset.nome = nome;
    const valore = spesaPagatoDati[nome] !== undefined ? spesaPagatoDati[nome] : "";
    row.innerHTML = `
      <div class="cp-persona-titolo" style="margin:0;">${escapeHtml(nome)}</div>
      <input type="number" step="0.01" min="0" class="pag-importo" placeholder="Importo pagato €" value="${valore}">
      <span></span>`;
    row.querySelector(".pag-importo").addEventListener("input", () => { catturaSpesaPagatoDati(); aggiornaTotaliSpesaForm(); });
    box.appendChild(row);
  });
  aggiornaTotaliSpesaForm();
}

function onSpesaPagatoriChange() {
  catturaSpesaPagatoDati();
  renderSpesaPagatoriRighe();
}

// Checkbox-list di chi ha anticipato i soldi: stesso pattern di quella dei partecipanti,
// ma le persone nuove partono NON spuntate (di default nessuno ha pagato).
function refreshSpesaPagatoriCheckboxes() {
  const box = document.querySelector("#f-spesa-pagatori-check");
  if (!box) return;
  catturaSpesaPagatoDati();
  const attuali = new Set(getCheckedValues(box));
  const ordinati = [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  box.innerHTML = ordinati.map(p => {
    const spuntata = spesaPagatoriKnownNames.has(p) ? attuali.has(p) : false;
    return `<label class="chk"><input type="checkbox" value="${escapeHtml(p)}" ${spuntata ? "checked" : ""}> ${escapeHtml(p)}</label>`;
  }).join("");
  spesaPagatoriKnownNames = new Set(ordinati);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", onSpesaPagatoriChange));
  renderSpesaPagatoriRighe();
}

function setSpesaPagatoriSelezionati(nomi) {
  const box = document.querySelector("#f-spesa-pagatori-check");
  if (!box) return;
  const set = new Set(nomi);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = set.has(cb.value); });
  renderSpesaPagatoriRighe();
}

function leggiSpesaQuote() {
  const righe = Array.from(document.querySelectorAll("#f-spesa-quote-righe .spesa-ne-row"));
  const quote = {};
  righe.forEach(row => {
    const nome = row.dataset.nome;
    const v = parseFloat(row.querySelector(".sne-quota").value);
    quote[nome] = isNaN(v) ? 0 : v;
  });
  return quote;
}

function leggiSpesaPagatori() {
  const righe = Array.from(document.querySelectorAll("#f-spesa-pagatori-righe .spesa-ne-row"));
  const pagatori = {};
  righe.forEach(row => {
    const nome = row.dataset.nome;
    const v = parseFloat(row.querySelector(".pag-importo").value);
    pagatori[nome] = isNaN(v) ? 0 : v;
  });
  return pagatori;
}

function aggiornaTotaliSpesaForm() {
  const pagatori = leggiSpesaPagatori();
  const totPag = Object.values(pagatori).reduce((a, b) => a + b, 0);
  const boxPag = document.querySelector("#status-spesa-pagatori-tot");
  if (boxPag) boxPag.textContent = `Totale anticipato: ${euro(totPag)}`;
  if (spesaModoAttuale() === "nonequa") {
    const quote = leggiSpesaQuote();
    const totQuote = Object.values(quote).reduce((a, b) => a + b, 0);
    const boxQuote = document.querySelector("#status-spesa-quote-tot");
    if (boxQuote) boxQuote.textContent = `Totale dovuto (somma delle quote): ${euro(totQuote)}`;
  }
}

function modificaSpesa(gruppoId) {
  const voci = STATE.spese.filter((s, i) => (s.gruppoId || `__idx_${i}`) === gruppoId);
  if (voci.length === 0) return;
  editingSpesaGruppoId = gruppoId;
  const isNE = !!voci[0].quote;
  document.querySelector("#f-spesa-titolo").value = baseTitolo(voci[0].descrizione);

  setSpesaPartecipantiSelezionati(voci[0].partecipanti || []);

  document.querySelector("#f-spesa-modo-equa").checked = !isNE;
  document.querySelector("#f-spesa-modo-nonequa").checked = isNE;
  aggiornaVisibilitaModoSpesa();
  spesaQuoteDati = isNE ? { ...(voci[0].quote || {}) } : {};
  renderSpesaQuoteRighe();

  spesaPagatoDati = {};
  voci.forEach(v => spesaPagatoDati[v.nome] = v.importo);
  setSpesaPagatoriSelezionati(voci.map(v => v.nome));

  document.querySelector("#sec-spesa").classList.remove("collapsed");
  document.querySelector("#btn-spesa-submit").textContent = "Salva modifiche";
  document.querySelector("#btn-spesa-annulla").style.display = "inline-block";
  safeScrollIntoView(document.querySelector("#f-spesa-form"));
  renderListaSpese();
}

function annullaModificaSpesa() {
  editingSpesaGruppoId = null;
  document.querySelector("#f-spesa-form").reset();
  spesaQuoteDati = {};
  spesaPagatoDati = {};
  aggiornaVisibilitaModoSpesa();
  setSpesaPartecipantiSelezionati(STATE.persone); // tutti spuntati di default
  setSpesaPagatoriSelezionati([]); // nessuno spuntato di default
  document.querySelector("#btn-spesa-submit").textContent = "Aggiungi spesa";
  document.querySelector("#btn-spesa-annulla").style.display = "none";
  renderListaSpese();
}

async function submitSpesa(e) {
  e.preventDefault();
  let titolo = document.querySelector("#f-spesa-titolo").value.trim();
  if (!titolo) { setStatus("#status-spesa", "Inserisci un titolo.", true); return; }
  if (!validaOAvvisa(titolo, "Titolo spesa")) return;

  if (titoloGiaUsato(titolo, { gruppoSpesaId: editingSpesaGruppoId })) {
    setStatus("#status-spesa", `Esiste già una spesa o una cena con il titolo "${baseTitolo(titolo)}". Scegline uno diverso.`, true);
    return;
  }

  const partecipanti = getCheckedValues(document.querySelector("#f-spesa-partecipanti"));
  if (partecipanti.length === 0) { setStatus("#status-spesa", "Seleziona almeno un partecipante alla spesa.", true); return; }

  const pagatori = leggiSpesaPagatori();
  const nomiPagatori = Object.keys(pagatori).filter(n => getCheckedValues(document.querySelector("#f-spesa-pagatori-check")).includes(n));
  if (nomiPagatori.length === 0) { setStatus("#status-spesa", "Seleziona almeno una persona che ha anticipato i soldi, con il relativo importo.", true); return; }
  for (const n of nomiPagatori) {
    if (!(pagatori[n] > 0)) { setStatus("#status-spesa", `L'importo pagato da ${n} deve essere un numero maggiore di zero.`, true); return; }
  }

  const nonEqua = spesaModoAttuale() === "nonequa";
  let quote = null;
  if (nonEqua) {
    quote = leggiSpesaQuote();
    for (const n of partecipanti) {
      if (!(quote[n] >= 0)) { setStatus("#status-spesa", `La quota di ${n} non può essere negativa.`, true); return; }
    }
    const totQuote = Object.values(quote).reduce((a, b) => a + b, 0);
    if (totQuote <= 0) { setStatus("#status-spesa", "La somma delle quote deve essere maggiore di zero.", true); return; }
    titolo = baseTitolo(titolo) + " [NE]";
  } else {
    titolo = baseTitolo(titolo);
  }

  try {
    const gruppoId = editingSpesaGruppoId || generaId();
    const nuoveVoci = nomiPagatori.map(nome => {
      const voce = { nome, descrizione: titolo, importo: pagatori[nome], partecipanti, gruppoId };
      if (nonEqua) voce.quote = quote;
      return voce;
    });
    let nuovoElenco;
    let msg;
    if (editingSpesaGruppoId) {
      nuovoElenco = STATE.spese.filter((s, i) => (s.gruppoId || `__idx_${i}`) !== editingSpesaGruppoId).concat(nuoveVoci);
      msg = `Modifica spesa: ${titolo}`;
    } else {
      nuovoElenco = [...STATE.spese, ...nuoveVoci];
      msg = `Aggiunge spesa: ${titolo}`;
    }
    await GH.writeJSON("data/spese.json", nuovoElenco, msg);
    setStatus("#status-spesa", (editingSpesaGruppoId ? "Spesa modificata!" : "Spesa aggiunta!") + " Ricarico i dati…", false);
    annullaModificaSpesa();
    await loadAllData(); renderAll();
  } catch (err) { setStatus("#status-spesa", err.message, true); }
}

// --- Aggiungi rimborso ---
async function submitRimborso(e) {
  e.preventDefault();
  const da = document.querySelector("#f-rimb-da").value;
  const a = document.querySelector("#f-rimb-a").value;
  const importo = parseFloat(document.querySelector("#f-rimb-importo").value);
  if (!da || !a || da === a) { setStatus("#status-rimborso", "Controlla i campi (da / a devono essere diversi).", true); return; }
  if (!(importo > 0)) { setStatus("#status-rimborso", "L'importo deve essere un numero maggiore di zero.", true); return; }
  try {
    const nuovo = { da, a, importo };
    let nuovoElenco;
    let msg;
    if (editingRimborsoIndex !== null) {
      nuovoElenco = STATE.rimborsi.map((r, i) => i === editingRimborsoIndex ? nuovo : r);
      msg = `Modifica rimborso: ${da} -> ${a}`;
    } else {
      nuovoElenco = [...STATE.rimborsi, nuovo];
      msg = `Aggiunge rimborso: ${da} -> ${a}`;
    }
    await GH.writeJSON("data/rimborsi.json", nuovoElenco, msg);
    setStatus("#status-rimborso", (editingRimborsoIndex !== null ? "Rimborso modificato!" : "Rimborso aggiunto!") + " Ricarico i dati…", false);
    editingRimborsoIndex = null;
    document.querySelector("#f-rimborso-form").reset();
    document.querySelector("#btn-rimborso-submit").textContent = "Aggiungi rimborso";
    document.querySelector("#btn-rimborso-annulla").style.display = "none";
    await loadAllData(); renderAll();
  } catch (err) { setStatus("#status-rimborso", err.message, true); }
}

// --- Aggiungi cena (form dinamico) ---
// Le persone della cena non si aggiungono più una per una: si spuntano dalla lista di
// tutte le persone esistenti (di default tutte spuntate). Le righe di inserimento delle
// spese individuali vengono generate/rimosse automaticamente in base a chi è spuntato,
// sempre in ordine alfabetico, e i valori già inseriti vengono preservati quando si
// spunta/rimuove una persona (finché non si ricarica la pagina o si annulla la modifica).
let cenaPersoneDati = {}; // nome -> {categoria: valore}
let cenaCheckboxKnownNames = new Set(); // usato per capire quali persone sono "nuove" (mai viste) sulla checkbox-list

function catturaCenaPersoneDati() {
  document.querySelectorAll("#cena-persone-rows .cena-persona-row").forEach(row => {
    const nome = row.dataset.nome;
    if (!nome) return;
    const dati = {};
    CAT_INPUT.forEach(c => dati[c] = parseFloat(row.querySelector(`.cp-${c}`).value) || 0);
    cenaPersoneDati[nome] = dati;
  });
}

function buildCenaPersoneRow(nome, dati) {
  const box = document.querySelector("#cena-persone-rows");
  const row = el("div", "cena-persona-row");
  row.dataset.nome = nome;
  row.innerHTML = `
    <div class="cp-persona-titolo">${escapeHtml(nome)}</div>
    <div class="cp-fields-grid">
      ${CAT_INPUT.map(c => `<div class="cp-field"><label>${CAT_LABELS[c]}</label><input type="number" step="0.01" min="0" class="cp-${c}" value="${(dati && dati[c]) || 0}"></div>`).join("")}
    </div>`;
  box.appendChild(row);
}

function renderCenaPersoneRows() {
  const box = document.querySelector("#cena-persone-rows");
  box.innerHTML = "";
  const checkboxBox = document.querySelector("#cena-persone-checkboxes");
  const checked = getCheckedValues(checkboxBox).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  checked.forEach(nome => buildCenaPersoneRow(nome, cenaPersoneDati[nome]));
}

function onCenaPersoneCheckboxChange() {
  catturaCenaPersoneDati();
  renderCenaPersoneRows();
  syncCsPartCheckboxes();
}

// Elenco (ordinato alfabeticamente) delle persone attualmente spuntate come partecipanti alla cena
function personePartecipantiCena() {
  const box = document.querySelector("#cena-persone-checkboxes");
  return box ? getCheckedValues(box).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : [];
}

// Sincronizza i checkbox "partecipanti" di ogni spesa condivisa già inserita con l'elenco
// attuale dei partecipanti alla cena: chi non partecipa più alla cena sparisce dalla lista,
// chi ci partecipa compare (mantenendo lo stato di spunta di chi era già presente).
function syncCsPartCheckboxes() {
  const partecipanti = personePartecipantiCena();
  document.querySelectorAll("#cena-spese-rows .cs-part").forEach(box => {
    const checked = new Set(getCheckedValues(box));
    box.innerHTML = partecipanti.map(p =>
      `<label class="chk"><input type="checkbox" value="${p}" ${checked.has(p) ? "checked" : ""}> ${p}</label>`).join("");
  });
}

// Ricostruisce la checkbox-list delle persone alla cena. Le persone già viste in
// precedenza mantengono lo stato di spunta attuale; le persone nuove (mai comparse
// prima nella lista, es. appena aggiunte altrove) vengono spuntate di default.
function refreshCenaPersoneCheckboxes() {
  const box = document.querySelector("#cena-persone-checkboxes");
  if (!box) return;
  catturaCenaPersoneDati();
  const attuali = new Set(getCheckedValues(box));
  const ordinati = [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  box.innerHTML = ordinati.map(p => {
    const spuntata = cenaCheckboxKnownNames.has(p) ? attuali.has(p) : true;
    return `<label class="chk"><input type="checkbox" value="${p}" ${spuntata ? "checked" : ""}> ${p}</label>`;
  }).join("");
  cenaCheckboxKnownNames = new Set(ordinati);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", onCenaPersoneCheckboxChange));
  renderCenaPersoneRows();
  syncCsPartCheckboxes();
}

// Imposta esplicitamente quali persone sono spuntate (usato in modifica di una cena esistente)
function setCenaPersoneSelezionate(nomi) {
  const box = document.querySelector("#cena-persone-checkboxes");
  const set = new Set(nomi);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = set.has(cb.value); });
  renderCenaPersoneRows();
  syncCsPartCheckboxes();
}

// --- Chi ha anticipato i soldi per la cena (indipendente dai partecipanti alla cena) ---
let cenaPagatoDati = {}; // nome -> importo
let cenaPagatoriKnownNames = new Set();

function catturaCenaPagatoDati() {
  document.querySelectorAll("#cena-pagatori-righe .spesa-ne-row").forEach(row => {
    const nome = row.dataset.nome;
    const v = parseFloat(row.querySelector(".pag-importo").value);
    cenaPagatoDati[nome] = isNaN(v) ? 0 : v;
  });
}

// Righe "importo pagato" per i soli pagatori attualmente spuntati
function renderCenaPagatoriRighe() {
  const box = document.querySelector("#cena-pagatori-righe");
  if (!box) return;
  box.innerHTML = "";
  const checkboxBox = document.querySelector("#cena-pagatori-check");
  const checked = checkboxBox ? getCheckedValues(checkboxBox).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) : [];
  checked.forEach(nome => {
    const row = el("div", "spesa-ne-row");
    row.dataset.nome = nome;
    const valore = cenaPagatoDati[nome] !== undefined ? cenaPagatoDati[nome] : "";
    row.innerHTML = `
      <div class="cp-persona-titolo" style="margin:0;">${escapeHtml(nome)}</div>
      <input type="number" step="0.01" min="0" class="pag-importo" placeholder="Importo pagato €" value="${valore}">
      <span></span>`;
    row.querySelector(".pag-importo").addEventListener("input", () => { catturaCenaPagatoDati(); aggiornaTotaleCenaPagatoriForm(); });
    box.appendChild(row);
  });
  aggiornaTotaleCenaPagatoriForm();
}

function onCenaPagatoriChange() {
  catturaCenaPagatoDati();
  renderCenaPagatoriRighe();
}

// Checkbox-list di chi ha anticipato i soldi per la cena: stesso pattern di quella delle
// spese generiche — le persone nuove partono NON spuntate (di default nessuno ha pagato).
function refreshCenaPagatoriCheckboxes() {
  const box = document.querySelector("#cena-pagatori-check");
  if (!box) return;
  catturaCenaPagatoDati();
  const attuali = new Set(getCheckedValues(box));
  const ordinati = [...STATE.persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  box.innerHTML = ordinati.map(p => {
    const spuntata = cenaPagatoriKnownNames.has(p) ? attuali.has(p) : false;
    return `<label class="chk"><input type="checkbox" value="${escapeHtml(p)}" ${spuntata ? "checked" : ""}> ${escapeHtml(p)}</label>`;
  }).join("");
  cenaPagatoriKnownNames = new Set(ordinati);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", onCenaPagatoriChange));
  renderCenaPagatoriRighe();
}

function setCenaPagatoriSelezionati(nomi) {
  const box = document.querySelector("#cena-pagatori-check");
  if (!box) return;
  const set = new Set(nomi);
  box.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.checked = set.has(cb.value); });
  renderCenaPagatoriRighe();
}

function leggiCenaPagatori() {
  const righe = Array.from(document.querySelectorAll("#cena-pagatori-righe .spesa-ne-row"));
  const pagatori = {};
  righe.forEach(row => {
    const nome = row.dataset.nome;
    const v = parseFloat(row.querySelector(".pag-importo").value);
    pagatori[nome] = isNaN(v) ? 0 : v;
  });
  return pagatori;
}

function aggiornaTotaleCenaPagatoriForm() {
  const pagatori = leggiCenaPagatori();
  const totPag = Object.values(pagatori).reduce((a, b) => a + b, 0);
  const box = document.querySelector("#status-cena-pagatori-tot");
  if (box) box.textContent = `Totale anticipato: ${euro(totPag)}`;
}

let cenaSpeseRows = [];
function addCenaSpesaRow(initial) {
  const idx = cenaSpeseRows.length;
  cenaSpeseRows.push(idx);
  const box = document.querySelector("#cena-spese-rows");
  const row = el("div", "cena-spesa-row");
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" placeholder="descrizione" class="cs-desc">
    <select class="cs-colonna">
      <option value="">(nessuna colonna / spesa separata)</option>
      ${CAT_INPUT.map(c => `<option value="${c}">${CAT_LABELS[c]}</option>`).join("")}
    </select>
    <select class="cs-tipo"><option value="divisa">divisa</option><option value="persona">a persona</option></select>
    <input type="number" step="0.01" min="0" placeholder="importo" class="cs-importo">
    <div class="cena-spesa-partecipanti cs-part"></div>
    <button type="button" class="btn-remove-row">✕</button>`;
  box.appendChild(row);
  syncCsPartCheckboxes();
  if (initial) {
    row.querySelector(".cs-desc").value = initial.descrizione || "";
    row.querySelector(".cs-colonna").value = initial.colonna || "";
    row.querySelector(".cs-tipo").value = initial.tipo || "divisa";
    row.querySelector(".cs-importo").value = initial.importo || 0;
    const part = new Set(initial.partecipanti || []);
    Array.from(row.querySelectorAll(".cs-part input[type=checkbox]")).forEach(cb => {
      cb.checked = part.has(cb.value);
    });
  }
  row.querySelector(".btn-remove-row").addEventListener("click", () => {
    row.remove();
    cenaSpeseRows = cenaSpeseRows.filter(i => i !== idx);
  });
}

async function submitCena(e) {
  e.preventDefault();
  const titolo = document.querySelector("#f-cena-titolo").value.trim();
  if (!titolo) { setStatus("#status-cena", "Inserisci un titolo.", true); return; }
  if (!validaOAvvisa(titolo, "Titolo cena")) return;

  if (titoloGiaUsato(titolo, { indiceCena: editingCenaIndex })) {
    setStatus("#status-cena", `Esiste già una cena o una spesa con il titolo "${baseTitolo(titolo)}". Scegline uno diverso.`, true);
    return;
  }

  const sconti = {};
  for (const c of CAT_INPUT) {
    const inp = document.querySelector(`#f-sconto-${c}`);
    const v = inp ? (parseFloat(inp.value) || 0) : 0;
    if (v < 0) { setStatus("#status-cena", `Lo sconto per "${CAT_LABELS[c]}" non può essere negativo.`, true); return; }
    sconti[c] = v;
  }

  const persone = [];
  for (const row of Array.from(document.querySelectorAll("#cena-persone-rows .cena-persona-row"))) {
    const p = { nome: row.dataset.nome };
    for (const c of CAT_INPUT) {
      const v = parseFloat(row.querySelector(`.cp-${c}`).value) || 0;
      if (v < 0) { setStatus("#status-cena", `Il valore di "${CAT_LABELS[c]}" per ${p.nome} non può essere negativo.`, true); return; }
      p[c] = v;
    }
    persone.push(p);
  }
  if (persone.length === 0) { setStatus("#status-cena", "Seleziona almeno una persona alla cena.", true); return; }

  const pagatoDati = leggiCenaPagatori();
  const nomiCenaPagatori = Object.keys(pagatoDati).filter(n => getCheckedValues(document.querySelector("#cena-pagatori-check")).includes(n));
  if (nomiCenaPagatori.length === 0) { setStatus("#status-cena", "Seleziona almeno una persona che ha anticipato i soldi per la cena, con il relativo importo.", true); return; }
  for (const n of nomiCenaPagatori) {
    if (!(pagatoDati[n] > 0)) { setStatus("#status-cena", `L'importo pagato da ${n} deve essere un numero maggiore di zero.`, true); return; }
  }
  const pagatori = nomiCenaPagatori.map(nome => ({ nome, importo: pagatoDati[nome] }));

  const speseCondivise = [];
  for (const row of Array.from(document.querySelectorAll("#cena-spese-rows .cena-spesa-row"))) {
    const descrizione = row.querySelector(".cs-desc").value.trim();
    if (!descrizione) continue;
    const importo = parseFloat(row.querySelector(".cs-importo").value) || 0;
    if (importo < 0) { setStatus("#status-cena", `L'importo della spesa condivisa "${descrizione}" non può essere negativo.`, true); return; }
    const s = {
      descrizione,
      tipo: row.querySelector(".cs-tipo").value,
      importo,
      partecipanti: getCheckedValues(row.querySelector(".cs-part"))
    };
    const colonna = row.querySelector(".cs-colonna").value;
    if (colonna) s.colonna = colonna;
    speseCondivise.push(s);
  }
  for (const s of speseCondivise) { if (!validaOAvvisa(s.descrizione, "Descrizione spesa condivisa")) return; }

  const nuovaCena = { titolo, sconti, persone, speseCondivise, pagatori };
  try {
    let nuovoElenco;
    let msg;
    if (editingCenaIndex !== null) {
      nuovoElenco = STATE.cene.map((c, i) => i === editingCenaIndex ? nuovaCena : c);
      msg = `Modifica cena: ${titolo}`;
    } else {
      nuovoElenco = [...STATE.cene, nuovaCena];
      msg = `Aggiunge cena: ${titolo}`;
    }
    await GH.writeJSON("data/cene.json", nuovoElenco, msg);
    setStatus("#status-cena", (editingCenaIndex !== null ? "Cena modificata!" : "Cena aggiunta!") + " Ricarico i dati…", false);
    editingCenaIndex = null;
    document.querySelector("#f-cena-form").reset();
    cenaPersoneDati = {};
    document.querySelectorAll("#cena-persone-checkboxes input[type=checkbox]").forEach(cb => cb.checked = true);
    renderCenaPersoneRows();
    const dettagli = document.querySelector("#cena-persone-details");
    if (dettagli) dettagli.classList.add("collapsed");
    document.querySelector("#cena-spese-rows").innerHTML = "";
    cenaSpeseRows = [];
    cenaPagatoDati = {};
    setCenaPagatoriSelezionati([]); // nessun pagatore spuntato di default
    document.querySelector("#btn-cena-submit").textContent = "Salva cena";
    document.querySelector("#btn-cena-annulla").style.display = "none";
    await loadAllData(); renderAll();
  } catch (err) { setStatus("#status-cena", err.message, true); }
}

function renderListaCredenziali() {
  const box = document.querySelector("#lista-credenziali");
  box.innerHTML = "";
  const elenco = STATE.config.credenziali || [];
  if (elenco.length === 0) { box.innerHTML = `<div class="empty-note">Nessuna credenziale inserita.</div>`; return; }
  elenco.forEach((c, i) => {
    const dettaglio = c.tipo === "iban"
      ? `IBAN: ${escapeHtml(c.iban)} — Intestatario: ${escapeHtml(c.intestatario)}`
      : `PayPal: ${escapeHtml(c.paypal)}`;
    const row = el("div", "list-row" + (editingCredenzialeIndex === i ? " editing" : ""));
    row.innerHTML = `
      <div class="list-main">${escapeHtml(c.nome)}<br><span class="list-sub">${dettaglio}</span></div>
      <div class="list-actions">
        <button class="btn-icon edit" type="button">Modifica</button>
        <button class="btn-icon delete" type="button">Elimina</button>
      </div>`;
    row.querySelector(".edit").addEventListener("click", () => modificaCredenziale(i));
    row.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm(`Eliminare le credenziali di "${c.nome}"?`)) return;
      try {
        const nuovoElenco = elenco.filter((_, idx) => idx !== i);
        await GH.writeJSON("data/config.json", { ...STATE.config, credenziali: nuovoElenco }, `Rimuove credenziali: ${c.nome}`);
        await loadAllData(); renderAll();
      } catch (err) { alert(err.message); }
    });
    box.appendChild(row);
  });
}

function aggiornaCampiCredenziale() {
  const tipo = document.querySelector("#f-cred-tipo").value;
  document.querySelector("#f-cred-campi-paypal").style.display = tipo === "paypal" ? "" : "none";
  document.querySelector("#f-cred-campi-iban").style.display = tipo === "iban" ? "" : "none";
}

function modificaCredenziale(i) {
  const c = (STATE.config.credenziali || [])[i];
  editingCredenzialeIndex = i;
  document.querySelector("#sec-credenziale").classList.remove("collapsed");
  document.querySelector("#f-cred-persona").value = c.nome;
  document.querySelector("#f-cred-tipo").value = c.tipo;
  document.querySelector("#f-cred-paypal").value = c.paypal || "";
  document.querySelector("#f-cred-iban").value = c.iban || "";
  document.querySelector("#f-cred-intestatario").value = c.intestatario || "";
  aggiornaCampiCredenziale();
  document.querySelector("#btn-cred-submit").textContent = "Salva modifiche";
  document.querySelector("#btn-cred-annulla").style.display = "inline-block";
  safeScrollIntoView(document.querySelector("#f-credenziale-form"));
  renderListaCredenziali();
}

function annullaModificaCredenziale() {
  editingCredenzialeIndex = null;
  document.querySelector("#f-credenziale-form").reset();
  aggiornaCampiCredenziale();
  document.querySelector("#btn-cred-submit").textContent = "Salva credenziali";
  document.querySelector("#btn-cred-annulla").style.display = "none";
  renderListaCredenziali();
}

async function submitCredenziale(e) {
  e.preventDefault();
  const nome = document.querySelector("#f-cred-persona").value;
  const tipo = document.querySelector("#f-cred-tipo").value;
  if (!nome) { setStatus("#status-cred", "Seleziona una persona.", true); return; }

  const nuovaCredenziale = { nome, tipo };
  if (tipo === "paypal") {
    const paypal = document.querySelector("#f-cred-paypal").value.trim();
    if (!paypal) { setStatus("#status-cred", "Inserisci il link PayPal.", true); return; }
    if (!validaOAvvisa(paypal, "Link PayPal")) return;
    nuovaCredenziale.paypal = paypal;
  } else {
    const iban = document.querySelector("#f-cred-iban").value.trim();
    const intestatario = document.querySelector("#f-cred-intestatario").value.trim();
    if (!iban || !intestatario) { setStatus("#status-cred", "Inserisci IBAN e intestatario.", true); return; }
    if (!validaOAvvisa(iban, "IBAN") || !validaOAvvisa(intestatario, "Intestatario")) return;
    nuovaCredenziale.iban = iban;
    nuovaCredenziale.intestatario = intestatario;
  }

  const elenco = STATE.config.credenziali || [];
  let nuovoElenco;
  if (editingCredenzialeIndex !== null) {
    nuovoElenco = elenco.map((c, i) => i === editingCredenzialeIndex ? nuovaCredenziale : c);
  } else {
    // se la persona ha già una credenziale, la sostituisce invece di duplicarla
    const idxEsistente = elenco.findIndex(c => c.nome === nome);
    nuovoElenco = idxEsistente >= 0
      ? elenco.map((c, i) => i === idxEsistente ? nuovaCredenziale : c)
      : [...elenco, nuovaCredenziale];
  }

  try {
    await GH.writeJSON("data/config.json", { ...STATE.config, credenziali: nuovoElenco }, `Aggiorna credenziali: ${nome}`);
    setStatus("#status-cred", "Credenziali salvate! Ricarico i dati…", false);
    annullaModificaCredenziale();
    await loadAllData(); renderAll();
  } catch (err) { setStatus("#status-cred", err.message, true); }
}

function updateTokenStatus() {
  const box = document.querySelector("#status-token");
  if (GH.getToken()) {
    box.textContent = "✅ Token impostato e salvato in modo permanente su questo browser.";
    box.className = "status status-ok";
  } else {
    box.textContent = "Nessun token impostato: puoi solo visualizzare i dati, non modificarli.";
    box.className = "status status-error";
  }
}

function buildScontiGrid() {
  const box = document.querySelector("#sconti-grid-container");
  box.innerHTML = CAT_INPUT.map(c =>
    `<div class="cp-field"><label>${CAT_LABELS[c]}</label><input type="number" min="0" max="100" id="f-sconto-${c}" value="0"></div>`
  ).join("");
}

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", async () => {
  buildScontiGrid();
  buildPersonaNomiInputs(1);
  renderHomeLink();
  await loadAllData();
  renderAll();
  aggiornaVisibilitaModoSpesa();
  setSpesaPagatoriSelezionati([]); // di default nessun pagatore spuntato
  setCenaPagatoriSelezionati([]); // di default nessun pagatore spuntato

  document.querySelector("#f-persona-quante").addEventListener("change", (e) => {
    buildPersonaNomiInputs(parseInt(e.target.value, 10) || 1);
  });
  document.querySelector("#f-persona-form").addEventListener("submit", submitPersona);
  document.querySelector("#f-spesa-form").addEventListener("submit", submitSpesa);
  document.querySelector("#btn-spesa-annulla").addEventListener("click", annullaModificaSpesa);
  document.querySelectorAll('input[name="f-spesa-modo"]').forEach(r => {
    r.addEventListener("change", () => { aggiornaVisibilitaModoSpesa(); aggiornaTotaliSpesaForm(); });
  });
  document.querySelector("#f-rimborso-form").addEventListener("submit", submitRimborso);
  document.querySelector("#f-cena-form").addEventListener("submit", submitCena);
  document.querySelector("#f-credenziale-form").addEventListener("submit", submitCredenziale);
  document.querySelector("#f-cred-tipo").addEventListener("change", aggiornaCampiCredenziale);
  document.querySelector("#btn-cred-annulla").addEventListener("click", annullaModificaCredenziale);
  aggiornaCampiCredenziale();
  document.querySelector("#btn-add-cena-spesa").addEventListener("click", () => addCenaSpesaRow());
  document.querySelector("#btn-rimborso-annulla").addEventListener("click", annullaModificaRimborso);
  document.querySelector("#btn-cena-annulla").addEventListener("click", annullaModificaCena);
  document.querySelector("#cena-persone-details-toggle").addEventListener("click", () => {
    document.querySelector("#cena-persone-details").classList.toggle("collapsed");
  });

  // Sezioni estendibili "Aggiungi spesa / rimborso / cena"
  document.querySelectorAll(".collapsible-header[data-toggle]").forEach(header => {
    header.addEventListener("click", () => {
      document.querySelector("#" + header.dataset.toggle).classList.toggle("collapsed");
    });
  });

  const tokenInput = document.querySelector("#gh-token");
  tokenInput.value = GH.getToken();
  updateTokenStatus();
  const tokenBox = document.querySelector("#token-box");
  document.querySelector("#token-box-toggle").addEventListener("click", () => {
    tokenBox.classList.toggle("collapsed");
  });
  document.querySelector("#btn-toggle-token").addEventListener("click", () => {
    tokenInput.type = tokenInput.type === "password" ? "text" : "password";
  });
  document.querySelector("#btn-copy-token").addEventListener("click", async () => {
    if (!tokenInput.value) { showToast("Nessun token da copiare.", true); return; }
    try {
      await navigator.clipboard.writeText(tokenInput.value);
    } catch (e) {
      tokenInput.select();
      document.execCommand("copy");
    }
    showToast("Token copiato negli appunti.", false);
  });
  document.querySelector("#btn-save-token").addEventListener("click", () => {
    GH.setToken(tokenInput.value.trim());
    updateTokenStatus();
    showToast(GH.getToken() ? "Token salvato in modo permanente su questo browser." : "Token rimosso.", false);
  });
  document.querySelector("#btn-clear-token").addEventListener("click", () => {
    GH.setToken("");
    tokenInput.value = "";
    updateTokenStatus();
    showToast("Token rimosso.", false);
  });

  if (CONFIG.owner === "TUO-USERNAME-GITHUB" || CONFIG.repo === "TUO-REPO") {
    document.querySelector("#config-warning").style.display = "block";
  }

  // ---------- TAB: attivazione + persistenza tramite l'hash dell'URL ----------
  // Ricaricando la pagina (F5) o tornandoci con un link diretto, si riapre la stessa
  // scheda in cui ci si trovava, perché l'hash (#tab-...) resta nell'URL.
  function attivaTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!btn) return false;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector("#" + tabId).classList.add("active");
    return true;
  }

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      attivaTab(btn.dataset.tab);
      history.replaceState(null, "", "#" + btn.dataset.tab);
    });
  });

  const hashIniziale = (location.hash || "").replace("#", "");
  if (hashIniziale) attivaTab(hashIniziale);

  window.addEventListener("hashchange", () => {
    const tabId = (location.hash || "").replace("#", "");
    if (tabId) attivaTab(tabId);
  });
});
