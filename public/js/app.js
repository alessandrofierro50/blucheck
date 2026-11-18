"use strict";
/* BluCheck - app dei tecnici */

const S = {
  config: { stripe: false, ai: false, contatti: {} },
  me: null, azienda: null, abb: null, tecnici: [],
  clienti: [], apparecchi: [], verifiche: [], firmaTecnico: "",
  lastSync: null, loaded: false,
};
const UI = { tab: "scadenze", filtro: "tutte", tipo: "tutti", q: "", qa: "", qc: "", qv: "", qg: "", fg: "tutti", sheet: null, form: null, confirm: null, set: null };
const VALID_TABS = ["scadenze", "planning", "apparecchi", "clienti", "aggiornamenti", "verifiche", "impostazioni"];
let vaiAbb = false;
const isAdmin = () => S.me?.ruolo === "admin";
const readonly = () => S.abb?.accesso === "lettura";
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
  S.blocked = null;
  try {
    S.config = await api("GET", "/api/config");
    const b = await api("GET", "/api/bootstrap");
    S.firmaTecnico = (await api("GET", "/api/me/firma")).firma || "";
    applyBootstrap(b);
  } catch (e) {
    if (e.status !== 402) return showLogin(e.message);
    // prova finita o abbonamento sospeso: resta solo la pagina «Abbonamento»
    S.me = me.user; S.azienda = me.azienda; S.abb = me.abbonamento; S.blocked = { code: e.code, message: e.message };
  }
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
  if (e.code === "sola_lettura") { S.abb = { ...(S.abb || {}), accesso: "lettura", stato: "sola_lettura" }; render(); }
  if (e.code === "prova_scaduta" || e.code === "abbonamento_sospeso") { start(); }
  toast(e.message || "Operazione non riuscita.");
}
function guardWrite() {
  if (readonly()) { toast(isAdmin() ? "BluCheck è in sola lettura: rinnova dalla pagina «Abbonamento» per registrare nuove verifiche." : "BluCheck è in sola lettura: chiedi all'amministratore di rinnovare l'abbonamento."); return false; }
  return true;
}

/* ============================== derivati ============================== */
const cliente = (id) => S.clienti.find((c) => c.id === id);
const apparecchio = (id) => S.apparecchi.find((a) => a.id === id);
// Segni sul cliente: «cessato» lo toglie per sempre dalle scadenze; «verificato» è il controllo iniziale fatto dal laboratorio
// (aggiornamenti, verificazione periodica, DGFE annuale sui DTR). I clienti importati dallo storico partono «da verificare».
const cliPills = (c) => (c?.cessato ? ` <span class="pill bad">CESSATO</span>` : c?.verificato ? ` <span class="pill ok">VERIFICATO</span>` : c?.importato ? ` <span class="pill warn">DA VERIFICARE</span>` : "");
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
  for (const a of S.apparecchi) { if (a.dismesso || cliente(a.clienteId)?.cessato) continue; for (const s of scadenze(a)) rows.push({ a, c: cliente(a.clienteId), ...s, st: stato(s.data) }); }
  rows.sort((x, y) => ((x.data || "0000") < (y.data || "0000") ? -1 : 1));
  return rows;
}
const tecnicoNome = (id) => S.tecnici.find((t) => t.id === id)?.nome || "";

/* ============================== render ============================== */
function fromHash() { const h = location.hash.slice(1); if (VALID_TABS.includes(h)) UI.tab = h; if (h === "abbonamento") { UI.tab = "impostazioni"; vaiAbb = true; } }
window.addEventListener("hashchange", () => { if (UI.form) return; fromHash(); render(); });


// ----- Tasto «?»: a cosa serve la sezione aperta e cosa si scrive in ogni campo -----
const AIUTI = {
  scadenze: {
    titolo: "Scadenze",
    serve: "Gli apparecchi da verificare: quelli scaduti, quelli che scadono a breve e quelli a posto.",
    campi: [
      ["Scaduto", "La verificazione periodica è oltre i due anni: l'apparecchio è fuori regola."],
      ["In scadenza", "Manca poco: è il momento di chiamare il cliente e fissare l'intervento."],
      ["Cliente", "Un tocco apre la sua scheda con telefono e indirizzo."],
    ],
    consiglio: "Guarda questa pagina all'inizio della settimana: è da qui che nasce il giro dei tecnici.",
  },
  planning: {
    titolo: "Planning",
    serve: "Il lavoro da fare in un giorno, in un mese o da una data a un'altra: verificazioni periodiche, DGFE e aggiornamenti software, raggruppati per giorno e per cliente.",
    campi: [
      ["Giorno / Mese / Da data a data", "Scegli il periodo; con ‹ e › passi al giorno, al mese o al periodo prima e dopo, «Oggi» torna a oggi."],
      ["Arretrati", "Le scadenze già passate prima del periodo: in cima, da recuperare per prime. Togli la spunta per vedere solo il periodo."],
      ["Aggiornamenti software", "Quelli ancora «da fare» nella sezione Aggiornamenti: si fanno nella stessa visita della verificazione o del DGFE. I clienti senza scadenze nel periodo sono in fondo, da fissare."],
      ["Esporta TXT / PDF", "Il planning con il periodo e i filtri scelti, con le caselle da spuntare: da stampare o dare ai tecnici."],
    ],
    consiglio: "I clienti cessati e gli apparecchi dismessi non compaiono, come nelle Scadenze.",
  },
  apparecchi: {
    titolo: "Apparecchi",
    serve: "I registratori telematici che segui: matricola, modello, cliente e data dell'ultima verificazione.",
    campi: [
      ["Matricola", "Quella sul corpo dell'apparecchio: è il dato che lo identifica davvero."],
      ["QR dell'Agenzia", "Inquadrandolo, i dati dell'apparecchio si compilano da soli."],
      ["Importa QR da file", "Foto, PDF o ZIP con tanti QR delle targhette: vedi il riepilogo (nuovi, da completare, già presenti, non leggibili) e poi salvi tutto insieme."],
      ["Prossima verificazione", "Due anni dall'ultima: il programma la calcola e la mette nelle scadenze."],
    ],
  },
  clienti: {
    titolo: "Clienti",
    serve: "Gli esercenti: dati, sedi e apparecchi installati da ognuno.",
    campi: [
      ["Ragione sociale e P.IVA", "Finiscono sul rapporto di verificazione e sulla dichiarazione."],
      ["Sede", "Dove sta l'apparecchio: serve al tecnico per arrivarci."],
      ["Telefono", "Per avvisare quando la verificazione sta per scadere."],
      ["Software gestionale", "Se il cliente usa un gestionale e quale: chi risponde «Sì» compare nella sezione Aggiornamenti."],
      ["Cliente cessato", "L'attività ha chiuso o non è più vostro cliente: i suoi registratori escono dalle scadenze. Se torna, nella scheda del cliente «Riattiva con lo stesso apparecchio» (le scadenze riprendono) o «Riattiva con un apparecchio nuovo» (il vecchio resta in archivio come dismesso)."],
      ["Verificato", "Spuntalo dopo il controllo iniziale del cliente: aggiornamenti del registratore, verificazione periodica e, sui DTR, scheda di memoria (DGFE) annuale. Resta la data del controllo."],
    ],
  },
  aggiornamenti: {
    titolo: "Aggiornamenti software",
    serve: "I clienti che usano un software gestionale e a che punto sono con gli aggiornamenti.",
    campi: [
      ["Da fare", "Clienti col gestionale per cui non è ancora segnato nulla: sono quelli da visitare."],
      ["Aggiornato", "Si è passati dal cliente e gli aggiornamenti sono installati: resta la data e chi l'ha fatto."],
      ["Non installabile", "Gli aggiornamenti non si possono mettere: va indicato il motivo, hardware troppo vecchio o cliente non disposto a pagarli."],
      ["Abb. 2025, Abb. 2026…", "Anni di abbonamento software pagati dal cliente (canone annuale), presi dalle vendite di BluGest con Impostazioni > «Importa abbonamenti software»."],
      ["Abbonamento da rinnovare", "Clienti che hanno pagato l'abbonamento software negli anni passati ma non ancora per l'anno in corso."],
      ["Esporta TXT / PDF", "L'elenco con i filtri e la ricerca attivi, da stampare o mandare."],
    ],
    consiglio: "Per far comparire un cliente qui, apri la sua scheda in Clienti e rispondi «Sì» a «Usa un software gestionale?».",
  },
  verifiche: {
    titolo: "Rapporti di verificazione",
    serve: "I rapporti compilati: cosa è stato controllato, l'esito e la firma del tecnico e del cliente.",
    campi: [
      ["Esito", "Regolare o non regolare: decide se l'apparecchio può restare in servizio."],
      ["Firme", "Si firmano sullo schermo col dito e restano nel PDF."],
      ["Timbro", "Timbro simulato del cliente (ragione sociale, indirizzo, P.IVA) accanto alla sua firma; si toglie con la casella."],
      ["PDF", "Il rapporto da lasciare al cliente e da conservare: A4, 80 mm o «Condividi» per WhatsApp, email o l'app della stampante."],
      ["Stampante termica", "Con Chrome su Android stampa direttamente sulla stampantina Bluetooth; altrimenti RawBT (Android) o «Condividi PDF 80 mm»."],
    ],
  },
  impostazioni: {
    titolo: "Impostazioni",
    serve: "Il tuo profilo, i dati del laboratorio, i tecnici, l'abbonamento e l'esportazione dei dati.",
    campi: [
      ["Dati del laboratorio", "Compaiono nell'intestazione dei rapporti e nella dichiarazione: controllali bene."],
      ["Tecnici", "Chi entra e quanti ne prevede il tuo abbonamento."],
      ["Abbonamento", "Scadenza e rinnovo con carta, PayPal o bonifico."],
      ["Esporta dati", "Tutto l'archivio dell'azienda, da conservare o da portare altrove."],
      ["Importa abbonamenti software", "Carica gli export CSV di BluGest (Vendite › Storico articolo, es. ABBITAL_2026): l'anno è quello del codice articolo, le note di credito stornano le fatture. Prima il riepilogo, poi la conferma con backup."],
      ["Stampa foto sulla termica", "Apre la pagina /foto: la foto si adatta alla larghezza della carta (80 mm = 576 punti), diventa bianco e nero adatto alla termica e si stampa via Bluetooth, USB/COM, RawBT o driver."],
    ],
  },
};
function aiutoDialog() {
  const a = AIUTI[UI.tab];
  if (!a) return toast("Per questa sezione non c'è ancora una spiegazione.");
  const campi = (a.campi || []).map(([n, t]) => `<p style="margin:10px 0 0"><b>${esc(n)}</b><br><span class="faint">${esc(t)}</span></p>`).join("");
  const consiglio = a.consiglio ? `<p style="margin:14px 0 0;padding-top:12px;border-top:1px solid var(--line)"><b>Consiglio · </b>${esc(a.consiglio)}</p>` : "";
  const w = document.createElement("div");
  w.className = "sheet-wrap";
  w.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(a.titolo)}"><div class="sheet-head gut"><h2>${esc(a.titolo)}</h2>` +
    `<button class="btn sm" data-x="1">Chiudi</button></div><div class="sheet-body gut"><p style="margin:0">${esc(a.serve)}</p>${campi}${consiglio}</div></div>`;
  const chiudi = () => { w.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", esc2); };
  const esc2 = (e) => { if (e.key === "Escape") chiudi(); };
  w.addEventListener("click", (e) => { if (e.target === w || e.target.dataset.x) chiudi(); });
  document.addEventListener("keydown", esc2);
  document.body.append(w);
  document.body.style.overflow = "hidden";
}
document.addEventListener("keydown", (e) => { if (e.key === "F1" && S.loaded && !UI.form) { e.preventDefault(); aiutoDialog(); } });

function render(fromSync) {
  if (!S.loaded) return;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", !UI.form && b.dataset.tab === UI.tab ? "page" : "false"));
  $("#brandSub").textContent = `${S.azienda?.ragione || ""} · ${S.me?.nome || ""}`;
  const m = $("#main");
  $(".tabs").hidden = !!S.blocked; $('header [data-act="new-ver"]').hidden = !!S.blocked || readonly();
  if (S.blocked) { delete m.dataset.form; m.innerHTML = viewBloccato(); $("#barRoot").innerHTML = ""; if (isAdmin()) { if (UI.set?.a) paintAbb(); loadAbb(); } return; }
  if (UI.form) { if (!m.dataset.form) { m.innerHTML = viewForm(); m.dataset.form = "1"; } refreshFormDyn(); renderBar(); if (!fromSync) renderSheet(); else refreshSheetDyn(); return; }
  delete m.dataset.form;
  if (fromSync && UI.tab === "impostazioni") { renderBar(); return; }
  const active = document.activeElement, aid = active?.id, pos = active?.selectionStart;
  let html = banners();
  html += ({ scadenze: viewScadenze, planning: viewPlanning, apparecchi: viewApparecchi, clienti: viewClienti, aggiornamenti: viewAggiornamenti, verifiche: viewVerifiche, impostazioni: viewImpostazioni })[UI.tab]();
  m.innerHTML = html;
  if (aid) { const el = document.getElementById(aid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
  renderBar();
  if (fromSync) { if (UI.sheet && !["app-edit", "cli-edit", "agg"].includes(UI.sheet.kind)) renderSheet(); } else renderSheet();
  if (UI.tab === "impostazioni" && isAdmin()) { if (UI.set) { paintTecnici(); paintAbb(); } loadImpostazioni().then(() => { if (vaiAbb) { vaiAbb = false; $("#abbPanel")?.scrollIntoView({ behavior: "smooth" }); } }); }
}
function banners() {
  const a = S.abb; if (!a) return "";
  const btn = (t) => isAdmin() ? `<button class="btn sm primary" data-act="go-abb">${t}</button>` : `<span class="faint">Avvisa l'amministratore della tua azienda.</span>`;
  if (a.stato === "prova") return `<div class="banner info"><span>Stai usando la <b>prova gratuita</b> fino al <b>${fmtD(a.fine)}</b>${a.giorni <= 3 ? ` (${a.giorni === 0 ? "ultimo giorno" : a.giorni === 1 ? "domani è l'ultimo giorno" : `ancora ${a.giorni} giorni`})` : ""}. Poi l'accesso si sospende: i dati restano.</span>${isAdmin() ? btn("Attiva l'abbonamento") : ""}</div>`;
  if (a.stato === "tolleranza") return `<div class="banner bad"><span><b>Abbonamento scaduto il ${fmtD(a.fine)}.</b> Puoi lavorare normalmente fino al ${fmtD(addDaysIso(a.sola_lettura_dal, -1))}; dal ${fmtD(a.sola_lettura_dal)} BluCheck sarà in sola lettura.</span>${btn("Rinnova ora")}</div>`;
  if (a.stato === "sola_lettura") return `<div class="banner bad"><span><b>BluCheck è in sola lettura</b> (abbonamento scaduto il ${fmtD(a.fine)}): puoi consultare e stampare i rapporti, ma non registrare nuove verifiche. Dal ${fmtD(a.sospensione_dal)} l'accesso sarà sospeso.</span>${btn("Rinnova ora")}</div>`;
  if (a.stato === "in_scadenza" && isAdmin()) return `<div class="banner"><span>L'abbonamento scade il <b>${fmtD(a.fine)}</b> (tra ${a.giorni} giorni).</span><button class="btn sm" data-act="go-abb">Rinnova ora</button></div>`;
  return "";
}
const addDaysIso = (iso, n) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };

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
      <span class="s"><span class="tag">${r.tipo}</span>${r.a.modello || r.a.matricola ? `${esc(r.a.modello || "")} · <span class="mono">${esc(r.a.matricola || "")}</span>` : "Registratore da completare"}${r.a.localita ? " · " + esc(r.a.localita) : ""}</span></span>
      <span class="when"><span class="d">${fmtD(r.data)}</span><span class="pill ${r.st.cls}">${r.st.txt}</span></span>
    </button>`).join("")}</div>`
    : `<div class="list"><div class="empty">${S.apparecchi.length ? "Nessuna scadenza con questi filtri." : `<b>Nessun apparecchio in archivio.</b><span>Aggiungi il primo registratore, anche leggendo il QR code dalla targhetta.</span><button class="btn primary" data-act="new-app">Aggiungi apparecchio</button>`}</div></div>`}`;
}
function viewApparecchi() {
  const q = norm(UI.qa);
  const list = S.apparecchi.filter((a) => !q || norm([a.matricola, a.modello, a.indirizzo, a.localita, a.firmware, cliente(a.clienteId)?.ragione].join(" ")).includes(q))
    .sort((x, y) => norm(cliente(x.clienteId)?.ragione).localeCompare(norm(cliente(y.clienteId)?.ragione)));
  return `<div class="spread"><h2>Apparecchi <span class="faint">(${S.apparecchi.length})</span></h2>
    <div class="row"><button class="btn sm" data-act="qr-new">Leggi QR</button><button class="btn sm" data-act="qr-import">Importa QR da file</button><button class="btn primary sm" data-act="new-app">+ Apparecchio</button></div></div>
  <input type="search" id="qApp" placeholder="Cerca matricola, modello, cliente, firmware…" value="${esc(UI.qa)}" data-bind="qa">
  ${list.length ? `<div class="list">${list.map((a) => {
    const sc = scadenze(a); const worst = sc.map((s) => stato(s.data)).sort((x, y) => (x.n ?? -1e9) - (y.n ?? -1e9))[0];
    return `<button class="item" data-act="open-app" data-id="${a.id}"><span class="stripe ${a.dismesso || cliente(a.clienteId)?.cessato ? "" : worst.cls}"></span>
      <span style="min-width:0"><span class="t">${esc(a.modello || "Modello non indicato")} · <span class="mono">${esc(a.matricola || "")}</span></span><br>
      <span class="s">${esc(cliente(a.clienteId)?.ragione || "—")}${a.firmware ? ` · FW <span class="mono">${esc(a.firmware)}</span>` : ""}${a.dgfeAnnuale ? " · DGFE annuale" : ""}${a.dismesso ? " · dismesso" : ""}${cliente(a.clienteId)?.cessato ? " · cliente cessato" : ""}</span></span>
      <span class="when">${sc.map((s) => `<span class="faint"><span class="tag">${s.tipo}</span><span class="mono">${fmtD(s.data)}</span></span>`).join("")}</span></button>`;
  }).join("")}</div>` : `<div class="list"><div class="empty">Nessun apparecchio trovato.</div></div>`}`;
}
function viewClienti() {
  const q = norm(UI.qc);
  const list = S.clienti.filter((c) => !q || norm([c.ragione, c.piva, c.cf, c.domicilio, c.telefono, c.referente].join(" ")).includes(q)).sort((x, y) => norm(x.ragione).localeCompare(norm(y.ragione)));
  return `<div class="spread"><h2>Clienti <span class="faint">(${S.clienti.length})</span></h2><button class="btn primary sm" data-act="new-cli">+ Cliente</button></div>
  <input type="search" id="qCli" placeholder="Cerca ragione sociale, P.IVA, telefono…" value="${esc(UI.qc)}" data-bind="qc">
  ${list.length ? `<div class="list">${list.map((c) => {
    const n = S.apparecchi.filter((a) => a.clienteId === c.id).length;
    return `<button class="item" data-act="open-cli" data-id="${c.id}"><span class="stripe"></span><span style="min-width:0"><span class="t">${esc(c.ragione)}</span>${cliPills(c)}<br>
    <span class="s">P.IVA <span class="mono">${esc(c.piva || "—")}</span>${c.telefono ? " · " + esc(c.telefono) : ""}</span></span><span class="when"><span class="pill n">${n} RT</span></span></button>`;
  }).join("")}</div>` : `<div class="list"><div class="empty">Nessun cliente trovato.</div></div>`}`;
}
/* ---------- aggiornamenti software ---------- */
const MOTIVI_AGG = { hardware: "Hardware troppo vecchio", non_paga: "Cliente non disposto a pagare gli aggiornamenti" };
const usaGestionale = (c) => c.gestionale === "si" && !c.cessato; // i cessati escono anche da qui
function statoAgg(c) {
  const a = c.aggSw || {};
  if (a.stato === "aggiornato") return { k: "aggiornato", cls: "ok", txt: "Aggiornato", det: `il ${fmtD(a.data)}${a.da ? " · " + a.da : ""}` };
  if (a.stato === "non_installabile") return { k: "non_installabile", cls: "bad", txt: "Non installabile", det: MOTIVI_AGG[a.motivo] || "Motivo non indicato" };
  return { k: "da_fare", cls: "warn", txt: "Da fare", det: "" };
}
// abbonamento software (canone annuale, es. articoli ABBITAL_<anno> di BluGest): anni pagati in c.abbSw, importati da Impostazioni
const annoAbb = () => String(new Date().getFullYear());
const anniAbb = (c) => Object.keys(c.abbSw || {}).filter((a) => c.abbSw[a]?.canoni > 0).sort();
const daRinnovare = (c) => { const a = anniAbb(c), y = annoAbb(); return a.length > 0 && !a.includes(y) && a.some((x) => x < y); };
const abbTags = (c) => anniAbb(c).map((a) => `<span class="tag" title="Abbonamento software ${a}">Abb. ${a}</span>`).join("");
function panelAbbSw(c) {
  const anni = anniAbb(c).reverse();
  if (!anni.length) return "";
  const y = annoAbb();
  return `<div class="panel"><h2>Abbonamento software</h2>
    ${daRinnovare(c) ? `<div class="banner"><span><b>Da rinnovare:</b> nessun canone per il ${y}.</span></div>` : ""}
    <div style="overflow:auto"><table class="t"><thead><tr><th>Anno</th><th>Canoni</th><th>Importo</th><th>Documenti</th></tr></thead><tbody>
    ${anni.map((a) => { const x = c.abbSw[a]; return `<tr><td class="mono">${a}</td><td>${x.canoni}</td><td class="mono">${euroAbb(x.importo)}</td>
      <td>${(x.documenti || []).map((d) => `${esc(d.documento)}${d.data ? " del " + fmtD(d.data) : ""}`).join("<br>")}</td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function righeAggiornamenti() {
  const q = norm(UI.qg);
  return S.clienti.filter(usaGestionale).map((c) => ({ c, st: statoAgg(c) }))
    .filter((r) => UI.fg === "tutti" || (UI.fg === "da_rinnovare" ? daRinnovare(r.c) : r.st.k === UI.fg))
    .filter((r) => !q || norm([r.c.ragione, r.c.piva, r.c.domicilio, r.c.telefono, r.c.software, r.c.aggSw?.note, ...(r.c.nomiBlugest || [])].join(" ")).includes(q))
    .sort((x, y) => norm(x.c.ragione).localeCompare(norm(y.c.ragione)));
}
function viewAggiornamenti() {
  const tutti = S.clienti.filter(usaGestionale).map(statoAgg);
  const n = (k) => tutti.filter((s) => s.k === k).length;
  const stat = (k, cls, num, l) => `<button class="stat ${cls} ${UI.fg === k ? "sel" : ""}" data-act="agg-filtro" data-v="${UI.fg === k ? "tutti" : k}"><b>${num}</b><span class="faint">${l}</span></button>`;
  const rows = righeAggiornamenti();
  const senza = S.clienti.filter((c) => !c.gestionale).length;
  return `<div class="spread"><h2>Aggiornamenti software <span class="faint">(${tutti.length})</span></h2>
    <div class="row"><button class="btn sm" data-act="agg-txt">Esporta TXT</button><button class="btn sm" data-act="agg-pdf">Esporta PDF</button></div></div>
  <div class="stats">${stat("tutti", "", tutti.length, "Con gestionale")}${stat("da_fare", "warn", n("da_fare"), "Da fare")}${stat("aggiornato", "okk", n("aggiornato"), "Aggiornati")}${stat("non_installabile", "bad", n("non_installabile"), "Non installabili")}${(() => { const k = S.clienti.filter(usaGestionale).filter(daRinnovare).length; return k || UI.fg === "da_rinnovare" ? stat("da_rinnovare", "warn", k, `Abbonamento ${annoAbb()} da rinnovare`) : ""; })()}</div>
  ${senza ? `<p class="faint" style="margin:0">${senza} ${senza === 1 ? "cliente non ha" : "clienti non hanno"} ancora la risposta a «Usa un software gestionale?»: si indica nella scheda del cliente.</p>` : ""}
  <input type="search" id="qAgg" placeholder="Cerca cliente, P.IVA, software, note…" value="${esc(UI.qg)}" data-bind="qg">
  ${rows.length ? `<div class="list">${rows.map(({ c, st }) => `<button class="item" data-act="open-agg" data-id="${c.id}"><span class="stripe ${st.cls}"></span>
    <span style="min-width:0"><span class="t">${esc(c.ragione)}</span><br><span class="s">${c.software ? `<span class="tag">${esc(c.software)}</span>` : ""}${abbTags(c)}${esc(st.det || (c.telefono ? c.telefono : ""))}</span></span>
    <span class="when"><span class="pill ${st.cls}">${st.txt}</span></span></button>`).join("")}</div>`
    : `<div class="list"><div class="empty">${tutti.length ? "Nessun cliente con questi filtri." : `<b>Nessun cliente con software gestionale.</b><span>Nella scheda del cliente rispondi «Sì» a «Usa un software gestionale?» e indica quale.</span>`}</div></div>`}`;
}
function sheetAgg() {
  const c = cliente(UI.sheet.id); if (!c) return head("Aggiornamenti") + `<div class="sheet-body gut"><p>Cliente non trovato.</p></div>`;
  const d = UI.sheet.draft, st = statoAgg(c);
  const b = (act, v, cur, l) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`;
  return head(esc(c.ragione), `<button class="btn sm" data-act="open-cli" data-id="${c.id}">Scheda cliente</button>`) + `<div class="sheet-body gut">
    <div class="panel"><dl class="kv"><dt>Software</dt><dd>${esc(c.software || "Non indicato")}</dd><dt>Telefono</dt><dd>${esc(c.telefono || "—")}</dd><dt>Domicilio</dt><dd>${esc(c.domicilio || "—")}</dd>
      <dt>Stato attuale</dt><dd><span class="pill ${st.cls}">${st.txt}</span> ${esc(st.det)}</dd></dl></div>
    ${panelAbbSw(c)}
    <div class="panel"><h2>Aggiornamenti</h2>
      <div class="field"><span>Esito</span><div class="seg wide choose" role="group">${b("agg-stato", "aggiornato", d.stato, "Aggiornato")}${b("agg-stato", "non_installabile", d.stato, "Non installabile")}</div></div>
      ${d.stato === "non_installabile" ? `<div class="field"><span>Perché non si possono installare</span><div class="seg wide choose" role="group">${b("agg-motivo", "hardware", d.motivo, "Hardware troppo vecchio")}${b("agg-motivo", "non_paga", d.motivo, "Il cliente non vuole pagarli")}</div></div>` : ""}
      ${d.stato ? `<label class="field"><span>${d.stato === "aggiornato" ? "Data dell'installazione" : "Data"}</span><input type="date" id="ag_data" data-ag="data" value="${esc(d.data || "")}"></label>` : ""}
      <label class="field"><span>Note</span><textarea id="ag_note" data-ag="note" placeholder="Versione installata, cosa manca, cosa ha detto il cliente…">${esc(d.note || "")}</textarea></label>
    </div>
    <div class="row"><button class="btn primary" data-act="save-agg">Salva</button>${c.aggSw?.stato ? `<button class="btn" data-act="agg-reset">Riporta a «da fare»</button>` : ""}<button class="btn ghost" data-act="close">Annulla</button></div>
  </div>`;
}
async function saveAgg(reset) {
  if (!guardWrite()) return;
  const s = UI.sheet, c = cliente(s.id); if (!c) return;
  const d = s.draft;
  let aggSw;
  if (reset) aggSw = { stato: "", note: d.note || "" };
  else {
    if (!d.stato) return toast("Scegli «Aggiornato» o «Non installabile».");
    if (d.stato === "non_installabile" && !MOTIVI_AGG[d.motivo]) return toast("Indica perché non si possono installare gli aggiornamenti.");
    aggSw = { stato: d.stato, motivo: d.stato === "non_installabile" ? d.motivo : "", data: d.data || todayISO(), note: (d.note || "").trim(), da: S.me?.nome || S.me?.email || "", aggiornatoIl: new Date().toISOString() };
  }
  try { await put("clienti", c.id, { ...c, aggSw }); toast(reset ? "Riportato a «da fare»" : "Aggiornamenti salvati"); closeSheet(); render(); } catch (err) { apiError(err); }
}
function aggTitolo() {
  const f = { tutti: "", da_fare: " - da fare", aggiornato: " - aggiornati", non_installabile: " - non installabili", da_rinnovare: ` - abbonamento ${annoAbb()} da rinnovare` }[UI.fg] || "";
  return `Aggiornamenti software${f}${UI.qg ? ` (ricerca: ${UI.qg})` : ""}`;
}
function exportAggTxt() {
  const rows = righeAggiornamenti(), L = lab();
  const out = [L.ragione || "", aggTitolo().toUpperCase(), `Al ${fmtD(todayISO())} - ${rows.length} clienti`, ""];
  for (const { c, st } of rows) {
    out.push("-".repeat(60), c.ragione || "");
    if (c.piva) out.push(`P.IVA: ${c.piva}`);
    if (c.domicilio) out.push(`Domicilio: ${c.domicilio}`);
    if (c.telefono) out.push(`Telefono: ${c.telefono}`);
    out.push(`Software: ${c.software || "non indicato"}`);
    if (anniAbb(c).length) out.push(`Abbonamento software: ${anniAbb(c).join(", ")}${daRinnovare(c) ? ` (${annoAbb()} da rinnovare)` : ""}`);
    out.push(`Stato: ${st.txt}${st.k === "aggiornato" ? ` il ${fmtD(c.aggSw.data)}${c.aggSw.da ? " (" + c.aggSw.da + ")" : ""}` : ""}${st.k === "non_installabile" ? ` - motivo: ${st.det}${c.aggSw.data ? " (" + fmtD(c.aggSw.data) + ")" : ""}` : ""}`);
    if (c.aggSw?.note) out.push(`Note: ${c.aggSw.note}`);
  }
  out.push("-".repeat(60));
  scaricaFile(`Aggiornamenti_software_${todayISO()}.txt`, new Blob(["\ufeff" + out.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" }));
}
function exportAggPdf() {
  if (!window.jspdf) return toast("Modulo PDF non caricato: ricarica la pagina.");
  const doc = pdfAggiornamenti(righeAggiornamenti(), lab(), aggTitolo());
  scaricaFile(`Aggiornamenti_software_${todayISO()}.pdf`, doc.output("blob"));
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
    <p class="faint" style="margin:0">Accesso: ${esc(me.email)}</p></div>
  <div class="panel" id="provaTermica">${panelProvaTermica()}</div>
  <div class="panel"><h2>Stampa foto sulla termica</h2><p class="faint" style="margin:0">Scatta o scegli una foto: si adatta alla larghezza della carta (80 mm), diventa bianco e nero ottimizzato per la termica (contrasto, gamma, retinatura) e si stampa con Bluetooth, USB/COM, RawBT o il driver. Funziona dal telefono e dal computer e si può aggiungere alla schermata Home.</p>
    <div class="row"><a class="btn primary" href="/foto">Apri «Foto su termica»</a></div></div>`;
  if (!isAdmin()) return h;
  h += `<div class="panel"><h2>Dati del laboratorio</h2><p class="faint" style="margin:0">Compaiono nell'intestazione dei rapporti e nella dichiarazione.</p>
    <div class="grid2">${f("lbRagione", "Ragione sociale", L.ragione)}${f("lbPiva", "Partita IVA", L.piva, "text", 'class="mono"')}${f("lbIndirizzo", "Indirizzo", L.indirizzo)}${f("lbCap", "CAP / Località / Prov.", L.cap)}${f("lbTel", "Telefono", L.telefono, "tel")}${f("lbEmail", "Email (riceve gli avvisi)", L.email, "email")}${f("lbLuogo", "Luogo predefinito sui rapporti", L.luogo)}${f("lbPre", "Giorni di preavviso scadenze", L.preavviso, "number", 'min="1" max="365"')}</div>
    <div class="row"><button class="btn primary" data-act="save-lab">Salva dati laboratorio</button></div></div>
  <div class="panel" id="tecniciPanel"><h2>Tecnici</h2><p class="faint">Caricamento…</p></div>
  <div class="panel" id="abbPanel"><h2>Abbonamento</h2><p class="faint">Caricamento…</p></div>
  <div class="panel"><h2>Esporta dati</h2><p class="faint" style="margin:0">Scarica tutto l'archivio della tua azienda (clienti, apparecchi, rapporti) per conservarlo o passarlo a un altro programma.</p>
    <div class="row"><button class="btn" data-act="backup">Scarica archivio (JSON)</button><button class="btn" data-act="csv-scad">Scadenze (CSV)</button></div></div>
  <div class="panel"><h2>Importa storico</h2><p class="faint" style="margin:0">Carica il file di storico preparato dall'assistenza (clienti con le verifiche fatte prima di BluCheck). Prima vedi il riepilogo, poi confermi; prima di scrivere il programma fa un backup.</p>
    <div class="row"><input type="file" id="impFile" accept=".json,application/json"><button class="btn" data-act="imp-anteprima">Vedi riepilogo</button></div><div id="impBox"></div></div>
  <div class="panel"><h2>Importa abbonamenti software</h2><p class="faint" style="margin:0">In BluGest apri Vendite › Storico articolo, scegli l'articolo del canone (es. ABBITAL_2026) ed esporta il CSV; fallo per ogni anno. Carica qui i file anche tutti insieme: l'anno è quello del codice articolo (dal nome del file), non quello della fattura. Le note di credito stornano le fatture. Ogni anno caricato sostituisce quello già in BluCheck. Prima vedi il riepilogo, poi confermi; prima di scrivere il programma fa un backup.</p>
    <div class="row"><input type="file" id="abbFile" accept=".csv,text/csv,text/plain" multiple><button class="btn" data-act="abb-anteprima">Vedi riepilogo</button></div><div id="abbAnni"></div><div id="abbBox"></div></div>`;
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
/* ---------- pagina «Abbonamento» (standard comune: stato, uso, storico, pagamento con carta, PayPal o bonifico) ---------- */
const PROVINCE_IT = "AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG RI RM RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV".split(" ");
UI.abb = { editDati: false, piano: null, periodicita: "annuale", metodo: null, errDati: "", bonifico: null };
function statoTesto(st) {
  if (!st) return { cls: "n", txt: "" };
  const m = {
    prova: ["acc", `Prova gratuita fino al ${fmtD(st.fine)} (${st.giorni} ${st.giorni === 1 ? "giorno" : "giorni"})`],
    attivo: ["ok", `Attivo fino al ${fmtD(st.fine)}`],
    in_scadenza: ["warn", `Scade il ${fmtD(st.fine)} (tra ${st.giorni} giorni)`],
    tolleranza: ["bad", `Scaduto il ${fmtD(st.fine)} · dal ${fmtD(st.sola_lettura_dal)} sola lettura`],
    sola_lettura: ["bad", `Sola lettura · dal ${fmtD(st.sospensione_dal)} sospeso`],
    sospeso: ["bad", st.manuale ? "Sospeso" : `Sospeso (scaduto il ${fmtD(st.fine)})`],
    prova_scaduta: ["bad", `Prova terminata il ${fmtD(st.fine)}`],
  }[st.stato] || ["n", st.etichetta || ""];
  return { cls: m[0], txt: m[1] };
}
async function loadAbb() {
  try { const a = await api("GET", "/api/abbonamento"); UI.set = { ...(UI.set || {}), a }; paintAbb(); } catch (e) { apiError(e); }
}
const df = (k) => ($("#df_" + k)?.value || "").trim();
function datiFattHtml(a) {
  const d = a.dati_fatturazione || {};
  if (!UI.abb.editDati && a.dati_salvati && !a.problemi.length) {
    const nome = d.tipo === "privato" ? `${d.nome || ""} ${d.cognome || ""}` : d.denominazione;
    const ids = [d.partita_iva ? `P.IVA ${d.partita_iva}` : "", d.codice_fiscale ? `C.F. ${d.codice_fiscale}` : ""].filter(Boolean).join(" · ");
    return `<div class="qrres"><div class="spread"><b>Dati di fatturazione</b><button class="btn sm" data-act="abb-edit-dati">Modifica</button></div>
      <span>${esc(nome)}${ids ? " · " + esc(ids) : ""}</span><span class="faint">${esc(`${d.indirizzo}, ${d.cap} ${d.comune}${d.provincia ? " (" + d.provincia + ")" : ""}`)} · ${d.codice_destinatario ? "Codice destinatario " + esc(d.codice_destinatario) : "PEC " + esc(d.pec || "")}</span></div>`;
  }
  const f = (k, l, extra = "", cls = "") => `<label class="field"><span>${l}</span><input type="text" id="df_${k}" value="${esc(d[k] || "")}" class="${cls}" ${extra}></label>`;
  const tipo = d.tipo || "azienda";
  return `<div class="panel" style="padding:12px;gap:10px"><b>Dati di fatturazione</b>
    <p class="faint" style="margin:0">Servono per la fattura elettronica: sono obbligatori prima di pagare.</p>
    <label class="field"><span>Intestatario</span><select id="df_tipo" data-act-change="abb-tipo">
      <option value="azienda" ${tipo === "azienda" ? "selected" : ""}>Azienda o professionista con partita IVA</option>
      <option value="privato" ${tipo === "privato" ? "selected" : ""}>Persona senza partita IVA</option>
      <option value="pa" ${tipo === "pa" ? "selected" : ""}>Pubblica Amministrazione</option></select></label>
    <div class="grid2">
      ${tipo === "privato" ? f("nome", "Nome") + f("cognome", "Cognome") : f("denominazione", "Ragione sociale")}
      ${tipo !== "privato" ? f("partita_iva", "Partita IVA", 'inputmode="numeric"', "mono") : ""}
      ${f("codice_fiscale", "Codice fiscale" + (tipo === "azienda" ? " (facoltativo)" : ""), 'autocapitalize="characters"', "mono")}
      ${f("indirizzo", "Indirizzo")}${f("cap", "CAP", 'inputmode="numeric" maxlength="5"', "mono")}${f("comune", "Comune")}
      <label class="field"><span>Provincia</span><select id="df_provincia"><option value="">—</option>${PROVINCE_IT.map((p) => `<option ${d.provincia === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      ${tipo === "pa" ? f("codice_destinatario", "Codice univoco ufficio (6 caratteri)", 'maxlength="6"', "mono") : f("codice_destinatario", "Codice destinatario SDI (7 caratteri)", 'maxlength="7" placeholder="0000000 se non lo hai"', "mono")}
      ${tipo !== "pa" ? f("pec", "PEC (se non hai il codice destinatario)") : ""}
      ${f("email", "Email per la ricevuta")}
    </div>
    <div class="err">${esc(UI.abb.errDati)}</div>
    <div class="row"><button class="btn primary" data-act="abb-save-dati">Salva dati di fatturazione</button>${a.dati_salvati ? `<button class="btn" data-act="abb-cancel-dati">Annulla</button>` : ""}</div></div>`;
}
function abbHtml(a) {
  const st = a.stato, t = statoTesto(st), c = S.config.contatti || {};
  const ab = UI.abb;
  const metodi = a.metodi || [];
  if (!ab.piano || !a.piani.find((p) => p.id === ab.piano)) ab.piano = a.azienda.piano_id && a.piani.find((p) => p.id === a.azienda.piano_id) ? a.azienda.piano_id : a.piani[0]?.id;
  if (!metodi.find((m) => m.id === ab.metodo)) ab.metodo = metodi[0]?.id || null;
  const pl = a.piani.find((p) => p.id === ab.piano);
  const haMensile = a.piani.some((p) => p.mensile);
  if (ab.periodicita === "mensile" && !pl?.mensile) ab.periodicita = "annuale";
  const imp = pl ? (ab.periodicita === "mensile" ? pl.mensile : pl.annuale) : null;
  const bon = ab.bonifico || a.bonifico_in_attesa;
  const pronti = a.dati_salvati && !a.problemi.length;
  const copia = (v) => `<button class="btn sm ghost" data-act="copia" data-v="${esc(v)}">Copia</button>`;
  return `<div class="spread"><h2>Abbonamento</h2><span class="pill ${t.cls}" style="white-space:normal">${esc(t.txt)}</span></div>
    <dl class="kv"><dt>Piano</dt><dd>${esc(a.piano || "—")}${st.prova ? " (in prova)" : ""}</dd><dt>Tecnici</dt><dd>${a.tecnici_attivi} attivi su ${a.azienda.max_tecnici}</dd>
      ${st.fine ? `<dt>Scadenza</dt><dd>${fmtD(st.fine)}</dd>` : ""}</dl>
    ${bon ? `<div class="banner info" style="flex-direction:column;align-items:stretch;gap:6px"><b>Bonifico in attesa di accredito</b>
      <span>Intestatario: <b>${esc(bon.intestatario)}</b></span>
      <span class="row">IBAN: <b class="mono">${esc(bon.iban)}</b>${copia(bon.iban.replace(/\s/g, ""))}</span>
      <span class="row">Importo: <b>${euro(bon.importo_cent)}</b></span>
      <span class="row">Causale: <b class="mono">${esc(bon.causale)}</b>${copia(bon.causale)}</span>
      <span class="faint">L'abbonamento si rinnova quando BluCode conferma l'accredito; riceverai la ricevuta per email.</span></div>` : ""}
    ${metodi.length ? `
      <h3 style="font-size:16px;margin-top:4px">${st.prova || st.stato === "prova_scaduta" ? "Attiva l'abbonamento" : "Rinnova o cambia piano"}</h3>
      <p class="faint" style="margin:0">${st.prova ? "L'abbonamento parte da oggi e i dati che hai inserito restano tutti." : "Il rinnovo parte dalla fine del periodo in corso: non perdi i giorni rimasti."}</p>
      ${datiFattHtml(a)}
      ${haMensile ? `<div class="seg choose" role="group"><button data-act="abb-per" data-v="annuale" aria-pressed="${ab.periodicita === "annuale"}">Annuale</button><button data-act="abb-per" data-v="mensile" aria-pressed="${ab.periodicita === "mensile"}">Mensile</button></div>` : ""}
      <div class="plans">${a.piani.map((p) => { const i = ab.periodicita === "mensile" ? p.mensile : p.annuale; return `<button class="plan ${ab.piano === p.id ? "cur" : ""}" data-act="abb-piano" data-id="${esc(p.id)}" style="text-align:left;cursor:pointer;color:var(--ink)" ${i ? "" : "disabled"}>
        <span class="spread"><b style="font-family:var(--f-display);font-size:18px">${esc(p.nome)}</b>${a.azienda.piano_id === p.id ? `<span class="pill acc">attuale</span>` : ""}</span>
        <span class="price">${i ? euro(i.importo) : "—"} <small>/ ${ab.periodicita === "mensile" ? "mese" : (p.mesi === 12 ? "anno" : p.mesi + " mesi")}</small></span>
        <span class="faint">${esc(p.descrizione || "")} · fino a ${p.max_tecnici} ${p.max_tecnici === 1 ? "tecnico" : "tecnici"}</span></button>`; }).join("")}</div>
      <div class="field"><span>Come vuoi pagare</span><div class="seg wide choose" role="group">${metodi.map((m) => `<button data-act="abb-metodo" data-v="${m.id}" aria-pressed="${ab.metodo === m.id}">${m.id === "carta" ? "Carta, Google Pay, Apple Pay" : esc(m.nome)}</button>`).join("")}</div></div>
      ${imp ? `<div class="spread" style="border-top:1px solid var(--line);padding-top:10px"><span>${esc(pl.nome)} ${ab.periodicita}: <b>${euro(imp.importo)}</b>${imp.rimborso_bollo ? ` + bollo ${euro(imp.rimborso_bollo)}` : ""} · IVA non dovuta (regime forfettario)</span>
        <span class="row"><b style="font-family:var(--f-display);font-size:22px">${euro(imp.totale)}</b><button class="btn primary" data-act="abb-paga" ${pronti ? "" : "disabled"}>${ab.metodo === "bonifico" ? "Mostra i dati per il bonifico" : "Paga ora"}</button></span></div>
        ${pronti ? "" : `<p class="faint" style="margin:0">Compila prima i dati di fatturazione.</p>`}` : ""}
      <p class="faint" style="margin:0">${ab.metodo === "carta" ? "Pagamento sicuro sulla pagina di Stripe: i dati della carta non passano da BluCheck." : ab.metodo === "paypal" ? "Si apre PayPal per confermare il pagamento." : "Ti mostriamo IBAN e causale: l'abbonamento si rinnova quando arriva l'accredito."}</p>`
    : `<div class="banner info"><span>Per rinnovare contatta l'assistenza: ${esc(a.contatti || [c.email, c.telefono].filter(Boolean).join(" · "))}.</span></div>`}
    ${a.pagamenti.length ? `<details ${a.pagamenti.length <= 3 ? "open" : ""}><summary>Storico (${a.pagamenti.length})</summary><div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>Data</th><th>Descrizione</th><th>Periodo</th><th class="num">Totale</th><th></th></tr></thead><tbody>
      ${a.pagamenti.map((x) => `<tr><td>${fmtD(x.pagato_il || x.creato)}</td><td>${esc(x.descrizione)}<br><span class="faint">${esc(x.metodo_nome)}${x.stato === "in_attesa" ? " · in attesa" : ""}${x.fattura ? " · fattura " + esc(x.fattura) : ""}</span></td>
        <td>${x.periodo_da ? `${fmtD(x.periodo_da)} – ${fmtD(x.periodo_a)}` : "—"}</td><td class="num">${euro(x.totale_cent)}</td>
        <td>${x.fattura ? `<a class="btn sm ghost" href="/api/app/pagamenti/${encodeURIComponent(x.id)}/proforma.pdf">Ricevuta</a>` : ""}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
}
function paintAbb() {
  const p = $("#abbPanel"); if (!p || !UI.set?.a) return;
  p.innerHTML = abbHtml(UI.set.a);
}
async function abbAzione(act, el) {
  const a = UI.set?.a; if (!a) return;
  if (act === "abb-edit-dati") { UI.abb.editDati = true; UI.abb.errDati = ""; return paintAbb(); }
  if (act === "abb-cancel-dati") { UI.abb.editDati = false; UI.abb.errDati = ""; return paintAbb(); }
  if (act === "abb-piano") { UI.abb.piano = el.dataset.id; return paintAbb(); }
  if (act === "abb-per") { UI.abb.periodicita = el.dataset.v; return paintAbb(); }
  if (act === "abb-metodo") { UI.abb.metodo = el.dataset.v; return paintAbb(); }
  if (act === "abb-save-dati") {
    const body = {}; for (const k of ["tipo", "denominazione", "nome", "cognome", "partita_iva", "codice_fiscale", "indirizzo", "cap", "comune", "provincia", "codice_destinatario", "pec", "email"]) body[k] = df(k);
    try { await api("PUT", "/api/app/pagamenti/dati-fatturazione", body); UI.abb.editDati = false; UI.abb.errDati = ""; toast("Dati di fatturazione salvati"); await loadAbb(); }
    catch (e) { UI.abb.errDati = e.message; a.dati_fatturazione = { ...a.dati_fatturazione, ...body }; paintAbb(); }
    return;
  }
  if (act === "abb-paga") {
    el.disabled = true;
    try {
      const r = await api("POST", "/api/app/pagamenti/checkout", { piano: UI.abb.piano, periodicita: UI.abb.periodicita, metodo: UI.abb.metodo });
      if (r.redirect_url) { location.href = r.redirect_url; return; }
      if (r.bonifico) { UI.abb.bonifico = r.bonifico; toast(r.gia_in_attesa ? "Hai già un bonifico in attesa: ecco i dati." : "Ecco i dati per il bonifico."); await loadAbb(); $("#abbPanel")?.scrollIntoView({ behavior: "smooth" }); }
    } catch (e) { el.disabled = false; apiError(e); }
  }
}
document.addEventListener("change", (e) => { if (e.target.id === "df_tipo" && UI.set?.a) { const a = UI.set.a; const body = {}; for (const k of ["denominazione", "nome", "cognome", "partita_iva", "codice_fiscale", "indirizzo", "cap", "comune", "provincia", "codice_destinatario", "pec", "email"]) body[k] = df(k); a.dati_fatturazione = { ...a.dati_fatturazione, ...body, tipo: e.target.value }; paintAbb(); } });
async function handlePaymentReturn() {
  const q = new URLSearchParams(location.search); const pid = q.get("pagamento"); if (!pid) return;
  const esito = q.get("esito");
  history.replaceState(null, "", "/app#abbonamento");
  if (esito === "annullato") { toast("Pagamento annullato: nessun addebito."); return; }
  if (esito === "errore") { toast("Il pagamento non è stato completato. Riprova o scegli un altro metodo.", 5000); return; }
  toast("Verifica del pagamento in corso…");
  for (let i = 0; i < 6; i++) {
    try {
      const r = await api("GET", `/api/app/pagamenti/${encodeURIComponent(pid)}/esito`);
      if (r.pagamento.stato === "pagato") { toast(`Pagamento ricevuto. Abbonamento attivo fino al ${fmtD(r.stato.fine)}. La ricevuta ti arriva per email.`, 6000); S.blocked = null; await start(); return; }
    } catch (e) { break; }
    await new Promise((res) => setTimeout(res, 2500));
  }
  toast("Il pagamento è in elaborazione: l'abbonamento si aggiorna appena il gestore lo conferma.", 6000);
}
/* ---------- accesso sospeso (prova finita o abbonamento sospeso): solo la pagina «Abbonamento» ---------- */
function viewBloccato() {
  const b = S.blocked;
  return `<div class="banner bad" style="flex-direction:column;align-items:flex-start;gap:6px"><b style="font-family:var(--f-display);font-size:18px">${b.code === "prova_scaduta" ? "La prova gratuita è terminata" : "L'accesso è sospeso"}</b><span>${b.code === "prova_scaduta" ? "L'accesso è sospeso, ma i dati che hai inserito sono conservati: attiva l'abbonamento e riparti da dove eri." : "I tuoi dati sono conservati: rinnova l'abbonamento per riprendere da dove eri."}${isAdmin() ? "" : ""}</span></div>
    ${isAdmin() ? `<div class="panel" id="abbPanel"><h2>Abbonamento</h2><p class="faint">Caricamento…</p></div>`
      : `<div class="panel"><p style="margin:0">Chiedi all'amministratore della tua azienda di attivare l'abbonamento: i dati sono conservati e torneranno disponibili subito dopo.</p></div>`}
    <div class="row"><button class="btn" data-act="chg-pwd">Cambia password</button><button class="btn ghost" data-act="logout">Esci</button></div>`;
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
  const body = ({ app: sheetApp, "app-edit": sheetAppEdit, cli: sheetCli, "cli-edit": sheetCliEdit, ver: sheetVer, agg: sheetAgg, qrimp: () => window.sheetQrImp() })[s.kind]();
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
      <div class="field"><span><label for="ae_clienteId">Cliente</label></span>${lookupRow(`<select id="ae_clienteId" data-ae="clienteId"><option value="">— Nuovo cliente —</option>${cli.map((c) => `<option value="${c.id}" ${a.clienteId === c.id ? "selected" : ""}>${esc(cliLabel(c))}</option>`).join("")}</select>`, "clienti-ae", "clienti")}</div>
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
  const sv = (c.storicoVerifiche || []).slice().sort().reverse();
  return head(esc(c.ragione), `<button class="btn sm" data-act="edit-cli" data-id="${c.id}">Modifica</button>`) + `<div class="sheet-body gut">
    ${c.cessato ? `<div class="banner" style="flex-direction:column;align-items:stretch"><span><b>Cliente cessato:</b> i suoi registratori non compaiono più nelle scadenze. Se torna cliente puoi riattivarlo.</span>
      <div class="row"><button class="btn sm" data-act="riattiva-stesso" data-id="${c.id}">Riattiva con lo stesso apparecchio</button><button class="btn sm" data-act="riattiva-nuovo" data-id="${c.id}">Riattiva con un apparecchio nuovo</button></div></div>` : ""}
    ${c.riattivatoIl && !c.cessato ? `<div class="banner info"><span><b>Riattivato il ${fmtD(c.riattivatoIl)}</b>${c.cessatoIl ? ` (era cessato dal ${fmtD(c.cessatoIl)})` : ""}.</span></div>` : ""}
    ${c.verificato ? `<div class="banner ok"><span><b>Verificato${c.verificatoIl ? ` il ${fmtD(c.verificatoIl)}` : ""}:</b> controllo iniziale fatto (aggiornamenti, verificazione periodica, DGFE).</span></div>` : c.importato && !c.cessato ? `<div class="banner info"><span><b>Da verificare:</b> cliente preso dallo storico. Controlla aggiornamenti, verificazione periodica e DGFE (annuale sui DTR), poi spunta «Verificato».</span></div>` : ""}
    <div class="panel"><dl class="kv"><dt>P.IVA</dt><dd class="mono">${esc(c.piva || "—")}</dd><dt>Codice fiscale</dt><dd class="mono">${esc(c.cf || "—")}</dd>
      <dt>SDI / PEC</dt><dd><span class="mono">${esc(c.sdi || "—")}</span>${c.pec ? " · " + esc(c.pec) : ""}</dd><dt>Domicilio</dt><dd>${esc(c.domicilio || "—")}</dd>
      <dt>Telefono</dt><dd>${esc(c.telefono || "—")}</dd><dt>Email</dt><dd>${esc(c.email || "—")}</dd><dt>Referente</dt><dd>${esc(c.referente || "—")}</dd>
      <dt>Gestionale</dt><dd>${c.gestionale === "si" ? `Sì${c.software ? " · " + esc(c.software) : ""} · <a href="#" data-act="open-agg" data-id="${c.id}">aggiornamenti: ${statoAgg(c).txt.toLowerCase()}</a>` : c.gestionale === "no" ? "No" : "Non indicato"}</dd>
      <dt>Note</dt><dd style="white-space:pre-line">${esc(c.note || "—")}</dd></dl></div>
    ${panelAbbSw(c)}
    ${sv.length ? `<div class="panel"><h2>Verificazioni precedenti (storico)</h2><p class="faint" style="margin:0">${sv.map((d) => `<span class="mono">${fmtD(d)}</span>`).join(" · ")}</p></div>` : ""}
    <div class="panel"><div class="spread"><h2>Registratori</h2><button class="btn sm" data-act="new-app" data-cli="${c.id}">+ Apparecchio</button></div>
      ${apps.length ? `<div class="list">${apps.map((a) => `<button class="item" data-act="open-app" data-id="${a.id}"><span class="stripe"></span><span><span class="t">${esc(a.modello || "Registratore da completare")}</span><br><span class="s mono">${esc(a.matricola)}</span></span><span class="when">${scadenze(a).map((s) => `<span class="faint"><span class="tag">${s.tipo}</span>${fmtD(s.data)}</span>`).join("")}</span></button>`).join("")}</div>` : `<p class="faint">Nessun registratore.</p>`}</div>
    <div class="row"><button class="btn danger sm" data-act="del-cli" data-id="${c.id}">Elimina cliente</button></div>${confirmBox("questo cliente (i suoi apparecchi restano in archivio)", "del-cli", c.id)}
  </div>`;
}
function sheetCliEdit() {
  const c = UI.sheet.draft; const f = (k, l, t = "text") => `<label class="field"><span>${l}</span><input type="${t}" id="ce_${k}" data-ce="${k}" value="${esc(c[k] ?? "")}"></label>`;
  return head(UI.sheet.id ? "Modifica cliente" : "Nuovo cliente") + `<div class="sheet-body gut"><div class="panel">
    <div class="grid2">${f("ragione", "Ragione sociale")}${f("piva", "Partita IVA")}${f("cf", "Codice fiscale")}${f("sdi", "Codice SDI")}${f("pec", "PEC", "email")}${f("domicilio", "Domicilio / Residenza")}${f("telefono", "Telefono", "tel")}${f("email", "Email", "email")}${f("referente", "Referente (nome, qualifica)")}</div>
    <div class="grid2"><label class="field"><span>Usa un software gestionale?</span><select id="ce_gestionale" data-ce="gestionale">${[["", "— Non indicato —"], ["si", "Sì"], ["no", "No"]].map(([v, l]) => `<option value="${v}" ${(c.gestionale || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field" id="ceSwBox" ${c.gestionale === "si" ? "" : "hidden"}><span>Quale software gestionale</span><input type="text" id="ce_software" data-ce="software" value="${esc(c.software ?? "")}" placeholder="Nome del programma"></label></div>
    <label class="field"><span>Note</span><textarea id="ce_note" data-ce="note">${esc(c.note || "")}</textarea></label>
    <label class="check"><input type="checkbox" id="ce_cessato" data-ce="cessato" ${c.cessato ? "checked" : ""}> Cliente cessato (non va più in scadenza)</label>
    <label class="check"><input type="checkbox" id="ce_verificato" data-ce="verificato" ${c.verificato ? "checked" : ""}> Verificato: controllo iniziale fatto (aggiornamenti, verificazione periodica, DGFE annuale sui DTR)</label></div>
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
      <label class="check"><input type="checkbox" data-act="ver-timbro" data-id="${v.id}" ${conTimbro(v) ? "checked" : ""} ${v.cli?.ragione ? "" : "disabled"}> Timbro del cliente accanto alla sua firma${v.cli?.ragione ? "" : " (manca la ragione sociale)"}</label>
      ${pdf ? `<div class="qrres"><b>${esc(pdf.nome)}</b><div class="row"><a class="btn sm primary" href="${pdf.url}" target="_blank" rel="noopener">Apri per stampare</a><a class="btn sm" href="${pdf.url}" download="${esc(pdf.nome)}">Scarica</a><button class="btn sm" data-act="pdf-share" data-id="${v.id}">Condividi</button></div></div>` : ""}</div>
    ${panelTermica(v)}
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
    motivoSigillo: "", dichiarante: "tecnico", firmaUtente: "", qrCheck: null, timbro: true,
  };
}
function startForm(appId, existing) {
  if (existing) {
    UI.form = { ...existing, firmaUtente: "" };
    getDoc("firme", existing.id).then((d) => { if (d && UI.form && UI.form.id === existing.id) { UI.form.firmaUtente = d.img || ""; refreshFormDyn(); } }).catch(() => { });
  } else {
    const draft = ls.get(fkey());
    UI.form = (!appId && draft && draft.apparecchioId) ? { timbro: true, ...draft } : newForm(appId);
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
    <div class="field"><span><label for="f_apparecchioId">Apparecchio</label></span>${lookupRow(`<select id="f_apparecchioId" data-f="apparecchioId"></select>`, "apparecchi-ver", "apparecchi")}</div>
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
    <label class="check"><input type="checkbox" id="f_timbro" data-f="timbro" ${F.timbro ? "checked" : ""}> Timbro del cliente accanto alla sua firma (ragione sociale, indirizzo, P.IVA dall'anagrafica)</label>
    <div id="timbroBox"></div>
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
  const tb = F.timbro ? timbroCliente({ ragione: c?.ragione, domicilio: c?.domicilio, piva: c?.piva, cf: c?.cf }) : null;
  $("#timbroBox").innerHTML = !F.timbro ? "" : tb ? `<div class="timbro-prev"><img src="${tb.url}" alt="Anteprima del timbro del cliente"></div>` : `<p class="faint" style="margin:0">Il timbro compare quando il registratore scelto ha un cliente con la ragione sociale.</p>`;
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
    cli: { ragione: c?.ragione || "", domicilio: c?.domicilio || "", piva: c?.piva || "", cf: c?.cf || "" },
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
// «Importa QR da file» (public/js/importa-qr.js) si carica solo quando serve; cambiare ?v= a ogni modifica del file
let importaQrCaricato = null;
function caricaImportaQr() {
  return importaQrCaricato ||= new Promise((resolve, reject) => {
    const sc = document.createElement("script"); sc.src = "/js/importa-qr.js?v=20261118";
    sc.onload = resolve; sc.onerror = () => { importaQrCaricato = null; sc.remove(); reject(new Error("caricamento")); };
    document.head.appendChild(sc);
  });
}
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

/* ============================== tasto «Elenco» (clienti, apparecchi) ============================== */
const cliLabel = (c) => `${c.ragione || "—"}${c.piva ? " · " + c.piva : ""}`;
const appLabel = (a) => `${cliente(a.clienteId)?.ragione || "—"} · ${a.modello || ""} · ${a.matricola || ""}`;
const writeOk = () => { if (!guardWrite()) throw new Error("BluCheck è in sola lettura: non puoi creare nuovi elementi."); };
function lookupClienti({ current, opener, onPick }) {
  openLookup({
    title: "Clienti", rows: S.clienti, current, opener, onPick,
    sortKey: (c) => c.ragione || "",
    hay: (c) => [c.ragione, c.domicilio, c.piva, c.cf, c.codiceFiscale, c.telefono, c.email, c.referente].join(" "),
    view: (c) => ({
      t: esc(c.ragione || "—"),
      s: [c.domicilio && esc(c.domicilio), c.piva && `P.IVA <span class="mono">${esc(c.piva)}</span>`, (c.cf || c.codiceFiscale) && `CF <span class="mono">${esc(c.cf || c.codiceFiscale)}</span>`, c.telefono && esc(c.telefono)].filter(Boolean).join(" · "),
      r: `<span class="pill n">${S.apparecchi.filter((a) => a.clienteId === c.id).length} RT</span>`,
    }),
    placeholder: "Cerca per ragione sociale, città, partita IVA, telefono o codice fiscale",
    create: readonly() ? null : {
      label: "Nuovo cliente",
      fields: [
        { k: "ragione", l: "Ragione sociale o cognome e nome", wide: true },
        { k: "piva", l: "Partita IVA", cls: "mono", attrs: 'inputmode="numeric" maxlength="11"' },
        { k: "telefono", l: "Telefono", type: "tel" },
        { k: "domicilio", l: "Domicilio / Residenza (indirizzo e città)", wide: true },
        { k: "email", l: "Email", type: "email" },
      ],
      initial: (q) => (/^\d{11}$/.test(q) ? { piva: q } : { ragione: q }),
      note: "Referente e note si completano dopo nella scheda del cliente.",
      save: async (v) => {
        writeOk();
        const ragione = (v.ragione || "").trim(), piva = (v.piva || "").replace(/\s/g, "");
        if (!ragione) throw new Error("Inserisci la ragione sociale.");
        if (piva && !/^\d{11}$/.test(piva)) throw new Error("La partita IVA ha 11 cifre.");
        const dup = piva && S.clienti.find((c) => (c.piva || "").replace(/\s/g, "") === piva);
        if (dup) throw new Error(`Questa partita IVA è già di «${dup.ragione}»: torna all'elenco e sceglilo.`);
        const id = uid();
        const c = await put("clienti", id, { id, ragione, piva, domicilio: (v.domicilio || "").trim(), telefono: (v.telefono || "").trim(), email: (v.email || "").trim(), referente: "", note: "" });
        toast("Cliente salvato"); return c;
      },
    },
  });
}
function lookupApparecchi({ current, opener, onPick }) {
  openLookup({
    title: "Apparecchi", rows: S.apparecchi.filter((a) => !a.dismesso || a.id === current), current, opener, onPick,
    sortKey: (a) => `${cliente(a.clienteId)?.ragione || "~"} ${a.modello || ""} ${a.matricola || ""}`,
    hay: (a) => { const c = cliente(a.clienteId); return [a.matricola, a.modello, c?.ragione, c?.piva, a.indirizzo, a.localita, a.firmware].join(" "); },
    view: (a) => {
      const st = stato(a.ultimaVerifica ? addYears(a.ultimaVerifica, 2) : "");
      return { t: esc(cliente(a.clienteId)?.ragione || "Cliente non indicato"),
        s: `${esc(a.modello || "Modello non indicato")} · <span class="mono">${esc(a.matricola || "")}</span>${a.localita ? " · " + esc(a.localita) : ""}`,
        r: `<span class="pill ${st.cls}">VP ${st.n === null ? "—" : fmtD(addYears(a.ultimaVerifica, 2))}</span>` };
    },
    placeholder: "Cerca per matricola, marca e modello o cliente",
    create: readonly() ? null : {
      label: "Nuovo apparecchio",
      fields: [
        { k: "clienteId", l: "Esercente (cliente)", type: "pick", wide: true, text: (id) => (cliente(id) ? cliLabel(cliente(id)) : ""),
          pick: (cur, set) => lookupClienti({ current: cur, onPick: (c) => set(c.id) }) },
        { k: "modello", l: "Marchio / Modello" },
        { k: "matricola", l: "Matricola", cls: "mono", attrs: 'autocapitalize="characters"' },
        { k: "indirizzo", l: "Ubicazione: indirizzo" },
        { k: "localita", l: "CAP / Località / Prov." },
        { k: "ultimaVerifica", l: "Ultima verificazione periodica", type: "date" },
      ],
      initial: (q) => (/\d/.test(q) && /^[A-Za-z0-9]{6,}$/.test(q) ? { matricola: q.toUpperCase() } : { modello: q }),
      note: "Firmware, DGFE, dati dell'Agenzia (QR) e note si completano dopo nella scheda dell'apparecchio.",
      save: async (v) => {
        writeOk();
        const matricola = (v.matricola || "").trim().toUpperCase();
        if (!v.clienteId || !cliente(v.clienteId)) throw new Error("Scegli l'esercente dall'elenco (o crealo con «Nuovo cliente»).");
        if (!matricola) throw new Error("Inserisci la matricola del registratore.");
        const dup = S.apparecchi.find((a) => norm(a.matricola) === norm(matricola));
        if (dup) throw new Error(`La matricola ${matricola} è già in archivio (${cliente(dup.clienteId)?.ragione || "—"}): torna all'elenco e sceglila.`);
        const id = uid();
        const a = await put("apparecchi", id, { id, clienteId: v.clienteId, modello: (v.modello || "").trim(), matricola, indirizzo: (v.indirizzo || "").trim(), localita: (v.localita || "").trim(), ultimaVerifica: v.ultimaVerifica || "", dgfeAnnuale: false, dismesso: false, note: "" });
        toast("Apparecchio salvato"); return a;
      },
    },
  });
}
Lookups["clienti-ae"] = (btn) => {
  const sel = btn.closest(".lk-row").querySelector("select");
  lookupClienti({ current: sel.value, opener: btn, onPick: (c) => pickIntoSelect(sel, c.id, cliLabel(c)) });
};
Lookups["apparecchi-ver"] = (btn) => {
  const sel = btn.closest(".lk-row").querySelector("select");
  lookupApparecchi({ current: sel.value, opener: btn, onPick: (a) => pickIntoSelect(sel, a.id, appLabel(a)) });
};

/* ============================== PDF ============================== */
// timbro: scelto nel rapporto (i rapporti di prima non l'avevano: partono senza), si può cambiare al momento della stampa
const conTimbro = (v) => !!v.cli?.ragione && (UI.sheet?.kind === "ver" && UI.sheet.id === v.id && UI.sheet.timbro !== undefined ? UI.sheet.timbro : v.timbro === true);
async function firmeRapporto(v) {
  const f = await getDoc("firme", v.id).catch(() => null);
  let firmaT = f?.tecnicoImg || "";
  if (!firmaT && v.tecnicoId) firmaT = v.tecnicoId === S.me.id ? S.firmaTecnico : (await api("GET", "/api/firma-tecnico/" + v.tecnicoId).catch(() => ({}))).firma || "";
  return { f, firmaT };
}
async function makePdf(kind, id, win) {
  const v = S.verifiche.find((x) => x.id === id); if (!v) return;
  if (!window.jspdf) { win?.close(); return toast("Modulo PDF non caricato: ricarica la pagina."); }
  try {
    const { f, firmaT } = await firmeRapporto(v);
    const tb = conTimbro(v) ? timbroCliente(v.cli) : null;
    const doc = kind === "a4" ? pdfA4(v, f?.img || "", firmaT, tb) : kind === "dich" ? pdfDich(v, f?.img || "", firmaT, tb) : pdfThermal(v, f?.img || "", firmaT, tb);
    const safe = (s) => clean(s).replace(/[^\w.-]+/g, "_").slice(0, 40);
    const nome = `${kind === "dich" ? "Dichiarazione" : "Rapporto"}_${safe(v.numero)}_${safe(v.app?.matricola)}${kind === "80" ? "_80mm" : ""}.pdf`;
    const blob = doc.output("blob");
    if (UI.sheet?.pdf?.url) URL.revokeObjectURL(UI.sheet.pdf.url);
    const url = URL.createObjectURL(blob);
    if (UI.sheet?.kind === "ver" && UI.sheet.id === id) { UI.sheet.pdf = { url, nome, blob }; renderSheet(); }
    if (win && !win.closed) win.location.href = url;
  } catch (e) { win?.close(); apiError(e); }
}

/* ---------------- stampa diretta sulla termica ---------------- */
function panelTermica(v) {
  const p = btPref(), bt = btDisponibile(), st = UI.sheet?.bt || {};
  const carta = [80, 58].map((n) => `<button data-act="bt-carta" data-v="${n}" aria-pressed="${p.carta === n}">${n} mm</button>`).join("");
  return `<div class="panel"><h2>Stampante termica Bluetooth</h2>
    <p class="faint" style="margin:0">${bt ? `Stampa il rapporto direttamente sulla stampantina, senza passare dal PDF. La prima volta scegli la stampante dall'elenco (deve essere accesa e vicina).${p.nome ? ` Ultima usata: <b>${esc(p.nome)}</b>.` : ""}`
      : isAndroid() ? "Questo browser non vede le stampanti Bluetooth: apri BluCheck con Chrome, oppure usa RawBT qui sotto."
      : "Su iPhone e iPad il browser non può collegarsi alle stampanti Bluetooth: usa «Condividi PDF 80 mm» e scegli l'app della stampante."}</p>
    <div class="field"><span>Larghezza carta</span><div class="seg wide choose" role="group">${carta}</div></div>
    <div class="row">${bt ? `<button class="btn primary" data-act="bt-stampa" data-id="${v.id}" ${st.busy ? "disabled" : ""}>${st.busy ? `Stampa in corso… ${Math.round((st.pct || 0) * 100)}%` : "Stampa sulla termica"}</button>${Termica.device ? `<button class="btn sm" data-act="bt-cambia" data-id="${v.id}">Cambia stampante</button>` : ""}` : ""}
      ${isAndroid() ? `<button class="btn${bt ? " sm" : ""}" data-act="bt-rawbt" data-id="${v.id}">Stampa con RawBT</button>` : ""}
      ${serDisponibile() ? `<button class="btn${bt ? " sm" : ""}" data-act="ser-stampa" data-id="${v.id}" ${st.busy ? "disabled" : ""}>Stampa da USB / porta COM</button>` : ""}
      <button class="btn${bt ? " sm" : ""}" data-act="pdf80-share" data-id="${v.id}">Condividi PDF 80 mm</button>${st.busy ? `<button class="btn sm" data-act="stampa-annulla">Annulla</button>` : ""}</div>
    ${velocitaSeg()}
    ${st.err ? `<div class="qrres"><b>Stampa non riuscita</b>${esc(st.err)}</div>` : ""}</div>`;
}
// velocità di stampa (Bluetooth, RawBT, USB/COM): blocchi più piccoli con pause e testina più lenta = stampa più scura e regolare
const velocitaSeg = () => { const v = btPref().velocita; return `<div class="field"><span>Velocità stampa</span><div class="seg wide choose" role="group">${[["normale", "Normale"], ["lenta", "Lenta"], ["molto", "Molto lenta"]].map(([k, l]) => `<button data-act="bt-vel" data-v="${k}" aria-pressed="${v === k}">${l}</button>`).join("")}</div>
    <small class="faint">Vale per «Stampa via Bluetooth» e «Stampa da USB / porta COM» (Lenta circa 35 mm/s, Molto lenta 15 mm/s). Con RawBT e col PDF da Windows la velocità la decidono l'app o il driver.</small></div>`; };
/* prova di stampa termica (Impostazioni): scheda di verifica in bianco da compilare a mano, con Bluetooth, RawBT o PDF */
const PROVA = { tipo: "integro" };
function panelProvaTermica() {
  const p = btPref(), bt = btDisponibile();
  const carta = [80, 58].map((n) => `<button data-act="bt-carta" data-v="${n}" aria-pressed="${p.carta === n}">${n} mm</button>`).join("");
  const tipo = [["integro", "Sigillo integro (All. 1)"], ["privo", "Sigillo assente (All. 2)"]].map(([k, l]) => `<button data-act="prova-tipo" data-v="${k}" aria-pressed="${PROVA.tipo === k}">${l}</button>`).join("");
  return `<h2>Prova di stampa termica</h2>
    <p class="faint" style="margin:0">Stampa la scheda di verifica in bianco da compilare a mano (caselle SI/NO, righe per esercente, apparecchio, firme e timbro), con in fondo un controllo della larghezza.${p.nome ? ` Ultima stampante: <b>${esc(p.nome)}</b>.` : ""}</p>
    <div class="field"><span>Scheda</span><div class="seg wide choose" role="group">${tipo}</div></div>
    <div class="field"><span>Larghezza carta</span><div class="seg wide choose" role="group">${carta}</div></div>
    ${velocitaSeg()}
    <div class="row">${bt ? `<button class="btn${isAndroid() ? " primary" : ""}" data-act="prova-bt" ${PROVA.busy ? "disabled" : ""}>${PROVA.busy ? `Stampa in corso… ${Math.round((PROVA.pct || 0) * 100)}%` : "Stampa con Bluetooth"}</button>` : ""}
      ${isAndroid() ? `<button class="btn" data-act="prova-rawbt">Stampa con RawBT</button>` : ""}
      ${serDisponibile() ? `<button class="btn${isAndroid() ? "" : " primary"}" data-act="prova-ser" ${PROVA.busy ? "disabled" : ""}>Stampa da USB / porta COM</button>` : ""}
      <button class="btn" data-act="prova-pdf">PDF 80 mm (Windows / altre app)</button>${PROVA.busy ? `<button class="btn sm" data-act="stampa-annulla">Annulla</button>` : ""}</div>
    <p class="faint" style="margin:0">Dal computer (Chrome o Edge) usa «Stampa da USB / porta COM»: scegli la porta della stampante (USB o Bluetooth abbinato) e la scheda esce lunga quanto serve, con i caratteri della stampante e il taglio, senza impostare il driver. Bluetooth diretto: solo stampanti «BLE» con Chrome su Android; se la tua non compare usa RawBT. Il PDF resta per stampare col driver POS80 di Windows.</p>
    ${PROVA.err ? `<div class="qrres"><b>Stampa non riuscita</b>${esc(PROVA.err)}</div>` : ""}`;
}
const paintProva = () => { const el = $("#provaTermica"); if (el) el.innerHTML = panelProvaTermica(); };
const bytesProva = () => escposSchedaBianca(btPref().carta, PROVA.tipo, lab());
async function provaSer() {
  if (PROVA.busy) return; PROVA.busy = true; PROVA.err = ""; paintProva();
  try { await serStampa(await bytesProva(), true); toast("Scheda inviata alla stampante"); }
  catch (e) { if (e?.name !== "NotFoundError") PROVA.err = e.message || String(e); }
  PROVA.busy = false; paintProva();
}
async function provaBt() {
  if (PROVA.busy) return; PROVA.busy = true; PROVA.pct = 0; PROVA.err = ""; paintProva();
  try {
    await btCollega(true);
    const bytes = await bytesProva();
    let last = 0; await btStampa(bytes, (p) => { if (p - last >= 0.05 || p === 1) { last = p; PROVA.pct = p; paintProva(); } });
    toast("Scheda inviata alla stampante");
  } catch (e) {
    if (!(e?.name === "NotFoundError" && /cancel/i.test(e.message || ""))) PROVA.err = e?.name === "NetworkError" ? "La stampante non risponde: controlla che sia accesa, vicina e non collegata a un altro telefono." : e?.name === "NotFoundError" ? "Nessuna stampante scelta. Se la tua non compare nell'elenco è Bluetooth classico: usa «Stampa con RawBT»." : e.message || String(e);
    if (e?.name === "NetworkError") Termica.ch = null;
  }
  PROVA.busy = false; paintProva();
}
async function escposDi(id) {
  const v = S.verifiche.find((x) => x.id === id); if (!v) throw new Error("Rapporto non trovato.");
  const { f, firmaT } = await firmeRapporto(v);
  return escposRapporto(v, f?.img || "", firmaT, conTimbro(v) ? timbroCliente(v.cli) : null, btPref().carta);
}
async function stampaTermica(id, scegli) {
  const s = UI.sheet; if (!s || s.bt?.busy) return;
  s.bt = { busy: true, pct: 0 }; renderSheet();
  try {
    if (scegli) await btCollega(true);
    const bytes = await escposDi(id);
    let last = 0; await btStampa(bytes, (p) => { if (p - last >= 0.05 || p === 1) { last = p; s.bt.pct = p; if (UI.sheet === s) renderSheet(); } });
    s.bt = {}; toast("Rapporto inviato alla stampante");
  } catch (e) {
    const annullato = e?.name === "NotFoundError" && /cancel/i.test(e.message || "");
    s.bt = annullato ? {} : { err: e?.name === "NetworkError" ? "La stampante non risponde: controlla che sia accesa, vicina e non collegata a un altro telefono, poi riprova." : e.message || String(e) };
    if (e?.name === "NetworkError") { Termica.ch = null; }
  }
  if (UI.sheet === s) renderSheet();
}
async function stampaSeriale(id, scegli) {
  const s = UI.sheet; if (!s || s.bt?.busy) return;
  s.bt = { busy: true, pct: 0 }; renderSheet();
  try { const bytes = await escposDi(id); await serStampa(bytes, scegli, (p) => { s.bt.pct = p; }); s.bt = {}; toast("Rapporto inviato alla stampante"); }
  catch (e) { s.bt = e?.name === "NotFoundError" ? {} : { err: e.message || String(e) }; }
  if (UI.sheet === s) renderSheet();
}
async function pdfBlob(kind, id) {
  const v = S.verifiche.find((x) => x.id === id); if (!v || !window.jspdf) throw new Error("Modulo PDF non caricato: ricarica la pagina.");
  const { f, firmaT } = await firmeRapporto(v); const tb = conTimbro(v) ? timbroCliente(v.cli) : null;
  const safe = (s) => clean(s).replace(/[^\w.-]+/g, "_").slice(0, 40);
  return { blob: pdfThermal(v, f?.img || "", firmaT, tb).output("blob"), nome: `Rapporto_${safe(v.numero)}_${safe(v.app?.matricola)}_80mm.pdf`, titolo: `Rapporto ${v.numero}` };
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
    case "aiuto": aiutoDialog(); break;
    case "close": closeSheet(); break;
    case "filtro": UI.filtro = el.dataset.v; render(); break;
    case "tipo": UI.tipo = el.dataset.v; render(); break;
    case "open-app": openSheet({ kind: "app", id }); break;
    case "open-cli": openSheet({ kind: "cli", id }); break;
    case "open-ver": openSheet({ kind: "ver", id }); break;
    case "open-agg": { const c = cliente(id); if (c) openSheet({ kind: "agg", id, draft: { stato: c.aggSw?.stato || "", motivo: c.aggSw?.motivo || "", data: c.aggSw?.data || todayISO(), note: c.aggSw?.note || "" } }); break; }
    case "agg-stato": UI.sheet.draft.stato = el.dataset.v; renderSheet(); break;
    case "agg-motivo": UI.sheet.draft.motivo = el.dataset.v; renderSheet(); break;
    case "save-agg": await saveAgg(false); break;
    case "agg-reset": await saveAgg(true); break;
    case "agg-filtro": UI.fg = el.dataset.v; render(); break;
    case "agg-txt": exportAggTxt(); break;
    case "agg-pdf": exportAggPdf(); break;
    case "new-app": if (!guardWrite()) break; openSheet({ kind: "app-edit", id: null, draft: { clienteId: el.dataset.cli || "", nuovoCliente: {} }, qr: null }); break;
    case "qr-new": if (!guardWrite()) break; openSheet({ kind: "app-edit", id: null, draft: { clienteId: "", nuovoCliente: {} }, qr: null }); scanQR("app"); break;
    case "edit-app": if (!guardWrite()) break; openSheet({ kind: "app-edit", id, draft: JSON.parse(JSON.stringify(apparecchio(id))), qr: null }); break;
    case "new-cli": if (!guardWrite()) break; openSheet({ kind: "cli-edit", id: null, draft: {} }); break;
    case "riattiva-stesso": case "riattiva-nuovo": await riattivaCliente(id, act === "riattiva-nuovo"); break;
    case "edit-cli": if (!guardWrite()) break; openSheet({ kind: "cli-edit", id, draft: { ...cliente(id) } }); break;
    case "qr-scan": scanQR("app"); break;
    case "qr-import": if (!guardWrite()) break; try { await caricaImportaQr(); window.qiNuovo(); openSheet({ kind: "qrimp" }); } catch { toast("Funzione non disponibile: ricarica la pagina e riprova."); } break;
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
    case "pdf-share": { const p = UI.sheet?.pdf; if (p?.blob) await condividiFile(p.blob, p.nome, p.nome.replace(/\.pdf$/, "")); break; }
    case "pdf80-share": try { const r = await pdfBlob("80", id); await condividiFile(r.blob, r.nome, r.titolo); } catch (err) { apiError(err); } break;
    case "ver-timbro": if (UI.sheet) { UI.sheet.timbro = el.checked; if (UI.sheet.pdf?.url) URL.revokeObjectURL(UI.sheet.pdf.url); UI.sheet.pdf = null; renderSheet(); } break;
    case "bt-carta": ls.set(BT_PREF, { ...btPref(), carta: Number(el.dataset.v) }); if (UI.sheet) renderSheet(); paintProva(); break;
    case "prova-bt": await provaBt(); break;
    case "prova-tipo": PROVA.tipo = el.dataset.v; paintProva(); break;
    case "prova-ser": await provaSer(); break;
    case "ser-stampa": await stampaSeriale(id, !Seriale.port); break;
    case "prova-rawbt": try { location.href = rawbtUrl(await bytesProva()); setTimeout(() => toast("Se non si apre niente, installa RawBT dal Play Store e collega lì la stampante.", 6000), 1500); } catch (err) { apiError(err); } break;
    case "prova-pdf": { const w = window.open("", "_blank"); try { const blob = pdfSchedaBianca(PROVA.tipo, lab()).output("blob"), url = URL.createObjectURL(blob); if (w && !w.closed) w.location.href = url; else scaricaFile(`Scheda_verifica_80mm_${PROVA.tipo}.pdf`, blob); } catch (err) { w?.close(); apiError(err); } break; }
    case "stampa-annulla": stampaAnnulla(); break;
    case "bt-vel": ls.set(BT_PREF, { ...btPref(), velocita: el.dataset.v, lenta: undefined }); if (UI.sheet) renderSheet(); paintProva(); break;
    case "bt-stampa": await stampaTermica(id, !Termica.device); break;
    case "bt-cambia": await stampaTermica(id, true); break;
    case "bt-rawbt": try { const b = await escposDi(id); location.href = rawbtUrl(b); setTimeout(() => toast("Se non si apre niente, installa RawBT dal Play Store e collega lì la stampante.", 6000), 1500); } catch (err) { apiError(err); } break;
    case "remind": copyReminder(id); break;
    case "go-abb": UI.tab = "impostazioni"; vaiAbb = true; history.replaceState(null, "", "#abbonamento"); UI.sheet = null; render(); break;
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
    case "abb-edit-dati": case "abb-cancel-dati": case "abb-piano": case "abb-per": case "abb-metodo": case "abb-save-dati": case "abb-paga": await abbAzione(act, el); break;
    case "copia": try { await navigator.clipboard.writeText(el.dataset.v); toast("Copiato"); } catch { toast(el.dataset.v, 6000); } break;
    case "csv-scad": exportCsv(); break;
    case "imp-anteprima": case "imp-conferma": await importaStorico(act === "imp-conferma"); break;
    case "abb-anteprima": case "abb-conferma": await importaAbbonamenti(act === "abb-conferma"); break;
    case "imp-tutti-bc": case "imp-tutti-file": document.querySelectorAll(`#impBox input[data-disc][value="${act === "imp-tutti-file" ? "nuovo" : "attuale"}"]`).forEach((x) => { x.checked = true; }); break;
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
    if (t.dataset.f === "timbro") refreshFormDyn();
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
  if (t.dataset.ce && UI.sheet?.draft) { UI.sheet.draft[t.dataset.ce] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.ce === "gestionale") $("#ceSwBox").hidden = t.value !== "si"; return; }
  if (t.dataset.ag && UI.sheet?.draft) { UI.sheet.draft[t.dataset.ag] = t.value; return; }
});
document.addEventListener("change", (e) => { const t = e.target; if ((t.type === "checkbox" || t.tagName === "SELECT") && (t.dataset.f || t.dataset.fi || t.dataset.ae || t.dataset.ce)) t.dispatchEvent(new Event("input", { bubbles: true })); });
document.addEventListener("change", (e) => { if (e.target.id === "abbFile") abbFileScelti(); });
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
const CAMPI_IMPORT = { piva: "P.IVA", cf: "Codice fiscale", sdi: "Codice SDI", pec: "PEC", email: "Email", telefono: "Telefono", domicilio: "Domicilio", cessato: "Cessato" };
async function importaStorico(conferma) {
  const box = $("#impBox"); const file = $("#impFile")?.files?.[0];
  if (!file) return toast("Scegli prima il file di storico.");
  if (conferma && !guardWrite()) return;
  try {
    const body = JSON.parse(await file.text());
    const scelte = {};
    box.querySelectorAll("input[data-disc]:checked").forEach((x) => { scelte[x.dataset.disc] = x.value; });
    const r = await api("POST", "/api/importa-storico", { ...body, conferma: !!conferma, scelte });
    if (r.anteprima) {
      const disc = r.discordanze || [];
      const righe = disc.map((d) => `<tr><td>${esc(d.ragione)}</td><td>${esc(CAMPI_IMPORT[d.campo] || d.campo)}</td>
        <td><label><input type="radio" name="d-${esc(d.chiave)}" data-disc="${esc(d.chiave)}" value="attuale" checked> ${esc(d.attuale)}</label></td>
        <td><label><input type="radio" name="d-${esc(d.chiave)}" data-disc="${esc(d.chiave)}" value="nuovo"> ${esc(d.nuovo)}</label></td></tr>`).join("");
      box.innerHTML = `<div class="banner info" style="flex-direction:column;align-items:stretch"><span>Clienti nuovi da inserire: <b>${r.nuovi}</b>${r.nuovi ? ` (${r.cessati} cessati, ${r.verificati} verificati${r.senza_data ? `, ${r.senza_data} senza data` : ""})` : ""}.
        Già presenti da aggiornare: <b>${r.aggiornati}</b>${r.date_avanzate ? ` (${r.date_avanzate} con una verifica più recente)` : ""}. Già presenti e uguali: <b>${r.saltati.length}</b>.
        ${disc.length ? `<br>Dati diversi tra BluCheck e il file: <b>${disc.length}</b>. Scegli quale tenere (se non scegli resta quello di BluCheck). I campi vuoti in BluCheck si riempiono da soli.` : ""}</span>
        ${disc.length ? `<div class="row"><button class="btn" data-act="imp-tutti-bc">Tieni tutti quelli di BluCheck</button><button class="btn" data-act="imp-tutti-file">Prendi tutti quelli del file</button></div>
        <div style="overflow:auto;max-height:50vh"><table class="t"><thead><tr><th>Cliente</th><th>Dato</th><th>In BluCheck</th><th>Nel file</th></tr></thead><tbody>${righe}</tbody></table></div>` : ""}
        ${r.nuovi || r.aggiornati ? `<div class="row"><button class="btn primary" data-act="imp-conferma">Importa e aggiorna</button></div>` : ""}</div>`;
    } else {
      box.innerHTML = `<div class="banner ok"><span>Inseriti <b>${r.importati}</b> clienti nuovi, aggiornati <b>${r.aggiornati}</b>${r.cambiati ? ` (${r.cambiati} dati presi dal file)` : ""}. ${r.backup ? `Backup fatto prima dell'import: <span class="mono">${esc(r.backup)}</span>.` : ""}</span></div>`;
      toast("Storico importato"); await start();
    }
  } catch (err) { if (err instanceof SyntaxError) toast("Il file non è un JSON valido."); else apiError(err); }
}
/* Import degli abbonamenti software dai CSV «Storico articolo» di BluGest (Data;Tipo;Documento;Soggetto;Variante;Lotto;Quantità;Prezzo netto;Importo).
   L'anno di competenza viene dal codice articolo nel nome del file (es. storico-ABBITAL_2025.csv); se manca lo si scrive a mano. */
function csvRighe(testo) {
  const out = []; let riga = [], campo = "", q = false;
  testo = testo.replace(/^\ufeff/, "");
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i];
    if (q) { if (ch === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ";") { riga.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && testo[i + 1] === "\n") i++; riga.push(campo); campo = ""; if (riga.some((x) => x.trim())) out.push(riga); riga = []; }
    else campo += ch;
  }
  riga.push(campo); if (riga.some((x) => x.trim())) out.push(riga);
  return out;
}
const numIt = (v) => { const s = String(v || "").trim(); return Number(/,\d+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s) || 0; };
const dataIt = (v) => { const s = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
async function leggiCsvAbbonamenti(files) {
  const anni = [];
  for (const [i, f] of files.entries()) {
    const rows = csvRighe(await f.text());
    const h = (rows.shift() || []).map((x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());
    const col = (...nomi) => h.findIndex((x) => nomi.some((n) => x === n || x.startsWith(n)));
    const cS = col("soggetto", "cliente", "ragione sociale"), cQ = col("quantita"), cI = col("importo"), cD = col("data"), cDoc = col("documento");
    if (cS < 0 || cQ < 0) throw new Error(`«${f.name}» non sembra un export dello storico articolo di BluGest (mancano le colonne Soggetto e Quantità).`);
    const anno = ($(`#abbAnno${i}`)?.value || "").trim() || (f.name.match(/(?:^|[^0-9])(20\d\d)(?:[^0-9]|$)/) || [])[1] || "";
    if (!/^20\d\d$/.test(anno)) throw new Error(`Scrivi l'anno di competenza per «${f.name}».`);
    anni.push({ anno, file: f.name, righe: rows.map((r) => ({ soggetto: (r[cS] || "").trim(), quantita: numIt(r[cQ]), importo: cI >= 0 ? numIt(r[cI]) : 0, data: cD >= 0 ? dataIt(r[cD]) : "", documento: cDoc >= 0 ? (r[cDoc] || "").trim() : "" })).filter((r) => r.soggetto) });
  }
  return anni;
}
function abbFileScelti() {
  const files = [...($("#abbFile")?.files || [])], box = $("#abbAnni"); if (!box) return;
  UI.abbScelte = {};
  $("#abbBox").innerHTML = "";
  box.innerHTML = files.length ? `<div class="grid3">${files.map((f, i) => `<label class="field"><span>Anno di «${esc(f.name)}»</span><input type="number" min="2000" max="2099" id="abbAnno${i}" class="mono" value="${(f.name.match(/(?:^|[^0-9])(20\d\d)(?:[^0-9]|$)/) || [])[1] || ""}"></label>`).join("")}</div>` : "";
}
const euroAbb = (n) => Number(n || 0).toFixed(2).replace(".", ",") + " €";
async function importaAbbonamenti(conferma) {
  const box = $("#abbBox"), files = [...($("#abbFile")?.files || [])];
  if (!files.length) return toast("Scegli prima i file CSV esportati da BluGest.");
  if (conferma && !guardWrite()) return;
  try {
    const anni = await leggiCsvAbbonamenti(files);
    // le scelte fatte restano finché non si cambiano i file (al secondo riepilogo le tendine spariscono)
    const abbinamenti = (UI.abbScelte ||= {});
    box.querySelectorAll("select[data-abb]").forEach((x) => { if (x.value) abbinamenti[x.dataset.abb] = x.value; });
    const r = await api("POST", "/api/importa-abbonamenti", { formato: "blucheck-abbonamenti-1", fonte: anni.map((a) => a.file).join(", "), anni: anni.map(({ anno, righe }) => ({ anno, righe })), abbinamenti, conferma: !!conferma });
    if (!r.anteprima) {
      box.innerHTML = `<div class="banner ok"><span>Abbonamenti aggiornati su <b>${r.aggiornati}</b> clienti${r.nuoviClienti ? ` (${r.nuoviClienti} nuovi)` : ""}. ${r.backup ? `Backup fatto prima dell'import: <span class="mono">${esc(r.backup)}</span>.` : ""}</span></div>`;
      toast(`Abbonamenti aggiornati su ${r.aggiornati} clienti`); await start(); return;
    }
    const opz = S.clienti.slice().sort((x, y) => norm(x.ragione).localeCompare(norm(y.ragione))).map((c) => `<option value="${c.id}">${esc(c.ragione)}</option>`).join("");
    const tipo = { nuovo: "aggiunto", cambiato: "cambiato", tolto: "tolto", stornato: "stornato (nota di credito)" };
    const righe = r.cambi.map((c) => `<tr><td>${esc(c.ragione)}${c.nuovo ? ` <span class="pill warn">nuovo cliente</span>` : ""}${c.come === "ricordato" || c.come === "scelto" || (c.soggetti[0] && norm(c.soggetti[0]) !== norm(c.ragione)) ? `<br><span class="faint">in BluGest: ${esc(c.soggetti.join(", "))}</span>` : ""}</td>
      <td>${c.righe.map((x) => `<span class="mono">${x.anno}</span> ${tipo[x.tipo]}${x.canoni ? ` · ${x.canoni} × ${euroAbb(x.importo / x.canoni)}` : ""}${x.prima ? ` (prima ${esc(x.prima)})` : ""}${x.motivo ? ` (${esc(x.motivo)})` : ""}`).join("<br>") || "—"}</td>
      <td>${c.segnaGestionale ? "«Usa un gestionale» diventa Sì" : ""}${c.avvisi.length ? `<br><span class="faint">${c.avvisi.map(esc).join("<br>")}</span>` : ""}</td></tr>`).join("");
    const nt = r.nonTrovati.map((n) => `<tr><td>${esc(n.soggetto)}</td><td class="mono">${n.anni.join(", ")}</td><td><select data-abb="${esc(n.soggetto)}"><option value="">Scegli…</option><option value="nuovo">Crea un cliente nuovo</option><option value="ignora">Ignora</option>${n.proposta && cliente(n.proposta) ? `<option value="${n.proposta}" selected>Probabile: ${esc(cliente(n.proposta).ragione)}</option>` : ""}<optgroup label="Clienti di BluCheck">${opz}</optgroup></select></td></tr>`).join("");
    box.innerHTML = `<div class="banner info" style="flex-direction:column;align-items:stretch"><span>Anni nei file: <b>${r.anni.join(", ")}</b>. Clienti da aggiornare: <b>${r.cambi.length}</b>${r.nuoviClienti ? ` (di cui ${r.nuoviClienti} ${r.nuoviClienti === 1 ? "nuovo" : "nuovi"})` : ""}; abbonamenti aggiunti <b>${r.abbonamentiNuovi}</b>, cambiati <b>${r.abbonamentiCambiati}</b>, tolti <b>${r.abbonamentiTolti}</b>. Già a posto: <b>${r.invariati}</b>.${r.ignorati.length ? ` Ignorati: ${r.ignorati.length}.` : ""}</span>
      ${nt ? `<span><b>${r.nonTrovati.length} clienti di BluGest non trovati in BluCheck:</b> scegli per ognuno il cliente giusto, «nuovo» o «ignora» («Probabile» è un suggerimento da controllare), poi premi di nuovo «Vedi riepilogo». La scelta resta ricordata per i prossimi import.</span>
        <div style="overflow:auto"><table class="t"><thead><tr><th>Nome in BluGest</th><th>Anni</th><th>Cliente in BluCheck</th></tr></thead><tbody>${nt}</tbody></table></div>` : ""}
      ${righe ? `<div style="overflow:auto;max-height:50vh"><table class="t"><thead><tr><th>Cliente</th><th>Abbonamento</th><th>Altro</th></tr></thead><tbody>${righe}</tbody></table></div>` : ""}
      ${r.cambi.length && !r.nonTrovati.length ? `<div class="row"><button class="btn primary" data-act="abb-conferma">Importa abbonamenti</button></div>` : ""}</div>`;
  } catch (err) { apiError(err); }
}
// Riattivazione di un cliente cessato. Stesso apparecchio: i suoi registratori (non dismessi) tornano nelle scadenze con le date di prima.
// Apparecchio nuovo: i registratori di prima diventano «dismessi» (restano in archivio con i loro rapporti) e si apre la scheda del nuovo.
async function riattivaCliente(id, nuovo) {
  if (!guardWrite()) return;
  const c = cliente(id); if (!c) return;
  const oggi = todayISO();
  try {
    if (nuovo) for (const a of S.apparecchi.filter((x) => x.clienteId === id && !x.dismesso))
      await put("apparecchi", a.id, { ...a, dismesso: true, note: [a.note, `DISMESSO IL ${fmtD(oggi)}: CLIENTE RIATTIVATO CON UN APPARECCHIO NUOVO.`].filter(Boolean).join("\n") });
    await put("clienti", id, { ...c, cessato: false, riattivatoIl: oggi });
    toast(nuovo ? "Cliente riattivato: inserisci il nuovo registratore" : "Cliente riattivato: i suoi registratori tornano nelle scadenze");
    render();
    if (nuovo) openSheet({ kind: "app-edit", id: null, draft: { clienteId: id, nuovoCliente: {} }, qr: null });
    else openSheet({ kind: "cli", id });
  } catch (err) { apiError(err); }
}
async function saveCli() {
  if (!guardWrite()) return;
  const s = UI.sheet, d = s.draft; if (!d.ragione?.trim()) return toast("Inserisci la ragione sociale.");
  const id = s.id || uid();
  const ver = d.verificato ? { verificatoIl: d.verificatoIl || todayISO() } : { verificatoIl: "" };
  const prima = s.id ? cliente(s.id) : null;
  if (d.cessato && !prima?.cessato) ver.cessatoIl = todayISO();
  if (!d.cessato && prima?.cessato) ver.riattivatoIl = todayISO();
  try { await put("clienti", id, { ...d, ...ver, id, ragione: d.ragione.trim() }); toast("Cliente salvato"); render(); openSheet({ kind: "cli", id }); } catch (err) { apiError(err); }
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
