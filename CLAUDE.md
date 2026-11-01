# BluCheck — istruzioni per Claude

Gestionale in abbonamento per i laboratori abilitati alle verificazioni periodiche dei registratori telematici.
Installazione e struttura: vedi `LEGGIMI.md`.

## Progetto BluCode
Questo software fa parte del progetto BluCode Informatica. La memoria condivisa è nel repository
[`Progetto_blucode_informatica`](https://github.com/alessandrofierro50/Progetto_blucode_informatica).
- **A inizio sessione:** leggi `README.md`, tutti i file in `comune/` e `blucheck/STATO.md` con l'ultima sessione in `blucheck/sessioni/`.
- **Rispetta gli standard comuni** (prova, abbonamenti, pagamenti, brand, email, Console). BluCheck non è ancora allineato: l'elenco è in `blucheck/STATO.md`.
- **A fine sessione:** scrivi il riepilogo in `blucheck/sessioni/AAAA-MM-GG.md`, aggiorna `blucheck/STATO.md` e, se serve, `comune/`.
- Se cambiano funzioni, prezzi, nome o stato, segnala che va aggiornata la pagina del sito (`content.py`).

## Note tecniche
- Node.js 20, Express, SQLite (better-sqlite3), pm2. Una sola istanza (SQLite).
- `server.js` API e abbonamenti · `ae-qr.js` lettura della pagina AdE del QR · `public/js/app.js` app tecnici · `public/js/admin.js` superuser · `public/js/pdf.js` moduli PDF.
- Le password e le chiavi stanno solo nel `.env` del server, mai nel repository.
