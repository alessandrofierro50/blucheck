"use strict";
/* BluCheck - lista di controllo e moduli PDF (A4, termico 80 mm, dichiarazione) */
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

function pdfA4(v, firmaU, firmaT) {
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
  const img = (url, x) => { if (!url) return; try { const p = d.getImageProperties(url); const mh = 17, mw = W / 2 - 10; let w = mw, h = p.height * w / p.width; if (h > mh) { h = mh; w = p.width * h / p.height; } d.addImage(url, "PNG", x + (W / 2 - w) / 2, y + sh - h - 1.5, w, h); } catch { } };
  img(firmaT, X); img(firmaU, X + W / 2);
  return d;
}

function pdfDich(v, firmaU, firmaT) {
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
  d.text("Luogo e Data:", X + 60, y); d.setFont("helvetica", "bold"); d.text(clean(`${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`), X + 92, y); y += 14;
  d.setFont("helvetica", "normal"); d.text("Firma leggibile:", X + 60, y); d.line(X + 92, y + 1, X + W, y + 1);
  const url = ut ? firmaU : firmaT;
  if (url) { try { const p = d.getImageProperties(url); let h = 20, w = p.width * h / p.height; if (w > 70) { w = 70; h = p.height * w / p.width; } d.addImage(url, "PNG", X + 94, y - h + 0.5, w, h); } catch { } }
  return d;
}

function pdfThermal(v, firmaU, firmaT) {
  const { jsPDF } = window.jspdf; const L = labFor(v);
  const run = (d) => {
    const X = 4, W = 72; let y = 5;
    const t = (s, fs = 8, st = "normal", align = "left") => { d.setFont("helvetica", st); d.setFontSize(fs); const lines = d.splitTextToSize(clean(s), W); d.text(lines, align === "center" ? X + W / 2 : X, y + LH(fs) * 0.8, { align }); y += lines.length * LH(fs) + 0.6; };
    const lr = (a, b, fs = 7.5, st = "bold") => { d.setFont("helvetica", "normal"); d.setFontSize(fs); const la = d.splitTextToSize(clean(a), W - 14); d.text(la, X, y + LH(fs) * 0.8); d.setFont("helvetica", st); d.text(clean(b), X + W, y + LH(fs) * 0.8, { align: "right" }); y += la.length * LH(fs) + 0.7; };
    const sep = () => { d.setLineDashPattern([0.8, 0.8], 0); d.setLineWidth(0.2); d.line(X, y + 1, X + W, y + 1); d.setLineDashPattern([], 0); y += 2.6; };
    t(L.ragione, 10, "bold", "center"); t(`${L.indirizzo || ""} ${L.cap || ""}`, 7.5, "normal", "center"); if (L.piva) t(`P.I. ${L.piva}`, 7.5, "normal", "center"); sep();
    t("RAPPORTO DI VERIFICAZIONE PERIODICA RT", 8.5, "bold", "center"); t(v.tipo === "privo" ? "PRIVO DI SIGILLO FISCALE" : "CON SIGILLO FISCALE INTEGRO", 8, "bold", "center");
    t("(Provv. A.E. 28/07/2003 e 28/10/2016)", 6.5, "normal", "center"); t(`N. ${v.numero || ""}`, 8, "bold", "center"); sep();
    t("ESERCENTE", 7, "bold"); t(v.cli?.ragione || "", 8, "bold"); if (v.cli?.domicilio) t(v.cli.domicilio, 7.5); t(`P.IVA ${v.cli?.piva || ""}`, 7.5);
    t("UBICAZIONE", 7, "bold"); t([v.app?.indirizzo, v.app?.localita].filter(Boolean).join(" - ") || "-", 7.5);
    t("APPARECCHIO", 7, "bold"); t(v.app?.modello || "", 7.5); t(`Matricola ${v.app?.matricola || ""}`, 8, "bold");
    t("Intervento: " + INTERVENTI.filter(([k]) => v.interventi?.[k]).map(([, l]) => l).join(", "), 7.5); sep();
    const val = (k) => v.esiti?.[k] === "si" ? "SI" : v.esiti?.[k] === "no" ? "NO" : "-";
    t("1.0 ESAME PRELIMINARE", 7.5, "bold");
    PRE.forEach((p) => lr(`${p.c || "   "} ${TX[p.k][1]}`, val(p.k)));
    if (v.tipoSigillo) t(`Tipo sigillo: ${v.tipoSigillo}. ${SIGILLI[v.tipoSigillo]}`, 7);
    t(v.tipo === "privo" ? "2.0 RT PRIVO DI SIGILLO" : "2.0 RT CON SIGILLO INTEGRO", 7.5, "bold");
    for (const x of buildTests(v.tipo)) { if (x.head) t(`${x.c} ${x.s}`, 7, "bold"); else lr(`${x.c} ${x.s}`, val(x.k)); }
    sep();
    lr("Firmware presente", v.fwPresente || "-", 7.5); if (v.fwAggiornato) lr("Aggiornato a", v.fwAggiornato, 7.5);
    lr("Inizio", `${fmtD(v.data)} ${v.oraInizio || ""}`, 7.5); lr("Fine", `${fmtD(v.dataFine || v.data)} ${v.oraFine || ""}`, 7.5);
    lr("P.I. Laboratorio", L.piva || "", 7.5); lr("C.F. Tecnico", L.cfTecnico || "", 7.5); sep();
    t(v.esito === "positivo" ? "ESITO POSITIVO" : v.esito === "negativo" ? "ESITO NEGATIVO" : "ESITO NON DETERMINATO", 12, "bold", "center");
    if (v.esito === "positivo") t(`Prossima verificazione entro il ${fmtD(addYears(v.data, 2))}`, 8, "bold", "center");
    sep(); t(`${v.luogo || ""}, ${fmtD(v.dataFine || v.data)}`, 7.5);
    const sig = (label, url, who) => { t(label, 7, "bold"); if (url) { try { const p = d.getImageProperties(url); let w = 50, h = p.height * w / p.width; if (h > 20) { h = 20; w = p.width * h / p.height; } d.addImage(url, "PNG", X + (W - w) / 2, y, w, h); y += h + 1; } catch { } } else y += 12; d.line(X + 6, y, X + W - 6, y); y += 1.2; t(who, 7, "normal", "center"); };
    sig("Tecnico abilitato", firmaT, `${L.tecnico} - ${L.cfTecnico} - ${L.sigillo}`);
    sig("L'utente", firmaU, `${v.utenteNome || ""}${v.utenteQualifica ? " - " + v.utenteQualifica : ""}`);
    return y + 8;
  };
  const tmp = new jsPDF({ unit: "mm", format: [80, 2000] }); const h = run(tmp);
  const d = new jsPDF({ unit: "mm", format: [80, Math.max(100, Math.ceil(h))] }); run(d); return d;
}
