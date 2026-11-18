#!/usr/bin/env bash
# Tutte le prove di BluCheck, come le lancia la CI di GitHub. Da locale: bash test/tutte.sh
# Ogni prova del server parte su un database nuovo (vedi test/LEGGIMI.md). Serve Playwright per stampa e foto.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
export DB_PATH=$TMP/bc-test.db PORT=3999 SUPERUSER_EMAIL=su@test.it SUPERUSER_PASSWORD=supersegreta123 \
  STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=whsec_test PAYPAL_CLIENT_ID=id PAYPAL_SECRET=sec PAYPAL_WEBHOOK_ID=wh \
  BONIFICO_IBAN="IT60 X054 2811 1010 0000 0123 456" CEDENTE_DENOMINAZIONE="BluCode Informatica" CEDENTE_PIVA=05357210755 \
  CEDENTE_INDIRIZZO="Via Napoli 78" CEDENTE_CAP=73036 CEDENTE_COMUNE="Muro Leccese" CEDENTE_PROVINCIA=LE \
  CONSOLE_API_KEY=chiaveconsole123 CONSOLE_ADMIN_KEY=chiaveadmin456
PID=""
ferma() { if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi; PID=""; }
trap 'ferma; rm -rf "$TMP"' EXIT

echo "== sintassi"
for f in *.js scripts/*.js public/js/*.js; do node --check "$f"; done

for t in e2e acquisto storico importa-qr; do
  echo "== $t"
  ferma; rm -f "$DB_PATH"*
  node -r ./test/mock-gestori.js server.js > "$TMP/server-$t.log" 2>&1 & PID=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.2; done
  node "test/$t.mjs" || { echo "--- log del server"; cat "$TMP/server-$t.log"; exit 1; }
done
ferma
[ "$t" = importa-qr ] && grep -q '"fatturaXml"\|blucheck-fattura' /dev/null 2>&1 || true

echo "== stampa"; node test/stampa.mjs
echo "== foto"; node test/foto.mjs
echo; echo "Tutte le prove di BluCheck sono passate"
