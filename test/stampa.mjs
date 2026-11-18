// Prova nel browser (Playwright + Chromium) di timbro del cliente, PDF con timbro, comandi ESC/POS e invio Bluetooth simulato.
// Non serve il server: node test/stampa.mjs   (OUT=/cartella per salvare i PDF e i comandi di esempio)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || "";
const { chromium } = createRequire(import.meta.url)("playwright"); // Playwright installato a parte (npm i -g playwright), non è una dipendenza di BluCheck
let fallite = 0;
const ok = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) fallite++; };

const browser = await chromium.launch(); const page = await browser.newPage();
page.on("pageerror", (e) => ok(false, "errore nella pagina: " + e.message));
// pagina servita in https finto: Web Bluetooth esiste solo nei contesti sicuri
await page.route("https://blucheck.prova/**", (rt) => rt.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
await page.goto("https://blucheck.prova/");
// Web Bluetooth finto: registra i byte ricevuti dalla "stampante"
await page.evaluate(() => {
  window.__ricevuti = [];
  const ch = { properties: { writeWithoutResponse: true, write: true }, async writeValueWithoutResponse(p) { window.__ricevuti.push(...p); } };
  const dev = { name: "Termica prova", gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryServices: async () => [{ getCharacteristics: async () => [{ properties: { read: true } }, ch] }] }; }, disconnect() { this.connected = false; } } };
  Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async (o) => { window.__opzioni = o; return dev; } }, configurable: true });
});
for (const f of ["node_modules/jspdf/dist/jspdf.umd.min.js", "public/js/common.js", "public/js/pdf.js"]) await page.addScriptTag({ path: path.join(root, f) });

const r = await page.evaluate(async () => {
  const cli = { ragione: "Bar Centrale di Rossi Mario & C. S.a.s. – Caffetteria Pasticceria", domicilio: "Via Roma 12, 73036 Muro Leccese (LE)", piva: "01234567890", cf: "RSSMRA80A01F842X" };
  const tb = timbroCliente(cli), tb2 = timbroCliente(cli);
  const firma = (() => { const c = document.createElement("canvas"); c.width = 400; c.height = 120; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 400, 120); x.lineWidth = 4; x.beginPath(); x.moveTo(20, 90); x.bezierCurveTo(120, 0, 200, 120, 380, 30); x.stroke(); return c.toDataURL("image/png"); })();
  const esiti = {}; for (const t of [...PRE, ...buildTests("integro")]) esiti[t.k] = "si";
  const v = { id: "r1", numero: "12/2026", tipo: "integro", esiti, esito: "positivo", data: "2026-11-18", oraInizio: "09:00", oraFine: "09:40", luogo: "Muro Leccese",
    interventi: { lab: true, vp: true }, cli, app: { modello: "Olivetti Form 200 Plus", matricola: "72MU1234567", indirizzo: "Via Roma 12", localita: "Muro Leccese" },
    lab: { ragione: "CDL Italia srl", indirizzo: "Via Prova 1", cap: "73046 Matino", piva: "09876543210" }, tecnico: { nome: "Tecnico Prova", cf: "TCNPRV80A01E506X", sigillo: "S123" },
    utenteNome: "Mario Rossi", utenteQualifica: "titolare", dichiarante: "utente", motivoSigillo: "rimozione per riparazione" };
  const b64 = (d) => btoa(new Uint8Array(d.output("arraybuffer")).reduce((s, x) => s + String.fromCharCode(x), ""));
  const imgs = (d) => (d.output().match(/\/Subtype \/Image/g) || []).length;
  const a4 = pdfA4(v, firma, firma, tb), a4n = pdfA4(v, firma, firma, null), th = pdfThermal(v, firma, firma, tb), thn = pdfThermal(v, firma, firma, null), di = pdfDich(v, firma, firma, tb);
  const bytes = await escposRapporto(v, firma, firma, tb, 80), b58 = await escposRapporto(v, firma, firma, tb, 58);
  // testo stampato: righe tra un comando e l'altro
  const testo = (b) => { const out = []; let i = 0, cur = ""; while (i < b.length) { const c = b[i];
      if (c === 0x1d && b[i + 1] === 0x76) { const bw = b[i + 4] | (b[i + 5] << 8), bh = b[i + 6] | (b[i + 7] << 8); i += 8 + bw * bh; continue; }
      if (c === 0x1b || c === 0x1d) { i += (c === 0x1d && b[i + 1] === 0x56) ? 4 : (c === 0x1b && b[i + 1] === 0x40) ? 2 : 3; continue; }
      if (c === 0x0a) { out.push(cur); cur = ""; } else cur += String.fromCharCode(c); i++; } return out; };
  const righe = testo(bytes), righe58 = testo(b58);
  const raster = (b) => { let n = 0; for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) n++; return n; };
  await btStampa(bytes);
  return {
    tb: !!tb && tb.url.startsWith("data:image/png") && tb.w > tb.h, uguale: tb.url === tb2.url, senza: timbroCliente({ ragione: "  " }) === null,
    linee: timbroLinee(cli), lineeSenzaCf: timbroLinee({ ragione: "Ditta", piva: "123", cf: "123" }),
    imgA4: [imgs(a4), imgs(a4n)], imgTh: [imgs(th), imgs(thn)], imgDi: imgs(di),
    pdf: { a4: b64(a4), th: b64(th), di: b64(di) },
    escInit: [...bytes.slice(0, 2)], escFine: [...bytes.slice(-4)], raster: raster(bytes), maxRiga: Math.max(...righe.map((x) => x.length)), maxRiga58: Math.max(...righe58.map((x) => x.length)),
    ascii: righe.every((x) => /^[\x20-\x7e]*$/.test(x)),
    righe, esitoRiga: righe.some((x) => x.includes("ESITO POSITIVO")), accenti: escAscii("Città è perché € 5"),
    ricevuti: window.__ricevuti.length === bytes.length && window.__ricevuti.every((x, i) => x === bytes[i]), servizi: window.__opzioni?.optionalServices?.length,
    rawbt: rawbtUrl(new Uint8Array([27, 64, 65])), b64esc: btoa(String.fromCharCode(...bytes.slice(0, 0))) === "",
    bytes: Array.from(bytes),
    bianca: await (async () => {
      const L = { ragione: "CDL Italia srl", piva: "09876543210" };
      const b80 = await escposSchedaBianca(80, "integro", L), b58 = await escposSchedaBianca(58, "privo", L);
      const r80 = testo(b80), r58 = testo(b58);
      return { righe: r80, max80: Math.max(...r80.map((x) => x.length)), max58: Math.max(...r58.map((x) => x.length)), fine: [...b80.slice(-4)],
        caselle: r80.filter((x) => x.endsWith("[ ]SI [ ]NO")).length, test80: buildTests("integro").filter((t) => !t.head).length + PRE.length,
        tagli: (() => { let n = 0; for (let i = 0; i < b80.length - 2; i++) if (b80[i] === 0x1d && b80[i + 1] === 0x56) n++; return n; })(),
        pdf: b64(pdfSchedaBianca("integro", L)), pdfPrivo: pdfSchedaBianca("privo", L).getNumberOfPages() };
    })(),
  };
});
ok(r.tb, "timbro del cliente: PNG più largo che alto");
ok(r.uguale, "timbro identico a ogni stampa (grana con seme fisso)");
ok(r.senza, "senza ragione sociale niente timbro");
ok(r.linee.length === 3 && r.linee[2].includes("P.IVA 01234567890") && r.linee[2].includes("C.F. RSSMRA80A01F842X"), "righe del timbro: " + r.linee.join(" | "));
ok(r.lineeSenzaCf.join("|") === "DITTA|P.IVA 123", "C.F. uguale alla P.IVA non ripetuto");
ok(r.imgA4[0] > r.imgA4[1], `A4: timbro aggiunto (immagini ${r.imgA4.join(" vs ")})`);
ok(r.imgTh[0] > r.imgTh[1], `80 mm: timbro aggiunto (immagini ${r.imgTh.join(" vs ")})`);
ok(r.imgDi > 2, "dichiarazione dell'utente: firma + timbro (immagini " + r.imgDi + ")");
ok(r.escInit.join() === "27,64" && r.escFine.join() === "29,86,66,0", "ESC/POS: inizia con ESC @ e finisce col taglio");
ok(r.raster >= 3, "ESC/POS: firme e timbro come immagini raster (" + r.raster + " strisce)");
ok(r.maxRiga <= 48 && r.maxRiga58 <= 32, `righe entro 48 colonne (80 mm) e 32 (58 mm): ${r.maxRiga} / ${r.maxRiga58}`);
ok(r.ascii, "testo solo ASCII");
ok(r.accenti === "Citta' e' perche' EUR 5", "accenti e euro: " + r.accenti);
ok(r.esitoRiga, "esito stampato");
ok(r.ricevuti, "Bluetooth simulato: la stampante ha ricevuto tutti i byte, in ordine");
ok(r.servizi >= 5, "richiesta Bluetooth con i servizi delle stampanti note");
ok(r.rawbt === "intent:base64,G0BB#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;", "link RawBT");
ok(r.bianca.max80 <= 48 && r.bianca.max58 <= 32, `scheda in bianco entro 48/32 colonne: ${r.bianca.max80} / ${r.bianca.max58}`);
ok(r.bianca.caselle === r.bianca.test80, `scheda in bianco: caselle SI/NO su ogni prova (${r.bianca.caselle} di ${r.bianca.test80})`);
ok(r.bianca.tagli === 1 && r.bianca.fine.join() === "29,86,66,0", "scheda in bianco: un solo taglio, alla fine");
ok(r.bianca.righe.some((x) => x.startsWith("Matricola ___")) && r.bianca.righe.some((x) => x.includes("[ ] POSITIVO")), "scheda in bianco: righe da compilare ed esito da spuntare");
ok(r.bianca.pdfPrivo === 1, "PDF 80 mm della scheda in bianco (All. 2) su una pagina");
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "scheda-bianca-80mm.pdf"), Buffer.from(r.bianca.pdf, "base64"));
  fs.writeFileSync(path.join(OUT, "scheda-bianca-80mm.txt"), r.bianca.righe.join("\n"));
  fs.mkdirSync(OUT, { recursive: true });
  for (const [k, n] of [["a4", "rapporto-a4.pdf"], ["th", "rapporto-80mm.pdf"], ["di", "dichiarazione.pdf"]]) fs.writeFileSync(path.join(OUT, n), Buffer.from(r.pdf[k], "base64"));
  fs.writeFileSync(path.join(OUT, "rapporto-80mm.escpos.bin"), Buffer.from(r.bytes));
  fs.writeFileSync(path.join(OUT, "rapporto-80mm.txt"), r.righe.join("\n"));
  console.log("salvati in " + OUT);
}
await browser.close();
console.log(fallite ? `\n${fallite} prove FALLITE` : "\nTutto OK");
process.exit(fallite ? 1 : 0);
