# BluCheck

Gestionale per i laboratori abilitati alle verificazioni periodiche dei registratori telematici, venduto in abbonamento.

- **Sito pubblico** (`/`): funzioni, prezzi presi dai piani, modulo "Richiedi l'attivazione".
- **App dei tecnici** (`/app`): scadenze (verifica a 2 anni, DGFE a 1 anno), clienti, apparecchi, lista di controllo All. 1/2/3, lettura del QR code con i dati presi dalla pagina dell'Agenzia, firma del cliente sul telefono, PDF A4 e termico 80 mm. Ogni azienda vede solo i propri dati.
- **Pannello superuser** (`/admin`): abiliti le aziende, imposti la scadenza dell'abbonamento e il numero massimo di tecnici, registri i pagamenti, gestisci i piani e vedi gli avvisi.

## Come funziona l'abbonamento

1. Il laboratorio compila la richiesta sul sito (oppure lo crei tu da `/admin` > Nuova azienda).
2. Da `/admin` lo abiliti: scegli fino a quando vale la prova (di default 30 giorni) e quanti tecnici può avere. L'amministratore del laboratorio riceve le credenziali per email (e le vedi anche a schermo).
3. L'amministratore del laboratorio aggiunge i suoi tecnici da Impostazioni, fino al numero consentito.
4. Rinnovo: da Impostazioni > Abbonamento sceglie un piano e paga su Stripe (carta, Google Pay, Apple Pay, PayPal). Il periodo si **aggiunge** alla scadenza attuale e il numero di tecnici prende quello del piano. Puoi anche registrare a mano un bonifico da `/admin`.
5. Avvisi automatici ogni 6 ore: all'azienda e a te a 30, 15, 7 e 1 giorno dalla scadenza, il giorno stesso e a scadenza avvenuta (per un'azienda attivata da meno di una settimana si parte dall'avviso dei 15 giorni). Compaiono anche in `/admin` > Avvisi e nell'app come banner.
6. A scadenza l'archivio diventa **sola lettura**: si consulta e si stampa, ma non si registrano nuove verifiche finché non si rinnova. Con lo stato "Sospesa" l'azienda non entra più.

> Stripe incassa ma **non emette la fattura elettronica**: per ogni pagamento ricevi un'email e lo trovi in `/admin` > Pagamenti (esportabile in CSV) per fatturarlo.

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
nano .env                # BASE_URL, SUPERUSER_EMAIL/PASSWORD, SMTP, Stripe

# 4. Avvio permanente con pm2
sudo npm i -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup  # esegui il comando che ti stampa

# 5. Nginx + HTTPS
sudo cp deploy/nginx-blucheck.conf /etc/nginx/sites-available/blucheck
sudo nano /etc/nginx/sites-available/blucheck      # metti il tuo dominio
sudo ln -s /etc/nginx/sites-available/blucheck /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d blucheck.tuodominio.it
```

Apri `https://blucheck.tuodominio.it/admin` ed entra con l'email e la password del superuser messe nel `.env` (poi puoi togliere `SUPERUSER_PASSWORD` dal file). Per creare un altro superuser o cambiare la password:

```bash
node scripts/crea-superuser.js tua@email.it "password-lunga" "Nome Cognome"
```

**HTTPS è obbligatorio** per la fotocamera (scansione QR dal vivo) e per i pagamenti.

## Pagamenti con Stripe (carta, Google Pay, Apple Pay, PayPal)

1. Crea l'account su stripe.com e completa i dati dell'azienda.
2. Dashboard > Impostazioni > **Metodi di pagamento**: attiva Carte, Google Pay, Apple Pay e **PayPal** (per PayPal Stripe ti chiede di collegare il conto PayPal).
3. Dashboard > Sviluppatori > Chiavi API: copia la chiave segreta in `STRIPE_SECRET_KEY`.
4. Dashboard > Sviluppatori > **Webhook** > Aggiungi endpoint: `https://blucheck.tuodominio.it/api/stripe/webhook`, eventi `checkout.session.completed` e `checkout.session.async_payment_succeeded`. Copia il "Signing secret" in `STRIPE_WEBHOOK_SECRET`.
5. `pm2 restart blucheck`.

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
server.js            API, sessioni, abbonamenti, Stripe, avvisi
ae-qr.js             lettura della pagina dell'Agenzia aperta dal QR
db.js                database SQLite (schema e piani iniziali)
public/index.html    sito pubblico
public/app.html      app dei tecnici      (js/app.js, js/pdf.js, js/common.js)
public/admin.html    pannello superuser   (js/admin.js)
scripts/             crea-superuser.js, backup.js
deploy/              pm2 e nginx
```

Ruoli: **superuser** (tu), **admin** dell'azienda (gestisce tecnici, dati del laboratorio, abbonamento, può eliminare rapporti), **tecnico** (lavora su clienti, apparecchi e verifiche).
