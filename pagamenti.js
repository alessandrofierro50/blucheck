"use strict";
/*
 * BluCheck - pagamenti degli abbonamenti (contratto comune BluCode: comune/pagamenti.md).
 * Modello di riferimento: BluGest, backend/app/pagamenti (stesse regole, stessi testi).
 *
 * - Dati di fatturazione del cliente, obbligatori prima di pagare.
 * - Importi calcolati solo dal server, dal listino; bollo virtuale 2,00 € sopra 77,47 € (a carico del cliente).
 * - Carta (Stripe Checkout), PayPal (Orders v2) e bonifico con conferma manuale.
 * - A pagamento confermato: numero dal sezionale BC, XML FatturaPA (FPR12/FPA12, TD01, RF19, N2.2) e proforma PDF.
 * I gestori si chiamano via REST con fetch: nei test si sostituisce global.fetch.
 */
const crypto = require("crypto");

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();

/* ============================== metodi ============================== */
const METODI = { carta: "Carta di credito", paypal: "PayPal", bonifico: "Bonifico bancario" };
const XML_METODO = { carta: "MP08", paypal: "MP08", bonifico: "MP05" };
const stripeAttivo = () => !!(env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET"));
const paypalAttivo = () => !!(env("PAYPAL_CLIENT_ID") && env("PAYPAL_SECRET") && env("PAYPAL_WEBHOOK_ID"));
const bonificoAttivo = () => !!env("BONIFICO_IBAN");
/** Metodi davvero utilizzabili: quelli in PAGAMENTI_METODI con le chiavi presenti nel .env. */
function metodiAttivi() {
  const scelti = env("PAGAMENTI_METODI", "carta,paypal,bonifico").split(",").map((s) => s.trim()).filter(Boolean);
  return scelti.filter((m) => (m === "carta" && stripeAttivo()) || (m === "paypal" && paypalAttivo()) || (m === "bonifico" && bonificoAttivo()));
}

/* ============================== validazioni ============================== */
const PROVINCE = new Set(("AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO "
  + "GR IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG "
  + "RI RM RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV").split(" "));
function pivaValida(v) {
  if (!/^\d{11}$/.test(v || "")) return false;
  let t = 0;
  for (let i = 0; i < 10; i++) { let n = Number(v[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } t += n; }
  return (10 - (t % 10)) % 10 === Number(v[10]);
}
const CF_DISPARI = {};
"0123456789".split("").forEach((c, i) => { CF_DISPARI[c] = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21][i]; });
"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => { CF_DISPARI[c] = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23][i]; });
function cfValido(cf) {
  cf = String(cf || "").toUpperCase();
  if (/^\d{11}$/.test(cf)) return pivaValida(cf);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let t = 0;
  for (let i = 0; i < 15; i++) { const ch = cf[i]; t += i % 2 === 0 ? CF_DISPARI[ch] : (/\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65); }
  return String.fromCharCode(65 + (t % 26)) === cf[15];
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ============================== dati di fatturazione ============================== */
const CAMPI = ["tipo", "denominazione", "nome", "cognome", "partita_iva", "codice_fiscale", "indirizzo", "cap", "comune", "provincia", "nazione", "codice_destinatario", "pec", "email"];
function normalizza(input) {
  const out = {};
  for (const k of CAMPI) { const v = input?.[k]; if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200); }
  out.tipo = ["azienda", "privato", "pa"].includes(out.tipo) ? out.tipo : "azienda";
  for (const k of ["partita_iva", "codice_fiscale", "codice_destinatario", "provincia", "nazione"]) if (out[k]) out[k] = out[k].replace(/\s/g, "").toUpperCase();
  out.nazione = out.nazione || "IT";
  if (out.partita_iva && out.nazione === "IT" && out.partita_iva.startsWith("IT")) out.partita_iva = out.partita_iva.slice(2);
  for (const k of ["pec", "email"]) if (out[k]) out[k] = out[k].toLowerCase();
  if (out.tipo === "privato" && !out.codice_destinatario && !out.pec) out.codice_destinatario = "0000000";
  return out;
}
/** Errori bloccanti, con testi per il cliente. Lista vuota = dati completi. */
function problemi(d) {
  const e = [];
  if (!d) return ["Compila i dati di fatturazione"];
  const tipo = d.tipo || "azienda", italia = (d.nazione || "IT") === "IT";
  if (tipo === "privato") { if (!d.nome || !d.cognome) e.push("Indica nome e cognome"); }
  else if (!d.denominazione) e.push("Indica la ragione sociale");
  if (tipo === "azienda" && !d.partita_iva) e.push("La partita IVA è obbligatoria per le aziende");
  if (d.partita_iva && italia && !pivaValida(d.partita_iva)) e.push("Partita IVA non valida (controlla le cifre)");
  if ((tipo === "privato" || tipo === "pa") && !d.codice_fiscale && italia) e.push("Il codice fiscale è obbligatorio");
  if (d.codice_fiscale && italia) {
    if (tipo === "privato" && d.codice_fiscale.length !== 16) e.push("Il codice fiscale di una persona ha 16 caratteri");
    else if (!cfValido(d.codice_fiscale)) e.push("Codice fiscale non valido");
  }
  if (!d.indirizzo) e.push("Indica l'indirizzo");
  if (!d.cap) e.push("Indica il CAP");
  if (!d.comune) e.push("Indica il comune");
  if (italia) {
    if (d.cap && !/^\d{5}$/.test(d.cap)) e.push("Il CAP ha 5 cifre");
    if (!d.provincia) e.push("Indica la provincia");
    else if (!PROVINCE.has(d.provincia)) e.push("Sigla della provincia non valida");
  } else if (!/^[A-Z]{2}$/.test(d.nazione || "")) e.push("Nazione: usa la sigla di 2 lettere (es. IT, DE)");
  const code = d.codice_destinatario, pec = d.pec;
  if (tipo === "pa") { if (!code || !/^[A-Z0-9]{6}$/.test(code)) e.push("Per la Pubblica Amministrazione serve il codice univoco ufficio (6 caratteri)"); }
  else if (italia) {
    if (code && !/^[A-Z0-9]{7}$/.test(code)) e.push("Il codice destinatario ha 7 caratteri (0000000 se non ne hai uno)");
    if (!code && !pec) e.push("Indica il codice destinatario SDI oppure la PEC");
  }
  if (pec && !EMAIL_RE.test(pec)) e.push("PEC non valida");
  if (d.email && !EMAIL_RE.test(d.email)) e.push("Email per la ricevuta non valida");
  return e;
}
const nomeCliente = (d) => (d?.tipo === "privato" ? `${d.nome || ""} ${d.cognome || ""}`.trim() : d?.denominazione || "");

/* ============================== importi ============================== */
const SOGLIA_BOLLO = 7747, BOLLO = 200;
/** Importi in centesimi dal prezzo di listino. */
function importi(prezzoCent) {
  const bollo = prezzoCent > SOGLIA_BOLLO ? BOLLO : 0;
  const rimborso = env("BOLLO_A_CARICO", "cliente") === "cliente" ? bollo : 0;
  return { importo: prezzoCent, bollo, rimborso_bollo: rimborso, totale: prezzoCent + rimborso };
}

/* ============================== cedente e fattura ============================== */
const FORFETTARIO_TESTO = "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge n. 190/2014 — regime forfettario. Non soggetta a IVA né a ritenuta d'acconto";
const FORFETTARIO_RIF = "Art. 1, commi 54-89, L. 190/2014 - regime forfettario";
const BOLLO_TESTO = "Imposta di bollo assolta in modo virtuale ai sensi del D.M. 17/06/2014";
const PROFORMA_NOTA = "Documento non valido ai fini fiscali: la fattura elettronica sarà disponibile nella tua area riservata dell'Agenzia delle Entrate";
const REGIMI = new Set(["RF01", "RF02", "RF04", "RF05", "RF06", "RF07", "RF08", "RF09", "RF10", "RF11", "RF12", "RF13", "RF14", "RF15", "RF16", "RF17", "RF18", "RF19", "RF20"]);
const ARUBA_CF = "01879020517";
const sezionale = () => env("FATTURE_SEZIONALE", "BC");
function cedente() {
  return {
    denominazione: env("CEDENTE_DENOMINAZIONE"), piva: env("CEDENTE_PIVA").replace(/\s/g, "").toUpperCase().replace(/^IT/, ""),
    cf: env("CEDENTE_CF").replace(/\s/g, "").toUpperCase(), indirizzo: env("CEDENTE_INDIRIZZO"), cap: env("CEDENTE_CAP"),
    comune: env("CEDENTE_COMUNE"), provincia: env("CEDENTE_PROVINCIA").toUpperCase(), regime: env("REGIME_FISCALE", "RF19"),
  };
}
function problemiCedente() {
  const c = cedente(), e = [];
  if (!c.denominazione) e.push("CEDENTE_DENOMINAZIONE non impostata");
  if (!pivaValida(c.piva)) e.push("CEDENTE_PIVA mancante o non valida");
  for (const k of ["indirizzo", "cap", "comune", "provincia"]) if (!c[k]) e.push(`CEDENTE_${k.toUpperCase()} non impostato`);
  if (!REGIMI.has(c.regime)) e.push(`REGIME_FISCALE «${c.regime}» non valido`);
  return e;
}
const etichettaFattura = (p) => (p.fattura_numero ? `${p.fattura_numero}/${p.fattura_sezionale || sezionale()}` : null);
function progressivo(p) {
  let n = (p.fattura_anno - 2000) * 100000 + p.fattura_numero, out = "";
  const D = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  do { out = D[n % 36] + out; n = Math.floor(n / 36); } while (n > 0);
  return out.padStart(5, "0");
}
const nomeFileXml = (p) => `IT${cedente().piva}_${progressivo(p)}.xml`;
const fmtIt = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
function descrizioneRiga(p) {
  const brand = "BluCheck";
  const piano = (p.piano_nome || "").toLowerCase().startsWith(brand.toLowerCase()) ? p.piano_nome : `${brand} ${p.piano_nome || ""}`.trim();
  return `Abbonamento ${piano} - ${p.periodicita || "annuale"} dal ${fmtIt(p.periodo_da)} al ${fmtIt(p.periodo_a)}`;
}

/* ---------- XML ---------- */
const REPL = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "€": "EUR", "…": "...", "•": "-", " ": " ", "×": "x", "\t": " " };
function pulisci(t, size) {
  let out = "";
  for (const ch0 of String(t ?? "")) {
    const ch = REPL[ch0] ?? ch0;
    for (const c of ch) {
      const code = c.codePointAt(0);
      if (c === "\n" || c === "\r") out += " ";
      else if (code < 32) continue;
      else if (code <= 255) out += c;
      else out += c.normalize("NFKD").replace(/[^\x00-\x7f]/g, "") || " ";
    }
  }
  return out.replace(/ {2,}/g, " ").trim().slice(0, size);
}
const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const eur2 = (cent) => (cent / 100).toFixed(2);
function el(name, content, indent) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(content)) return `${pad}<${name}>\n${content.filter(Boolean).join("")}${pad}</${name}>\n`;
  return `${pad}<${name}>${xesc(content)}</${name}>\n`;
}
function sede(ind, cap, comune, prov, naz, i) {
  return el("Sede", [el("Indirizzo", pulisci(ind, 60), i + 1), el("CAP", String(cap || "00000").slice(0, 5), i + 1), el("Comune", pulisci(comune, 60), i + 1),
    prov ? el("Provincia", prov.toUpperCase().slice(0, 2), i + 1) : "", el("Nazione", (naz || "IT").toUpperCase(), i + 1)], i);
}
/** XML FatturaPA 1.2.2 della fattura del pagamento `p` (già numerato). */
function buildXml(p) {
  const c = cedente(), b = p.dati || {};
  const fmt = b.tipo === "pa" ? "FPA12" : "FPR12";
  const estero = (b.nazione || "IT") !== "IT";
  const codice = estero ? "XXXXXXX" : (b.codice_destinatario || (fmt === "FPA12" ? "999999" : "0000000"));
  const trasm = [
    el("IdTrasmittente", [el("IdPaese", "IT", 4), el("IdCodice", env("FATTURE_INVIO", "manuale") === "sdi" ? ARUBA_CF : c.piva, 4)], 3),
    el("ProgressivoInvio", progressivo(p), 3), el("FormatoTrasmissione", fmt, 3), el("CodiceDestinatario", codice, 3),
    codice === "0000000" && b.pec && fmt === "FPR12" ? el("PECDestinatario", pulisci(b.pec, 256), 3) : "",
  ];
  const cedAn = [el("IdFiscaleIVA", [el("IdPaese", "IT", 5), el("IdCodice", c.piva, 5)], 4), c.cf ? el("CodiceFiscale", c.cf, 4) : "",
    el("Anagrafica", [el("Denominazione", pulisci(c.denominazione, 80), 5)], 4), el("RegimeFiscale", c.regime, 4)];
  const cesAn = [
    b.partita_iva ? el("IdFiscaleIVA", [el("IdPaese", (b.nazione || "IT").toUpperCase(), 5), el("IdCodice", b.partita_iva.slice(0, 28), 5)], 4) : "",
    b.codice_fiscale && !estero ? el("CodiceFiscale", b.codice_fiscale, 4) : "",
    el("Anagrafica", b.tipo === "privato" ? [el("Nome", pulisci(b.nome, 60), 5), el("Cognome", pulisci(b.cognome, 60), 5)] : [el("Denominazione", pulisci(b.denominazione, 80), 5)], 4),
  ];
  const righe = [[descrizioneRiga(p), p.importo_cent]];
  if (p.rimborso_bollo_cent > 0) righe.push(["Rimborso imposta di bollo", p.rimborso_bollo_cent]);
  const causale = c.regime === "RF19" ? pulisci(FORFETTARIO_TESTO, 1000) : "";
  const causali = []; for (let i = 0; i < causale.length; i += 200) causali.push(el("Causale", causale.slice(i, i + 200), 4));
  const imponibile = righe.reduce((s, r) => s + r[1], 0);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" versione="${fmt}">
  <FatturaElettronicaHeader>
${el("DatiTrasmissione", trasm, 2)}${el("CedentePrestatore", [el("DatiAnagrafici", cedAn, 3), sede(c.indirizzo, c.cap, c.comune, c.provincia, "IT", 3)], 2)}${el("CessionarioCommittente", [el("DatiAnagrafici", cesAn, 3), sede(b.indirizzo, estero ? "00000" : b.cap, b.comune, estero ? null : b.provincia, b.nazione, 3)], 2)}  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
${el("DatiGenerali", [el("DatiGeneraliDocumento", [el("TipoDocumento", "TD01", 4), el("Divisa", "EUR", 4), el("Data", p.fattura_data, 4), el("Numero", etichettaFattura(p), 4),
    p.bollo_cent > 0 ? el("DatiBollo", [el("BolloVirtuale", "SI", 5), el("ImportoBollo", eur2(p.bollo_cent), 5)], 4) : "",
    el("ImportoTotaleDocumento", eur2(p.totale_cent), 4), ...causali], 3)], 2)}${el("DatiBeniServizi", [
    ...righe.map(([d, v], i) => el("DettaglioLinee", [el("NumeroLinea", String(i + 1), 4), el("Descrizione", pulisci(d, 1000), 4), el("Quantita", "1.00", 4),
      el("PrezzoUnitario", eur2(v), 4), el("PrezzoTotale", eur2(v), 4), el("AliquotaIVA", "0.00", 4), el("Natura", "N2.2", 4)], 3)),
    el("DatiRiepilogo", [el("AliquotaIVA", "0.00", 4), el("Natura", "N2.2", 4), el("ImponibileImporto", eur2(imponibile), 4), el("Imposta", "0.00", 4), el("RiferimentoNormativo", pulisci(FORFETTARIO_RIF, 100), 4)], 3)], 2)}${el("DatiPagamento", [el("CondizioniPagamento", "TP02", 3),
    el("DettaglioPagamento", [el("ModalitaPagamento", XML_METODO[p.metodo] || "MP08", 4), el("DataScadenzaPagamento", p.fattura_data, 4), el("ImportoPagamento", eur2(p.totale_cent), 4),
      p.metodo === "bonifico" && env("BONIFICO_IBAN") ? el("IBAN", env("BONIFICO_IBAN").replace(/\s/g, "").toUpperCase(), 4) : ""], 3)], 2)}  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;
  return xml;
}

/* ---------- proforma PDF (jsPDF) ---------- */
const eurIt = (cent) => (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
function proformaPdf(p) {
  const { jsPDF } = require("jspdf");
  const c = cedente(), b = p.dati || {};
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const T = (s) => String(s ?? "").replace(/€/g, "EUR").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").replace(/·/g, "-");
  const BLU = [35, 64, 168], INK = [11, 33, 71], MUTED = [74, 91, 117], LINE = [200, 214, 230];
  const X = 16, W = 178; let y = 18;
  d.setTextColor(...BLU); d.setFont("helvetica", "bold"); d.setFontSize(12); d.text(T(c.denominazione || "BluCode Informatica"), X, y);
  d.setFontSize(17); d.text("Proforma", X + W, y, { align: "right" });
  d.setFont("helvetica", "normal"); d.setFontSize(8.5); d.setTextColor(...MUTED);
  d.text(T(`${c.indirizzo}, ${c.cap} ${c.comune} (${c.provincia})`), X, y + 5);
  d.text(T(`P.IVA ${c.piva}${c.cf ? " · C.F. " + c.cf : ""}`), X, y + 9);
  const contatti = [env("SUPPORT_EMAIL", env("CONTATTO_EMAIL")), env("SUPPORT_PHONE", env("CONTATTO_TELEFONO"))].filter(Boolean).join(" · ");
  if (contatti) d.text(T(contatti), X, y + 13);
  d.setTextColor(...INK); d.setFontSize(9.5);
  d.text(T(`Fattura n. ${etichettaFattura(p)} del ${fmtIt(p.fattura_data)}`), X + W, y + 6, { align: "right" });
  y += 17; d.setDrawColor(...BLU); d.setLineWidth(0.7); d.line(X, y, X + W, y);
  y += 6;
  d.setFillColor(244, 247, 250); d.setDrawColor(...LINE); d.setLineWidth(0.2); d.rect(X, y, W, 30, "FD");
  d.setFontSize(7.5); d.setTextColor(...MUTED); d.setFont("helvetica", "bold"); d.text("CLIENTE", X + 3, y + 5); d.text("PAGAMENTO", X + 116, y + 5);
  d.setFont("helvetica", "normal"); d.setFontSize(9.5); d.setTextColor(...INK);
  const ids = [b.partita_iva ? `P.IVA ${b.partita_iva}` : "", b.codice_fiscale ? `C.F. ${b.codice_fiscale}` : ""].filter(Boolean).join(" · ");
  d.setFont("helvetica", "bold"); d.text(T(nomeCliente(b)).slice(0, 60), X + 3, y + 10); d.setFont("helvetica", "normal");
  d.text(T(`${b.indirizzo || ""}, ${b.cap || ""} ${b.comune || ""}${b.provincia ? " (" + b.provincia + ")" : ""}`).slice(0, 70), X + 3, y + 15);
  d.text(T(ids), X + 3, y + 20);
  const sdi = [b.codice_destinatario ? `Codice destinatario ${b.codice_destinatario}` : "", b.pec ? `PEC ${b.pec}` : ""].filter(Boolean).join(" · ");
  if (sdi) { d.setFontSize(8); d.setTextColor(...MUTED); d.text(T(sdi), X + 3, y + 25); d.setFontSize(9.5); d.setTextColor(...INK); }
  d.setFont("helvetica", "bold"); d.text(T(METODI[p.metodo] || p.metodo), X + 116, y + 10); d.setFont("helvetica", "normal");
  d.text(T(`Pagato il ${fmtIt(p.pagato_il)}`), X + 116, y + 15);
  d.setFontSize(8); d.setTextColor(...MUTED); d.text(T(`Riferimento ${p.causale || ""}`), X + 116, y + 20);
  y += 38;
  d.setFontSize(9.5); d.setTextColor(...INK); d.setFont("helvetica", "bold");
  d.text("Descrizione", X, y); d.text("Natura", X + 132, y); d.text("Importo", X + W, y, { align: "right" });
  d.setDrawColor(...BLU); d.setLineWidth(0.4); d.line(X, y + 2, X + W, y + 2); d.setFont("helvetica", "normal");
  y += 8;
  const righe = [[descrizioneRiga(p), p.importo_cent]];
  if (p.rimborso_bollo_cent > 0) righe.push(["Rimborso imposta di bollo", p.rimborso_bollo_cent]);
  d.setDrawColor(...LINE); d.setLineWidth(0.2);
  for (const [desc, v] of righe) {
    const lines = d.splitTextToSize(T(desc), 125);
    d.text(lines, X, y); d.text("N2.2", X + 132, y); d.text(T(eurIt(v)), X + W, y, { align: "right" });
    y += lines.length * 4.5 + 2; d.line(X, y - 1, X + W, y - 1); y += 4;
  }
  y += 2;
  const tot = [["Imponibile", eurIt(p.importo_cent + p.rimborso_bollo_cent)], ["IVA", "0,00 €"]];
  if (p.bollo_cent > 0 && !p.rimborso_bollo_cent) tot.push(["Bollo virtuale (a carico del cedente)", eurIt(p.bollo_cent)]);
  for (const [l, v] of tot) { d.text(T(l), X + 100, y); d.text(T(v), X + W, y, { align: "right" }); y += 5.5; }
  d.setDrawColor(...BLU); d.setLineWidth(0.5); d.line(X + 100, y - 3, X + W, y - 3);
  d.setFont("helvetica", "bold"); d.setFontSize(11); d.text("Totale pagato", X + 100, y + 2); d.text(T(eurIt(p.totale_cent)), X + W, y + 2, { align: "right" });
  y += 14; d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(...MUTED);
  if (c.regime === "RF19") { const l = d.splitTextToSize(T(FORFETTARIO_TESTO + "."), W); d.text(l, X, y); y += l.length * 3.6 + 2; }
  if (p.bollo_cent > 0) { const l = d.splitTextToSize(T(`${BOLLO_TESTO} (${eurIt(p.bollo_cent)}).`), W); d.text(l, X, y); y += l.length * 3.6 + 2; }
  y += 4;
  d.setDrawColor(255, 200, 61); d.setFillColor(255, 247, 223); d.setLineWidth(0.6);
  d.setFont("helvetica", "bold"); d.setFontSize(9.5); d.setTextColor(...INK);
  const nota = d.splitTextToSize(T(PROFORMA_NOTA + "."), W - 8);
  d.rect(X, y, W, nota.length * 4.4 + 6, "FD"); d.text(nota, X + 4, y + 6);
  y += nota.length * 4.4 + 14; d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(...MUTED); d.text("BluCheck · BluCode Informatica", X, y);
  return Buffer.from(d.output("arraybuffer"));
}

/* ============================== gestori ============================== */
class ProviderError extends Error { }
const STRIPE_API = "https://api.stripe.com";
const PAYPAL_API = () => (env("PAYPAL_MODE", "sandbox") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
async function stripeCheckout({ pid, azId, descrizione, totaleCent, email, successUrl, cancelUrl }) {
  const form = new URLSearchParams({
    mode: "payment", client_reference_id: pid, "metadata[payment_id]": pid, "metadata[azienda_id]": azId,
    "payment_intent_data[metadata][payment_id]": pid, "payment_intent_data[description]": descrizione,
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": String(totaleCent),
    "line_items[0][price_data][product_data][name]": descrizione, locale: "it", success_url: successUrl, cancel_url: cancelUrl,
    // le fatture degli abbonamenti le emette BluCode: niente Managed Payments (Stripe venditore al posto nostro), come BluGest
    "managed_payments[enabled]": "false",
  });
  if (env("STRIPE_TAX_CODE")) form.set("line_items[0][price_data][product_data][tax_code]", env("STRIPE_TAX_CODE"));
  if (email) form.set("customer_email", email);
  const r = await fetch(`${STRIPE_API}/v1/checkout/sessions`, { method: "POST", body: form, headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`, "Idempotency-Key": `checkout-${pid}` } });
  if (!r.ok) { console.warn("Stripe checkout", r.status, (await r.text()).slice(0, 300)); throw new ProviderError("Il pagamento con carta non è disponibile in questo momento: riprova o scegli un altro metodo"); }
  const j = await r.json(); return { id: j.id, url: j.url };
}
async function stripeSessione(id) {
  const r = await fetch(`${STRIPE_API}/v1/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` } });
  if (!r.ok) throw new ProviderError("Sessione Stripe non trovata");
  return r.json();
}
/** Verifica `Stripe-Signature` (HMAC SHA-256 su "<t>.<corpo>") con tolleranza di 5 minuti. */
function stripeVerifica(payload, header, secret = env("STRIPE_WEBHOOK_SECRET"), now = Date.now() / 1000) {
  if (!secret || !header) throw new ProviderError("firma assente");
  const parts = {};
  for (const item of String(header).split(",")) { const [k, v] = item.trim().split("="); (parts[k] ||= []).push(v); }
  const ts = Number(parts.t?.[0]);
  if (!Number.isFinite(ts)) throw new ProviderError("firma non valida");
  const atteso = crypto.createHmac("sha256", secret).update(`${ts}.`).update(payload).digest("hex");
  const ok = (parts.v1 || []).some((s) => s && s.length === atteso.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(atteso)));
  if (!ok) throw new ProviderError("firma non valida");
  if (Math.abs(now - ts) > 300) throw new ProviderError("firma scaduta");
  return JSON.parse(payload.toString("utf8"));
}
const stripeFirma = (payload, secret, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${crypto.createHmac("sha256", secret).update(`${ts}.`).update(payload).digest("hex")}`;

async function paypalToken() {
  const r = await fetch(`${PAYPAL_API()}/v1/oauth2/token`, {
    method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: "Basic " + Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_SECRET")}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
  });
  if (!r.ok) { console.warn("PayPal token", r.status); throw new ProviderError("PayPal non è disponibile in questo momento: riprova o scegli un altro metodo"); }
  return (await r.json()).access_token;
}
async function paypalOrdine({ pid, causale, descrizione, totaleCent, returnUrl, cancelUrl }) {
  const token = await paypalToken();
  const body = {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: pid, custom_id: pid, invoice_id: causale, description: descrizione.slice(0, 127), amount: { currency_code: "EUR", value: eur2(totaleCent) } }],
    payment_source: { paypal: { experience_context: { brand_name: "BluCode Informatica", locale: "it-IT", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: returnUrl, cancel_url: cancelUrl } } },
  };
  const r = await fetch(`${PAYPAL_API()}/v2/checkout/orders`, { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "PayPal-Request-Id": `order-${pid}` } });
  if (!r.ok) { console.warn("PayPal ordine", r.status, (await r.text()).slice(0, 300)); throw new ProviderError("PayPal non è disponibile in questo momento: riprova o scegli un altro metodo"); }
  const j = await r.json();
  const url = (j.links || []).find((l) => ["payer-action", "approve"].includes(l.rel))?.href;
  if (!url) throw new ProviderError("PayPal non ha restituito la pagina di pagamento");
  return { id: j.id, url };
}
async function paypalCattura(orderId, pid) {
  const token = await paypalToken();
  const r = await fetch(`${PAYPAL_API()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "PayPal-Request-Id": `capture-${pid}` } });
  const txt = await r.text();
  if (r.status === 422 && txt.includes("ORDER_ALREADY_CAPTURED")) return { status: "COMPLETED", already: true };
  if (!r.ok) { console.warn("PayPal cattura", r.status, txt.slice(0, 300)); throw new ProviderError("PayPal non ha completato il pagamento"); }
  return JSON.parse(txt);
}
async function paypalVerifica(headers, evento) {
  const need = { auth_algo: "paypal-auth-algo", cert_url: "paypal-cert-url", transmission_id: "paypal-transmission-id", transmission_sig: "paypal-transmission-sig", transmission_time: "paypal-transmission-time" };
  const body = {}; for (const [k, h] of Object.entries(need)) body[k] = headers[h];
  if (!env("PAYPAL_WEBHOOK_ID") || Object.values(body).some((v) => !v)) return false;
  try {
    const token = await paypalToken();
    const r = await fetch(`${PAYPAL_API()}/v1/notifications/verify-webhook-signature`, { method: "POST", body: JSON.stringify({ ...body, webhook_id: env("PAYPAL_WEBHOOK_ID"), webhook_event: evento }), headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } });
    return r.ok && (await r.json()).verification_status === "SUCCESS";
  } catch (e) { console.warn("Verifica webhook PayPal non riuscita:", e.message); return false; }
}

module.exports = {
  METODI, metodiAttivi, stripeAttivo, paypalAttivo, bonificoAttivo, pivaValida, cfValido, normalizza, problemi, nomeCliente, importi,
  cedente, problemiCedente, sezionale, etichettaFattura, nomeFileXml, buildXml, proformaPdf, descrizioneRiga, PROFORMA_NOTA,
  ProviderError, stripeCheckout, stripeSessione, stripeVerifica, stripeFirma, paypalOrdine, paypalCattura, paypalVerifica,
};
