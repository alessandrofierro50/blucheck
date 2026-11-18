"use strict";
/* BluCheck - lista di controllo e moduli PDF (A4, termico 80 mm, dichiarazione), timbro del cliente, comandi ESC/POS per la termica */
const TX = {
  p11: ["Verifica integrità e chiusura involucro RT, integrità Targhetta identificativa, tipo e integrità del Sigillo Fiscale:", "Involucro RT integro e chiuso"],
  p12: ["Targhetta identificativa del Registratore Telematico riportante Modello, Matricola, dati anagrafici del Fabbricante.", "Targhetta identificativa"],
  p13: ["Tipo Sigillo:  1. A percussione (lega tenera metallica)  2. Targhetta adesiva conforme all'allegato A del Provvedimento del Direttore dell'Agenzia delle Entrate del 6 maggio 2010  3. Tamper", "Sigillo fiscale"],
  dich: ["Dichiarazione rilasciata dall'utente e resa con le modalità e i contenuti di cui al punto 5.2 del Provv. Agenzia entrate del 28.7.2003", "Dichiarazione utente"],
  qr: ["Verifica presenza e conformità della targhetta QR Code (targhetta adesiva conforme all'interfaccia grafica riportata nella Specifiche Tecniche relative ai RT emesse dall'Agenzia delle Entrate)", "Targhetta QR Code"],
  scan: ["Verifica tramite scansione QR Code completezza e coerenza dati identificativi dell'esercente e dati identificativi del Registratore Telematico (marchio del fabbricante, depositato presso l'Agenzia delle Entrate all'atto della presentazione della domanda di approvazione del modello; denominazione commerciale del modello; numero di matricola; estremi del provvedimento di approvazione; dati relativi alla verificazione periodica)", "Scansione QR / dati coerenti"],
  fw: ["Identificazione della versione firmware installata e verifica corrispondenza sul QR Code (ove riportata). Aggiornamento all'ultima versione disponibile del Firmware RT", "Firmware verificato/aggiornato"],
  disp: ["Controllare dispositivi indicatori, tastiera, stampante (ad alimentazione inserita). Controllare la regolare visualizzazione per ogni decade delle cifre battute sulla tastiera. Accertare la regolare funzionalità dei singoli tasti. Accertare la regolare stampa delle varie cifre (può essere eseguito contestualmente alla stampa prevista nei successivi punti)", "Display, tastiera, stampante"],
  acc: ["Accertare che l'esercente sappia di potere impostare modalità di accesso riservato a protezione dei dati contenuti nella memoria di riepilogo e nella memoria di dettaglio.", "Accesso riservato memorie"],
  provH: ["PROVE DI EMISSIONE DOCUMENTO COMMERCIALE, GENERAZIONE XML, COLLOQUIO CON SISTEMA A.E. (possibile sia in stato simulazione che in ambiente reale)", "PROVE EMISSIONE / XML / A.E."],
  e1: ["Stampare, anche virtualmente, il documento di chiusura giornaliera (se l'operazione non è già stata eseguita dall'esercente immediatamente prima dell'inizio dell'intervento del tecnico)", "Chiusura giornaliera iniziale"],
  e2: ["Stampare almeno due documenti commerciali di VENDITA con importi superiori a Euro 1,00 aventi le cifre decimali diverse da zero ed effettuati con pagamento elettronico. Se il software installato sul RT supporta la gestione della Lotteria degli Scontrini (differita e istantanea): 1. verificare la stampa del Codice Bidimensionale (lotteria istantanea); 2. verificare la stampa del Codice Lotteria (lotteria differita) controllando la funzionalità del lettore di barcode (se presente) e la possibilità di inserimento manuale del Codice Lotteria.", "2 doc. vendita + lotteria"],
  e3: ["Annullare i due documenti commerciali di vendita emessi al punto {E2} (tramite emissione di documento commerciale di annullo o reso totale)", "Annullo / reso totale"],
  e4: ["Verificare la conformità del documento commerciale come definito dal decreto ministeriale MEF del 7.12.2016 e successive modifiche", "Conformità doc. commerciale"],
  e5: ["Stampare, anche virtualmente, il documento di chiusura giornaliera", "Chiusura giornaliera finale"],
  e6: ["Controllare che il n. dei documenti commerciali battuti, il numero totale dei documenti commerciali/gestionali emessi e che il corrispettivo giornaliero siano coerenti con le prove eseguite", "Coerenza totali e corrispettivo"],
  e7: ["Accertarsi del regolare funzionamento del modulo fiscale, della corretta registrazione dei dati nella memoria permanente di dettaglio (DGFE) e in quella di riepilogo (Memoria Fiscale) e della funzionalità di stampa della memoria come da Specifiche Tecniche", "Memorie DGFE / MF"],
  e8: ["Accertarsi del regolare invio dei file XML (Corrispettivi e Lotteria) e del riscontro dell'esito da parte del Sistema A.E.", "Trasmissione XML ad A.E."],
  intH: ["PROVE INTEGRATIVE di cui al punto 5.1 del Provv. Agenzia entrate del 28.7.2003, di valenza identica a quelle effettuate nei controlli di conformità di cui all'art. 7 del DM 23.3.83", "PROVE INTEGRATIVE"],
  i1: ["Disconnessione della memoria permanente di riepilogo e di dettaglio dal processore che esegue il firmware fiscale; in tale situazione RT non deve emettere alcun tipo di documento e produrre opportuna segnalazione di errore. A seguito della riconnessione delle memorie il tecnico interviene con un reset totale per ripristinare l'operatività dell'apparecchio.", "Disconnessione memorie"],
  i2: ["Disconnessione del dispositivo per la visualizzazione dei dati (display) dal processore che esegue il firmware fiscale; in tale situazione RT non deve emettere alcun tipo di documento e produrre opportuna segnalazione. A seguito della riconnessione del display e successiva accensione dell'apparecchio, il tecnico verifica la corretta funzionalità di RT.", "Disconnessione display"],
  reg: ["Registrazione nella memoria di riepilogo, unitamente al proprio identificativo (codice fiscale CORRETTO e rilasciato dall'A.E.) e PARTITA IVA CORRETTA (rilasciata dell'A.E.) del laboratorio per cui il Tecnico opera, delle informazioni riferite all'operazione effettuata e all'esito della Verificazione Periodica, così come definito nella tabella 9 dell'allegato alle Specifiche Tecniche \"Allegato - Code List\"", "Registrazione in memoria"],
  ril: ["Rilascio all'utente resoconto di esito positivo / negativo della Verifica Periodica. Si ha esito negativo della verificazione periodica in presenza di esito negativo di uno o più dei test da 2.1 a {LAST}.", "Rilascio resoconto"],
};
const PRE = [{ c: "1.1", k: "p11" }, { c: "", k: "p12" }, { c: "", k: "p13" }];
function buildTests(tipo) {
  const L = tipo === "privo"
    ? [["2.1", "dich", 1], ["2.2", "qr", 1], ["2.3", "scan", 1], ["2.4", "fw", 1], ["2.5", "disp", 1], ["2.6", "acc", 1], ["2.7", "provH", 0, 1],
      ["2.7.1", "e1", 1], ["2.7.2", "e2", 1], ["2.7.3", "e3", 1], ["2.7.4", "e4", 1], ["2.7.5", "e5", 1], ["2.7.6", "e6", 1], ["2.7.7", "e7", 1], ["2.7.8", "e8", 1],
      ["2.8", "intH", 0, 1], ["2.8.1", "i1", 1], ["2.8.2", "i2", 1], ["2.9", "reg", 0], ["2.10", "ril", 0]]
    : [["2.1", "qr", 1], ["2.2", "scan", 1], ["2.3", "fw", 1], ["2.4", "disp", 1], ["2.5", "acc", 1], ["2.6", "provH", 0, 1],
      ["2.6.1", "e1", 1], ["2.6.2", "e2", 1], ["2.6.3", "e3", 1], ["2.6.4", "e4", 1], ["2.6.5", "e5", 1], ["2.6.6", "e6", 1], ["2.6.7", "e7", 1], ["2.6.8", "e8", 1],
      ["2.7", "reg", 0], ["2.8", "ril", 0]];
  const e2 = tipo === "privo" ? "2.7.2" : "2.6.2", last = tipo === "privo" ? "2.8.2" : "2.6.8";
  return L.map(([c, k, inE, h]) => ({ c, k, inEsito: !!inE, head: !!h, t: TX[k][0].replace("{E2}", e2).replace("{LAST}", last), s: TX[k][1] }));
}
function computeEsito(v) {
  const vals = buildTests(v.tipo).filter((t) => t.inEsito).map((t) => v.esiti?.[t.k]);
  if (vals.some((x) => x === "no")) return "negativo";
  if (vals.every((x) => x === "si")) return "positivo";
  return "incompleto";
}
const INTERVENTI = [["lab", "Laboratorio"], ["utente", "Utente"], ["vp", "V.P."], ["attivazione", "Attivazione"], ["biennale", "Biennale"], ["post", "Post.Inter."]];
const SIGILLI = { "1": "A percussione (lega tenera metallica)", "2": "Targhetta adesiva (all. A Provv. 6/5/2010)", "3": "Tamper" };

const clean = (s) => String(s ?? "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, "-").replace(/€/g, "Euro ").replace(/…/g, "...");
const LH = (fs) => fs * 0.3528 * 1.18;
const labFor = (v) => ({ ...(v.lab || {}), tecnico: v.tecnico?.nome || "", cfTecnico: v.tecnico?.cf || "", sigillo: v.tecnico?.sigillo || "" });

/* Timbro simulato del cliente: immagine PNG (sfondo trasparente) con ragione sociale, indirizzo, P.IVA e C.F. presi
   dai dati del cliente del rapporto. Inchiostro blu, doppia cornice, leggera inclinazione e grana come un timbro vero.
   Restituisce { url, w, h } (pixel) oppure null se manca la ragione sociale. */
function timbroLinee(cli) {
  const c = cli || {}; if (!String(c.ragione || "").trim()) return null;
  const up = (s) => clean(s).trim().toUpperCase();
  const piva = String(c.piva || "").trim(), cf = String(c.cf || "").trim();
  return [up(c.ragione), up(c.domicilio), [piva ? "P.IVA " + piva : "", cf && cf.toUpperCase() !== piva.toUpperCase() ? "C.F. " + cf.toUpperCase() : ""].filter(Boolean).join("  ")].filter(Boolean);
}
function timbroCliente(cli, { inchiostro = "#1f3a9e", grana = true } = {}) {
  const linee = timbroLinee(cli); if (!linee) return null;
  const S = 4, W = 230 * S, PAD = 14 * S, FONT = "Helvetica, Arial, sans-serif";
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  const fitFont = (txt, size, bold, maxW) => { let s = size; for (; s > 8 * S; s -= S) { ctx.font = `${bold ? "bold " : ""}${s}px ${FONT}`; if (ctx.measureText(txt).width <= maxW) break; } return s; };
  const maxW = W - 2 * PAD;
  // la ragione sociale va su due righe se è troppo lunga anche col carattere piccolo
  let righe = [];
  const r0 = linee[0]; ctx.font = `bold ${15 * S}px ${FONT}`;
  if (ctx.measureText(r0).width > maxW * 1.25 && r0.includes(" ")) {
    // due righe il più possibile uguali, stesso carattere
    const parole = r0.split(" "); let best = 1, bw = Infinity;
    for (let i = 1; i < parole.length; i++) { const w = Math.max(ctx.measureText(parole.slice(0, i).join(" ")).width, ctx.measureText(parole.slice(i).join(" ")).width); if (w < bw) { bw = w; best = i; } }
    const a = parole.slice(0, best).join(" "), b = parole.slice(best).join(" "), fs = Math.min(fitFont(a, 15 * S, true, maxW), fitFont(b, 15 * S, true, maxW));
    righe.push([a, true, fs], [b, true, fs]);
  } else righe.push([r0, true]);
  linee.slice(1).forEach((l) => righe.push([l, false]));
  righe = righe.filter(([t]) => t).map(([t, b, fs]) => [t, b, fs || fitFont(t, b ? 15 * S : 10.5 * S, b, maxW)]);
  const gap = 3 * S, hTxt = righe.reduce((h, [, , s]) => h + s * 1.12, 0) + gap * (righe.length - 1);
  const H = Math.round(hTxt + 2 * PAD);
  const ang = -2.2 * Math.PI / 180, cw = Math.ceil(W * Math.cos(-ang) + H * Math.sin(-ang)), ch = Math.ceil(W * Math.sin(-ang) + H * Math.cos(-ang));
  cv.width = cw + 4 * S; cv.height = ch + 4 * S;
  ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(ang); ctx.translate(-W / 2, -H / 2);
  ctx.strokeStyle = inchiostro; ctx.fillStyle = inchiostro;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.stroke(); };
  ctx.lineWidth = 2.6 * S; rr(1.5 * S, 1.5 * S, W - 3 * S, H - 3 * S, 9 * S);
  ctx.lineWidth = 1 * S; rr(6 * S, 6 * S, W - 12 * S, H - 12 * S, 6 * S);
  ctx.textAlign = "center"; ctx.textBaseline = "top"; let y = PAD;
  for (const [t, b, s] of righe) { ctx.font = `${b ? "bold " : ""}${s}px ${FONT}`; ctx.fillText(t, W / 2, y); y += s * 1.12 + gap; }
  if (grana) { // inchiostro non uniforme: piccole lacune casuali (seme fisso: stesso timbro a ogni stampa)
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "destination-out";
    let seed = 0; for (const ch of linee.join("|")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < (cv.width * cv.height) / (18 * S * S); i++) { ctx.globalAlpha = 0.25 + rnd() * 0.6; ctx.beginPath(); ctx.arc(rnd() * cv.width, rnd() * cv.height, (0.3 + rnd() * 0.9) * S, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  return { url: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
}
// mette l'immagine dentro un riquadro (mm) mantenendo le proporzioni; restituisce la dimensione usata
function fitImg(d, img, x, y, maxW, maxH, alignBottom = true) {
  if (!img?.url) return null;
  let w = maxW, h = img.h * w / img.w; if (h > maxH) { h = maxH; w = img.w * h / img.h; }
  try { d.addImage(img.url, "PNG", x, alignBottom ? y + maxH - h : y, w, h); } catch { return null; }
  return { w, h };
}

function pdfA4(v, firmaU, firmaT, timbro) {
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit: "mm", format: "a4" });
  const M = 12, W = 210 - 2 * M, X = M; let y = M; const L = labFor(v);
  const txt = (s, x, yy, w, fs = 8, st = "normal", align = "left") => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), w); d.text(lines, align === "center" ? x + w / 2 : x, yy + LH(fs) * 0.8, { align }); return lines.length * LH(fs); };
  const meas = (s, w, fs = 8, st = "normal") => { d.setFont("helvetica", st); d.setFontSize(fs); return d.splitTextToSize(clean(s), w).length * LH(fs); };
  const need = (h) => { if (y + h > 297 - M) { d.addPage(); y = M; } };
  const box = (x, yy, w, h) => d.rect(x, yy, w, h);
  const tick = (x, yy, on) => { d.rect(x, yy, 3.6, 3.6); if (on) { d.setLineWidth(0.45); d.line(x + 0.6, yy + 0.6, x + 3, yy + 3); d.line(x + 3, yy + 0.6, x + 0.6, yy + 3); d.setLineWidth(0.2); } };
  d.setLineWidth(0.2); d.setDrawColor(40);
  const lw = 62, tw = W - lw;
  const labTxt = [L.ragione, L.indirizzo, L.cap, L.piva ? "P.I. " + L.piva : "", L.telefono ? "Tel. " + L.telefono : ""].filter(Boolean).join("\n");
  const title = `RAPPORTO DI VERIFICAZIONE PERIODICA DI REGISTRATORE TELEMATICO ${v.tipo === "privo" ? "PRIVO DI SIGILLO FISCALE" : "CON SIGILLO FISCALE INTEGRO"}`;
  const hh = Math.max(meas(labTxt, lw - 4, 9), meas(title, tw - 4, 10.5, "bold") + LH(8) + 2) + 6;
  box(X, y, lw, hh); box(X + lw, y, tw, hh);
  txt(labTxt, X + 2, y + 3, lw - 4, 9, "bold");
  const th = txt(title, X + lw + 2, y + 3, tw - 4, 10.5, "bold", "center");
  txt("(Provvedimenti Agenzia entrate del 28 luglio 2003 e del 28 ottobre 2016)", X + lw + 2, y + 4 + th, tw - 4, 8, "normal", "center");
  y += hh;
  txt(`Rapporto n. ${v.numero || ""}`, X, y + 1, W, 8); y += 5;
  const groups = [["ESERCENTE", [["Ragione Sociale", v.cli?.ragione], ["Domicilio/Residenza", v.cli?.domicilio], ["Partita Iva", v.cli?.piva]]],
    ["UBICAZIONE ESERCIZIO", [["Indirizzo", v.app?.indirizzo], ["CAP/Località/Prov.", v.app?.localita]]],
    ["APPARECCHIO", [["Marchio/Modello", v.app?.modello], ["Matricola", v.app?.matricola]]]];
  const g1 = 36, g2 = 38, g3 = W - g1 - g2;
  for (const [g, rows] of groups) {
    const hs = rows.map(([, val]) => Math.max(6, meas(val || "", g3 - 4, 9) + 2.5)); const gh = hs.reduce((a, b) => a + b, 0);
    need(gh); box(X, y, g1, gh); txt(g, X + 2, y + gh / 2 - 2, g1 - 4, 8, "bold");
    let yy = y; rows.forEach(([l, val], i) => { box(X + g1, yy, g2, hs[i]); box(X + g1 + g2, yy, g3, hs[i]); txt(l, X + g1 + 2, yy + 1.3, g2 - 4, 8); txt(val || "", X + g1 + g2 + 2, yy + 1.1, g3 - 4, 9, "bold"); yy += hs[i]; });
    y += gh;
  }
  need(8); const iw = W / 7; box(X, y, iw, 8); txt("Intervento", X + 2, y + 2, iw - 4, 8, "bold");
  INTERVENTI.forEach(([k, l], i) => { const x = X + iw * (i + 1); box(x, y, iw, 8); tick(x + 2, y + 2.2, !!v.interventi?.[k]); txt(l, x + 7, y + 2.2, iw - 8, 7.5); });
  y += 10;
  const cw = 13, sw = 9, xw = W - cw - 2 * sw;
  const sec = (t) => {
    const h = Math.max(7, meas(t, xw + cw - 4, 8.5, "bold") + 3); need(h); box(X, y, W - 2 * sw, h); box(X + W - 2 * sw, y, sw, h); box(X + W - sw, y, sw, h);
    txt(t, X + 2, y + 1.5, xw + cw - 4, 8.5, "bold"); txt("SI", X + W - 2 * sw, y + 1.5, sw, 8, "bold", "center"); txt("NO", X + W - sw, y + 1.5, sw, 8, "bold", "center"); y += h;
  };
  const row = (c, t, k, isHead) => {
    const h = Math.max(6.5, meas(t, (isHead ? xw + 2 * sw : xw) - 4, 8, isHead ? "bold" : "normal") + 2.6); need(h);
    box(X, y, cw, h); txt(c, X + 1.5, y + 1.3, cw - 3, 8, "bold");
    if (isHead) { box(X + cw, y, W - cw, h); txt(t, X + cw + 2, y + 1.3, W - cw - 4, 8, "bold"); }
    else {
      box(X + cw, y, xw, h); box(X + cw + xw, y, sw, h); box(X + cw + xw + sw, y, sw, h); txt(t, X + cw + 2, y + 1.3, xw - 4, 8);
      tick(X + cw + xw + sw / 2 - 1.8, y + h / 2 - 1.8, v.esiti?.[k] === "si"); tick(X + cw + xw + sw + sw / 2 - 1.8, y + h / 2 - 1.8, v.esiti?.[k] === "no");
    }
    y += h;
  };
  sec("1.0 Esame preliminare");
  row("1.1", TX.p11[0], "p11"); row("", TX.p12[0], "p12");
  row("", TX.p13[0] + (v.tipoSigillo ? `   [rilevato: ${v.tipoSigillo}. ${SIGILLI[v.tipoSigillo]}]` : ""), "p13");
  sec(v.tipo === "privo" ? "2.0 In caso di esito negativo del Test 1.1 - punto Tipo Sigillo: Registratore Telematico privo di sigillo" : "2.0 In caso di esito positivo del Test 1.1 - punto Tipo Sigillo: Registratore Telematico con sigillo integro");
  for (const t of buildTests(v.tipo)) {
    let tt = t.t;
    if (t.k === "fw") tt = `Identificazione della versione firmware installata e verifica corrispondenza sul QR Code (ove riportata): ${v.fwPresente || "________"}\nAggiornamento all'ultima versione disponibile del Firmware RT: ${v.fwAggiornato || (v.fwPresente ? "già all'ultima versione" : "________")}`;
    row(t.c, tt, t.k, t.head);
  }
  y += 3;
  const cells = (arr, h = 7, fs = 8, st = "normal") => { need(h); let x = X; for (const [w, t, s] of arr) { box(x, y, w, h); txt(t || "", x + 1.5, y + 1.4, w - 3, fs, s || st); x += w; } y += h; };
  const c6 = W / 6;
  cells([[c6, "Inizio Intervento", "bold"], [c6, "Data: " + fmtD(v.data)], [c6, "Ora: " + (v.oraInizio || "")], [c6, "Fine Intervento", "bold"], [c6, "Data: " + fmtD(v.dataFine || v.data)], [c6, "Ora: " + (v.oraFine || "")]]);
  cells([[c6, "Firmware presente", "bold"], [c6, "Versione", "bold"], [c6, "Data", "bold"], [c6, "Dati registrati in memoria", "bold"], [c6, "P.I. Laboratorio", "bold"], [c6, "C.F. Tecnico", "bold"]], 8, 7.5);
  cells([[c6, ""], [c6, v.fwAggiornato || v.fwPresente || ""], [c6, fmtD(v.fwAggiornato ? v.dataFine || v.data : v.fwData)], [c6, v.esiti?.reg === "si" ? "SI" : v.esiti?.reg === "no" ? "NO" : ""], [c6, L.piva], [c6, L.cfTecnico]], 7, 8.5, "bold");
  cells([[c6 * 2, "Luogo e data", "bold"], [c6 * 4, `${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`]]);
  const es = v.esito === "positivo" ? `ESITO POSITIVO - prossima verificazione entro il ${fmtD(addYears(v.data, 2))}` : v.esito === "negativo" ? "ESITO NEGATIVO" : "ESITO NON DETERMINATO";
  cells([[W, es, "bold"]], 7, 9.5);
  const sh = 30; need(sh); box(X, y, W / 2, sh); box(X + W / 2, y, W / 2, sh);
  txt(`Tecnico Abilitato (Cognome, Nome, Cod. Fiscale, Sigillo)\n${L.tecnico}  ${L.cfTecnico}  ${L.sigillo}`, X + 2, y + 1.5, W / 2 - 4, 7.5);
  txt(`L'Utente (Cognome, Nome, Qualifica presso l'utente)\n${v.utenteNome || ""}${v.utenteQualifica ? " - " + v.utenteQualifica : ""}`, X + W / 2 + 2, y + 1.5, W / 2 - 4, 7.5);
  const img = (url, x, bw = W / 2) => { if (!url) return; try { const p = d.getImageProperties(url); const mh = 17, mw = bw - 10; let w = mw, h = p.height * w / p.width; if (h > mh) { h = mh; w = p.width * h / p.height; } d.addImage(url, "PNG", x + (bw - w) / 2, y + sh - h - 1.5, w, h); } catch { } };
  img(firmaT, X);
  // con il timbro: timbro a sinistra nel riquadro dell'utente, firma a destra (la firma ha lo sfondo bianco e lo coprirebbe)
  const tb = timbro ? fitImg(d, timbro, X + W / 2 + 2, y + 9, 50, sh - 10.5) : null;
  if (tb) img(firmaU, X + W / 2 + tb.w + 2, W / 2 - tb.w - 2); else img(firmaU, X + W / 2);
  return d;
}

function pdfDich(v, firmaU, firmaT, timbro) {
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit: "mm", format: "a4" }); const L = labFor(v); const X = 22, W = 166; let y = 26;
  const t = (s, fs = 11, st = "normal", align = "left", w = W, x = X) => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), w); d.text(lines, align === "center" ? x + w / 2 : x, y, { align }); y += lines.length * LH(fs) + 1.5; };
  t("DICHIARAZIONE", 15, "bold", "center"); t("resa conformemente all'art. 47 del decreto del Presidente della Repubblica 28 dicembre 2000, n. 445 e successive modificazioni", 10, "normal", "center"); y += 6;
  const ut = v.dichiarante === "utente";
  const rows = ut ? [["Il sottoscritto:", v.utenteNome || ""], ["in qualità di:", v.utenteQualifica || ""], ["della Ditta:", v.cli?.ragione || ""], ["", v.cli?.domicilio || ""], ["Partita I.V.A.:", v.cli?.piva || ""]]
    : [["Il sottoscritto:", L.tecnico], ["in qualità di:", "Tecnico"], ["della Ditta:", L.ragione], ["", `${L.indirizzo} - ${L.cap} - P.I. ${L.piva}`], ["Codice Fiscale:", L.cfTecnico], ["Partita I.V.A.:", L.piva]];
  for (const [a, b] of rows) { d.setFont("helvetica", "normal"); d.setFontSize(11); d.text(a, X, y); d.setFont("helvetica", "bold"); const bl = d.splitTextToSize(clean(b), W - 40); d.text(bl, X + 40, y); y += 7 + (bl.length - 1) * LH(11); }
  y += 2; t(`relativamente al Registratore Telematico ${v.app?.modello || ""} matricola ${v.app?.matricola || ""}, installato presso ${v.cli?.ragione || ""}, ${[v.app?.indirizzo, v.app?.localita].filter(Boolean).join(" ")}`, 11);
  y += 2; t("consapevole delle sanzioni penali stabilite dall'articolo 76 del decreto sopra citato per le ipotesi di falsità in atti e dichiarazioni mendaci,", 11);
  y += 3; t("dichiara", 13, "bold", "center"); y += 3;
  t("-  che il Registratore Telematico, nei suoi componenti hardware e software, non ha subito alterazioni rispetto al corrispondente modello regolarmente approvato;", 11);
  t("-  che il Registratore Telematico è stato aggiornato all'ultima versione Firmware disponibile alla data" + (v.fwAggiornato || v.fwPresente ? ` (versione ${v.fwAggiornato || v.fwPresente})` : "") + ";", 11);
  t("-  che l'assenza del sigillo fiscale è dovuta a:", 11);
  d.setDrawColor(120); const mot = d.splitTextToSize(clean(v.motivoSigillo || ""), W - 6);
  for (let i = 0; i < Math.max(3, mot.length); i++) { if (mot[i]) { d.setFont("helvetica", "bold"); d.text(mot[i], X + 3, y + 5); } d.line(X, y + 6.5, X + W, y + 6.5); y += 8; }
  y += 12; d.setFont("helvetica", "normal"); d.setFontSize(11);
  d.text("Luogo e Data:", X + 60, y); d.setFont("helvetica", "bold"); d.text(clean(`${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`), X + 92, y); y += 25; // spazio per la firma (alta fino a 20 mm) senza coprire «Luogo e Data»
  d.setFont("helvetica", "normal"); d.text("Firma leggibile:", X + 60, y); d.line(X + 92, y + 1, X + W, y + 1);
  const url = ut ? firmaU : firmaT;
  if (url) { try { const p = d.getImageProperties(url); let h = 20, w = p.width * h / p.height; if (w > 70) { w = 70; h = p.height * w / p.width; } d.addImage(url, "PNG", X + 94, y - h + 0.5, w, h); } catch { } }
  if (ut && timbro) fitImg(d, timbro, X, y - 24, 56, 24);
  return d;
}

function pdfThermal(v, firmaU, firmaT, timbro, coda) {
  const { jsPDF } = window.jspdf; const L = labFor(v);
  const B = !!v.bianco, u = (x, n = 22) => (B ? "_".repeat(n) : x), box = "[  ] SI  [  ] NO"; // B = modulo in bianco da compilare a mano
  const run = (d) => {
    const X = 4, W = 72; let y = 5;
    // caratteri ingranditi del 25% (K) rispetto alla prima versione: sulla termica 203 dpi il testo piccolo esce sottile e sbiadito
    const K = 1.25, setFs = d.setFontSize.bind(d); d.setFontSize = (n) => setFs(n * K);
    const t = (s, fs = 8, st = "normal", align = "left") => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), W); d.text(lines, align === "center" ? X + W / 2 : X, y + LH(fs * K) * 0.8, { align }); y += lines.length * LH(fs * K) + 0.7; };
    const lr = (a, b, fs = 7.5, st = "bold") => { d.setFont("helvetica", st); d.setFontSize(fs); const bw = d.getTextWidth(clean(b)); d.setFont("helvetica", "normal"); const la = d.splitTextToSize(clean(a), Math.max(20, W - bw - 2)); d.text(la, X, y + LH(fs * K) * 0.8); d.setFont("helvetica", st); d.text(clean(b), X + W, y + LH(fs * K) * 0.8, { align: "right" }); y += la.length * LH(fs * K) + 0.9; };
    const sep = () => { d.setLineDashPattern([1, 0.8], 0); d.setLineWidth(0.3); d.line(X, y + 1, X + W, y + 1); d.setLineDashPattern([], 0); y += 2.6; };
    t(L.ragione, 10, "bold", "center"); t(`${L.indirizzo || ""} ${L.cap || ""}`, 7.5, "normal", "center"); if (L.piva) t(`P.I. ${L.piva}`, 7.5, "normal", "center"); sep();
    t("RAPPORTO DI VERIFICAZIONE PERIODICA RT", 8.5, "bold", "center"); t(v.tipo === "privo" ? "PRIVO DI SIGILLO FISCALE" : "CON SIGILLO FISCALE INTEGRO", 8, "bold", "center");
    t("(Provv. A.E. 28/07/2003 e 28/10/2016)", 6.5, "normal", "center"); t(`N. ${u(v.numero || "", 14)}`, 8, "bold", "center"); sep();
    if (B) {
      // etichetta e riga da compilare fino al bordo destro
      const riga = (l) => { y += 3.6; d.setFont("helvetica", "normal"); d.setFontSize(7.5); if (l) d.text(l, X, y); const x0 = l ? X + d.getTextWidth(l) + 1.5 : X; d.setLineWidth(0.3); d.line(x0, y + 0.6, X + W, y + 0.6); y += 2.6; };
      t("ESERCENTE", 7, "bold"); riga("Ragione sociale"); riga("Domicilio"); riga("P.IVA"); y += 1;
      t("UBICAZIONE", 7, "bold"); riga(""); y += 1;
      t("APPARECCHIO", 7, "bold"); riga("Marchio/Modello"); riga("Matricola"); y += 1;
      t("Intervento:", 7, "bold"); for (let i = 0; i < INTERVENTI.length; i += 3) t(INTERVENTI.slice(i, i + 3).map(([, l]) => "[  ] " + l).join("    "), 7.5); sep();
    } else {
    t("ESERCENTE", 7, "bold"); t(v.cli?.ragione || "", 8, "bold"); if (v.cli?.domicilio) t(v.cli.domicilio, 7.5); t(`P.IVA ${v.cli?.piva || ""}`, 7.5);
    t("UBICAZIONE", 7, "bold"); t([v.app?.indirizzo, v.app?.localita].filter(Boolean).join(" - ") || "-", 7.5);
    t("APPARECCHIO", 7, "bold"); t(v.app?.modello || "", 7.5); t(`Matricola ${v.app?.matricola || ""}`, 8, "bold");
    t("Intervento: " + INTERVENTI.filter(([k]) => v.interventi?.[k]).map(([, l]) => l).join(", "), 7.5); sep();
    }
    const val = (k) => B ? box : v.esiti?.[k] === "si" ? "SI" : v.esiti?.[k] === "no" ? "NO" : "-";
    t("1.0 ESAME PRELIMINARE", 7.5, "bold");
    PRE.forEach((p) => lr(`${p.c || "   "} ${TX[p.k][1]}`, val(p.k)));
    if (B) { t("Tipo sigillo:", 7, "bold"); Object.entries(SIGILLI).forEach(([k, l]) => t(`[  ] ${k}. ${l}`, 7)); }
    else if (v.tipoSigillo) t(`Tipo sigillo: ${v.tipoSigillo}. ${SIGILLI[v.tipoSigillo]}`, 7);
    t(v.tipo === "privo" ? "2.0 RT PRIVO DI SIGILLO" : "2.0 RT CON SIGILLO INTEGRO", 7.5, "bold");
    for (const x of buildTests(v.tipo)) { if (x.head) t(`${x.c} ${x.s}`, 7, "bold"); else lr(`${x.c} ${x.s}`, val(x.k)); }
    sep();
    if (B) y += 1;
    lr("Firmware presente", u(v.fwPresente || "-"), 7.5); if (B || v.fwAggiornato) { if (B) y += 1; lr("Aggiornato a", u(v.fwAggiornato)); }
    if (B) y += 1; lr("Inizio", B ? "___/___/______  ___:___" : `${fmtD(v.data)} ${v.oraInizio || ""}`, 7.5);
    if (B) y += 1; lr("Fine", B ? "___/___/______  ___:___" : `${fmtD(v.dataFine || v.data)} ${v.oraFine || ""}`, 7.5);
    lr("P.I. Laboratorio", L.piva || u(""), 7.5); if (B) y += 1; lr("C.F. Tecnico", L.cfTecnico || u(""), 7.5); sep();
    if (B) { t("ESITO:  [  ] POSITIVO   [  ] NEGATIVO", 8.5, "bold", "center"); y += 1.5; t("Prossima verificazione entro il ___/___/______", 7.5, "normal", "center"); }
    else {
    t(v.esito === "positivo" ? "ESITO POSITIVO" : v.esito === "negativo" ? "ESITO NEGATIVO" : "ESITO NON DETERMINATO", 12, "bold", "center");
    if (v.esito === "positivo") t(`Prossima verificazione entro il ${fmtD(addYears(v.data, 2))}`, 8, "bold", "center");
    }
    sep();
    if (B) { y += 3; d.setFont("helvetica", "normal"); d.setFontSize(7.5); d.text("Luogo e data", X, y); d.line(X + d.getTextWidth("Luogo e data") + 1.5, y + 0.6, X + W, y + 0.6); y += 4; }
    else t(`${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`, 7.5);
    const sig = (label, url, who) => { t(label, 7, "bold"); if (url) { try { const p = d.getImageProperties(url); let w = 50, h = p.height * w / p.width; if (h > 20) { h = 20; w = p.width * h / p.height; } d.addImage(url, "PNG", X + (W - w) / 2, y, w, h); y += h + 1; } catch { } } else y += 12; d.line(X + 6, y, X + W - 6, y); y += 1.2; t(who, 7, "normal", "center"); };
    sig("Tecnico abilitato", firmaT, B ? "Cognome, nome, C.F., sigillo" : `${L.tecnico} - ${L.cfTecnico} - ${L.sigillo}`);
    sig("L'utente", firmaU, B ? "Cognome, nome, qualifica - timbro" : `${v.utenteNome || ""}${v.utenteQualifica ? " - " + v.utenteQualifica : ""}`);
    if (B) y += 18; // spazio per il timbro a mano
    if (timbro) { y += 1.5; let w = W - 20, h = timbro.h * w / timbro.w; if (h > 30) { h = 30; w = timbro.w * h / timbro.h; } try { d.addImage(timbro.url, "PNG", X + (W - w) / 2, y, w, h); y += h; } catch { } }
    if (coda) y = coda(d, X, W, y);
    return y + 8;
  };
  const tmp = new jsPDF({ unit: "mm", format: [80, 2000] }); const h = run(tmp);
  const d = new jsPDF({ unit: "mm", format: [80, Math.max(100, Math.ceil(h))] }); run(d); return d;
}

/* ---------------- Stampa diretta su termica (ESC/POS) ----------------
   Stesso contenuto del PDF 80 mm, ma come comandi ESC/POS: testo nativo della stampante (nitido e veloce anche via
   Bluetooth) e firme/timbro come immagini raster. carta: 80 mm = 48 colonne e 576 punti, 58 mm = 32 colonne e 384 punti. */
const ESC_CARTA = { 80: { cols: 48, dots: 576 }, 58: { cols: 32, dots: 384 } };
// velocità della testina (ESC 7 n1 n2 n3: punti scaldati insieme, tempo e pausa di riscaldamento, comando delle stampantine
// cinesi tipo MTP/Xprinter; chi non lo conosce lo ignora): più lenta = stampa più scura e uniforme. «normale» non manda niente.
function escCalore(vel = (typeof btPref === "function" ? btPref().velocita : "normale")) {
  return vel === "molto" ? [0x1b, 0x37, 5, 200, 8] : vel === "lenta" ? [0x1b, 0x37, 7, 140, 4] : [];
}
// le stampantine non hanno una tabella caratteri comune: si stampa solo ASCII (à -> a', € -> EUR)
const escAscii = (s) => clean(s).replace(/[àáÀÁèéÈÉìíÌÍòóÒÓùúÙÚ]/g, (c) => c.normalize("NFD")[0] + "'").replace(/Euro +/g, "EUR ")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/°/g, "o").replace(/[^\x20-\x7e\n]/g, "?");
function escWrap(s, cols) {
  const out = [];
  for (const par of escAscii(s).split("\n")) {
    let line = ""; for (const w of par.split(/ +/)) {
      if (!line) line = w; else if ((line + " " + w).length <= cols) line += " " + w; else { out.push(line); line = w; }
      while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); }
    }
    out.push(line);
  }
  return out;
}
// immagine (data URL) -> comandi GS v 0 a strisce, bianco/nero a soglia; maxDots = larghezza massima in punti
function escImage(url, maxDots, maxH = 400) {
  return new Promise((res) => {
    if (!url) return res(null);
    const im = new Image();
    im.onload = () => {
      let w = Math.min(maxDots, im.width * 2), h = Math.round(im.height * w / im.width); if (h > maxH) { h = maxH; w = Math.round(im.width * h / im.height); }
      w = Math.max(8, Math.floor(w / 8) * 8);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data, bw = w / 8, out = [];
      for (let y0 = 0; y0 < h; y0 += 128) {
        const bh = Math.min(128, h - y0), band = new Uint8Array(8 + bw * bh);
        band.set([0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, bh & 255, bh >> 8]);
        for (let y = 0; y < bh; y++) for (let x = 0; x < w; x++) {
          const i = ((y0 + y) * w + x) * 4, lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum < 150) band[8 + y * bw + (x >> 3)] |= 0x80 >> (x & 7);
        }
        out.push(band);
      }
      res(out);
    };
    im.onerror = () => res(null); im.src = url;
  });
}
async function escposRapporto(v, firmaU, firmaT, timbro, carta = 80, taglia = true) {
  const { cols, dots } = ESC_CARTA[carta] || ESC_CARTA[80]; const L = labFor(v);
  const B = !!v.bianco; // modulo in bianco da compilare a mano
  const parts = []; const raw = (...b) => parts.push(Uint8Array.from(b.flat()));
  const enc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0x7f));
  const align = (n) => raw(0x1b, 0x61, n), bold = (on) => raw(0x1b, 0x45, on ? 1 : 0), size = (n) => raw(0x1d, 0x21, n);
  const line = (s) => { parts.push(enc(s)); raw(0x0a); };
  const t = (s, { b = false, c = false, big = false } = {}) => { if (!s) return; align(c ? 1 : 0); bold(b); if (big) size(0x11); escWrap(s, big ? Math.floor(cols / 2) : cols).forEach(line); if (big) size(0); bold(false); };
  const lr = (a, b) => { align(0); const bb = escAscii(b); const la = escWrap(a, cols - bb.length - 1); la.forEach((x, i) => line(i === la.length - 1 ? x + " ".repeat(Math.max(1, cols - x.length - bb.length)) + bb : x)); };
  const sep = () => { align(0); line("-".repeat(cols)); };
  const img = async (url, maxDots, maxH) => { const r = await escImage(url, maxDots, maxH); if (r) { align(1); r.forEach((x) => parts.push(x)); raw(0x0a); } return !!r; };
  raw(0x1b, 0x40); raw(0x1b, 0x74, 0x00); raw(...escCalore());
  t(L.ragione, { b: true, c: true }); t(`${L.indirizzo || ""} ${L.cap || ""}`.trim(), { c: true }); if (L.piva) t(`P.I. ${L.piva}`, { c: true }); sep();
  t("RAPPORTO DI VERIFICAZIONE PERIODICA RT", { b: true, c: true }); t(v.tipo === "privo" ? "PRIVO DI SIGILLO FISCALE" : "CON SIGILLO FISCALE INTEGRO", { b: true, c: true });
  const campo = (l) => { raw(0x0a); align(0); line((l ? l + " " : "") + "_".repeat(Math.max(4, cols - (l ? l.length + 1 : 0)))); };
  t("(Provv. A.E. 28/07/2003 e 28/10/2016)", { c: true }); t(`N. ${B ? "______________" : v.numero || ""}`, { b: true, c: true }); sep();
  if (B) {
    t("ESERCENTE", { b: true }); campo("Ragione sociale"); campo("Domicilio"); campo("P.IVA");
    raw(0x0a); t("UBICAZIONE", { b: true }); campo("");
    raw(0x0a); t("APPARECCHIO", { b: true }); campo("Marchio/Modello"); campo("Matricola");
    raw(0x0a); t("Intervento:", { b: true });
    { let r = ""; for (const [, l] of INTERVENTI) { const it = "[ ] " + l; if (r && (r + "  " + it).length > cols) { line(r); r = it; } else r = r ? r + "  " + it : it; } if (r) line(r); }
    sep();
  } else {
  t("ESERCENTE", { b: true }); t(v.cli?.ragione || ""); if (v.cli?.domicilio) t(v.cli.domicilio); t(`P.IVA ${v.cli?.piva || ""}`);
  t("UBICAZIONE", { b: true }); t([v.app?.indirizzo, v.app?.localita].filter(Boolean).join(" - ") || "-");
  t("APPARECCHIO", { b: true }); t(v.app?.modello || ""); t(`Matricola ${v.app?.matricola || ""}`, { b: true });
  t("Intervento: " + INTERVENTI.filter(([k]) => v.interventi?.[k]).map(([, l]) => l).join(", ")); sep();
  }
  const val = (k) => B ? "[ ]SI [ ]NO" : v.esiti?.[k] === "si" ? "SI" : v.esiti?.[k] === "no" ? "NO" : "-";
  t("1.0 ESAME PRELIMINARE", { b: true });
  PRE.forEach((p) => lr(`${p.c || "   "} ${TX[p.k][1]}`, val(p.k)));
  if (B) { t("Tipo sigillo:"); Object.entries(SIGILLI).forEach(([k, l]) => t(`[ ] ${k}. ${l}`)); }
  else if (v.tipoSigillo) t(`Tipo sigillo: ${v.tipoSigillo}. ${SIGILLI[v.tipoSigillo]}`);
  t(v.tipo === "privo" ? "2.0 RT PRIVO DI SIGILLO" : "2.0 RT CON SIGILLO INTEGRO", { b: true });
  for (const x of buildTests(v.tipo)) { if (x.head) t(`${x.c} ${x.s}`, { b: true }); else lr(`${x.c} ${x.s}`, val(x.k)); }
  sep();
  if (B) {
    campo("Firmware presente"); campo("Aggiornato a"); raw(0x0a); line("Inizio  ___/___/______  ___:___"); raw(0x0a); line("Fine    ___/___/______  ___:___");
    if (L.piva) lr("P.I. Laboratorio", L.piva); else campo("P.I. Laboratorio"); campo("C.F. Tecnico"); sep();
    raw(0x0a); t("ESITO:  [ ] POSITIVO   [ ] NEGATIVO", { b: true, c: true }); raw(0x0a); t("Prossima verificazione entro ___/___/______", { c: true });
    sep(); campo("Luogo e data");
  } else {
  lr("Firmware presente", v.fwPresente || "-"); if (v.fwAggiornato) lr("Aggiornato a", v.fwAggiornato);
  lr("Inizio", `${fmtD(v.data)} ${v.oraInizio || ""}`.trim()); lr("Fine", `${fmtD(v.dataFine || v.data)} ${v.oraFine || ""}`.trim());
  lr("P.I. Laboratorio", L.piva || ""); lr("C.F. Tecnico", L.cfTecnico || ""); sep();
  t(v.esito === "positivo" ? "ESITO POSITIVO" : v.esito === "negativo" ? "ESITO NEGATIVO" : "ESITO NON DETERMINATO", { b: true, c: true, big: true });
  if (v.esito === "positivo") t(`Prossima verificazione entro il ${fmtD(addYears(v.data, 2))}`, { b: true, c: true });
  sep(); t(`${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`);
  }
  const sig = async (label, url, who) => { raw(0x0a); t(label, { b: true }); if (!(await img(url, Math.round(dots * 0.7), 200))) raw(0x0a, 0x0a, 0x0a); align(1); line("_".repeat(Math.round(cols * 0.8))); t(who, { c: true }); };
  await sig("Tecnico abilitato", firmaT, B ? "Cognome, nome, C.F., sigillo" : `${L.tecnico} - ${L.cfTecnico} - ${L.sigillo}`);
  await sig("L'utente", firmaU, B ? "Cognome, nome, qualifica - timbro" : `${v.utenteNome || ""}${v.utenteQualifica ? " - " + v.utenteQualifica : ""}`);
  if (B) raw(0x1b, 0x64, 8); // spazio per il timbro a mano
  if (timbro?.url) { raw(0x0a); await img(timbro.url, Math.round(dots * 0.8), 260); }
  align(0); if (taglia) { raw(0x1b, 0x64, 5); raw(0x1d, 0x56, 0x42, 0x00); } // avanza e taglia (chi non ha la taglierina lo ignora)
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------------- Prova di stampa termica: scheda di verifica in bianco ----------------
   Il rapporto 80 mm vuoto, con caselle SI/NO e righe da compilare a mano, seguito da un piccolo controllo della larghezza
   (righello di colonne e barra nera a tutta carta: 576 punti = 72 mm per l'80 mm, 384 = 48 mm per il 58 mm).
   Serve sia come modulo cartaceo sia per capire se stampante, collegamento o driver di Windows stampano giusto. */
const vBianco = (tipo, L) => ({ bianco: true, tipo: tipo === "privo" ? "privo" : "integro", lab: L || {}, tecnico: {}, esiti: {} });
function barraRaster(larghezza, alto) {
  const bw = Math.ceil(larghezza / 8), out = new Uint8Array(8 + bw * alto).fill(0xff);
  out.set([0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, alto & 255, alto >> 8]);
  return out;
}
async function escposSchedaBianca(carta = 80, tipo = "integro", L = {}) {
  const { cols, dots } = ESC_CARTA[carta] || ESC_CARTA[80];
  const corpo = await escposRapporto(vBianco(tipo, L), "", "", null, carta, false);
  const parts = [corpo]; const raw = (...b) => parts.push(Uint8Array.from(b.flat()));
  const line = (s) => { parts.push(Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0x7f))); raw(0x0a); };
  raw(0x1b, 0x61, 0); raw(0x0a); line("-".repeat(cols));
  escWrap(`Controllo stampa: carta ${carta} mm, ${cols} colonne, ${dots} punti`, cols).forEach(line);
  line("1234567890".repeat(Math.ceil(cols / 10)).slice(0, cols));
  parts.push(barraRaster(dots, 12)); raw(0x0a);
  escWrap("Righello su una riga e barra intera: larghezza giusta", cols).forEach(line);
  raw(0x1b, 0x64, 5); raw(0x1d, 0x56, 0x42, 0x00);
  const tot = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(tot); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// la stessa scheda in PDF 80 mm (da stampare da Windows col driver POS80, o da un'app), con righello in mm in fondo
function pdfSchedaBianca(tipo = "integro", L = {}) {
  return pdfThermal(vBianco(tipo, L), "", "", null, (d, X, W, y) => {
    y += 4; d.setLineDashPattern([0.8, 0.8], 0); d.line(X, y, X + W, y); d.setLineDashPattern([], 0); y += 3;
    d.setFont("helvetica", "normal"); d.setFontSize(6.5); d.text(`Controllo: righello ${W} mm e barra intera`, X, y + 2); y += 4;
    d.setLineWidth(0.2); d.line(X, y + 4, X + W, y + 4);
    for (let mm = 0; mm <= W; mm++) { const h = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.3; d.line(X + mm, y + 4 - h, X + mm, y + 4); if (mm % 10 === 0) { d.setFontSize(5.5); d.text(String(mm), Math.min(X + mm, X + W - 1.5), y + 6.6, { align: "center" }); } }
    y += 8; d.setFillColor(0); d.rect(X, y, W, 3, "F"); return y + 3;
  });
}

/* Elenco «Aggiornamenti software» (A4, stesso stile del rapporto: Helvetica, riquadri a filo) */
function pdfAggiornamenti(rows, L, titolo) {
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit: "mm", format: "a4" });
  const M = 12, W = 210 - 2 * M, X = M; let y = M;
  const txt = (s, x, yy, w, fs = 8, st = "normal", align = "left") => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), w); d.text(lines, align === "center" ? x + w / 2 : x, yy + LH(fs) * 0.8, { align }); return lines.length * LH(fs); };
  const meas = (s, w, fs = 8, st = "normal") => { d.setFont("helvetica", st); d.setFontSize(fs); return d.splitTextToSize(clean(s), w).length * LH(fs); };
  d.setLineWidth(0.2); d.setDrawColor(40);
  const lw = 62, tw = W - lw;
  const labTxt = [L.ragione, L.indirizzo, L.cap, L.piva ? "P.I. " + L.piva : "", L.telefono ? "Tel. " + L.telefono : ""].filter(Boolean).join("\n");
  const sub = `Situazione al ${fmtD(todayISO())} - ${rows.length} ${rows.length === 1 ? "cliente" : "clienti"}`;
  const hh = Math.max(meas(labTxt, lw - 4, 9, "bold"), meas(titolo.toUpperCase(), tw - 4, 10.5, "bold") + LH(8) + 2) + 6;
  d.rect(X, y, lw, hh); d.rect(X + lw, y, tw, hh);
  txt(labTxt, X + 2, y + 3, lw - 4, 9, "bold");
  const th = txt(titolo.toUpperCase(), X + lw + 2, y + 3, tw - 4, 10.5, "bold", "center");
  txt(sub, X + lw + 2, y + 4 + th, tw - 4, 8, "normal", "center");
  y += hh + 4;
  const cols = [["Cliente", 60], ["Software", 32], ["Stato", 26], ["Data", 18], ["Motivo / note", W - 136]];
  const header = () => { let x = X; for (const [l, w] of cols) { d.setFillColor(235); d.rect(x, y, w, 7, "FD"); txt(l, x + 1.5, y + 1.6, w - 3, 8, "bold"); x += w; } y += 7; };
  header();
  if (!rows.length) { d.rect(X, y, W, 8); txt("Nessun cliente.", X + 2, y + 2, W - 4, 8.5); y += 8; }
  for (const { c, st } of rows) {
    const a = c.aggSw || {};
    const cells = [
      [[c.ragione || "", "bold", 8.5], [[c.piva ? "P.IVA " + c.piva : "", c.telefono ? "Tel. " + c.telefono : ""].filter(Boolean).join(" - "), "normal", 7.5]],
      [[c.software || "non indicato", "normal", 8]],
      [[st.txt, "bold", 8]],
      [[st.k === "da_fare" ? "" : fmtD(a.data), "normal", 8]],
      [[[st.k === "non_installabile" ? st.det : "", st.k === "aggiornato" && a.da ? "Da " + a.da : "", a.note || ""].filter(Boolean).join(". "), "normal", 7.5]],
    ];
    const hs = cells.map((parts, i) => parts.reduce((h, [s, stl, fs]) => h + (s ? meas(s, cols[i][1] - 3, fs, stl) : 0), 0));
    const h = Math.max(7, Math.max(...hs) + 3);
    if (y + h > 297 - M) { d.addPage(); y = M; header(); }
    let x = X;
    cells.forEach((parts, i) => { const w = cols[i][1]; d.rect(x, y, w, h); let yy = y + 1.4; for (const [s, stl, fs] of parts) if (s) yy += txt(s, x + 1.5, yy, w - 3, fs, stl); x += w; });
    y += h;
  }
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) { d.setPage(i); d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(110); d.text(`BluCheck - pagina ${i} di ${n}`, 210 - M, 297 - 6, { align: "right" }); d.setTextColor(0); }
  return d;
}

/* Planning (sezione «Planning» di app.js): A4 con un blocco per giorno e una riga per cliente, caselle da spuntare. */
function pdfPlanning({ p, righe, daFissare }, L, titolo) {
  const { jsPDF } = window.jspdf; const d = new jsPDF({ unit: "mm", format: "a4" });
  const M = 12, W = 210 - 2 * M, X = M; let y = M;
  const txt = (s, x, yy, w, fs = 8, st = "normal", align = "left") => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), w); d.text(lines, align === "center" ? x + w / 2 : x, yy + LH(fs) * 0.8, { align }); return lines.length * LH(fs); };
  const meas = (s, w, fs = 8, st = "normal") => { d.setFont("helvetica", st); d.setFontSize(fs); return d.splitTextToSize(clean(s), w).length * LH(fs); };
  d.setLineWidth(0.2); d.setDrawColor(40);
  const lw = 62, tw = W - lw;
  const labTxt = [L.ragione, L.indirizzo, L.cap, L.piva ? "P.I. " + L.piva : "", L.telefono ? "Tel. " + L.telefono : ""].filter(Boolean).join("\n");
  const nLav = righe.reduce((n, g) => n + g.lavori.length, 0) + daFissare.length;
  const sub = `Stampato il ${fmtD(todayISO())} - ${nLav} ${nLav === 1 ? "lavoro" : "lavori"}`;
  const hh = Math.max(meas(labTxt, lw - 4, 9, "bold"), meas(titolo.toUpperCase(), tw - 4, 10.5, "bold") + LH(8) + 2) + 6;
  d.rect(X, y, lw, hh); d.rect(X + lw, y, tw, hh);
  txt(labTxt, X + 2, y + 3, lw - 4, 9, "bold");
  const th = txt(titolo.toUpperCase(), X + lw + 2, y + 3, tw - 4, 10.5, "bold", "center");
  txt(sub, X + lw + 2, y + 4 + th, tw - 4, 8, "normal", "center");
  y += hh + 4;
  const cols = [["Cliente", 62], ["Dove", 46], ["Lavori da fare", W - 108 - 14], ["Fatto", 14]];
  const header = () => { let x = X; for (const [l, w] of cols) { d.setFillColor(235); d.rect(x, y, w, 6.5, "FD"); txt(l, x + 1.5, y + 1.4, w - 3, 8, "bold"); x += w; } y += 6.5; };
  const titoloGiorno = (s) => { if (y + 6.5 + 7 + 10 > 297 - M) { d.addPage(); y = M; } d.setFillColor(215); d.rect(X, y, W, 7, "FD"); txt(s, X + 2, y + 1.7, W - 4, 9, "bold"); y += 7; header(); };
  const giornoTxt = (iso) => { const [yy, mm, dd] = iso.split("-").map(Number); const g = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"][new Date(yy, mm - 1, dd).getDay()]; return `${g} ${fmtD(iso)}`; };
  const appTxt = (a) => (a.modello || a.matricola ? `${a.modello || ""}${a.matricola ? " mat. " + a.matricola : ""}`.trim() : "registratore da completare");
  const riga = (cells) => {
    const hs = cells.map((parts, i) => parts.reduce((h, [s, stl, fs]) => h + (s ? meas(s, cols[i][1] - 3, fs, stl) : 0), 0));
    const h = Math.max(8, Math.max(...hs) + 3);
    if (y + h > 297 - M) { d.addPage(); y = M; header(); }
    let x = X;
    cells.forEach((parts, i) => { const w = cols[i][1]; d.rect(x, y, w, h); let yy = y + 1.4; for (const [s, stl, fs] of parts) if (s) yy += txt(s, x + 1.5, yy, w - 3, fs, stl); x += w; });
    d.rect(X + W - 14 + 4.5, y + h / 2 - 2.5, 5, 5);
    y += h;
  };
  const cliente = (g) => {
    const dove = [...new Set(g.lavori.filter((l) => l.a).map((l) => [l.a.indirizzo, l.a.localita].filter(Boolean).join(", ")).filter(Boolean))].join("; ") || g.c?.domicilio || "";
    const lav = g.lavori.map((l) => (l.tipo === "SW" ? `Aggiornamento software${g.c?.software ? " (" + g.c.software + ")" : ""}` : `${l.tipo === "VP" ? "Verificazione periodica" : "DGFE"} - ${appTxt(l.a)}${g.arretrato ? " - scaduta il " + fmtD(l.data) : ""}`)).join("\n");
    riga([[[g.c?.ragione || "Cliente non indicato", "bold", 8.5], [g.c?.telefono ? "Tel. " + g.c.telefono : "", "normal", 7.5]], [[dove, "normal", 7.5]], [[lav, "normal", 8]], []]);
  };
  const arr = righe.filter((g) => g.arretrato), nel = righe.filter((g) => !g.arretrato);
  if (arr.length) { titoloGiorno(`Arretrati: scaduti prima del ${fmtD(p.da)}`); arr.forEach(cliente); y += 4; }
  let giorno = "";
  for (const g of nel) { if (g.data !== giorno) { if (giorno) y += 4; giorno = g.data; titoloGiorno(giornoTxt(giorno)); } cliente(g); }
  if (!nel.length) { d.rect(X, y, W, 8); txt("Nessuna scadenza nel periodo.", X + 2, y + 2, W - 4, 8.5); y += 8; }
  if (daFissare.length) {
    y += 4; titoloGiorno("Aggiornamenti software da fissare (clienti senza scadenze nel periodo)");
    for (const c of daFissare) riga([[[c.ragione || "", "bold", 8.5], [c.telefono ? "Tel. " + c.telefono : "", "normal", 7.5]], [[c.domicilio || "", "normal", 7.5]], [[`Aggiornamento software${c.software ? " (" + c.software + ")" : ""}`, "normal", 8]], []]);
  }
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) { d.setPage(i); d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(110); d.text(`BluCheck - pagina ${i} di ${n}`, 210 - M, 297 - 6, { align: "right" }); d.setTextColor(0); }
  return d;
}
