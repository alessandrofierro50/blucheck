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

/* ---------------- tasto «Elenco» con «Nuovo» (standard BluCode, 2026-11-04) ----------------
   Accanto a una casella di scelta: lookupRow(casella, nome, etichetta) aggiunge il tasto con l'icona elenco (anche F4 nella casella).
   Lookups[nome] = (tasto) => openLookup({...}) apre la finestra: elenco alfabetico, ricerca in basso, frecce, Invio, clic, Esc,
   «Nuovo» con un piccolo modulo che salva e lascia scelto l'elemento creato. Sul telefono la finestra è a tutto schermo. */
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/></svg>`;
const Lookups = {};
const lookupBtn = (name, label) => `<button type="button" class="btn lk-btn" data-lookup="${esc(name)}" title="Elenco ${esc(label)} (F4)" aria-label="Elenco ${esc(label)} (F4)">${ICON_LIST}</button>`;
const lookupRow = (control, name, label) => `<div class="lk-row">${control}${lookupBtn(name, label)}</div>`;
/** Testo senza maiuscole né accenti, per la ricerca. */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Mette il valore scelto in una <select> (aggiunge l'opzione se manca) e avvisa l'app come se l'avesse scelto l'utente. */
function pickIntoSelect(sel, value, label) {
  if (!sel) return;
  if (![...sel.options].some((o) => o.value === value)) { const o = document.createElement("option"); o.value = value; o.textContent = label || value; sel.appendChild(o); }
  sel.value = value; sel.classList.remove("hl");
  sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true }));
  sel.focus();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-lookup]"); if (!b) return;
  e.preventDefault(); Lookups[b.dataset.lookup]?.(b);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "F4") return;
  const row = e.target.closest?.(".lk-row"); if (!row) return;
  e.preventDefault(); row.querySelector(".lk-btn")?.click();
});

/**
 * Apre la finestra dell'elenco.
 * o.title, o.rows (array), o.sortKey(row), o.hay(row) testo in cui cercare, o.view(row) → { t, s, r } (HTML già sicuro),
 * o.placeholder, o.current (id scelto ora), o.onPick(row), o.opener (elemento da rimettere a fuoco),
 * o.create (facoltativo) = { label, title, fields: [{ k, l, type, cls, attrs, wide, text(v), pick(v, set) }], initial(q), note, save(vals) → row }
 */
function openLookup(o) {
  const rows = o.rows.slice().sort((x, y) => fold(o.sortKey(x)).localeCompare(fold(o.sortKey(y)), "it"));
  const wrap = document.createElement("div"); wrap.className = "lk-wrap";
  const tid = "lkT" + uid();
  wrap.innerHTML = `<div class="lk" role="dialog" aria-modal="true" aria-labelledby="${tid}"></div>`;
  const box = wrap.firstElementChild;
  const prevOverflow = document.body.style.overflow;
  document.body.appendChild(wrap); document.body.style.overflow = "hidden";
  const opener = o.opener || document.activeElement;
  const STEP = 200;
  let q = "", list = rows, active = 0, shown = STEP, mode = "list", vals = null;
  const close = () => { wrap.remove(); if (!document.querySelector(".lk-wrap")) document.body.style.overflow = prevOverflow; opener?.focus?.(); };
  const pick = (row) => { if (!row) return; close(); o.onPick(row); };
  const filter = () => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    list = words.length ? rows.filter((r) => { const h = fold(o.hay(r)); return words.every((w) => h.includes(w)); }) : rows;
    active = 0; shown = STEP;
  };
  const optHtml = (r, i) => { const v = o.view(r); return `<button type="button" class="lk-opt" role="option" data-i="${i}" aria-selected="${i === active}" tabindex="-1">
    <span style="min-width:0"><span class="t">${v.t}</span>${v.s ? `<br><span class="s">${v.s}</span>` : ""}</span>${v.r ? `<span>${v.r}</span>` : "<span></span>"}</button>`; };
  const paintList = () => {
    const el = box.querySelector(".lk-list"); if (!el) return;
    el.innerHTML = list.length ? list.slice(0, shown).map(optHtml).join("") + (list.length > shown ? `<div class="lk-more faint">Altri ${list.length - shown}: scorri o affina la ricerca</div>` : "")
      : `<div class="empty">Nessun risultato${q ? ` per «${esc(q)}»` : ""}.${o.create ? ` <span>Puoi crearlo con «${esc(o.create.label)}».</span>` : ""}</div>`;
    box.querySelector(".lk-count").textContent = q ? `${list.length} di ${rows.length}` : `${rows.length} in ordine alfabetico`;
  };
  const setActive = (i) => {
    if (!list.length) return;
    active = Math.max(0, Math.min(list.length - 1, i));
    if (active >= shown) { shown = active + STEP; paintList(); }
    box.querySelectorAll(".lk-opt").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.i === active)));
    box.querySelector(`.lk-opt[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const paint = () => {
    if (mode === "list") {
      box.innerHTML = `<div class="lk-head"><h2 id="${tid}">${esc(o.title)} <span class="faint lk-count"></span></h2><button type="button" class="btn ghost sm" data-lk="close">Chiudi</button></div>
        <div class="lk-list" role="listbox" aria-label="${esc(o.title)}"></div>
        <div class="lk-foot"><div class="lk-search"><input type="search" class="lk-q" placeholder="${esc(o.placeholder || "Cerca")}" value="${esc(q)}" autocomplete="off" enterkeyhint="go" aria-label="Cerca">
          ${o.create ? `<button type="button" class="btn" data-lk="new">+ ${esc(o.create.label)}</button>` : ""}</div>
          <span class="faint lk-hint">Frecce per scorrere · Invio per scegliere · clic sulla riga · Esc per chiudere</span></div>`;
      paintList();
      const cur = o.current ? list.findIndex((r) => r.id === o.current) : -1;
      if (cur >= 0 && !q) setActive(cur);
      const inp = box.querySelector(".lk-q");
      inp.addEventListener("input", () => { q = inp.value; filter(); paintList(); box.querySelector(".lk-list").scrollTop = 0; });
      if (window.matchMedia?.("(pointer: fine)").matches) inp.focus(); else box.querySelector(".lk-list").focus?.();
      const lst = box.querySelector(".lk-list"); lst.tabIndex = -1;
      lst.addEventListener("scroll", () => { if (list.length > shown && lst.scrollTop + lst.clientHeight > lst.scrollHeight - 120) { shown += STEP; paintList(); } });
      lst.addEventListener("mousemove", (e) => { const b = e.target.closest(".lk-opt"); if (b && +b.dataset.i !== active) setActive(+b.dataset.i); });
      return;
    }
    const c = o.create, F = c.fields;
    const fieldHtml = (f) => {
      const id = "lkf_" + f.k;
      if (f.type === "pick") return `<div class="field ${f.wide ? "lk-wide" : ""}"><span>${esc(f.l)}</span><div class="lk-row"><input type="text" id="${id}" data-k="${f.k}" readonly placeholder="Tocca per scegliere" value="${esc(f.text(vals[f.k]))}" class="lk-pickin">${`<button type="button" class="btn lk-btn" data-lk="pick" data-k="${f.k}" title="Elenco (F4)" aria-label="Scegli ${esc(f.l)} dall'elenco (F4)">${ICON_LIST}</button>`}</div></div>`;
      return `<label class="field ${f.wide ? "lk-wide" : ""}"><span>${esc(f.l)}</span><input type="${f.type || "text"}" id="${id}" data-k="${f.k}" class="${f.cls || ""}" value="${esc(vals[f.k] ?? "")}" ${f.attrs || ""}></label>`;
    };
    box.innerHTML = `<div class="lk-head"><h2 id="${tid}">${esc(c.title || c.label)}</h2><button type="button" class="btn ghost sm" data-lk="close">Chiudi</button></div>
      <form class="lk-form" novalidate><div class="grid2">${F.map(fieldHtml).join("")}</div>
        ${c.note ? `<p class="faint" style="margin:0">${esc(c.note)}</p>` : ""}<div class="err lk-err" role="alert"></div>
        <div class="row"><button type="submit" class="btn primary">Salva e scegli</button><button type="button" class="btn" data-lk="back">Torna all'elenco</button></div></form>`;
    const form = box.querySelector("form");
    form.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k && e.target.type !== "checkbox") vals[k] = e.target.value; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true; box.querySelector(".lk-err").textContent = "";
      try { const row = await c.save({ ...vals }); pick(row); }
      catch (err) { box.querySelector(".lk-err").textContent = err.message || "Salvataggio non riuscito."; btn.disabled = false; }
    });
    const first = form.querySelector("input:not([readonly])"); first?.focus();
  };
  box.addEventListener("click", (e) => {
    const opt = e.target.closest(".lk-opt"); if (opt) return pick(list[+opt.dataset.i]);
    const b = e.target.closest("[data-lk]"); if (!b) return;
    const a = b.dataset.lk;
    if (a === "close") close();
    else if (a === "new") { mode = "new"; vals = o.create.initial ? o.create.initial(q.trim()) : {}; paint(); }
    else if (a === "back") { mode = "list"; paint(); }
    else if (a === "pick") {
      const f = o.create.fields.find((x) => x.k === b.dataset.k);
      f.pick(vals[f.k], (v) => { vals[f.k] = v; const inp = box.querySelector("#lkf_" + f.k); if (inp) inp.value = f.text(v); b.focus(); });
    }
  });
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key === "Tab") { // il fuoco resta nella finestra
      const f = [...box.querySelectorAll("button:not([disabled]),input,select,textarea")].filter((x) => x.offsetParent !== null);
      if (f.length && e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (f.length && !e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (mode !== "list") return;
    const inList = e.target.classList.contains("lk-q") || e.target.closest(".lk-list");
    if (!inList) return;
    const k = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
    if (k) { e.preventDefault(); setActive(active + k); return; }
    if (e.key === "Enter") { e.preventDefault(); const opt = e.target.closest(".lk-opt"); pick(list[opt ? +opt.dataset.i : active]); }
  });
  paint();
  return { close };
}
