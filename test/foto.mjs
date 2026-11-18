// Prova nel browser (Playwright + Chromium) della stampa foto sulla termica: elaborazione (larghezza piena 576/384 punti,
// bianco e nero, dithering), comandi ESC/POS raster, invio Bluetooth e porta COM simulati e la pagina /foto.
// Non serve il server: node test/foto.mjs   (OUT=/cartella salva anteprime PNG e comandi ESC/POS di esempio)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || "";
const { chromium } = createRequire(import.meta.url)("playwright"); // Playwright installato a parte, non è una dipendenza di BluCheck
let fallite = 0;
const ok = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) fallite++; };

const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => ok(false, "errore nella pagina: " + e.message));
// la pagina vera, servita in https finto (Web Bluetooth e Web Serial esistono solo nei contesti sicuri)
await page.route("https://blucheck.prova/**", (rt) => {
  const u = new URL(rt.request().url()); let f = u.pathname === "/foto" ? "/foto.html" : u.pathname;
  const p = path.join(root, "public", f); if (!fs.existsSync(p)) return rt.fulfill({ status: 404, body: "" });
  const type = f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
  rt.fulfill({ contentType: type, body: fs.readFileSync(p) });
});
await page.route("https://fonts.googleapis.com/**", (rt) => rt.fulfill({ contentType: "text/css", body: "" }));
await page.addInitScript(() => {
  window.__ricevuti = [];
  const ch = { properties: { writeWithoutResponse: true, write: true }, writeValueWithoutResponse(p) { window.__ricevuti.push(...p); return window.__blocca ? new Promise(() => { }) : Promise.resolve(); } };
  const dev = { name: "Termica prova", gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }] }; }, disconnect() { this.connected = false; } } };
  Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async () => dev }, configurable: true });
  window.__seriale = [];
  const porta = { writable: null, async open() { this.writable = { getWriter: () => ({ write: async (b) => { window.__seriale.push(...b); }, releaseLock() { } }) }; }, async close() { this.writable = null; } };
  Object.defineProperty(navigator, "serial", { value: { getPorts: async () => [], requestPort: async () => porta }, configurable: true });
});
await page.goto("https://blucheck.prova/foto");
ok(await page.evaluate(() => /Scegli prima una foto/.test($("#ftRoot").textContent)), "senza foto: spiega perché i tasti di stampa sono spenti");

const r = await page.evaluate(async () => {
  // "foto" a colori 1600x1000: sfumatura orizzontale di grigi in alto, colori e un cerchio in basso
  const c = document.createElement("canvas"); c.width = 1600; c.height = 1000; const x = c.getContext("2d");
  const gr = x.createLinearGradient(0, 0, 1600, 0); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#fff"); x.fillStyle = gr; x.fillRect(0, 0, 1600, 500);
  const cg = x.createLinearGradient(0, 0, 1600, 0); ["#e33", "#3a3", "#33e", "#ee3", "#3ee"].forEach((k, i) => cg.addColorStop(i / 4, k)); x.fillStyle = cg; x.fillRect(0, 500, 1600, 500);
  x.fillStyle = "#222"; x.beginPath(); x.arc(800, 750, 180, 0, 7); x.fill();
  const grigio = document.createElement("canvas"); grigio.width = 400; grigio.height = 400; const gx = grigio.getContext("2d"); gx.fillStyle = "rgb(128,128,128)"; gx.fillRect(0, 0, 400, 400);
  const neutro = { auto: false, contrasto: 0, gamma: 1, luminosita: 0, nitidezza: 0 };
  const quota = (b) => b.reduce((a, v) => a + v, 0) / b.length;
  const r80 = fotoElabora(c, { dots: 576 }), r58 = fotoElabora(c, { dots: 384 }), rot = fotoElabora(c, { dots: 576, rot: 90 });
  const lunga = fotoElabora((() => { const l = document.createElement("canvas"); l.width = 100; l.height = 10000; return l; })(), { dots: 576 });
  const fs50 = quota(fotoElabora(grigio, { ...neutro, metodo: "fs" }).bits), at50 = quota(fotoElabora(grigio, { ...neutro, metodo: "atkinson" }).bits);
  const chiaro = quota(fotoElabora(grigio, { ...neutro, gamma: 1.6 }).bits), scuro = quota(fotoElabora(grigio, { ...neutro, gamma: 0.7 }).bits);
  const soglia = fotoElabora(grigio, { ...neutro, metodo: "soglia", luminosita: 5 }).bits, inv = quota(fotoElabora(grigio, { ...neutro, metodo: "soglia", luminosita: 5, inverti: true }).bits);
  // sfumatura: a sinistra quasi tutto nero, a destra quasi tutto bianco
  const col = (rr, x0, x1) => { let n = 0, t = 0; for (let y = 0; y < 100; y++) for (let x = x0; x < x1; x++) { n += rr.bits[y * rr.w + x]; t++; } return n / t; };
  const bytes = escposFoto(r80), b58 = escposFoto(r58), senzaTaglio = escposFoto(r80, false);
  // rilegge le strisce GS v 0: larghezza in byte, righe totali, e ricostruisce i punti
  const leggi = (b) => { const bande = []; let i = 0; while (i < b.length) { if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) { const bw = b[i + 4] | (b[i + 5] << 8), bh = b[i + 6] | (b[i + 7] << 8); bande.push({ bw, bh, dati: b.slice(i + 8, i + 8 + bw * bh) }); i += 8 + bw * bh; } else i++; } return bande; };
  const bande = leggi(bytes), bande58 = leggi(b58);
  let uguali = true; { let y = 0; for (const bd of bande) { for (let yy = 0; yy < bd.bh; yy++, y++) for (let xx = 0; xx < r80.w; xx++) { const bit = (bd.dati[yy * bd.bw + (xx >> 3)] >> (7 - (xx & 7))) & 1; if (bit !== r80.bits[y * r80.w + xx]) uguali = false; } } }
  return {
    w80: r80.w, h80: r80.h, w58: r58.w, h58: r58.h, rot: [rot.w, rot.h], lunga: [lunga.w, lunga.h],
    soloBN: r80.bits.every((v) => v === 0 || v === 1), fs50, at50, chiaro, scuro, soglia: quota(soglia), inv,
    sinistra: col(r80, 0, 40), destra: col(r80, 536, 576),
    init: [...bytes.slice(0, 5)], fine: [...bytes.slice(-7)], fineNo: [...senzaTaglio.slice(-4)],
    bande: bande.length, bw: [...new Set(bande.map((b) => b.bw))], righe: bande.reduce((a, b) => a + b.bh, 0), maxBanda: Math.max(...bande.map((b) => b.bh)),
    bw58: [...new Set(bande58.map((b) => b.bw))], uguali, nbytes: bytes.length,
    png: r80.canvas.toDataURL("image/png"), esc: btoa(String.fromCharCode(...bytes.slice(0, 60000))),
  };
});
ok(r.w80 === 576 && r.h80 === 360, `80 mm: larghezza piena 576 punti, altezza in proporzione (${r.w80}x${r.h80})`);
ok(r.w58 === 384 && r.h58 === 240, `58 mm: 384 punti (${r.w58}x${r.h58})`);
ok(r.rot[0] === 576 && r.rot[1] === 922, `foto ruotata di 90°: 576 punti di larghezza (${r.rot})`);
ok(r.lunga[1] <= 4800 && r.lunga[0] % 8 === 0, `foto lunghissima limitata a 4800 righe (${r.lunga})`);
ok(r.soloBN, "solo punti bianchi o neri");
ok(Math.abs(r.fs50 - 0.5) < 0.03 && Math.abs(r.at50 - 0.5) < 0.08, `grigio medio -> metà punti neri (Floyd-Steinberg ${r.fs50.toFixed(3)}, Atkinson ${r.at50.toFixed(3)})`);
ok(r.chiaro < r.fs50 - 0.1 && r.scuro > r.fs50 + 0.1, `gamma schiarisce/scurisce i mezzitoni (${r.chiaro.toFixed(2)} / ${r.scuro.toFixed(2)})`);
ok(r.soglia === 0 && r.inv === 1, "soglia e negativo");
ok(r.sinistra > 0.9 && r.destra < 0.1, `sfumatura: nero a sinistra (${r.sinistra.toFixed(2)}), bianco a destra (${r.destra.toFixed(2)})`);
ok(r.init.join() === "27,64,27,97,1", "ESC @ e centratura all'inizio");
ok(r.fine.join() === "27,100,5,29,86,66,0" && r.fineNo.join() === "27,97,0,10", "avanzamento e taglio in fondo (o niente taglio)");
ok(r.bw.join() === "72" && r.bw58.join() === "48", `righe raster da 72 byte (80 mm) e 48 byte (58 mm)`);
ok(r.righe === r.h80 && r.maxBanda <= 128 && r.bande === 3, `strisce da max 128 righe che coprono tutta la foto (${r.bande} strisce, ${r.righe} righe)`);
ok(r.uguali, "i bit ESC/POS corrispondono all'anteprima");

// pagina: carica la foto dal file, anteprima, cursori, stampa Bluetooth e COM
const tmp = path.join(fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "foto-")), "prova.png");
fs.writeFileSync(tmp, Buffer.from(r.png.split(",")[1], "base64"));
await page.setInputFiles("#ftFile", tmp);
await page.waitForSelector("#ftCanvas");
const info = await page.evaluate(() => ({ w: FT.ris.w, testo: document.body.innerText, scorre: document.documentElement.scrollWidth > innerWidth }));
ok(info.w === 576 && /576 × 360 punti · 72 × 45 mm/.test(info.testo), "pagina: anteprima 576 punti = 72 mm");
ok(!info.scorre, "pagina: niente scorrimento orizzontale sul telefono");
await page.$eval('[data-fr="contrasto"]', (el) => { el.value = 40; el.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(200);
ok(await page.evaluate(() => FT.contrasto === 40 && JSON.parse(localStorage.blucheck_foto).contrasto === 40), "pagina: il cursore cambia il contrasto e lo ricorda");
await page.click('[data-ft="bt"]'); await page.waitForFunction(() => !FT.busy);
const bt = await page.evaluate(() => { const b = escposFoto(FT.ris); return window.__ricevuti.length === b.length && window.__ricevuti.every((x, i) => x === b[i]); });
ok(bt, "pagina: Bluetooth riceve esattamente i comandi della foto");
await page.click('[data-ft="ser"]'); await page.waitForFunction(() => !FT.busy);
ok(await page.evaluate(() => window.__seriale.length === escposFoto(FT.ris).length), "pagina: porta COM riceve i comandi della foto");
await page.click('[data-ft="carta"][data-v="58"]');
ok(await page.evaluate(() => FT.ris.w === 384 && JSON.parse(localStorage.blucheck_termica).carta === 58), "pagina: carta 58 mm -> 384 punti, preferenza condivisa con i rapporti");
await page.click('[data-ft="carta"][data-v="80"]');
// stampante che smette di rispondere: «Annulla» ferma la stampa e i tasti tornano attivi; senza Annulla scade da sola
await page.evaluate(() => { window.__blocca = true; });
await page.click('[data-ft="bt"]'); await page.waitForSelector('[data-ft="annulla"]');
ok(await page.evaluate(() => FT.busy && $('[data-ft="vel"][data-v="molto"]') && !$('[data-ft="vel"][data-v="molto"]').disabled), "stampa appesa: c'è «Annulla» e la velocità resta cambiabile");
await page.click('[data-ft="annulla"]'); await page.waitForFunction(() => !FT.busy, null, { timeout: 3000 });
ok(await page.evaluate(() => /annullata/i.test(FT.err) && !$('[data-ft="bt"]').disabled && !$('[data-ft="ser"]').disabled && !$('[data-ft="annulla"]')), "Annulla: stampa ferma, tasti di nuovo attivi");
{ const t = Date.now(); await page.click('[data-ft="bt"]'); await page.waitForFunction(() => !FT.busy, null, { timeout: 15000 });
  ok(await page.evaluate(() => /non risponde/i.test(FT.err)) && Date.now() - t < 12000, `stampante muta: errore dopo ${((Date.now() - t) / 1000).toFixed(1)} s invece di restare «in corso»`); }
await page.evaluate(() => { window.__blocca = false; window.__ricevuti = []; });
await page.click('[data-ft="bt"]'); await page.waitForFunction(() => !FT.busy);
ok(await page.evaluate(() => !FT.err && window.__ricevuti.length === escposFoto(FT.ris).length), "dopo l'errore la stampa successiva riparte (ricollega da capo)");
await page.click("#ftCanvas");
ok(await page.evaluate(() => $("#ftCanvas").width === 576 && $("#ftCanvas").classList.contains("zoom")), "pagina: tocco sull'anteprima = punti veri 1:1");
await page.click("#ftCanvas");
if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "foto-576.png"), Buffer.from(r.png.split(",")[1], "base64"));
  fs.writeFileSync(path.join(OUT, "foto-80mm.bin"), Buffer.from(r.esc, "base64"));
  await page.screenshot({ path: path.join(OUT, "pagina-foto-telefono.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: path.join(OUT, "pagina-foto-computer.png"), fullPage: true });
}
await browser.close();
console.log(fallite ? `\n${fallite} prove fallite` : "\nTutte le prove sono passate");
process.exit(fallite ? 1 : 0);
