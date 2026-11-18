#!/usr/bin/env bash
# Lanciato da GitHub Actions dopo ogni modifica su main, tramite la chiave creata da
# deploy/setup-aggiornamento-automatico.sh. Fa solo l'aggiornamento (deploy/update.sh).
# Il registro resta anche sulla VPS in /var/log/aggiornamento-blucheck.log
set -euo pipefail
cd "$(dirname "$0")/.."
export GIT_TERMINAL_PROMPT=0
LOG=/var/log/aggiornamento-blucheck.log
exec > >(tee -a "$LOG") 2>&1

# Un aggiornamento alla volta su tutta la VPS, anche tra programmi diversi (BluGest, BluBeauty, ...):
# più ricostruzioni insieme saturano memoria e processore e rallentano i programmi in uso
exec 9>/tmp/aggiornamento-vps.lock
if ! flock -n 9; then
  echo ">> Un altro aggiornamento è in corso su questa VPS: aspetto il mio turno..."
  flock -w 3300 9 || { echo "ERRORE: un altro aggiornamento è ancora in corso da 55 minuti."; exit 1; }
fi

echo ">> $(date '+%d/%m/%Y %H:%M:%S') aggiornamento di blucheck in $(pwd)"
echo ">> Versione prima: $(git log -1 --format='%h %s')"
RAMO=$(git rev-parse --abbrev-ref HEAD)
if [ "$RAMO" != main ]; then
  echo "ERRORE: la VPS è sul ramo '$RAMO', non su main: aggiornamento automatico non fatto."
  echo "Sistemalo a mano una volta con: git checkout main && bash deploy/update.sh"
  exit 1
fi
bash deploy/update.sh
echo ">> Versione in linea: $(git log -1 --format='%h %s')"
