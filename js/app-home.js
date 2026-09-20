// ============================================================
// app-home.js — rendering elenco eventi + form "crea nuovo evento"
// ============================================================

let EVENTI = [];
let renamingRepo = null; // slug della repo il cui rename-box è aperto, o null

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------- VALIDAZIONE E SICUREZZA TESTI INSERITI DALL'UTENTE ----------
// Stessa logica usata nel template dei singoli eventi (js/app.js): impedisce di
// salvare caratteri che romperebbero il rendering HTML della pagina.
const REGEX_CARATTERI_VIETATI = /[<>"'`\\]/;
function nomeValido(str) {
  return typeof str === "string" && str.length > 0 && !REGEX_CARATTERI_VIETATI.test(str);
}
function validaOAvvisa(str, nomeCampo) {
  if (!nomeValido(str)) {
    alert(`Il campo "${nomeCampo}" contiene un carattere non consentito (uno tra < > " ' \` \\ ). Rimuovilo e riprova: questi caratteri possono rompere il rendering del sito.`);
    return false;
  }
  return true;
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // rimuove accenti
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "evento";
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
  }, isError ? 7000 : 4000);
}

function setStatus(elId, msg, isError) {
  const box = document.querySelector(elId);
  box.textContent = msg;
  box.className = "status " + (isError ? "status-error" : "status-ok");
  showToast(msg, isError);
}

// ---------- caricamento + rendering elenco eventi (letto live dall'organization) ----------
async function loadEventi() {
  try {
    EVENTI = await GH_HOME.listEventRepos();
  } catch (e) {
    EVENTI = [];
    showToast(e.message, true);
  }
}

function renderListaEventi() {
  const box = document.querySelector("#lista-eventi");
  box.innerHTML = "";
  if (EVENTI.length === 0) {
    box.innerHTML = `<div class="empty-note">Nessun evento creato ancora.</div>`;
    return;
  }
  const haToken = !!GH_HOME.getToken();
  EVENTI.forEach((ev) => {
    const row = el("div", "list-row");
    const data = ev.creato ? new Date(ev.creato).toLocaleDateString("it-IT") : "";
    const isRenaming = renamingRepo === ev.repo;

    if (isRenaming) {
      row.innerHTML = `
        <div class="rename-box">
          <span class="rename-label">Nome visualizzato</span>
          <input type="text" class="rn-nome" value="${escapeHtml(ev.nome)}">
          <span class="rename-label">Nome repository (URL del sito)</span>
          <input type="text" class="rn-slug" value="${escapeHtml(ev.repo)}">
        </div>
        <div class="list-actions">
          <button class="btn-icon edit" type="button">Salva</button>
          <button class="btn-icon" type="button" data-annulla>Annulla</button>
        </div>`;
      row.querySelector(".edit").addEventListener("click", () => {
        const nuovoNome = row.querySelector(".rn-nome").value.trim();
        const nuovoSlug = row.querySelector(".rn-slug").value.trim();
        salvaRinominaEvento(ev, nuovoNome, nuovoSlug);
      });
      row.querySelector("[data-annulla]").addEventListener("click", () => {
        renamingRepo = null;
        renderListaEventi();
      });
      box.appendChild(row);
      return;
    }

    const azioni = haToken ? `
      <div class="list-actions">
        <button class="btn-icon edit" data-repo="${escapeHtml(ev.repo)}" type="button">Rinomina</button>
        <button class="btn-icon delete" data-repo="${escapeHtml(ev.repo)}" data-nome="${escapeHtml(ev.nome)}" type="button">Elimina evento</button>
      </div>` : "";
    row.innerHTML = `
      <div class="list-main">
        <a href="${escapeHtml(ev.url)}"><strong>${escapeHtml(ev.nome)}</strong></a>
        <div class="list-sub">${escapeHtml(ev.repo)} — creato il ${data}</div>
      </div>
      ${azioni}`;
    box.appendChild(row);
  });

  box.querySelectorAll('.edit[data-repo]').forEach(btn => {
    btn.addEventListener("click", () => {
      renamingRepo = btn.dataset.repo;
      renderListaEventi();
    });
  });
  box.querySelectorAll('.delete[data-repo]').forEach(btn => {
    btn.addEventListener("click", () => eliminaEvento(btn.dataset.repo, btn.dataset.nome));
  });
}

async function salvaRinominaEvento(ev, nuovoNome, nuovoSlug) {
  if (!nuovoNome || !nuovoSlug) { showToast("Compila sia il nome che il nome repository.", true); return; }
  if (!validaOAvvisa(nuovoNome, "Nome visualizzato")) return;
  const slugPulito = slugify(nuovoSlug);
  if (slugPulito !== nuovoSlug) {
    if (!confirm(`Il nome repository verrà normalizzato in "${slugPulito}" (solo lettere minuscole, numeri e trattini). Continuare?`)) return;
    nuovoSlug = slugPulito;
  }

  const nomeCambiato = nuovoNome !== ev.nome;
  const slugCambiato = nuovoSlug !== ev.repo;
  if (!nomeCambiato && !slugCambiato) { renamingRepo = null; renderListaEventi(); return; }

  if (slugCambiato) {
    const msg = `Stai per rinominare la repository GitHub da "${ev.repo}" a "${nuovoSlug}".\n\nL'indirizzo del sito cambierà in https://${CONFIG_HOME.org}.github.io/${nuovoSlug}/ — eventuali link già condivisi al vecchio indirizzo smetteranno di funzionare dopo un certo periodo di transizione. Continuare?`;
    if (!confirm(msg)) return;
  }

  try {
    showToast("Rinomino l'evento...", false);
    await GH_HOME.rinominaEvento(ev.repo, slugCambiato ? nuovoSlug : null, nomeCambiato ? nuovoNome : null, (m) => showToast(m, false));
    showToast("Evento rinominato!", false);
    renamingRepo = null;
    await loadEventi();
    renderListaEventi();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function eliminaEvento(repoName, nomeEvento) {
  const ok = confirm(`Eliminare DEFINITIVAMENTE l'evento "${nomeEvento}"?\n\nVerrà eliminata la repository "${repoName}" da GitHub insieme a tutti i suoi dati (persone, spese, rimborsi, cene). Questa azione non si può annullare.`);
  if (!ok) return;

  try {
    await GH_HOME.deleteRepo(repoName);
    showToast(`Evento "${nomeEvento}" eliminato.`, false);
    await loadEventi();
    renderListaEventi();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- form "crea nuovo evento" ----------
function updateTokenStatusHome() {
  const box = document.querySelector("#status-token-home");
  if (GH_HOME.getToken()) {
    box.textContent = "✅ Token amministratore impostato su questo browser.";
    box.className = "status status-ok";
  } else {
    box.textContent = "Nessun token impostato: non potrai creare, rinominare o eliminare eventi.";
    box.className = "status status-error";
  }
}

async function submitEvento(e) {
  e.preventDefault();
  const nome = document.querySelector("#f-evento-nome").value.trim();
  const slug = document.querySelector("#f-evento-slug").value.trim();
  if (!nome || !slug) { setStatus("#status-evento", "Compila nome e slug.", true); return; }
  if (!validaOAvvisa(nome, "Nome evento")) return;
  if (!GH_HOME.getToken()) { setStatus("#status-evento", "Inserisci prima il token amministratore.", true); return; }

  const btn = document.querySelector("#btn-evento-submit");
  btn.disabled = true;
  const originalText = btn.textContent;

  try {
    await GH_HOME.creaNuovoEvento(nome, slug, (msg) => {
      btn.textContent = msg;
      setStatus("#status-evento", msg, false);
    });

    setStatus("#status-evento", `Evento creato! Il sito sarà visibile tra qualche minuto su https://${CONFIG_HOME.org}.github.io/${slug}/`, false);
    document.querySelector("#f-evento-form").reset();
    await loadEventi();
    renderListaEventi();
  } catch (err) {
    setStatus("#status-evento", err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", async () => {
  await loadEventi();
  renderListaEventi();

  const nomeInput = document.querySelector("#f-evento-nome");
  const slugInput = document.querySelector("#f-evento-slug");
  let slugTouchedManually = false;
  slugInput.addEventListener("input", () => { slugTouchedManually = true; });
  nomeInput.addEventListener("input", () => {
    if (!slugTouchedManually) slugInput.value = slugify(nomeInput.value);
  });

  document.querySelector("#f-evento-form").addEventListener("submit", submitEvento);

  const tokenInput = document.querySelector("#gh-token-home");
  tokenInput.value = GH_HOME.getToken();
  updateTokenStatusHome();
  const tokenBox = document.querySelector("#token-box");
  document.querySelector("#token-box-toggle").addEventListener("click", () => {
    tokenBox.classList.toggle("collapsed");
  });
  document.querySelector("#btn-toggle-token-home").addEventListener("click", () => {
    tokenInput.type = tokenInput.type === "password" ? "text" : "password";
  });
  document.querySelector("#btn-copy-token-home").addEventListener("click", async () => {
    if (!tokenInput.value) { showToast("Nessun token da copiare.", true); return; }
    try {
      await navigator.clipboard.writeText(tokenInput.value);
    } catch (e) {
      tokenInput.select();
      document.execCommand("copy");
    }
    showToast("Token copiato negli appunti.", false);
  });
  document.querySelector("#btn-save-token-home").addEventListener("click", () => {
    GH_HOME.setToken(tokenInput.value.trim());
    updateTokenStatusHome();
    renderListaEventi();
    showToast(GH_HOME.getToken() ? "Token amministratore salvato." : "Token rimosso.", false);
  });
  document.querySelector("#btn-clear-token-home").addEventListener("click", () => {
    GH_HOME.setToken("");
    tokenInput.value = "";
    updateTokenStatusHome();
    renderListaEventi();
    showToast("Token rimosso.", false);
  });

  if (CONFIG_HOME.owner === "TUO-USERNAME-GITHUB" || CONFIG_HOME.org === "TUA-ORGANIZATION-EVENTI") {
    document.querySelector("#config-warning-home").style.display = "block";
  }
});
