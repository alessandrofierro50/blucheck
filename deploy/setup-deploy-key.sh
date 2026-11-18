#!/usr/bin/env bash
# Collega questa VPS al repository GitHub con una "deploy key" in SOLA LETTURA:
# dopo, deploy/update.sh scarica gli aggiornamenti senza chiedere username e token.
# Uso (una volta sola): `bash deploy/setup-deploy-key.sh`
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(git remote get-url origin)
REPO=$(echo "$URL" | sed -E 's#^(https://github.com/|git@[^:]+:)##; s#\.git$##')
[[ "$REPO" == */* ]] || { echo "Non riesco a capire il repository dall'indirizzo: $URL"; exit 1; }
KEY=/root/.ssh/blucheck_deploy
HOST=github-blucheck

mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "deploy-$(hostname)-blucheck" -f "$KEY" >/dev/null
grep -q "^Host $HOST\$" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<CFG

Host $HOST
    HostName github.com
    User git
    IdentityFile $KEY
    IdentitiesOnly yes
CFG
chmod 600 /root/.ssh/config
# Impronta di GitHub aggiornata (una vecchia, es. la chiave RSA cambiata da GitHub nel 2023, bloccherebbe il collegamento)
ssh-keygen -R github.com >/dev/null 2>&1 || true
ssh-keyscan -t ed25519,ecdsa,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null

echo
echo "1) Apri:  https://github.com/$REPO/settings/keys/new"
echo "2) Title: VPS $(hostname)"
echo "3) Key:   copia TUTTA la riga qui sotto"
echo
cat "$KEY.pub"
echo
echo "4) NON spuntare 'Allow write access' (basta la lettura), poi 'Add key'."
read -rp "Premi Invio quando hai aggiunto la chiave su GitHub... " _

RESULT=$(ssh -o ConnectTimeout=15 -o BatchMode=yes -T "git@$HOST" 2>&1 || true)
if echo "$RESULT" | grep -q "successfully authenticated"; then
  git remote set-url origin "git@$HOST:$REPO.git"
  git fetch -q origin
  echo "Fatto: da ora 'bash deploy/update.sh' non chiede più credenziali."
else
  echo "GitHub non accetta ancora la chiave. Risposta ricevuta:"
  echo "$RESULT" | sed 's/^/   /'
  if echo "$RESULT" | grep -qiE "timed out|connection refused|no route"; then
    echo "La VPS non riesce a collegarsi a GitHub sulla porta 22 (firewall del provider?)."
  else
    echo "Controlla di averla aggiunta al repository $REPO (Settings → Deploy keys) e rilancia lo script."
  fi
  exit 1
fi
