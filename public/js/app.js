"use strict";
/* BluCheck - app dei tecnici */

const S = {
  config: { stripe: false, ai: false, contatti: {} },
  me: null, azienda: null, abb: null, tecnici: [],
  clienti: [], apparecchi: [], verifiche: [], firmaTecnico: "",
  lastSync: null, loaded: false,
};
const UI = { tab: "scadenze", filtro: "tutte", tipo: "tutti", q: "", qa: "", qc: "", qv: "", sheet: null, form: null, confirm: null, set: null };
const VALID_TABS = ["scadenze", "apparecchi", "clienti", "verifiche", "impostazioni"];
const isAdmin = () => S.me?.ruolo === "admin";
const readonly = () => !!S.abb?.scaduto;
const lab = () => {
  const a = S.azienda || {}; const imp = a.impostazioni || {};
  return { ragione: a.ragione || "", indirizzo: a.indirizzo || "", cap: a.cap || "", piva: a.piva || "", telefono: a.telefono || "", email: a.email || "",
    luogo: imp.luogo || "", preavviso: Number(imp.preavviso) || 60 };
};

/* ============================== accesso ============================== */
onAuthLost = () => { if (S.me) { S.me = null; showLogin("La sessione è scaduta: entra di nuovo."); } };
function showLogin(msg) {
  $("#appRoot").hidden = true; $("#sheetRoot").innerHTML = ""; $("#barRoot").innerHTML = "";
  $("#authRoot").innerHTML = `<div class="auth gut"><form class="auth-card" id="loginForm" novalidate>
    <a class="logo" href="/"><img src="/img/blucheck.svg" alt="" width="28" height="28"><span>Blu<b>Check</b></span></a>
    <div><h1 style="font-size:24px">Accedi</h1><p class="faint" style="margin:4px 0 0">Verificazioni periodiche dei registratori telematici</p></div>
    <label class="field"><span>Email</span><input type="email" id="lgEmail" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input type="password" id="lgPwd" autocomplete="current-password" required></label>
    <div class="err" id="lgErr">${esc(msg || "")}</div>
    <button class="btn primary lg" type="submit">Entra</button>
    <p class="faint" style="margin:0">Password dimenticata? Chiedi all'amministratore della tua azienda di reimpostarla.</p>
    <p class="faint" style="margin:0">Non hai ancora un account? <a href="/#prezzi">Richiedi l'attivazione</a></p>
  </form></div>`;
  $("#lgEmail").focus();
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#lgErr").textContent = "";
    try {
      const r = await api("POST", "/api/login", { email: $("#lgEmail").value, password: $("#lgPwd").value });
      if (r.ruolo === "superuser") { location.href = "/admin"; return; }
      await start();
    } catch (err) { $("#lgErr").textContent = err.message; }
  });
}
function showChangePassword(forced) {
  $("#appRoot").hidden = true;
  $("#authRoot").innerHTML = `<div class="auth gut"><form class="auth-card" id="pwForm" novalidate>
    <a class="logo" href="/app"><img src="/img/blucheck.svg" alt="" width="28" height="28"><span>Blu<b>Check</b></span></a>
    <div><h1 style="font-size:22px">Scegli una nuova password</h1><p class="faint" style="margin:4px 0 0">${forced ? "Stai usando una password provvisoria: sostituiscila con una tua." : "Almeno 8 caratteri."}</p></div>
    <label class="field"><span>Password attuale${forced ? " (quella provvisoria)" : ""}</span><input type="password" id="pwOld" autocomplete="current-password"></label>
    <label class="field"><span>Nuova password</span><input type="password" id="pwNew" autocomplete="new-password"></label>
    <label class="field"><span>Ripeti la nuova password</span><input type="password" id="pwNew2" autocomplete="new-password"></label>
    <div class="err" id="pwErr"></div>
    <div class="row"><button class="btn primary" type="submit">Salva password</button>${forced ? "" : `<button class="btn" type="button" id="pwCancel">Annulla</button>`}</div>
  </form></div>`;
  $("#pwOld").focus();
  $("#pwCancel")?.addEventListener("click", () => { $("#authRoot").innerHTML = ""; $("#appRoot").hidden = false; render(); });
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#pwNew").value !== $("#pwNew2").value) { $("#pwErr").textContent = "Le due password non coincidono."; return; }
    try { await api("POST", "/api/me/password", { attuale: $("#pwOld").value, nuova: $("#pwNew").value }); toast("Password aggiornata"); await start(); }
    catch (err) { $("#pwErr").textContent = err.message; }
  });
}

async function start() {
  let me;
  try { me = await api("GET", "/api/me"); } catch { return showLogin(); }
  if (me.user.ruolo === "superuser") { location.href = "/admin"; return; }
  if (me.user.cambia_pwd) return showChangePassword(true);
  try {
    const [b, cfg, firma] = await Promise.all([api("GET", "/api/bootstrap"), api("GET", "/api/config"), api("GET", "/api/me/firma")]);
    S.config = cfg; S.firmaTecnico = firma.firma || "";
    applyBootstrap(b);
  } catch (e) { return showLogin(e.message); }
  $("#authRoot").innerHTML = ""; $("#appRoot").hidden = false;
  S.loaded = true;
  fromHash();
  render();
  handlePaymentReturn();
}
function applyBootstrap(b) {
  S.me = b.me; S.azienda = b.azienda; S.abb = b.abbonamento; S.tecnici = b.tecnici || [];
  S.clienti = b.clienti; S.apparecchi = b.apparecchi; S.verifiche = b.verifiche; S.lastSync = b.now;
}
async function sync() {
  if (!S.loaded || document.visibilityState !== "visible") return;
  try {
    const r = await api("GET", "/api/sync?since=" + encodeURIComponent(S.lastSync || ""));
    S.lastSync = r.now; S.azienda = r.azienda; S.abb = r.abbonamento;
    let changed = false;
    for (const row of r.rows) {
      const arr = S[row.coll]; const i = arr.findIndex((x) => x.id === row.id);
      if (row.eliminato) { if (i >= 0) { arr.splice(i, 1); changed = true; } }
      else if (i >= 0) { if (JSON.stringify(arr[i]) !== JSON.stringify(row.data)) { arr[i] = row.data; changed = true; } }
      else { arr.push(row.data); changed = true; }
    }
    if (changed) render(true);
  } catch { }
}
setInterval(sync, 45000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

/* ============================== archivio ============================== */
async function put(coll, id, obj) {
  const r = await api("PUT", `/api/dati/${coll}/${id}`, { data: obj });
  if (coll !== "firme") { const arr = S[coll]; const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr[i] = r.data; else arr.push(r.data); }
  return r.data;
}
async function del(coll, id) {
  await api("DELETE", `/api/dati/${coll}/${id}`);
  if (coll !== "firme") { const arr = S[coll]; const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr.splice(i, 1); }
}
async function getDoc(coll, id) { return (await api("GET", `/api/dati/${coll}/${id}`)).data; }
function apiError(e) {
  console.error(e);
  if (e.code === "abbonamento_scaduto") { S.abb = { ...(S.abb || {}), scaduto: true }; render(); }
  toast(e.message || "Operazione non riuscita.");
}
function guardWrite() {
  if (readonly()) { toast(isAdmin() ? "Abbonamento scaduto: rinnova da Impostazioni > Abbonamento." : "Abbonamento scaduto: chiedi all'amministratore di rinnovarlo."); return false; }
  return true;
}

/* ============================== derivati ============================== */
const cliente = (id) => S.clienti.find((c) => c.id === id);
const apparecchio = (id) => S.apparecchi.find((a) => a.id === id);
function scadenze(a) {
  const out = [{ tipo: "VP", label: "Verificazione periodica", ultima: a.ultimaVerifica, data: a.ultimaVerifica ? addYears(a.ultimaVerifica, 2) : "" }];
  if (a.dgfeAnnuale) out.push({ tipo: "DGFE", label: "DGFE (annuale)", ultima: a.ultimoDgfe, data: a.ultimoDgfe ? addYears(a.ultimoDgfe, 1) : "" });
  return out;
}
function stato(iso) {
  const n = daysTo(iso); const pre = lab().preavviso;
  if (n === null) return { cls: "n", txt: "Data mancante", n: null };
  if (n < 0) return { cls: "bad", txt: `Scaduta da ${-n} gg`, n };
  if (n <= 30) return { cls: "warn", txt: n === 0 ? "Scade oggi" : `Tra ${n} gg`, n };
  if (n <= pre) return { cls: "warn", txt: `Tra ${n} gg`, n };
  return { cls: "ok", txt: `Tra ${n} gg`, n };
}
function allScadenze() {
  const rows = [];
  for (const a of S.apparecchi) { if (a.dismesso) continue; for (const s of scadenze(a)) rows.push({ a, c: cliente(a.clienteId), ...s, st: stato(s.data) }); }
  rows.sort((x, y) => ((x.data || "0000") < (y.data || "0000") ? -1 : 1));
  return rows;
}
const tecnicoNome = (id) => S.tecnici.find((t) => t.id === id)?.nome || "";

/* ============================== render ============================== */
function fromHash() { const h = location.hash.slice(1); if (VALID_TABS.includes(h)) UI.tab = h; }
window.addEventListener("hashchange", () => { if (UI.form) return; fromHash(); render(); });

function render(fromSync) {
  if (!S.loaded) return;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", !UI.form && b.dataset.tab === UI.tab ? "page" : "false"));
  $("#brandSub").textContent = `${S.azienda?.ragione || ""} · ${S.me?.nome || ""}`;
  const m = $("#main");
  if (UI.form) { if (!m.dataset.form) { m.innerHTML = viewForm(); m.dataset.form = "1"; } refreshFormDyn(); renderBar(); if (!fromSync) renderSheet(); else refreshSheetDyn(); return; }
  delete m.dataset.form;
  if (fromSync && UI.tab === "impostazioni") { renderBar(); return; }
  const active = document.activeElement, aid = active?.id, pos = active?.selectionStart;
  let html = banners();
  html += ({ scadenze: viewScadenze, apparecchi: viewApparecchi, clienti: viewClienti, verifiche: viewVerifiche, impostazioni: viewImpostazioni })[UI.tab]();
  m.innerHTML = html;
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
  renderBar();
  if (fromSync) { if (UI.sheet && !["app-edit", "cli-edit"].includes(UI.sheet.kind)) renderSheet(); } else renderSheet();
  if (UI.tab === "impostazioni" && isAdmin()) { if (UI.set) { paintTecnici(); paintAbb(); } loadImpostazioni(); }
}
function banners() {
  const a = S.abb; if (!a) return "";
  if (a.scaduto) return `<div class="banner bad"><span><b>Abbonamento scaduto${a.fine ? " il " + fmtD(a.fine) : ""}.</b> Puoi consultare l'archivio e stampare i rapporti, ma non registrare nuove verifiche.</span>${isAdmin() ? `<button class="btn sm primary" data-act="go-abb">Rinnova</button>` : `<span class="faint">Avvisa l'amministratore della tua azienda.</span>`}</div>`;
  if (a.inScadenza && isAdmin()) return `<div class="banner"><span>L'abbonamento scade il <b>${fmtD(a.fine)}</b> (tra ${a.giorni} giorni).</span><button class="btn sm" data-act="go-abb">Rinnova</button></div>`;
  return "";
}

function viewScadenze() {
  const rows = allScadenze(); const pre = lab().preavviso;
  const cnt = {
    scadute: rows.filter((r) => r.st.n !== null && r.st.n < 0).length, m30: rows.filter((r) => r.st.n !== null && r.st.n >= 0 && r.st.n <= 30).length,
    pre: rows.filter((r) => r.st.n !== null && r.st.n >= 0 && r.st.n <= pre).length, mancanti: rows.filter((r) => r.st.n === null).length,
  };
  const q = norm(UI.q);
  let f = rows.filter((r) => UI.tipo === "tutti" || r.tipo === UI.tipo);
  if (UI.filtro === "scadute") f = f.filter((r) => r.st.n !== null && r.st.n < 0);
  if (UI.filtro === "m30") f = f.filter((r) => r.st.n !== null && r.st.n >= 0 && r.st.n <= 30);
  if (UI.filtro === "pre") f = f.filter((r) => r.st.n !== null && r.st.n >= 0 && r.st.n <= pre);
  if (UI.filtro === "mancanti") f = f.filter((r) => r.st.n === null);
  if (q) f = f.filter((r) => norm([r.c?.ragione, r.c?.piva, r.a.matricola, r.a.modello, r.a.indirizzo, r.a.localita].join(" ")).includes(q));
  const stat = (k, cls, n, l) => `<button class="stat ${cls} ${UI.filtro === k ? "sel" : ""}" data-act="filtro" data-v="${k}"><b>${n}</b><span class="faint">${l}</span></button>`;
  return `
  <div class="stats">${stat("scadute", "bad", cnt.scadute, "Scadute")}${stat("m30", "warn", cnt.m30, "Entro 30 giorni")}${stat("pre", "", cnt.pre, `Entro ${pre} giorni`)}${stat("mancanti", "", cnt.mancanti, "Senza data")}</div>
  <div class="spread">
    <div class="chips" role="group" aria-label="Tipo scadenza">
      ${[["tutti", "Tutte"], ["VP", "Verifica biennale"], ["DGFE", "DGFE annuale"]].map(([k, l]) => `<button class="chip" aria-pressed="${UI.tipo === k}" data-act="tipo" data-v="${k}">${l}</button>`).join("")}
      ${UI.filtro !== "tutte" ? `<button class="chip" data-act="filtro" data-v="tutte">✕ Mostra tutte</button>` : ""}
    </div>
    <button class="btn sm" data-act="csv-scad">Esporta CSV</button>
  </div>
  <input type="search" id="qScad" placeholder="Cerca cliente, P.IVA, matricola, modello…" value="${esc(UI.q)}" data-bind="q">
  ${f.length ? `<div class="list">${f.map((r) => `
    <button class="item" data-act="open-app" data-id="${r.a.id}">
      <span class="stripe ${r.st.cls}"></span>
      <span style="min-width:0"><span class="t">${esc(r.c?.ragione || "Cliente non indicato")}</span><br>
      <span class="s"><span class="tag">${r.tipo}</span>${esc(r.a.modello || "")} · <span class="mono">${esc(r.a.matricola || "")}</span>${r.a.localita ? " · " + esc(r.a.localita) : ""}</span></span>
      <span class="when"><span class="d">${fmtD(r.data)}</span><span class="pill ${r.st.cls}">${r.st.txt}</span></span>
    </button>`).join("")}</div>`
    : `<div class="list"><div class="empty">${S.apparecchi.length ? "Nessuna scadenza con questi filtri." : `<b>Nessun apparecchio in archivio.</b><span>Aggiungi il primo registratore, anche leggendo il QR code dalla targhetta.</span><button class="btn primary" data-act="new-app">Aggiungi apparecchio</button>`}</div></div>`}`;
}
function viewApparecchi() {
  const q = norm(UI.qa);
  const list = S.apparecchi.filter((a) => !q || norm([a.matricola, a.modello, a.indirizzo, a.localita, a.firmware, cliente(a.clienteId)?.ragione].join(" ")).includes(q))
    .sort((x, y) => norm(cliente(x.clienteId)?.ragione).localeCompare(norm(cliente(y.clienteId)?.ragione)));
  return `<div class="spread"><h2>Apparecchi <span class="faint">(${S.apparecchi.length})</span></h2>
    <div class="row"><button class="btn sm" data-act="qr-new">Leggi QR</button><button class="btn primary sm" data-act="new-app">+ Apparecchio</button></div></div>
  <input type="search" id="qApp" placeholder="Cerca matricola, modello, cliente, firmware…" value="${esc(UI.qa)}" data-bind="qa">
  ${list.length ? `<div class="list">${list.map((a) => {
    const sc = scadenze(a); const worst = sc.map((s) => stato(s.data)).sort((x, y) => (x.n ?? -1e9) - (y.n ?? -1e9))[0];
    return `<button class="item" data-act="open-app" data-id="${a.id}"><span class="stripe ${a.dismesso ? "" : worst.cls}"></span>
      <span style="min-width:0"><span class="t">${esc(a.modello || "Modello non indicato")} · <span class="mono">${esc(a.matricola || "")}</span></span><br>
      <span class="s">${esc(cliente(a.clienteId)?.ragione || "—")}${a.firmware ? ` · FW <span class="mono">${esc(a.firmware)}</span>` : ""}${a.dgfeAnnuale ? " · DGFE annuale" : ""}${a.dismesso ? " · dismesso" : ""}</span></span>
      <span class="when">${sc.map((s) => `<span class="faint"><span class="tag">${s.tipo}</span><span class="mono">${fmtD(s.data)}</span></span>`).join("")}</span></button>`;
  }).join("")}</div>` : `<div class="list"><div class="empty">Nessun apparecchio trovato.</div></div>`}`;
}
function viewClienti() {
  const q = norm(UI.qc);
  const list = S.clienti.filter((c) => !q || norm([c.ragione, c.piva, c.domicilio, c.telefono, c.referente].join(" ")).includes(q)).sort((x, y) => norm(x.ragione).localeCompare(norm(y.ragione)));
  return `<div class="spread"><h2>Clienti <span class="faint">(${S.clienti.length})</span></h2><button class="btn primary sm" data-act="new-cli">+ Cliente</button></div>
  <input type="search" id="qCli" placeholder="Cerca ragione sociale, P.IVA, telefono…" value="${esc(UI.qc)}" data-bind="qc">
  ${list.length ? `<div class="list">${list.map((c) => {
    const n = S.apparecchi.filter((a) => a.clienteId === c.id).length;
    return `<button class="item" data-act="open-cli" data-id="${c.id}"><span class="stripe"></span><span style="min-width:0"><span class="t">${esc(c.ragione)}</span><br>
    <span class="s">P.IVA <span class="mono">${esc(c.piva || "—")}</span>${c.telefono ? " · " + esc(c.telefono) : ""}</span></span><span class="when"><span class="pill n">${n} RT</span></span></button>`;
  }).join("")}</div>` : `<div class="list"><div class="empty">Nessun cliente trovato.</div></div>`}`;
}
function viewVerifiche() {
  const q = norm(UI.qv);
  const list = S.verifiche.filter((v) => !q || norm([v.numero, v.cli?.ragione, v.app?.matricola, v.app?.modello, v.tecnico?.nome].join(" ")).includes(q)).sort((x, y) => ((y.data || "") + (y.oraInizio || "")).localeCompare((x.data || "") + (x.oraInizio || "")));
  return `<div class="spread"><h2>Rapporti di verificazione <span class="faint">(${S.verifiche.length})</span></h2></div>
  <input type="search" id="qVer" placeholder="Cerca numero, cliente, matricola, tecnico…" value="${esc(UI.qv)}" data-bind="qv">
  ${list.length ? `<div class="list">${list.map((v) => {
    const e = v.esito; const cls = e === "positivo" ? "ok" : e === "negativo" ? "bad" : "n";
    return `<button class="item" data-act="open-ver" data-id="${v.id}"><span class="stripe ${cls}"></span><span style="min-width:0">
    <span class="t">${esc(v.cli?.ragione || "—")}</span><br><span class="s"><span class="tag">${esc(v.numero || "")}</span>${esc(v.app?.modello || "")} · <span class="mono">${esc(v.app?.matricola || "")}</span> · ${v.tipo === "privo" ? "senza sigillo" : "sigillo integro"}${v.tecnico?.nome ? " · " + esc(v.tecnico.nome) : ""}</span></span>
    <span class="when"><span class="d">${fmtD(v.data)}</span><span class="pill ${cls}">${esc(e || "")}</span></span></button>`;
  }).join("")}</div>` : `<div class="list"><div class="empty"><b>Nessun rapporto ancora.</b><span>Le verifiche completate compaiono qui, con i PDF A4 e per stampante termica.</span><button class="btn primary" data-act="new-ver">Nuova verifica</button></div></div>`}`;
}

/* ---------- impostazioni ---------- */
function viewImpostazioni() {
  const me = S.me, L = lab();
  const f = (id, l, v, t = "text", extra = "") => `<label class="field"><span>${l}</span><input type="${t}" id="${id}" value="${esc(v ?? "")}" ${extra}></label>`;
  let h = `<div class="panel"><div class="spread"><h2>Il tuo profilo</h2><span class="pill acc">${me.ruolo === "admin" ? "Amministratore" : "Tecnico"}</span></div>
    <p class="faint" style="margin:0">Nome, codice fiscale e sigillo compaiono sui rapporti che firmi.</p>
    <div class="grid3">${f("pfNome", "Cognome e nome", me.nome)}${f("pfCf", "Codice fiscale", me.cf, "text", 'class="mono" autocapitalize="characters"')}${f("pfSigillo", "Sigillo / identificativo", me.sigillo)}</div>
    <div class="field"><span>La tua firma</span><div class="sigbox" data-act="sign-tecnico" id="sigProfilo">${S.firmaTecnico ? `<img src="${S.firmaTecnico}" alt="La tua firma">` : `<span>Tocca per firmare</span>`}</div></div>
    <div class="row"><button class="btn primary" data-act="save-profilo">Salva profilo</button><button class="btn" data-act="chg-pwd">Cambia password</button><button class="btn ghost" data-act="logout">Esci</button></div>
    <p class="faint" style="margin:0">Accesso: ${esc(me.email)}</p></div>`;
  if (!isAdmin()) return h;
  h += `<div class="panel"><h2>Dati del laboratorio</h2><p class="faint" style="margin:0">Compaiono nell'intestazione dei rapporti e nella dichiarazione.</p>
    <div class="grid2">${f("lbRagione", "Ragione sociale", L.ragione)}${f("lbPiva", "Partita IVA", L.piva, "text", 'class="mono"')}${f("lbIndirizzo", "Indirizzo", L.indirizzo)}${f("lbCap", "CAP / Località / Prov.", L.cap)}${f("lbTel", "Telefono", L.telefono, "tel")}${f("lbEmail", "Email (riceve gli avvisi)", L.email, "email")}${f("lbLuogo", "Luogo predefinito sui rapporti", L.luogo)}${f("lbPre", "Giorni di preavviso scadenze", L.preavviso, "number", 'min="1" max="365"')}</div>
    <div class="row"><button class="btn primary" data-act="save-lab">Salva dati laboratorio</button></div></div>
  <div class="panel" id="tecniciPanel"><h2>Tecnici</h2><p class="faint">Caricamento…</p></div>
  <div class="panel" id="abbPanel"><h2>Abbonamento</h2><p class="faint">Caricamento…</p></div>
  <div class="panel"><h2>Esporta dati</h2><p class="faint" style="margin:0">Scarica tutto l'archivio della tua azienda (clienti, apparecchi, rapporti) per conservarlo o passarlo a un altro programma.</p>
    <div class="row"><button class="btn" data-act="backup">Scarica archivio (JSON)</button><button class="btn" data-act="csv-scad">Scadenze (CSV)</button></div></div>`;
  return h;
}
async function loadImpostazioni() {
  if (!isAdmin()) return;
  try {
    const [t, a] = await Promise.all([api("GET", "/api/tecnici"), api("GET", "/api/abbonamento")]);
    UI.set = { t, a };
    paintTecnici(); paintAbb();
  } catch (e) { apiError(e); }
}
function paintTecnici() {
  const p = $("#tecniciPanel"); if (!p || !UI.set) return;
  const { t } = UI.set; const pieno = t.attivi >= t.max;
  p.innerHTML = `<div class="spread"><h2>Tecnici</h2><span class="pill ${pieno ? "warn" : "n"}">${t.attivi} di ${t.max} attivi</span></div>
    <div class="list">${t.tecnici.map((u) => `<div class="item static stack"><span class="stripe ${u.attivo ? "acc" : ""}"></span>
      <span style="min-width:0"><span class="t">${esc(u.nome || u.email)}</span> ${u.ruolo === "admin" ? `<span class="pill acc">admin</span>` : ""} ${u.attivo ? "" : `<span class="pill n">disattivato</span>`}<br>
      <span class="s">${esc(u.email)}${u.cf ? ` · <span class="mono">${esc(u.cf)}</span>` : ""}${u.ultimo_accesso ? ` · ultimo accesso ${fmtDT(u.ultimo_accesso)}` : " · mai entrato"}</span></span>
      <span class="when">${u.id === S.me.id ? `<span class="faint">sei tu</span>` : `<span class="row"><button class="btn sm" data-act="tec-reset" data-id="${u.id}">Nuova password</button><button class="btn sm" data-act="tec-toggle" data-id="${u.id}">${u.attivo ? "Disattiva" : "Riattiva"}</button></span>`}</span></div>`).join("")}</div>
    <div id="tecSecret"></div>
    ${pieno ? `<div class="banner info"><span>Hai raggiunto il numero di tecnici del tuo piano. Per aggiungerne altri scegli un piano superiore qui sotto.</span></div>` : `
    <details><summary>Aggiungi un tecnico</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <div class="grid2"><label class="field"><span>Cognome e nome</span><input type="text" id="ntNome"></label><label class="field"><span>Email</span><input type="email" id="ntEmail"></label>
      <label class="field"><span>Codice fiscale</span><input type="text" id="ntCf" class="mono"></label><label class="field"><span>Sigillo / identificativo</span><input type="text" id="ntSigillo"></label></div>
      <label class="check"><input type="checkbox" id="ntAdmin"> Anche amministratore (gestisce tecnici e abbonamento)</label>
      <div class="row"><button class="btn primary" data-act="tec-add">Aggiungi tecnico</button></div></div></details>`}`;
}
function paintAbb() {
  const p = $("#abbPanel"); if (!p || !UI.set) return;
  const { a } = UI.set; const st = a.stato;
  const cls = st.scaduto ? "bad" : st.inScadenza ? "warn" : "ok";
  const txt = !st.fine ? "Nessuna data di scadenza" : st.scaduto ? `Scaduto il ${fmtD(st.fine)}` : `Attivo fino al ${fmtD(st.fine)} (${st.giorni} giorni)`;
  const c = S.config.contatti || {};
  p.innerHTML = `<div class="spread"><h2>Abbonamento</h2><span class="pill ${cls}">${esc(txt)}</span></div>
    <p class="faint" style="margin:0">Il rinnovo si aggiunge alla scadenza attuale: non perdi i giorni rimasti. Tecnici attivi: ${a.tecnici_attivi} di ${a.azienda.max_tecnici}.</p>
    <div class="plans">${a.piani.map((pl) => `<div class="plan ${a.azienda.piano_id === pl.id ? "cur" : ""}">
      <div class="spread"><b style="font-family:var(--f-display);font-size:18px">${esc(pl.nome)}</b>${a.azienda.piano_id === pl.id ? `<span class="pill acc">attuale</span>` : ""}</div>
      <div class="price">${euro(pl.prezzo_cent)} <small>/ ${pl.mesi} mesi</small></div>
      <span class="faint">${esc(pl.descrizione || "")} · fino a ${pl.max_tecnici} ${pl.max_tecnici === 1 ? "tecnico" : "tecnici"}</span>
      ${a.stripe ? `<button class="btn ${a.azienda.piano_id === pl.id ? "primary" : ""}" data-act="paga" data-id="${esc(pl.id)}">${a.azienda.piano_id === pl.id ? "Rinnova" : "Scegli e paga"}</button>` : ""}</div>`).join("")}</div>
    ${a.stripe ? `<p class="faint" style="margin:0">Pagamento sicuro su Stripe con carta, Google Pay, Apple Pay o PayPal.</p>`
      : `<div class="banner info"><span>Per rinnovare contatta l'assistenza${c.email ? `: <b>${esc(c.email)}</b>` : ""}${c.telefono ? ` · <b>${esc(c.telefono)}</b>` : ""}.</span></div>`}
    ${a.pagamenti.length ? `<details><summary>Storico pagamenti (${a.pagamenti.length})</summary><div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>Data</th><th>Descrizione</th><th>Periodo</th><th class="num">Importo</th></tr></thead><tbody>
      ${a.pagamenti.map((x) => `<tr><td>${fmtD(x.creato)}</td><td>${esc(x.descrizione)}<br><span class="faint">${esc(x.metodo)}</span></td><td>${x.periodo_da ? `${fmtD(x.periodo_da)} – ${fmtD(x.periodo_a)}` : "—"}</td><td class="num">${euro(x.importo_cent)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
}
async function handlePaymentReturn() {
  const p = new URLSearchParams(location.search).get("pagamento"); if (!p) return;
  history.replaceState(null, "", "/app#impostazioni"); UI.tab = "impostazioni";
  if (p === "annullato") { toast("Pagamento annullato: nessun addebito."); render(); return; }
  toast("Verifica del pagamento in corso…");
  try {
    const r = await api("GET", "/api/pagamenti/verifica?session_id=" + encodeURIComponent(p));
    S.abb = r.stato; render();
    toast(r.pagato ? `Pagamento ricevuto. Abbonamento attivo fino al ${fmtD(r.stato.fine)}.` : "Il pagamento è in elaborazione: l'abbonamento si aggiorna appena confermato.", 5000);
  } catch (e) { apiError(e); }
}

/* ============================== pannelli ============================== */
function openSheet(s) { UI.sheet = s; UI.confirm = null; renderSheet(); }
function closeSheet() { UI.sheet = null; renderSheet(); }
function renderSheet() {
  const root = $("#sheetRoot");
  if (!UI.sheet) { root.innerHTML = ""; root.dataset.k = ""; document.body.style.overflow = ""; return; }
  const s = UI.sheet; const key = s.kind + (s.id || "new");
  if ((s.kind === "app-edit" || s.kind === "cli-edit") && root.dataset.k === key && root.innerHTML) { refreshSheetDyn(); return; }
  const keep = root.dataset.k === key ? ($(".sheet", root)?.scrollTop || 0) : 0;
  root.dataset.k = key;
  const body = ({ app: sheetApp, "app-edit": sheetAppEdit, cli: sheetCli, "cli-edit": sheetCliEdit, ver: sheetVer })[s.kind]();
  root.innerHTML = `<div class="sheet-wrap" data-act="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${body}</div></div>`;
  if (keep) $(".sheet", root).scrollTop = keep;
  document.body.style.overflow = "hidden";
}
function refreshSheetDyn() { const q = $("#qrBox"); if (q && UI.sheet?.kind === "app-edit") q.innerHTML = qrBoxHtml(UI.sheet); }
const head = (title, extra = "") => `<div class="sheet-head gut"><h2>${title}</h2><div class="row">${extra}<button class="btn ghost sm" data-act="close">Chiudi</button></div></div>`;
const confirmBox = (what, act, id) => UI.confirm === act ? `<div class="confirm"><b>Eliminare ${what}?</b><span class="faint">L'operazione non si può annullare.</span><div class="row"><button class="btn danger" data-act="${act}" data-id="${id}" data-ok="1">Sì, elimina</button><button class="btn" data-act="confirm-cancel">Annulla</button></div></div>` : "";

function sheetApp() {
  const a = apparecchio(UI.sheet.id); if (!a) return head("Apparecchio") + `<div class="sheet-body gut"><p>Apparecchio non trovato.</p></div>`;
  const c = cliente(a.clienteId); const ver = S.verifiche.filter((v) => v.apparecchioId === a.id).sort((x, y) => (y.data || "").localeCompare(x.data || ""));
  return head(esc(a.modello || "Apparecchio"), `<button class="btn sm" data-act="edit-app" data-id="${a.id}">Modifica</button>`) + `<div class="sheet-body gut">
    <div class="panel"><div class="spread"><h2 class="mono" style="font-family:var(--f-mono)">${esc(a.matricola || "—")}</h2>${a.dgfeAnnuale ? `<span class="pill n">DGFE annuale</span>` : ""}</div>
      ${scadenze(a).map((s) => { const st = stato(s.data); return `<div class="spread"><span><span class="label">${s.label}</span><br><span class="faint">ultima: ${fmtD(s.ultima)}</span></span><span class="when"><span class="d">${fmtD(s.data)}</span><span class="pill ${st.cls}">${st.txt}</span></span></div>`; }).join("")}
      <button class="btn primary" data-act="new-ver" data-app="${a.id}">Nuova verifica su questo RT</button>
      <button class="btn" data-act="remind" data-id="${a.id}">Copia promemoria per il cliente</button>
    </div>
    <div class="panel"><dl class="kv">
      <dt>Esercente</dt><dd>${c ? `<a href="#" data-act="open-cli" data-id="${c.id}">${esc(c.ragione)}</a>` : "—"}</dd>
      <dt>P.IVA</dt><dd class="mono">${esc(c?.piva || "—")}</dd>
      <dt>Telefono</dt><dd>${esc(c?.telefono || "—")}</dd>
      <dt>Ubicazione</dt><dd>${esc([a.indirizzo, a.localita].filter(Boolean).join(", ") || "—")}</dd>
      <dt>Firmware</dt><dd class="mono">${esc(a.firmware || "—")}${a.firmwareData ? ` <span class="faint">(${fmtD(a.firmwareData)})</span>` : ""}</dd>
      <dt>Note</dt><dd>${esc(a.note || "—")}</dd></dl></div>
    ${a.ae || a.qrUrl ? `<div class="panel"><div class="spread"><h2>Agenzia delle Entrate</h2>${a.qrUrl ? `<button class="btn sm" data-act="ae-refresh" data-id="${a.id}">Aggiorna dall'Agenzia</button>` : ""}</div>
      ${a.ae ? `<span class="faint">Dati letti dal QR il ${fmtD(a.ae.letto)}</span>${aeSummary(a.ae, a.qrUrl)}` : `<a class="btn sm" href="${esc(a.qrUrl)}" target="_blank" rel="noopener noreferrer">Apri la pagina dell'Agenzia</a>`}</div>` : ""}
    <div class="panel"><h2>Storico verifiche</h2>${ver.length ? `<div class="list">${ver.map((v) => `<button class="item" data-act="open-ver" data-id="${v.id}"><span class="stripe ${v.esito === "positivo" ? "ok" : v.esito === "negativo" ? "bad" : ""}"></span><span><span class="t">${fmtD(v.data)}</span><br><span class="s">${esc(v.numero)} · ${esc(v.esito)}${v.tecnico?.nome ? " · " + esc(v.tecnico.nome) : ""}</span></span><span></span></button>`).join("")}</div>` : `<p class="faint">Nessuna verifica registrata.</p>`}</div>
    <div class="row"><button class="btn danger sm" data-act="del-app" data-id="${a.id}">Elimina apparecchio</button></div>${confirmBox("questo apparecchio", "del-app", a.id)}
  </div>`;
}
function qrBoxHtml(s) {
  const q = s.qr; if (!q) return "";
  if (q.error) return `<div class="qrres"><b>QR code non letto</b><span>${esc(q.error)}</span></div>`;
  if (q.loading) return `<div class="qrres"><b>Lettura dei dati dall'Agenzia delle Entrate…</b><span class="mono">${esc(q.text)}</span></div>`;
  if (q.ae) return `<div class="qrres"><b>Dati letti dal QR code</b>${q.found.length ? `<span>${q.found.map(esc).join(" · ")}</span>` : ""}${aeSummary(q.ae, q.text)}<span class="faint">I campi compilati sono evidenziati: controllali e salva.</span></div>`;
  const isUrl = /^https?:\/\//i.test(q.text);
  return `<div class="qrres"><b>QR code letto</b><span class="mono">${esc(q.text)}</span>
    ${q.aeErr ? `<span class="pill warn" style="white-space:normal">${esc(q.aeErr)}</span>` : ""}
    ${q.found.length ? `<span>Dati riconosciuti e inseriti: ${q.found.map(esc).join(", ")}</span>` : ""}
    ${isUrl ? `<a class="btn sm" href="${esc(q.text)}" target="_blank" rel="noopener noreferrer">Apri la pagina dell'Agenzia</a>` : ""}</div>`;
}
/** Riepilogo dei dati dell'Agenzia. ctx: { cliente, apparecchio, fwPresente } per i controlli di coerenza */
function aeSummary(d, url, ctx = {}) {
  const trasmette = /^trasmette/i.test(d.stato || "");
  const chk = (ok, txt) => `<span class="pill ${ok ? "ok" : "bad"}" style="white-space:normal">${ok ? "✓" : "✕"} ${esc(txt)}</span>`;
  const checks = [];
  if (ctx.apparecchio) checks.push(norm(d.matricola) === norm(ctx.apparecchio.matricola) ? chk(true, "Matricola coerente") : chk(false, `Matricola nel QR ${d.matricola} diversa da ${ctx.apparecchio.matricola}`));
  if (ctx.cliente && d.esercentePiva) checks.push(d.esercentePiva === (ctx.cliente.piva || "").replace(/\s/g, "") ? chk(true, "P.IVA esercente coerente") : chk(false, `P.IVA esercente nel QR ${d.esercentePiva} diversa da ${ctx.cliente.piva || "—"}`));
  const fwDiff = d.fwModello && ctx.fwPresente !== undefined && ctx.fwPresente && norm(ctx.fwPresente) !== norm(d.fwModello);
  return `${checks.length ? `<div class="row">${checks.join("")}</div>` : ""}
  <dl class="kv">
    <dt>Stato</dt><dd><span class="pill ${trasmette ? "ok" : "warn"}" style="white-space:normal">${esc(d.stato || "—")}</span></dd>
    <dt>Matricola</dt><dd class="mono">${esc(d.matricola)}</dd>
    <dt>Apparecchio</dt><dd>${esc(d.modelloCompleto || "—")}${d.tipoSigillo ? `<br><span class="faint">Sigillo: ${esc(d.tipoSigillo)}</span>` : ""}${d.approvazioneNumero ? `<br><span class="faint">Approvazione ${esc(d.approvazioneNumero)} del ${fmtD(d.approvazioneData)}</span>` : ""}</dd>
    <dt>Esercente</dt><dd>${esc(d.esercenteNome || "—")}${d.esercentePiva ? `<br><span class="faint mono">P.IVA ${esc(d.esercentePiva)}</span>` : ""}</dd>
    <dt>Ultima verificazione</dt><dd>${d.vpData ? `${fmtD(d.vpData)} <span class="pill ${d.vpPositiva ? "ok" : "bad"}">${d.vpPositiva ? "positiva" : "vedi esito"}</span><br><span class="faint">${esc(d.vpEsito)}${d.vpPivaLab ? ` · lab. P.IVA ${esc(d.vpPivaLab)}` : ""}</span><br><span class="faint">Prossima entro il ${fmtD(addYears(d.vpData, 2))}</span>` : "Nessuna registrata"}</dd>
    <dt>Firmware</dt><dd><span class="mono">${esc(d.fwDispositivo || "—")}</span> sul dispositivo<br><span class="mono">${esc(d.fwModello || "—")}</span> ultimo del modello${d.fwModelloData ? ` (${fmtD(d.fwModelloData)})` : ""}
      ${fwDiff ? `<br><span class="pill warn" style="white-space:normal">Firmware presente ${esc(ctx.fwPresente)}: va aggiornato a ${esc(d.fwModello)}</span> <button class="btn sm" data-act="fw-agg" data-v="${esc(d.fwModello)}">Segna aggiornato a ${esc(d.fwModello)}</button>` : ""}</dd>
    <dt>Ultima trasmissione</dt><dd>${fmtD(d.ultimaTrasmissione)}</dd>
  </dl>
  ${url ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Apri la pagina dell'Agenzia</a>` : ""}`;
}
function sheetAppEdit() {
  const s = UI.sheet; const a = s.draft;
  const cli = S.clienti.slice().sort((x, y) => norm(x.ragione).localeCompare(norm(y.ragione)));
  const f = (k, l, cls = "") => `<label class="field"><span>${l}</span><input type="text" id="ae_${k}" data-ae="${k}" class="${cls}" value="${esc(a[k] ?? "")}"></label>`;
  const nc = a.nuovoCliente || {};
  const g = (k, l) => `<label class="field"><span>${l}</span><input type="text" id="aenc_${k}" data-aenc="${k}" value="${esc(nc[k] ?? "")}"></label>`;
  return head(s.id ? "Modifica apparecchio" : "Nuovo apparecchio") + `<div class="sheet-body gut">
    <div class="panel"><h2>Compila dal registratore</h2>
      <p class="faint" style="margin:0">Inquadra il QR code della targhetta: i dati del registratore e dell'esercente vengono letti dalla pagina dell'Agenzia delle Entrate e inseriti qui sotto.</p>
      <div class="row"><button class="btn primary" data-act="qr-scan">Scansiona QR code</button></div>
      <div id="qrBox">${qrBoxHtml(s)}</div>
    </div>
    <div class="panel"><h2>Esercente</h2>
      <label class="field"><span>Cliente</span><select id="ae_clienteId" data-ae="clienteId"><option value="">— Nuovo cliente —</option>${cli.map((c) => `<option value="${c.id}" ${a.clienteId === c.id ? "selected" : ""}>${esc(c.ragione)}${c.piva ? " · " + esc(c.piva) : ""}</option>`).join("")}</select></label>
      <div id="ncBox" ${a.clienteId ? "hidden" : ""}><div class="grid2">${g("ragione", "Ragione sociale")}${g("piva", "Partita IVA")}${g("domicilio", "Domicilio / Residenza")}${g("telefono", "Telefono")}</div></div>
    </div>
    <div class="panel"><h2>Registratore</h2>
      <div class="grid2">${f("modello", "Marchio / Modello")}${f("matricola", "Matricola", "mono")}${f("indirizzo", "Ubicazione: indirizzo")}${f("localita", "CAP / Località / Prov.")}${f("firmware", "Versione firmware", "mono")}<label class="field"><span>Data firmware</span><input type="date" id="ae_firmwareData" data-ae="firmwareData" value="${esc(a.firmwareData || "")}"></label></div>
      <div class="grid2"><label class="field"><span>Ultima verificazione periodica</span><input type="date" id="ae_ultimaVerifica" data-ae="ultimaVerifica" value="${esc(a.ultimaVerifica || "")}"></label>
        <div class="field"><span>Prossima scadenza (2 anni)</span><div class="mono" id="aeNextVP" style="padding:10px 0">${fmtD(addYears(a.ultimaVerifica, 2))}</div></div></div>
      <label class="check"><input type="checkbox" id="ae_dgfeAnnuale" data-ae="dgfeAnnuale" ${a.dgfeAnnuale ? "checked" : ""}> Questo registratore ha la scadenza DGFE annuale</label>
      <div class="grid2" id="dgfeBox" ${a.dgfeAnnuale ? "" : "hidden"}><label class="field"><span>Ultimo controllo / sostituzione DGFE</span><input type="date" id="ae_ultimoDgfe" data-ae="ultimoDgfe" value="${esc(a.ultimoDgfe || "")}"></label>
        <div class="field"><span>Prossima scadenza DGFE (1 anno)</span><div class="mono" id="aeNextDG" style="padding:10px 0">${fmtD(addYears(a.ultimoDgfe, 1))}</div></div></div>
      <label class="check"><input type="checkbox" id="ae_dismesso" data-ae="dismesso" ${a.dismesso ? "checked" : ""}> Apparecchio dismesso (esclude dalle scadenze)</label>
      <label class="field"><span>Note</span><textarea id="ae_note" data-ae="note">${esc(a.note || "")}</textarea></label>
    </div>
    <div class="row"><button class="btn primary" data-act="save-app">Salva apparecchio</button><button class="btn" data-act="close">Annulla</button></div>
  </div>`;
}
function sheetCli() {
  const c = cliente(UI.sheet.id); if (!c) return head("Cliente") + `<div class="sheet-body gut"><p>Cliente non trovato.</p></div>`;
  const apps = S.apparecchi.filter((a) => a.clienteId === c.id);
  return head(esc(c.ragione), `<button class="btn sm" data-act="edit-cli" data-id="${c.id}">Modifica</button>`) + `<div class="sheet-body gut">
    <div class="panel"><dl class="kv"><dt>P.IVA</dt><dd class="mono">${esc(c.piva || "—")}</dd><dt>Domicilio</dt><dd>${esc(c.domicilio || "—")}</dd>
      <dt>Telefono</dt><dd>${esc(c.telefono || "—")}</dd><dt>Email</dt><dd>${esc(c.email || "—")}</dd><dt>Referente</dt><dd>${esc(c.referente || "—")}</dd><dt>Note</dt><dd>${esc(c.note || "—")}</dd></dl></div>
    <div class="panel"><div class="spread"><h2>Registratori</h2><button class="btn sm" data-act="new-app" data-cli="${c.id}">+ Apparecchio</button></div>
      ${apps.length ? `<div class="list">${apps.map((a) => `<button class="item" data-act="open-app" data-id="${a.id}"><span class="stripe"></span><span><span class="t">${esc(a.modello)}</span><br><span class="s mono">${esc(a.matricola)}</span></span><span class="when">${scadenze(a).map((s) => `<span class="faint"><span class="tag">${s.tipo}</span>${fmtD(s.data)}</span>`).join("")}</span></button>`).join("")}</div>` : `<p class="faint">Nessun registratore.</p>`}</div>
    <div class="row"><button class="btn danger sm" data-act="del-cli" data-id="${c.id}">Elimina cliente</button></div>${confirmBox("questo cliente (i suoi apparecchi restano in archivio)", "del-cli", c.id)}
  </div>`;
}
function sheetCliEdit() {
  const c = UI.sheet.draft; const f = (k, l, t = "text") => `<label class="field"><span>${l}</span><input type="${t}" id="ce_${k}" data-ce="${k}" value="${esc(c[k] ?? "")}"></label>`;
  return head(UI.sheet.id ? "Modifica cliente" : "Nuovo cliente") + `<div class="sheet-body gut"><div class="panel">
    <div class="grid2">${f("ragione", "Ragione sociale")}${f("piva", "Partita IVA")}${f("domicilio", "Domicilio / Residenza")}${f("telefono", "Telefono", "tel")}${f("email", "Email", "email")}${f("referente", "Referente (nome, qualifica)")}</div>
    <label class="field"><span>Note</span><textarea id="ce_note" data-ce="note">${esc(c.note || "")}</textarea></label></div>
    <div class="row"><button class="btn primary" data-act="save-cli">Salva cliente</button><button class="btn" data-act="close">Annulla</button></div></div>`;
}
function sheetVer() {
  const v = S.verifiche.find((x) => x.id === UI.sheet.id); if (!v) return head("Rapporto") + `<div class="sheet-body gut"><p>Rapporto non trovato.</p></div>`;
  const e = v.esito, cls = e === "positivo" ? "ok" : e === "negativo" ? "bad" : "n";
  const val = (k) => v.esiti?.[k] === "si" ? `<span class="pill ok">SI</span>` : v.esiti?.[k] === "no" ? `<span class="pill bad">NO</span>` : `<span class="pill n">—</span>`;
  const pdf = UI.sheet.pdf;
  return head(`Rapporto ${esc(v.numero)}`, `<button class="btn sm" data-act="edit-ver" data-id="${v.id}">Modifica</button>`) + `<div class="sheet-body gut">
    <div class="esito ${cls}">Esito ${esc(e)}</div>
    <div class="panel"><h2>Stampa</h2><p class="faint" style="margin:0">Si apre il PDF: stampalo su una stampante A4 oppure, nel formato 80 mm, su una stampante termica.</p>
      <div class="row"><button class="btn primary" data-act="pdf" data-k="a4" data-id="${v.id}">PDF A4</button><button class="btn" data-act="pdf" data-k="80" data-id="${v.id}">PDF termico 80 mm</button>
      ${v.tipo === "privo" ? `<button class="btn" data-act="pdf" data-k="dich" data-id="${v.id}">Dichiarazione (All. 3)</button>` : ""}</div>
      ${pdf ? `<div class="qrres"><b>${esc(pdf.nome)}</b><div class="row"><a class="btn sm primary" href="${pdf.url}" target="_blank" rel="noopener">Apri per stampare</a><a class="btn sm" href="${pdf.url}" download="${esc(pdf.nome)}">Scarica</a></div></div>` : ""}</div>
    <div class="panel"><dl class="kv"><dt>Data</dt><dd>${fmtD(v.data)} · ${esc(v.oraInizio || "")}–${esc(v.oraFine || "")}</dd>
      <dt>Esercente</dt><dd>${esc(v.cli?.ragione || "")}<br><span class="faint">P.IVA ${esc(v.cli?.piva || "")}</span></dd>
      <dt>Apparecchio</dt><dd>${esc(v.app?.modello || "")} · <span class="mono">${esc(v.app?.matricola || "")}</span></dd>
      <dt>Sigillo</dt><dd>${v.tipo === "privo" ? "Assente o rimosso" : "Integro"}${v.tipoSigillo ? " · " + esc(SIGILLI[v.tipoSigillo]) : ""}</dd>
      <dt>Firmware</dt><dd class="mono">${esc(v.fwPresente || "—")}${v.fwAggiornato ? " → " + esc(v.fwAggiornato) : ""}</dd>
      <dt>Tecnico</dt><dd>${esc(v.tecnico?.nome || tecnicoNome(v.tecnicoId) || "—")}</dd>
      <dt>Utente</dt><dd>${esc(v.utenteNome || "—")}${v.utenteQualifica ? " (" + esc(v.utenteQualifica) + ")" : ""}</dd>
      <dt>Prossima verifica</dt><dd>${v.esito === "positivo" ? fmtD(addYears(v.data, 2)) : "—"}</dd></dl></div>
    <div class="panel"><h2>Prove</h2><div>${[...PRE.map((p) => ({ c: p.c, k: p.k, s: TX[p.k][1] })), ...buildTests(v.tipo)].map((t) => t.head ? `<div class="test h"><span class="c">${t.c}</span><span class="x">${esc(t.s)}</span></div>` : `<div class="test"><span class="c">${t.c}</span><span class="x">${esc(t.s)}</span>${val(t.k)}</div>`).join("")}</div></div>
    ${isAdmin() ? `<div class="row"><button class="btn danger sm" data-act="del-ver" data-id="${v.id}">Elimina rapporto</button></div>${confirmBox("questo rapporto", "del-ver", v.id)}` : ""}
  </div>`;
}

/* ============================== modulo verifica ============================== */
const fkey = () => "blucheck_bozza_" + (S.me?.id || "");
function newForm(appId) {
  const a = appId ? apparecchio(appId) : null;
  return {
    id: null, apparecchioId: a?.id || "", tipo: "integro", tipoSigillo: "", interventi: { lab: true, vp: true, biennale: true }, esiti: {},
    data: todayISO(), oraInizio: nowHM(), dataFine: todayISO(), oraFine: "", fwPresente: a?.firmware || "", fwData: a?.firmwareData || "", fwAggiornato: "",
    luogo: lab().luogo, utenteNome: cliente(a?.clienteId)?.referente || "", utenteQualifica: "", dgfeFatto: false, note: "",
    motivoSigillo: "", dichiarante: "tecnico", firmaUtente: "", qrCheck: null,
  };
}
function startForm(appId, existing) {
  if (existing) {
    UI.form = { ...existing, firmaUtente: "" };
    getDoc("firme", existing.id).then((d) => { if (d && UI.form && UI.form.id === existing.id) { UI.form.firmaUtente = d.img || ""; refreshFormDyn(); } }).catch(() => { });
  } else {
    const draft = ls.get(fkey());
    UI.form = (!appId && draft && draft.apparecchioId) ? draft : newForm(appId);
    if (draft && !appId && draft.apparecchioId) setTimeout(() => toast("Ripresa la bozza non salvata"), 50);
  }
  UI.sheet = null; delete $("#main").dataset.form; render(); window.scrollTo(0, 0);
}
function saveDraft() { if (UI.form && !UI.form.id) { const { firmaUtente, ...rest } = UI.form; ls.set(fkey(), rest); } }

function viewForm() {
  const F = UI.form;
  const inp = (k, l, t = "text", cls = "") => `<label class="field"><span>${l}</span><input type="${t}" id="f_${k}" data-f="${k}" class="${cls}" value="${esc(F[k] ?? "")}"></label>`;
  return `
  <div class="spread"><h2 style="font-size:22px">${F.id ? "Modifica rapporto " + esc(F.numero || "") : "Nuova verificazione periodica"}</h2><button class="btn ghost sm" data-act="form-cancel">Esci</button></div>
  <div class="panel"><h2>1. Registratore</h2>
    <label class="field"><span>Apparecchio</span><select id="f_apparecchioId" data-f="apparecchioId"></select></label>
    <div id="fAppInfo"></div>
    <div class="row"><button class="btn sm" data-act="new-app">+ Nuovo apparecchio</button><button class="btn sm" data-act="qr-check">Scansiona QR per controllo 2.2</button></div>
    <div id="qrCheckBox"></div>
  </div>
  <div class="panel"><h2>2. Intervento</h2>
    <div class="row">${INTERVENTI.map(([k, l]) => `<label class="check"><input type="checkbox" id="fi_${k}" data-fi="${k}" ${F.interventi?.[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
    <div class="grid2">${inp("data", "Inizio intervento: data", "date")}${inp("oraInizio", "Ora inizio", "time")}</div>
  </div>
  <div class="panel"><h2>3. Esame preliminare</h2>
    <div class="field"><span>Sigillo fiscale</span><div class="seg wide choose" role="group">
      <button data-act="tipo-form" data-v="integro" aria-pressed="${F.tipo === "integro"}">Integro (All. 1)</button>
      <button data-act="tipo-form" data-v="privo" aria-pressed="${F.tipo === "privo"}">Assente o rimosso (All. 2)</button></div></div>
    <label class="field"><span>Tipo sigillo</span><select id="f_tipoSigillo" data-f="tipoSigillo"><option value="">— Seleziona —</option>${Object.entries(SIGILLI).map(([k, l]) => `<option value="${k}" ${F.tipoSigillo === k ? "selected" : ""}>${k}. ${l}</option>`).join("")}</select></label>
    <div id="preTests"></div>
  </div>
  <div class="panel"><div class="spread"><h2>4. Prove</h2><button class="btn sm" data-act="all-si">Tutte SI</button></div>
    <div id="testsBox"></div>
    <div class="grid3">${inp("fwPresente", "Firmware presente: versione", "text", "mono")}${inp("fwData", "Data firmware", "date")}${inp("fwAggiornato", "Aggiornato alla versione (se fatto)", "text", "mono")}</div>
  </div>
  <div class="panel" id="dichPanel" ${F.tipo === "privo" ? "" : "hidden"}><h2>Dichiarazione (All. 3)</h2>
    <div class="field"><span>Dichiarante</span><div class="seg wide choose" role="group">
      <button data-act="dichiarante" data-v="tecnico" aria-pressed="${F.dichiarante !== "utente"}">Tecnico</button><button data-act="dichiarante" data-v="utente" aria-pressed="${F.dichiarante === "utente"}">Utente</button></div></div>
    <label class="field"><span>L'assenza del sigillo fiscale è dovuta a</span><textarea id="f_motivoSigillo" data-f="motivoSigillo">${esc(F.motivoSigillo || "")}</textarea></label>
  </div>
  <div class="panel"><h2>5. Chiusura</h2>
    <div class="grid2">${inp("dataFine", "Fine intervento: data", "date")}${inp("oraFine", "Ora fine (vuota = ora del salvataggio)", "time")}${inp("luogo", "Luogo")}<span></span>${inp("utenteNome", "Utente: cognome e nome")}${inp("utenteQualifica", "Qualifica presso l'utente")}</div>
    <label class="check" id="dgfeCheck"><input type="checkbox" id="f_dgfeFatto" data-f="dgfeFatto" ${F.dgfeFatto ? "checked" : ""}> Eseguito anche il controllo/sostituzione DGFE (aggiorna la scadenza annuale)</label>
    <label class="field"><span>Note interne (non stampate)</span><textarea id="f_note" data-f="note">${esc(F.note || "")}</textarea></label>
  </div>
  <div class="panel"><h2>6. Firme</h2>
    <div class="grid2"><div class="field"><span>Firma dell'utente</span><div class="sigbox" data-act="sign-utente" id="sigUtente"></div></div>
      <div class="field"><span>Firma del tecnico</span><div class="sigbox" data-act="sign-tecnico" id="sigTecnico"></div></div></div>
    <p class="faint" style="margin:0">Passa il telefono al cliente: si apre un'area di firma a tutto schermo. Girare il telefono in orizzontale aiuta.</p>
  </div>
  <div id="esitoBox"></div>`;
}
function refreshFormDyn() {
  const F = UI.form; if (!F || !$("#testsBox")) return;
  const a = apparecchio(F.apparecchioId), c = cliente(a?.clienteId);
  const sel = $("#f_apparecchioId");
  if (sel && document.activeElement !== sel) {
    const apps = S.apparecchi.filter((x) => !x.dismesso || x.id === F.apparecchioId).slice().sort((x, y) => norm(cliente(x.clienteId)?.ragione).localeCompare(norm(cliente(y.clienteId)?.ragione)));
    sel.innerHTML = `<option value="">— Seleziona —</option>` + apps.map((x) => `<option value="${x.id}" ${F.apparecchioId === x.id ? "selected" : ""}>${esc(cliente(x.clienteId)?.ragione || "—")} · ${esc(x.modello)} · ${esc(x.matricola)}</option>`).join("");
  }
  $("#fAppInfo").innerHTML = a ? `<dl class="kv"><dt>Esercente</dt><dd>${esc(c?.ragione || "—")} · P.IVA <span class="mono">${esc(c?.piva || "—")}</span></dd><dt>Ubicazione</dt><dd>${esc([a.indirizzo, a.localita].filter(Boolean).join(", ") || "—")}</dd><dt>Matricola</dt><dd class="mono">${esc(a.matricola)}</dd><dt>Scadenze</dt><dd>${scadenze(a).map((s) => `${s.tipo} ${fmtD(s.data)}`).join(" · ")}</dd></dl>` : `<p class="faint" style="margin:0">Seleziona il registratore oppure aggiungilo.</p>`;
  const q = F.qrCheck;
  $("#qrCheckBox").innerHTML = !q ? "" : q.error ? `<div class="qrres"><b>QR non letto</b>${esc(q.error)}</div>`
    : q.loading ? `<div class="qrres"><b>Lettura dei dati dall'Agenzia delle Entrate…</b></div>`
    : q.ae ? `<div class="qrres"><b>Controllo 2.2 con i dati dell'Agenzia</b>${aeSummary(q.ae, q.text, { apparecchio: a, cliente: c, fwPresente: F.fwAggiornato || F.fwPresente })}</div>`
    : `<div class="qrres"><b>QR letto</b><span class="mono">${esc(q.text)}</span>${q.aeErr ? `<span class="pill warn" style="white-space:normal">${esc(q.aeErr)}</span>` : ""}${a && q.matricola ? (norm(q.matricola) === norm(a.matricola) ? `<span class="pill ok">Matricola coerente: ${esc(q.matricola)}</span>` : `<span class="pill bad">Matricola nel QR ${esc(q.matricola)} diversa da ${esc(a.matricola)}</span>`) : ""}${/^https?:/i.test(q.text || "") ? `<a class="btn sm" href="${esc(q.text)}" target="_blank" rel="noopener noreferrer">Apri pagina Agenzia</a>` : ""}</div>`;
  const seg = (k) => `<div class="seg"><button class="si" data-act="esito" data-k="${k}" data-v="si" aria-pressed="${F.esiti[k] === "si"}">SI</button><button class="no" data-act="esito" data-k="${k}" data-v="no" aria-pressed="${F.esiti[k] === "no"}">NO</button></div>`;
  $("#preTests").innerHTML = PRE.map((p) => `<div class="test"><span class="c">${p.c}</span><span class="x">${esc(TX[p.k][0])}</span>${seg(p.k)}</div>`).join("");
  $("#testsBox").innerHTML = buildTests(F.tipo).map((t) => t.head ? `<div class="test h"><span class="c">${t.c}</span><span class="x">${esc(t.t)}</span></div>`
    : `<div class="test"><span class="c">${t.c}</span><span class="x"><details><summary>${esc(t.s)}</summary><span class="faint">${esc(t.t)}</span></details></span>${seg(t.k)}</div>`).join("");
  $("#dichPanel").hidden = F.tipo !== "privo";
  document.querySelectorAll('[data-act="tipo-form"]').forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === F.tipo));
  document.querySelectorAll('[data-act="dichiarante"]').forEach((b) => b.setAttribute("aria-pressed", (b.dataset.v === "utente") === (F.dichiarante === "utente")));
  $("#dgfeCheck").hidden = !a?.dgfeAnnuale;
  $("#sigUtente").innerHTML = F.firmaUtente ? `<img src="${F.firmaUtente}" alt="Firma utente">` : `<span>Tocca per far firmare il cliente</span>`;
  $("#sigTecnico").innerHTML = S.firmaTecnico ? `<img src="${S.firmaTecnico}" alt="Firma tecnico">` : `<span>Tocca per firmare (resta salvata nel tuo profilo)</span>`;
  const e = computeEsito(F); const missing = buildTests(F.tipo).filter((t) => !t.head && !F.esiti[t.k]).length + PRE.filter((p) => !F.esiti[p.k]).length;
  $("#esitoBox").innerHTML = `<div class="esito ${e === "positivo" ? "ok" : e === "negativo" ? "bad" : "n"}">${e === "positivo" ? "Esito positivo" : e === "negativo" ? "Esito negativo" : "Esito non ancora determinato"}${missing ? ` <span class="faint" style="font-family:var(--f-body);font-weight:500;font-size:14px">· ${missing} prove da compilare</span>` : ""}</div>`;
}
function renderBar() {
  const r = $("#barRoot");
  if (!UI.form) { r.innerHTML = ""; return; }
  const e = computeEsito(UI.form);
  r.innerHTML = `<div class="bar gut"><div class="bar-in"><span class="pill ${e === "positivo" ? "ok" : e === "negativo" ? "bad" : "n"}">${esc(e)}</span><div class="row"><button class="btn" data-act="form-cancel">Esci</button><button class="btn primary" data-act="save-ver" ${readonly() ? "disabled" : ""}>Salva rapporto</button></div></div></div>`;
}

let savingVer = false;
async function saveVerifica() {
  if (!guardWrite() || savingVer) return;
  const F = UI.form; const a = apparecchio(F.apparecchioId);
  if (!a) return toast("Seleziona il registratore prima di salvare.");
  const c = cliente(a.clienteId);
  if (!F.oraFine) { F.oraFine = nowHM(); const el = $("#f_oraFine"); if (el) el.value = F.oraFine; }
  const id = F.id || uid();
  const esito = computeEsito(F);
  const { firmaUtente, qrCheck, ...rest } = F;
  const L = lab();
  const v = {
    ...rest, id, esito, apparecchioId: a.id, clienteId: a.clienteId || "",
    cli: { ragione: c?.ragione || "", domicilio: c?.domicilio || "", piva: c?.piva || "" },
    app: { modello: a.modello || "", matricola: a.matricola || "", indirizzo: a.indirizzo || "", localita: a.localita || "" },
    lab: F.id && F.lab ? F.lab : { ragione: L.ragione, indirizzo: L.indirizzo, cap: L.cap, piva: L.piva, telefono: L.telefono },
    tecnico: F.id && F.tecnico ? F.tecnico : { nome: S.me.nome, cf: S.me.cf, sigillo: S.me.sigillo },
    haFirma: !!firmaUtente,
  };
  savingVer = true;
  try {
    const saved = await put("verifiche", id, v);
    const old = F.id ? await getDoc("firme", id).catch(() => null) : null;
    const tecImg = old?.tecnicoImg || S.firmaTecnico || "";
    if (firmaUtente || tecImg) await put("firme", id, { img: firmaUtente || "", tecnicoImg: tecImg });
    const upd = { ...a };
    const latest = S.verifiche.filter((x) => x.apparecchioId === a.id && x.id !== id).every((x) => (x.data || "") <= saved.data);
    if (latest) {
      if (esito === "positivo") upd.ultimaVerifica = saved.data;
      if (saved.fwAggiornato) { upd.firmware = saved.fwAggiornato; upd.firmwareData = saved.dataFine || saved.data; }
      else if (saved.fwPresente) { upd.firmware = saved.fwPresente; if (saved.fwData) upd.firmwareData = saved.fwData; }
      if (a.dgfeAnnuale && saved.dgfeFatto) upd.ultimoDgfe = saved.data;
    }
    if (JSON.stringify(upd) !== JSON.stringify(a)) await put("apparecchi", a.id, upd);
    if (!F.id) ls.del(fkey());
    UI.form = null; delete $("#main").dataset.form; UI.tab = "verifiche"; history.replaceState(null, "", "#verifiche");
    render(); openSheet({ kind: "ver", id });
    toast(esito === "positivo" ? `Rapporto ${saved.numero} salvato. Prossima verifica entro ${fmtD(addYears(saved.data, 2))}` : `Rapporto ${saved.numero} salvato (esito ${esito})`, 4000);
  } catch (e) { apiError(e); }
  finally { savingVer = false; }
}

/* ============================== QR e lettura da foto ============================== */
function parseQR(text) {
  const out = {};
  try {
    const u = new URL(text);
    for (const [k, v] of u.searchParams) { const kk = k.toLowerCase(); if (/matr|serial|^sn$/.test(kk)) out.matricola = v; if (/piva|partitaiva|^iva$|^cf$/.test(kk) && /^\d{11}$/.test(v)) out.piva = v; }
  } catch { }
  if (!out.matricola) { const m = text.toUpperCase().match(/\b(\d{2}[A-Z]{1,3}\d{5,8})\b/); if (m) out.matricola = m[1]; }
  if (!out.piva) { const p = text.match(/(?<!\d)(\d{11})(?!\d)/); if (p) out.piva = p[1]; }
  return out;
}
let qrTarget = null;
async function scanQR(target) {
  qrTarget = target;
  const r = await scanQRLive();
  if (r === null) return;
  if (r === "foto") { $("#qrFile").click(); return; }
  applyQR({ text: r, ...parseQR(r) });
}
$("#qrFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  let res; try { const text = await decodeQRFromImage(file); res = { text, ...parseQR(text) }; } catch (err) { res = { error: err.message }; }
  applyQR(res);
});
function setVal(id, v) { const el = document.getElementById(id); if (el) { el.value = v; el.classList.add("hl"); } }
const isAeUrl = (t) => /^https:\/\/ivaservizi\.agenziaentrate\.gov\.it\/ser\/mobile\/fiscalizzazione\//i.test(String(t || ""));
async function leggiAe(url) { return (await api("GET", "/api/qr/ae?url=" + encodeURIComponent(url))).dati; }
async function applyQR(res) {
  if (qrTarget === "check" && UI.form) {
    UI.form.qrCheck = { ...res, loading: isAeUrl(res.text) }; refreshFormDyn();
    if (!isAeUrl(res.text)) return;
    try {
      const d = await leggiAe(res.text); if (!UI.form) return;
      UI.form.qrCheck = { ...res, ae: d };
      if (!UI.form.tipoSigillo && d.sigilloCodice) { UI.form.tipoSigillo = d.sigilloCodice; setVal("f_tipoSigillo", d.sigilloCodice); }
      if (!UI.form.fwPresente && d.fwDispositivo) { UI.form.fwPresente = d.fwDispositivo; setVal("f_fwPresente", d.fwDispositivo); }
      UI.form.qrUrl = res.text; saveDraft();
    } catch (e) { if (UI.form) UI.form.qrCheck = { ...res, aeErr: e.message }; }
    refreshFormDyn(); return;
  }
  if (UI.sheet?.kind !== "app-edit") return;
  const s = UI.sheet;
  s.qr = { text: res.text || "", error: res.error, found: [], loading: isAeUrl(res.text) };
  if (res.error) return refreshSheetDyn();
  if (s.qr.loading) {
    refreshSheetDyn();
    try { const d = await leggiAe(res.text); if (UI.sheet !== s) return; applyAeToDraft(s, d, res.text); }
    catch (e) { if (UI.sheet !== s) return; s.qr = { text: res.text, found: [], aeErr: e.message }; applyQrFallback(s, res); }
    return;
  }
  applyQrFallback(s, res);
}
function applyQrFallback(s, res) {
  if (res.matricola) { s.draft.matricola = res.matricola; s.qr.found.push("matricola " + res.matricola); setVal("ae_matricola", res.matricola); }
  if (res.piva) {
    const c = S.clienti.find((c) => c.piva === res.piva);
    if (c) { s.draft.clienteId = c.id; setVal("ae_clienteId", c.id); $("#ncBox").hidden = true; s.qr.found.push("cliente " + c.ragione); }
    else { (s.draft.nuovoCliente ||= {}).piva = res.piva; setVal("aenc_piva", res.piva); s.qr.found.push("P.IVA " + res.piva); }
  }
  refreshSheetDyn();
}
/** Mette i dati letti dalla pagina dell'Agenzia nella scheda apparecchio in modifica. */
function applyAeToDraft(s, d, url) {
  const hl = [];
  if (!s.id) {
    const ex = S.apparecchi.find((a) => norm(a.matricola) === norm(d.matricola));
    if (ex) { s.id = ex.id; s.draft = { ...JSON.parse(JSON.stringify(ex)), nuovoCliente: {} }; s.qr.found.push("apparecchio già in archivio: aggiorno la sua scheda"); }
  }
  const dr = s.draft;
  const set = (k, v) => { if (v && dr[k] !== v) { dr[k] = v; hl.push("ae_" + k); } };
  set("matricola", d.matricola.toUpperCase());
  set("modello", d.modelloCompleto);
  if (d.fwDispositivo) { set("firmware", d.fwDispositivo); set("firmwareData", d.fwDispositivoData); }
  if (d.vpData && d.vpPositiva && (!dr.ultimaVerifica || d.vpData > dr.ultimaVerifica)) set("ultimaVerifica", d.vpData);
  dr.ae = { ...d, letto: todayISO() }; dr.qrUrl = url;
  if (d.esercentePiva) {
    const c = S.clienti.find((c) => (c.piva || "").replace(/\s/g, "") === d.esercentePiva);
    if (c) { if (dr.clienteId !== c.id) { dr.clienteId = c.id; hl.push("ae_clienteId"); } s.qr.found.push("cliente in archivio: " + c.ragione); }
    else if (!dr.clienteId) { dr.nuovoCliente = { ...(dr.nuovoCliente || {}), ragione: d.esercenteNome, piva: d.esercentePiva }; hl.push("aenc_ragione", "aenc_piva"); s.qr.found.push("nuovo cliente: " + d.esercenteNome); }
  }
  s.qr = { ...s.qr, loading: false, ae: d };
  $("#sheetRoot").dataset.k = ""; renderSheet();
  for (const id of hl) document.getElementById(id)?.classList.add("hl");
}
function updateNextDates() { const d = UI.sheet?.draft; if (!d) return; const a = $("#aeNextVP"), b = $("#aeNextDG"); if (a) a.textContent = fmtD(addYears(d.ultimaVerifica, 2)); if (b) b.textContent = fmtD(addYears(d.ultimoDgfe, 1)); }

/* ============================== PDF ============================== */
async function makePdf(kind, id, win) {
  const v = S.verifiche.find((x) => x.id === id); if (!v) return;
  if (!window.jspdf) { win?.close(); return toast("Modulo PDF non caricato: ricarica la pagina."); }
  try {
    const f = await getDoc("firme", id).catch(() => null);
    let firmaT = f?.tecnicoImg || "";
    if (!firmaT && v.tecnicoId) firmaT = v.tecnicoId === S.me.id ? S.firmaTecnico : (await api("GET", "/api/firma-tecnico/" + v.tecnicoId).catch(() => ({}))).firma || "";
    const doc = kind === "a4" ? pdfA4(v, f?.img || "", firmaT) : kind === "dich" ? pdfDich(v, f?.img || "", firmaT) : pdfThermal(v, f?.img || "", firmaT);
    const safe = (s) => clean(s).replace(/[^\w.-]+/g, "_").slice(0, 40);
    const nome = `${kind === "dich" ? "Dichiarazione" : "Rapporto"}_${safe(v.numero)}_${safe(v.app?.matricola)}${kind === "80" ? "_80mm" : ""}.pdf`;
    const blob = doc.output("blob");
    if (UI.sheet?.pdf?.url) URL.revokeObjectURL(UI.sheet.pdf.url);
    const url = URL.createObjectURL(blob);
    if (UI.sheet?.kind === "ver" && UI.sheet.id === id) { UI.sheet.pdf = { url, nome }; renderSheet(); }
    if (win && !win.closed) win.location.href = url;
  } catch (e) { win?.close(); apiError(e); }
}

/* ============================== eventi ============================== */
document.addEventListener("click", async (e) => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) {
    if (UI.form) return toast("Salva o esci dal rapporto prima di cambiare sezione.");
    UI.tab = tabBtn.dataset.tab; history.replaceState(null, "", "#" + UI.tab); UI.sheet = null; render(); window.scrollTo(0, 0); return;
  }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "sheet-bg") { if (e.target === el) closeSheet(); return; }
  if (el.tagName === "A" && el.getAttribute("href") === "#") e.preventDefault();
  switch (act) {
    case "close": closeSheet(); break;
    case "filtro": UI.filtro = el.dataset.v; render(); break;
    case "tipo": UI.tipo = el.dataset.v; render(); break;
    case "open-app": openSheet({ kind: "app", id }); break;
    case "open-cli": openSheet({ kind: "cli", id }); break;
    case "open-ver": openSheet({ kind: "ver", id }); break;
    case "new-app": if (!guardWrite()) break; openSheet({ kind: "app-edit", id: null, draft: { clienteId: el.dataset.cli || "", nuovoCliente: {} }, qr: null }); break;
    case "qr-new": if (!guardWrite()) break; openSheet({ kind: "app-edit", id: null, draft: { clienteId: "", nuovoCliente: {} }, qr: null }); scanQR("app"); break;
    case "edit-app": if (!guardWrite()) break; openSheet({ kind: "app-edit", id, draft: JSON.parse(JSON.stringify(apparecchio(id))), qr: null }); break;
    case "new-cli": if (!guardWrite()) break; openSheet({ kind: "cli-edit", id: null, draft: {} }); break;
    case "edit-cli": if (!guardWrite()) break; openSheet({ kind: "cli-edit", id, draft: { ...cliente(id) } }); break;
    case "qr-scan": scanQR("app"); break;
    case "qr-check": scanQR("check"); break;
    case "fw-agg": if (UI.form) { UI.form.fwAggiornato = el.dataset.v; setVal("f_fwAggiornato", el.dataset.v); saveDraft(); refreshFormDyn(); toast("Firmware aggiornato a " + el.dataset.v); } break;
    case "ae-refresh": await aeRefresh(id, el); break;
    case "save-app": await saveApp(); break;
    case "save-cli": await saveCli(); break;
    case "del-app": case "del-cli": case "del-ver":
      if (!el.dataset.ok) { UI.confirm = act; renderSheet(); break; }
      try {
        if (act === "del-ver") { await del("verifiche", id); await del("firme", id).catch(() => { }); }
        else await del(act === "del-app" ? "apparecchi" : "clienti", id);
        closeSheet(); render(); toast("Eliminato.");
      } catch (err) { apiError(err); }
      break;
    case "confirm-cancel": UI.confirm = null; renderSheet(); break;
    case "new-ver": if (!guardWrite()) break; startForm(el.dataset.app || ""); break;
    case "edit-ver": { if (!guardWrite()) break; const v = S.verifiche.find((x) => x.id === id); if (v) startForm("", JSON.parse(JSON.stringify(v))); break; }
    case "form-cancel": saveDraft(); { const wasNew = !UI.form?.id; UI.form = null; delete $("#main").dataset.form; render(); if (wasNew) toast("Bozza conservata su questo dispositivo"); } break;
    case "tipo-form": UI.form.tipo = el.dataset.v; saveDraft(); refreshFormDyn(); renderBar(); break;
    case "dichiarante": UI.form.dichiarante = el.dataset.v; saveDraft(); refreshFormDyn(); break;
    case "esito": { const F = UI.form; if (F.esiti[el.dataset.k] === el.dataset.v) delete F.esiti[el.dataset.k]; else F.esiti[el.dataset.k] = el.dataset.v; saveDraft(); refreshFormDyn(); renderBar(); break; }
    case "all-si": { const F = UI.form; for (const t of buildTests(F.tipo)) if (!t.head && !F.esiti[t.k]) F.esiti[t.k] = "si"; for (const p of PRE) if (!F.esiti[p.k]) F.esiti[p.k] = F.tipo === "privo" && p.k === "p13" ? "no" : "si"; saveDraft(); refreshFormDyn(); renderBar(); break; }
    case "save-ver": await saveVerifica(); break;
    case "sign-utente": openPad("Firma dell'utente", (url) => { UI.form.firmaUtente = url; refreshFormDyn(); }); break;
    case "sign-tecnico": openPad("Firma del tecnico", async (url) => {
      try { await api("PUT", "/api/me", { firma: url }); S.firmaTecnico = url; toast("Firma salvata nel tuo profilo"); } catch (err) { apiError(err); }
      if (UI.form) refreshFormDyn(); else render();
    }); break;
    case "pdf": { const w = window.open("", "_blank"); makePdf(el.dataset.k, id, w); break; }
    case "remind": copyReminder(id); break;
    case "go-abb": UI.tab = "impostazioni"; history.replaceState(null, "", "#impostazioni"); UI.sheet = null; render(); setTimeout(() => $("#abbPanel")?.scrollIntoView({ behavior: "smooth" }), 300); break;
    case "save-profilo": try { const r = await api("PUT", "/api/me", { nome: $("#pfNome").value, cf: $("#pfCf").value, sigillo: $("#pfSigillo").value }); S.me = r.user; render(); toast("Profilo salvato"); } catch (err) { apiError(err); } break;
    case "chg-pwd": showChangePassword(false); break;
    case "logout": await api("POST", "/api/logout").catch(() => { }); S.loaded = false; S.me = null; showLogin(); break;
    case "save-lab": try {
      const r = await api("PUT", "/api/azienda", { ragione: $("#lbRagione").value, piva: $("#lbPiva").value, indirizzo: $("#lbIndirizzo").value, cap: $("#lbCap").value, telefono: $("#lbTel").value, email: $("#lbEmail").value, impostazioni: { luogo: $("#lbLuogo").value, preavviso: $("#lbPre").value } });
      S.azienda = r.azienda; render(); toast("Dati del laboratorio salvati");
    } catch (err) { apiError(err); } break;
    case "tec-add": try {
      const r = await api("POST", "/api/tecnici", { nome: $("#ntNome").value, email: $("#ntEmail").value, cf: $("#ntCf").value, sigillo: $("#ntSigillo").value, ruolo: $("#ntAdmin").checked ? "admin" : "tecnico" });
      await loadImpostazioni(); showSecret(r.tecnico.email, r.password, r.email_inviata);
    } catch (err) { apiError(err); } break;
    case "tec-reset": try { const u = UI.set.t.tecnici.find((x) => x.id === id); const r = await api("POST", `/api/tecnici/${id}/reset`); showSecret(u.email, r.password, r.email_inviata); } catch (err) { apiError(err); } break;
    case "tec-toggle": try { const u = UI.set.t.tecnici.find((x) => x.id === id); await api("PUT", `/api/tecnici/${id}`, { attivo: !u.attivo }); await loadImpostazioni(); toast(u.attivo ? "Tecnico disattivato" : "Tecnico riattivato"); } catch (err) { apiError(err); } break;
    case "paga": try { el.disabled = true; const r = await api("POST", "/api/pagamenti/checkout", { piano_id: id }); location.href = r.url; } catch (err) { el.disabled = false; apiError(err); } break;
    case "csv-scad": exportCsv(); break;
    case "backup": scaricaFile(`BluCheck_archivio_${todayISO()}.json`, new Blob([JSON.stringify({ app: "blucheck", esportato: new Date().toISOString(), azienda: S.azienda, clienti: S.clienti, apparecchi: S.apparecchi, verifiche: S.verifiche }, null, 1)], { type: "application/json" })); break;
  }
});
function showSecret(email, pwd, inviata) {
  const box = $("#tecSecret"); if (!box) return;
  box.innerHTML = `<div class="banner ok" style="flex-direction:column;align-items:stretch"><span>Credenziali di <b>${esc(email)}</b>${inviata ? " (inviate anche per email)" : ""}. Comunicale al tecnico: la password provvisoria non verrà più mostrata.</span><span class="secret">${esc(pwd)}</span></div>`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.bind) { UI[t.dataset.bind] = t.value; render(); return; }
  if (t.dataset.f && UI.form) {
    UI.form[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; saveDraft();
    if (t.dataset.f === "apparecchioId") { const a = apparecchio(t.value); if (a) { UI.form.fwPresente = a.firmware || UI.form.fwPresente; const fe = $("#f_fwPresente"); if (fe) fe.value = UI.form.fwPresente; } refreshFormDyn(); }
    return;
  }
  if (t.dataset.fi && UI.form) { UI.form.interventi[t.dataset.fi] = t.checked; saveDraft(); return; }
  if (t.dataset.ae && UI.sheet?.draft) {
    const d = UI.sheet.draft; d[t.dataset.ae] = t.type === "checkbox" ? t.checked : t.value; t.classList.remove("hl");
    if (t.dataset.ae === "clienteId") $("#ncBox").hidden = !!t.value;
    if (t.dataset.ae === "dgfeAnnuale") $("#dgfeBox").hidden = !t.checked;
    updateNextDates(); return;
  }
  if (t.dataset.aenc && UI.sheet?.draft) { (UI.sheet.draft.nuovoCliente ||= {})[t.dataset.aenc] = t.value; t.classList.remove("hl"); return; }
  if (t.dataset.ce && UI.sheet?.draft) { UI.sheet.draft[t.dataset.ce] = t.value; return; }
});
document.addEventListener("change", (e) => { const t = e.target; if ((t.type === "checkbox" || t.tagName === "SELECT") && (t.dataset.f || t.dataset.fi || t.dataset.ae)) t.dispatchEvent(new Event("input", { bubbles: true })); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && UI.sheet && !$("#padRoot").innerHTML) closeSheet(); });

async function aeRefresh(id, el) {
  if (!guardWrite()) return;
  const a = apparecchio(id); if (!a?.qrUrl) return;
  el.disabled = true; el.textContent = "Lettura in corso…";
  try {
    const d = await leggiAe(a.qrUrl);
    const upd = { ...a, ae: { ...d, letto: todayISO() } };
    if (d.vpData && d.vpPositiva && (!a.ultimaVerifica || d.vpData > a.ultimaVerifica)) upd.ultimaVerifica = d.vpData;
    if (d.fwDispositivo) { upd.firmware = d.fwDispositivo; if (d.fwDispositivoData) upd.firmwareData = d.fwDispositivoData; }
    await put("apparecchi", id, upd); render();
    toast(upd.ultimaVerifica !== a.ultimaVerifica ? `Ultima verificazione aggiornata al ${fmtD(upd.ultimaVerifica)}` : "Dati dell'Agenzia aggiornati");
  } catch (e) { apiError(e); render(); }
}
async function saveApp() {
  if (!guardWrite()) return;
  const s = UI.sheet, d = s.draft;
  if (!d.matricola?.trim()) return toast("Inserisci la matricola del registratore.");
  try {
    let clienteId = d.clienteId;
    if (!clienteId) {
      const nc = d.nuovoCliente || {}; if (!nc.ragione?.trim()) return toast("Scegli un cliente o inserisci la ragione sociale del nuovo cliente.");
      clienteId = uid(); await put("clienti", clienteId, { id: clienteId, ragione: nc.ragione.trim(), piva: (nc.piva || "").trim(), domicilio: (nc.domicilio || "").trim(), telefono: (nc.telefono || "").trim(), email: "", referente: "", note: "" });
    }
    const id = s.id || uid();
    const { nuovoCliente, ...rest } = d;
    await put("apparecchi", id, { ...rest, id, clienteId, matricola: d.matricola.trim().toUpperCase() });
    toast("Apparecchio salvato");
    if (UI.form) { UI.form.apparecchioId = id; saveDraft(); closeSheet(); refreshFormDyn(); }
    else { render(); openSheet({ kind: "app", id }); }
  } catch (err) { apiError(err); }
}
async function saveCli() {
  if (!guardWrite()) return;
  const s = UI.sheet, d = s.draft; if (!d.ragione?.trim()) return toast("Inserisci la ragione sociale.");
  const id = s.id || uid();
  try { await put("clienti", id, { ...d, id, ragione: d.ragione.trim() }); toast("Cliente salvato"); render(); openSheet({ kind: "cli", id }); } catch (err) { apiError(err); }
}
async function copyReminder(id) {
  const a = apparecchio(id), c = cliente(a?.clienteId); if (!a) return; const L = lab();
  const sc = scadenze(a).filter((s) => s.data).map((s) => `${s.tipo === "VP" ? "la verificazione periodica" : "il controllo del DGFE"} entro il ${fmtD(s.data)}`).join(" e ");
  const msg = `Gentile ${c?.ragione || "cliente"}, le ricordiamo che per il registratore telematico ${a.modello || ""} matricola ${a.matricola} è prevista ${sc || "la verificazione periodica"}. Per fissare l'intervento contatti ${L.ragione}${L.telefono ? " al " + L.telefono : ""}. Cordiali saluti.`;
  try { await navigator.clipboard.writeText(msg); toast("Promemoria copiato: incollalo in WhatsApp, SMS o email" + (c?.telefono ? ` (${c.telefono})` : "")); }
  catch { const ta = document.createElement("textarea"); ta.value = msg; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Promemoria copiato"); } catch { toast("Copia non riuscita"); } ta.remove(); }
}
function exportCsv() {
  const rows = [["Tipo", "Scadenza", "Giorni", "Cliente", "P.IVA", "Telefono", "Modello", "Matricola", "Ubicazione", "Ultima"]];
  for (const r of allScadenze()) rows.push([r.tipo, fmtD(r.data), r.st.n ?? "", r.c?.ragione || "", r.c?.piva || "", r.c?.telefono || "", r.a.modello || "", r.a.matricola || "", [r.a.indirizzo, r.a.localita].filter(Boolean).join(" "), fmtD(r.ultima)]);
  const csv = "﻿" + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  scaricaFile(`Scadenze_RT_${todayISO()}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

start();
