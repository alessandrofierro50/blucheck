#!/usr/bin/env bash
# Aggiorna BluCheck sulla VPS (pm2, non Docker): backup del database, codice nuovo, dipendenze se cambiate, riavvio.
# A mano: cd /opt/blucheck && bash deploy/update.sh   (lo lancia anche l'aggiornamento automatico)
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"
export GIT_TERMINAL_PROMPT=0

# Prima scarica il codice, poi rilancia la versione aggiornata di questo script.
if [ "${BLUCHECK_UPDATED:-}" != "1" ]; then
  # 1. Copia coerente del database prima di toccare qualcosa (tiene le ultime 10)
  DBP=$(grep -E '^DB_PATH=' .env 2>/dev/null | cut -d= -f2- | tr -d '"\r' || true)
  [ -n "$DBP" ] && export DB_PATH="$DBP"
  mkdir -p data/backup
  COPIA="data/backup/prima-aggiornamento-$(date +%Y%m%d-%H%M%S).db"
  node -e 'require("./db").backup(process.argv[1]).then(() => console.log("Backup:", process.argv[1])).catch((e) => { console.error("Backup non riuscito:", e.message); process.exit(1); })' "$COPIA"
  ls -1t data/backup/prima-aggiornamento-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
  # 2. Codice nuovo
  PRIMA=$(git rev-parse HEAD)
  git pull --ff-only
  BLUCHECK_UPDATED=1 BLUCHECK_PRIMA="$PRIMA" exec bash "$REPO_DIR/deploy/update.sh" "$@"
fi

# 3. Dipendenze solo se sono cambiate
if ! git diff --quiet "${BLUCHECK_PRIMA:-HEAD}" HEAD -- package.json package-lock.json || [ ! -d node_modules ]; then
  echo ">> Dipendenze cambiate: npm ci"
  npm ci --omit=dev
fi

# 4. Riavvio e controllo che risponda
pm2 restart blucheck --update-env
PORTA=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '"\r ' || true)
PORTA=${PORTA:-3030}
for _ in $(seq 1 30); do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORTA/"; then
    echo "BluCheck aggiornato alla versione $(git rev-parse --short HEAD) e in linea."
    exit 0
  fi
  sleep 1
done
echo "ERRORE: dopo il riavvio BluCheck non risponde sulla porta $PORTA. Guarda: pm2 logs blucheck --lines 50"
exit 1
