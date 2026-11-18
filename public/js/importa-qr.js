"use strict";
/*
 * Importa QR code da file (Apparecchi > «Importa QR da file»).
 * Si scelgono una o più foto, PDF o archivi ZIP; il browser cerca i QR code della targhetta in ogni immagine (anche più di uno
 * per immagine) e in ogni pagina dei PDF, poi il server legge la pagina dell'Agenzia delle Entrate di ciascuno e prepara il
 * riepilogo: apparecchi nuovi, apparecchi dello storico da completare, già presenti da aggiornare, file o QR non leggibili.
 * Si salva solo dopo il riepilogo. Caricato da app.js solo quando serve (usa $, esc, api, toast, openSheet... di app.js/common.js).
 */

/* ---------------- ZIP (senza librerie: indice centrale + DecompressionStream) ---------------- */
async function zipVoci(file) {
  const buf = new Uint8Array(await file.arrayBuffer()); const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Archivio ZIP non valido.");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error("Archivio ZIP troppo grande (ZIP64): dividilo in archivi più piccoli.");
  const voci = []; const td = new TextDecoder();
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const flags = dv.getUint16(p + 8, true), metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const nome = td.decode(buf.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    if (nome.endsWith("/") || /(^|\/)(__MACOSX|\.)/.test(nome)) continue;
    voci.push({
      nome, metodo, cifrato: !!(flags & 1),
      dati: async () => {
        const inizio = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
        const raw = buf.subarray(inizio, inizio + comp);
        if (metodo === 0) return new Blob([raw]);
        if (metodo !== 8) throw new Error("compressione non supportata");
        if (typeof DecompressionStream === "undefined") throw new Error("browser troppo vecchio per aprire gli ZIP: aggiornalo");
        return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      },
    });
  }
  return voci;
}

/* ---------------- immagini e PDF ---------------- */
const QI_IMG = /\.(jpe?g|png|gif|webp|bmp|avif|tiff?)$/i, QI_PDF = /\.pdf$/i, QI_ZIP = /\.zip$/i, QI_HEIC = /\.(heic|heif)$/i;
function qiTipo(nome, type = "") {
  if (QI_ZIP.test(nome) || /zip/.test(type)) return "zip";
  if (QI_PDF.test(nome) || type === "application/pdf") return "pdf";
  if (QI_HEIC.test(nome) || /hei[cf]/.test(type)) return "heic";
  if (QI_IMG.test(nome) || type.startsWith("image/")) return "img";
  return "";
}
function qiImmagine(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("immagine non leggibile")); };
    img.src = url;
  });
}
/** Tutti i QR code di un'immagine (o canvas): dopo ogni QR trovato lo copre di bianco e cerca ancora, a più risoluzioni. */
function qrTutti(src, w, h) {
  const trovati = new Set();
  const lati = Math.max(w, h) > 2600 ? [1600, 2600, 1000] : [1600, 1000, 2400];
  for (const max of lati) {
    const s = Math.min(1, max / Math.max(w, h)); const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const x = c.getContext("2d", { willReadFrequently: true }); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    for (let k = 0; k < 30; k++) {
      const d = x.getImageData(0, 0, c.width, c.height);
      const r = window.jsQR ? jsQR(d.data, c.width, c.height, { inversionAttempts: "attemptBoth" }) : null;
      if (!r?.data) break;
      trovati.add(r.data.trim());
      const L = r.location; const pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner];
      const lato = Math.hypot(L.topRightCorner.x - L.topLeftCorner.x, L.topRightCorner.y - L.topLeftCorner.y);
      const cx = pts.reduce((a, p) => a + p.x, 0) / 4, cy = pts.reduce((a, p) => a + p.y, 0) / 4;
      x.fillStyle = "#fff"; x.beginPath();
      pts.forEach((p, i) => { const px = cx + (p.x - cx) * 1.25, py = cy + (p.y - cy) * 1.25; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.closePath(); x.fill();
      if (lato < 8) break;
    }
    if (trovati.size && max === lati[0] && Math.max(w, h) <= 2600) break; // foto normale: basta la prima risoluzione che trova qualcosa
  }
  return [...trovati];
}
let qiPdfjs = null;
async function qiPdf() {
  if (!qiPdfjs) {
    qiPdfjs = import("/vendor/pdfjs/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs"; return m; });
    qiPdfjs.catch(() => { qiPdfjs = null; });
  }
  return qiPdfjs;
}

/* ---------------- stato e lettura dei file ---------------- */
const QI = { fase: "scegli", msg: "", qr: [], scarti: [], anteprima: null, escludi: new Set(), esito: null };
const qiStop = () => UI.sheet?.kind !== "qrimp";
function qiProgress(msg) { QI.msg = msg; const b = $("#qiProg"); if (b) b.textContent = msg; }

async function qiLeggiFile(files) {
  Object.assign(QI, { fase: "lettura", msg: "", qr: [], scarti: [], anteprima: null, escludi: new Set(), esito: null }); renderSheet();
  const coda = [...files].map((f) => ({ nome: f.name, blob: f, tipo: qiTipo(f.name, f.type) }));
  const qr = new Map(); // testo -> [file]
  const aggiungi = (t, nome) => { if (!qr.has(t)) qr.set(t, []); qr.get(t).push(nome); };
  let fatti = 0;
  while (coda.length) {
    if (qiStop()) return;
    const f = coda.shift(); fatti++;
    qiProgress(`Cerco i QR code nei file… ${fatti} di ${fatti + coda.length}: ${f.nome}`);
    try {
      if (f.tipo === "zip") {
        const voci = await zipVoci(f.blob);
        for (const v of voci) {
          const tipo = qiTipo(v.nome); const nome = `${f.nome} › ${v.nome}`;
          if (!tipo || tipo === "zip") { QI.scarti.push({ nome, motivo: tipo === "zip" ? "ZIP dentro lo ZIP: estrailo e caricalo a parte" : "non è un'immagine né un PDF" }); continue; }
          if (v.cifrato) { QI.scarti.push({ nome, motivo: "file protetto da password" }); continue; }
          coda.push({ nome, tipo, voce: v });
        }
        continue;
      }
      if (f.voce) f.blob = await f.voce.dati();
      if (f.tipo === "heic") { QI.scarti.push({ nome: f.nome, motivo: "foto HEIC dell'iPhone: questo browser non la apre. Esportala in JPG oppure imposta la fotocamera su «Più compatibile»" }); continue; }
      if (f.tipo === "img") {
        const img = await qiImmagine(f.blob);
        const t = qrTutti(img, img.naturalWidth, img.naturalHeight);
        if (!t.length) QI.scarti.push({ nome: f.nome, motivo: "nessun QR code riconosciuto" });
        t.forEach((x) => aggiungi(x, f.nome));
        continue;
      }
      if (f.tipo === "pdf") {
        const pdfjs = await qiPdf();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()), isEvalSupported: false }).promise;
        let nessuno = true;
        for (let p = 1; p <= doc.numPages; p++) {
          if (qiStop()) return;
          qiProgress(`Cerco i QR code nei file… ${f.nome}, pagina ${p} di ${doc.numPages}`);
          const pg = await doc.getPage(p); const vp1 = pg.getViewport({ scale: 1 });
          const vp = pg.getViewport({ scale: Math.min(3, 2400 / Math.max(vp1.width, vp1.height)) });
          const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await pg.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#ffffff" }).promise;
          const t = qrTutti(c, c.width, c.height);
          if (t.length) nessuno = false;
          t.forEach((x) => aggiungi(x, `${f.nome} (pag. ${p})`));
          pg.cleanup();
        }
        doc.destroy();
        if (nessuno) QI.scarti.push({ nome: f.nome, motivo: "nessun QR code riconosciuto nelle pagine" });
        continue;
      }
      QI.scarti.push({ nome: f.nome, motivo: "formato non supportato (servono foto, PDF o ZIP)" });
    } catch (e) {
      console.error(e);
      QI.scarti.push({ nome: f.nome, motivo: e.message || "file non leggibile" });
    }
  }
  // solo i QR delle targhette (pagina dell'Agenzia); gli altri si segnalano
  QI.qr = [];
  for (const [t, nomi] of qr) {
    if (isAeUrl(t)) QI.qr.push({ url: t, file: nomi });
    else QI.scarti.push({ nome: nomi.join(", "), motivo: `QR che non porta all'Agenzia delle Entrate: ${t.slice(0, 80)}` });
  }
  if (!QI.qr.length) { QI.fase = "anteprima"; QI.anteprima = { righe: [], nuovi: 0, completati: 0, aggiornati: 0, invariati: 0, doppi: 0, errori: 0, clienti_nuovi: 0 }; return renderSheet(); }
  // pagine dell'Agenzia a gruppi di 10 (avanzamento visibile), poi il riepilogo
  try {
    for (let i = 0; i < QI.qr.length; i += 10) {
      if (qiStop()) return;
      qiProgress(`Leggo i dati dall'Agenzia delle Entrate… ${Math.min(i + 10, QI.qr.length)} di ${QI.qr.length}`);
      await api("POST", "/api/importa-qr/leggi", { urls: QI.qr.slice(i, i + 10).map((q) => q.url) });
    }
    qiProgress("Preparo il riepilogo…");
    const r = await api("POST", "/api/importa-qr", { urls: QI.qr.map((q) => q.url) });
    if (qiStop()) return;
    QI.anteprima = r; QI.fase = "anteprima";
  } catch (e) { QI.fase = "scegli"; apiError(e); }
  renderSheet();
}

async function qiSalva() {
  if (!guardWrite() || !QI.anteprima) return;
  QI.fase = "salvataggio"; renderSheet();
  try {
    const r = await api("POST", "/api/importa-qr", { urls: QI.qr.map((q) => q.url), escludi: [...QI.escludi], conferma: true });
    QI.esito = r; QI.fase = "fatto";
    toast("QR code importati");
    await start();
    if (UI.sheet?.kind !== "qrimp") openSheet({ kind: "qrimp" }); else renderSheet();
  } catch (e) { QI.fase = "anteprima"; renderSheet(); apiError(e); }
}

/* ---------------- pannello ---------------- */
const QI_ESITI = {
  nuovo: ["Nuovi apparecchi", "acc"], completa: ["Da completare (storico)", "ok"], presente: ["Già presenti, da aggiornare", "warn"],
  invariato: ["Già presenti, nessuna novità", "n"], doppio: ["Doppioni", "n"], errore: ["Non leggibili", "bad"],
};
function qiFileDi(url) { return QI.qr.find((q) => q.url === url)?.file || []; }
function qiRiga(r) {
  const salvabile = ["nuovo", "completa", "presente"].includes(r.esito);
  const sel = salvabile ? `<input type="checkbox" data-qi-sel="${esc(r.url)}" ${QI.escludi.has(r.url) ? "" : "checked"} aria-label="Importa questo QR">` : "";
  const cli = r.cliente ? `${esc(r.cliente)}${r.clienteNuovo ? ` <span class="pill acc">CLIENTE NUOVO</span>` : ""}` : esc(r.esercente || "");
  const det = r.esito === "presente" ? `Cambia: ${esc(r.cambi.join(", "))}` : r.esito === "completa" ? "Completa il registratore importato dallo storico" : r.motivo ? esc(r.motivo) : "";
  return `<tr><td>${sel}</td><td><span class="mono">${esc(r.matricola || "—")}</span><br><span class="faint">${esc(r.modello || "")}</span></td>
    <td>${cli}${r.piva ? `<br><span class="faint">P.IVA ${esc(r.piva)}</span>` : ""}</td>
    <td>${det}${r.vp ? `<br><span class="faint">ultima verificazione ${fmtD(r.vp)}</span>` : ""}${(r.avvisi || []).map((a) => `<br><span class="pill warn" style="white-space:normal">${esc(a)}</span>`).join("")}
    <br><span class="faint">${esc(qiFileDi(r.url).join(", "))}</span></td></tr>`;
}
function sheetQrImp() {
  const a = QI.anteprima;
  let body = "";
  if (QI.fase === "scegli" || QI.fase === "fatto") {
    body += `<div class="panel">
      <p style="margin:0">Scegli le foto delle targhette, i PDF (anche scansioni con più QR per pagina) o un archivio ZIP con tante immagini.
      Per ogni QR code vengono letti i dati dall'Agenzia delle Entrate, come con la fotocamera. Prima di salvare vedi il riepilogo.</p>
      <label class="btn primary" style="align-self:flex-start">Scegli i file<input type="file" id="qiFile" multiple accept="image/*,.pdf,application/pdf,.zip,application/zip,application/x-zip-compressed" hidden></label>
      <div id="qiDrop" class="faint" style="border:2px dashed var(--line);border-radius:var(--r);padding:18px;text-align:center">oppure trascina qui i file</div></div>`;
    if (QI.fase === "fatto" && QI.esito) {
      const f = QI.esito.fatti || {};
      body += `<div class="banner ok"><span>Salvati <b>${QI.esito.salvati}</b> QR code: ${f.nuovi || 0} apparecchi nuovi${f.clienti ? ` (${f.clienti} clienti nuovi)` : ""}, ${f.completati || 0} registratori dello storico completati, ${f.aggiornati || 0} aggiornati.
        ${QI.esito.backup ? `Backup fatto prima dell'import: <span class="mono">${esc(QI.esito.backup)}</span>.` : ""}</span></div>`;
    }
  } else if (QI.fase === "lettura" || QI.fase === "salvataggio") {
    body += `<div class="panel"><b>${QI.fase === "lettura" ? "Lettura in corso" : "Salvataggio in corso"}</b><span class="faint" id="qiProg">${esc(QI.fase === "lettura" ? QI.msg : "Backup del database e salvataggio degli apparecchi…")}</span>
      <span class="faint">Lascia aperta questa finestra fino alla fine.</span></div>`;
  } else if (QI.fase === "anteprima" && a) {
    const daSalvare = a.righe.filter((r) => ["nuovo", "completa", "presente"].includes(r.esito) && !QI.escludi.has(r.url)).length;
    const nonLeggibili = a.errori + QI.scarti.length;
    body += `<div class="banner info" style="flex-direction:column;align-items:stretch"><span>
      QR code trovati: <b>${QI.qr.length}</b>. Nuovi apparecchi: <b>${a.nuovi}</b>${a.clienti_nuovi ? ` (con ${a.clienti_nuovi} clienti nuovi)` : ""}.
      Registratori dello storico da completare: <b>${a.completati}</b>. Già presenti da aggiornare: <b>${a.aggiornati}</b>.
      Già presenti senza novità: <b>${a.invariati}</b>.${a.doppi ? ` Doppioni: <b>${a.doppi}</b>.` : ""} Non leggibili: <b>${nonLeggibili}</b>.</span>
      <span class="faint">Togli la spunta a quelli che non vuoi importare. Il cliente si riconosce dalla P.IVA dell'esercente (o dalla ragione sociale); se non c'è, viene creato.</span>
      <div class="row">${daSalvare ? `<button class="btn primary" data-qi-act="salva">Salva ${daSalvare} QR code</button>` : ""}<button class="btn" data-qi-act="ricomincia">Scegli altri file</button></div></div>`;
    for (const e of Object.keys(QI_ESITI)) {
      const rr = a.righe.filter((r) => r.esito === e);
      const extra = e === "errore" ? QI.scarti : [];
      if (!rr.length && !extra.length) continue;
      body += `<div class="panel"><h2>${QI_ESITI[e][0]} <span class="pill ${QI_ESITI[e][1]}">${rr.length + extra.length}</span></h2>
        <div style="overflow:auto;max-height:60vh"><table class="t"><thead><tr><th></th><th>Matricola</th><th>Cliente</th><th>Dettagli</th></tr></thead><tbody>
        ${rr.map(qiRiga).join("")}${extra.map((s) => `<tr><td></td><td>—</td><td>${esc(s.nome)}</td><td>${esc(s.motivo)}</td></tr>`).join("")}</tbody></table></div></div>`;
    }
    if (!QI.qr.length && !QI.scarti.length) body += `<div class="panel"><p style="margin:0">Nessun file letto.</p></div>`;
  }
  return head("Importa QR da file") + `<div class="sheet-body gut">${body}</div>`;
}
window.sheetQrImp = sheetQrImp;
// nuova apertura: si riparte dalla scelta dei file, tranne se una lettura o un salvataggio sono ancora in corso
window.qiNuovo = () => { if (!["lettura", "salvataggio"].includes(QI.fase)) Object.assign(QI, { fase: "scegli", msg: "", qr: [], scarti: [], anteprima: null, escludi: new Set(), esito: null }); };

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-qi-act]"); if (!el) return;
  if (el.dataset.qiAct === "salva") await qiSalva();
  if (el.dataset.qiAct === "ricomincia") { Object.assign(QI, { fase: "scegli", anteprima: null, esito: null }); renderSheet(); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "qiFile" && t.files?.length) { if (guardWrite()) qiLeggiFile(t.files); return; }
  if (t.dataset?.qiSel !== undefined) {
    if (t.checked) QI.escludi.delete(t.dataset.qiSel); else QI.escludi.add(t.dataset.qiSel);
    const b = $("[data-qi-act=salva]"); const a = QI.anteprima;
    if (b && a) b.textContent = `Salva ${a.righe.filter((r) => ["nuovo", "completa", "presente"].includes(r.esito) && !QI.escludi.has(r.url)).length} QR code`;
  }
});
document.addEventListener("dragover", (e) => { if (e.target.closest?.("#qiDrop")) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!e.target.closest?.("#qiDrop")) return;
  e.preventDefault();
  if (e.dataTransfer?.files?.length && guardWrite()) qiLeggiFile(e.dataTransfer.files);
});
