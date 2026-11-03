"use strict";
/*
 * BluCheck - server
 * Gestione verificazioni periodiche dei registratori telematici, multi-azienda,
 * con abbonamenti, pagamenti (carta con Stripe, PayPal, bonifico) con fattura, avvisi di scadenza e collegamento alla BluCode Console.
 * Abbonamenti, pagamenti e Console seguono lo standard comune BluCode, con BluGest come modello.
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
const AB = require("./abbonamento");
const PAG = require("./pagamenti");
const CONTRATTO = require("./contratto");

const PORT = Number(process.env.PORT || 3030);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PROD = process.env.NODE_ENV === "production";
// Prova gratuita dal sito (contratto comune BluCode: comune/prova-gratuita.md)
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
// Prova proposta quando il superuser abilita o crea un'azienda: come la prova dal sito
const PROVA_GIORNI = Number(process.env.PROVA_GIORNI || TRIAL_DAYS);
const WEBSITE_URL = (process.env.WEBSITE_URL || "https://blucodeinformatica.it").replace(/\/$/, "");
const TERMS_VERSION = process.env.TERMS_VERSION || "1.0";
const TERMS_URL = process.env.TERMS_URL || `${WEBSITE_URL}/termini/`;
const TERMS_PDF_URL = process.env.TERMS_PDF_URL || `${WEBSITE_URL}/termini/termini-di-utilizzo-v${TERMS_VERSION}.pdf`;
const MANUAL_URL = process.env.MANUAL_URL || "https://blucodeinformatica.it/blucheck/manuale/";
const VIDEOS_URL = process.env.VIDEOS_URL || "https://blucodeinformatica.it/blucheck/video/";
const PRIVACY_PDF_URL = process.env.PRIVACY_PDF_URL || `${WEBSITE_URL}/privacy/informativa-privacy-v1.0.pdf`;
const APP_NAME = "BluCheck";

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

async function sendMail(to, subject, text, attachments, html) {
  const list = [...new Set([].concat(to).filter(Boolean).map((e) => e.trim()))];
  if (!list.length) return false;
  if (!mailer) { console.log(`[email non configurata] a ${list.join(", ")}: ${subject}\n${text}\n`); return false; }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: list.join(", "), subject, text, html: html || undefined, attachments: attachments || undefined });
    return true;
  } catch (e) { console.error("Invio email non riuscito:", e.message); return false; }
}
const superEmails = () => (process.env.ALERT_EMAIL ? process.env.ALERT_EMAIL.split(",") : db.prepare("SELECT email FROM utenti WHERE ruolo='superuser' AND attivo=1").all().map((r) => r.email));
const adminEmails = (aziendaId) => db.prepare("SELECT email FROM utenti WHERE azienda_id=? AND ruolo='admin' AND attivo=1").all(aziendaId).map((r) => r.email);

const notifyEmails = () => (process.env.ADMIN_NOTIFY_EMAIL ? process.env.ADMIN_NOTIFY_EMAIL.split(",").map((s) => s.trim()).filter(Boolean) : superEmails());
const contattiTesto = () => [process.env.SUPPORT_EMAIL || process.env.CONTATTO_EMAIL, (process.env.SUPPORT_PHONE || process.env.CONTATTO_TELEFONO) ? `tel. ${process.env.SUPPORT_PHONE || process.env.CONTATTO_TELEFONO}` : ""].filter(Boolean).join(" · ");
const registra = (chi, azione, dettagli, ip) => db.prepare("INSERT INTO registro (chi,azione,dettagli,ip,creato) VALUES (?,?,?,?,?)").run(chi, azione, dettagli || "", ip || "", nowISO());

/* ============================== abbonamenti (standard comune, come BluGest) ============================== */
/** Impostazioni del ciclo: tolleranza, sola lettura e giorni di avviso (modificabili dal pannello). */
function impSaas() {
  const out = { ...AB.PREDEFINITI };
  for (const r of db.prepare("SELECT chiave, valore FROM impostazioni_saas").all()) { try { out[r.chiave] = JSON.parse(r.valore); } catch { } }
  return out;
}
const setImp = (k, v) => db.prepare("INSERT INTO impostazioni_saas (chiave,valore) VALUES (?,?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore").run(k, JSON.stringify(v));
function statoAbbonamento(az) { return az ? AB.fase(az, impSaas()) : null; }
const aziendaPub = (az) => az && ({
  id: az.id, ragione: az.ragione, piva: az.piva, indirizzo: az.indirizzo, cap: az.cap, telefono: az.telefono, email: az.email,
  stato: az.stato, abbonamento_fine: az.abbonamento_fine, max_tecnici: az.max_tecnici, piano_id: az.piano_id, prova: !!az.prova,
  impostazioni: JSON.parse(az.impostazioni || "{}"),
});
const utentePub = (u) => u && ({
  id: u.id, azienda_id: u.azienda_id, ruolo: u.ruolo, nome: u.nome, email: u.email, cf: u.cf, sigillo: u.sigillo,
  attivo: !!u.attivo, cambia_pwd: !!u.cambia_pwd, ultimo_accesso: u.ultimo_accesso, creato: u.creato, haFirma: !!u.firma,
});
const tecniciAttivi = (aziendaId) => db.prepare("SELECT COUNT(*) n FROM utenti WHERE azienda_id=? AND attivo=1 AND ruolo IN ('admin','tecnico')").get(aziendaId).n;
const pianoDi = (id) => (id ? db.prepare("SELECT * FROM piani WHERE id=?").get(id) : null);

/** Periodo inserito a mano dal superuser (proroga, omaggio, accordo): nessuna fattura. */
const periodoManuale = db.transaction(({ aziendaId, pianoId, mesi, fine, importoCent, metodo, descrizione, maxTecnici, restaProva, chi }) => {
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(aziendaId);
  if (!az) fail(404, "Azienda non trovata");
  const piano = pianoDi(pianoId);
  const m = Number(mesi || (!fine ? piano?.mesi : 0) || 0);
  const vivo = az.abbonamento_fine && az.abbonamento_fine >= oggi() && !(az.prova && !restaProva);
  const da = vivo ? addDays(az.abbonamento_fine, 1) : oggi();
  const a = isDate(fine) ? fine : (m > 0 ? addDays(addMonths(da, m), -1) : az.abbonamento_fine);
  if (!a) fail(400, "Indica i mesi o la data di fine del periodo.");
  const maxT = Number(maxTecnici || piano?.max_tecnici || az.max_tecnici);
  const convertita = az.prova && !restaProva;
  db.prepare("UPDATE aziende SET abbonamento_fine=?, max_tecnici=?, piano_id=COALESCE(?, piano_id), prova=?, prova_convertita_il=CASE WHEN ? THEN ? ELSE prova_convertita_il END, stato=CASE WHEN stato IN ('in_attesa','sospesa') THEN 'attiva' ELSE stato END WHERE id=?")
    .run(a, maxT, piano?.id || null, restaProva ? az.prova : 0, convertita ? 1 : 0, nowISO(), aziendaId);
  const id = uid();
  db.prepare("INSERT INTO pagamenti (id,azienda_id,piano_id,piano_nome,descrizione,importo_cent,totale_cent,metodo,stato,periodicita,mesi,periodo_da,periodo_a,pagato_il,creato) VALUES (?,?,?,?,?,?,?,?,'pagato','',?,?,?,?,?)")
    .run(id, aziendaId, piano?.id || null, piano?.nome || "", descrizione || (restaProva ? "Proroga della prova" : `Periodo manuale${piano ? " " + piano.nome : ""}`), importoCent || 0, importoCent || 0, metodo, m, da, a, nowISO(), nowISO());
  registra(chi || "superuser", "periodo_manuale", `${az.ragione}: ${fmtD(da)} - ${fmtD(a)}, ${euro(importoCent || 0)} (${metodo})${convertita ? ", prova convertita" : ""}`);
  return { id, da, a };
});

/* ============================== avvisi di scadenza (8:07) e riepilogo settimanale ============================== */
async function inviaModello(codice, az, f) {
  const m = db.prepare("SELECT * FROM modelli_email WHERE codice=?").get(codice) || AB.MODELLI.find((x) => x.codice === codice);
  if (!m) return false;
  const v = {
    azienda: az.ragione, prodotto: APP_NAME, piano: pianoDi(az.piano_id)?.nome || "", scadenza: fmtD(f.fine), giorni: f.giorni ?? "",
    link_accesso: `${BASE_URL}/app`, link_rinnovo: `${BASE_URL}/app#abbonamento`, contatti: contattiTesto(),
    giorni_tolleranza: f.giorni_tolleranza, giorni_sola_lettura: f.giorni_sola_lettura,
  };
  const oggetto = AB.compila(m.oggetto, v), html = AB.compila(m.corpo, v, true);
  const ok = await sendMail([az.email, ...adminEmails(az.id)], oggetto, AB.testoDaHtml(html), undefined, html);
  await sendMail(notifyEmails(), `[${APP_NAME}] ${az.ragione}: ${oggetto}`, `Copia dell'avviso inviato a ${az.ragione} (${az.email}).\n\n${AB.testoDaHtml(html)}`);
  return ok;
}
async function controllaScadenze(on = oggi()) {
  const imp = impSaas();
  const inviati = [];
  for (const az of db.prepare("SELECT * FROM aziende WHERE stato<>'in_attesa' AND abbonamento_fine IS NOT NULL").all()) {
    const f = AB.fase(az, imp, on);
    const a = AB.avvisoDelGiorno(f, imp, on);
    if (!a) continue;
    const chiave = `${az.id}:${az.abbonamento_fine}:${a.regola}`;
    if (db.prepare("SELECT 1 FROM avvisi WHERE chiave=?").get(chiave)) continue;
    const testo = a.modello.startsWith("prova")
      ? `Prova di ${az.ragione}: ${f.giorni >= 0 ? (f.giorni === 0 ? "ultimo giorno" : `finisce tra ${f.giorni} giorni`) : `terminata il ${fmtD(f.fine)}, accesso sospeso`}.`
      : a.modello === "fine_tolleranza" ? `${az.ragione}: fine della tolleranza, da domani sola lettura (scaduto il ${fmtD(f.fine)}).`
        : a.modello === "sospensione" ? `${az.ragione}: accesso sospeso (scaduto il ${fmtD(f.fine)}).`
          : `L'abbonamento di ${az.ragione} ${f.giorni === 0 ? "scade oggi" : `scade il ${fmtD(f.fine)} (tra ${f.giorni} giorni)`}.`;
    const tipo = a.modello.startsWith("prova") ? (a.modello === "prova_scaduta" ? "prova_scaduta" : "prova_in_scadenza") : (f.giorni >= 0 ? "in_scadenza" : a.modello);
    db.prepare("INSERT INTO avvisi (azienda_id,tipo,chiave,testo,creato) VALUES (?,?,?,?,?)").run(az.id, tipo, chiave, testo, nowISO());
    if (await inviaModello(a.modello, az, f)) db.prepare("UPDATE avvisi SET email_inviata=1 WHERE chiave=?").run(chiave);
    inviati.push(`${az.ragione}:${a.regola}`);
  }
  db.prepare("DELETE FROM sessioni WHERE scade < ?").run(Date.now());
  return inviati;
}
async function riepilogoSettimanale(on = oggi()) {
  const imp = impSaas(), settimana = addDays(on, -7), rows = { in_scadenza: [], scadute: [], prove_nuove: [], prove_in_scadenza: [], prove_scadute: [] };
  let mrr = 0;
  for (const az of db.prepare("SELECT * FROM aziende WHERE stato<>'in_attesa'").all()) {
    const f = AB.fase(az, imp, on), piano = pianoDi(az.piano_id)?.nome || "";
    if (f.stato === "prova" && f.giorni <= 7) rows.prove_in_scadenza.push(`${az.ragione} — fine prova ${fmtD(f.fine)} (${f.giorni} gg)`);
    if (f.stato === "in_scadenza") rows.in_scadenza.push(`${az.ragione} — ${piano}, ${fmtD(f.fine)} (${f.giorni} gg)`);
    if (f.stato === "prova_scaduta" && f.fine >= addDays(on, -30)) rows.prove_scadute.push(`${az.ragione} — prova finita il ${fmtD(f.fine)}`);
    if (["tolleranza", "sola_lettura"].includes(f.stato) || (f.stato === "sospeso" && !f.manuale)) rows.scadute.push(`${az.ragione} — ${f.etichetta}, scaduto il ${fmtD(f.fine)}`);
    if (az.prova && (az.terms_at || az.creato).slice(0, 10) >= settimana) rows.prove_nuove.push(`${az.ragione} — fino al ${fmtD(f.fine)} · ${az.email}`);
    if (f.accesso === "completo" && !az.prova) { const p = periodoCorrente(az.id, on); if (p) mrr += AB.mensile(p.importo_cent, p.periodicita, p.periodo_da, p.periodo_a); }
  }
  const sez = (t, l) => `${t} (${l.length})\n${l.length ? l.map((x) => " - " + x).join("\n") : " nessuna"}\n`;
  const testo = `Riepilogo settimanale ${APP_NAME} del ${fmtD(on)}\n\n${sez("In scadenza nei 30 giorni", rows.in_scadenza)}\n${sez("Scadute (tolleranza, sola lettura, sospese)", rows.scadute)}\n`
    + `${sez("Nuove prove della settimana", rows.prove_nuove)}\n${sez("Prove in scadenza", rows.prove_in_scadenza)}\n${sez("Prove scadute non convertite (30 gg)", rows.prove_scadute)}\n`
    + `Ricavo mensile stimato: ${euro(Math.round(mrr))}\n\n${BASE_URL}/admin`;
  return sendMail(notifyEmails(), `[${APP_NAME}] Riepilogo settimanale`, testo);
}
/** Controllo giornaliero alle 8:07 (standard comune); il lunedì anche il riepilogo. Recupera il giro se il server è ripartito dopo le 8:07. */
async function giroGiornaliero() {
  const on = oggi();
  if ((impSaas().ultimo_controllo || "") === on) return;
  setImp("ultimo_controllo", on);
  try { await controllaScadenze(on); } catch (e) { console.error("Avvisi:", e); }
  if (new Date().getDay() === 1) { try { await riepilogoSettimanale(on); } catch (e) { console.error("Riepilogo:", e); } }
}
function pianificaGiro() {
  const n = new Date(), t = new Date(n); t.setHours(8, 7, 0, 0);
  if (t <= n) t.setDate(t.getDate() + 1);
  setTimeout(async () => { await giroGiornaliero(); pianificaGiro(); }, t - n).unref?.();
}

/* ============================== pagamenti (contratto comune, come BluGest app/pagamenti) ============================== */
const periodoCorrente = (aziendaId, on = oggi()) => db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? AND stato='pagato' AND periodo_da<=? AND periodo_a>=? ORDER BY periodo_a DESC LIMIT 1").get(aziendaId, on, on);
const datiFatt = (az) => { try { return az.dati_fatturazione ? JSON.parse(az.dati_fatturazione) : null; } catch { return null; } };
/** Proposta dei dati di fatturazione dai dati dell'azienda, finché il cliente non li salva. */
function datiFattProposti(az) {
  const d = datiFatt(az); if (d) return d;
  const m = String(az.cap || "").match(/(\d{5})\s+(.*?)\s*(?:\(([A-Z]{2})\))?$/);
  return { tipo: "azienda", denominazione: az.ragione, partita_iva: az.piva || "", indirizzo: az.indirizzo || "", cap: m?.[1] || "", comune: m?.[2] || "", provincia: m?.[3] || "", nazione: "IT", email: az.email || "" };
}
const pagPub = (p) => p && ({
  id: p.id, stato: p.stato, metodo: p.metodo, metodo_nome: PAG.METODI[p.metodo] || p.metodo, descrizione: p.descrizione, piano_nome: p.piano_nome, periodicita: p.periodicita,
  importo_cent: p.importo_cent, rimborso_bollo_cent: p.rimborso_bollo_cent, totale_cent: p.totale_cent ?? p.importo_cent, causale: p.causale,
  periodo_da: p.periodo_da, periodo_a: p.periodo_a, creato: p.creato, pagato_il: p.pagato_il, fattura: PAG.etichettaFattura(p), fattura_data: p.fattura_data,
});
const prezziPiano = (pl) => ({
  id: pl.id, nome: pl.nome, descrizione: pl.descrizione, max_tecnici: pl.max_tecnici, mesi: pl.mesi, prezzo_cent: pl.prezzo_cent,
  annuale: { mesi: pl.mesi, ...PAG.importi(pl.prezzo_cent) },
  mensile: pl.prezzo_mese_cent ? { mesi: 1, ...PAG.importi(pl.prezzo_mese_cent) } : null,
});
function opzioniPagamento(az) {
  const dati = datiFattProposti(az);
  const pend = db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? AND stato='in_attesa' AND metodo='bonifico' ORDER BY creato DESC LIMIT 1").get(az.id);
  return {
    metodi: PAG.metodiAttivi().map((m) => ({ id: m, nome: PAG.METODI[m] })),
    piani: db.prepare("SELECT * FROM piani WHERE attivo=1 ORDER BY ordine, prezzo_cent").all().map(prezziPiano),
    dati_fatturazione: dati, dati_salvati: !!datiFatt(az), problemi: PAG.problemi(dati),
    bonifico_in_attesa: pend ? { id: pend.id, intestatario: process.env.BONIFICO_INTESTATARIO || "BluCode Informatica", iban: process.env.BONIFICO_IBAN || "", importo_cent: pend.totale_cent, causale: pend.causale, piano: pend.piano_nome, periodicita: pend.periodicita, creato: pend.creato } : null,
    contatti: contattiTesto(),
  };
}
function bonificoInfo(p) { return { id: p.id, intestatario: process.env.BONIFICO_INTESTATARIO || "BluCode Informatica", iban: process.env.BONIFICO_IBAN || "", importo_cent: p.totale_cent, causale: p.causale }; }

const confermaTx = db.transaction((pid) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid);
  if (!p) fail(404, "Pagamento non trovato.");
  if (p.stato === "pagato") return { gia: true, p };
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(p.azienda_id);
  if (!az) fail(404, "Azienda non trovata.");
  const today = oggi();
  // nuovo periodo dalla fine di quello in corso; da oggi se scaduto, sospeso o in prova
  const da = az.abbonamento_fine && az.abbonamento_fine >= today && !az.prova ? addDays(az.abbonamento_fine, 1) : today;
  const a = addDays(addMonths(da, p.mesi || 12), -1);
  const sez = PAG.sezionale(), anno = Number(today.slice(0, 4));
  const numero = db.prepare("INSERT INTO contatori_fatture (sezionale,anno,ultimo) VALUES (?,?,1) ON CONFLICT(sezionale,anno) DO UPDATE SET ultimo=ultimo+1 RETURNING ultimo").get(sez, anno).ultimo;
  db.prepare("UPDATE pagamenti SET stato='pagato', pagato_il=?, periodo_da=?, periodo_a=?, fattura_sezionale=?, fattura_numero=?, fattura_anno=?, fattura_data=? WHERE id=?")
    .run(nowISO(), da, a, sez, numero, anno, today, pid);
  const piano = pianoDi(p.piano_id);
  db.prepare("UPDATE aziende SET abbonamento_fine=?, piano_id=COALESCE(?, piano_id), max_tecnici=?, prova=0, prova_convertita_il=CASE WHEN prova=1 THEN ? ELSE prova_convertita_il END, stato='attiva' WHERE id=?")
    .run(a, piano?.id || null, piano?.max_tecnici || az.max_tecnici, nowISO(), az.id);
  const q = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid);
  db.prepare("INSERT INTO avvisi (azienda_id,tipo,chiave,testo,creato) VALUES (?,?,?,?,?)").run(az.id, "pagamento", `pag:${pid}`,
    `Pagamento ${PAG.METODI[p.metodo]} di ${az.ragione}: ${euro(q.totale_cent)}, fattura ${PAG.etichettaFattura(q)}, abbonamento fino al ${fmtD(a)}.`, nowISO());
  return { gia: false, p: q, az };
});
/** Conferma idempotente (webhook firmato, ritorno dal gestore o «Conferma bonifico»), poi XML, proforma ed email. */
async function confermaPagamento(pid, chi) {
  const r = confermaTx(pid);
  if (r.gia) return r.p;
  registra(chi || "sistema", "pagamento_confermato", `${r.az.ragione}: ${PAG.etichettaFattura(r.p)} ${euro(r.p.totale_cent)} (${r.p.metodo})`);
  await documentiPagamento(pid, { cliente: true, blucode: true });
  return db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid);
}
function preparaXml(pid) {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid);
  const errs = PAG.problemiCedente();
  const xml = errs.length ? "" : PAG.buildXml({ ...p, dati: JSON.parse(p.dati || "{}") });
  db.prepare("UPDATE pagamenti SET fattura_xml=?, fattura_errori=? WHERE id=?").run(xml, errs.join("; "), pid);
  return { xml, errs };
}
async function documentiPagamento(pid, { cliente, blucode }) {
  const { xml, errs } = preparaXml(pid);
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid);
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(p.azienda_id);
  const dati = JSON.parse(p.dati || "{}");
  const label = PAG.etichettaFattura(p);
  if (cliente) {
    let pdf = null; try { pdf = PAG.proformaPdf({ ...p, dati }); } catch (e) { console.error("Proforma:", e); }
    const testo = `Gentile ${PAG.nomeCliente(dati) || az.ragione},\nabbiamo ricevuto il pagamento di ${euro(p.totale_cent)} (${PAG.METODI[p.metodo]}) per ${p.descrizione}.\n`
      + `Il tuo abbonamento ${APP_NAME} è attivo fino al ${fmtD(az.abbonamento_fine)}.\n\nIn allegato la ricevuta (proforma n. ${label}). ${PAG.PROFORMA_NOTA}.\n\nGrazie!\n${APP_NAME} · BluCode Informatica\n${contattiTesto()}`;
    const ok = await sendMail([dati.email || az.email, ...adminEmails(az.id)].slice(0, 3), `Ricevuta di pagamento ${APP_NAME}`, testo,
      pdf ? [{ filename: `Proforma_${label.replace("/", "-")}.pdf`, content: pdf, contentType: "application/pdf" }] : undefined);
    if (ok) db.prepare("UPDATE pagamenti SET email_cliente=1 WHERE id=?").run(pid);
  }
  if (blucode) {
    const testo = `Pagamento confermato\nAzienda: ${az.ragione} (P.IVA ${dati.partita_iva || az.piva || "-"})\nMetodo: ${PAG.METODI[p.metodo]}${p.rif_gestore ? ` · rif. ${p.rif_gestore}` : ""}\nCausale: ${p.causale}\n`
      + `Piano: ${p.piano_nome} ${p.periodicita}, dal ${fmtD(p.periodo_da)} al ${fmtD(p.periodo_a)}\nImporto: ${euro(p.importo_cent)}${p.rimborso_bollo_cent ? ` + bollo ${euro(p.rimborso_bollo_cent)}` : ""} = ${euro(p.totale_cent)}\n`
      + `Fattura: ${label} del ${fmtD(p.fattura_data)}\n\n`
      + (xml ? `In allegato l'XML FatturaPA da caricare sul portale Fatture e Corrispettivi dell'Agenzia delle Entrate.` : `XML NON generato: ${errs.join("; ")}. Completa i dati CEDENTE_* nel .env, poi «Reinvia» dal pannello.`)
      + `\n\n${BASE_URL}/admin#pagamenti`;
    const ok = await sendMail(notifyEmails(), `[${APP_NAME}] Pagamento ${label} da ${az.ragione}`, testo,
      xml ? [{ filename: PAG.nomeFileXml(p), content: Buffer.from(xml, "utf8"), contentType: "application/xml" }] : undefined);
    if (ok) db.prepare("UPDATE pagamenti SET email_blucode=1 WHERE id=?").run(pid);
  }
}
/** `opts.sito` = {ok, annullato, ritornoPaypal}: pagina del sito a cui tornare (acquisto dal sito); `opts.senzaAvviso` = niente email di bonifico (la manda l'acquisto). */
async function checkout(az, user, body, ip, opts = {}) {
  limita(`checkout:${az.id}`, 10, 3600000); limita(`checkout-ip:${ip}`, 10, 3600000);
  const metodo = str(body.metodo, 20), periodicita = body.periodicita === "mensile" ? "mensile" : "annuale";
  if (!PAG.metodiAttivi().includes(metodo)) fail(400, "Metodo di pagamento non disponibile.");
  const piano = db.prepare("SELECT * FROM piani WHERE id=? AND attivo=1").get(str(body.piano, 40) || str(body.piano_id, 40));
  if (!piano) fail(400, "Piano non valido.");
  const prezzo = periodicita === "mensile" ? piano.prezzo_mese_cent : piano.prezzo_cent;
  if (!prezzo) fail(400, "Per questo piano la periodicità scelta non è disponibile.");
  if (piano.max_tecnici < tecniciAttivi(az.id)) fail(409, `Hai ${tecniciAttivi(az.id)} tecnici attivi: scegli un piano che ne preveda almeno altrettanti, oppure disattivane alcuni.`);
  const dati = datiFatt(az);
  const errs = PAG.problemi(dati);
  if (!dati || errs.length) fail(422, "Completa i dati di fatturazione prima di pagare: " + (errs[0] || "dati mancanti"), "dati_fatturazione");
  if (metodo === "bonifico") {
    const pend = db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? AND stato='in_attesa' AND metodo='bonifico'").get(az.id);
    if (pend) return { bonifico: bonificoInfo(pend), gia_in_attesa: true };
  }
  const pid = crypto.randomBytes(6).toString("hex").toUpperCase();
  const imp = PAG.importi(prezzo), mesi = periodicita === "mensile" ? 1 : piano.mesi;
  const descrizione = `${APP_NAME} ${piano.nome} ${periodicita}`;
  const causale = `BLUCODE ${PAG.sezionale()} ${pid.slice(0, 8)}`;
  db.prepare(`INSERT INTO pagamenti (id,azienda_id,piano_id,piano_nome,descrizione,importo_cent,bollo_cent,rimborso_bollo_cent,totale_cent,metodo,stato,periodicita,mesi,causale,dati,utente_id,creato)
    VALUES (?,?,?,?,?,?,?,?,?,?,'in_attesa',?,?,?,?,?,?)`).run(pid, az.id, piano.id, piano.nome, descrizione, imp.importo, imp.bollo, imp.rimborso_bollo, imp.totale, metodo, periodicita, mesi, causale, JSON.stringify(dati), user.id, nowISO());
  try {
    if (metodo === "carta") {
      const s = await PAG.stripeCheckout({ pid, azId: az.id, descrizione, totaleCent: imp.totale, email: dati.email || az.email,
        successUrl: opts.sito ? opts.sito.ok : `${BASE_URL}/app?pagamento=${pid}&esito=ok#abbonamento`,
        cancelUrl: opts.sito ? opts.sito.annullato : `${BASE_URL}/app?pagamento=${pid}&esito=annullato#abbonamento` });
      db.prepare("UPDATE pagamenti SET rif_gestore=? WHERE id=?").run(s.id, pid);
      return { redirect_url: s.url };
    }
    if (metodo === "paypal") {
      const o = await PAG.paypalOrdine({ pid, causale, descrizione, totaleCent: imp.totale,
        returnUrl: opts.sito ? `${BASE_URL}/api/pagamenti/paypal/ritorno?id=${pid}&r=${encodeURIComponent(opts.sito.ok)}` : `${BASE_URL}/api/app/pagamenti/paypal/ritorno?pid=${pid}`,
        cancelUrl: opts.sito ? opts.sito.annullato : `${BASE_URL}/app?pagamento=${pid}&esito=annullato#abbonamento` });
      db.prepare("UPDATE pagamenti SET rif_gestore=? WHERE id=?").run(o.id, pid);
      return { redirect_url: o.url };
    }
  } catch (e) {
    db.prepare("UPDATE pagamenti SET stato='fallito' WHERE id=?").run(pid);
    if (e instanceof PAG.ProviderError) fail(502, e.message);
    throw e;
  }
  if (!opts.senzaAvviso) await sendMail(notifyEmails(), `[${APP_NAME}] Bonifico in attesa: ${az.ragione}`, `${az.ragione} ha scelto il bonifico: ${euro(imp.totale)}, causale «${causale}».\nQuando vedi l'accredito, conferma dal pannello: ${BASE_URL}/admin#pagamenti`);
  registra(user.email, "bonifico_in_attesa", `${az.ragione}: ${euro(imp.totale)} ${causale}`, ip);
  return { bonifico: bonificoInfo(db.prepare("SELECT * FROM pagamenti WHERE id=?").get(pid)) };
}
/** Notifica di un gestore: una volta sola per evento (tabella eventi_pagamento). */
const eventoNuovo = (id, gestore, tipo) => db.prepare("INSERT OR IGNORE INTO eventi_pagamento (id,gestore,tipo,ricevuto) VALUES (?,?,?,?)").run(`${gestore}:${id}`, gestore, tipo || "", nowISO()).changes === 1;

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

/* ---------- notifiche dei gestori di pagamento (corpo grezzo, prima di express.json) ---------- */
async function webhookStripe(req, res) {
  let ev;
  try { ev = PAG.stripeVerifica(req.body, req.headers["stripe-signature"]); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    if (!eventoNuovo(ev.id, "stripe", ev.type)) return res.json({ ricevuto: true, doppione: true });
    const s = ev.data?.object || {};
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(ev.type) && s.payment_status === "paid") {
      const pid = s.metadata?.payment_id || s.client_reference_id;
      const p = pid && db.prepare("SELECT * FROM pagamenti WHERE id=? AND metodo='carta'").get(pid);
      if (p) { db.prepare("UPDATE pagamenti SET rif_gestore=? WHERE id=?").run(s.payment_intent || s.id, pid); await confermaPagamento(pid, "stripe"); }
    }
    res.json({ ricevuto: true });
  } catch (e) { console.error("Webhook Stripe:", e); res.status(500).json({ error: "Errore" }); }
}
app.post("/api/pagamenti/webhook/stripe", express.raw({ type: "*/*", limit: "1mb" }), webhookStripe);
app.post("/api/stripe/webhook", express.raw({ type: "*/*", limit: "1mb" }), webhookStripe); // indirizzo della prima versione
app.post("/api/pagamenti/webhook/paypal", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  let ev; try { ev = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ error: "Evento non leggibile" }); }
  if (!(await PAG.paypalVerifica(req.headers, ev))) return res.status(400).json({ error: "Firma non valida" });
  try {
    if (!eventoNuovo(ev.id, "paypal", ev.event_type)) return res.json({ ricevuto: true, doppione: true });
    if (ev.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const pid = ev.resource?.custom_id;
      const p = pid && db.prepare("SELECT * FROM pagamenti WHERE id=? AND metodo='paypal'").get(pid);
      if (p) { db.prepare("UPDATE pagamenti SET rif_gestore=? WHERE id=?").run(ev.resource.id || p.rif_gestore, pid); await confermaPagamento(pid, "paypal"); }
    }
    res.json({ ricevuto: true });
  } catch (e) { console.error("Webhook PayPal:", e); res.status(500).json({ error: "Errore" }); }
});

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
  if (req.path.startsWith("/console/")) return next(); // dalla BluCode Console: chiave nell'intestazione Authorization
  if (req.path === "/public/prova" || req.path === "/public/acquisto") return next(); // arriva dal sito: CORS ristretto a WEBSITE_URL, limiti e campo trappola
  if (req.headers["x-blucheck"] !== "1") return res.status(403).json({ error: "Richiesta non valida" });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Anche da sospesi o in sola lettura restano sempre permessi: profilo, cambio password, uscita, pagina «Abbonamento» e pagamenti.
const SEMPRE_PERMESSI = ["/api/me", "/api/me/password", "/api/logout", "/api/config", "/api/abbonamento"];
const sempre = (p) => SEMPRE_PERMESSI.includes(p) || p.startsWith("/api/app/pagamenti");
const MSG_BLOCCO = {
  prova_scaduta: "La prova gratuita è terminata e l'accesso è sospeso. I tuoi dati sono conservati: attiva l'abbonamento dalla pagina «Abbonamento».",
  abbonamento_sospeso: "L'accesso è sospeso. I tuoi dati sono conservati: rinnova l'abbonamento dalla pagina «Abbonamento».",
  sola_lettura: "Abbonamento scaduto: BluCheck è in sola lettura. Puoi consultare e stampare, ma per registrare nuove verifiche rinnova dalla pagina «Abbonamento».",
};
const auth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Accesso scaduto: entra di nuovo.", code: "login" });
  if (req.user.ruolo === "superuser") return next();
  if (!req.azienda || req.azienda.stato === "in_attesa") return res.status(403).json({ error: "L'account della tua azienda non è attivo. Contatta l'assistenza.", code: "non_attiva" });
  const f = statoAbbonamento(req.azienda); req.fase = f;
  const p = req.originalUrl.split("?")[0];
  if (sempre(p)) return next();
  if (f.accesso === "nessuno") { const code = AB.codiceBlocco(f.stato); return res.status(402).json({ error: MSG_BLOCCO[code], code }); }
  if (f.accesso === "lettura" && req.method !== "GET" && req.method !== "HEAD") return res.status(402).json({ error: MSG_BLOCCO.sola_lettura, code: "sola_lettura" });
  next();
};
const solo = (...ruoli) => (req, res, next) => ruoli.includes(req.user?.ruolo) ? next() : res.status(403).json({ error: "Operazione non consentita per il tuo ruolo." });

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
  app: APP_NAME, stripe: PAG.stripeAttivo(), metodi: PAG.metodiAttivi(), prova_giorni: TRIAL_DAYS,
  contatti: { email: process.env.CONTATTO_EMAIL || "", telefono: process.env.CONTATTO_TELEFONO || "", sito: process.env.CONTATTO_SITO || "" },
}));
app.get("/api/piani", (req, res) => res.json(db.prepare("SELECT id,nome,descrizione,max_tecnici,mesi,prezzo_cent,prezzo_mese_cent FROM piani WHERE attivo=1 ORDER BY ordine, prezzo_cent").all()));

/* ---------- prova gratuita dal sito ---------- */
function pivaValida(v) {
  if (!/^\d{11}$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) { let n = Number(v[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } somma += n; }
  return (10 - (somma % 10)) % 10 === Number(v[10]);
}
const emailValida = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
// CORS aperto solo al sito (WEBSITE_URL, anche con www)
app.use("/api/public", (req, res, next) => {
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
/** Crea l'azienda in prova con il suo amministratore (password provvisoria da cambiare al primo accesso). Usata dalla prova gratuita e dall'acquisto dal sito.
 *  Senza `piano` è il piano più grande (prova); con `piano` (acquisto) l'azienda parte con quel piano e con i suoi limiti, in prova fino al pagamento. */
function creaAziendaProva(req, { ragione, piva, telefono, email, nome, nota, piano, indirizzo, cap }) {
  const fine = addDays(oggi(), Math.max(1, TRIAL_DAYS) - 1);
  const pianoProva = piano || db.prepare("SELECT * FROM piani WHERE attivo=1 ORDER BY max_tecnici DESC, prezzo_cent DESC LIMIT 1").get();
  const maxT = pianoProva?.max_tecnici || db.prepare("SELECT MAX(max_tecnici) m FROM piani WHERE attivo=1").get().m || 10;
  const azId = uid(), pwd = tempPassword();
  db.transaction(() => {
    db.prepare("INSERT INTO aziende (id,ragione,piva,indirizzo,cap,telefono,email,stato,abbonamento_fine,max_tecnici,piano_id,note,prova,terms_version,terms_at,terms_ip,creato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)")
      .run(azId, ragione, piva, indirizzo || "", cap || "", telefono, email, "attiva", fine, maxT, pianoProva?.id || null, nota, TERMS_VERSION, nowISO(), String(req.ip || ""), nowISO());
    db.prepare("INSERT INTO utenti (id,azienda_id,ruolo,nome,email,hash,attivo,cambia_pwd,creato) VALUES (?,?,?,?,?,?,1,1,?)")
      .run(uid(), azId, "admin", nome, email, bcrypt.hashSync(pwd, 10), nowISO());
  })();
  return { azId, pwd, fine, utente: db.prepare("SELECT * FROM utenti WHERE azienda_id=? AND ruolo='admin'").get(azId) };
}
async function scaricaPdf(url) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1000 && buf.slice(0, 4).toString() === "%PDF" ? buf : null;
  } catch { return null; }
}
const scaricaTermini = () => scaricaPdf(TERMS_PDF_URL);
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

  const { azId, pwd, fine } = creaAziendaProva(req, { ragione, piva, telefono: str(b.phone, 40), email, nome,
    nota: `Iscritto dal sito il ${fmtD(oggi())} (IP ${req.ip}), termini v${TERMS_VERSION}${str(b.sector, 80) ? `, settore: ${str(b.sector, 80)}` : ""}` });
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

/* ---------- acquisto dal sito (contratto comune: comune/acquisto-dal-sito.md; modello BluGest) ---------- */
const PERIODO_ACQUISTO = "annuale"; // sul sito si compra solo l'annuale
const METODI_ACQUISTO = ["carta", "paypal", "bonifico"];
const euroDec = (cent) => (cent / 100).toFixed(2);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Pacchetti in vendita: piani attivi con prezzo annuale > 0 nel listino del server (gli importi non arrivano mai dal browser). */
const pianiInVendita = () => db.prepare("SELECT * FROM piani WHERE attivo=1 AND prezzo_cent>0 ORDER BY ordine, prezzo_cent").all();
const originiSito = () => { const host = WEBSITE_URL.replace(/^https?:\/\//, ""); return [WEBSITE_URL, `https://www.${host}`, `http://www.${host}`].map((x) => x.toLowerCase()); };
/** Pagina del sito (stessa origine di WEBSITE_URL) con `stato` impostato; altrimenti null. */
function urlSito(url, stato) {
  try {
    const u = new URL(String(url || "").trim());
    if (!["http:", "https:"].includes(u.protocol) || !originiSito().includes(u.origin.toLowerCase())) return null;
    u.hash = ""; u.searchParams.set("stato", stato);
    return u.toString();
  } catch { return null; }
}
app.get("/api/public/acquisto", (req, res) => {
  const metodi = PAG.metodiAttivi().filter((m) => METODI_ACQUISTO.includes(m));
  const piani = pianiInVendita().map((p) => {
    const a = PAG.importi(p.prezzo_cent);
    return { code: p.id, name: p.nome, descrizione: p.descrizione || "", max_tecnici: p.max_tecnici,
      prezzi: { [PERIODO_ACQUISTO]: { importo: euroDec(a.importo), bollo: euroDec(a.rimborso_bollo), totale: euroDec(a.totale) } } };
  });
  res.json({ enabled: piani.length > 0 && metodi.length > 0, product: APP_NAME, piani, metodi, periodicita: PERIODO_ACQUISTO,
    terms_version: TERMS_VERSION, terms_url: TERMS_URL, privacy_url: `${WEBSITE_URL}/privacy/` });
});
app.post("/api/public/acquisto", wrap(async (req, res) => {
  const errore = (status, message, code) => res.status(status).json({ detail: code ? { code, message } : message });
  const b = req.body || {};
  const email = str(b.email, 200).toLowerCase();
  // robot: campo trappola pieno o compilato troppo in fretta → finto successo, nessun ordine
  if (str(b.website, 500) || (b.elapsed_ms !== null && b.elapsed_ms !== undefined && Number.isFinite(Number(b.elapsed_ms)) && Number(b.elapsed_ms) < 3000)) {
    console.log(`Ordine dal sito scartato (robot) da ${req.ip}`);
    return res.status(201).json({ ok: true, robot: true });
  }
  const nome = str(b.name, 120);
  if (nome.length < 2) return errore(422, "Scrivi nome e cognome del referente");
  if (!emailValida(email)) return errore(422, "Indirizzo email non valido");
  if (b.privacy !== true || b.terms !== true) return errore(422, "Per continuare accetta informativa privacy, termini e contratto");
  if (str(b.terms_version, 20) !== TERMS_VERSION) return errore(422, "I termini di utilizzo sono stati aggiornati: ricarica la pagina, rileggili e accettali di nuovo");
  const metodo = str(b.method, 20);
  if (!METODI_ACQUISTO.includes(metodo)) return errore(422, "Metodo di pagamento non valido: scegli carta, PayPal o bonifico");
  try {
    limita("acq-ip:" + req.ip, 10, 3600000);
    limita("acq-email:" + email, 10, 86400000);
    limita("acq-giorno", 50, 86400000);
  } catch (e) { return errore(429, "Troppi tentativi: riprova più tardi o scrivici"); }
  const dati = PAG.normalizza(Object.fromEntries(Object.entries(b.billing || {}).filter(([, v]) => typeof v === "string")));
  const errs = PAG.problemi(dati);
  if (errs.length) return errore(422, errs.join("; "), "dati_fatturazione");
  if (!PAG.metodiAttivi().includes(metodo)) return errore(422, "Metodo di pagamento non disponibile");
  const piano = pianiInVendita().find((p) => p.id === str(b.plan_code, 60).toLowerCase());
  if (!piano) return errore(404, "Pacchetto non disponibile");
  const piva = (dati.partita_iva || "").replace(/^IT/, "");
  if (db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email))
    return errore(409, "Questa email ha già un accesso a BluCheck: contattaci se non riesci a entrare.", "email_registrata");
  if (piva && db.prepare("SELECT 1 FROM aziende WHERE piva=?").get(piva))
    return errore(409, "Questa azienda è già registrata: contatta l'assistenza per riattivare l'accesso.", "azienda_registrata");

  const ragione = (PAG.nomeCliente(dati) || nome).slice(0, 200);
  const capTxt = dati.nazione === "IT" ? `${dati.cap} ${dati.comune}${dati.provincia ? ` (${dati.provincia})` : ""}` : `${dati.cap || ""} ${dati.comune || ""}`.trim();
  const { azId, pwd, fine, utente } = creaAziendaProva(req, { ragione, piva, telefono: str(b.phone, 40), email, nome, piano, indirizzo: dati.indirizzo, cap: capTxt,
    nota: `Acquisto dal sito il ${fmtD(oggi())} (IP ${req.ip}), termini v${TERMS_VERSION}; prova in attesa del pagamento` });
  db.prepare("UPDATE aziende SET dati_fatturazione=? WHERE id=?").run(JSON.stringify(dati), azId);
  // credenziali per email (come la prova)
  const pdfTermini = await scaricaTermini();
  const inviata = await sendMail(email, `${APP_NAME}: le tue credenziali di accesso`,
    `Gentile ${nome},\ngrazie per aver scelto ${APP_NAME}. Questi sono i dati per il primo accesso.\n\nIndirizzo: ${BASE_URL}/app\nNome utente: ${email}\nPassword provvisoria: ${pwd}\n\n`
    + `Al primo accesso ti verrà chiesto di scegliere una nuova password. L'abbonamento parte quando il pagamento è confermato; fino ad allora puoi già usare il programma (periodo di prova fino al ${fmtD(fine)}).\n\n`
    + `Entrando accetti i termini di utilizzo (versione ${TERMS_VERSION}): ${TERMS_URL}${pdfTermini ? " (in allegato in PDF)" : ""}.\n\n${APP_NAME} · BluCode Informatica`,
    pdfTermini ? [{ filename: `termini-di-utilizzo-v${TERMS_VERSION}.pdf`, content: pdfTermini, contentType: "application/pdf" }] : undefined);
  db.prepare("INSERT INTO avvisi (azienda_id,tipo,testo,creato) VALUES (?,?,?,?)").run(azId, "prova", `Acquisto dal sito: ${ragione} (${nome}, ${email}), piano ${piano.nome}.`, nowISO());

  // pagamento annuale con il checkout esistente (importi sempre dal listino)
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(azId);
  const sito = urlSito(b.return_url, "ok") ? { ok: urlSito(b.return_url, "ok"), annullato: urlSito(b.return_url, "annullato") } : null;
  let r;
  try {
    r = await checkout(az, utente, { piano: piano.id, periodicita: PERIODO_ACQUISTO, metodo }, req.ip, { sito, senzaAvviso: true });
  } catch (e) { // l'azienda resta (come una prova): si mostra l'errore e si può riprovare dall'area clienti
    if (e instanceof HttpError) return errore(e.status, e.message, e.code);
    throw e;
  }
  const p = db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? ORDER BY creato DESC LIMIT 1").get(azId);
  const bonifico = r.bonifico ? { intestatario: r.bonifico.intestatario, iban: r.bonifico.iban, importo: euroDec(r.bonifico.importo_cent), causale: r.bonifico.causale, pagamento: p.id } : null;
  await inviaEmailOrdine(az, p, dati, metodo, piano, bonifico);
  await sendMail(notifyEmails(), `Nuovo ordine dal sito: ${ragione}`,
    `Ordine ${APP_NAME} dal sito.\n${ragione} · ${nome} · ${email}\n${piano.nome} annuale, ${PAG.METODI[metodo]}, totale ${euro(p.totale_cent)}\nCausale ${p.causale}\n`
    + (metodo === "bonifico" ? "\nBonifico: conferma il pagamento dal pannello quando arriva l'accredito: la fattura parte solo allora.\n" : "") + `\n${BASE_URL}/admin#pagamenti`);
  registra("sito", "ordine_dal_sito", `${ragione}: ${piano.nome} ${euro(p.totale_cent)} (${metodo})`, req.ip);
  res.status(201).json({ ok: true, pagamento: p.id, redirect_url: r.redirect_url || null, bonifico, email, credenziali_inviate: inviata });
}));
/** Email «Conferma d'ordine»: contratto compilato (PDF), termini, privacy, link a manuale e video. Non blocca mai l'ordine. */
async function inviaEmailOrdine(az, p, dati, metodo, piano, bonifico) {
  const to = dati.email || az.email;
  try {
    const contratto = CONTRATTO.contrattoPdf({ piano, p, dati, metodo, terminiVersione: TERMS_VERSION, data: oggi() });
    const [termini, privacy] = await Promise.all([scaricaTermini(), scaricaPdf(PRIVACY_PDF_URL)]);
    const att = [{ filename: `Contratto_${APP_NAME}_${p.causale.split(" ").pop()}.pdf`, content: contratto, contentType: "application/pdf" }];
    if (termini) att.push({ filename: `termini-di-utilizzo-v${TERMS_VERSION}.pdf`, content: termini, contentType: "application/pdf" });
    if (privacy) att.push({ filename: "informativa-privacy.pdf", content: privacy, contentType: "application/pdf" });
    const totale = euro(p.totale_cent);
    const come = bonifico
      ? `<p><b>Per attivare l'abbonamento fai il bonifico</b> di <b>${esc(totale)}</b> a <b>${esc(bonifico.intestatario)}</b><br>IBAN <b>${esc(bonifico.iban)}</b><br>Causale: <b>${esc(bonifico.causale)}</b></p>`
        + "<p>Quando il bonifico risulta accreditato confermiamo il pagamento e ti mandiamo la fattura elettronica e la ricevuta. Nel frattempo puoi già usare il programma con il periodo di prova.</p>"
      : "<p>Appena il pagamento è confermato ricevi la ricevuta con la proforma della fattura elettronica, e l'abbonamento annuale parte da subito.</p>";
    const html = `<div style="font-family:Arial,sans-serif;color:#1b2b45;max-width:580px;margin:auto;border-top:4px solid #2340a8;padding:24px">`
      + `<h2 style="color:#2340a8">Grazie per l'ordine, ${esc(PAG.nomeCliente(dati) || az.ragione)}</h2>`
      + `<p>Hai scelto <b>${APP_NAME} ${esc(piano.nome)}</b>, abbonamento annuale: <b>${esc(totale)}</b>.</p>${come}`
      + "<p>Ti abbiamo mandato in un'altra email le credenziali per il primo accesso.</p>"
      + "<p><b>In allegato</b>: contratto di abbonamento, termini di utilizzo e informativa sulla privacy.</p>"
      + `<p><b>Per cominciare</b>:<br>• <a href="${esc(MANUAL_URL)}">Manuale d'uso</a><br>• <a href="${esc(VIDEOS_URL)}">Video tutorial</a><br>• Assistenza: ${esc(contattiTesto())}</p>`
      + `<p style="color:#4a5b75;font-size:13px">Il team ${APP_NAME} · BluCode Informatica</p></div>`;
    const testo = `Grazie per l'ordine.\n\nHai scelto ${APP_NAME} ${piano.nome}, abbonamento annuale: ${totale}.\n`
      + (bonifico ? `Bonifico a ${bonifico.intestatario}, IBAN ${bonifico.iban}, causale ${bonifico.causale}.\n` : "")
      + `\nManuale: ${MANUAL_URL}\nVideo: ${VIDEOS_URL}\n\nBluCode Informatica`;
    const ok = await sendMail([to], `Conferma d'ordine ${APP_NAME}`, testo, att, html);
    db.prepare("UPDATE pagamenti SET email_ordine=? WHERE id=?").run(ok ? 1 : 0, p.id);
  } catch (e) { console.error(`Email d'ordine non inviata a ${to}:`, e.message); }
}
// Ritorno da PayPal dopo un acquisto dal sito (senza accesso): cattura lato server, poi torna alla pagina del sito (solo se è del sito).
app.get("/api/pagamenti/paypal/ritorno", wrap(async (req, res) => {
  const pid = str(req.query.id, 40), r = str(req.query.r, 400);
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=? AND metodo='paypal'").get(pid);
  let stato = "ok";
  if (!p) stato = "errore";
  else {
    try {
      if (p.stato !== "pagato") {
        const c = await PAG.paypalCattura(p.rif_gestore, pid);
        if (c.status === "COMPLETED") await confermaPagamento(pid, "paypal"); else stato = "errore";
      }
    } catch (e) { console.warn("Ritorno PayPal (sito):", e.message); stato = "errore"; }
  }
  const dest = urlSito(r, stato);
  res.redirect(dest || `/app?pagamento=${encodeURIComponent(pid)}&esito=${stato}#abbonamento`);
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
app.put("/api/dati/:coll/:id", auth, azOnly, (req, res) => {
  const { coll, id } = req.params; chk(coll, id);
  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Dati non validi.");
  res.json({ data: salvaDato(req.azienda.id, coll, id, data, req.user) });
});
app.delete("/api/dati/:coll/:id", auth, azOnly, (req, res) => {
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

/* ---------- pagina «Abbonamento» e pagamenti dell'azienda ---------- */
function abbonamentoAzienda(az) {
  const f = statoAbbonamento(az);
  return {
    stato: f, azienda: aziendaPub(az), piano: pianoDi(az.piano_id)?.nome || "",
    tecnici_attivi: tecniciAttivi(az.id),
    pagamenti: db.prepare("SELECT * FROM pagamenti WHERE azienda_id=? AND stato IN ('pagato','in_attesa') ORDER BY creato DESC").all(az.id).map(pagPub),
    ...opzioniPagamento(az),
    // compatibilità con la prima versione dell'interfaccia
    stripe: PAG.metodiAttivi().length > 0,
  };
}
app.get("/api/abbonamento", auth, azOnly, (req, res) => res.json(abbonamentoAzienda(req.azienda)));
app.get("/api/app/pagamenti/opzioni", auth, azOnly, (req, res) => res.json(opzioniPagamento(req.azienda)));
app.put("/api/app/pagamenti/dati-fatturazione", auth, azOnly, solo("admin"), (req, res) => {
  const d = PAG.normalizza(req.body || {});
  const errs = PAG.problemi(d);
  if (errs.length) return res.status(422).json({ error: errs[0], problemi: errs });
  db.prepare("UPDATE aziende SET dati_fatturazione=? WHERE id=?").run(JSON.stringify(d), req.azienda.id);
  res.json({ ok: true, dati_fatturazione: d });
});
app.post("/api/app/pagamenti/checkout", auth, azOnly, solo("admin"), wrap(async (req, res) => {
  res.json(await checkout(req.azienda, req.user, req.body || {}, req.ip));
}));
// Ritorno da PayPal: cattura lato server; la conferma arriva anche dal webhook (idempotente).
app.get("/api/app/pagamenti/paypal/ritorno", auth, azOnly, wrap(async (req, res) => {
  const pid = str(req.query.pid, 40);
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=? AND azienda_id=? AND metodo='paypal'").get(pid, req.azienda.id);
  if (!p) return res.redirect(`/app?pagamento=${encodeURIComponent(pid)}&esito=errore#abbonamento`);
  try {
    const c = await PAG.paypalCattura(str(req.query.token, 60) || p.rif_gestore, pid);
    if (c.status === "COMPLETED") await confermaPagamento(pid, "paypal");
  } catch (e) { console.warn("Ritorno PayPal:", e.message); return res.redirect(`/app?pagamento=${pid}&esito=errore#abbonamento`); }
  res.redirect(`/app?pagamento=${pid}&esito=ok#abbonamento`);
}));
// Esito mostrato al ritorno dalla pagina del gestore. Per la carta si chiede a Stripe (lato server) se è pagato.
app.get("/api/app/pagamenti/:id/esito", auth, azOnly, wrap(async (req, res) => {
  let p = db.prepare("SELECT * FROM pagamenti WHERE id=? AND azienda_id=?").get(str(req.params.id, 40), req.azienda.id);
  if (!p) fail(404, "Pagamento non trovato.");
  if (p.stato === "in_attesa" && p.metodo === "carta" && p.rif_gestore && PAG.stripeAttivo()) {
    try { const s = await PAG.stripeSessione(p.rif_gestore); if (s.payment_status === "paid" && s.metadata?.payment_id === p.id) p = await confermaPagamento(p.id, "stripe"); } catch (e) { console.warn("Esito Stripe:", e.message); }
  }
  const az = db.prepare("SELECT * FROM aziende WHERE id=?").get(req.azienda.id);
  res.json({ pagamento: pagPub(p), stato: statoAbbonamento(az) });
}));
app.get("/api/app/pagamenti/:id/proforma.pdf", auth, azOnly, solo("admin"), (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=? AND azienda_id=? AND stato='pagato' AND fattura_numero IS NOT NULL").get(str(req.params.id, 40), req.azienda.id);
  if (!p) fail(404, "Ricevuta non disponibile.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Proforma_${PAG.etichettaFattura(p).replace("/", "-")}.pdf"`);
  res.send(PAG.proformaPdf({ ...p, dati: JSON.parse(p.dati || "{}") }));
});

/* ============================== API superuser ============================== */
const su = express.Router();
su.use(auth, solo("superuser"));
su.get("/dashboard", (req, res) => {
  const az = db.prepare("SELECT * FROM aziende").all();
  const st = az.map((a) => statoAbbonamento(a).stato);
  const anno = oggi().slice(0, 4);
  res.json({
    attive: st.filter((s) => ["attivo", "in_scadenza", "tolleranza"].includes(s)).length,
    prova: st.filter((s) => s === "prova").length,
    inScadenza: st.filter((s) => s === "in_scadenza").length,
    scadute: st.filter((s) => ["tolleranza", "sola_lettura"].includes(s)).length,
    proveScadute: st.filter((s) => s === "prova_scaduta").length,
    inAttesa: st.filter((s) => s === "in_attesa").length,
    sospese: st.filter((s) => s === "sospeso").length,
    bonificiInAttesa: db.prepare("SELECT COUNT(*) n FROM pagamenti WHERE stato='in_attesa' AND metodo='bonifico'").get().n,
    incassoAnno: db.prepare("SELECT COALESCE(SUM(totale_cent),0) s FROM pagamenti WHERE stato='pagato' AND substr(COALESCE(NULLIF(pagato_il,''),creato),1,4)=?").get(anno).s,
    tecnici: db.prepare("SELECT COUNT(*) n FROM utenti WHERE ruolo IN ('admin','tecnico') AND attivo=1").get().n,
    verifiche: db.prepare("SELECT COUNT(*) n FROM dati WHERE coll='verifiche' AND eliminato=0").get().n,
    avvisi: db.prepare("SELECT v.*, a.ragione FROM avvisi v LEFT JOIN aziende a ON a.id=v.azienda_id ORDER BY v.id DESC LIMIT 15").all(),
    metodi: PAG.metodiAttivi(), stripe: PAG.stripeAttivo(), email: !!mailer, cedente: PAG.problemiCedente(), console: !!process.env.CONSOLE_API_KEY,
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
    pagamenti: db.prepare("SELECT p.*, a.ragione, a.piva FROM pagamenti p JOIN aziende a ON a.id=p.azienda_id WHERE p.azienda_id=? ORDER BY p.creato DESC").all(a.id).map(pagSu),
    dati_fatturazione: datiFatt(a),
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
  const prova = b.prova === false ? 0 : 1; // di default prova gratuita (standard comune); abbonamento vero con un pagamento o «Converti prova»
  const fine = isDate(b.abbonamento_fine) ? b.abbonamento_fine : addDays(oggi(), Math.max(1, PROVA_GIORNI) - 1);
  const azId = uid(), pwd = tempPassword();
  db.transaction(() => {
    db.prepare("INSERT INTO aziende (id,ragione,piva,indirizzo,cap,telefono,email,stato,abbonamento_fine,max_tecnici,piano_id,note,prova,creato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(azId, ragione, str(b.piva, 20), str(b.indirizzo), str(b.cap), str(b.telefono, 40), str(b.email, 200) || email, "attiva", fine, Math.max(1, Number(b.max_tecnici) || 1), str(b.piano_id, 40) || null, str(b.note, 2000), prova, nowISO());
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
  const fine = isDate(b.abbonamento_fine) ? b.abbonamento_fine : (a.abbonamento_fine && a.abbonamento_fine >= oggi() ? a.abbonamento_fine : addDays(oggi(), Math.max(1, PROVA_GIORNI) - 1));
  const maxT = Math.max(1, Number(b.max_tecnici) || a.max_tecnici || 1);
  const prova = a.stato === "in_attesa" ? (b.prova === false ? 0 : 1) : a.prova;
  db.prepare("UPDATE aziende SET stato='attiva', abbonamento_fine=?, max_tecnici=?, prova=? WHERE id=?").run(fine, maxT, prova, a.id);
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
  if (stato === "sospesa" && a.stato !== "sospesa") { db.prepare("UPDATE aziende SET sospesa_il=? WHERE id=?").run(nowISO(), a.id); registra(req.user.email, "azienda_sospesa", a.ragione, req.ip); }
  if (stato === "in_attesa") db.prepare("DELETE FROM sessioni WHERE utente_id IN (SELECT id FROM utenti WHERE azienda_id=?)").run(a.id);
  res.json({ ok: true });
});
su.delete("/aziende/:id", (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  if (str(req.body?.conferma, 200) !== a.ragione) fail(400, "Per eliminare scrivi esattamente la ragione sociale.");
  db.prepare("DELETE FROM aziende WHERE id=?").run(a.id);
  res.json({ ok: true });
});
// Nuovo periodo inserito a mano (proroga, omaggio, accordo, bonifico già incassato fuori dall'app): nessuna fattura.
su.post("/aziende/:id/pagamento", wrap(async (req, res) => {
  const b = req.body || {};
  const metodo = ["manuale", "omaggio", "contanti", "bonifico_esterno", "altro"].includes(b.metodo) ? b.metodo : "manuale";
  const importo = Math.round(Number(String(b.importo ?? "0").replace(",", ".")) * 100) || 0;
  const r = periodoManuale({ aziendaId: str(req.params.id, 64), pianoId: str(b.piano_id, 40) || null, mesi: Number(b.mesi) || null, fine: b.fine, importoCent: importo, metodo,
    descrizione: str(b.descrizione, 200), maxTecnici: Number(b.max_tecnici) || null, restaProva: !!b.resta_prova, chi: req.user.email });
  res.json({ ok: true, periodo_da: r.da, periodo_a: r.a });
}));
su.post("/aziende/:id/converti", (req, res) => {
  const a = db.prepare("SELECT * FROM aziende WHERE id=?").get(str(req.params.id, 64)); if (!a) fail(404, "Azienda non trovata.");
  if (!a.prova) fail(400, "L'azienda non è in prova.");
  db.prepare("UPDATE aziende SET prova=0, prova_convertita_il=? WHERE id=?").run(nowISO(), a.id);
  registra(req.user.email, "prova_convertita", a.ragione, req.ip);
  res.json({ ok: true });
});
const pagSu = (p) => ({ ...pagPub(p), azienda_id: p.azienda_id, ragione: p.ragione, piva: p.piva, rif_gestore: p.rif_gestore, fattura_errori: p.fattura_errori, ha_xml: !!p.fattura_xml, email_cliente: !!p.email_cliente, email_blucode: !!p.email_blucode, annullato_il: p.annullato_il });
su.get("/pagamenti", (req, res) => {
  const stato = ["in_attesa", "pagato", "annullato", "fallito"].includes(req.query.stato) ? req.query.stato : null;
  const rows = db.prepare(`SELECT p.*, a.ragione, a.piva FROM pagamenti p JOIN aziende a ON a.id=p.azienda_id ${stato ? "WHERE p.stato=?" : ""} ORDER BY p.creato DESC LIMIT 1000`).all(...(stato ? [stato] : []));
  res.json(rows.map(pagSu));
});
su.post("/pagamenti/:id/conferma", wrap(async (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 40)); if (!p) fail(404, "Pagamento non trovato.");
  if (p.metodo !== "bonifico") fail(400, "Si confermano a mano solo i bonifici: carta e PayPal si confermano dalla notifica del gestore.");
  if (p.stato !== "in_attesa") fail(400, "Il pagamento non è in attesa.");
  const q = await confermaPagamento(p.id, req.user.email);
  res.json({ ok: true, pagamento: pagPub(q) });
}));
su.post("/pagamenti/:id/annulla", (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 40)); if (!p) fail(404, "Pagamento non trovato.");
  if (p.stato !== "in_attesa") fail(400, "Si annullano solo i pagamenti in attesa.");
  db.prepare("UPDATE pagamenti SET stato='annullato', annullato_il=? WHERE id=?").run(nowISO(), p.id);
  registra(req.user.email, "pagamento_annullato", `${p.id} ${p.causale}`, req.ip);
  res.json({ ok: true });
});
su.post("/pagamenti/:id/reinvia", wrap(async (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 40));
  if (!p || p.stato !== "pagato" || !p.fattura_numero) fail(400, "Solo per i pagamenti confermati con fattura.");
  await documentiPagamento(p.id, { cliente: req.body?.cliente !== false, blucode: req.body?.blucode !== false });
  res.json({ ok: true, pagamento: pagSu({ ...db.prepare("SELECT * FROM pagamenti WHERE id=?").get(p.id) }) });
}));
su.get("/pagamenti/:id/xml", (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 40));
  if (!p || !p.fattura_numero) fail(404, "Fattura non disponibile.");
  const xml = p.fattura_xml || preparaXml(p.id).xml;
  if (!xml) fail(400, "XML non generato: " + (p.fattura_errori || PAG.problemiCedente().join("; ")));
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${PAG.nomeFileXml(p)}"`);
  res.send(xml);
});
su.get("/pagamenti/:id/proforma.pdf", (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 40));
  if (!p || !p.fattura_numero) fail(404, "Ricevuta non disponibile.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Proforma_${PAG.etichettaFattura(p).replace("/", "-")}.pdf"`);
  res.send(PAG.proformaPdf({ ...p, dati: JSON.parse(p.dati || "{}") }));
});
// Si cancellano solo i periodi manuali: una fattura emessa non si cancella (si corregge con nota di credito).
su.delete("/pagamenti/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM pagamenti WHERE id=?").get(str(req.params.id, 64)); if (!p) fail(404, "Pagamento non trovato.");
  if (p.fattura_numero) fail(400, "Una fattura emessa non si cancella: va corretta con una nota di credito.");
  db.prepare("DELETE FROM pagamenti WHERE id=?").run(p.id);
  registra(req.user.email, "periodo_eliminato", `${p.id} ${p.descrizione}`, req.ip);
  res.json({ ok: true });
});
su.get("/impostazioni", (req, res) => {
  const i = impSaas();
  res.json({ giorni_tolleranza: i.giorni_tolleranza, giorni_sola_lettura: i.giorni_sola_lettura, giorni_avviso: i.giorni_avviso, giorni_avviso_prova: i.giorni_avviso_prova,
    modelli: db.prepare("SELECT * FROM modelli_email ORDER BY rowid").all(), segnaposto: AB.SEGNAPOSTO,
    metodi: PAG.metodiAttivi(), cedente: PAG.cedente(), cedente_problemi: PAG.problemiCedente(), sezionale: PAG.sezionale() });
});
su.put("/impostazioni", (req, res) => {
  const b = req.body || {};
  const giorni = (v) => [...new Set(String(v ?? "").split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((x, y) => y - x);
  if (b.giorni_tolleranza !== undefined) setImp("giorni_tolleranza", Math.max(0, Math.min(365, Number(b.giorni_tolleranza) || 0)));
  if (b.giorni_sola_lettura !== undefined) setImp("giorni_sola_lettura", Math.max(0, Math.min(365, Number(b.giorni_sola_lettura) || 0)));
  if (b.giorni_avviso !== undefined) setImp("giorni_avviso", giorni(b.giorni_avviso));
  if (b.giorni_avviso_prova !== undefined) setImp("giorni_avviso_prova", giorni(b.giorni_avviso_prova));
  registra(req.user.email, "impostazioni_avvisi", JSON.stringify(b), req.ip);
  res.json({ ok: true });
});
su.put("/modelli/:codice", (req, res) => {
  const m = db.prepare("SELECT * FROM modelli_email WHERE codice=?").get(str(req.params.codice, 40)); if (!m) fail(404, "Modello non trovato.");
  const oggetto = str(req.body?.oggetto, 200), corpo = String(req.body?.corpo || "").slice(0, 20000);
  if (!oggetto || !corpo) fail(400, "Oggetto e testo sono obbligatori.");
  db.prepare("UPDATE modelli_email SET oggetto=?, corpo=?, aggiornato=? WHERE codice=?").run(oggetto, corpo, nowISO(), m.codice);
  res.json({ ok: true });
});
su.post("/modelli/:codice/predefinito", (req, res) => {
  const d = AB.MODELLI.find((x) => x.codice === req.params.codice); if (!d) fail(404, "Modello non trovato.");
  db.prepare("UPDATE modelli_email SET oggetto=?, corpo=?, aggiornato=? WHERE codice=?").run(d.oggetto, d.corpo, nowISO(), d.codice);
  res.json({ ok: true });
});
su.get("/registro", (req, res) => res.json(db.prepare("SELECT * FROM registro ORDER BY id DESC LIMIT 300").all()));
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
  prezzo_mese_cent: String(b.prezzo_mese ?? "").trim() === "" ? null : Math.max(0, Math.round(Number(String(b.prezzo_mese).replace(",", ".")) * 100) || 0) || null,
});
su.post("/piani", (req, res) => {
  const p = pianoBody(req.body || {}); if (!p.nome) fail(400, "Il piano deve avere un nome.");
  const id = str(req.body.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || uid();
  if (db.prepare("SELECT 1 FROM piani WHERE id=?").get(id)) fail(409, "Esiste già un piano con questo codice.");
  db.prepare("INSERT INTO piani (id,nome,descrizione,max_tecnici,mesi,prezzo_cent,prezzo_mese_cent,attivo,ordine) VALUES (?,?,?,?,?,?,?,?,?)").run(id, p.nome, p.descrizione, p.max_tecnici, p.mesi, p.prezzo_cent, p.prezzo_mese_cent, p.attivo, p.ordine);
  res.json({ ok: true, id });
});
su.put("/piani/:id", (req, res) => {
  const p = pianoBody(req.body || {}); if (!p.nome) fail(400, "Il piano deve avere un nome.");
  db.prepare("UPDATE piani SET nome=?, descrizione=?, max_tecnici=?, mesi=?, prezzo_cent=?, prezzo_mese_cent=?, attivo=?, ordine=? WHERE id=?").run(p.nome, p.descrizione, p.max_tecnici, p.mesi, p.prezzo_cent, p.prezzo_mese_cent, p.attivo, p.ordine, str(req.params.id, 40));
  res.json({ ok: true });
});
su.get("/avvisi", (req, res) => res.json(db.prepare("SELECT v.*, a.ragione FROM avvisi v LEFT JOIN aziende a ON a.id=v.azienda_id ORDER BY v.id DESC LIMIT 300").all()));
su.post("/avvisi/controlla", wrap(async (req, res) => { const inviati = await controllaScadenze(); res.json({ creati: inviati.length, inviati }); }));
su.post("/avvisi/riepilogo", wrap(async (req, res) => res.json({ inviato: await riepilogoSettimanale() })));
app.use("/api/su", su);

/* ============================== BluCode Console (comune/abbonamenti.md §7 e §8) ============================== */
const ugualeCostante = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
function chiaveConsole(req, res, next) {
  const key = process.env.CONSOLE_API_KEY;
  if (!key) return res.status(404).json({ error: "Funzione non trovata." });
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Bearer ") || !ugualeCostante(h.slice(7).trim(), key)) return res.status(401).json({ error: "Chiave non valida" });
  next();
}
function isoLocale(d = new Date()) {
  const off = -d.getTimezoneOffset(), sgn = off >= 0 ? "+" : "-", a = Math.abs(off);
  return `${toISO(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sgn}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}
const e2 = (cent) => Math.round(cent) / 100;
const fineMese = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad2(new Date(y, m, 0).getDate())}`; };
function riepilogoConsole(on = oggi()) {
  const imp = impSaas();
  const aziende = db.prepare("SELECT * FROM aziende WHERE stato<>'in_attesa'").all();
  const pagati = db.prepare("SELECT * FROM pagamenti WHERE stato='pagato'").all();
  const dataIncasso = (p) => (p.periodicita ? (p.pagato_il || p.creato) : (p.periodo_da || p.pagato_il || p.creato)).slice(0, 10);
  const ricavo = (p) => p.importo_cent || 0; // IVA esclusa (forfettario: nessuna IVA); il rimborso del bollo non è ricavo
  const mensileDi = (p) => AB.mensile(ricavo(p), p.periodicita || "personalizzata", p.periodo_da, p.periodo_a);
  const copre = (azId, giorno) => pagati.filter((p) => p.azienda_id === azId && p.periodo_da && p.periodo_da <= giorno && p.periodo_a >= giorno).sort((a, b) => (b.periodo_a > a.periodo_a ? 1 : -1))[0];
  const conteggi = { totale: aziende.length, attive: 0, prova: 0, tolleranza: 0, sola_lettura: 0, sospese: 0 };
  const perPiano = {}, inScad = [], scadute = [];
  let mrr = 0;
  for (const az of aziende) {
    const f = AB.fase(az, imp, on), piano = pianoDi(az.piano_id)?.nome || "";
    if (["attivo", "in_scadenza"].includes(f.stato)) conteggi.attive++;
    else if (f.stato === "prova") conteggi.prova++;
    else if (f.stato === "tolleranza") conteggi.tolleranza++;
    else if (f.stato === "sola_lettura") conteggi.sola_lettura++;
    else conteggi.sospese++;
    const cur = copre(az.id, on);
    if (["attivo", "in_scadenza", "tolleranza"].includes(f.stato) && !az.prova) {
      const p = cur || copre(az.id, f.fine);
      const m = p ? mensileDi(p) : 0; mrr += m;
      const k = piano || "—"; perPiano[k] = perPiano[k] || { piano: k, aziende: 0, mensile_ricorrente: 0 }; perPiano[k].aziende++; perPiano[k].mensile_ricorrente += m;
    }
    if (f.giorni !== null && f.giorni >= 0 && f.giorni <= 30 && ["attivo", "in_scadenza", "prova"].includes(f.stato)) {
      const p = cur || copre(az.id, f.fine);
      inScad.push({ azienda: az.ragione, piano, scadenza: f.fine, giorni: f.giorni, stato: f.stato === "prova" ? "prova" : "attivo", importo: p ? e2(ricavo(p)) : 0,
        periodicita: p?.periodicita || (az.prova ? "prova" : "personalizzata"), prova: !!az.prova, email: az.email, telefono: az.telefono });
    }
    if (["tolleranza", "sola_lettura", "sospeso", "prova_scaduta"].includes(f.stato))
      scadute.push({ azienda: az.ragione, stato: ["sospeso", "prova_scaduta"].includes(f.stato) ? "sospeso" : f.stato, scadenza: f.fine, giorni_da: f.giorni === null ? null : -f.giorni });
  }
  const mese = on.slice(0, 7), anno = on.slice(0, 4), da30 = addDays(on, -30);
  const primoPagamento = {}; for (const p of [...pagati].sort((a, b) => (dataIncasso(a) > dataIncasso(b) ? 1 : -1))) if (p.periodicita && !primoPagamento[p.azienda_id]) primoPagamento[p.azienda_id] = p.id;
  const online30 = pagati.filter((p) => p.periodicita && dataIncasso(p) >= da30 && dataIncasso(p) <= on);
  const provaInizio = (az) => (az.terms_at || az.creato || "").slice(0, 10);
  const prova = (az) => az.prova || az.prova_convertita_il;
  const mesi = []; { const d = new Date(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, 1); for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); mesi.push(`${x.getFullYear()}-${pad2(x.getMonth() + 1)}`); } }
  return {
    prodotto: APP_NAME,
    generato_il: isoLocale(),
    aziende: conteggi,
    ricavi: {
      mensile_ricorrente: e2(mrr), annuale_ricorrente: e2(mrr * 12),
      incassato_mese_corrente: e2(pagati.filter((p) => dataIncasso(p).startsWith(mese)).reduce((s, p) => s + ricavo(p), 0)),
      incassato_anno_corrente: e2(pagati.filter((p) => dataIncasso(p).startsWith(anno)).reduce((s, p) => s + ricavo(p), 0)),
    },
    movimenti_30_giorni: {
      nuove_prove: aziende.filter((a) => prova(a) && provaInizio(a) >= da30).length,
      prove_convertite: aziende.filter((a) => a.prova_convertita_il && a.prova_convertita_il.slice(0, 10) >= da30).length,
      prove_scadute_non_convertite: aziende.filter((a) => a.prova && a.abbonamento_fine && a.abbonamento_fine < on && a.abbonamento_fine >= da30).length,
      rinnovi: online30.filter((p) => primoPagamento[p.azienda_id] !== p.id).length,
      nuovi_abbonamenti: online30.filter((p) => primoPagamento[p.azienda_id] === p.id).length,
      disdette_o_sospensioni: aziende.filter((a) => { const f = AB.fase(a, imp, on); return f.stato === "sospeso" && !a.prova && ((f.manuale && (a.sospesa_il || "").slice(0, 10) >= da30) || (!f.manuale && f.sospensione_dal && f.sospensione_dal >= da30)); }).length,
    },
    per_piano: Object.values(perPiano).map((x) => ({ ...x, mensile_ricorrente: e2(x.mensile_ricorrente) })),
    in_scadenza: inScad.sort((a, b) => (a.scadenza > b.scadenza ? 1 : -1)),
    scadute: scadute.sort((a, b) => (a.scadenza > b.scadenza ? 1 : -1)),
    andamento_12_mesi: mesi.map((m) => {
      const giorno = m === mese ? on : fineMese(m);
      let mr = 0; const paganti = new Set();
      for (const az of aziende) { const p = copre(az.id, giorno); if (p && p.descrizione !== "Proroga della prova") { mr += mensileDi(p); paganti.add(az.id); } }
      return { mese: m, mensile_ricorrente: e2(mr), incassato: e2(pagati.filter((p) => dataIncasso(p).startsWith(m)).reduce((s, p) => s + ricavo(p), 0)), aziende_paganti: paganti.size,
        nuove_prove: aziende.filter((a) => prova(a) && provaInizio(a).startsWith(m)).length };
    }),
  };
}
app.get("/api/console/riepilogo", chiaveConsole, (req, res) => {
  try { limita("console", 60, 3600000); } catch { return res.status(429).json({ error: "Troppe richieste" }); }
  res.json(riepilogoConsole());
});
app.post("/api/console/super-admin/credenziali", chiaveConsole, wrap(async (req, res) => {
  const adminKey = process.env.CONSOLE_ADMIN_KEY;
  if (!adminKey) return res.status(404).json({ error: "Funzione non trovata." });
  if (!ugualeCostante(req.headers["x-console-admin-key"], adminKey)) return res.status(401).json({ error: "Chiave non valida" });
  try { limita("console-cred", 5, 3600000); } catch { return res.status(429).json({ error: "Troppe richieste" }); }
  const b = req.body || {};
  const pwd = String(b.password || "");
  if (pwd.length < 12 || !/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd) || !/\d/.test(pwd)) return res.status(422).json({ error: "La password deve avere almeno 12 caratteri, con maiuscole, minuscole e cifre" });
  const email = b.email ? str(b.email, 200).toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ error: "Email non valida" });
  const principale = (process.env.CONSOLE_SUPERADMIN_EMAIL && db.prepare("SELECT * FROM utenti WHERE ruolo='superuser' AND email=?").get(process.env.CONSOLE_SUPERADMIN_EMAIL.toLowerCase()))
    || db.prepare("SELECT * FROM utenti WHERE ruolo='superuser' ORDER BY creato LIMIT 1").get();
  if (!principale) return res.status(404).json({ error: "Nessun super amministratore" });
  if (email && email !== principale.email && db.prepare("SELECT 1 FROM utenti WHERE email=?").get(email)) return res.status(409).json({ error: "Email già usata da un altro utente" });
  const nuova = email || principale.email;
  db.prepare("UPDATE utenti SET email=?, hash=?, cambia_pwd=0, attivo=1 WHERE id=?").run(nuova, await bcrypt.hash(pwd, 10), principale.id);
  db.prepare("DELETE FROM sessioni WHERE utente_id=?").run(principale.id);
  const quando = nowISO();
  registra("console", "credenziali_super_admin", `email ${principale.email} → ${nuova}`, req.ip);
  await sendMail(notifyEmails(), `[${APP_NAME}] Credenziali del super amministratore cambiate dalla Console`,
    `Le credenziali del super amministratore di ${APP_NAME} sono state cambiate dalla BluCode Console il ${fmtD(quando.slice(0, 10))}.\nEmail di accesso: ${nuova}\nIP: ${req.ip}\n\nSe non sei stato tu, intervieni subito.`);
  res.json({ ok: true, email: nuova, cambiato_il: quando });
}));


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
  // avvisi ogni giorno alle 8:07 (standard comune); se il server riparte dopo le 8:07 il giro del giorno si recupera
  setTimeout(() => { const n = new Date(); if (n.getHours() * 60 + n.getMinutes() >= 8 * 60 + 7) giroGiornaliero().catch(console.error); }, 5000);
  pianificaGiro();
}
module.exports = { app, controllaScadenze, riepilogoSettimanale, confermaPagamento, periodoManuale, riepilogoConsole };
