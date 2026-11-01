"use strict";
// Copia coerente del database in data/backup/blucheck-AAAA-MM-GG.db (tiene gli ultimi 30).
// Da cron: 30 2 * * * cd /opt/blucheck && /usr/bin/node scripts/backup.js
const path = require("path");
const fs = require("fs");
process.chdir(path.join(__dirname, ".."));
const db = require("../db");
const dir = path.join(path.dirname(db.name), "backup");
fs.mkdirSync(dir, { recursive: true });
const d = new Date();
const file = path.join(dir, `blucheck-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.db`);
db.backup(file).then(() => {
  console.log("Backup creato:", file);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("blucheck-")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(dir, f));
}).catch((e) => { console.error("Backup non riuscito:", e); process.exit(1); });
