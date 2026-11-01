"use strict";
/*
 * BluCheck - server
 * Gestione verificazioni periodiche dei registratori telematici, multi-azienda,
 * con abbonamenti, pagamenti online (Stripe: carta, Google Pay, Apple Pay, PayPal) e avvisi di scadenza.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Carica .env senza dipendenze esterne
(function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
if (!process.env.TZ) process.env.TZ = "Europe/Rome";

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { leggiQrAe } = require("./ae-qr");

const PORT = Number(process.env.PORT || 3030);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PROD = process.env.NODE_ENV === "production";
const PROVA_GIORNI = Number(process.env.PROVA_GIORNI || 30);
// Prova gratuita dal sito (contratto comune BluCode: comune/prova-gratuita.md)
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
const WEBSITE_URL = (process.env.WEBSITE_URL || "https://blucodeinformatica.it").replace(/\/$/, "");
const TERMS_VERSION = process.env.TERMS_VERSION || "1.0";
const TERMS_URL = process.env.TERMS_URL || `${WEBSITE_URL}/termini/`;
const TERMS_PDF_URL = process.env.TERMS_PDF_URL || `${WEBSITE_URL}/termini/termini-di-utilizzo-v${TERMS_VERSION}.pdf`;
const APP_NAME = "BluCheck";

const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = require("nodemailer").createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS } : undefined,
  });
}

/* ============================== utilità ============================== */
const uid = () => crypto.randomBytes(9).toString("base64url");
const nowISO = () => new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const oggi = () => toISO(new Date());
const parseD = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseD(iso); d.setDate(d.getDate() + n); return toISO(d); };
const addMonths = (iso, n) => { const d = parseD(iso); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return toISO(d); };
const giorniA = (iso) => iso ? Math.round((parseD(iso) - parseD(oggi())) / 86400000) : null;
const fmtD = (iso) => iso ? iso.split("-").reverse().join("/") : "-";
const euro = (cent) => (cent / 100).toFixed(2).replace(".", ",") + " €";
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const tempPassword = () => {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; const b = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) s += a[b[i] % a.length];
  return s;
};
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

async function sendMail(to, subject, text, attachments) {
  const list = [...new Set([].concat(to).filter(Boolean).map((e) => e.trim()))];
  if (!list.length) return false;
  if (!mailer) { console.log(`[email non configurata] a ${list.join(", ")}: ${subject}\n${text}\n`); return false; }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: list.join(", "), subject, text, attachments: attachments || undefined });
    return true;
  } catch (e) { console.error("Invio email non riuscito:", e.message); return false; }
}
const superEmails = () => (process.env.ALERT_EMAIL ? process.env.ALERT_EMAIL.split(",") : db.prepare("SELECT email FROM utenti WHERE ruolo='superuser' AND attivo=1").all().map((r) => r.email));
const adminEmails = (aziendaId) => db.prepare("SELECT email FROM utenti WHERE azienda_id=? AND ruolo='admin' AND attivo=1").all(aziendaId).map((r) => r.email);

/* ============================== abbonamenti ============================== */
function statoAbbonamento(az) {
  if (!az) return null;
  const g = giorniA(az.abbonamento_fine);
  return {
    fine: az.abbonamento_fine || null,
    giorni: g,
    scaduto: g === null || g < 0,
    inScadenza: g !== null && g >= 0 && g <= 30,
  };
}
const aziendaPub = (az) => az && ({
  id: az.id, ragione: az.ragione, piva: az.piva, indirizzo: az.indirizzo, cap: az.cap, telefono: az.telefono, email: az.email,
  stato: az.stato, abbonamento_fine: az.abbonamento_fine, max_tecnici: az.max_tecnici, piano_id: az.piano_id,
  impostazioni: JSON.parse(az.impostazioni || "{}"),
});
const utentePub = (u) => u && ({
  id: u.id, azienda_id: u.azienda_id, ruolo: u.ruolo, nome: u.nome, email: u.email, cf: u.cf, sigillo: u.sigillo,
  attivo: !!u.attivo, cambia_pwd: !!u.cambia_pwd, ultimo_accesso: u.ultimo_accesso, creato: u.creato, haFirma: !!u.firma,
});
const tecniciAttivi = (aziendaId) => db.prepare("SELECT COUNT(*) n FROM utenti WHERE azienda_id=? AND attivo=1 AND ruolo IN ('admin','tecnico')").get(aziendaId).n;

/** Registra un pagamento ed estende l'abbonamento. Idempotente su rif_esterno. */
const applicaPagamento = db.transaction(({ aziendaId, pianoId, mesi, importoCent, metodo, rif, descrizione, maxTecnici }) => {
  if (rif && db.prepare("SELECT 1 FROM pagamenti WHERE rif_esterno=?").get(rif)) return { gia: true };
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(aziendaId);
  if (!az) fail(404, "Azienda non trovata");
  const piano = pianoId ? db.prepare("SELECT * FROM piani WHERE id=?").get(pianoId) : null;
  const m = Number(mesi || piano?.mesi || 0);
  let da = oggi(), a = az.abbonamento_fine;
  if (m > 0) {
    if (az.abbonamento_fine && az.abbonamento_fine >= oggi()) da = addDays(az.abbonamento_fine, 1);
    a = addDays(addMonths(da, m), -1);
  }
  const maxT = Number(maxTecnici || piano?.max_tecnici || az.max_tecnici);
  db.prepare("UPDATE aziende SET abbonamento_fine=?, max_tecnici=?, piano_id=COALESCE(?, piano_id), stato=CASE WHEN stato='in_attesa' THEN 'attiva' ELSE stato END WHERE id=?")
    .run(a, maxT, piano?.id || null, aziendaId);
  const id = uid();
  db.prepare("INSERT INTO pagamenti (id,azienda_id,piano_id,descrizione,importo_cent,metodo,rif_esterno,periodo_da,periodo_a,creato) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, aziendaId, piano?.id || null, descrizione || (piano ? `${APP_NAME} ${piano.nome} - ${piano.mesi} mesi` : "Rinnovo"), importoCent || 0, metodo, rif || null, m > 0 ? da : null, m > 0 ? a : null, nowISO());
  return { id, da, a, az };
});

/* ============================== avvisi di scadenza ============================== */
const SOGLIE = [30, 15, 7, 1, 0];
async function controllaScadenze() {
  const aziende = db.prepare("SELECT * FROM aziende WHERE stato='attiva' AND abbonamento_fine IS NOT NULL").all();
  let creati = 0;
  for (const az of aziende) {
    const g = giorniA(az.abbonamento_fine);
    let soglia = null;
    if (g < 0) soglia = "scaduto";
    else { const t = SOGLIE.filter((s) => g <= s).sort((x, y) => x - y)[0]; if (t !== undefined) soglia = String(t); }
    if (soglia === null) continue;
    // appena attivata (es. periodo di prova): non avvisare subito, aspetta la soglia dei 15 giorni
    if (g > 15 && Date.now() - new Date(az.creato).getTime() < 7 * 86400000) continue;
    const chiave = `${az.id}:${az.abbonamento_fine}:${soglia}`;
    if (db.prepare("SELECT 1 FROM avvisi WHERE chiave=?").get(chiave)) continue;
    const quando = g < 0 ? `è scaduto il ${fmtD(az.abbonamento_fine)}` : g === 0 ? "scade oggi" : `scade il ${fmtD(az.abbonamento_fine)} (tra ${g} giorni)`;
    const testo = `L'abbonamento ${APP_NAME} di ${az.ragione} ${quando}.`;
    db.prepare("INSERT INTO avvisi (azienda_id,tipo,chiave,testo,creato) VALUES (?,?,?,?,?)").run(az.id, g < 0 ? "scaduto" : "in_scadenza", chiave, testo, nowISO());
    creati++;
    const corpoCliente = `${testo}\n\n` + (g < 0
      ? `L'archivio resta consultabile e i rapporti si possono ancora stampare, ma non è possibile registrare nuove verifiche finché l'abbonamento non viene rinnovato.\n\n`
      : `Per non interrompere il servizio rinnova dall'app: Impostazioni > Abbonamento, con carta, Google Pay o PayPal.\n\n`) + `${BASE_URL}/app\n\n${APP_NAME}`;
    const ok = await sendMail([az.email, ...adminEmails(az.id)], `${APP_NAME}: abbonamento ${g < 0 ? "scaduto" : "in scadenza"}`, corpoCliente);
    await sendMail(superEmails(), `[${APP_NAME}] ${az.ragione}: abbonamento ${g < 0 ? "scaduto" : "in scadenza"}`, `${testo}\nP.IVA ${az.piva}\nEmail ${az.email}\nTel. ${az.telefono}\n\n${BASE_URL}/admin`);
    if (ok) db.prepare("UPDATE avvisi SET email_inviata=1 WHERE chiave=?").run(chiave);
  }
  db.prepare("DELETE FROM sessioni WHERE scade < ?").run(Date.now());
  return creati;
}

/* ============================== app ============================== */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com");
  next();
});

/* ---------- webhook Stripe (corpo grezzo, prima di express.json) ---------- */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send("Stripe non configurato");
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send(`Firma non valida: ${e.message}`); }
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object;
      if (s.payment_status === "paid") await registraSessioneStripe(s);
    }
    res.json({ received: true });
  } catch (e) { console.error("Webhook:", e); res.status(500).send("Errore"); }
});

async function registraSessioneStripe(s) {
  const { azienda_id: aziendaId, piano_id: pianoId } = s.metadata || {};
  if (!aziendaId || !pianoId) return { gia: true };
  const r = applicaPagamento({ aziendaId, pianoId, importoCent: s.amount_total, metodo: "stripe", rif: s.id });
  if (!r.gia) {
    const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(aziendaId);
    const testo = `Pagamento ricevuto: ${euro(s.amount_total)}.\nAbbonamento ${APP_NAME} di ${az.ragione} attivo fino al ${fmtD(az.abbonamento_fine)}.`;
    db.prepare("INSERT INTO avvisi (azienda_id,tipo,chiave,testo,creato) VALUES (?,?,?,?,?)").run(aziendaId, "pagamento", `pag:${s.id}`, testo, nowISO());
    await sendMail([az.email, ...adminEmails(aziendaId)], `${APP_NAME}: pagamento ricevuto`, `${testo}\n\nGrazie!\n${APP_NAME}`);
    await sendMail(superEmails(), `[${APP_NAME}] Pagamento da ${az.ragione}`, `${testo}\nP.IVA ${az.piva}\nRicordati di emettere la fattura elettronica.`);
  }
  return r;
}

app.use(express.json({ limit: "2mb" }));

/* ---------- sessione ---------- */
function readCookie(req, name) {
  const c = req.headers.cookie || "";
  for (const part of c.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return decodeURIComponent(v.join("=")); }
  return null;
}
const COOKIE = "bc_sess";
function setSession(res, token, maxAgeSec) {
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${PROD ? "; Secure" : ""}`);
}
app.use((req, res, next) => {
  const t = readCookie(req, COOKIE);
  if (t) {
    const row = db.prepare("SELECT u.* FROM sessioni s JOIN utenti u ON u.id=s.utente_id WHERE s.token=? AND s.scade>?").get(hashToken(t), Date.now());
    if (row && row.attivo) {
      req.user = row;
      if (row.azienda_id) req.azienda = db.prepare("SELECT * FROM aziende WHERE id=?").get(row.azienda_id);
    }
  }
  next();
});
// Protezione CSRF: le richieste che modificano dati devono avere l'intestazione X-BluCheck (impossibile da un altro sito senza CORS).
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.path === "/public/prova") return next(); // arriva dal sito: CORS ristretto a WEBSITE_URL, limiti e campo trappola
  if (req.headers["x-blucheck"] !== "1") return res.status(403).json({ error: "Richiesta non valida" });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Accesso scaduto: entra di nuovo.", code: "login" });
  if (req.user.ruolo !== "superuser" && (!req.azienda || req.azienda.stato !== "attiva"))
    return res.status(403).json({ error: "L'account della tua azienda non è attivo. Contatta l'assistenza.", code: "sospeso" });
  next();
};
const solo = (...ruoli) => (req, res, next) => ruoli.includes(req.user?.ruolo) ? next() : res.status(403).json({ error: "Operazione non consentita per il tuo ruolo." });
const scrivibile = (req, res, next) => statoAbbonamento(req.azienda).scaduto
  ? res.status(402).json({ error: "Abbonamento scaduto: rinnova da Impostazioni > Abbonamento per registrare nuove verifiche.", code: "abbonamento_scaduto" })
  : next();

/* ---------- limitatore semplice ---------- */
const buckets = new Map();
function limita(key, max, windowMs) {
  const now = Date.now(); const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b);
  if (b.n > max) fail(429, "Troppi tentativi. Riprova tra qualche minuto.");
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 3600000) buckets.delete(k); }, 600000).unref();

/* ============================== API pubbliche ============================== */
app.get("/api/config", (req, res) => res.json({
  app: APP_NAME, stripe: !!stripe, prova_giorni: PROVA_GIORNI,
  contatti: { email: process.env.CONTATTO_EMAIL || "", telefono: process.env.CONTATTO_TELEFONO || "", sito: process.env.CONTATTO_SITO || "" },
}));
app.get("/api/piani", (req, res) => res.json(db.prepare("SELECT id,nome,descrizione,max_tecnici,mesi,prezzo_cent FROM piani WHERE attivo=1 ORDER BY ordine, prezzo_cent").all()));

/* ---------- prova gratuita dal sito ---------- */
function pivaValida(v) {
  if (!/^\d{11}$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) { let n = Number(v[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } somma += n; }
  return (10 - (somma % 10)) % 10 === Number(v[10]);
}
const emailValida = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
// CORS aperto solo al sito (WEBSITE_URL, anche con www)
app.use("/api/public/prova", (req, res, next) => {
  const origin = req.headers.origin;
  const host = WEBSITE_URL.replace(/^https?:\/\//, "");
  if (origin && [WEBSITE_URL, `https://www.${host}`, `http://www.${host}`].includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/api/public/prova", (req, res) => res.json({
  enabled: TRIAL_DAYS > 0, product: APP_NAME, plan: "Laboratorio", days: TRIAL_DAYS, terms_version: TERMS_VERSION,
}));
async function scaricaTermini() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(TERMS_PDF_URL, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1000 && buf.slice(0, 4).toString() === "%PDF" ? buf : null;
  } catch { return null; }
}
app.post("/api/public/prova", wrap(async (req, res) => {
  const errore = (status, message, code) => res.status(status).json({ detail: code ? { code, message } : message });
  const b = req.body || {};
  const email = str(b.email, 200).toLowerCase();
  const finto = { ok: true, email, email_sent: true, message: `Ti abbiamo mandato a ${email} il nome utente e la password provvisoria.` };
  // robot: campo trappola pieno o compilato troppo in fretta → finto successo, nessuna azienda
  if (str(b.website, 200) || (Number.isFinite(Number(b.elapsed_ms)) && b.elapsed_ms !== null && b.elapsed_ms !== undefined && Number(b.elapsed_ms) < 3000)) {
    console.log(`Iscrizione alla prova scartata (robot) da ${req.ip}`);
    return res.status(201).json(finto);
  }
  if (TRIAL_DAYS <= 0) return errore(404, "Le iscrizioni alla prova gratuita sono chiuse");
  const ragione = str(b.company_name, 200), nome = str(b.name, 120);
  if (ragione.length < 2) return errore(422, "Scrivi la ragione sociale");
  if (nome.length < 2) return errore(422, "Scrivi nome e cognome del referente");
  if (!emailValida(email)) return errore(422, "Indirizzo email non valido");
  if (b.privacy !== true) return errore(422, "Per continuare accetta l'informativa sulla privacy");
  if (b.terms !== true) return errore(422, "Per continuare accetta i termini di utilizzo");
  if (str(b.terms_version, 20) !== TERMS_VERSION) return errore(422, "I termini di utilizzo sono stati aggiornati: ricarica la pagina, rileggili e accettali di nuovo");
  const piva = str(b.vat_number, 30).replace(/\s/g, "").toUpperCase().replace(/^IT/, "");
  if (piva && !pivaValida(piva)) return errore(422, "Partita IVA non valida");
  try {
    limita("prova-ip:" + req.ip, 10, 3600000);
    limita("prova-email:" + email, 10, 86400000);
    limita("prova-giorno", 50, 86400000);
  } catch (e) { return errore(429, "Troppi tentativi di iscrizione: riprova più tardi o scrivici"); }
  if (db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email))
    return errore(409, "Questa email ha già un accesso a BluCheck: contattaci se non riesci a entrare.", "email_registrata");
  if (piva && db.prepare("SELECT 1 FROM aziende WHERE piva=?").get(piva))
    return errore(409, "Questa azienda è già registrata: contatta l'assistenza per riattivare l'accesso.", "azienda_registrata");

  const fine = addDays(oggi(), Math.max(1, TRIAL_DAYS) - 1);
  const maxT = db.prepare("SELECT MAX(max_tecnici) m FROM piani WHERE attivo=1").get().m || 10;
  const piano = db.prepare("SELECT id FROM piani WHERE attivo=1 ORDER BY max_tecnici DESC, prezzo_cent DESC LIMIT 1").get();
  const azId = uid(), pwd = tempPassword();
  db.transaction(() => {
    db.prepare("INSERT INTO aziende (id,ragione,piva,telefono,email,stato,abbonamento_fine,max_tecnici,piano_id,note,prova,terms_version,terms_at,terms_ip,creato) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)")
      .run(azId, ragione, piva, str(b.phone, 40), email, "attiva", fine, maxT, piano?.id || null,
        `Iscritto dal sito il ${fmtD(oggi())} (IP ${req.ip}), termini v${TERMS_VERSION}${str(b.sector, 80) ? `, settore: ${str(b.sector, 80)}` : ""}`,
        TERMS_VERSION, nowISO(), String(req.ip || ""), nowISO());
    db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,1,1,?)")
      .run(uid(), azId, "admin", nome, email, bcrypt.hashSync(pwd, 10), nowISO());
  })();
  const pdf = await scaricaTermini();
  const testo = `Gentile ${nome},\nla prova gratuita di ${APP_NAME} per ${ragione} è attiva fino al ${fmtD(fine)} (${TRIAL_DAYS} giorni).\n\n`
    + `Indirizzo: ${BASE_URL}/app\nNome utente: ${email}\nPassword provvisoria: ${pwd}\n\n`
    + `Al primo accesso ti verrà chiesto di scegliere una nuova password.\n\n`
    + `Entrando accetti i termini di utilizzo (versione ${TERMS_VERSION}), che trovi anche qui: ${TERMS_URL}${pdf ? " e in allegato in PDF" : ""}.\n\n`
    + `Se hai bisogno di aiuto rispondi a questa email.\n\n${APP_NAME} · BluCode Informatica`;
  const inviata = await sendMail(email, `${APP_NAME}: la tua prova gratuita è attiva`, testo,
    pdf ? [{ filename: `termini-di-utilizzo-v${TERMS_VERSION}.pdf`, content: pdf, contentType: "application/pdf" }] : undefined);
  await sendMail(process.env.ADMIN_NOTIFY_EMAIL ? process.env.ADMIN_NOTIFY_EMAIL.split(",") : superEmails(), `Nuova prova gratuita: ${ragione}`,
    `Nuova prova gratuita di ${APP_NAME}\nAzienda: ${ragione}\nP.IVA: ${piva || "-"}\nReferente: ${nome}\nEmail: ${email}\nTelefono: ${str(b.phone, 40) || "-"}\nScade: ${fmtD(fine)}\nTermini v${TERMS_VERSION} accettati da IP ${req.ip}\n\n${BASE_URL}/admin`);
  db.prepare("INSERT INTO avvisi (azienda_id,tipo,testo,creato) VALUES (?,?,?,?)").run(azId, "prova", `Prova gratuita dal sito: ${ragione} (${nome}, ${email}).`, nowISO());
  res.status(201).json(inviata
    ? { ok: true, email, email_sent: true, message: finto.message }
    : { ok: true, email, email_sent: false, message: "Abbiamo creato la tua prova, ma l'email con le credenziali non è partita: ti contattiamo noi a breve." });
}));

app.post("/api/login", wrap(async (req, res) => {
  limita("login:" + req.ip, 10, 15 * 60000);
  const email = str(req.body.email, 200).toLowerCase(), pwd = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM utenti WHERE email=?").get(email);
  if (u && !u.attivo && u.azienda_id && db.prepare("SELECT stato FROM aziende WHERE id=?").get(u.azienda_id)?.stato === "in_attesa")
    fail(403, "La richiesta di attivazione è in attesa: riceverai le credenziali per email appena il laboratorio è abilitato.");
  if (!u || !u.attivo || !(await bcrypt.compare(pwd, u.hash))) fail(401, "Email o password non corretti.");
  if (u.ruolo !== "superuser") {
    const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(u.azienda_id);
    if (!az || az.stato === "in_attesa") fail(403, "La tua azienda non è ancora stata abilitata. Riceverai le credenziali quando l'attivazione è completata.");
    if (az.stato !== "attiva") fail(403, "L'account della tua azienda è sospeso. Contatta l'assistenza.");
  }
  const token = crypto.randomBytes(32).toString("hex");
  const giorni = 30;
  db.prepare("INSERT INTO sessioni (token,utente_id,scade) VALUES (?,?,?)").run(hashToken(token), u.id, Date.now() + giorni * 86400000);
  db.prepare("UPDATE utenti SET ultimo_accesso=? WHERE id=?").run(nowISO(), u.id);
  setSession(res, token, giorni * 86400);
  res.json({ ok: true, ruolo: u.ruolo, cambia_pwd: !!u.cambia_pwd });
}));
app.post("/api/logout", (req, res) => {
  const t = readCookie(req, COOKIE); if (t) db.prepare("DELETE FROM sessioni WHERE token=?").run(hashToken(t));
  setSession(res, "", 0); res.json({ ok: true });
});

app.post("/api/richiesta", wrap(async (req, res) => {
  limita("rich:" + req.ip, 5, 3600000);
  const b = req.body || {};
  const ragione = str(b.ragione, 200), email = str(b.email, 200).toLowerCase(), nome = str(b.nome, 120);
  if (!ragione || !email || !nome) fail(400, "Compila ragione sociale, nome del referente ed email.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Indirizzo email non valido.");
  if (db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email)) fail(409, "Questa email è già registrata. Se hai dimenticato la password contatta l'assistenza.");
  const azId = uid();
  const piano = b.piano_id ? db.prepare("SELECT id FROM piani WHERE id=? AND attivo=1").get(str(b.piano_id, 40)) : null;
  db.transaction(() => {
    db.prepare("INSERT INTO aziende (id,ragione,piva,indirizzo,cap,telefono,email,stato,max_tecnici,piano_id,richiesta,creato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(azId, ragione, str(b.piva, 20), str(b.indirizzo), str(b.cap), str(b.telefono, 40), email, "in_attesa", 1, piano?.id || null, str(b.messaggio, 2000), nowISO());
    db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,cf,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(uid(), azId, "admin", nome, email, bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10), str(b.cf, 20).toUpperCase(), 0, 1, nowISO());
    db.prepare("INSERT INTO avvisi (azienda_id,tipo,testo,creato) VALUES (?,?,?,?)").run(azId, "richiesta", `Nuova richiesta di attivazione da ${ragione} (${nome}, ${email}).`, nowISO());
  })();
  await sendMail(superEmails(), `[${APP_NAME}] Nuova richiesta: ${ragione}`, `Ragione sociale: ${ragione}\nP.IVA: ${str(b.piva)}\nReferente: ${nome}\nEmail: ${email}\nTelefono: ${str(b.telefono)}\nPiano: ${piano?.id || "-"}\n\n${str(b.messaggio, 2000)}\n\nAbilita da ${BASE_URL}/admin`);
  await sendMail(email, `${APP_NAME}: richiesta ricevuta`, `Gentile ${nome},\nabbiamo ricevuto la richiesta di attivazione di ${APP_NAME} per ${ragione}.\nRiceverai le credenziali di accesso a questo indirizzo appena l'account sarà abilitato.\n\n${APP_NAME}`);
  res.json({ ok: true });
}));

/* ============================== API utente ============================== */
app.get("/api/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Non autenticato", code: "login" });
  res.json({ user: utentePub(req.user), azienda: aziendaPub(req.azienda), abbonamento: statoAbbonamento(req.azienda) });
});
app.get("/api/me/firma", auth, (req, res) => res.json({ firma: req.user.firma || "" }));
app.put("/api/me", auth, (req, res) => {
  const b = req.body || {}; const u = req.user;
  const firma = b.firma === undefined ? u.firma : String(b.firma || "");
  if (firma && (!firma.startsWith("data:image/png;base64,") || firma.length > 400000)) fail(400, "Firma non valida.");
  db.prepare("UPDATE utenti SET nome=?, cf=?, sigillo=? , firma=? WHERE id=?")
    .run(b.nome !== undefined ? str(b.nome, 120) : u.nome, b.cf !== undefined ? str(b.cf, 20).toUpperCase() : u.cf, b.sigillo !== undefined ? str(b.sigillo, 40) : u.sigillo, firma, u.id);
  res.json({ user: utentePub(db.prepare("SELECT * FROM utenti WHERE id=?").get(u.id)) });
});
app.post("/api/me/password", auth, wrap(async (req, res) => {
  const { attuale, nuova } = req.body || {};
  if (!(await bcrypt.compare(String(attuale || ""), req.user.hash))) fail(400, "La password attuale non è corretta.");
  if (String(nuova || "").length < 8) fail(400, "La nuova password deve avere almeno 8 caratteri.");
  db.prepare("UPDATE utenti SET hash=?, cambia_pwd=0 WHERE id=?").run(await bcrypt.hash(String(nuova), 10), req.user.id);
  const keep = hashToken(readCookie(req, COOKIE) || "");
  db.prepare("DELETE FROM sessioni WHERE utente_id=? AND token<>?").run(req.user.id, keep);
  res.json({ ok: true });
}));

/* ---------- dati RT dell'azienda ---------- */
const COLLS = ["clienti", "apparecchi", "verifiche", "firme"];
const SYNC_COLLS = ["clienti", "apparecchi", "verifiche"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const chk = (coll, id) => { if (!COLLS.includes(coll) || !ID_RE.test(id)) fail(400, "Percorso non valido."); };
const azOnly = (req, res, next) => req.azienda ? next() : res.status(403).json({ error: "Funzione riservata alle aziende." });

app.get("/api/bootstrap", auth, azOnly, (req, res) => {
  const out = { now: nowISO(), me: utentePub(req.user), azienda: aziendaPub(req.azienda), abbonamento: statoAbbonamento(req.azienda) };
  for (const c of SYNC_COLLS) out[c] = db.prepare("SELECT data FROM dati WHERE azienda_id=? AND coll=? AND eliminato=0").all(req.azienda.id, c).map((r) => JSON.parse(r.data));
  out.tecnici = db.prepare("SELECT id,nome,ruolo,attivo FROM utenti WHERE azienda_id=?").all(req.azienda.id);
  res.json(out);
});
app.get("/api/sync", auth, azOnly, (req, res) => {
  const since = str(req.query.since, 40) || "1970";
  const now = nowISO();
  const rows = db.prepare(`SELECT coll,id,data,eliminato FROM dati WHERE azienda_id=? AND aggiornato>=? AND coll IN (${SYNC_COLLS.map(() => "?").join(",")})`)
    .all(req.azienda.id, since, ...SYNC_COLLS).map((r) => ({ coll: r.coll, id: r.id, eliminato: !!r.eliminato, data: r.eliminato ? null : JSON.parse(r.data) }));
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(req.azienda.id);
  res.json({ now, rows, azienda: aziendaPub(az), abbonamento: statoAbbonamento(az) });
});
app.get("/api/dati/:coll/:id", auth, azOnly, (req, res) => {
  chk(req.params.coll, req.params.id);
  const r = db.prepare("SELECT data FROM dati WHERE azienda_id=? AND coll=? AND id=? AND eliminato=0").get(req.azienda.id, req.params.coll, req.params.id);
  res.json({ data: r ? JSON.parse(r.data) : null });
});
const salvaDato = db.transaction((aziendaId, coll, id, data, user) => {
  data.id = id;
  if (coll === "verifiche") {
    const prev = db.prepare("SELECT data FROM dati WHERE azienda_id=? AND coll=? AND id=?").get(aziendaId, coll, id);
    const old = prev ? JSON.parse(prev.data) : null;
    if (old?.numero) data.numero = old.numero;
    if (!data.numero) {
      const anno = isDate(data.data) ? data.data.slice(0, 4) : oggi().slice(0, 4);
      const max = db.prepare("SELECT MAX(CAST(substr(json_extract(data,'$.numero'),6) AS INTEGER)) m FROM dati WHERE azienda_id=? AND coll='verifiche' AND json_extract(data,'$.numero') LIKE ?").get(aziendaId, anno + "/%").m || 0;
      data.numero = `${anno}/${String(max + 1).padStart(4, "0")}`;
    }
    if (!old) { data.tecnicoId = user.id; data.creato = nowISO(); }
    else { data.tecnicoId = old.tecnicoId || user.id; data.creato = old.creato; }
    data.modificato = nowISO();
  }
  const json = JSON.stringify(data);
  if (json.length > 500000) fail(413, "Documento troppo grande.");
  db.prepare("INSERT INTO dati (azienda_id,coll,id,data,eliminato,aggiornato) VALUES (?,?,?,?,0,?) ON CONFLICT(azienda_id,coll,id) DO UPDATE SET data=excluded.data, eliminato=0, aggiornato=excluded.aggiornato")
    .run(aziendaId, coll, id, json, nowISO());
  return data;
});
app.put("/api/dati/:coll/:id", auth, azOnly, scrivibile, (req, res) => {
  const { coll, id } = req.params; chk(coll, id);
  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Dati non validi.");
  res.json({ data: salvaDato(req.azienda.id, coll, id, data, req.user) });
});
app.delete("/api/dati/:coll/:id", auth, azOnly, scrivibile, (req, res) => {
  const { coll, id } = req.params; chk(coll, id);
  if (coll === "verifiche" && req.user.ruolo !== "admin") fail(403, "Solo l'amministratore dell'azienda può eliminare un rapporto.");
  if (coll === "firme") db.prepare("DELETE FROM dati WHERE azienda_id=? AND coll=? AND id=?").run(req.azienda.id, coll, id);
  else db.prepare("UPDATE dati SET eliminato=1, data='{}', aggiornato=? WHERE azienda_id=? AND coll=? AND id=?").run(nowISO(), req.azienda.id, coll, id);
  res.json({ ok: true });
});
app.get("/api/firma-tecnico/:id", auth, azOnly, (req, res) => {
  const u = db.prepare("SELECT firma FROM utenti WHERE id=? AND azienda_id=?").get(str(req.params.id, 64), req.azienda.id);
  res.json({ firma: u?.firma || "" });
});

/* ---------- lettura del QR code del registratore (pagina dell'Agenzia delle Entrate) ---------- */
app.get("/api/qr/ae", auth, azOnly, wrap(async (req, res) => {
  limita("qr:" + req.azienda.id, 300, 3600000);
  try { res.json({ dati: await leggiQrAe(String(req.query.url || "")) }); }
  catch (e) { fail(e.status || 502, e.message); }
}));

/* ---------- amministratore dell'azienda ---------- */
app.put("/api/azienda", auth, azOnly, solo("admin"), (req, res) => {
  const b = req.body || {}; const az = req.azienda;
  const imp = { ...JSON.parse(az.impostazioni || "{}") };
  if (b.impostazioni) { imp.luogo = str(b.impostazioni.luogo, 80); imp.preavviso = Math.max(1, Math.min(365, Number(b.impostazioni.preavviso) || 60)); }
  db.prepare("UPDATE aziende SET ragione=?, piva=?, indirizzo=?, cap=?, telefono=?, email=?, impostazioni=? WHERE id=?")
    .run(str(b.ragione ?? az.ragione, 200) || az.ragione, str(b.piva ?? az.piva, 20), str(b.indirizzo ?? az.indirizzo), str(b.cap ?? az.cap), str(b.telefono ?? az.telefono, 40), str(b.email ?? az.email, 200), JSON.stringify(imp), az.id);
  res.json({ azienda: aziendaPub(db.prepare("SELECT * FROM aziende WHERE id=?").get(az.id)) });
});
app.get("/api/tecnici", auth, azOnly, solo("admin"), (req, res) => {
  res.json({ tecnici: db.prepare("SELECT * FROM utenti WHERE azienda_id=? ORDER BY ruolo, nome").all(req.azienda.id).map(utentePub), max: req.azienda.max_tecnici, attivi: tecniciAttivi(req.azienda.id) });
});
app.post("/api/tecnici", auth, azOnly, solo("admin"), wrap(async (req, res) => {
  const b = req.body || {}; const az = req.azienda;
  const email = str(b.email, 200).toLowerCase(), nome = str(b.nome, 120);
  if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Inserisci nome ed email validi.");
  if (tecniciAttivi(az.id) >= az.max_tecnici) fail(409, `Hai raggiunto il numero massimo di tecnici del tuo abbonamento (${az.max_tecnici}). Passa a un piano superiore da Abbonamento.`, "limite_tecnici");
  if (db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email)) fail(409, "Questa email è già usata da un altro utente.");
  const pwd = tempPassword(); const id = uid();
  db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,cf,sigillo,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,?,?,1,1,?)")
    .run(id, az.id, b.ruolo === "admin" ? "admin" : "tecnico", nome, email, await bcrypt.hash(pwd, 10), str(b.cf, 20).toUpperCase(), str(b.sigillo, 40), nowISO());
  const inviata = await sendMail(email, `${APP_NAME}: le tue credenziali`, `Ciao ${nome},\n${az.ragione} ti ha aggiunto come tecnico su ${APP_NAME}.\n\nIndirizzo: ${BASE_URL}/app\nEmail: ${email}\nPassword provvisoria: ${pwd}\n\nAl primo accesso ti verrà chiesto di cambiarla.`);
  res.json({ tecnico: utentePub(db.prepare("SELECT * FROM utenti WHERE id=?").get(id)), password: pwd, email_inviata: inviata });
}));
app.put("/api/tecnici/:id", auth, azOnly, solo("admin"), (req, res) => {
  const u = db.prepare("SELECT * FROM utenti WHERE id=? AND azienda_id=?").get(str(req.params.id, 64), req.azienda.id);
  if (!u) fail(404, "Tecnico non trovato.");
  const b = req.body || {};
  const attivo = b.attivo === undefined ? u.attivo : (b.attivo ? 1 : 0);
  const ruolo = b.ruolo === undefined ? u.ruolo : (b.ruolo === "admin" ? "admin" : "tecnico");
  if (u.id === req.user.id && (!attivo || ruolo !== "admin")) fail(400, "Non puoi disattivare o declassare il tuo stesso account.");
  if (attivo && !u.attivo && tecniciAttivi(req.azienda.id) >= req.azienda.max_tecnici) fail(409, `Hai raggiunto il numero massimo di tecnici (${req.azienda.max_tecnici}).`, "limite_tecnici");
  db.prepare("UPDATE utenti SET nome=?, cf=?, sigillo=?, ruolo=?, attivo=? WHERE id=?")
    .run(b.nome !== undefined ? str(b.nome, 120) : u.nome, b.cf !== undefined ? str(b.cf, 20).toUpperCase() : u.cf, b.sigillo !== undefined ? str(b.sigillo, 40) : u.sigillo, ruolo, attivo, u.id);
  if (!attivo) db.prepare("DELETE FROM sessioni WHERE utente_id=?").run(u.id);
  res.json({ tecnico: utentePub(db.prepare("SELECT * FROM utenti WHERE id=?").get(u.id)) });
});
async function resetPassword(u) {
  const pwd = tempPassword();
  db.prepare("UPDATE utenti SET hash=?, cambia_pwd=1 WHERE id=?").run(await bcrypt.hash(pwd, 10), u.id);
  db.prepare("DELETE FROM sessioni WHERE utente_id=?").run(u.id);
  const inviata = await sendMail(u.email, `${APP_NAME}: nuova password`, `Ciao ${u.nome},\nla tua password di ${APP_NAME} è stata reimpostata.\n\nIndirizzo: ${BASE_URL}/app\nEmail: ${u.email}\nPassword provvisoria: ${pwd}\n\nAl primo accesso ti verrà chiesto di cambiarla.`);
  return { password: pwd, email_inviata: inviata };
}
app.post("/api/tecnici/:id/reset", auth, azOnly, solo("admin"), wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM utenti WHERE id=? AND azienda_id=?").get(str(req.params.id, 64), req.azienda.id);
  if (!u) fail(404, "Tecnico non trovato.");
  res.json(await resetPassword(u));
}));

/* ---------- abbonamento e pagamenti dell'azienda ---------- */
app.get("/api/abbonamento", auth, azOnly, (req, res) => {
  res.json({
    stato: statoAbbonamento(req.azienda), azienda: aziendaPub(req.azienda), stripe: !!stripe,
    piani: db.prepare("SELECT id,nome,descrizione,max_tecnici,mesi,prezzo_cent FROM piani WHERE attivo=1 ORDER BY ordine, prezzo_cent").all(),
    pagamenti: db.prepare("SELECT id,descrizione,importo_cent,metodo,periodo_da,periodo_a,creato FROM pagamenti WHERE azienda_id=? ORDER BY creato DESC").all(req.azienda.id),
    tecnici_attivi: tecniciAttivi(req.azienda.id),
  });
});
app.post("/api/pagamenti/checkout", auth, azOnly, solo("admin"), wrap(async (req, res) => {
  if (!stripe) fail(400, "Il pagamento online non è attivo. Contatta l'assistenza per rinnovare.");
  const piano = db.prepare("SELECT * FROM piani WHERE id=? AND attivo=1").get(str(req.body?.piano_id, 40));
  if (!piano) fail(400, "Piano non valido.");
  if (piano.max_tecnici < tecniciAttivi(req.azienda.id)) fail(409, `Hai ${tecniciAttivi(req.azienda.id)} tecnici attivi: scegli un piano che ne preveda almeno altrettanti, oppure disattivane alcuni.`);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "it",
    customer_email: req.azienda.email || req.user.email,
    client_reference_id: req.azienda.id,
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: piano.prezzo_cent, product_data: { name: `${APP_NAME} ${piano.nome}`, description: `${piano.descrizione || ""} - ${piano.mesi} mesi`.trim() } } }],
    metadata: { azienda_id: req.azienda.id, piano_id: piano.id },
    payment_intent_data: { metadata: { azienda_id: req.azienda.id, piano_id: piano.id }, description: `${APP_NAME} ${piano.nome} - ${req.azienda.ragione}` },
    success_url: `${BASE_URL}/app?pagamento={CHECKOUT_SESSION_ID}#impostazioni`,
    cancel_url: `${BASE_URL}/app?pagamento=annullato#impostazioni`,
  });
  res.json({ url: session.url });
}));
app.get("/api/pagamenti/verifica", auth, azOnly, wrap(async (req, res) => {
  if (!stripe) fail(400, "Stripe non configurato.");
  const s = await stripe.checkout.sessions.retrieve(str(req.query.session_id, 200));
  if (s.metadata?.azienda_id !== req.azienda.id) fail(403, "Pagamento non associato alla tua azienda.");
  if (s.payment_status === "paid") await registraSessioneStripe(s);
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(req.azienda.id);
  res.json({ pagato: s.payment_status === "paid", stato: statoAbbonamento(az) });
}));

/* ============================== API superuser ============================== */
const su = express.Router();
su.use(auth, solo("superuser"));
su.get("/dashboard", (req, res) => {
  const az = db.prepare("SELECT * FROM aziende").all();
  const st = az.map((a) => ({ a, s: statoAbbonamento(a) }));
  const anno = oggi().slice(0, 4);
  res.json({
    attive: st.filter((x) => x.a.stato === "attiva" && !x.s.scaduto).length,
    inScadenza: st.filter((x) => x.a.stato === "attiva" && x.s.inScadenza).length,
    scadute: st.filter((x) => x.a.stato === "attiva" && x.s.scaduto).length,
    inAttesa: st.filter((x) => x.a.stato === "in_attesa").length,
    sospese: st.filter((x) => x.a.stato === "sospesa").length,
    incassoAnno: db.prepare("SELECT COALESCE(SUM(importo_cent),0) s FROM pagamenti WHERE substr(creato,1,4)=?").get(anno).s,
    tecnici: db.prepare("SELECT COUNT(*) n FROM utenti WHERE ruolo IN ('admin','tecnico') AND attivo=1").get().n,
    verifiche: db.prepare("SELECT COUNT(*) n FROM dati WHERE coll='verifiche' AND eliminato=0").get().n,
    avvisi: db.prepare("SELECT v.*, a.ragione FROM avvisi v LEFT JOIN aziende a ON a.id=v.azienda_id ORDER BY v.id DESC LIMIT 15").all(),
    stripe: !!stripe, email: !!mailer,
  });
});
su.get("/aziende", (req, res) => {
  const rows = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM utenti u WHERE u.azienda_id=a.id AND u.attivo=1 AND u.ruolo IN ('admin','tecnico')) tecnici_attivi,
      (SELECT COUNT(*) FROM dati d WHERE d.azienda_id=a.id AND d.coll='verifiche' AND d.eliminato=0) n_verifiche,
      (SELECT email FROM utenti u WHERE u.azienda_id=a.id AND u.ruolo='admin' ORDER BY creato LIMIT 1) admin_email,
      (SELECT nome FROM utenti u WHERE u.azienda_id=a.id AND u.ruolo='admin' ORDER BY creato LIMIT 1) admin_nome
    FROM aziende a ORDER BY a.creato DESC`).all();
  res.json(rows.map((a) => ({ ...aziendaPub(a), note: a.note, richiesta: a.richiesta, creato: a.creato, tecnici_attivi: a.tecnici_attivi, n_verifiche: a.n_verifiche, admin_email: a.admin_email, admin_nome: a.admin_nome, abbonamento: statoAbbonamento(a) })));
});
su.get("/aziende/:id", (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  res.json({
    azienda: { ...aziendaPub(a), note: a.note, richiesta: a.richiesta, creato: a.creato }, abbonamento: statoAbbonamento(a),
    utenti: db.prepare("SELECT * FROM utenti WHERE azienda_id=? ORDER BY ruolo, nome").all(a.id).map(utentePub),
    pagamenti: db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? ORDER BY creato DESC").all(a.id),
    avvisi: db.prepare("SELECT * FROM avvisi WHERE azienda_id=? ORDER BY id DESC LIMIT 50").all(a.id),
    n_verifiche: db.prepare("SELECT COUNT(*) n FROM dati WHERE azienda_id=? AND coll='verifiche' AND eliminato=0").get(a.id).n,
    n_apparecchi: db.prepare("SELECT COUNT(*) n FROM dati WHERE azienda_id=? AND coll='apparecchi' AND eliminato=0").get(a.id).n,
  });
});
su.post("/aziende", wrap(async (req, res) => {
  const b = req.body || {};
  const ragione = str(b.ragione, 200), email = str(b.admin_email, 200).toLowerCase(), nome = str(b.admin_nome, 120);
  if (!ragione || !nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Servono ragione sociale, nome ed email dell'amministratore.");
  if (db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email)) fail(409, "Questa email è già usata da un altro utente.");
  const fine = isDate(b.abbonamento_fine) ? b.abbonamento_fine : addDays(oggi(), PROVA_GIORNI);
  const azId = uid(), pwd = tempPassword();
  db.transaction(() => {
    db.prepare("INSERT INTO aziende (id,ragione,piva,indirizzo,cap,telefono,email,stato,abbonamento_fine,max_tecnici,piano_id,note,creato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(azId, ragione, str(b.piva, 20), str(b.indirizzo), str(b.cap), str(b.telefono, 40), str(b.email, 200) || email, "attiva", fine, Math.max(1, Number(b.max_tecnici) || 1), str(b.piano_id, 40) || null, str(b.note, 2000), nowISO());
    db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,cf,sigillo,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,?,?,1,1,?)")
      .run(uid(), azId, "admin", nome, email, bcrypt.hashSync(pwd, 10), str(b.admin_cf, 20).toUpperCase(), str(b.admin_sigillo, 40), nowISO());
  })();
  const inviata = await mailCredenziali(email, nome, ragione, pwd, fine);
  res.json({ id: azId, password: pwd, email: email, email_inviata: inviata });
}));
function mailCredenziali(email, nome, ragione, pwd, fine) {
  return sendMail(email, `${APP_NAME}: account attivato`, `Gentile ${nome},\nl'account ${APP_NAME} di ${ragione} è attivo${fine ? ` fino al ${fmtD(fine)}` : ""}.\n\nIndirizzo: ${BASE_URL}/app\nEmail: ${email}\nPassword provvisoria: ${pwd}\n\nAl primo accesso ti verrà chiesto di scegliere una nuova password. Da Impostazioni puoi aggiungere i tuoi tecnici e rinnovare l'abbonamento.\n\n${APP_NAME}`);
}
su.post("/aziende/:id/abilita", wrap(async (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  const b = req.body || {};
  const fine = isDate(b.abbonamento_fine) ? b.abbonamento_fine : (a.abbonamento_fine && a.abbonamento_fine >= oggi() ? a.abbonamento_fine : addDays(oggi(), PROVA_GIORNI));
  const maxT = Math.max(1, Number(b.max_tecnici) || a.max_tecnici || 1);
  db.prepare("UPDATE aziende SET stato='attiva', abbonamento_fine=?, max_tecnici=? WHERE id=?").run(fine, maxT, a.id);
  const admin = db.prepare("SELECT * FROM utenti WHERE azienda_id=? AND ruolo='admin' ORDER BY creato LIMIT 1").get(a.id);
  let out = { ok: true, abbonamento_fine: fine };
  if (admin && (!admin.attivo || b.nuova_password)) {
    const pwd = tempPassword();
    db.prepare("UPDATE utenti SET attivo=1, hash=?, cambia_pwd=1 WHERE id=?").run(await bcrypt.hash(pwd, 10), admin.id);
    out = { ...out, password: pwd, email: admin.email, email_inviata: await mailCredenziali(admin.email, admin.nome, a.ragione, pwd, fine) };
  }
  res.json(out);
}));
su.put("/aziende/:id", (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  const b = req.body || {};
  const stato = ["attiva", "sospesa", "in_attesa"].includes(b.stato) ? b.stato : a.stato;
  const fine = b.abbonamento_fine === "" ? null : isDate(b.abbonamento_fine) ? b.abbonamento_fine : a.abbonamento_fine;
  db.prepare("UPDATE aziende SET ragione=?, piva=?, indirizzo=?, cap=?, telefono=?, email=?, stato=?, abbonamento_fine=?, max_tecnici=?, piano_id=?, note=? WHERE id=?")
    .run(str(b.ragione ?? a.ragione, 200) || a.ragione, str(b.piva ?? a.piva, 20), str(b.indirizzo ?? a.indirizzo), str(b.cap ?? a.cap), str(b.telefono ?? a.telefono, 40), str(b.email ?? a.email, 200),
      stato, fine, Math.max(1, Number(b.max_tecnici ?? a.max_tecnici) || 1), b.piano_id === undefined ? a.piano_id : (str(b.piano_id, 40) || null), str(b.note ?? a.note, 2000), a.id);
  if (stato !== "attiva") db.prepare("DELETE FROM sessioni WHERE utente_id IN (SELECT id FROM utenti WHERE azienda_id=?)").run(a.id);
  res.json({ ok: true });
});
su.delete("/aziende/:id", (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  if (str(req.body?.conferma, 200) !== a.ragione) fail(400, "Per eliminare scrivi esattamente la ragione sociale.");
  db.prepare("DELETE FROM aziende WHERE id=?").run(a.id);
  res.json({ ok: true });
});
su.post("/aziende/:id/pagamento", wrap(async (req, res) => {
  const b = req.body || {};
  const metodo = ["bonifico", "contanti", "omaggio", "altro", "stripe"].includes(b.metodo) ? b.metodo : "altro";
  const importo = Math.round(Number(String(b.importo ?? "0").replace(",", ".")) * 100) || 0;
  const r = applicaPagamento({ aziendaId: str(req.params.id, 64), pianoId: str(b.piano_id, 40) || null, mesi: Number(b.mesi) || null, importoCent: importo, metodo, descrizione: str(b.descrizione, 200), maxTecnici: Number(b.max_tecnici) || null });
  res.json({ ok: true, periodo_da: r.da, periodo_a: r.a });
}));
su.delete("/pagamenti/:id", (req, res) => { db.prepare("DELETE FROM pagamenti WHERE id=?").run(str(req.params.id, 64)); res.json({ ok: true }); });
su.post("/utenti/:id/reset", wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM utenti WHERE id=?").get(str(req.params.id, 64)); if (!u) fail(404, "Utente non trovato.");
  res.json(await resetPassword(u));
}));
su.put("/utenti/:id", (req, res) => {
  const u = db.prepare("SELECT * FROM utenti WHERE id=?").get(str(req.params.id, 64)); if (!u) fail(404, "Utente non trovato.");
  if (u.id === req.user.id) fail(400, "Non puoi modificare il tuo stato da qui.");
  const attivo = req.body?.attivo ? 1 : 0;
  db.prepare("UPDATE utenti SET attivo=? WHERE id=?").run(attivo, u.id);
  if (!attivo) db.prepare("DELETE FROM sessioni WHERE utente_id=?").run(u.id);
  res.json({ ok: true });
});
su.get("/piani", (req, res) => res.json(db.prepare("SELECT * FROM piani ORDER BY ordine, prezzo_cent").all()));
const pianoBody = (b) => ({
  nome: str(b.nome, 60), descrizione: str(b.descrizione, 200), max_tecnici: Math.max(1, Number(b.max_tecnici) || 1),
  mesi: Math.max(1, Number(b.mesi) || 12), prezzo_cent: Math.max(0, Math.round(Number(String(b.prezzo ?? "0").replace(",", ".")) * 100) || 0),
  attivo: b.attivo === false ? 0 : 1, ordine: Number(b.ordine) || 0,
});
su.post("/piani", (req, res) => {
  const p = pianoBody(req.body || {}); if (!p.nome) fail(400, "Il piano deve avere un nome.");
  const id = str(req.body.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || uid();
  if (db.prepare("SELECT 1 FROM piani WHERE id=?").get(id)) fail(409, "Esiste già un piano con questo codice.");
  db.prepare("INSERT INTO piani (id,nome,descrizione,max_tecnici,mesi,prezzo_cent,attivo,ordine) VALUES (?,?,?,?,?,?,?,?)").run(id, p.nome, p.descrizione, p.max_tecnici, p.mesi, p.prezzo_cent, p.attivo, p.ordine);
  res.json({ ok: true, id });
});
su.put("/piani/:id", (req, res) => {
  const p = pianoBody(req.body || {}); if (!p.nome) fail(400, "Il piano deve avere un nome.");
  db.prepare("UPDATE piani SET nome=?, descrizione=?, max_tecnici=?, mesi=?, prezzo_cent=?, attivo=?, ordine=? WHERE id=?").run(p.nome, p.descrizione, p.max_tecnici, p.mesi, p.prezzo_cent, p.attivo, p.ordine, str(req.params.id, 40));
  res.json({ ok: true });
});
su.get("/pagamenti", (req, res) => res.json(db.prepare("SELECT p.*, a.ragione, a.piva FROM pagamenti p JOIN aziende a ON a.id=p.azienda_id ORDER BY p.creato DESC LIMIT 1000").all()));
su.get("/avvisi", (req, res) => res.json(db.prepare("SELECT v.*, a.ragione FROM avvisi v LEFT JOIN aziende a ON a.id=v.azienda_id ORDER BY v.id DESC LIMIT 300").all()));
su.post("/avvisi/controlla", wrap(async (req, res) => res.json({ creati: await controllaScadenze() })));
app.use("/api/su", su);

app.use("/api", (req, res) => res.status(404).json({ error: "Funzione non trovata." }));
// gestione errori
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "File troppo grande." });
  console.error(err);
  res.status(500).json({ error: "Errore interno. Riprova tra qualche istante." });
});

/* ============================== pagine ============================== */
app.use("/vendor/jspdf", express.static(path.join(__dirname, "node_modules/jspdf/dist"), { maxAge: "30d" }));
app.use("/vendor/jsqr", express.static(path.join(__dirname, "node_modules/jsqr/dist"), { maxAge: "30d" }));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "app.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { maxAge: PROD ? "1h" : 0, extensions: ["html"] }));

/* ============================== avvio ============================== */
(function bootstrapSuperuser() {
  const e = process.env.SUPERUSER_EMAIL, p = process.env.SUPERUSER_PASSWORD;
  if (!e || !p) return;
  if (db.prepare("SELECT 1 FROM utenti WHERE ruolo='superuser'").get()) return;
  db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,1,0,?)")
    .run(uid(), null, "superuser", process.env.SUPERUSER_NOME || "Amministratore", e.toLowerCase(), bcrypt.hashSync(p, 10), nowISO());
  console.log(`Superuser creato: ${e}`);
})();

if (require.main === module) {
  const HOST = process.env.HOST || "127.0.0.1";
  app.listen(PORT, HOST, () => console.log(`${APP_NAME} in ascolto su http://${HOST}:${PORT} (${BASE_URL})`));
  setTimeout(() => controllaScadenze().catch(console.error), 5000);
  setInterval(() => controllaScadenze().catch(console.error), 6 * 3600000);
}
module.exports = { app, controllaScadenze, applicaPagamento };
