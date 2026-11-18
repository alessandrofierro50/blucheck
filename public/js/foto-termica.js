"use strict";
/* BluCheck - Stampa foto sulla termica (pagina /foto, telefono e computer).
   La foto si adatta alla larghezza stampabile della carta (80 mm = 576 punti a 203 dpi, cioè 72 mm; 58 mm = 384 punti),
   diventa scala di grigi, si regolano livelli, luminosità, contrasto, gamma e nitidezza, poi si riduce a soli punti
   bianchi e neri col dithering (Floyd-Steinberg, Atkinson o soglia) e si manda come immagine raster ESC/POS (GS v 0)
   con gli stessi canali del rapporto: Bluetooth, porta USB/COM, RawBT. Tutto nel browser: la foto non va al server. */
const FOTO_DOTS = { 80: 576, 58: 384 };
const FOTO_MAX_H = 4800; // ~60 cm di carta: oltre si riduce la foto per non stampare metri di carta
const FOTO_DEF = { luminosita: 0, contrasto: 15, gamma: 1.3, nitidezza: 40, metodo: "fs", auto: true, inverti: false };

/* immagine (Image, ImageBitmap o canvas) -> { w, h, bits (1 = punto nero), canvas (anteprima in bianco e nero) } */
function fotoElabora(src, o = {}) {
  o = { ...FOTO_DEF, dots: 576, rot: 0, ...o };
  const sw0 = src.naturalWidth || src.width, sh0 = src.naturalHeight || src.height;
  if (!sw0 || !sh0) throw new Error("Immagine vuota o non leggibile.");
  const giro = ((o.rot % 360) + 360) % 360, ruotata = giro === 90 || giro === 270;
  const sw = ruotata ? sh0 : sw0, sh = ruotata ? sw0 : sh0;
  // larghezza sempre piena (multiplo di 8 per il raster); altezza in proporzione
  let w = Math.max(8, Math.floor(o.dots / 8) * 8), h = Math.max(1, Math.round(sh * w / sw));
  if (h > FOTO_MAX_H) { h = FOTO_MAX_H; w = Math.max(8, Math.floor(sw * h / sh / 8) * 8); }
  // riduzione a passi (metà per volta): meno scalettature e moiré di un'unica riduzione grande
  let cur = src, cw = sw0, ch = sh0;
  const tw = ruotata ? h : w, th = ruotata ? w : h;
  while (cw / 2 >= tw * 1.5 && ch / 2 >= th * 1.5) {
    const c = document.createElement("canvas"); c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height;
  }
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // le parti trasparenti (PNG) restano bianche
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(giro * Math.PI / 180); ctx.drawImage(cur, -tw / 2, -th / 2, tw, th); ctx.restore();
  const px = ctx.getImageData(0, 0, w, h);
  const g = fotoGrigi(px.data, w, h, o);
  const bits = fotoDither(g, w, h, o.metodo);
  for (let i = 0, d = px.data; i < w * h; i++) { const v = bits[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  ctx.putImageData(px, 0, 0);
  return { w, h, bits, canvas: cv };
}

/* RGBA -> livelli di grigio 0..255 (Float32Array) con le regolazioni per la termica */
function fotoGrigi(d, w, h, o) {
  const n = w * h, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]; // luminanza (Rec. 709)
  // livelli automatici: il nero e il bianco della foto (scartando lo 0,5% agli estremi) diventano 0 e 255
  if (o.auto) {
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[g[i] | 0]++;
    const taglio = n * 0.005; let lo = 0, hi = 255, s = 0;
    for (; lo < 255; lo++) { s += hist[lo]; if (s > taglio) break; }
    s = 0; for (; hi > 0; hi--) { s += hist[hi]; if (s > taglio) break; }
    if (hi - lo >= 16) { const k = 255 / (hi - lo); for (let i = 0; i < n; i++) g[i] = (g[i] - lo) * k; }
  }
  // nitidezza (maschera di contrasto 3x3): sulla termica i contorni morbidi si perdono nel dithering
  const a = (o.nitidezza || 0) / 100;
  if (a > 0 && w > 2 && h > 2) {
    const b = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)) * w; for (let dx = -1; dx <= 1; dx++) s += g[yy + Math.min(w - 1, Math.max(0, x + dx))]; }
      b[y * w + x] = s / 9;
    }
    for (let i = 0; i < n; i++) g[i] += a * 1.5 * (g[i] - b[i]);
  }
  // luminosità, contrasto (attorno al grigio medio) e gamma: gamma > 1 schiarisce i mezzitoni, che sulla
  // termica escono più scuri (il punto caldo si allarga sulla carta)
  const C = Math.max(-99, Math.min(99, o.contrasto || 0)) * 2.55, fc = (259 * (C + 255)) / (255 * (259 - C));
  const lum = (o.luminosita || 0) * 2.55, inv = 1 / Math.max(0.2, o.gamma || 1);
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) { let x = fc * (v + lum - 128) + 128; x = Math.min(255, Math.max(0, x)); x = 255 * Math.pow(x / 255, inv); lut[v] = o.inverti ? 255 - x : x; }
  for (let i = 0; i < n; i++) { const v = Math.min(255, Math.max(0, g[i])); const f = v | 0, r = v - f; g[i] = f < 255 ? lut[f] + (lut[f + 1] - lut[f]) * r : lut[255]; }
  return g;
}

/* livelli di grigio -> punti (1 = nero). fs = Floyd-Steinberg a serpentina, atkinson = più contrastato e pulito
   sui bianchi (diffonde solo 3/4 dell'errore), soglia = solo bianco/nero (testi, loghi, disegni) */
function fotoDither(g, w, h, metodo = "fs") {
  const e = Float32Array.from(g), out = new Uint8Array(w * h);
  if (metodo === "soglia") { for (let i = 0; i < w * h; i++) out[i] = e[i] < 128 ? 1 : 0; return out; }
  const add = (x, y, v) => { if (x >= 0 && x < w && y < h) e[y * w + x] += v; };
  for (let y = 0; y < h; y++) {
    const dx = metodo === "atkinson" || y % 2 === 0 ? 1 : -1; // serpentina per Floyd-Steinberg: niente "vermicelli" diagonali
    for (let i = 0; i < w; i++) {
      const x = dx > 0 ? i : w - 1 - i, p = y * w + x, old = e[p], nero = old < 128;
      out[p] = nero ? 1 : 0; const err = old - (nero ? 0 : 255);
      if (metodo === "atkinson") { const q = err / 8; add(x + 1, y, q); add(x + 2, y, q); add(x - 1, y + 1, q); add(x, y + 1, q); add(x + 1, y + 1, q); add(x, y + 2, q); }
      else { add(x + dx, y, err * 7 / 16); add(x - dx, y + 1, err * 3 / 16); add(x, y + 1, err * 5 / 16); add(x + dx, y + 1, err / 16); }
    }
  }
  return out;
}

/* punti -> comandi ESC/POS: inizializza, centra, immagine raster GS v 0 a strisce di 128 righe
   (le stampantine hanno un buffer piccolo), avanza e taglia (chi non ha la taglierina lo ignora) */
function escposFoto(r, taglia = true) {
  const { w, h, bits } = r, bw = w >> 3, parts = [Uint8Array.from([0x1b, 0x40, 0x1b, 0x61, 0x01])];
  for (let y0 = 0; y0 < h; y0 += 128) {
    const bh = Math.min(128, h - y0), band = new Uint8Array(8 + bw * bh);
    band.set([0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, bh & 255, bh >> 8]);
    for (let y = 0; y < bh; y++) { const riga = (y0 + y) * w; for (let x = 0; x < w; x++) if (bits[riga + x]) band[8 + y * bw + (x >> 3)] |= 0x80 >> (x & 7); }
    parts.push(band);
  }
  parts.push(Uint8Array.from([0x1b, 0x61, 0x00, 0x0a]));
  if (taglia) parts.push(Uint8Array.from([0x1b, 0x64, 0x05, 0x1d, 0x56, 0x42, 0x00]));
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* file scelto (foto del telefono, JPG/PNG/WebP/HEIC se il browser lo legge) -> immagine con l'orientamento EXIF giusto */
async function fotoCarica(file) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("Il file scelto non è un'immagine.");
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { } }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Il browser non riesce a leggere questa immagine (prova a salvarla come JPG).")); };
    im.src = url;
  });
}

/* ---------------- pagina /foto ---------------- */
const FT = { img: null, nome: "", ris: null, busy: false, pct: 0, err: "", originale: false, rot: 0, ...FOTO_DEF, ...(ls.get("blucheck_foto") || {}) };
const fotoPrefs = () => ls.set("blucheck_foto", { luminosita: FT.luminosita, contrasto: FT.contrasto, gamma: FT.gamma, nitidezza: FT.nitidezza, metodo: FT.metodo, auto: FT.auto, inverti: FT.inverti });
const fotoCarta = () => (FOTO_DOTS[btPref().carta] ? btPref().carta : 80);

function fotoAggiorna() {
  if (!FT.img) { FT.ris = null; return; }
  FT.ris = fotoElabora(FT.img, { ...FT, dots: FOTO_DOTS[fotoCarta()] });
}
let fotoTimer = 0;
function fotoRicalcola(subito) {
  clearTimeout(fotoTimer);
  const go = () => { try { fotoAggiorna(); FT.err = ""; } catch (e) { FT.err = e.message || String(e); } fotoDisegna(); };
  if (subito) go(); else fotoTimer = setTimeout(go, 60);
}

function fotoPannelli() {
  const carta = fotoCarta(), dots = FOTO_DOTS[carta], bt = btDisponibile(), ser = serDisponibile(), and = isAndroid();
  const seg = (act, val, voci) => voci.map(([v, l]) => `<button data-ft="${act}" data-v="${v}" aria-pressed="${String(val) === String(v)}">${l}</button>`).join("");
  const cursore = (k, l, min, max, step, fmt) => `<label class="field ft-range"><span>${l} <b id="ftv_${k}">${fmt(FT[k])}</b></span>
    <input type="range" data-fr="${k}" min="${min}" max="${max}" step="${step}" value="${FT[k]}"></label>`;
  const r = FT.ris, mm = (p) => (p / 8).toFixed(0); // 203 dpi = 8 punti per mm
  return `
  <div class="panel"><h2>1. Scegli la foto</h2>
    <p class="faint" style="margin:0">Dal telefono scatta una foto o prendila dalla galleria; dal computer trascinala qui, incollala (Ctrl+V) o sceglila dal disco. La foto resta sul dispositivo: non viene inviata a nessun server.</p>
    <div class="ft-drop" id="ftDrop" data-ft="scegli" tabindex="0" role="button">${FT.img ? `<b>${esc(FT.nome || "Foto")}</b><span>Tocca o trascina per cambiarla</span>` : `<b>Tocca per scegliere una foto</b><span>oppure trascinala qui</span>`}</div>
    <div class="row"><button class="btn" data-ft="scatta">Scatta foto</button><button class="btn" data-ft="scegli">Galleria / file</button>
      ${FT.img ? `<button class="btn sm" data-ft="ruota">Ruota 90°</button>` : ""}</div>
    <input type="file" id="ftFile" accept="image/*" hidden><input type="file" id="ftCam" accept="image/*" capture="environment" hidden></div>

  <div class="panel"><h2>2. Bianco e nero per la termica</h2>
    <div class="field"><span>Larghezza carta</span><div class="seg wide choose" role="group">${seg("carta", carta, [[80, "80 mm (576 punti)"], [58, "58 mm (384 punti)"]])}</div></div>
    <div class="field"><span>Retinatura (dithering)</span><div class="seg wide choose" role="group">${seg("metodo", FT.metodo, [["fs", "Foto (Floyd-Steinberg)"], ["atkinson", "Contrastata (Atkinson)"], ["soglia", "Testo / logo"]])}</div></div>
    <div class="grid2">
      ${cursore("luminosita", "Luminosità", -50, 50, 1, (v) => (v > 0 ? "+" : "") + v)}
      ${cursore("contrasto", "Contrasto", -50, 80, 1, (v) => (v > 0 ? "+" : "") + v)}
      ${cursore("gamma", "Gamma (mezzitoni)", 0.5, 2.5, 0.05, (v) => Number(v).toFixed(2))}
      ${cursore("nitidezza", "Nitidezza", 0, 100, 5, (v) => v + "%")}
    </div>
    <div class="row"><label class="check"><input type="checkbox" data-fc="auto" ${FT.auto ? "checked" : ""}> Livelli automatici</label>
      <label class="check"><input type="checkbox" data-fc="inverti" ${FT.inverti ? "checked" : ""}> Negativo</label>
      <button class="btn sm ghost" data-ft="reset">Valori consigliati</button></div>
    <p class="faint" style="margin:0">Se la stampa esce troppo scura alza la gamma o la luminosità; se è slavata alza il contrasto. Per scritte e loghi usa «Testo / logo».</p></div>

  <div class="panel"><div class="spread"><h2>3. Anteprima</h2>${r ? `<span class="faint">${r.w} × ${r.h} punti · ${mm(r.w)} × ${mm(r.h)} mm</span>` : ""}</div>
    ${r ? `<div class="ft-prev"><div class="ft-carta" style="--ft-w:${(r.w / dots) * 100}%"><canvas id="ftCanvas" data-ft="zoom" title="Tocca per vedere i punti veri"></canvas></div></div>
      <div class="row"><label class="check"><input type="checkbox" data-fc="originale" ${FT.originale ? "checked" : ""}> Mostra l'originale</label><span class="faint">Tocca l'anteprima per vedere i punti veri.</span></div>`
      : `<p class="faint" style="margin:0">Scegli una foto per vedere come uscirà sulla carta.</p>`}</div>

  <div class="panel"><h2>4. Stampa</h2>
    <p class="faint" style="margin:0">${bt ? "Bluetooth diretto: stampanti «BLE» con Chrome o Edge (Android o computer)." : and ? "Questo browser non vede le stampanti Bluetooth: apri la pagina con Chrome, oppure usa RawBT." : "Dal computer usa «USB / porta COM» (Chrome o Edge) o «Stampa col driver»; su iPhone «Condividi» e scegli l'app della stampante."}${btPref().nome ? ` Ultima stampante: <b>${esc(btPref().nome)}</b>.` : ""}</p>
    <div class="row">
      ${bt ? `<button class="btn primary" data-ft="bt" ${!r || FT.busy ? "disabled" : ""}>${FT.busy ? `Stampa in corso… ${Math.round(FT.pct * 100)}%` : "Stampa con Bluetooth"}</button>${Termica.device ? `<button class="btn sm" data-ft="bt-cambia" ${!r || FT.busy ? "disabled" : ""}>Cambia stampante</button>` : ""}` : ""}
      ${and ? `<button class="btn" data-ft="rawbt" ${!r ? "disabled" : ""}>Stampa con RawBT</button>` : ""}
      ${ser ? `<button class="btn${bt ? "" : " primary"}" data-ft="ser" ${!r || FT.busy ? "disabled" : ""}>Stampa da USB / porta COM</button>` : ""}
      <button class="btn" data-ft="driver" ${!r ? "disabled" : ""}>Stampa col driver</button>
      <button class="btn" data-ft="png" ${!r ? "disabled" : ""}>${navigator.canShare ? "Condividi" : "Scarica"} immagine</button></div>
    ${bt ? `<label class="check"><input type="checkbox" data-fc="lenta" ${btPref().lenta ? "checked" : ""}> Modalità compatibile (più lenta): usala se la stampa esce tagliata o con righe strane</label>` : ""}
    ${FT.err ? `<div class="qrres"><b>Stampa non riuscita</b>${esc(FT.err)}</div>` : ""}</div>`;
}
function fotoDisegna() {
  const el = $("#ftRoot"); if (!el) return;
  const y = window.scrollY; el.innerHTML = fotoPannelli(); window.scrollTo(0, y);
  fotoTela();
}
// anteprima: rimpicciolita con un buon filtro (si vede il grigio che darà la retinatura, senza il moiré di un
// ridimensionamento grezzo); tocco sull'anteprima = punti veri 1:1 (si scorre di lato)
function fotoTela() {
  const cv = $("#ftCanvas"); if (!cv || !FT.ris) return;
  const r = FT.ris, src = FT.originale ? fotoElaboraColori(FT.img, r.w, r.h, FT.rot) : r.canvas;
  cv.classList.toggle("zoom", !!FT.zoom);
  let w = r.w, h = r.h;
  if (!FT.zoom) { const css = cv.getBoundingClientRect().width || r.w, dpr = window.devicePixelRatio || 1; w = Math.min(r.w, Math.max(1, Math.round(css * dpr))); h = Math.max(1, Math.round(r.h * w / r.w)); }
  cv.width = w; cv.height = h; const c = cv.getContext("2d");
  c.imageSmoothingEnabled = !FT.zoom; c.imageSmoothingQuality = "high"; c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); c.drawImage(src, 0, 0, w, h);
  const img = $("#ftStampa"); if (img) { img.src = r.canvas.toDataURL("image/png"); $("#ftPrint").className = "ft-print" + (fotoCarta() === 58 ? " c58" : ""); }
}
function fotoElaboraColori(src, w, h, rot) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d");
  const r = ((rot % 360) + 360) % 360, t = r === 90 || r === 270;
  x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.translate(w / 2, h / 2); x.rotate(r * Math.PI / 180);
  x.drawImage(src, -(t ? h : w) / 2, -(t ? w : h) / 2, t ? h : w, t ? w : h); return cv;
}

async function fotoApri(file) {
  if (!file) return;
  try { FT.img = await fotoCarica(file); FT.nome = file.name || "Foto"; FT.rot = 0; FT.originale = false; fotoRicalcola(true); }
  catch (e) { toast(e.message || String(e), 4000); }
}
const fotoBytes = () => { if (!FT.ris) throw new Error("Scegli prima una foto."); return escposFoto(FT.ris); };
async function fotoInvia(come) {
  if (FT.busy || !FT.ris) return; FT.busy = true; FT.pct = 0; FT.err = ""; fotoDisegna();
  let last = 0; const prog = (p) => { if (p - last >= 0.05 || p === 1) { last = p; FT.pct = p; const b = $('[data-ft="bt"]'); if (b) b.textContent = `Stampa in corso… ${Math.round(p * 100)}%`; } };
  try {
    if (come === "ser") await serStampa(fotoBytes(), false, prog);
    else { await btCollega(come === "bt-cambia"); await btStampa(fotoBytes(), prog); }
    toast("Foto inviata alla stampante");
  } catch (e) {
    const annullato = e?.name === "NotFoundError" && (come === "ser" || /cancel/i.test(e.message || ""));
    if (!annullato) FT.err = e?.name === "NetworkError" ? "La stampante non risponde: controlla che sia accesa, vicina e non collegata a un altro telefono." : e?.name === "NotFoundError" ? "Nessuna stampante scelta. Se la tua non compare nell'elenco è Bluetooth classico: usa RawBT (Android) o la porta COM (computer)." : e.message || String(e);
    if (e?.name === "NetworkError") Termica.ch = null;
  }
  FT.busy = false; fotoDisegna();
}
async function fotoPng() {
  const blob = await new Promise((r) => FT.ris.canvas.toBlob(r, "image/png"));
  const nome = (FT.nome || "foto").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 40) + `_termica_${fotoCarta()}mm.png`;
  const f = new File([blob], nome, { type: "image/png" });
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: nome }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function fotoAvvia() {
  if (!$("#ftRoot")) return;
  fotoDisegna();
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-ft]"); if (!el || el.disabled) return;
    const v = el.dataset.v;
    switch (el.dataset.ft) {
      case "scegli": $("#ftFile").click(); break;
      case "scatta": $("#ftCam").click(); break;
      case "ruota": FT.rot = (FT.rot + 90) % 360; fotoRicalcola(true); break;
      case "carta": ls.set(BT_PREF, { ...btPref(), carta: Number(v) }); fotoRicalcola(true); break;
      case "metodo": FT.metodo = v; fotoPrefs(); fotoRicalcola(true); break;
      case "reset": Object.assign(FT, FOTO_DEF); fotoPrefs(); fotoRicalcola(true); break;
      case "bt": case "bt-cambia": case "ser": await fotoInvia(el.dataset.ft); break;
      case "rawbt": try { location.href = rawbtUrl(fotoBytes()); setTimeout(() => toast("Se non si apre niente, installa RawBT dal Play Store e collega lì la stampante.", 6000), 1500); } catch (err) { toast(err.message); } break;
      case "driver": fotoTela(); window.print(); break;
      case "png": await fotoPng(); break;
      case "zoom": FT.zoom = !FT.zoom; fotoTela(); break;
    }
  });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.id === "ftDrop") { e.preventDefault(); $("#ftFile").click(); } });
  document.addEventListener("input", (e) => {
    const k = e.target.dataset.fr; if (!k) return;
    FT[k] = Number(e.target.value); const lab = $("#ftv_" + k);
    if (lab) lab.textContent = k === "gamma" ? FT[k].toFixed(2) : k === "nitidezza" ? FT[k] + "%" : (FT[k] > 0 ? "+" : "") + FT[k];
    fotoPrefs(); clearTimeout(fotoTimer);
    fotoTimer = setTimeout(() => { try { fotoAggiorna(); fotoTela(); } catch (err) { toast(err.message); } }, 80); // solo la tela: il cursore resta in mano
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "ftFile" || t.id === "ftCam") { fotoApri(t.files?.[0]); t.value = ""; return; }
    const k = t.dataset.fc; if (!k) return;
    if (k === "lenta") { ls.set(BT_PREF, { ...btPref(), lenta: t.checked }); return; }
    if (k === "originale") { FT.originale = t.checked; fotoTela(); return; }
    FT[k] = t.checked; fotoPrefs(); fotoRicalcola(true);
  });
  // computer: trascina e incolla
  document.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); $("#ftDrop")?.classList.add("on"); } });
  document.addEventListener("dragleave", (e) => { if (e.target.id === "ftDrop") e.target.classList.remove("on"); });
  document.addEventListener("drop", (e) => { const f = [...(e.dataTransfer?.files || [])].find((x) => /^image\//.test(x.type)); if (!f) return; e.preventDefault(); $("#ftDrop")?.classList.remove("on"); fotoApri(f); });
  document.addEventListener("paste", (e) => { const it = [...(e.clipboardData?.items || [])].find((x) => /^image\//.test(x.type)); if (it) { e.preventDefault(); fotoApri(it.getAsFile()); } });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fotoAvvia); else fotoAvvia();
