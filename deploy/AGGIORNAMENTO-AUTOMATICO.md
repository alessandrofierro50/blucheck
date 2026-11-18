# Aggiornamento automatico del server

A ogni modifica unita su `main` e solo se i controlli automatici (CI) sono verdi, GitHub si collega da solo alla VPS e lancia
`deploy/aggiornamento-automatico.sh`, che esegue `bash deploy/update.sh` (codice nuovo e riavvio).
Il flusso è `.github/workflows/aggiorna-server.yml`; l'esito si vede su GitHub → **Actions** → «Aggiorna server».
Il registro resta anche sulla VPS in `/var/log/aggiornamento-blucheck.log`.

## Preparazione (una volta sola)

1. Sulla VPS, da root:
   ```bash
   cd /opt/blucheck && git pull --ff-only && bash deploy/setup-aggiornamento-automatico.sh
   ```
   Lo script crea una chiave SSH dedicata che può fare **solo** l'aggiornamento di questo programma
   (`restrict,command=...` in `/root/.ssh/authorized_keys`: niente terminale, niente altri comandi)
   e stampa i valori da incollare.
2. Su GitHub → **Settings → Secrets and variables → Actions → New repository secret**, crea:
   - `DEPLOY_HOST`: l'IP della VPS (217.76.158.224)
   - `DEPLOY_KNOWN_HOSTS`: la riga `ssh-ed25519 ...` stampata dallo script (l'impronta della VPS)
   - `DEPLOY_SSH_KEY`: il blocco `-----BEGIN OPENSSH PRIVATE KEY----- ... END ...` stampato dallo script
   - facoltativi: `DEPLOY_PORT` (se SSH non è sulla 22), `DEPLOY_USER` (predefinito `root`)
3. GitHub → **Actions → Aggiorna server → Run workflow** per la prima prova.

Finché i Secrets non ci sono, il flusso non fa nulla (avviso giallo, non errore).
Se `update.sh` fallisce, il flusso diventa rosso e il log spiega il perché.

## Per togliere l'accesso

Sulla VPS: `sed -i '/ github-actions-blucheck$/d' /root/.ssh/authorized_keys`, poi cancella i Secrets su GitHub.
