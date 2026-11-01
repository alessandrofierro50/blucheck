"use strict";
/*
 * Lettura della pagina "Dettaglio Stato Fiscalizzazione Dispositivo" dell'Agenzia delle Entrate,
 * a cui porta il QR code applicato sui registratori telematici:
 *   https://ivaservizi.agenziaentrate.gov.it/ser/mobile/fiscalizzazione/v1/stato/<id>?seed=<n>
 * Estrae matricola, stato, marca/modello, sigillo, approvazione, ultima verificazione periodica,
 * firmware del dispositivo e ultimo firmware del modello, dati dell'esercente.
 */

const AE_HOST = "ivaservizi.agenziaentrate.gov.it";
const AE_PATH = "/ser/mobile/fiscalizzazione/";

function isAeUrl(s) {
  try { const u = new URL(String(s)); return u.protocol === "https:" && u.hostname === AE_HOST && u.pathname.startsWith(AE_PATH); }
  catch { return false; }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È", Eacute: "É" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? m;
});

/** HTML -> elenco di testi visibili, nell'ordine della pagina. */
function tokens(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, " ")
    .split(/<[^>]*>/)
    .map((t) => decode(t).replace(/\s+/g, " ").trim())
    .filter((t) => t && t !== ":");
}

const N = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").replace(/\s*:\s*$/, "").trim();

function parseAePage(html) {
  const T = tokens(html);
  const isLabel = (t, label) => { const n = N(t), l = N(label); return n === l || n.startsWith(l + ":") || n.startsWith(l + " :"); };
  const at = (i) => {
    const t = T[i]; const k = t.indexOf(":");
    if (k >= 0 && t.slice(k + 1).trim()) return t.slice(k + 1).trim();
    return T[i + 1] ?? "";
  };
  const find = (label, from = 0, to = T.length) => { for (let i = from; i < to; i++) if (isLabel(T[i], label)) return i; return -1; };
  const sec = (label) => { const i = T.findIndex((t) => N(t) === N(label)); return i; };
  const SECTIONS = ["Informazioni Dispositivo", "Riferimento di Approvazione", "Ultima Verificazione Periodica", "Ultima Trasmissione da Dispositivo", "Ultima versione software del dispositivo", "Ultima versione software del modello", "Esercente", "Gestore", "Elenco collegamenti attivi", "Elenco matricole Qrcode visualizzati"];
  const secEnd = (start) => { let end = T.length; for (const s of SECTIONS) { const i = sec(s); if (i > start && i < end) end = i; } return end; };
  const get = (label, section) => {
    let from = 0, to = T.length;
    if (section) { const s = sec(section); if (s < 0) return ""; from = s + 1; to = secEnd(s); }
    else { const first = Math.min(...SECTIONS.map(sec).filter((i) => i >= 0), T.length); to = first; }
    let i = find(label, from, to);
    if (i < 0 && !section) i = find(label);
    return i < 0 ? "" : clean(at(i));
  };
  const clean = (v) => { v = String(v || "").trim(); return /^[-/\s]*$/.test(v) ? "" : v; };
  const dataIso = (v) => { const m = String(v || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };

  const vpStart = sec("Ultima Verificazione Periodica");
  let vpEsito = "";
  if (vpStart >= 0) { for (let i = vpStart + 1; i < secEnd(vpStart); i++) if (/^\d{2}\s*-\s*\S/.test(T[i])) { vpEsito = T[i]; break; } }
  const eser = sec("Esercente") >= 0 ? "Esercente" : sec("Gestore") >= 0 ? "Gestore" : null;

  const out = {
    matricola: get("Matricola"),
    stato: get("Stato"),
    marca: get("Marca", "Informazioni Dispositivo"),
    marcaDescr: get("Descrizione Marca", "Informazioni Dispositivo"),
    modello: get("Modello", "Informazioni Dispositivo"),
    modelloDescr: get("Descrizione Modello", "Informazioni Dispositivo"),
    tipoSigillo: get("Tipo Sigillo", "Informazioni Dispositivo"),
    ambito: get("Ambito di Utilizzo", "Informazioni Dispositivo"),
    tipoDistribuzione: get("Tipo Distribuzione"),
    approvazioneNumero: get("Numero", "Riferimento di Approvazione"),
    approvazioneData: dataIso(get("Data", "Riferimento di Approvazione")),
    vpData: dataIso(get("Data", "Ultima Verificazione Periodica")),
    vpEsito,
    vpPivaLab: get("PIVA Laboratorio", "Ultima Verificazione Periodica"),
    vpCfTecnico: get("CF Tecnico", "Ultima Verificazione Periodica"),
    ultimaTrasmissione: dataIso(get("Data", "Ultima Trasmissione da Dispositivo")),
    fwDispositivo: get("Versione", "Ultima versione software del dispositivo"),
    fwDispositivoData: dataIso(get("Data Rilascio", "Ultima versione software del dispositivo")),
    fwModello: get("Versione", "Ultima versione software del modello"),
    fwModelloData: dataIso(get("Data Rilascio", "Ultima versione software del modello")),
    fwModelloAutorizzazione: get("Autorizzazione", "Ultima versione software del modello"),
    esercentePiva: eser ? get("Partita IVA", eser).replace(/\s/g, "") : "",
    esercenteNome: eser ? get("Denominazione", eser) : "",
  };
  // Il "Modello" della sezione dispositivo potrebbe essere letto come la "Descrizione Modello" se l'etichetta manca
  if (out.modello && out.modelloDescr && out.modello === out.modelloDescr) out.modello = "";
  out.vpPositiva = /esito positivo/i.test(out.vpEsito);
  out.modelloCompleto = [out.marcaDescr || out.marca, out.modelloDescr || out.modello].filter(Boolean).join(" ");
  out.sigilloCodice = /piomb|percuss/i.test(out.tipoSigillo) ? "1" : /adesiv|targhett|etichett/i.test(out.tipoSigillo) ? "2" : /tamper/i.test(out.tipoSigillo) ? "3" : "";
  return out;
}

const cache = new Map();
async function leggiQrAe(url) {
  if (!isAeUrl(url)) { const e = new Error("Il QR non porta al servizio dell'Agenzia delle Entrate."); e.status = 400; throw e; }
  const c = cache.get(url); if (c && Date.now() - c.t < 10 * 60000) return c.v;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
  let html;
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (BluCheck; verifiche periodiche RT)", "accept": "text/html", "accept-language": "it-IT,it" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    html = await r.text();
  } catch (e) {
    const err = new Error("Il sito dell'Agenzia non risponde. Riprova tra poco oppure apri la pagina dal telefono."); err.status = 502; throw err;
  } finally { clearTimeout(to); }
  const v = parseAePage(html);
  if (!v.matricola) { const e = new Error("Pagina dell'Agenzia letta, ma senza i dati del dispositivo. Aprila dal telefono per controllarla."); e.status = 422; throw e; }
  cache.set(url, { t: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}

module.exports = { isAeUrl, parseAePage, leggiQrAe, tokens };
