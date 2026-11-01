"use strict";
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "blucheck.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS aziende (
  id TEXT PRIMARY KEY,
  ragione TEXT NOT NULL,
  piva TEXT DEFAULT '',
  indirizzo TEXT DEFAULT '',
  cap TEXT DEFAULT '',
  telefono TEXT DEFAULT '',
  email TEXT DEFAULT '',
  stato TEXT NOT NULL DEFAULT 'in_attesa',      -- in_attesa | attiva | sospesa
  abbonamento_fine TEXT,                         -- AAAA-MM-GG, ultimo giorno incluso
  max_tecnici INTEGER NOT NULL DEFAULT 1,
  piano_id TEXT,
  impostazioni TEXT NOT NULL DEFAULT '{}',       -- JSON: luogo, preavviso
  note TEXT DEFAULT '',
  richiesta TEXT DEFAULT '',                     -- messaggio della richiesta dal sito
  creato TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS utenti (
  id TEXT PRIMARY KEY,
  azienda_id TEXT REFERENCES aziende(id) ON DELETE CASCADE,
  ruolo TEXT NOT NULL,                           -- superuser | admin | tecnico
  nome TEXT DEFAULT '',
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hash TEXT NOT NULL,
  cf TEXT DEFAULT '',
  sigillo TEXT DEFAULT '',
  firma TEXT DEFAULT '',
  attivo INTEGER NOT NULL DEFAULT 1,
  cambia_pwd INTEGER NOT NULL DEFAULT 0,
  creato TEXT NOT NULL,
  ultimo_accesso TEXT
);
CREATE TABLE IF NOT EXISTS sessioni (
  token TEXT PRIMARY KEY,
  utente_id TEXT NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  scade INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dati (
  azienda_id TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  eliminato INTEGER NOT NULL DEFAULT 0,
  aggiornato TEXT NOT NULL,
  PRIMARY KEY (azienda_id, coll, id)
);
CREATE INDEX IF NOT EXISTS dati_sync ON dati(azienda_id, aggiornato);
CREATE TABLE IF NOT EXISTS piani (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descrizione TEXT DEFAULT '',
  max_tecnici INTEGER NOT NULL,
  mesi INTEGER NOT NULL,
  prezzo_cent INTEGER NOT NULL,
  attivo INTEGER NOT NULL DEFAULT 1,
  ordine INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pagamenti (
  id TEXT PRIMARY KEY,
  azienda_id TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  piano_id TEXT,
  descrizione TEXT DEFAULT '',
  importo_cent INTEGER NOT NULL DEFAULT 0,
  metodo TEXT NOT NULL,                          -- stripe | bonifico | contanti | omaggio | altro
  rif_esterno TEXT UNIQUE,
  periodo_da TEXT,
  periodo_a TEXT,
  creato TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS avvisi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  azienda_id TEXT REFERENCES aziende(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  chiave TEXT UNIQUE,
  testo TEXT NOT NULL,
  email_inviata INTEGER NOT NULL DEFAULT 0,
  creato TEXT NOT NULL
);
`);

// Colonne aggiunte dopo la prima versione (prova dal sito, accettazione dei termini): si creano se mancano.
{
  const cols = db.prepare("PRAGMA table_info(aziende)").all().map((c) => c.name);
  for (const [nome, def] of [["prova", "INTEGER NOT NULL DEFAULT 0"], ["terms_version", "TEXT DEFAULT ''"], ["terms_at", "TEXT DEFAULT ''"], ["terms_ip", "TEXT DEFAULT ''"]]) {
    if (!cols.includes(nome)) db.exec(`ALTER TABLE aziende ADD COLUMN ${nome} ${def}`);
  }
}

// Piani di esempio al primo avvio: prezzi modificabili dal pannello superuser.
if (db.prepare("SELECT COUNT(*) n FROM piani").get().n === 0) {
  const ins = db.prepare("INSERT INTO piani (id,nome,descrizione,max_tecnici,mesi,prezzo_cent,ordine) VALUES (?,?,?,?,?,?,?)");
  ins.run("solo", "Solo", "Per il tecnico che lavora da solo", 1, 12, 9900, 1);
  ins.run("team", "Team", "Per i piccoli laboratori", 3, 12, 19900, 2);
  ins.run("lab", "Laboratorio", "Per i laboratori con più squadre", 10, 12, 34900, 3);
}

module.exports = db;
