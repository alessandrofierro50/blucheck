"use strict";
/* BluCheck - funzioni condivise */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = (n) => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowHM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function addYears(iso, n) { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); const t = new Date(y + n, m - 1, d); if (t.getMonth() !== m - 1) t.setDate(0); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; }
function daysTo(iso) { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); const a = new Date(y, m - 1, d); const b = new Date(); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 86400000); }
const fmtD = (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const fmtDT = (iso) => { if (!iso) return "—"; const d = new Date(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const euro = (cent) => (Number(cent || 0) / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const norm = (s) => String(s || "").toLowerCase();

function toast(msg, ms = 2800) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};

class ApiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
let onAuthLost = null;
async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, {
      method, credentials: "same-origin",
      headers: { "content-type": "application/json", "x-blucheck": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError("Connessione assente. Controlla la rete e riprova.", 0, "rete"); }
  let j = null; try { j = await r.json(); } catch { }
  if (!r.ok) {
    if (r.status === 401 && onAuthLost && !url.endsWith("/api/login")) onAuthLost();
    throw new ApiError(j?.error || `Errore ${r.status}`, r.status, j?.code);
  }
  return j;
}

/* ---------------- firma su schermo ---------------- */
function openPad(title, onDone) {
  const root = $("#padRoot");
  root.innerHTML = `<div class="signpad" role="dialog" aria-modal="true"><div class="spread"><h2>${esc(title)}</h2><span class="faint">Firma con il dito nel riquadro bianco</span></div>
    <canvas id="padCanvas"></canvas>
    <div class="spread"><button class="btn" id="padClear">Cancella</button><div class="row"><button class="btn" id="padCancel">Annulla</button><button class="btn primary" id="padOk">Conferma firma</button></div></div></div>`;
  const cv = $("#padCanvas"), ctx = cv.getContext("2d"); let drawing = false, last = null, dirty = false;
  const style = () => { ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13246b"; ctx.fillStyle = "#13246b"; };
  const fit = () => {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const old = dirty ? (() => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; c.getContext("2d").drawImage(cv, 0, 0); return c; })() : null;
    cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); style();
    if (old) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(old, 0, 0); ctx.restore(); }
  };
  fit(); const ro = new ResizeObserver(fit); ro.observe(cv);
  const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener("pointerdown", (e) => { drawing = true; dirty = true; last = pt(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2); ctx.fill(); });
  cv.addEventListener("pointermove", (e) => {
    if (!drawing) return; const p = pt(e); const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.beginPath(); ctx.moveTo(last.lx ?? last.x, last.ly ?? last.y); ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.stroke(); last = { ...p, lx: mid.x, ly: mid.y };
  });
  const end = () => { drawing = false; }; cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  const close = () => { ro.disconnect(); root.innerHTML = ""; };
  $("#padClear").onclick = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); dirty = false; };
  $("#padCancel").onclick = close;
  $("#padOk").onclick = () => { if (!dirty) return toast("Il riquadro è vuoto: firma prima di confermare."); const url = trimSignature(cv); close(); onDone(url); };
}
function trimSignature(cv) {
  const ctx = cv.getContext("2d"), { width: w, height: h } = cv, d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = 12; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
  const sw = Math.max(1, x1 - x0), sh = Math.max(1, y1 - y0), scale = Math.min(1, 600 / sw, 240 / sh);
  const out = document.createElement("canvas"); out.width = Math.max(1, Math.round(sw * scale)); out.height = Math.max(1, Math.round(sh * scale));
  const o = out.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height); o.drawImage(cv, x0, y0, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/* ---------------- QR code ---------------- */
function decodeQRFromImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      for (const max of [1400, 900, 2000, 600]) {
        const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height);
        const r = window.jsQR ? jsQR(d.data, c.width, c.height, { inversionAttempts: "attemptBoth" }) : null;
        if (r?.data) return resolve(r.data);
      }
      reject(new Error("Nessun QR code riconosciuto nella foto. Avvicinati, inquadra solo il QR e tieni fermo il telefono."));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Immagine non leggibile.")); };
    img.src = url;
  });
}
/** Scanner dal vivo con la fotocamera. Risolve con il testo letto, oppure null se annullato. "foto" se l'utente preferisce una foto. */
function scanQRLive() {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return resolve("foto");
    const root = $("#padRoot");
    root.innerHTML = `<div class="scanner" role="dialog" aria-modal="true"><video id="scanVideo" playsinline muted></video><div class="frame"></div>
      <div class="msg" id="scanMsg">Inquadra il QR code della targhetta</div>
      <div class="ctrl"><button class="btn" id="scanPhoto">Usa una foto</button><button class="btn" id="scanCancel">Annulla</button></div></div>`;
    const video = $("#scanVideo"); const c = document.createElement("canvas"); const x = c.getContext("2d", { willReadFrequently: true });
    let stream = null, done = false, raf = 0;
    const finish = (v) => { if (done) return; done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); root.innerHTML = ""; resolve(v); };
    $("#scanCancel").onclick = () => finish(null);
    $("#scanPhoto").onclick = () => finish("foto");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false }).then((s) => {
      if (done) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; video.srcObject = s; video.play().catch(() => { });
      const tick = () => {
        if (done) return;
        if (video.readyState >= 2 && video.videoWidth) {
          const sc = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
          c.width = Math.round(video.videoWidth * sc); c.height = Math.round(video.videoHeight * sc);
          x.drawImage(video, 0, 0, c.width, c.height);
          const r = window.jsQR ? jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" }) : null;
          if (r?.data) { navigator.vibrate?.(80); return finish(r.data); }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => { $("#scanMsg").textContent = "Fotocamera non disponibile: consenti l'accesso alla fotocamera oppure usa una foto."; });
  });
}

/* ---------------- file ---------------- */
function scaricaFile(nome, blob) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function fileToJpegBase64(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url); const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Immagine non leggibile.")); };
    img.src = url;
  });
}
