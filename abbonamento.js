"use strict";
/*
 * BluCheck - regole degli abbonamenti, come BluGest (backend/app/saas/logic.py e defaults.py).
 * Standard comune BluCode: comune/abbonamenti.md.
 *
 * Fasi: prova → (fine) prova_scaduta = subito sospesa.
 *       attivo / in_scadenza (≤30 gg) → tolleranza (15 gg) → sola_lettura (30 gg) → sospeso.
 *       Sospensione manuale dal pannello = sospeso.
 */

const STATI = {
  prova: "In prova", attivo: "Attivo", in_scadenza: "In scadenza", tolleranza: "Scaduto (tolleranza)",
  sola_lettura: "Sola lettura", sospeso: "Sospeso", prova_scaduta: "Prova scaduta", in_attesa: "Da abilitare",
};
const SOGLIA_IN_SCADENZA = 30;
const PREDEFINITI = { giorni_tolleranza: 15, giorni_sola_lettura: 30, giorni_avviso: [30, 15, 7, 3, 1, 0], giorni_avviso_prova: [3, 1, 0] };

const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const oggi = () => toISO(new Date());
const parseD = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseD(iso); d.setDate(d.getDate() + n); return toISO(d); };
const giorniTra = (da, a) => Math.round((parseD(a) - parseD(da)) / 86400000);

/** Stato dell'azienda a una data. `imp` = impostazioni (tolleranza, sola lettura). */
function fase(az, imp = PREDEFINITI, on = oggi()) {
  if (!az) return null;
  const tol = Number(imp.giorni_tolleranza ?? 15), sl = Number(imp.giorni_sola_lettura ?? 30);
  const fine = az.abbonamento_fine || null;
  const giorni = fine ? giorniTra(on, fine) : null;
  let stato;
  if (az.stato === "in_attesa") stato = "in_attesa";
  else if (az.stato === "sospesa" || !fine) stato = "sospeso";
  else if (giorni >= 0) stato = az.prova ? "prova" : (giorni <= SOGLIA_IN_SCADENZA ? "in_scadenza" : "attivo");
  else if (az.prova) stato = "prova_scaduta";
  else if (-giorni <= tol) stato = "tolleranza";
  else if (-giorni <= tol + sl) stato = "sola_lettura";
  else stato = "sospeso";
  const accesso = ["prova", "attivo", "in_scadenza", "tolleranza"].includes(stato) ? "completo" : stato === "sola_lettura" ? "lettura" : "nessuno";
  return {
    stato, etichetta: STATI[stato], accesso, prova: !!az.prova, fine, giorni,
    manuale: az.stato === "sospesa",
    sola_lettura_dal: fine && !az.prova ? addDays(fine, tol + 1) : null,
    sospensione_dal: fine ? (az.prova ? addDays(fine, 1) : addDays(fine, tol + sl + 1)) : null,
    giorni_tolleranza: tol, giorni_sola_lettura: sl,
    // compatibilità con l'interfaccia
    scaduto: giorni === null || giorni < 0, inScadenza: giorni !== null && giorni >= 0 && giorni <= SOGLIA_IN_SCADENZA,
  };
}
/** Codice 402 uniforme tra i software. */
const codiceBlocco = (stato) => (stato === "prova_scaduta" ? "prova_scaduta" : "abbonamento_sospeso");

/** Regola più vicina già scattata: se il controllo salta un giorno parte solo l'avviso più vicino. */
function regolaDaInviare(giorni, regole) {
  if (giorni === null || giorni < 0) return null;
  const ok = regole.filter((r) => r >= giorni);
  return ok.length ? Math.min(...ok) : null;
}
const FINESTRA_RITARDO = 7;
/** Quale avviso mandare oggi (o null). Restituisce { regola, modello }. */
function avvisoDelGiorno(f, imp, on = oggi()) {
  if (!f || !f.fine || f.manuale || f.stato === "in_attesa") return null;
  if (f.prova) {
    if (f.giorni >= 0) {
      const d = regolaDaInviare(f.giorni, imp.giorni_avviso_prova || PREDEFINITI.giorni_avviso_prova);
      return d === null ? null : { regola: `prova_${d}`, modello: f.giorni === 0 ? "prova_oggi" : "prova_avviso" };
    }
    return -f.giorni <= FINESTRA_RITARDO + 1 ? { regola: "prova_scaduta", modello: "prova_scaduta" } : null;
  }
  if (f.giorni >= 0) {
    const d = regolaDaInviare(f.giorni, imp.giorni_avviso || PREDEFINITI.giorni_avviso);
    return d === null ? null : { regola: `giorni_${d}`, modello: f.giorni === 0 ? "scadenza_oggi" : "scadenza_avviso" };
  }
  const ultimoTol = addDays(f.fine, f.giorni_tolleranza), giornoSosp = f.sospensione_dal;
  if (f.stato === "sospeso" && on >= giornoSosp && giorniTra(giornoSosp, on) <= FINESTRA_RITARDO) return { regola: "sospensione", modello: "sospensione" };
  if (["tolleranza", "sola_lettura"].includes(f.stato) && on >= ultimoTol && giorniTra(ultimoTol, on) <= FINESTRA_RITARDO) return { regola: "fine_tolleranza", modello: "fine_tolleranza" };
  return null;
}

/* ---------- modelli email (modificabili dal pannello) ---------- */
const STILE = "font-family:Arial,sans-serif;color:#1b2b45;max-width:560px;margin:auto;border-top:4px solid #2340a8;padding:24px";
const BOTTONI = `<p><a href="{link_rinnovo}" style="background:#2340a8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Rinnova ora</a> &nbsp; <a href="{link_accesso}" style="color:#2340a8">Accedi a {prodotto}</a></p>
<p style="color:#4a5b75;font-size:13px">Per rinnovare o cambiare piano: {contatti}<br>Il team {prodotto} · BluCode Informatica</p>`;
const box = (corpo) => `<div style="${STILE}">\n<h2 style="color:#2340a8">Gentile {azienda},</h2>\n${corpo}\n${BOTTONI}</div>`;
const MODELLI = [
  { codice: "scadenza_avviso", descrizione: "Avviso di scadenza imminente (30, 15, 7, 3, 1 giorni prima)", oggetto: "Il tuo abbonamento {piano} scade tra {giorni} giorni",
    corpo: box("<p>ti ricordiamo che il tuo abbonamento <b>{piano}</b> scade il <b>{scadenza}</b>, tra {giorni} giorni.</p>\n<p>Per continuare a usare {prodotto} senza interruzioni rinnova ora: carta, PayPal o bonifico, dalla pagina «Abbonamento».</p>") },
  { codice: "scadenza_oggi", descrizione: "Avviso il giorno della scadenza", oggetto: "Il tuo abbonamento {piano} scade oggi",
    corpo: box("<p>il tuo abbonamento <b>{piano}</b> scade <b>oggi, {scadenza}</b>.</p>\n<p>Hai ancora {giorni_tolleranza} giorni di tolleranza con accesso completo; poi {prodotto} passerà in sola lettura. I tuoi dati restano al sicuro.</p>") },
  { codice: "fine_tolleranza", descrizione: "Ultimo giorno di tolleranza: da domani sola lettura", oggetto: "Da domani {prodotto} sarà in sola lettura",
    corpo: box("<p>oggi è l'ultimo giorno di tolleranza del tuo abbonamento <b>{piano}</b>, scaduto il {scadenza}. Da domani {prodotto} sarà in <b>sola lettura</b>: potrai consultare e stampare i rapporti, ma non registrare nuove verifiche. Dopo {giorni_sola_lettura} giorni l'accesso verrà sospeso.</p>") },
  { codice: "sospensione", descrizione: "Sospensione dopo la sola lettura", oggetto: "Il tuo accesso a {prodotto} è sospeso",
    corpo: box("<p>il tuo abbonamento <b>{piano}</b> è scaduto il {scadenza} e il periodo di sola lettura è terminato: l'accesso a {prodotto} è <b>sospeso</b>. I tuoi dati restano conservati: rinnova per riprendere da dove eri rimasto.</p>") },
  { codice: "prova_avviso", descrizione: "Prova gratuita: avviso 3 e 1 giorno prima della fine", oggetto: "La tua prova di {prodotto} finisce tra {giorni} giorni",
    corpo: box("<p>la tua prova gratuita di <b>{prodotto} {piano}</b> finisce il <b>{scadenza}</b>, tra {giorni} giorni.</p>\n<p>Per continuare senza perdere i dati che hai inserito, attiva l'abbonamento con «Rinnova ora» (carta, PayPal o bonifico).</p>") },
  { codice: "prova_oggi", descrizione: "Prova gratuita: ultimo giorno", oggetto: "Oggi è l'ultimo giorno della tua prova di {prodotto}",
    corpo: box("<p>oggi, {scadenza}, è l'ultimo giorno della tua prova gratuita di <b>{prodotto} {piano}</b>.</p>\n<p>Da domani l'accesso sarà sospeso. I dati restano conservati per 30 giorni: attiva l'abbonamento per ritrovarli.</p>") },
  { codice: "prova_scaduta", descrizione: "Prova gratuita terminata: accesso sospeso", oggetto: "La tua prova di {prodotto} è terminata",
    corpo: box("<p>la tua prova gratuita di <b>{prodotto} {piano}</b> è terminata il {scadenza} e l'accesso è sospeso.</p>\n<p>I tuoi dati restano conservati per 30 giorni: se attivi l'abbonamento riparti esattamente da dove eri.</p>") },
];
const SEGNAPOSTO = ["azienda", "prodotto", "piano", "scadenza", "giorni", "link_accesso", "link_rinnovo", "contatti", "giorni_tolleranza", "giorni_sola_lettura"];
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function compila(testo, valori, html = false) {
  return String(testo).replace(/\{([a-z_]+)\}/g, (m, k) => (k in valori ? (html ? escHtml(valori[k]) : String(valori[k])) : m));
}
const testoDaHtml = (h) => String(h).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h2|div)>/gi, "\n\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2: $1")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

/** Importo del periodo riportato al mese (centesimi): annuale /12, mensile, altrimenti importo / giorni × 30. */
function mensile(importoCent, periodicita, da, a) {
  if (periodicita === "mensile") return importoCent;
  if (periodicita === "annuale") return importoCent / 12;
  if (!da || !a) return 0;
  const g = giorniTra(da, a) + 1;
  return g > 0 ? (importoCent / g) * 30 : 0;
}

module.exports = { STATI, PREDEFINITI, fase, codiceBlocco, regolaDaInviare, avvisoDelGiorno, MODELLI, SEGNAPOSTO, compila, testoDaHtml, mensile, addDays, giorniTra, oggi };
