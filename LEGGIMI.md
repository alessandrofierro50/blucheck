# BluCheck

Gestionale per i laboratori abilitati alle verificazioni periodiche dei registratori telematici, venduto in abbonamento.

- **Sito pubblico** (`/`): funzioni, prezzi presi dai piani, modulo "Richiedi l'attivazione". La prova gratuita parte anche dal sito blucodeinformatica.it.
- **App dei tecnici** (`/app`): scadenze (verifica a 2 anni, DGFE a 1 anno), clienti, apparecchi, lista di controllo All. 1/2/3, lettura del QR code con i dati presi dalla pagina dell'Agenzia, firma del cliente sul telefono, PDF A4 e termico 80 mm. Ogni azienda vede solo i propri dati.
- **Pannello superuser** (`/admin`): abiliti le aziende, imposti la scadenza dell'abbonamento e il numero massimo di tecnici, confermi i bonifici, scarichi XML e proforma, gestisci piani e testi degli avvisi.

## Come funziona l'abbonamento (standard comune BluCode, come BluGest)

1. **Prova gratuita**: dal sito (`POST /api/public/prova`) o da `/admin` > Nuova azienda. Dura `TRIAL_DAYS` giorni (7) sul piano più grande; le credenziali arrivano per email.
2. Avvisi della prova a **3, 1 e 0 giorni**. **Prova finita = accesso subito sospeso**: l'azienda entra solo nella pagina Abbonamento per scegliere il piano e pagare.
3. Abbonamento pagato: avvisi a **30, 15, 7, 3, 1, 0 giorni**. Dopo la scadenza **15 giorni di tolleranza** (tutto funziona), poi **30 giorni in sola lettura** (si consulta e si stampa), poi **sospeso**. Da `/admin` puoi sospendere a mano.
4. Gli avvisi partono ogni giorno alle 8:07 (uno solo, il più vicino, mai due volte lo stesso), con copia ad `ADMIN_NOTIFY_EMAIL`; il lunedì arriva il riepilogo settimanale. Testi e giorni si modificano da `/admin` > Avvisi.
5. Il rinnovo parte dalla scadenza attuale (o da oggi, se la prova è finita o l'abbonamento è già scaduto). Il numero di tecnici prende quello del piano.

## Pagamenti e fattura

- Metodi: **carta** (Stripe Checkout, anche Google Pay e Apple Pay), **PayPal**, **bonifico**. Compaiono solo quelli configurati in `.env`.
- Prima di pagare il cliente compila i **dati di fatturazione** (P.IVA o CF, indirizzo, codice SDI o PEC; PA con codice ufficio). Gli importi li calcola il server dal listino; sopra 77,47 € si aggiunge il bollo di 2 € (regime forfettario RF19, natura N2.2).
- Carta e PayPal confermano da soli (webhook). Il **bonifico** resta "in attesa" finché da `/admin` > Pagamenti non premi **Conferma accredito**: solo allora si rinnova l'abbonamento e si generano i documenti.
- A pagamento confermato: numero di fattura sezionale `BC` (es. `1/BC`), **XML FatturaPA** (inviato ad `ADMIN_NOTIFY_EMAIL`, da caricare sul portale dell'Agenzia) e **ricevuta proforma PDF** inviata al cliente.
- Webhook: Stripe `https://blucheck.blucodeinformatica.it/api/pagamenti/webhook/stripe` (eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`); PayPal `https://blucheck.blucodeinformatica.it/api/pagamenti/webhook/paypal` (evento `PAYMENT.CAPTURE.COMPLETED`).

## BluCode Console

- `GET /api/console/riepilogo` con `Authorization: Bearer <CONSOLE_API_KEY>`: numeri di aziende, prove, scadenze, incassi, avvisi.
- `POST /api/console/super-admin/credenziali` con in più `X-Console-Admin-Key: <CONSOLE_ADMIN_KEY>`: cambia email/password del superuser (password di almeno 12 caratteri con maiuscole, minuscole e numeri).
- Con le chiavi vuote le due funzioni sono spente.

## Installazione sul VPS (Ubuntu/Debian)

Serve Node.js 20 o superiore. Se sul VPS girano già le altre app, BluCheck usa una sua porta (3030) e un suo sottodominio.

```bash
# 1. Copia la cartella sul server, es. in /opt/blucheck
sudo mkdir -p /opt/blucheck && sudo chown $USER /opt/blucheck
unzip blucheck.zip -d /opt/        # oppure scp / git
cd /opt/blucheck

# 2. Dipendenze
npm ci --omit=dev        # (oppure: npm install --omit=dev)

# 3. Configurazione
cp .env.example .env
nano .env                # BASE_URL, SUPERUSER, SMTP, pagamenti, CEDENTE_*, Console

# 4. Avvio permanente con pm2
sudo npm i -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup  # esegui il comando che ti stampa

# 5. Nginx + HTTPS
sudo cp deploy/nginx-blucheck.conf /etc/nginx/sites-available/blucheck
sudo nano /etc/nginx/sites-available/blucheck      # metti il tuo dominio
sudo ln -s /etc/nginx/sites-available/blucheck /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d blucheck.blucodeinformatica.it
```

Apri `https://blucheck.blucodeinformatica.it/admin` ed entra con l'email e la password del superuser messe nel `.env` (poi puoi togliere `SUPERUSER_PASSWORD` dal file). Per creare un altro superuser o cambiare la password:

```bash
node scripts/crea-superuser.js tua@email.it "password-lunga" "Nome Cognome"
```

**HTTPS è obbligatorio** per la fotocamera (scansione QR dal vivo) e per i pagamenti.

## Configurare i pagamenti

**Bonifico**: basta `BONIFICO_IBAN` (e i dati `CEDENTE_*` per la fattura).

**PayPal**: developer.paypal.com > Apps & Credentials > crea l'app (prima in Sandbox): `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`; aggiungi il webhook indicato sopra e copia l'ID in `PAYPAL_WEBHOOK_ID`. In produzione `PAYPAL_MODE=live`.

**Carta con Stripe**:
1. Crea l'account su stripe.com e completa i dati dell'azienda; in Impostazioni > Metodi di pagamento attiva Carte, Google Pay, Apple Pay.
2. Dashboard > Sviluppatori > Chiavi API: copia la chiave segreta in `STRIPE_SECRET_KEY`.
3. Dashboard > Sviluppatori > **Webhook** > Aggiungi endpoint con l'indirizzo Stripe indicato sopra. Copia il "Signing secret" in `STRIPE_WEBHOOK_SECRET`.
4. `pm2 restart blucheck`.

Prova prima con le chiavi di test (`sk_test_...`) e la carta `4242 4242 4242 4242`, poi passa a quelle live. Apple Pay su web richiede anche la verifica del dominio in Stripe (Impostazioni > Metodi di pagamento > Apple Pay > Aggiungi dominio).

## Email

Compila `SMTP_*` con la casella da cui partono le email (es. quella del tuo dominio o un servizio come Brevo, Mailgun, Aruba SMTP). Senza SMTP l'app funziona lo stesso: gli avvisi restano in `/admin` > Avvisi e le password provvisorie le leggi a schermo.

## QR code del registratore

Il QR sulla targhetta porta alla pagina "Dettaglio Stato Fiscalizzazione Dispositivo" dell'Agenzia delle Entrate. Quando il tecnico lo inquadra, il server di BluCheck legge quella pagina e compila da solo matricola, marca e modello, tipo di sigillo, data ed esito dell'ultima verificazione periodica, firmware, partita IVA e denominazione dell'esercente (che viene collegato al cliente in archivio o creato nuovo). Serve che il VPS possa raggiungere `ivaservizi.agenziaentrate.gov.it` in HTTPS (di norma sì). Se l'Agenzia cambia l'aspetto della pagina, la lettura è tutta in `ae-qr.js`.

## Backup

Tutti i dati sono nel file `data/blucheck.db`. Backup giornaliero (tiene gli ultimi 30):

```bash
crontab -e
30 2 * * * cd /opt/blucheck && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1
```

Copia periodicamente la cartella `data/backup` fuori dal VPS.

## Aggiornare

```bash
cd /opt/blucheck && cp -r data /root/blucheck-data-$(date +%F)
# sostituisci i file (non toccare .env e data/)
npm ci --omit=dev && pm2 restart blucheck
```

## Struttura

```
server.js            API, sessioni, abbonamenti, pagamenti, avvisi, Console
abbonamento.js       fasi dell'abbonamento (prova, tolleranza, sola lettura, sospeso) e modelli email
pagamenti.js         dati di fatturazione, Stripe/PayPal, XML FatturaPA, proforma PDF
ae-qr.js             lettura della pagina dell'Agenzia aperta dal QR
db.js                database SQLite (schema e piani iniziali)
public/index.html    sito pubblico
public/app.html      app dei tecnici      (js/app.js, js/pdf.js, js/common.js)
public/admin.html    pannello superuser   (js/admin.js)
scripts/             crea-superuser.js, backup.js
deploy/              pm2 e nginx
docs/xsd/            schema ufficiale FatturaPA 1.2.2
test/                prove automatiche (vedi test/LEGGIMI.md)
```

Ruoli: **superuser** (tu), **admin** dell'azienda (gestisce tecnici, dati del laboratorio, abbonamento, può eliminare rapporti), **tecnico** (lavora su clienti, apparecchi e verifiche).
