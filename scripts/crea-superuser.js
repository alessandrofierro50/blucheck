"use strict";
// Uso: node scripts/crea-superuser.js email@dominio.it "Password-sicura" "Nome Cognome"
// Crea un superuser, oppure ne reimposta la password se l'email esiste già.
const path = require("path");
process.chdir(path.join(__dirname, ".."));
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const [email, password, nome] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error('Uso: node scripts/crea-superuser.js email "password di almeno 10 caratteri" "Nome"');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 10);
const u = db.prepare("SELECT * FROM utenti WHERE email=?").get(email.toLowerCase());
if (u) {
  if (u.ruolo !== "superuser") { console.error("Questa email appartiene a un utente di un'azienda: usa un'altra email."); process.exit(1); }
  db.prepare("UPDATE utenti SET hash=?, attivo=1 WHERE id=?").run(hash, u.id);
  console.log("Password del superuser aggiornata.");
} else {
  db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,1,0,?)")
    .run(crypto.randomBytes(9).toString("base64url"), null, "superuser", nome || "Amministratore", email.toLowerCase(), hash, new Date().toISOString());
  console.log("Superuser creato:", email);
}
