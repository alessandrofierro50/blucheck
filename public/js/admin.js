"use strict";
/* BluCheck - pannello superuser */
const A = { me: null, tab: "panoramica", dash: null, aziende: [], piani: [], pagamenti: [], avvisi: [], filtro: "tutte", q: "", sheet: null, secret: null, confirm: false };
const TABS = ["panoramica", "aziende", "pagamenti", "piani", "avvisi"];

onAuthLost = () => { if (A.me) { A.me = null; showLogin("La sessione è scaduta: entra di nuovo."); } };
function showLogin(msg) {
  $("#appRoot").hidden = true; $("#sheetRoot").innerHTML = "";
  $("#authRoot").innerHTML = `<div class="auth gut"><form class="auth-card" id="loginForm" novalidate>
    <span class="logo"><img src="/img/blucheck.svg" alt="" width="28" height="28"><span>Blu<b>Check</b></span></span>
    <h1 style="font-size:24px">Pannello superuser</h1>
    <label class="field"><span>Email</span><input type="email" id="lgEmail" autocomplete="username"></label>
    <label class="field"><span>Password</span><input type="password" id="lgPwd" autocomplete="current-password"></label>
    <div class="err" id="lgErr">${esc(msg || "")}</div>
    <button class="btn primary lg" type="submit">Entra</button></form></div>`;
  $("#lgEmail").focus();
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { const r = await api("POST", "/api/login", { email: $("#lgEmail").value, password: $("#lgPwd").value }); if (r.ruolo !== "superuser") { location.href = "/app"; return; } start(); }
    catch (err) { $("#lgErr").textContent = err.message; }
  });
}
async function start() {
  try { const me = await api("GET", "/api/me"); if (me.user.ruolo !== "superuser") { location.href = "/app"; return; } A.me = me.user; }
  catch { return showLogin(); }
  $("#authRoot").innerHTML = ""; $("#appRoot").hidden = false;
  $("#brandSub").textContent = A.me.email;
  const h = location.hash.slice(1); if (TABS.includes(h)) A.tab = h;
  await loadAll(); render();
}
async function loadAll() {
  try {
    const [dash, az, piani, pag, avv] = await Promise.all([api("GET", "/api/su/dashboard"), api("GET", "/api/su/aziende"), api("GET", "/api/su/piani"), api("GET", "/api/su/pagamenti"), api("GET", "/api/su/avvisi")]);
    Object.assign(A, { dash, aziende: az, piani, pagamenti: pag, avvisi: avv });
  } catch (e) { toast(e.message); }
}
const statoAz = (a) => {
  if (a.stato === "in_attesa") return { cls: "acc", txt: "Da abilitare" };
  if (a.stato === "sospesa") return { cls: "n", txt: "Sospesa" };
  const s = a.abbonamento;
  if (!s || s.scaduto) return { cls: "bad", txt: s?.fine ? `Scaduta il ${fmtD(s.fine)}` : "Senza scadenza" };
  if (s.inScadenza) return { cls: "warn", txt: `Scade tra ${s.giorni} gg` };
  return { cls: "ok", txt: `Attiva fino al ${fmtD(s.fine)}` };
};
const pianoNome = (id) => A.piani.find((p) => p.id === id)?.nome || "—";

function render() {
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === A.tab ? "page" : "false"));
  const m = $("#main"); const active = document.activeElement?.id, pos = document.activeElement?.selectionStart;
  m.innerHTML = ({ panoramica: vPanoramica, aziende: vAziende, pagamenti: vPagamenti, piani: vPiani, avvisi: vAvvisi })[A.tab]();
  if (active) { const el = document.getElementById(active); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { } } }
  renderSheet();
}
function vPanoramica() {
  const d = A.dash; if (!d) return `<p class="faint">Caricamento…</p>`;
  const stat = (n, l, cls, f) => `<button class="stat ${cls}" data-act="go-filter" data-v="${f}"><b>${n}</b><span class="faint">${l}</span></button>`;
  const prossime = A.aziende.filter((a) => a.stato === "attiva" && a.abbonamento?.fine).sort((x, y) => x.abbonamento.fine.localeCompare(y.abbonamento.fine)).slice(0, 8);
  return `
  ${!d.stripe || !d.email ? `<div class="banner info"><span>${!d.stripe ? "Pagamenti online non configurati (STRIPE_SECRET_KEY). " : ""}${!d.email ? "Invio email non configurato (SMTP_HOST): gli avvisi compaiono solo qui." : ""}</span></div>` : ""}
  <div class="stats">${stat(d.inAttesa, "Richieste da abilitare", d.inAttesa ? "warn" : "", "in_attesa")}${stat(d.inScadenza, "In scadenza (30 gg)", d.inScadenza ? "warn" : "", "scadenza")}${stat(d.scadute, "Scadute", d.scadute ? "bad" : "", "scadute")}${stat(d.attive, "Aziende attive", "okk", "attive")}</div>
  <div class="grid3">
    <div class="panel"><span class="label">Incassato nell'anno</span><b style="font-family:var(--f-display);font-size:26px">${euro(d.incassoAnno)}</b></div>
    <div class="panel"><span class="label">Tecnici attivi</span><b style="font-family:var(--f-display);font-size:26px">${d.tecnici}</b></div>
    <div class="panel"><span class="label">Rapporti registrati</span><b style="font-family:var(--f-display);font-size:26px">${d.verifiche}</b></div>
  </div>
  <div class="panel"><h2>Prossime scadenze abbonamento</h2>${prossime.length ? `<div class="list">${prossime.map(rowAz).join("")}</div>` : `<p class="faint">Nessuna azienda attiva.</p>`}</div>
  <div class="panel"><div class="spread"><h2>Ultimi avvisi</h2><button class="btn sm" data-act="tab" data-v="avvisi">Tutti gli avvisi</button></div>
    ${d.avvisi.length ? `<div class="list">${d.avvisi.map(rowAvviso).join("")}</div>` : `<p class="faint">Nessun avviso.</p>`}</div>`;
}
const rowAz = (a) => { const s = statoAz(a); return `<button class="item" data-act="open-az" data-id="${a.id}"><span class="stripe ${s.cls === "acc" ? "acc" : s.cls}"></span>
  <span style="min-width:0"><span class="t">${esc(a.ragione)}</span><br><span class="s">P.IVA <span class="mono">${esc(a.piva || "—")}</span> · ${esc(a.admin_nome || "")} ${esc(a.admin_email || "")}</span></span>
  <span class="when"><span class="pill ${s.cls}">${esc(s.txt)}</span><span class="faint">${a.tecnici_attivi}/${a.max_tecnici} tecnici · ${a.n_verifiche} rapporti</span></span></button>`; };
const rowAvviso = (v) => `<div class="item static"><span class="stripe ${v.tipo === "scaduto" ? "bad" : v.tipo === "in_scadenza" ? "warn" : v.tipo === "pagamento" ? "ok" : "acc"}"></span>
  <span style="min-width:0"><span class="t">${esc(v.testo)}</span><br><span class="s">${fmtDT(v.creato)}${v.ragione ? " · " + esc(v.ragione) : ""}${v.tipo === "in_scadenza" || v.tipo === "scaduto" ? (v.email_inviata ? " · email inviata" : " · email non inviata") : ""}</span></span>
  <span class="when">${v.azienda_id ? `<button class="btn sm" data-act="open-az" data-id="${v.azienda_id}">Apri</button>` : ""}</span></div>`;

function vAziende() {
  const q = norm(A.q);
  let list = A.aziende.filter((a) => !q || norm([a.ragione, a.piva, a.email, a.admin_email, a.admin_nome, a.telefono].join(" ")).includes(q));
  const f = A.filtro;
  if (f === "in_attesa") list = list.filter((a) => a.stato === "in_attesa");
  if (f === "attive") list = list.filter((a) => a.stato === "attiva" && !a.abbonamento?.scaduto);
  if (f === "scadenza") list = list.filter((a) => a.stato === "attiva" && a.abbonamento?.inScadenza);
  if (f === "scadute") list = list.filter((a) => a.stato === "attiva" && a.abbonamento?.scaduto);
  if (f === "sospese") list = list.filter((a) => a.stato === "sospesa");
  return `<div class="spread"><h2>Aziende <span class="faint">(${A.aziende.length})</span></h2><button class="btn primary sm" data-act="new-az">+ Nuova azienda</button></div>
  <div class="chips">${[["tutte", "Tutte"], ["in_attesa", "Da abilitare"], ["attive", "Attive"], ["scadenza", "In scadenza"], ["scadute", "Scadute"], ["sospese", "Sospese"]].map(([k, l]) => `<button class="chip" aria-pressed="${A.filtro === k}" data-act="filtro" data-v="${k}">${l}</button>`).join("")}</div>
  <input type="search" id="qAz" placeholder="Cerca ragione sociale, P.IVA, email…" value="${esc(A.q)}" data-bind="q">
  ${list.length ? `<div class="list">${list.map(rowAz).join("")}</div>` : `<div class="list"><div class="empty">Nessuna azienda con questi filtri.</div></div>`}`;
}
function vPagamenti() {
  const tot = A.pagamenti.reduce((s, p) => s + p.importo_cent, 0);
  return `<div class="spread"><h2>Pagamenti <span class="faint">(${A.pagamenti.length} · ${euro(tot)})</span></h2><button class="btn sm" data-act="csv-pag">Esporta CSV</button></div>
  <p class="faint" style="margin:0">Per ogni pagamento ricordati di emettere la fattura elettronica: Stripe incassa ma non invia fatture allo SdI.</p>
  ${A.pagamenti.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Azienda</th><th>Descrizione</th><th>Metodo</th><th>Periodo</th><th class="num">Importo</th></tr></thead><tbody>
  ${A.pagamenti.map((p) => `<tr><td>${fmtD(p.creato)}</td><td><a href="#" data-act="open-az" data-id="${p.azienda_id}">${esc(p.ragione)}</a><br><span class="faint mono">${esc(p.piva || "")}</span></td><td>${esc(p.descrizione)}</td><td>${esc(p.metodo)}</td><td>${p.periodo_da ? `${fmtD(p.periodo_da)} – ${fmtD(p.periodo_a)}` : "—"}</td><td class="num">${euro(p.importo_cent)}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="list"><div class="empty">Nessun pagamento registrato.</div></div>`}`;
}
function vPiani() {
  return `<div class="spread"><h2>Piani in vendita</h2><button class="btn primary sm" data-act="new-piano">+ Piano</button></div>
  <p class="faint" style="margin:0">Sono i piani che le aziende vedono sul sito e possono pagare online. Il prezzo è l'importo addebitato (IVA compresa).</p>
  <div class="plans">${A.piani.map((p) => `<div class="plan ${p.attivo ? "" : ""}" style="${p.attivo ? "" : "opacity:.6"}">
    <div class="spread"><b style="font-family:var(--f-display);font-size:18px">${esc(p.nome)}</b>${p.attivo ? `<span class="pill ok">in vendita</span>` : `<span class="pill n">nascosto</span>`}</div>
    <div class="price">${euro(p.prezzo_cent)} <small>/ ${p.mesi} mesi</small></div>
    <span class="faint">${esc(p.descrizione || "")} · max ${p.max_tecnici} tecnici · codice <span class="mono">${esc(p.id)}</span></span>
    <button class="btn" data-act="edit-piano" data-id="${esc(p.id)}">Modifica</button></div>`).join("")}</div>`;
}
function vAvvisi() {
  return `<div class="spread"><h2>Avvisi</h2><button class="btn sm" data-act="controlla">Controlla scadenze ora</button></div>
  <p class="faint" style="margin:0">Il controllo gira da solo ogni 6 ore: avvisa l'azienda e te a 30, 15, 7 e 1 giorno dalla scadenza, il giorno stesso e quando l'abbonamento è scaduto.</p>
  ${A.avvisi.length ? `<div class="list">${A.avvisi.map(rowAvviso).join("")}</div>` : `<div class="list"><div class="empty">Nessun avviso.</div></div>`}`;
}

/* ---------------- pannelli ---------------- */
function openSheet(s) { A.sheet = s; A.secret = null; A.confirm = false; renderSheet(); }
function closeSheet() { A.sheet = null; renderSheet(); }
function renderSheet() {
  const root = $("#sheetRoot");
  if (!A.sheet) { root.innerHTML = ""; document.body.style.overflow = ""; return; }
  const keep = $(".sheet", root)?.scrollTop || 0;
  const body = ({ az: sAzienda, "new-az": sNuovaAz, piano: sPiano })[A.sheet.kind]();
  root.innerHTML = `<div class="sheet-wrap" data-act="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${body}</div></div>`;
  if (keep) $(".sheet", root).scrollTop = keep;
  document.body.style.overflow = "hidden";
}
const head = (t, extra = "") => `<div class="sheet-head gut"><h2>${t}</h2><div class="row">${extra}<button class="btn ghost sm" data-act="close">Chiudi</button></div></div>`;
const fld = (id, l, v, t = "text", extra = "") => `<label class="field"><span>${l}</span><input type="${t}" id="${id}" value="${esc(v ?? "")}" ${extra}></label>`;
const secretBox = () => A.secret ? `<div class="banner ok" style="flex-direction:column;align-items:stretch"><span>Credenziali per <b>${esc(A.secret.email)}</b>${A.secret.inviata ? " (inviate anche per email)" : " (email non inviata: comunicale tu)"}. La password provvisoria non verrà più mostrata.</span><span class="secret">${esc(A.secret.password)}</span><span class="faint">Accesso da ${esc(location.origin)}/app</span></div>` : "";

function sAzienda() {
  const d = A.sheet.data; if (!d) return head("Azienda") + `<div class="sheet-body gut"><p class="faint">Caricamento…</p></div>`;
  const a = d.azienda; const s = statoAz({ ...a, abbonamento: d.abbonamento });
  const pianiOpt = (sel) => `<option value="">—</option>` + A.piani.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? "selected" : ""}>${esc(p.nome)} · ${euro(p.prezzo_cent)} / ${p.mesi} mesi · ${p.max_tecnici} tecnici</option>`).join("");
  const proposta = d.abbonamento?.fine && !d.abbonamento.scaduto ? d.abbonamento.fine : (() => { const t = new Date(); t.setDate(t.getDate() + 30); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; })();
  return head(esc(a.ragione), `<span class="pill ${s.cls}">${esc(s.txt)}</span>`) + `<div class="sheet-body gut">
    ${secretBox()}
    ${a.stato === "in_attesa" ? `<div class="panel" style="border-color:var(--accent)"><h2>Abilita l'azienda</h2>
      ${a.richiesta ? `<div class="qrres"><b>Messaggio della richiesta</b>${esc(a.richiesta)}</div>` : ""}
      <p class="faint" style="margin:0">L'amministratore riceve le credenziali per email (se configurata) e le vedi anche qui.</p>
      <div class="grid2">${fld("abFine", "Abbonamento valido fino al (prova)", proposta, "date")}${fld("abMax", "Numero massimo di tecnici", a.max_tecnici || 1, "number", 'min="1"')}</div>
      <div class="row"><button class="btn primary" data-act="abilita" data-id="${a.id}">Abilita e invia credenziali</button></div></div>` : ""}
    <div class="panel"><h2>Abbonamento</h2>
      <dl class="kv"><dt>Scadenza</dt><dd>${a.abbonamento_fine ? fmtD(a.abbonamento_fine) + (d.abbonamento.giorni !== null ? ` (${d.abbonamento.giorni >= 0 ? "tra " + d.abbonamento.giorni : "da " + -d.abbonamento.giorni} giorni)` : "") : "—"}</dd>
      <dt>Piano</dt><dd>${esc(pianoNome(a.piano_id))}</dd><dt>Tecnici</dt><dd>${d.utenti.filter((u) => u.attivo && u.ruolo !== "superuser").length} attivi su ${a.max_tecnici}</dd>
      <dt>Archivio</dt><dd>${d.n_apparecchi} apparecchi · ${d.n_verifiche} rapporti</dd><dt>Creata</dt><dd>${fmtD(a.creato)}</dd></dl>
      <details><summary>Registra un pagamento (bonifico, contanti, omaggio)</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <div class="grid2"><label class="field"><span>Piano</span><select id="pgPiano">${pianiOpt(a.piano_id)}</select></label>${fld("pgMesi", "Oppure mesi da aggiungere", "", "number", 'min="1" placeholder="dal piano"')}
        ${fld("pgImporto", "Importo incassato (€)", "", "text", 'inputmode="decimal" placeholder="0,00"')}<label class="field"><span>Metodo</span><select id="pgMetodo"><option value="bonifico">Bonifico</option><option value="contanti">Contanti</option><option value="omaggio">Omaggio</option><option value="altro">Altro</option></select></label></div>
        ${fld("pgDescr", "Descrizione (facoltativa)", "")}
        <p class="faint" style="margin:0">Il periodo si aggiunge alla scadenza attuale (o parte da oggi se è già scaduta) e il numero di tecnici prende quello del piano.</p>
        <div class="row"><button class="btn primary" data-act="pagamento" data-id="${a.id}">Registra ed estendi</button></div></div></details>
    </div>
    <div class="panel"><h2>Dati e stato</h2>
      <div class="grid2">${fld("azRagione", "Ragione sociale", a.ragione)}${fld("azPiva", "Partita IVA", a.piva, "text", 'class="mono"')}${fld("azIndirizzo", "Indirizzo", a.indirizzo)}${fld("azCap", "CAP / Località / Prov.", a.cap)}${fld("azTel", "Telefono", a.telefono, "tel")}${fld("azEmail", "Email (riceve gli avvisi)", a.email, "email")}
      <label class="field"><span>Stato</span><select id="azStato">${[["attiva", "Attiva"], ["sospesa", "Sospesa (nessun accesso)"], ["in_attesa", "Da abilitare"]].map(([k, l]) => `<option value="${k}" ${a.stato === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${fld("azFine", "Abbonamento valido fino al", a.abbonamento_fine || "", "date")}${fld("azMax", "Numero massimo di tecnici", a.max_tecnici, "number", 'min="1"')}<label class="field"><span>Piano</span><select id="azPiano">${pianiOpt(a.piano_id)}</select></label></div>
      <label class="field"><span>Note interne</span><textarea id="azNote">${esc(a.note || "")}</textarea></label>
      <div class="row"><button class="btn primary" data-act="save-az" data-id="${a.id}">Salva</button></div></div>
    <div class="panel"><h2>Utenti</h2><div class="list">${d.utenti.map((u) => `<div class="item static stack"><span class="stripe ${u.attivo ? "acc" : ""}"></span>
      <span style="min-width:0"><span class="t">${esc(u.nome || u.email)}</span> <span class="pill ${u.ruolo === "admin" ? "acc" : "n"}">${u.ruolo}</span> ${u.attivo ? "" : `<span class="pill n">disattivato</span>`}<br>
      <span class="s">${esc(u.email)}${u.ultimo_accesso ? " · ultimo accesso " + fmtDT(u.ultimo_accesso) : " · mai entrato"}</span></span>
      <span class="when"><span class="row"><button class="btn sm" data-act="reset" data-id="${u.id}">Nuova password</button><button class="btn sm" data-act="ut-toggle" data-id="${u.id}" data-on="${u.attivo ? 0 : 1}">${u.attivo ? "Disattiva" : "Attiva"}</button></span></span></div>`).join("")}</div></div>
    <div class="panel"><h2>Pagamenti</h2>${d.pagamenti.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Descrizione</th><th>Periodo</th><th class="num">Importo</th><th></th></tr></thead><tbody>
      ${d.pagamenti.map((p) => `<tr><td>${fmtD(p.creato)}</td><td>${esc(p.descrizione)}<br><span class="faint">${esc(p.metodo)}</span></td><td>${p.periodo_da ? `${fmtD(p.periodo_da)} – ${fmtD(p.periodo_a)}` : "—"}</td><td class="num">${euro(p.importo_cent)}</td><td>${p.metodo !== "stripe" ? `<button class="btn sm ghost" data-act="del-pag" data-id="${p.id}" title="Rimuove la registrazione, non cambia la scadenza">Rimuovi</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="faint">Nessun pagamento.</p>`}</div>
    <div class="panel"><h2>Avvisi</h2>${d.avvisi.length ? `<div class="list">${d.avvisi.map(rowAvviso).join("")}</div>` : `<p class="faint">Nessun avviso.</p>`}</div>
    <details class="panel"><summary style="color:var(--bad)">Elimina azienda</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <p class="faint" style="margin:0">Cancella definitivamente l'azienda, i suoi utenti, clienti, apparecchi, rapporti e pagamenti. Per confermare scrivi la ragione sociale: <b>${esc(a.ragione)}</b></p>
      <input type="text" id="delConf" autocomplete="off"><div class="row"><button class="btn danger" data-act="del-az" data-id="${a.id}">Elimina definitivamente</button></div></div></details>
  </div>`;
}
function sNuovaAz() {
  const t = new Date(); t.setDate(t.getDate() + 30); const def = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  return head("Nuova azienda") + `<div class="sheet-body gut">
    <div class="panel"><h2>Laboratorio</h2><div class="grid2">${fld("naRagione", "Ragione sociale")}${fld("naPiva", "Partita IVA", "", "text", 'class="mono"')}${fld("naIndirizzo", "Indirizzo")}${fld("naCap", "CAP / Località / Prov.")}${fld("naTel", "Telefono", "", "tel")}${fld("naEmail", "Email aziendale (avvisi)", "", "email")}</div></div>
    <div class="panel"><h2>Amministratore dell'azienda</h2><p class="faint" style="margin:0">È anche il primo tecnico: gestisce gli altri tecnici e l'abbonamento.</p>
      <div class="grid2">${fld("naNome", "Cognome e nome")}${fld("naAdminEmail", "Email di accesso", "", "email")}${fld("naCf", "Codice fiscale", "", "text", 'class="mono"')}${fld("naSigillo", "Sigillo / identificativo")}</div></div>
    <div class="panel"><h2>Abbonamento</h2><div class="grid3">${fld("naFine", "Valido fino al", def, "date")}${fld("naMax", "Numero massimo di tecnici", 1, "number", 'min="1"')}<label class="field"><span>Piano</span><select id="naPiano"><option value="">—</option>${A.piani.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${p.max_tecnici} tecnici)</option>`).join("")}</select></label></div>
      <label class="field"><span>Note interne</span><textarea id="naNote"></textarea></label></div>
    <div class="row"><button class="btn primary" data-act="crea-az">Crea azienda e genera credenziali</button><button class="btn" data-act="close">Annulla</button></div></div>`;
}
function sPiano() {
  const p = A.sheet.piano || { nome: "", descrizione: "", max_tecnici: 1, mesi: 12, prezzo_cent: 0, attivo: 1, ordine: A.piani.length + 1 };
  const nuovo = !A.sheet.piano;
  return head(nuovo ? "Nuovo piano" : "Modifica piano") + `<div class="sheet-body gut"><div class="panel">
    <div class="grid2">${nuovo ? fld("plId", "Codice (lettere minuscole, es. team)", "") : ""}${fld("plNome", "Nome", p.nome)}${fld("plDescr", "Descrizione breve", p.descrizione)}${fld("plMax", "Numero massimo di tecnici", p.max_tecnici, "number", 'min="1"')}${fld("plMesi", "Durata (mesi)", p.mesi, "number", 'min="1"')}${fld("plPrezzo", "Prezzo (€, IVA compresa)", (p.prezzo_cent / 100).toFixed(2).replace(".", ","), "text", 'inputmode="decimal"')}${fld("plOrdine", "Ordine di visualizzazione", p.ordine, "number")}</div>
    <label class="check"><input type="checkbox" id="plAttivo" ${p.attivo ? "checked" : ""}> In vendita (visibile sul sito e nell'app)</label>
    <div class="row"><button class="btn primary" data-act="save-piano" data-id="${esc(p.id || "")}">Salva piano</button><button class="btn" data-act="close">Annulla</button></div></div></div>`;
}
async function openAz(id) {
  A.sheet = { kind: "az", id, data: null }; A.secret = null; renderSheet();
  try { A.sheet.data = await api("GET", "/api/su/aziende/" + id); renderSheet(); } catch (e) { toast(e.message); }
}
async function refreshAz() { const id = A.sheet?.id; await loadAll(); if (id && A.sheet?.kind === "az") { A.sheet.data = await api("GET", "/api/su/aziende/" + id); } render(); }

/* ---------------- eventi ---------------- */
document.addEventListener("click", async (e) => {
  const tb = e.target.closest("[data-tab]");
  if (tb) { A.tab = tb.dataset.tab; history.replaceState(null, "", "#" + A.tab); A.sheet = null; render(); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "sheet-bg") { if (e.target === el) closeSheet(); return; }
  if (el.tagName === "A") e.preventDefault();
  const v = (s) => $(s)?.value ?? "";
  try {
    switch (act) {
      case "close": closeSheet(); break;
      case "logout": await api("POST", "/api/logout").catch(() => { }); A.me = null; showLogin(); break;
      case "tab": A.tab = el.dataset.v; history.replaceState(null, "", "#" + A.tab); render(); break;
      case "go-filter": A.tab = "aziende"; A.filtro = el.dataset.v; history.replaceState(null, "", "#aziende"); render(); break;
      case "filtro": A.filtro = el.dataset.v; render(); break;
      case "open-az": openAz(id); break;
      case "new-az": openSheet({ kind: "new-az" }); break;
      case "crea-az": {
        const r = await api("POST", "/api/su/aziende", { ragione: v("#naRagione"), piva: v("#naPiva"), indirizzo: v("#naIndirizzo"), cap: v("#naCap"), telefono: v("#naTel"), email: v("#naEmail"), admin_nome: v("#naNome"), admin_email: v("#naAdminEmail"), admin_cf: v("#naCf"), admin_sigillo: v("#naSigillo"), abbonamento_fine: v("#naFine"), max_tecnici: v("#naMax"), piano_id: v("#naPiano"), note: v("#naNote") });
        await loadAll(); await openAz(r.id); A.secret = { email: r.email, password: r.password, inviata: r.email_inviata }; render(); toast("Azienda creata"); break;
      }
      case "abilita": {
        const r = await api("POST", `/api/su/aziende/${id}/abilita`, { abbonamento_fine: v("#abFine"), max_tecnici: v("#abMax") });
        await refreshAz(); if (r.password) A.secret = { email: r.email, password: r.password, inviata: r.email_inviata }; renderSheet(); toast("Azienda abilitata"); break;
      }
      case "save-az":
        await api("PUT", `/api/su/aziende/${id}`, { ragione: v("#azRagione"), piva: v("#azPiva"), indirizzo: v("#azIndirizzo"), cap: v("#azCap"), telefono: v("#azTel"), email: v("#azEmail"), stato: v("#azStato"), abbonamento_fine: v("#azFine"), max_tecnici: v("#azMax"), piano_id: v("#azPiano"), note: v("#azNote") });
        await refreshAz(); toast("Salvato"); break;
      case "pagamento": {
        const r = await api("POST", `/api/su/aziende/${id}/pagamento`, { piano_id: v("#pgPiano"), mesi: v("#pgMesi"), importo: v("#pgImporto"), metodo: v("#pgMetodo"), descrizione: v("#pgDescr") });
        await refreshAz(); toast(r.periodo_a ? `Abbonamento esteso fino al ${fmtD(r.periodo_a)}` : "Pagamento registrato"); break;
      }
      case "del-pag": await api("DELETE", `/api/su/pagamenti/${id}`); await refreshAz(); toast("Registrazione rimossa"); break;
      case "reset": { const u = A.sheet.data.utenti.find((x) => x.id === id); const r = await api("POST", `/api/su/utenti/${id}/reset`); A.secret = { email: u.email, password: r.password, inviata: r.email_inviata }; await refreshAz(); break; }
      case "ut-toggle": await api("PUT", `/api/su/utenti/${id}`, { attivo: el.dataset.on === "1" }); await refreshAz(); break;
      case "del-az": await api("DELETE", `/api/su/aziende/${id}`, { conferma: v("#delConf") }); closeSheet(); await loadAll(); render(); toast("Azienda eliminata"); break;
      case "new-piano": openSheet({ kind: "piano", piano: null }); break;
      case "edit-piano": openSheet({ kind: "piano", piano: A.piani.find((p) => p.id === id) }); break;
      case "save-piano": {
        const body = { id: v("#plId"), nome: v("#plNome"), descrizione: v("#plDescr"), max_tecnici: v("#plMax"), mesi: v("#plMesi"), prezzo: v("#plPrezzo"), ordine: v("#plOrdine"), attivo: $("#plAttivo").checked };
        if (id) await api("PUT", `/api/su/piani/${id}`, body); else await api("POST", "/api/su/piani", body);
        closeSheet(); await loadAll(); render(); toast("Piano salvato"); break;
      }
      case "controlla": { const r = await api("POST", "/api/su/avvisi/controlla"); await loadAll(); render(); toast(r.creati ? `${r.creati} nuovi avvisi` : "Nessuna nuova scadenza da segnalare"); break; }
      case "csv-pag": {
        const rows = [["Data", "Azienda", "P.IVA", "Descrizione", "Metodo", "Dal", "Al", "Importo"], ...A.pagamenti.map((p) => [fmtD(p.creato), p.ragione, p.piva, p.descrizione, p.metodo, fmtD(p.periodo_da), fmtD(p.periodo_a), (p.importo_cent / 100).toFixed(2).replace(".", ",")])];
        scaricaFile(`BluCheck_pagamenti_${todayISO()}.csv`, new Blob(["﻿" + rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
        break;
      }
    }
  } catch (err) { toast(err.message); }
});
document.addEventListener("input", (e) => { if (e.target.dataset.bind) { A[e.target.dataset.bind] = e.target.value; render(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && A.sheet) closeSheet(); });
setInterval(async () => { if (A.me && document.visibilityState === "visible" && !A.sheet) { await loadAll(); render(); } }, 120000);

start();
