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
      apparecchi dalle scadenze (e dal CSV); `verificato` (+ `verificatoIl`) è il controllo iniziale fatto dal laboratorio (aggiornamenti, verificazione periodica, DGFE
      annuale sui DTR); gli importati (`importato`) partono non spuntati con l'etichetta «DA VERIFICARE».
      Caselle in «Modifica cliente», etichette nella lista e nella scheda, con le date dello storico (`storicoVerifiche`).
      `POST /api/importa-storico` (admin dell'azienda, Impostazioni > «Importa storico»): file JSON `formato: "blucheck-storico-1"` con
      `clienti: [{ragione, domicilio, note, cessato, verificato, ultimaVerifica, storicoVerifiche, segnalazioni}]`; senza `conferma` è solo anteprima,
      con `conferma: true` fa prima `db.backup` in `data/backup/blucheck-prima-import-*.db`, poi una transazione. Clienti con la stessa ragione sociale
      (normalizzata) si saltano. Ogni cliente riceve un apparecchio senza modello/matricola («Registratore da completare») con `ultimaVerifica`.
      I file con i dati dei clienti NON vanno nel repository (è pubblico). Prova: `test/storico.mjs`.
- [x] Aggiornamenti software (2026-11-18): in anagrafica cliente «Usa un software gestionale?» (`gestionale`: si/no/'') e «Quale software»
      (`software`); sezione «Aggiornamenti» (`viewAggiornamenti`, scheda `sheetAgg` in `public/js/app.js`) con i clienti che hanno `gestionale = si`
      e lo stato in `aggSw` = { stato: aggiornato | non_installabile | '', motivo: hardware | non_paga (obbligatorio se non installabile), data, note, da }.
      Filtri da fare/aggiornati/non installabili, ricerca, export TXT (`exportAggTxt`) e PDF A4 (`pdfAggiornamenti` in `public/js/pdf.js`) con i filtri attivi.
      Nessuna modifica al database: i clienti sono documenti JSON in `dati` e i campi nuovi si aggiungono e basta.
