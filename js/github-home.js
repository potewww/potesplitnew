// ============================================================
// github-home.js — gestisce:
//  1) lettura live delle repository dell'organization CONFIG_HOME.org
//     (fonte di verità unica per l'elenco eventi, nessun file separato)
//  2) creazione di nuove repository nell'organization
//  3) copia dei file da "template/" (in questa repo) nella nuova repo
//  4) attivazione di GitHub Pages sulla nuova repo
//  5) eliminazione di una repository evento
//  6) rinomina di un evento: nome della repository GitHub, nome visualizzato
//     nella home e titolo mostrato all'interno del sito del singolo evento
//
// Il token amministratore è tenuto in una chiave di localStorage
// diversa da quella usata dai singoli eventi (vedi js/github.js nel
// template), così non c'è alcun rischio di confusione tra i due.
// ============================================================

const GH_HOME = {
  get owner() { return CONFIG_HOME.owner; },
  get repo() { return CONFIG_HOME.repo; },
  get branch() { return CONFIG_HOME.branch || "main"; },
  get org() { return CONFIG_HOME.org; },

  getToken() {
    return localStorage.getItem("gh_token_home_admin") || "";
  },
  setToken(t) {
    if (t) localStorage.setItem("gh_token_home_admin", t);
    else localStorage.removeItem("gh_token_home_admin");
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

  contentsUrl(owner, repo, path) {
    return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  },

  // I crawler dei social (WhatsApp, Telegram, ecc.) leggono l'HTML statico di index.html senza
  // eseguire JavaScript: perché l'anteprima del link mostri il titolo scelto per l'evento, il
  // file index.html copiato/aggiornato nella repo dell'evento deve avere <title>, og:title e
  // twitter:title già sostituiti con quel titolo (non basta scriverlo in data/config.json,
  // che viene letto solo lato client dal sito dell'evento già aperto).
  sostituisciTagTitolo(html, titolo) {
    const t = String(titolo)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return html
      .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*("[^>]*>)/, `$1${t}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*("[^>]*>)/, `$1${t}$2`);
  },

  // ---------- lettura di un file da template/ (su questa repo, "home") ----------
  async readTemplateFile(path) {
    const res = await fetch(this.contentsUrl(this.owner, this.repo, `template/${path}`) + `?ref=${this.branch}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Impossibile leggere template/${path} (errore ${res.status}). Controlla che la cartella "template" esista in questa repo.`);
    const data = await res.json();
    return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
  },

  // Elenco fisso dei file che compongono un progetto evento (deve combaciare con template/)
  templateFiles: [
    "index.html",
    "css/style.css",
    "js/calc.js",
    "js/github.js",
    "js/app.js",
    "data/persone.json",
    "data/spese.json",
    "data/rimborsi.json",
    "data/cene.json"
    // "js/config.js" e "data/config.json" vengono generati su misura, non copiati
  ],

  // ---------- creazione repo + copia file + Pages ----------
  async createRepoInOrg(name) {
    const res = await fetch(`https://api.github.com/orgs/${this.org}/repos`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        private: false,
        auto_init: true,
        description: `Evento creato da ${this.repo}`
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 422) throw new Error(`Esiste già una repository chiamata "${name}" nell'organization. Scegli un nome diverso.`);
      if (res.status === 401 || res.status === 403) throw new Error(`Token non valido o senza permessi per creare repository nell'organization "${this.org}" (errore ${res.status}).`);
      if (res.status === 404) throw new Error(`Organization "${this.org}" non trovata. Controlla js/config.js.`);
      throw new Error(`Errore creazione repository: ${res.status} ${err.message || ""}`);
    }
    return await res.json();
  },

  async putFileInRepo(repoName, path, contentStr, message, branch) {
    const url = this.contentsUrl(this.org, repoName, path);
    let sha;
    try {
      const cur = await fetch(url + `?ref=${branch}`, { headers: this.headers() });
      if (cur.ok) { const d = await cur.json(); sha = d.sha; }
    } catch (e) { /* file non esistente, va bene */ }
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(contentStr))),
      branch
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Errore scrittura ${path} sul nuovo repo: ${res.status} ${err.message || ""}`);
    }
    return await res.json();
  },

  // Legge un file di testo grezzo di un evento (usato per index.html in fase di rinomina)
  async readTextFromRepo(repoName, path, branch) {
    const res = await fetch(this.contentsUrl(this.org, repoName, path) + `?ref=${branch}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Impossibile leggere ${path} dalla repository "${repoName}" (errore ${res.status}).`);
    const data = await res.json();
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
    return { text: content, sha: data.sha };
  },

  // Legge un file JSON di un evento (usato per leggere/aggiornare data/config.json in rinomina)
  async readJSONFromRepo(repoName, path, branch) {
    const { text, sha } = await this.readTextFromRepo(repoName, path, branch);
    return { json: JSON.parse(text), sha };
  },

  // Elimina la repository GitHub dell'evento. Richiede lo scope "delete_repo"
  // sul token amministratore, oltre a "repo" — se manca, GitHub risponde 403
  // e qui lo trasformiamo in un messaggio comprensibile, senza far fallire
  // silenziosamente l'operazione.
  async deleteRepo(repoName) {
    const res = await fetch(`https://api.github.com/repos/${this.org}/${repoName}`, {
      method: "DELETE",
      headers: this.headers()
    });
    if (!res.ok && res.status !== 404) {
      if (res.status === 403) {
        throw new Error(`Il token amministratore non ha il permesso di eliminare repository (serve anche lo scope "delete_repo", non solo "repo"). La repository NON è stata eliminata su GitHub; l'ho comunque rimossa dall'elenco della home.`);
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(`Errore eliminazione repository: ${res.status} ${err.message || ""}`);
    }
  },

  // Recupera le info correnti di una repository evento (usato per leggere il default_branch
  // prima di rinominare, e per rilevare se il nuovo slug è già occupato).
  async getRepoInfo(repoName) {
    const res = await fetch(`https://api.github.com/repos/${this.org}/${repoName}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Repository "${repoName}" non trovata (errore ${res.status}).`);
    return await res.json();
  },

  // Rinomina la repository GitHub dell'evento (cambia solo il nome tecnico/URL della repo,
  // GitHub redirige automaticamente le vecchie API/URL per un periodo di transizione ma
  // è comunque consigliato aggiornare subito i riferimenti interni, vedi rinominaEvento).
  async renameRepoRemoto(oldSlug, newSlug) {
    const res = await fetch(`https://api.github.com/repos/${this.org}/${oldSlug}`, {
      method: "PATCH",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSlug })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 422) throw new Error(`Esiste già una repository chiamata "${newSlug}" nell'organization. Scegli un nome diverso.`);
      if (res.status === 401 || res.status === 403) throw new Error(`Token non valido o senza permessi per rinominare repository nell'organization "${this.org}" (errore ${res.status}).`);
      if (res.status === 404) throw new Error(`Repository "${oldSlug}" non trovata.`);
      throw new Error(`Errore rinomina repository: ${res.status} ${err.message || ""}`);
    }
    return await res.json();
  },

  // Pipeline completa di rinomina: repo GitHub + js/config.js (che contiene il nome
  // della repo hardcoded) + titolo mostrato all'interno del sito (data/config.json).
  // nuovoSlug può coincidere con quello attuale se si vuole cambiare solo il titolo.
  async rinominaEvento(slugAttuale, nuovoSlug, nuovoTitolo, onProgress) {
    if (!this.getToken()) throw new Error("Nessun token amministratore impostato.");
    const progress = onProgress || (() => {});

    const info = await this.getRepoInfo(slugAttuale);
    const branch = info.default_branch || "main";
    let slugFinale = slugAttuale;

    if (nuovoSlug && nuovoSlug !== slugAttuale) {
      progress("Rinomino la repository su GitHub...");
      await this.renameRepoRemoto(slugAttuale, nuovoSlug);
      slugFinale = nuovoSlug;

      progress("Aggiorno la configurazione interna del sito...");
      const configJsContent =
`const CONFIG = {
  owner: "${this.org}",
  repo: "${slugFinale}",
  branch: "${branch}",
  homeUrl: "https://${this.owner}.github.io/${this.repo}/"
};
`;
      await this.putFileInRepo(slugFinale, "js/config.js", configJsContent, "Aggiorna nome repository dopo rinomina", branch);
    }

    if (nuovoTitolo) {
      progress("Aggiorno il titolo del sito...");
      let configJson;
      try {
        const cur = await this.readJSONFromRepo(slugFinale, "data/config.json", branch);
        configJson = { ...cur.json, titolo: nuovoTitolo };
      } catch (e) {
        configJson = { titolo: nuovoTitolo, credenziali: [] };
      }
      await this.putFileInRepo(slugFinale, "data/config.json", JSON.stringify(configJson, null, 2), "Aggiorna titolo evento", branch);

      // Aggiorna anche <title>/og:title/twitter:title dentro index.html: sono letti dai
      // crawler dei social (WhatsApp, ecc.) direttamente dall'HTML statico, senza eseguire
      // JavaScript, quindi non basta il titolo salvato in data/config.json.
      try {
        const { text: htmlAttuale } = await this.readTextFromRepo(slugFinale, "index.html", branch);
        const htmlAggiornato = this.sostituisciTagTitolo(htmlAttuale, nuovoTitolo);
        await this.putFileInRepo(slugFinale, "index.html", htmlAggiornato, "Aggiorna titolo evento nella pagina", branch);
      } catch (e) {
        throw new Error(`Titolo salvato in data/config.json, ma non è stato possibile aggiornare index.html (${e.message}). L'anteprima del link potrebbe restare quella vecchia.`);
      }
    }

    return {
      repo: slugFinale,
      url: `https://${this.org}.github.io/${slugFinale}/`
    };
  },

  // Elenca le repository dell'organization: è la fonte di verità unica per
  // gli eventi (nessun file eventi.json separato da tenere sincronizzato).
  async listEventRepos() {
    const res = await fetch(`https://api.github.com/orgs/${this.org}/repos?per_page=100&sort=created&direction=desc`, { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Organization "${this.org}" non trovata. Controlla js/config.js.`);
      throw new Error(`Errore lettura repository dell'organization: ${res.status}`);
    }
    const repos = await res.json();
    // Per ciascun repo, legge data/config.json via raw.githubusercontent.com (pubblico,
    // non consuma la rate limit delle API GitHub) per mostrare il titolo dell'evento
    // invece del solo nome tecnico del repository.
    const eventi = await Promise.all(repos.map(async (r) => {
      let nome = r.name;
      try {
        const rawRes = await fetch(`https://raw.githubusercontent.com/${this.org}/${r.name}/${r.default_branch}/data/config.json`);
        if (rawRes.ok) {
          const cfg = await rawRes.json();
          if (cfg.titolo) nome = cfg.titolo;
        }
      } catch (e) { /* usa il nome del repository come fallback */ }
      return {
        nome,
        repo: r.name,
        url: `https://${this.org}.github.io/${r.name}/`,
        creato: r.created_at
      };
    }));
    return eventi;
  },

  async enablePages(repoName, branch) {
    const res = await fetch(`https://api.github.com/repos/${this.org}/${repoName}/pages`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ source: { branch, path: "/" } })
    });
    // 409 = Pages già attiva su questo repo: non è un errore bloccante
    if (!res.ok && res.status !== 409) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Repository creata, ma attivazione di GitHub Pages fallita: ${res.status} ${err.message || ""}. Puoi attivarla a mano da Settings → Pages sulla nuova repo.`);
    }
  },

  // Pipeline completa: crea repo, copia template, configura, attiva Pages
  async creaNuovoEvento(nomeVisualizzato, slug, onProgress) {
    if (!this.getToken()) throw new Error("Nessun token amministratore impostato.");
    const progress = onProgress || (() => {});

    progress("Creo la repository...");
    const repoInfo = await this.createRepoInOrg(slug);
    const branch = repoInfo.default_branch || "main";

    progress("Copio i file del progetto...");
    for (const path of this.templateFiles) {
      let content = await this.readTemplateFile(path);
      // index.html arriva dal template col titolo placeholder ("Rimborsi"): lo sostituiamo
      // subito col nome scelto per l'evento, così l'anteprima del link è corretta da subito.
      if (path === "index.html") content = this.sostituisciTagTitolo(content, nomeVisualizzato);
      await this.putFileInRepo(slug, path, content, "Inizializza da template", branch);
    }

    progress("Configuro la repository...");
    const configJsContent =
`const CONFIG = {
  owner: "${this.org}",
  repo: "${slug}",
  branch: "${branch}",
  homeUrl: "https://${this.owner}.github.io/${this.repo}/"
};
`;
    await this.putFileInRepo(slug, "js/config.js", configJsContent, "Configura repository", branch);

    const configJsonContent = JSON.stringify({ titolo: nomeVisualizzato, credenziali: [] }, null, 2);
    await this.putFileInRepo(slug, "data/config.json", configJsonContent, "Imposta titolo evento", branch);

    progress("Attivo GitHub Pages...");
    await this.enablePages(slug, branch);

    return {
      nome: nomeVisualizzato,
      repo: slug,
      url: `https://${this.org}.github.io/${slug}/`,
      creato: new Date().toISOString()
    };
  }
};
