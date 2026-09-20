// ============================================================
// github.js — lettura/scrittura dei file data/*.json su GitHub
// via Contents API, usando un Personal Access Token inserito
// dall'utente (tenuto solo in sessionStorage, mai salvato altrove).
// ============================================================

const GH = {
  get owner() { return CONFIG.owner; },
  get repo() { return CONFIG.repo; },
  get branch() { return CONFIG.branch || "main"; },

  // La chiave include owner/repo: siti diversi ospitati sotto lo stesso dominio
  // (es. più eventi su org.github.io/evento1/, org.github.io/evento2/) condividono
  // lo stesso localStorage a livello di browser (è per-origine, non per-percorso).
  // Senza questa distinzione, salvare il token per un evento sovrascriverebbe
  // silenziosamente quello di un altro evento aperto nello stesso browser.
  get tokenKey() {
    return `gh_token_${this.owner}_${this.repo}`;
  },
  getToken() {
    return localStorage.getItem(this.tokenKey) || "";
  },
  setToken(t) {
    if (t) localStorage.setItem(this.tokenKey, t);
    else localStorage.removeItem(this.tokenKey);
  },

  apiUrl(path) {
    return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`;
  },

  headers() {
    const h = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const t = this.getToken();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  },

  // Legge un file di testo grezzo dal repo (usato anche in sola lettura, senza token, per la
  // vista pubblica). readJSON si appoggia a questo e fa JSON.parse del contenuto.
  async readText(path) {
    const res = await fetch(this.apiUrl(path) + `?ref=${this.branch}`, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Repository o file non trovato (${this.owner}/${this.repo}/${path}). Controlla js/config.js.`);
      if (res.status === 401 || res.status === 403) throw new Error(`Token non valido o senza permessi sufficienti (errore ${res.status}).`);
      throw new Error(`Errore lettura ${path}: ${res.status}`);
    }
    const data = await res.json();
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
    return { text: content, sha: data.sha };
  },

  async readJSON(path) {
    const { text, sha } = await this.readText(path);
    return { json: JSON.parse(text), sha };
  },

  // Scrive (crea o aggiorna) un file di testo grezzo nel repo. writeJSON si appoggia a questo.
  async writeText(path, text, message) {
    if (!this.getToken()) throw new Error("Nessun token GitHub impostato. Vai in cima alla pagina \"Gestisci dati\" e inseriscilo.");
    if (this.owner === "TUO-USERNAME-GITHUB" || this.repo === "TUO-REPO") {
      throw new Error("js/config.js non è ancora stato configurato con il tuo username/repo GitHub.");
    }
    let sha;
    try {
      const cur = await this.readText(path);
      sha = cur.sha;
    } catch (e) {
      sha = undefined; // file non esiste ancora
    }
    const content = btoa(unescape(encodeURIComponent(text)));
    const body = { message, content, branch: this.branch };
    if (sha) body.sha = sha;

    const res = await fetch(this.apiUrl(path), {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) throw new Error(`Token non valido o senza permesso "Contents: Read and write" su questo repo (errore ${res.status}).`);
      if (res.status === 404) throw new Error(`Repository non trovato (${this.owner}/${this.repo}). Controlla js/config.js.`);
      throw new Error(`Errore scrittura ${path}: ${res.status} ${err.message || ""}`);
    }
    return await res.json();
  },

  async writeJSON(path, obj, message) {
    return this.writeText(path, JSON.stringify(obj, null, 2), message);
  }
};
