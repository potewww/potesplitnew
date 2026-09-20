// ============================================================
// calc.js — logica di calcolo (cene + spese generiche), con
// arrotondamenti equi (centesimini) e riconciliazione automatica
// sia in surplus (solata) che in deficit (controsolata).
// ============================================================

const CAT_CIBO = ["antipasto", "primi", "secondi", "contorni", "pizza", "panini", "frutta"];
const CAT_BEVANDE = ["acqua", "caffe", "bibite", "birra", "vino", "liquori"];
const CAT_ALTRO = ["centesimini", "solata", "controsolata", "menu", "coperto", "dolci"];
const CAT_ALL = [...CAT_CIBO, ...CAT_BEVANDE, ...CAT_ALTRO];

// "solata", "controsolata" e "centesimini" non sono dati inseribili manualmente: vengono
// calcolati automaticamente (vedi calcolaSolataControsolata) e vanno quindi esclusi dai
// campi del form e dal totale "di base" della persona, ma restano colonne normali ai fini
// di stampa/sconti.
const CAT_INPUT = CAT_ALL.filter(c => c !== "solata" && c !== "controsolata" && c !== "centesimini");

const CAT_LABELS = {
  antipasto: "Antipasto", primi: "Primi", secondi: "Secondi", contorni: "Contorni",
  pizza: "Pizza", panini: "Panini", frutta: "Frutta",
  acqua: "Acqua", caffe: "Caffè", bibite: "Bibite", birra: "Birra", vino: "Vino", liquori: "Liquori",
  centesimini: "Centesimini (auto)", solata: "Solata (auto)", controsolata: "Controsolata (auto)",
  menu: "Menù", coperto: "Coperto", dolci: "Dolci"
};

function applicaSconto(valore, categoria, sconti) {
  const s = (sconti && sconti[categoria]) || 0;
  if (s > 0) return valore * (1 - s / 100);
  return valore;
}

// Somma le sole categorie "di base" inserite a mano per la persona (esclude gli automatismi)
function totaleConSconti(p, sconti) {
  return CAT_INPUT.reduce((sum, c) => sum + applicaSconto(p[c] || 0, c, sconti), 0);
}

function totaleSenzaSconti(p) {
  return CAT_INPUT.reduce((sum, c) => sum + (p[c] || 0), 0);
}

// Divide "importo" in "n" quote uguali arrotondate PER DIFETTO al centesimo, restituendo
// anche il resto (in euro, sempre < 0.01 * n) che non è stato possibile distribuire in modo
// equo. Il resto va assegnato a chi sta spendendo di meno (vedi chiamanti).
function dividiInParti(importo, n) {
  if (!n || n <= 0) return { shares: [], resto: importo, restoCent: 0 };
  const totCent = Math.round(importo * 100);
  const baseCent = Math.floor(totCent / n);
  const shares = new Array(n).fill(baseCent / 100);
  const restoCent = totCent - baseCent * n;
  return { shares, resto: Math.round(restoCent) / 100, restoCent };
}

// Arrotonda al centesimo: usato per confrontare "chi sta spendendo di più/meno" quando si
// deve assegnare un centesimo residuo, evitando che minuscoli errori di virgola mobile (es.
// 3.3300000000000005 invece di 3.33) facciano risultare "diversi" due importi identici sulla
// carta.
function centesimi(v) {
  return Math.round((v || 0) * 100);
}

// Tra i partecipanti, individua quelli con l'importo minimo (o massimo) in "totaleCorrente"
// (arrotondato al centesimo) e ne sceglie UNO A CASO tra chi è in parità: a parità di importo
// speso, chi riceve/perde il centesimo residuo non è quindi prevedibile in anticipo.
// "rng" è opzionale: se non passato usa Math.random (comportamento "vero" casuale); se
// passato (vedi distribuisciRestoCent) usa un generatore seedato per essere deterministico.
function sceltaCasualeTraPari(partecipanti, totaleCorrente, cercaMinimo, rng) {
  const valori = partecipanti.map(n => centesimi(totaleCorrente[n]));
  const target = cercaMinimo ? Math.min(...valori) : Math.max(...valori);
  const candidati = partecipanti.filter((n, i) => valori[i] === target);
  const r = rng ? rng() : Math.random();
  return candidati[Math.floor(r * candidati.length)];
}

// Serializza un valore in modo stabile (chiavi degli oggetti in ordine alfabetico), usato
// per costruire un seed deterministico a partire dai dati di ingresso di una funzione.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// Hash di stringa -> intero a 32 bit (FNV-1a), usato come seed per mulberry32.
function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// PRNG deterministico (mulberry32): a parità di seed produce sempre la stessa sequenza.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distribuisce "restoCent" centesimi residui (interi, per costruzione sempre < numero di
// partecipanti) UNO ALLA VOLTA, ciascuno a una persona DIVERSA: ad ogni passo si sceglie a
// caso — con lo stesso criterio di sceltaCasualeTraPari — tra chi, fra i non ancora scelti,
// sta spendendo di meno (o di più, per la controsolata); il suo totale viene poi aggiornato
// prima di scegliere il centesimo successivo, così i centesimi non finiscono mai tutti sulla
// stessa persona. Restituisce un array { nome, valore } di lunghezza restoCent (valore
// sempre ±0.01, con lo stesso segno per tutta la lista).
//
// IMPORTANTE: la scelta "casuale" è seedata deterministicamente a partire dagli stessi dati
// in ingresso (partecipanti, totali correnti, numero di centesimi, verso). Il calcolo di una
// stessa cena/spesa viene rifatto da zero più volte durante il rendering della pagina (una
// volta per la tabella "Altro", una per "Totali per persona", una per il Riepilogo globale,
// ecc.): senza un seed deterministico, ogni ricalcolo potrebbe assegnare il centesimo residuo
// a una persona diversa, facendo apparire tabelle diverse in disaccordo tra loro pur
// descrivendo la stessa identica cena/spesa. Con lo stesso input, il risultato è sempre lo
// stesso; cambia solo (in modo imprevedibile) quando cambiano i dati reali della cena/spesa.
function distribuisciRestoCent(restoCent, partecipanti, totaleCorrente, cercaMinimo, segno) {
  if (!restoCent || restoCent <= 0) return [];
  const risultati = [];
  const rimanenti = [...partecipanti];
  const correnteLocale = { ...totaleCorrente };
  const unitVal = 0.01 * segno;
  const seed = hashStringToSeed(stableStringify({ partecipanti, totaleCorrente, restoCent, cercaMinimo, segno }));
  const rng = mulberry32(seed);
  for (let i = 0; i < restoCent && rimanenti.length > 0; i++) {
    const scelto = sceltaCasualeTraPari(rimanenti, correnteLocale, cercaMinimo, rng);
    risultati.push({ nome: scelto, valore: unitVal });
    correnteLocale[scelto] = (correnteLocale[scelto] || 0) + unitVal;
    rimanenti.splice(rimanenti.indexOf(scelto), 1);
  }
  return risultati;
}

// ---------- SOLATA / CONTROSOLATA (generico, riusato da cene e da spese) ----------
// "diff" = totale pagato - totale dovuto (di base).
//   diff > 0  -> è stato pagato di più del dovuto: il surplus ("solata") viene ridistribuito
//                in modo equo tra i partecipanti (aggiunto al loro dovuto).
//   diff < 0  -> è stato pagato di meno del dovuto: il deficit ("controsolata") viene
//                ridistribuito in modo equo tra i partecipanti (sottratto dal loro dovuto).
// Il resto non distribuibile in centesimi va, con lo stesso criterio in entrambi i casi,
// a chi sta spendendo di meno al momento del calcolo (usando "totaleCorrente"); a parità di
// importo speso, la persona viene scelta a caso tra chi è in pareggio.
// Restituisce null se non c'è nulla da ridistribuire (diff trascurabile).
function calcolaSolataControsolata(diff, partecipanti, totaleCorrente) {
  if (!partecipanti || partecipanti.length === 0 || Math.abs(diff) <= 0.005) return null;
  const positivo = diff > 0;
  const magnitudo = Math.abs(diff);
  const { shares, restoCent } = dividiInParti(magnitudo, partecipanti.length);
  const valori = {};
  // "valori" contiene SOLO le quote base (senza il resto): il resto va esclusivamente
  // nei centesimini, per non contarlo due volte (una nella colonna solata/controsolata
  // e una nei centesimini).
  partecipanti.forEach((nome, i) => { valori[nome] = positivo ? shares[i] : -shares[i]; });
  let restoInfoList = [];
  if (restoCent > 0) {
    // Solata (si aggiunge): ogni centesimo residuo va a chi sta spendendo di MENO.
    // Controsolata (si toglie): ogni centesimo residuo va tolto a chi sta spendendo di PIÙ.
    // Se i centesimi residui sono più di uno, vanno a persone DIVERSE (una a testa),
    // scelte a caso tra i pari a ogni passo — non tutti sulla stessa persona.
    restoInfoList = distribuisciRestoCent(restoCent, partecipanti, totaleCorrente, positivo, positivo ? 1 : -1);
  }
  return { tipo: positivo ? "solata" : "controsolata", importo: magnitudo, valori, restoInfoList };
}


// Aggiunge un contributo firmato alla "dettaglio" (elenco dei singoli addendi, usato per
// mostrare in tabella espressioni come "0.01+0.03-0.02") di una persona/categoria.
function aggiungiContributo(dettaglio, nome, valore) {
  if (!valore) return;
  if (!dettaglio[nome]) dettaglio[nome] = [];
  dettaglio[nome].push(valore);
}

// Formatta un elenco di contributi firmati come stringa tipo "0.01+0.03-0.02"
function formatEspressioneContributi(lista) {
  if (!lista || lista.length === 0) return "";
  return lista.map((v, i) => {
    const abs = Math.abs(v).toFixed(2);
    const segno = v < 0 ? "-" : (i === 0 ? "" : "+");
    return `${segno}${abs}`;
  }).join("");
}

// Calcola, per una cena, le quote derivanti dalle spese condivise, con arrotondamento equo:
// se una spesa "divisa" non si divide esattamente in centesimi, la parte non assegnabile
// viene aggiunta alla colonna "centesimini" della persona (tra i partecipanti a quella spesa)
// che, al momento del calcolo, sta spendendo meno.
// Restituisce { quoteColonna, quoteSeparate, centesiminiDettaglio }
function calcolaQuoteCondivise(persone, speseCondivise, sconti) {
  const quoteColonna = {};
  const quoteSeparate = {};
  const centesiminiDettaglio = {};
  const totaleCorrente = {};
  persone.forEach(p => {
    quoteColonna[p.nome] = {};
    quoteSeparate[p.nome] = {};
    totaleCorrente[p.nome] = totaleConSconti(p, sconti || {});
  });

  function assegna(nome, spesa, valore) {
    if (spesa.colonna) {
      if (quoteColonna[nome] !== undefined) {
        quoteColonna[nome][spesa.colonna] = (quoteColonna[nome][spesa.colonna] || 0) + valore;
      }
    } else {
      if (quoteSeparate[nome] !== undefined) quoteSeparate[nome][spesa.descrizione] = valore;
    }
    if (totaleCorrente[nome] !== undefined) {
      totaleCorrente[nome] += spesa.colonna ? applicaSconto(valore, spesa.colonna, sconti || {}) : valore;
    }
  }

  (speseCondivise || []).forEach(spesa => {
    let part = (spesa.partecipanti && spesa.partecipanti.length) ? spesa.partecipanti : persone.map(p => p.nome);
    part = part.filter(nome => totaleCorrente[nome] !== undefined);
    if (part.length === 0) return;

    if (spesa.tipo === "divisa") {
      const { shares, restoCent } = dividiInParti(spesa.importo, part.length);
      part.forEach((nome, i) => assegna(nome, spesa, shares[i]));
      if (restoCent > 0) {
        const restoList = distribuisciRestoCent(restoCent, part, totaleCorrente, true, 1);
        restoList.forEach(({ nome, valore }) => {
          quoteColonna[nome]["centesimini"] = (quoteColonna[nome]["centesimini"] || 0) + valore;
          aggiungiContributo(centesiminiDettaglio, nome, valore);
          totaleCorrente[nome] += valore;
        });
      }
    } else if (spesa.tipo === "persona") {
      part.forEach(nome => assegna(nome, spesa, spesa.importo));
    }
  });

  return { quoteColonna, quoteSeparate, centesiminiDettaglio };
}

// Totale dovuto da una persona in una cena (cibo/bevande/altro + quote condivise, con sconti)
function dovutoCena(p, sconti, quoteColonna, quoteSeparate) {
  let t = totaleConSconti(p, sconti);
  const qc = quoteColonna[p.nome] || {};
  const qs = quoteSeparate[p.nome] || {};
  for (const colonna in qc) t += applicaSconto(qc[colonna], colonna, sconti);
  for (const desc in qs) t += qs[desc];
  return t;
}

// Riconciliazione automatica (solata / controsolata): se il totale pagato al tavolo è
// diverso dal totale dovuto calcolato (cibo+bevande+altro+condivise), la differenza viene
// ridistribuita in modo equo tra tutti i partecipanti alla cena (colonna "solata" se si è
// pagato di più, "controsolata" se si è pagato di meno).
// "totPagato" è passato dal chiamante (somma di cena.pagatori): chi ha anticipato i soldi
// per la cena è ormai un elenco indipendente dai partecipanti (vedi calcolaQuoteComplete),
// quindi non si legge più da un campo "pagato" sulla singola persona.
function applicaSolataAutomatica(persone, sconti, quoteColonna, quoteSeparate, centesiminiDettaglio, totPagato) {
  if (persone.length === 0) return null;
  const dovutoBase = {};
  persone.forEach(p => { dovutoBase[p.nome] = dovutoCena(p, sconti, quoteColonna, quoteSeparate); });

  const totgen = Object.values(dovutoBase).reduce((a, b) => a + b, 0);
  const totpagato = totPagato || 0;
  const diff = totpagato - totgen;

  const nomi = persone.map(p => p.nome);
  const risultato = calcolaSolataControsolata(diff, nomi, dovutoBase);
  if (!risultato) return null;

  const colonna = risultato.tipo; // "solata" o "controsolata"
  persone.forEach(p => {
    const v = risultato.valori[p.nome];
    if (!v) return;
    quoteColonna[p.nome][colonna] = (quoteColonna[p.nome][colonna] || 0) + v;
    dovutoBase[p.nome] += v;
  });
  if (risultato.restoInfoList && risultato.restoInfoList.length) {
    risultato.restoInfoList.forEach(({ nome, valore }) => {
      quoteColonna[nome]["centesimini"] = (quoteColonna[nome]["centesimini"] || 0) + valore;
      if (centesiminiDettaglio) aggiungiContributo(centesiminiDettaglio, nome, valore);
    });
  }
  return { tipo: risultato.tipo, importo: risultato.importo, dovutoCorretto: totgen };
}

// Calcola tutte le quote di una cena (condivise + solata/controsolata automatiche)
function calcolaQuoteComplete(cena) {
  const { quoteColonna, quoteSeparate, centesiminiDettaglio } = calcolaQuoteCondivise(cena.persone, cena.speseCondivise, cena.sconti);
  // La solata/controsolata resta sempre attiva e si basa sul totale effettivamente anticipato
  // per la cena (anche da un eventuale pagatore esterno alla cena), ma la ridistribuzione viene
  // applicata ESCLUSIVAMENTE ai partecipanti reali (cena.persone): un pagatore esterno alla cena
  // non riceve mai solata/controsolata, resta sempre rimborsato per intero di quanto ha versato.
  const totPagato = (cena.pagatori || []).reduce((a, p) => a + (p.importo || 0), 0);
  const eventoSolata = applicaSolataAutomatica(cena.persone, cena.sconti, quoteColonna, quoteSeparate, centesiminiDettaglio, totPagato);
  return { quoteColonna, quoteSeparate, centesiminiDettaglio, eventoSolata };
}

// Genera le "spese NE" (Non Equo) da integrare nel registro spese generale,
// una per ogni persona che ha anticipato (pagato > 0) nella cena. Tutte le voci
// generate per la STESSA cena condividono lo stesso gruppoId: è fondamentale per
// calcolaStatoGlobale, che deve contare la quota dovuta (quote) una sola volta per
// cena e non una volta per ciascuna persona che ha anticipato (vedi più sotto).
function integraCenaInSpese(cena, gruppoId) {
  const { quoteColonna, quoteSeparate } = calcolaQuoteComplete(cena);
  const nomiCena = cena.persone.map(p => p.nome);
  const quoteCena = {};
  cena.persone.forEach(p => {
    quoteCena[p.nome] = dovutoCena(p, cena.sconti, quoteColonna, quoteSeparate);
  });

  // Chi ha anticipato i soldi per la cena è un elenco indipendente da chi vi partecipa
  // (cena.pagatori): una voce "[NE]" per ciascun pagatore, con "partecipanti" sempre pari
  // ai soli partecipanti alla cena, indipendentemente da chi ha pagato.
  const nuoveSpese = [];
  (cena.pagatori || []).forEach(pag => {
    if (pag.importo > 0) {
      nuoveSpese.push({
        nome: pag.nome,
        descrizione: cena.titolo + " [NE]",
        importo: pag.importo,
        partecipanti: [...nomiCena],
        quote: { ...quoteCena },
        gruppoId: gruppoId
      });
    }
  });
  return nuoveSpese;
}

// Divide una spesa "semplice" (equa, non di cena) tra i suoi partecipanti con arrotondamento
// equo: ogni quota è arrotondata per difetto al centesimo, il resto va a chi tra i
// partecipanti sta spendendo meno al momento (in base allo stato accumulato finora).
// Restituisce anche il contributo di resto (per la colonna centesimini) se presente.
function ripartisciSpesaSemplice(s, part, spesaEffettivaCorrente) {
  const { shares, restoCent } = dividiInParti(s.importo, part.length);
  const risultato = {};
  part.forEach((nome, i) => { risultato[nome] = shares[i]; });
  let restoInfoList = [];
  if (restoCent > 0) {
    restoInfoList = distribuisciRestoCent(restoCent, part, spesaEffettivaCorrente, true, 1);
    restoInfoList.forEach(({ nome, valore }) => { risultato[nome] += valore; });
  }
  return { risultato, restoInfoList };
}

// ---------- RIEPILOGO DI UN SINGOLO GRUPPO DI SPESA (equa o non equa) ----------
// Calcola, per un "gruppo" di spesa generica (spesa.gruppoId), la tabella completa:
// pagato/dovuto-di-base/solata/controsolata/centesimini/dovuto-finale/saldo per ciascun
// partecipante, più le transazioni consigliate per pareggiare SOLO quella spesa.
// - Se la spesa NON ha "quote" (equa): il dovuto di base è la divisione equa del totale
//   pagato tra i partecipanti (per costruzione pagato==dovuto sempre, quindi solata e
//   controsolata restano a zero: rimane solo l'eventuale centesimino di arrotondamento).
// - Se la spesa ha "quote" (non equa): il dovuto di base è la quota inserita manualmente
//   per ciascun partecipante; se la somma delle quote non coincide con il totale
//   anticipato, la differenza genera automaticamente una solata/controsolata.
function calcolaRiepilogoGruppoSpesa(gruppo) {
  // "partecipantiSpesa": chi deve effettivamente una quota di questa spesa. La divisione
  // dell'importo si basa ESCLUSIVAMENTE su questo elenco, indipendentemente da chi ha
  // anticipato i soldi: non è detto che chi paga una spesa vi debba anche partecipare.
  const partecipantiSpesa = [...new Set(gruppo.partecipanti || [])]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // "partecipanti": elenco completo da mostrare in tabella = partecipanti alla spesa +
  // eventuali pagatori esterni (che hanno anticipato senza parteciparvi: compaiono comunque
  // con dovuto 0 e saldo positivo pari a quanto hanno anticipato, dato che vanno rimborsati
  // per intero).
  const partecipanti = [...new Set([...partecipantiSpesa, ...gruppo.pagatori.map(p => p.nome)])]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const pagato = {};
  partecipanti.forEach(n => pagato[n] = 0);
  gruppo.pagatori.forEach(p => { if (pagato[p.nome] !== undefined) pagato[p.nome] += p.importo; });
  const totPagato = Object.values(pagato).reduce((a, b) => a + b, 0);

  const dovutoBase = {};
  partecipanti.forEach(n => dovutoBase[n] = 0);
  const centesiminiDettaglio = {};
  let restoEqua = null;
  if (gruppo.isNE) {
    partecipantiSpesa.forEach(n => dovutoBase[n] = (gruppo.quote && gruppo.quote[n]) || 0);
  } else if (partecipantiSpesa.length > 0) {
    const { risultato, restoInfoList } = ripartisciSpesaSemplice({ importo: totPagato }, partecipantiSpesa, {});
    partecipantiSpesa.forEach(n => dovutoBase[n] = risultato[n] || 0);
    if (restoInfoList && restoInfoList.length) {
      // ripartisciSpesaSemplice ha già sommato i centesimi dentro "risultato[nome]": li
      // separiamo da dovutoBase e li spostiamo nei centesimini, così vengono contati una
      // volta sola quando più sotto si ricompone dovutoFinale = dovutoBase + ... + centesimini.
      restoInfoList.forEach(({ nome, valore }) => {
        dovutoBase[nome] -= valore;
        aggiungiContributo(centesiminiDettaglio, nome, valore);
      });
      restoEqua = restoInfoList;
    }
  }

  const centesiminiPreEsistenti = Object.values(centesiminiDettaglio).reduce((a, lista) => a + lista.reduce((x, y) => x + y, 0), 0);
  const totDovutoBase = Object.values(dovutoBase).reduce((a, b) => a + b, 0) + centesiminiPreEsistenti;
  const diff = totPagato - totDovutoBase;
  const solata = {}, controsolata = {};
  partecipanti.forEach(n => { solata[n] = 0; controsolata[n] = 0; });
  // La solata/controsolata resta sempre attiva e si basa sul totale effettivamente versato
  // (anche da un eventuale pagatore esterno), ma la ridistribuzione va applicata ESCLUSIVAMENTE
  // ai partecipanti reali alla spesa: un pagatore esterno non riceve mai solata/controsolata,
  // il suo dovutoBase resta sempre 0 e il suo saldo resta sempre pari a quanto ha versato.
  const risultatoSC = calcolaSolataControsolata(diff, partecipantiSpesa, dovutoBase);
  let eventoSolata = null;
  if (risultatoSC) {
    partecipantiSpesa.forEach(n => {
      const v = risultatoSC.valori[n];
      if (!v) return;
      if (risultatoSC.tipo === "solata") solata[n] += v; else controsolata[n] += v;
    });
    if (risultatoSC.restoInfoList && risultatoSC.restoInfoList.length) {
      risultatoSC.restoInfoList.forEach(({ nome, valore }) => {
        aggiungiContributo(centesiminiDettaglio, nome, valore);
      });
    }
    eventoSolata = { tipo: risultatoSC.tipo, importo: risultatoSC.importo, dovutoCorretto: totDovutoBase };
  }

  const dovutoFinale = {}, saldi = {};
  const centesimini = {};
  partecipanti.forEach(n => { centesimini[n] = (centesiminiDettaglio[n] || []).reduce((a, b) => a + b, 0); });
  partecipanti.forEach(n => {
    dovutoFinale[n] = dovutoBase[n] + solata[n] + controsolata[n] + centesimini[n];
    saldi[n] = (pagato[n] || 0) - dovutoFinale[n];
  });

  const transazioni = calcolaTransazioni(saldi);
  const totali = {
    pagato: totPagato,
    dovuto: Object.values(dovutoFinale).reduce((a, b) => a + b, 0)
  };

  return { partecipanti, pagato, dovutoBase, solata, controsolata, centesimini, centesiminiDettaglio, dovutoFinale, saldi, transazioni, totali, eventoSolata };
}

// Pipeline completa: dato (persone, speseBase, rimborsi, cene) calcola tutto lo stato globale.
function calcolaStatoGlobale(persone, speseBase, rimborsiData, ceneData) {
  const nomi = [...persone].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // 1. aggiungi le spese "NE" derivanti da ogni cena, nell'ordine in cui compaiono
  let spese = [...speseBase];
  ceneData.forEach((cena, idx) => {
    spese = spese.concat(integraCenaInSpese(cena, `__cena_${idx}`));
  });

  // 2. totale pagato da ciascuno (somma di tutte le spese anticipate)
  const totaliPersona = {};
  nomi.forEach(n => totaliPersona[n] = 0);
  spese.forEach(s => {
    if (totaliPersona[s.nome] !== undefined) totaliPersona[s.nome] += s.importo;
  });

  // 3. spesa effettiva (quota dovuta) di ciascuno, con arrotondamento equo sulle spese divise
  //    IMPORTANTE: quando una spesa (o una cena) ha più persone che hanno anticipato i soldi,
  //    viene salvata come più voci nel registro (una per pagatore), ma tutte condividono lo
  //    stesso gruppoId e la STESSA mappa "quote" (quanto ciascuno deve in totale per quella
  //    spesa/cena). Va quindi sommata una sola volta per gruppo, non una volta per voce,
  //    altrimenti il dovuto di ognuno verrebbe moltiplicato per il numero di persone che hanno
  //    anticipato soldi per quella spesa.
  //
  //    Le voci "non eque" (con "quote") possono generare una solata/controsolata se il totale
  //    anticipato non coincide con la somma delle quote inserite manualmente (vedi
  //    calcolaRiepilogoGruppoSpesa). Questo aggiustamento va calcolato QUI, una sola volta per
  //    gruppo, e riusato sia per i totali generali (spesaEffettiva/saldi/transazioni) sia per
  //    la tabella di dettaglio di ogni spesa: altrimenti le due schede "Riepilogo" e "Spese in
  //    dettaglio" mostrerebbero numeri diversi per la stessa spesa.
  const gruppiNE = {};
  spese.forEach((s, i) => {
    if (!s.quote) return;
    const gid = s.gruppoId || `__voce_singola_${i}`;
    if (!gruppiNE[gid]) {
      gruppiNE[gid] = { gruppoId: gid, descrizione: s.descrizione, isNE: true, pagatori: [], quote: s.quote, partecipanti: s.partecipanti || [] };
    }
    gruppiNE[gid].pagatori.push({ nome: s.nome, importo: s.importo });
  });
  const riepilogoGruppi = {};
  Object.values(gruppiNE).forEach(g => { riepilogoGruppi[g.gruppoId] = calcolaRiepilogoGruppoSpesa(g); });

  const spesaEffettiva = {};
  nomi.forEach(n => spesaEffettiva[n] = 0);
  const gruppiQuoteGiaContati = new Set();
  // Parallelo a "spese": per ciascuna voce, le quote realmente calcolate per ciascun
  // partecipante (utile per mostrare il dettaglio "chi deve quanto" per ogni spesa/cena
  // nella scheda "Spese in dettaglio", con la STESSA logica di arrotondamento usata qui).
  const dettaglioSpese = [];
  spese.forEach((s, i) => {
    if (s.quote) {
      const gid = s.gruppoId || `__voce_singola_${i}`;
      const dovutoFinaleGruppo = riepilogoGruppi[gid].dovutoFinale;
      if (!gruppiQuoteGiaContati.has(gid)) {
        gruppiQuoteGiaContati.add(gid);
        for (const nome in dovutoFinaleGruppo) {
          if (spesaEffettiva[nome] !== undefined) spesaEffettiva[nome] += dovutoFinaleGruppo[nome];
        }
      }
      dettaglioSpese.push({ ...s, quoteCalcolate: dovutoFinaleGruppo });
    } else {
      const part = ((s.partecipanti && s.partecipanti.length) ? s.partecipanti : nomi).filter(n => spesaEffettiva[n] !== undefined);
      const { risultato } = ripartisciSpesaSemplice(s, part, spesaEffettiva);
      part.forEach(p => { spesaEffettiva[p] += risultato[p]; });
      dettaglioSpese.push({ ...s, quoteCalcolate: risultato });
    }
  });

  const totaleGenerale = Object.values(totaliPersona).reduce((a, b) => a + b, 0);

  // 4. saldi = pagato - dovuto + rimborsi dati - rimborsi ricevuti
  //    (derivato direttamente da spesaEffettiva, per garantire coerenza esatta con essa)
  const saldi = {};
  nomi.forEach(n => saldi[n] = (totaliPersona[n] || 0) - (spesaEffettiva[n] || 0));
  rimborsiData.forEach(r => {
    if (saldi[r.da] !== undefined) saldi[r.da] += r.importo;
    if (saldi[r.a] !== undefined) saldi[r.a] -= r.importo;
  });

  // 5. rimborsi effettuati per persona (dati / ricevuti)
  const rimborsatoDA = {}, rimborsatoA = {};
  nomi.forEach(n => { rimborsatoDA[n] = 0; rimborsatoA[n] = 0; });
  rimborsiData.forEach(r => {
    if (rimborsatoDA[r.da] !== undefined) rimborsatoDA[r.da] += r.importo;
    if (rimborsatoA[r.a] !== undefined) rimborsatoA[r.a] += r.importo;
  });

  // 6. transazioni ottimizzate per pareggiare i conti
  const transazioni = calcolaTransazioni(saldi);

  return { nomi, spese, dettaglioSpese, riepilogoGruppi, totaliPersona, spesaEffettiva, totaleGenerale, saldi, rimborsatoDA, rimborsatoA, transazioni };
}

function calcolaTransazioni(saldi) {
  // Soglia 0.005 (mezzo centesimo): serve solo a ignorare rumore di virgola mobile, NON a
  // ignorare un vero saldo di 1 centesimo. Con soglia 0.01 (sbagliata) un saldo di esattamente
  // -0.01/+0.01 veniva scartato e il relativo centesimo spariva dai rimborsi consigliati.
  const debitori = [];
  const creditori = [];
  for (const nome in saldi) {
    const s = saldi[nome];
    if (s < -0.005) debitori.push({ nome, importo: -s });
    else if (s > 0.005) creditori.push({ nome, importo: s });
  }
  debitori.sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase()));
  creditori.sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase()));

  const transazioni = [];
  let iD = 0, iC = 0;
  while (iD < debitori.length && iC < creditori.length) {
    const d = debitori[iD], c = creditori[iC];
    const imp = Math.min(d.importo, c.importo);
    if (imp > 0.005) transazioni.push({ da: d.nome, a: c.nome, importo: imp });
    d.importo -= imp;
    c.importo -= imp;
    if (d.importo < 0.005) iD++;
    if (c.importo < 0.005) iC++;
  }
  return transazioni;
}

// Calcolo dettagliato "tabellaTotali"/"tabellaRimborsi" per una singola cena
function calcolaDettaglioCena(cena) {
  const { quoteColonna, quoteSeparate, centesiminiDettaglio, eventoSolata } = calcolaQuoteComplete(cena);

  // Quanto ha anticipato ciascuno per questa cena (indipendente da chi vi partecipa)
  const pagatoPerNome = {};
  (cena.pagatori || []).forEach(p => { pagatoPerNome[p.nome] = (pagatoPerNome[p.nome] || 0) + (p.importo || 0); });

  const righe = cena.persone.map(p => {
    const dovuto = dovutoCena(p, cena.sconti, quoteColonna, quoteSeparate);
    const dovutoSenzaSconti = totaleSenzaSconti(p) +
      Object.values(quoteColonna[p.nome] || {}).reduce((a, b) => a + b, 0) +
      Object.values(quoteSeparate[p.nome] || {}).reduce((a, b) => a + b, 0);
    const pagato = pagatoPerNome[p.nome] || 0;
    const saldo = pagato - dovuto;
    return { nome: p.nome, dovuto, dovutoSenzaSconti, pagato, saldo };
  });

  // Eventuali pagatori che hanno anticipato soldi senza essere tra i partecipanti alla
  // cena: compaiono comunque in tabella, con dovuto 0 e saldo pari a quanto hanno pagato.
  const nomiPartecipanti = new Set(cena.persone.map(p => p.nome));
  Object.keys(pagatoPerNome).filter(n => !nomiPartecipanti.has(n)).forEach(nome => {
    const pagato = pagatoPerNome[nome];
    righe.push({ nome, dovuto: 0, dovutoSenzaSconti: 0, pagato, saldo: pagato });
  });

  const totgen = righe.reduce((a, r) => a + r.dovuto, 0);
  const totgenSenzaSconti = righe.reduce((a, r) => a + r.dovutoSenzaSconti, 0);
  const totpagato = righe.reduce((a, r) => a + r.pagato, 0);
  const hasSconti = Object.values(cena.sconti).some(v => v > 0);

  // transazioni interne alla cena (usa le spese condivise proprie della cena — fix di un bug
  // presente nell'originale, che usava sempre le speseCondivise dell'ULTIMA cena caricata)
  const saldiCena = {};
  righe.forEach(r => saldiCena[r.nome] = r.saldo);
  const transazioniCena = calcolaTransazioni(saldiCena);

  return { righe, totgen, totgenSenzaSconti, totpagato, hasSconti, transazioniCena, quoteColonna, quoteSeparate, centesiminiDettaglio, eventoSolata };
}
