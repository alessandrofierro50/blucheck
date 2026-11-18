#!/usr/bin/env bash
# Prepara questa VPS per l'aggiornamento automatico da GitHub. Si lancia UNA volta sola, da root:
#   bash deploy/setup-aggiornamento-automatico.sh
# Crea una chiave SSH dedicata che può fare una cosa sola: lanciare deploy/aggiornamento-automatico.sh
# di questo programma (niente terminale, niente altri comandi). Poi stampa i valori da incollare
# su GitHub → Settings → Secrets and variables → Actions. Si può rilanciare senza danni.
set -euo pipefail
trap 'echo "ERRORE: lo script si è fermato alla riga $LINENO. Mandami questa schermata." >&2' ERR
cd "$(dirname "$0")/.."
DIR=$(pwd)
APP=blucheck
[ "$(id -u)" = 0 ] || { echo "Lancialo come root (sudo -i)."; exit 1; }

# 1. La VPS deve poter scaricare il codice da GitHub senza chiedere password
if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes" git fetch -q origin main 2>/dev/null; then
  echo "ATTENZIONE: questa VPS non riesce a scaricare il codice da GitHub senza password."
  echo "Prima lancia:  bash deploy/setup-deploy-key.sh   poi rilancia questo script."
  exit 1
fi

# 2. Chiave dedicata, valida solo per l'aggiornamento di $APP
KEY=/root/.ssh/${APP}_github_actions
COMMENTO="github-actions-$APP"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "$COMMENTO" -f "$KEY"
AK=/root/.ssh/authorized_keys
touch "$AK"
{ grep -v " $COMMENTO\$" "$AK" || true
  echo "restrict,command=\"bash $DIR/deploy/aggiornamento-automatico.sh\" $(cat "$KEY.pub")"
} > "$AK.nuovo"
mv "$AK.nuovo" "$AK" && chmod 600 "$AK"

# 3. Controlli sul server SSH
# (niente pipe con set -o pipefail: se sshd -T fallisce o awk chiude prima, lo script si fermava in silenzio)
SSHD_CONF=$(sshd -T 2>/dev/null || true)
ROOTLOGIN=$(awk '/^permitrootlogin /{print $2}' <<<"$SSHD_CONF")
PORTA=$(awk '/^port /{print $2}' <<<"$SSHD_CONF" | head -n1 || true)
PORTA=${PORTA:-22}
if [ "$ROOTLOGIN" = "no" ]; then
  echo "ATTENZIONE: il server SSH non accetta root (PermitRootLogin no)."
  echo "Metti 'PermitRootLogin prohibit-password' in /etc/ssh/sshd_config e lancia: systemctl reload ssh"
fi
IP=$(hostname -I 2>/dev/null || true)
IP=${IP%% *}

riga() { printf '%.0s─' {1..70}; echo; }
echo
echo "Fatto. Ora apri:  https://github.com/$(git remote get-url origin | sed -E 's#\.git$##; s#^.*[:/]([^/:]+/[^/:]+)$#\1#')/settings/secrets/actions/new"
echo "e crea questi Secrets (Name = nome, Secret = valore):"
echo
echo "• DEPLOY_HOST  →  l'indirizzo IP di questa VPS (dovrebbe essere: $IP)"
[ "$PORTA" = 22 ] || echo "• DEPLOY_PORT  →  $PORTA"
echo
echo "• DEPLOY_KNOWN_HOSTS  →  questa riga (l'impronta della VPS, serve a GitHub per riconoscerla):"
riga; cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub; riga
echo
echo "• DEPLOY_SSH_KEY  →  TUTTO il blocco qui sotto, comprese le righe BEGIN e END:"
riga; cat "$KEY"; riga
echo
echo "La chiave DEPLOY_SSH_KEY è segreta: incollala solo su GitHub, non in chat né in email."
echo "Dopo, su GitHub → Actions → «Aggiorna server» → Run workflow per la prima prova."
