# Prove automatiche

Prova end-to-end delle API con Stripe e PayPal simulati (`mock-gestori.js` sostituisce `fetch`: non usarlo in produzione).

```bash
# da una cartella vuota per il database di prova
export DB_PATH=/tmp/bc-test.db PORT=3999 SUPERUSER_EMAIL=su@test.it SUPERUSER_PASSWORD=supersegreta123 \
  STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=whsec_test PAYPAL_CLIENT_ID=id PAYPAL_SECRET=sec PAYPAL_WEBHOOK_ID=wh \
  BONIFICO_IBAN="IT60 X054 2811 1010 0000 0123 456" CEDENTE_DENOMINAZIONE="BluCode Informatica" CEDENTE_PIVA=05357210755 \
  CEDENTE_INDIRIZZO="Via Napoli 78" CEDENTE_CAP=73036 CEDENTE_COMUNE="Muro Leccese" CEDENTE_PROVINCIA=LE \
  CONSOLE_API_KEY=chiaveconsole123 CONSOLE_ADMIN_KEY=chiaveadmin456
rm -f /tmp/bc-test.db*; node -r ./test/mock-gestori.js server.js &
node test/e2e.mjs                       # ciclo della prova, pagamenti, fattura, sola lettura, sospensione, Console
python3 test/valida_xml.py /tmp/blucheck-fattura.xml   # XML sull'XSD ufficiale FatturaPA 1.2.2 (serve lxml)
```

## Acquisto dal sito
`test/acquisto.mjs` prova `GET/POST /api/public/acquisto` (carta, PayPal, bonifico, CORS, robot, 409, ritorno PayPal al sito, contratto PDF).
Va lanciato su un database **nuovo**, con lo stesso server e le stesse variabili sopra:

```bash
rm -f /tmp/bc-test.db*; node -r ./test/mock-gestori.js server.js &
node test/acquisto.mjs
```
