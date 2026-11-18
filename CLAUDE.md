# BluCheck — istruzioni per Claude

Gestionale in abbonamento per i laboratori abilitati alle verificazioni periodiche dei registratori telematici.
Installazione e struttura: vedi `LEGGIMI.md`.

## Progetto BluCode
Questo software fa parte del progetto BluCode Informatica. La memoria condivisa è nel repository
[`Progetto_blucode_informatica`](https://github.com/alessandrofierro50/Progetto_blucode_informatica).
- **A inizio sessione:** leggi `README.md`, tutti i file in `comune/` e `blucheck/STATO.md` con l'ultima sessione in `blucheck/sessioni/`.
- **Rispetta gli standard comuni** (prova, abbonamenti, pagamenti, brand, email, Console). Prova, abbonamenti, pagamenti e Console sono allineati a BluGest (2026-11-01); quel che resta è in `blucheck/STATO.md`.
- **A fine sessione:** scrivi il riepilogo in `blucheck/sessioni/AAAA-MM-GG.md`, aggiorna `blucheck/STATO.md` e, se serve, `comune/`.
- Se cambiano funzioni, prezzi, nome o stato, segnala che va aggiornata la pagina del sito (`content.py`).

## Tasto «?»
- (2026-11-15, standard comune, modello BluGest) Nella barra in alto un tasto «?» spiega a cosa serve la sezione aperta
  (Scadenze, Apparecchi, Clienti, Rapporti, Impostazioni) e cosa si scrive in ogni campo; si apre anche con **F1**.
  Testi e finestra in `public/js/app.js` (`AIUTI`, `aiutoDialog`), con il pannello laterale già usato dal programma.

## Note tecniche
- Node.js 20, Express, SQLite (better-sqlite3), pm2. Una sola istanza (SQLite).
- `server.js` API, abbonamenti, pagamenti, acquisto dal sito, Console · `contratto.js` contratto PDF dell'acquisto · `abbonamento.js` fasi e modelli email · `pagamenti.js` fatturazione, Stripe/PayPal, XML, proforma · `test/` prove (e2e con gestori simulati) · `ae-qr.js` lettura della pagina AdE del QR · `public/js/app.js` app tecnici · `public/js/admin.js` superuser · `public/js/pdf.js` moduli PDF.
- Le password e le chiavi stanno solo nel `.env` del server, mai nel repository.
- [x] Acquisto dal sito (2026-11-03, contratto comune `comune/acquisto-dal-sito.md`, modello BluGest 708dc08): `GET/POST /api/public/acquisto`
      (`server.js`, CORS del sito su tutto `/api/public/*`): SOLO annuale, piani attivi con prezzo dal listino (`code` = id del piano: solo/team/lab),
      carta, PayPal o bonifico se attivi; stessi controlli della prova (trappola `website`, `elapsed_ms`, limiti IP/email/giorno, termini e privacy).
      Crea l'azienda con `creaAziendaProva` (estratta dalla prova, usata da entrambe) col piano scelto e i suoi limiti, in prova fino al pagamento;
      salva `dati_fatturazione`, apre `checkout(..., {sito})` (importi sempre dal listino; `return_url` solo se della stessa origine di
      `WEBSITE_URL`, poi `?stato=ok|annullato|errore`; PayPal torna da `GET /api/pagamenti/paypal/ritorno?id=&r=`) e manda l'email «Conferma d'ordine»
      (`contratto.js`: contratto PDF compilato, BOZZA da far rivedere a un legale, modulo di recesso per i privati; termini, privacy, `MANUAL_URL`,
      `VIDEOS_URL`, `PRIVACY_PDF_URL`; non blocca mai l'ordine). Carta/PayPal: fattura al webhook; bonifico: nessun documento finché il super admin non
      conferma. Test `test/acquisto.mjs` (vedi `test/LEGGIMI.md`). DA FARE: pagina `/acquista/` del sito con BluCheck (indirizzo in `site.json`, già presente),
      variabili `MANUAL_URL`/`VIDEOS_URL`/`PRIVACY_PDF_URL` nel `.env` del server, listino da confermare (prezzi provvisori), revisione legale del contratto.
- [x] Tasto «Elenco» con «Nuovo» (2026-11-04, standard BluCode, comportamento come `Lookup.tsx` di BluGest): `openLookup`, `lookupRow`,
      `pickIntoSelect`, registro `Lookups` in `public/js/common.js`, stile `.lk-*` in `blucheck.css`. Accanto a Cliente (scheda apparecchio),
      Apparecchio (verifica) e Piano (pannello: nuova azienda, dati azienda, periodo a mano); anche F4 nella casella. Elenco alfabetico,
      ricerca in basso (clienti: ragione sociale, città/domicilio, P.IVA, telefono, CF; apparecchi: matricola, marca e modello, cliente),
      frecce/Invio/clic/Esc; «Nuovo» crea cliente (PUT /api/dati/clienti/:id), apparecchio (esercente da un secondo elenco) o piano
      (POST /api/su/piani) e lo lascia scelto. A tutto schermo sotto 640 px. Non c'è scelta del tecnico (il rapporto è di chi lo compila).
- [x] Clienti «cessato» e «verificato» + import dello storico (2026-11-18, per CDL Italia): `cessato` sul cliente toglie per sempre i suoi
      apparecchi dalle scadenze (e dal CSV); si riattiva dalla scheda del cliente (`riattivaCliente`): «stesso apparecchio» = i registratori
      non dismessi tornano nelle scadenze con le date di prima; «apparecchio nuovo» = i vecchi diventano `dismesso` (restano in archivio coi
      rapporti) e si apre la scheda del nuovo registratore; date in `cessatoIl` / `riattivatoIl`; `verificato` (+ `verificatoIl`) è il controllo iniziale fatto dal laboratorio (aggiornamenti, verificazione periodica, DGFE
      annuale sui DTR); gli importati (`importato`) partono non spuntati con l'etichetta «DA VERIFICARE».
      Caselle in «Modifica cliente», etichette nella lista e nella scheda, con le date dello storico (`storicoVerifiche`).
      `POST /api/importa-storico` (admin dell'azienda, Impostazioni > «Importa storico»): file JSON `formato: "blucheck-storico-1"` con
      `clienti: [{ragione, domicilio, note, cessato, verificato, ultimaVerifica, storicoVerifiche, segnalazioni}]`; senza `conferma` è solo anteprima,
      con `conferma: true` fa prima `db.backup` in `data/backup/blucheck-prima-import-*.db`, poi una transazione. Clienti con la stessa ragione sociale
      (normalizzata) si saltano. Ogni cliente riceve un apparecchio senza modello/matricola («Registratore da completare») con `ultimaVerifica`.
      Anagrafica nel file (2026-11-18, dall'export clienti di BluGest): `piva, cf, sdi, pec, email, telefono, domicilio` (campi anche in
      «Modifica cliente») e `localita` = comune dell'apparecchio. Clienti già presenti: si riempiono solo i campi vuoti (`completati`; il domicilio
      messo dal primo import = comune dell'apparecchio importato si sostituisce), i campi diversi (P.IVA, CF, SDI, PEC, email, telefono, domicilio, cessato;
      confronto senza maiuscole/spazi/punteggiatura, telefoni sulle sole cifre) sono `discordanze` nell'anteprima e si scelgono uno per uno
      (`scelte` {"<id>:<campo>": "nuovo"|"attuale"}, senza scelta resta quello di BluCheck); le date dello storico si uniscono e l'ultima
      verifica dell'apparecchio importato avanza se il file ne ha una più recente; «verificato» non si tocca mai.
      I file con i dati dei clienti NON vanno nel repository (è pubblico). Prova: `test/storico.mjs`.
- [x] Aggiornamenti software (2026-11-18): in anagrafica cliente «Usa un software gestionale?» (`gestionale`: si/no/'') e «Quale software»
      (`software`); sezione «Aggiornamenti» (`viewAggiornamenti`, scheda `sheetAgg` in `public/js/app.js`) con i clienti che hanno `gestionale = si`
      e lo stato in `aggSw` = { stato: aggiornato | non_installabile | '', motivo: hardware | non_paga (obbligatorio se non installabile), data, note, da }.
      Filtri da fare/aggiornati/non installabili, ricerca, export TXT (`exportAggTxt`) e PDF A4 (`pdfAggiornamenti` in `public/js/pdf.js`) con i filtri attivi.
      Nessuna modifica al database: i clienti sono documenti JSON in `dati` e i campi nuovi si aggiungono e basta.
- [x] Planning (2026-11-18): sezione «Planning» (`public/js/planning.js`, caricato prima di `app.js`; stato in `PL`, eventi propri su
      `data-pl-act` / `data-pl`) con il lavoro da fare in un giorno, in un mese o da data a data, raggruppato per giorno e cliente:
      verificazioni periodiche e DGFE da `allScadenze()` (cessati e dismessi esclusi) e aggiornamenti software «da fare» (`statoAgg`),
      agganciati alla prima visita del cliente nel periodo; quelli dei clienti senza scadenze nel periodo stanno in fondo, «da fissare».
      Arretrati (scaduti prima del periodo) in cima, si possono togliere. Tasti Visualizza tutti / Verifiche / DGFE / Aggiornamento software
      (anche cliccando i riquadri). Export TXT (`exportPlanningTxt`) e PDF A4 con caselle «Fatto» (`pdfPlanning` in `public/js/pdf.js`).
      Solo frontend: nessuna modifica al server o al database.
- [x] Importa QR da file (2026-11-18): Apparecchi > «Importa QR da file» (`public/js/importa-qr.js`, caricato da `app.js` solo al clic con
      `caricaImportaQr`, `?v=` da cambiare a ogni modifica del file; pannello `qrimp`, eventi propri `data-qi-act` / `data-qi-sel`).
      Il browser legge foto, PDF (pdf.js 4.10.38 legacy in `public/vendor/pdfjs`, import dinamico) e ZIP (lettore interno con
      `DecompressionStream`, niente librerie; ZIP64, ZIP annidati e file cifrati segnalati) e cerca TUTTI i QR di ogni immagine/pagina con jsQR
      (copre di bianco quello trovato e riprova, a più risoluzioni). Solo i QR della pagina AdE vanno al server: `POST /api/importa-qr/leggi`
      (max 20 indirizzi, a gruppi di 10 per l'avanzamento, cache AdE di 1 ora) e `POST /api/importa-qr` {urls, escludi, conferma}.
      Riepilogo: `completa` (cliente con stessa P.IVA, o ragione sociale, che ha un registratore dello storico senza matricola: lo si completa
      e si toglie la nota «IMPORTATO DALLO STORICO…»), `nuovo` (sul cliente trovato, o su un cliente nuovo creato con denominazione e P.IVA
      dell'Agenzia, uno solo per esercente), `presente`/`invariato` (stessa matricola: modello, firmware, QR, dati AdE e ultima verifica se più
      recente e positiva; il cliente non si cambia, si avvisa se l'Agenzia indica un altro esercente), `doppio`, `errore`. Cliente trovato per nome
      senza P.IVA: gliela si aggiunge. Alla conferma backup `data/backup/blucheck-prima-import-qr-*.db` e una transazione. Prova: `test/importa-qr.mjs`.
