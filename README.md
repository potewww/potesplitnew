# Sito Rimborsi — Home + Template eventi

Questo pacchetto contiene **due cose diverse dentro un'unica repository**:

- `home/` → la pagina che elenca i tuoi eventi e ti permette di crearne di nuovi
  (va caricata alla **radice** della repository)
- `template/` → il progetto vuoto (identico a un sito "rimborsi" singolo) usato
  come sorgente ogni volta che crei un nuovo evento

Gli **eventi** (le singole cene/serate con i loro rimborsi) vivono ciascuno nella
propria repository GitHub, dentro una **organization** dedicata — così ogni evento
ha un token di accesso completamente separato dagli altri.

## 1. Crea la Organization per gli eventi

1. GitHub → icona profilo → **Your organizations** → **New organization**.
2. Scegli il piano gratuito ("Free"), dai un nome (es. `prixpartager-eventi`).
   Questo nome comparirà nell'URL di ogni evento: `https://<nome-org>.github.io/<evento>/`.
3. Sei automaticamente owner: puoi creare repository al suo interno.

## 2. Crea la repository "home"

1. Crea una nuova repository **pubblica** sul tuo account personale (es. `prixpartager-home`).
   Deve essere pubblica per poter usare GitHub Pages gratuitamente.
2. Carica dentro **tutto il contenuto della cartella `home/`** (non la cartella
   `home` stessa: il suo *contenuto* va alla radice della repo) e **tutta la
   cartella `template/` così com'è** (questa sì, come sottocartella `template/`).

   Struttura finale attesa nella repo:
   ```
   index.html          (da home/index.html)
   css/style.css        (da home/css/style.css)
   js/config.js          (da home/js/config.js)
   js/github-home.js
   js/app-home.js
   template/
     index.html
     css/style.css
     js/config.js
     js/calc.js
     js/github.js
     js/app.js
     data/persone.json
     data/spese.json
     data/rimborsi.json
     data/cene.json
     data/config.json
   ```

   Nota: **non serve più un `data/eventi.json`** nella home — l'elenco eventi viene
   letto in tempo reale interrogando direttamente le repository presenti
   nell'organization (vedi sezione "Sincronizzazione" più sotto), quindi un
   evento compare o sparisce dalla home automaticamente insieme alla sua
   repository, senza bisogno di tenere una lista separata aggiornata.

3. Attiva GitHub Pages: Settings → Pages → Source: "Deploy from a branch" →
   Branch `main` / cartella `/ (root)`.
   Dopo qualche minuto la home sarà visibile su `https://<tuo-username>.github.io/<nome-repo>/`.

## 3. Configura `js/config.js` della home

Apri `js/config.js` (quello alla radice, non quello dentro `template/`) e imposta:

```js
const CONFIG_HOME = {
  owner: "tuo-username-github",
  repo: "prixpartager-home",
  branch: "main",
  org: "prixpartager-eventi"   // il nome della organization creata al punto 1
};
```

## 4. Crea il token amministratore (solo per te)

Questo token serve a creare/eliminare repository e attivare Pages: ha bisogno di
permessi ampi sull'organization, quindi **non va mai condiviso** con i
partecipanti agli eventi.

### Opzione raccomandata: fine-grained token scoped alla sola organization

Questa opzione è più sicura perché il token **non può toccare in alcun modo** i
tuoi repository personali — è limitato per costruzione alla sola organization.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. **Resource owner**: seleziona la tua organization (es. `potesplit-events`),
   non il tuo profilo personale.
3. **Expiration**: seleziona **"No expiration"** se vuoi che il token non scada
   mai. Attenzione però: le organization hanno di default una policy che
   impone comunque una durata massima di 366 giorni ai fine-grained token —
   dato che sei tu il proprietario di `potesplit-events`, puoi disattivarla da
   organization → **Settings** → **Personal access tokens** → scheda
   **Fine-grained tokens** → disattiva/allarga "Maximum lifetime". Senza questo
   passaggio, anche scegliendo "No expiration" il token verrebbe comunque
   bloccato dopo un anno.
4. **Repository access**: **All repositories** (deve essere "tutti" perché i
   repository dei nuovi eventi non esistono ancora al momento della creazione
   del token, quindi non puoi selezionarli uno per uno).
5. **Permissions**:
   - Organization permissions → **Administration**: Read and write (serve per
     creare/eliminare repository nell'organization)
   - Repository permissions → **Contents**: Read and write (per scrivere i file)
   - Repository permissions → **Pages**: Read and write (per attivare GitHub Pages)
6. Genera e copia il token, poi incollalo nella sezione "Amministrazione" della
   home e premi "Salva token".

Un token che non scade mai è comodo ma resta un rischio permanente se mai
esposto per errore: tienilo in un password manager, non in chiaro da nessuna
parte, e ricordati che puoi revocarlo in qualsiasi momento da Developer
settings → Fine-grained tokens se sospetti sia stato compromesso.

Se in seguito ricevi un errore 403 nonostante questi permessi, la risposta di
GitHub include un header (`X-Accepted-GitHub-Permissions`) che indica
esattamente quale permesso manca: aggiungilo al token (o rigeneralo).

### Alternativa più semplice ma meno sicura: token classico

Se il fine-grained ti dà problemi (es. l'organization non ha ancora abilitato
l'accesso fine-grained, o ricevi errori di permesso poco chiari), puoi usare un
PAT classico con scope `repo` — più semplice da configurare, ma con accesso
completo a **tutti** i tuoi repository, personali e non solo dell'organization.
Va bene solo se sei sicuro di tenerlo ben protetto.

## 5. Token per i partecipanti di un singolo evento

Per ogni evento creato, genera un token **diverso e più ristretto**, da dare solo
a chi organizza quell'evento specifico:

1. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Resource owner: la organization (es. `prixpartager-eventi`).
3. Repository access: **Only select repositories** → scegli solo la repo di
   quell'evento.
4. Permissions → **Contents: Read and write**.
5. Genera e consegna il token a chi gestirà quell'evento: potrà solo modificare
   i dati di **quella** repository, non delle altre né della home.

## Come funziona la creazione di un evento

Quando premi "Crea evento" nella home, in sequenza:

1. Viene creata una nuova repository pubblica nell'organization.
2. Vengono copiati i file da `template/` nella nuova repo.
3. `js/config.js` e `data/config.json` della nuova repo vengono generati su
   misura (owner/repo corretti, titolo dell'evento).
4. Viene attivata GitHub Pages sulla nuova repo (source: root del branch principale).
5. La home ricarica l'elenco eventi interrogando direttamente l'organization
   (vedi sotto), così il nuovo evento compare subito.

Il sito del nuovo evento sarà raggiungibile dopo qualche minuto su:
`https://<organization>.github.io/<nome-repo-evento>/`

## Sincronizzazione: l'elenco eventi rispecchia sempre le repository esistenti

La home **non tiene un elenco eventi salvato a parte**: ogni volta che carichi
la pagina, interroga in tempo reale l'elenco delle repository presenti
nell'organization (`GET /orgs/<org>/repos`) e per ciascuna legge il titolo da
`data/config.json` (via `raw.githubusercontent.com`, così non consuma la rate
limit delle API GitHub). Questo significa:

- Un evento è visibile sulla home **se e solo se** la sua repository esiste
  nell'organization — non c'è modo di "nascondere" un evento dalla home
  lasciando intatta la repository.
- Il bottone **"Elimina evento"** (visibile solo con il token amministratore
  inserito) cancella la repository su GitHub e, di conseguenza, l'evento
  sparisce dalla home al ricaricamento successivo. È un'azione distruttiva e
  irreversibile: viene richiesta una conferma esplicita prima di procedere.
  Richiede lo scope/permesso di eliminazione sul token (vedi sezione 4): se
  manca, ricevi un errore chiaro invece che un fallimento silenzioso.

## Il riquadro token è contraibile

Sia nella home che nelle pagine dei singoli eventi, il riquadro per inserire
il token GitHub è chiuso di default (si apre/chiude cliccando l'intestazione o
l'icona ⚙) per non occupare spazio quando non ti serve interagire con l'API.
Se hai già un token salvato in quel browser, il riquadro si apre automaticamente.

## Nota sulla sicurezza (leggila)

Non esiste un vero backend qui: sia la home che i siti degli eventi sono pagine
statiche che chiamano direttamente le API di GitHub usando il token inserito nel
browser di chi le usa. Questo significa:

- Chiunque abbia il token **amministratore** può creare repository a tuo nome
  nell'organization e leggere/scrivere ovunque in quella organization con quel
  token — tienilo solo per te.
- Chiunque abbia il token di un **singolo evento** (fine-grained, scoped a una
  repo) può modificare solo i dati di quell'evento, non degli altri né della home.
  Questo isolamento è garantito da GitHub stesso, non da una convenzione lato
  codice — è la parte davvero sicura del sistema.
- Ogni modifica ai dati è comunque un commit Git: se qualcosa viene rovinato per
  errore, è recuperabile dalla cronologia commit della repo interessata.

## Se vuoi modificare qualcosa in un evento già creato

Puoi sempre editare i file `data/*.json` direttamente da GitHub (o dal tab
"Gestisci dati" del sito di quell'evento), esattamente come nel progetto originale.
