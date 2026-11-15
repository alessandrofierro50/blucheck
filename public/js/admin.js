"use strict";
/* BluCheck - pannello superuser */
const A = { me: null, tab: "panoramica", dash: null, aziende: [], piani: [], pagamenti: [], avvisi: [], filtro: "tutte", q: "", sheet: null, secret: null, confirm: false };
const TABS = ["panoramica", "aziende", "pagamenti", "piani", "avvisi"];
A.filtroPag = "tutti"; A.imp = null;

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
    const [dash, az, piani, pag, avv, imp] = await Promise.all([api("GET", "/api/su/dashboard"), api("GET", "/api/su/aziende"), api("GET", "/api/su/piani"), api("GET", "/api/su/pagamenti"), api("GET", "/api/su/avvisi"), api("GET", "/api/su/impostazioni")]);
    Object.assign(A, { dash, aziende: az, piani, pagamenti: pag, avvisi: avv, imp });
  } catch (e) { toast(e.message); }
}
const CLS_STATO = { prova: "acc", attivo: "ok", in_scadenza: "warn", tolleranza: "bad", sola_lettura: "bad", sospeso: "n", prova_scaduta: "bad", in_attesa: "acc" };
const statoAz = (a) => {
  if (a.stato === "in_attesa") return { cls: "acc", txt: "Da abilitare" };
  const s = a.abbonamento; if (!s) return { cls: "n", txt: "" };
  const txt = { prova: `In prova fino al ${fmtD(s.fine)}`, attivo: `Attiva fino al ${fmtD(s.fine)}`, in_scadenza: `Scade tra ${s.giorni} gg`, tolleranza: `Scaduta il ${fmtD(s.fine)} (tolleranza)`,
    sola_lettura: `Sola lettura (scaduta il ${fmtD(s.fine)})`, sospeso: s.manuale ? "Sospesa a mano" : `Sospesa (scaduta il ${fmtD(s.fine)})`, prova_scaduta: `Prova finita il ${fmtD(s.fine)}` }[s.stato] || s.etichetta;
  return { cls: CLS_STATO[s.stato] || "n", txt };
};
const fase = (a) => a.abbonamento?.stato || "";
const METODI = { carta: "Carta", paypal: "PayPal", bonifico: "Bonifico", manuale: "Manuale", omaggio: "Omaggio", contanti: "Contanti", bonifico_esterno: "Bonifico (fuori dall'app)", altro: "Altro", stripe: "Carta" };
const STATO_PAG = { in_attesa: ["warn", "in attesa"], pagato: ["ok", "pagato"], annullato: ["n", "annullato"], fallito: ["bad", "non riuscito"] };
function righePagamenti(list, conAzienda) {
  if (!list.length) return `<div class="list"><div class="empty">Nessun pagamento.</div></div>`;
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th>${conAzienda ? "<th>Azienda</th>" : ""}<th>Descrizione</th><th>Stato</th><th>Periodo</th><th class="num">Totale</th><th></th></tr></thead><tbody>
  ${list.map((p) => { const [c, l] = STATO_PAG[p.stato] || ["n", p.stato]; return `<tr><td>${fmtD(p.pagato_il || p.creato)}</td>${conAzienda ? `<td><a href="#" data-act="open-az" data-id="${p.azienda_id}">${esc(p.ragione)}</a><br><span class="faint mono">${esc(p.piva || "")}</span></td>` : ""}
    <td>${esc(p.descrizione)}<br><span class="faint">${esc(METODI[p.metodo] || p.metodo)}${p.causale ? ` · <span class="mono">${esc(p.causale)}</span>` : ""}${p.fattura ? ` · fattura <b>${esc(p.fattura)}</b>` : ""}</span>
      ${p.fattura_errori ? `<br><span class="pill bad" style="white-space:normal">XML non generato: ${esc(p.fattura_errori)}</span>` : ""}${p.fattura && !p.email_blucode ? `<br><span class="faint">email a BluCode non inviata</span>` : ""}</td>
    <td><span class="pill ${c}">${l}</span></td><td>${p.periodo_da ? `${fmtD(p.periodo_da)} – ${fmtD(p.periodo_a)}` : "—"}</td><td class="num">${euro(p.totale_cent)}</td>
    <td><span class="row" style="flex-wrap:nowrap">${p.stato === "in_attesa" && p.metodo === "bonifico" ? `<button class="btn sm primary" data-act="conf-bon" data-id="${p.id}">Conferma accredito</button>` : ""}
      ${p.stato === "in_attesa" ? `<button class="btn sm ghost" data-act="ann-pag" data-id="${p.id}">Annulla</button>` : ""}
      ${p.fattura ? `<a class="btn sm ghost" href="/api/su/pagamenti/${encodeURIComponent(p.id)}/xml">XML</a><a class="btn sm ghost" href="/api/su/pagamenti/${encodeURIComponent(p.id)}/proforma.pdf">PDF</a><button class="btn sm ghost" data-act="reinvia" data-id="${p.id}">Reinvia</button>` : ""}
      ${!p.fattura && p.stato === "pagato" ? `<button class="btn sm ghost" data-act="del-pag" data-id="${p.id}" title="Rimuove la registrazione, non cambia la scadenza">Rimuovi</button>` : ""}</span></td></tr>`; }).join("")}
  </tbody></table></div>`;
}
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
  const prossime = A.aziende.filter((a) => ["prova", "attivo", "in_scadenza"].includes(fase(a))).sort((x, y) => x.abbonamento.fine.localeCompare(y.abbonamento.fine)).slice(0, 8);
  return `
  ${!d.metodi.length || !d.email || d.cedente.length || !d.console ? `<div class="banner info" style="flex-direction:column;align-items:flex-start;gap:4px">
    ${!d.metodi.length ? "<span>Nessun metodo di pagamento attivo: servono le chiavi Stripe o PayPal oppure BONIFICO_IBAN nel .env.</span>" : `<span>Metodi di pagamento attivi: ${d.metodi.join(", ")}.</span>`}
    ${d.cedente.length ? `<span>Fatture: dati del cedente incompleti (${esc(d.cedente.join("; "))}).</span>` : ""}
    ${!d.email ? "<span>Invio email non configurato (SMTP_HOST): gli avvisi compaiono solo qui.</span>" : ""}${!d.console ? "<span>Console non collegata (CONSOLE_API_KEY).</span>" : ""}</div>` : ""}
  ${d.bonificiInAttesa ? `<div class="banner"><span><b>${d.bonificiInAttesa} ${d.bonificiInAttesa === 1 ? "bonifico" : "bonifici"} in attesa di conferma.</b> Controlla l'accredito in banca e conferma.</span><button class="btn sm primary" data-act="go-pag" data-v="in_attesa">Vedi</button></div>` : ""}
  <div class="stats">${stat(d.inAttesa, "Richieste da abilitare", d.inAttesa ? "warn" : "", "in_attesa")}${stat(d.prova, "In prova", "", "prova")}${stat(d.inScadenza, "In scadenza (30 gg)", d.inScadenza ? "warn" : "", "scadenza")}${stat(d.scadute + d.proveScadute + d.sospese, "Scadute o sospese", d.scadute + d.proveScadute ? "bad" : "", "scadute")}</div>
  <div class="grid3">
    <div class="panel"><span class="label">Incassato nell'anno</span><b style="font-family:var(--f-display);font-size:26px">${euro(d.incassoAnno)}</b></div>
    <div class="panel"><span class="label">Aziende attive · tecnici</span><b style="font-family:var(--f-display);font-size:26px">${d.attive} · ${d.tecnici}</b></div>
    <div class="panel"><span class="label">Rapporti registrati</span><b style="font-family:var(--f-display);font-size:26px">${d.verifiche}</b></div>
  </div>
  <div class="panel"><h2>Prossime scadenze abbonamento</h2>${prossime.length ? `<div class="list">${prossime.map(rowAz).join("")}</div>` : `<p class="faint">Nessuna azienda attiva.</p>`}</div>
  <div class="panel"><div class="spread"><h2>Ultimi avvisi</h2><button class="btn sm" data-act="tab" data-v="avvisi">Tutti gli avvisi</button></div>
    ${d.avvisi.length ? `<div class="list">${d.avvisi.map(rowAvviso).join("")}</div>` : `<p class="faint">Nessun avviso.</p>`}</div>`;
}
const rowAz = (a) => { const s = statoAz(a); return `<button class="item" data-act="open-az" data-id="${a.id}"><span class="stripe ${s.cls === "acc" ? "acc" : s.cls}"></span>
  <span style="min-width:0"><span class="t">${esc(a.ragione)}</span><br><span class="s">P.IVA <span class="mono">${esc(a.piva || "—")}</span> · ${esc(a.admin_nome || "")} ${esc(a.admin_email || "")}</span></span>
  <span class="when"><span class="pill ${s.cls}">${esc(s.txt)}</span><span class="faint">${a.tecnici_attivi}/${a.max_tecnici} tecnici · ${a.n_verifiche} rapporti</span></span></button>`; };
const rowAvviso = (v) => `<div class="item static"><span class="stripe ${["sospensione", "prova_scaduta", "fine_tolleranza"].includes(v.tipo) ? "bad" : ["in_scadenza", "prova_in_scadenza"].includes(v.tipo) ? "warn" : v.tipo === "pagamento" ? "ok" : "acc"}"></span>
  <span style="min-width:0"><span class="t">${esc(v.testo)}</span><br><span class="s">${fmtDT(v.creato)}${v.ragione ? " · " + esc(v.ragione) : ""}${v.chiave && v.tipo !== "pagamento" ? (v.email_inviata ? " · email inviata" : " · email non inviata") : ""}</span></span>
  <span class="when">${v.azienda_id ? `<button class="btn sm" data-act="open-az" data-id="${v.azienda_id}">Apri</button>` : ""}</span></div>`;

function vAziende() {
  const q = norm(A.q);
  let list = A.aziende.filter((a) => !q || norm([a.ragione, a.piva, a.email, a.admin_email, a.admin_nome, a.telefono].join(" ")).includes(q));
  const f = A.filtro;
  if (f === "in_attesa") list = list.filter((a) => a.stato === "in_attesa");
  if (f === "prova") list = list.filter((a) => fase(a) === "prova");
  if (f === "attive") list = list.filter((a) => ["attivo", "in_scadenza", "tolleranza"].includes(fase(a)));
  if (f === "scadenza") list = list.filter((a) => ["in_scadenza"].includes(fase(a)) || (fase(a) === "prova" && a.abbonamento.giorni <= 3));
  if (f === "scadute") list = list.filter((a) => ["tolleranza", "sola_lettura", "prova_scaduta", "sospeso"].includes(fase(a)));
  if (f === "sospese") list = list.filter((a) => ["sospeso", "prova_scaduta"].includes(fase(a)));
  return `<div class="spread"><h2>Aziende <span class="faint">(${A.aziende.length})</span></h2><button class="btn primary sm" data-act="new-az">+ Nuova azienda</button></div>
  <div class="chips">${[["tutte", "Tutte"], ["in_attesa", "Da abilitare"], ["prova", "In prova"], ["attive", "Attive"], ["scadenza", "In scadenza"], ["scadute", "Scadute"], ["sospese", "Sospese"]].map(([k, l]) => `<button class="chip" aria-pressed="${A.filtro === k}" data-act="filtro" data-v="${k}">${l}</button>`).join("")}</div>
  <input type="search" id="qAz" placeholder="Cerca ragione sociale, P.IVA, email…" value="${esc(A.q)}" data-bind="q">
  ${list.length ? `<div class="list">${list.map(rowAz).join("")}</div>` : `<div class="list"><div class="empty">Nessuna azienda con questi filtri.</div></div>`}`;
}
function vPagamenti() {
  const list = A.pagamenti.filter((p) => A.filtroPag === "tutti" || p.stato === A.filtroPag);
  const tot = A.pagamenti.filter((p) => p.stato === "pagato").reduce((s, p) => s + (p.totale_cent || 0), 0);
  return `<div class="spread"><h2>Pagamenti <span class="faint">(${euro(tot)} incassati)</span></h2><button class="btn sm" data-act="csv-pag">Esporta CSV</button></div>
  <div class="chips">${[["tutti", "Tutti"], ["in_attesa", "In attesa"], ["pagato", "Pagati"], ["annullato", "Annullati"], ["fallito", "Non riusciti"]].map(([k, l]) => `<button class="chip" aria-pressed="${A.filtroPag === k}" data-act="filtro-pag" data-v="${k}">${l}</button>`).join("")}</div>
  <p class="faint" style="margin:0">A pagamento confermato parte la ricevuta (proforma PDF) al cliente e l'XML FatturaPA arriva a te per email: va caricato sul portale Fatture e Corrispettivi. Bonifici: conferma solo dopo aver visto l'accredito; prima non parte nessun documento.</p>
  ${righePagamenti(list, true)}`;
}
function vPiani() {
  return `<div class="spread"><h2>Piani in vendita</h2><button class="btn primary sm" data-act="new-piano">+ Piano</button></div>
  <p class="faint" style="margin:0">Sono i piani che le aziende vedono sul sito e possono pagare online. Regime forfettario: niente IVA; sopra 77,47 € si aggiunge il rimborso del bollo (2 €).</p>
  <div class="plans">${A.piani.map((p) => `<div class="plan ${p.attivo ? "" : ""}" style="${p.attivo ? "" : "opacity:.6"}">
    <div class="spread"><b style="font-family:var(--f-display);font-size:18px">${esc(p.nome)}</b>${p.attivo ? `<span class="pill ok">in vendita</span>` : `<span class="pill n">nascosto</span>`}</div>
    <div class="price">${euro(p.prezzo_cent)} <small>/ ${p.mesi} mesi</small></div>${p.prezzo_mese_cent ? `<span class="faint">oppure ${euro(p.prezzo_mese_cent)} al mese</span>` : ""}
    <span class="faint">${esc(p.descrizione || "")} · max ${p.max_tecnici} tecnici · codice <span class="mono">${esc(p.id)}</span></span>
    <button class="btn" data-act="edit-piano" data-id="${esc(p.id)}">Modifica</button></div>`).join("")}</div>`;
}
function vAvvisi() {
  const im = A.imp;
  return `<div class="spread"><h2>Avvisi</h2><div class="row"><button class="btn sm" data-act="controlla">Controlla scadenze ora</button><button class="btn sm" data-act="riepilogo">Invia il riepilogo settimanale</button></div></div>
  <p class="faint" style="margin:0">Ogni giorno alle 8:07 l'azienda riceve gli avvisi e tu una copia; il lunedì ti arriva il riepilogo settimanale. Ogni avviso parte una volta sola per scadenza.</p>
  ${im ? `<details class="panel"><summary>Regole e testi degli avvisi</summary><div style="display:flex;flex-direction:column;gap:12px;margin-top:10px">
    <div class="grid2">${fld("imTol", "Giorni di tolleranza dopo la scadenza", im.giorni_tolleranza, "number", 'min="0"')}${fld("imSl", "Giorni di sola lettura, poi sospensione", im.giorni_sola_lettura, "number", 'min="0"')}
      ${fld("imAvv", "Avvisi prima della scadenza (giorni)", im.giorni_avviso.join(", "))}${fld("imAvvP", "Avvisi della prova (giorni)", im.giorni_avviso_prova.join(", "))}</div>
    <div class="row"><button class="btn primary" data-act="save-imp">Salva regole</button></div>
    <p class="faint" style="margin:0">Segnaposto: ${im.segnaposto.map((x) => `<span class="mono">{${x}}</span>`).join(" ")}</p>
    ${im.modelli.map((m) => `<details><summary>${esc(m.descrizione)}</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      ${fld("mo_" + m.codice, "Oggetto", m.oggetto)}<label class="field"><span>Testo (HTML)</span><textarea id="mc_${m.codice}" style="min-height:160px;font-family:var(--f-mono);font-size:12px">${esc(m.corpo)}</textarea></label>
      <div class="row"><button class="btn sm primary" data-act="save-modello" data-id="${m.codice}">Salva testo</button><button class="btn sm ghost" data-act="reset-modello" data-id="${m.codice}">Ripristina il testo predefinito</button></div></div></details>`).join("")}
    <p class="faint" style="margin:0">Fatture: sezionale <b>${esc(im.sezionale)}</b> · cedente ${im.cedente_problemi.length ? `<span class="pill bad">${esc(im.cedente_problemi.join("; "))}</span>` : `${esc(im.cedente.denominazione)} P.IVA ${esc(im.cedente.piva)} (${esc(im.cedente.regime)})`}</p>
  </div></details>` : ""}
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
  const proposta = d.abbonamento?.fine && !d.abbonamento.scaduto ? d.abbonamento.fine : (() => { const t = new Date(); t.setDate(t.getDate() + 6); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; })();
  return head(esc(a.ragione), `<span class="pill ${s.cls}">${esc(s.txt)}</span>`) + `<div class="sheet-body gut">
    ${secretBox()}
    ${a.stato === "in_attesa" ? `<div class="panel" style="border-color:var(--accent)"><h2>Abilita l'azienda</h2>
      ${a.richiesta ? `<div class="qrres"><b>Messaggio della richiesta</b>${esc(a.richiesta)}</div>` : ""}
      <p class="faint" style="margin:0">L'amministratore riceve le credenziali per email (se configurata) e le vedi anche qui.</p>
      <div class="grid2">${fld("abFine", "Prova gratuita fino al", proposta, "date")}${fld("abMax", "Numero massimo di tecnici", a.max_tecnici || 1, "number", 'min="1"')}</div>
      <div class="row"><button class="btn primary" data-act="abilita" data-id="${a.id}">Abilita e invia credenziali</button></div></div>` : ""}
    <div class="panel"><h2>Abbonamento</h2>
      <dl class="kv"><dt>Scadenza</dt><dd>${a.abbonamento_fine ? fmtD(a.abbonamento_fine) + (d.abbonamento.giorni !== null ? ` (${d.abbonamento.giorni >= 0 ? "tra " + d.abbonamento.giorni : "da " + -d.abbonamento.giorni} giorni)` : "") : "—"}</dd>
      <dt>Piano</dt><dd>${esc(pianoNome(a.piano_id))}</dd><dt>Tecnici</dt><dd>${d.utenti.filter((u) => u.attivo && u.ruolo !== "superuser").length} attivi su ${a.max_tecnici}</dd>
      <dt>Archivio</dt><dd>${d.n_apparecchi} apparecchi · ${d.n_verifiche} rapporti</dd><dt>Creata</dt><dd>${fmtD(a.creato)}</dd></dl>
      ${a.prova ? `<div class="row"><button class="btn" data-act="converti" data-id="${a.id}">Converti la prova in abbonamento</button><span class="faint">Di solito non serve: il primo pagamento converte la prova da solo.</span></div>` : ""}
      ${d.dati_fatturazione ? `<p class="faint" style="margin:0">Dati di fatturazione: ${esc(d.dati_fatturazione.denominazione || `${d.dati_fatturazione.nome || ""} ${d.dati_fatturazione.cognome || ""}`)} · ${esc(d.dati_fatturazione.partita_iva || d.dati_fatturazione.codice_fiscale || "")} · ${esc(d.dati_fatturazione.codice_destinatario || d.dati_fatturazione.pec || "")}</p>` : ""}
      <details><summary>Nuovo periodo a mano (proroga, omaggio, accordo) — senza fattura</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <div class="grid2"><div class="field"><span><label for="pgPiano">Piano</label></span>${lookupRow(`<select id="pgPiano">${pianiOpt(a.piano_id)}</select>`, "piani", "piani")}</div>${fld("pgMesi", "Mesi da aggiungere", "", "number", 'min="1" placeholder="dal piano"')}
        ${fld("pgFine", "Oppure fino al", "", "date")}${fld("pgImporto", "Importo (€)", "", "text", 'inputmode="decimal" placeholder="0,00"')}
        <label class="field"><span>Tipo</span><select id="pgMetodo"><option value="manuale">Accordo o proroga</option><option value="omaggio">Omaggio</option><option value="contanti">Contanti</option><option value="bonifico_esterno">Bonifico già incassato fuori dall'app</option><option value="altro">Altro</option></select></label>${fld("pgDescr", "Descrizione (facoltativa)", "")}</div>
        ${a.prova ? `<label class="check"><input type="checkbox" id="pgRestaProva"> È una proroga della prova (resta in prova)</label>` : ""}
        <p class="faint" style="margin:0">Il periodo parte dalla fine di quello in corso (da oggi se è già scaduto). Per i pagamenti che vanno fatturati usa il pagamento dall'app: il bonifico si conferma da «Pagamenti».</p>
        <div class="row"><button class="btn primary" data-act="pagamento" data-id="${a.id}">Registra ed estendi</button></div></div></details>
    </div>
    <div class="panel"><h2>Dati e stato</h2>
      <div class="grid2">${fld("azRagione", "Ragione sociale", a.ragione)}${fld("azPiva", "Partita IVA", a.piva, "text", 'class="mono"')}${fld("azIndirizzo", "Indirizzo", a.indirizzo)}${fld("azCap", "CAP / Località / Prov.", a.cap)}${fld("azTel", "Telefono", a.telefono, "tel")}${fld("azEmail", "Email (riceve gli avvisi)", a.email, "email")}
      <label class="field"><span>Stato</span><select id="azStato">${[["attiva", "Attiva"], ["sospesa", "Sospesa (vede solo la pagina Abbonamento)"], ["in_attesa", "Da abilitare"]].map(([k, l]) => `<option value="${k}" ${a.stato === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${fld("azFine", "Abbonamento valido fino al", a.abbonamento_fine || "", "date")}${fld("azMax", "Numero massimo di tecnici", a.max_tecnici, "number", 'min="1"')}<div class="field"><span><label for="azPiano">Piano</label></span>${lookupRow(`<select id="azPiano">${pianiOpt(a.piano_id)}</select>`, "piani", "piani")}</div></div>
      <label class="field"><span>Note interne</span><textarea id="azNote">${esc(a.note || "")}</textarea></label>
      <div class="row"><button class="btn primary" data-act="save-az" data-id="${a.id}">Salva</button></div></div>
    <div class="panel"><h2>Utenti</h2><div class="list">${d.utenti.map((u) => `<div class="item static stack"><span class="stripe ${u.attivo ? "acc" : ""}"></span>
      <span style="min-width:0"><span class="t">${esc(u.nome || u.email)}</span> <span class="pill ${u.ruolo === "admin" ? "acc" : "n"}">${u.ruolo}</span> ${u.attivo ? "" : `<span class="pill n">disattivato</span>`}<br>
      <span class="s">${esc(u.email)}${u.ultimo_accesso ? " · ultimo accesso " + fmtDT(u.ultimo_accesso) : " · mai entrato"}</span></span>
      <span class="when"><span class="row"><button class="btn sm" data-act="reset" data-id="${u.id}">Nuova password</button><button class="btn sm" data-act="ut-toggle" data-id="${u.id}" data-on="${u.attivo ? 0 : 1}">${u.attivo ? "Disattiva" : "Attiva"}</button></span></span></div>`).join("")}</div></div>
    <div class="panel"><h2>Pagamenti</h2>${righePagamenti(d.pagamenti, false)}</div>
    <div class="panel"><h2>Avvisi</h2>${d.avvisi.length ? `<div class="list">${d.avvisi.map(rowAvviso).join("")}</div>` : `<p class="faint">Nessun avviso.</p>`}</div>
    <details class="panel"><summary style="color:var(--bad)">Elimina azienda</summary><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      <p class="faint" style="margin:0">Cancella definitivamente l'azienda, i suoi utenti, clienti, apparecchi, rapporti e pagamenti. Per confermare scrivi la ragione sociale: <b>${esc(a.ragione)}</b></p>
      <input type="text" id="delConf" autocomplete="off"><div class="row"><button class="btn danger" data-act="del-az" data-id="${a.id}">Elimina definitivamente</button></div></div></details>
  </div>`;
}
function sNuovaAz() {
  const t = new Date(); t.setDate(t.getDate() + 6); const def = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  return head("Nuova azienda") + `<div class="sheet-body gut">
    <div class="panel"><h2>Laboratorio</h2><div class="grid2">${fld("naRagione", "Ragione sociale")}${fld("naPiva", "Partita IVA", "", "text", 'class="mono"')}${fld("naIndirizzo", "Indirizzo")}${fld("naCap", "CAP / Località / Prov.")}${fld("naTel", "Telefono", "", "tel")}${fld("naEmail", "Email aziendale (avvisi)", "", "email")}</div></div>
    <div class="panel"><h2>Amministratore dell'azienda</h2><p class="faint" style="margin:0">È anche il primo tecnico: gestisce gli altri tecnici e l'abbonamento.</p>
      <div class="grid2">${fld("naNome", "Cognome e nome")}${fld("naAdminEmail", "Email di accesso", "", "email")}${fld("naCf", "Codice fiscale", "", "text", 'class="mono"')}${fld("naSigillo", "Sigillo / identificativo")}</div></div>
    <div class="panel"><h2>Abbonamento</h2><label class="check"><input type="checkbox" id="naProva" checked> Parte come prova gratuita (diventa abbonamento con il primo pagamento)</label><div class="grid3">${fld("naFine", "Valido fino al", def, "date")}${fld("naMax", "Numero massimo di tecnici", 1, "number", 'min="1"')}<div class="field"><span><label for="naPiano">Piano</label></span>${lookupRow(`<select id="naPiano"><option value="">—</option>${A.piani.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${p.max_tecnici} tecnici)</option>`).join("")}</select>`, "piani", "piani")}</div></div>
      <label class="field"><span>Note interne</span><textarea id="naNote"></textarea></label></div>
    <div class="row"><button class="btn primary" data-act="crea-az">Crea azienda e genera credenziali</button><button class="btn" data-act="close">Annulla</button></div></div>`;
}
function sPiano() {
  const p = A.sheet.piano || { nome: "", descrizione: "", max_tecnici: 1, mesi: 12, prezzo_cent: 0, attivo: 1, ordine: A.piani.length + 1 };
  const nuovo = !A.sheet.piano;
  return head(nuovo ? "Nuovo piano" : "Modifica piano") + `<div class="sheet-body gut"><div class="panel">
    <div class="grid2">${nuovo ? fld("plId", "Codice (lettere minuscole, es. team)", "") : ""}${fld("plNome", "Nome", p.nome)}${fld("plDescr", "Descrizione breve", p.descrizione)}${fld("plMax", "Numero massimo di tecnici", p.max_tecnici, "number", 'min="1"')}${fld("plMesi", "Durata (mesi)", p.mesi, "number", 'min="1"')}${fld("plPrezzo", "Prezzo del periodo (€)", (p.prezzo_cent / 100).toFixed(2).replace(".", ","), "text", 'inputmode="decimal"')}${fld("plPrezzoMese", "Prezzo mensile (€, vuoto = solo periodo intero)", p.prezzo_mese_cent ? (p.prezzo_mese_cent / 100).toFixed(2).replace(".", ",") : "", "text", 'inputmode="decimal"')}${fld("plOrdine", "Ordine di visualizzazione", p.ordine, "number")}</div>
    <label class="check"><input type="checkbox" id="plAttivo" ${p.attivo ? "checked" : ""}> In vendita (visibile sul sito e nell'app)</label>
    <div class="row"><button class="btn primary" data-act="save-piano" data-id="${esc(p.id || "")}">Salva piano</button><button class="btn" data-act="close">Annulla</button></div></div></div>`;
}
async function openAz(id) {
  A.sheet = { kind: "az", id, data: null }; A.secret = null; renderSheet();
  try { A.sheet.data = await api("GET", "/api/su/aziende/" + id); renderSheet(); } catch (e) { toast(e.message); }
}
async function refreshAz() { const id = A.sheet?.id; await loadAll(); if (id && A.sheet?.kind === "az") { A.sheet.data = await api("GET", "/api/su/aziende/" + id); } render(); }

/* ---------------- tasto «Elenco» dei piani ---------------- */
const pianoLabel = (p) => `${p.nome} · ${euro(p.prezzo_cent)} / ${p.mesi} mesi · ${p.max_tecnici} tecnici`;
Lookups.piani = (btn) => {
  const sel = btn.closest(".lk-row").querySelector("select");
  openLookup({
    title: "Piani", rows: A.piani, current: sel.value, opener: btn,
    onPick: (p) => pickIntoSelect(sel, p.id, pianoLabel(p)),
    sortKey: (p) => p.nome || p.id,
    hay: (p) => [p.nome, p.descrizione, p.id].join(" "),
    view: (p) => ({ t: esc(p.nome), s: `${euro(p.prezzo_cent)} / ${p.mesi} mesi${p.prezzo_mese_cent ? ` (o ${euro(p.prezzo_mese_cent)} al mese)` : ""} · max ${p.max_tecnici} tecnici · codice <span class="mono">${esc(p.id)}</span>${p.descrizione ? " · " + esc(p.descrizione) : ""}`,
      r: p.attivo ? `<span class="pill ok">in vendita</span>` : `<span class="pill n">nascosto</span>` }),
    placeholder: "Cerca per nome, descrizione o codice",
    create: {
      label: "Nuovo piano",
      fields: [
        { k: "nome", l: "Nome" }, { k: "id", l: "Codice (lettere minuscole, es. team)", cls: "mono" },
        { k: "descrizione", l: "Descrizione breve", wide: true },
        { k: "max_tecnici", l: "Numero massimo di tecnici", type: "number", attrs: 'min="1"' }, { k: "mesi", l: "Durata (mesi)", type: "number", attrs: 'min="1"' },
        { k: "prezzo", l: "Prezzo del periodo (€)", attrs: 'inputmode="decimal"' }, { k: "prezzo_mese", l: "Prezzo mensile (€, facoltativo)", attrs: 'inputmode="decimal"' },
      ],
      initial: (q) => ({ nome: q, max_tecnici: 1, mesi: 12, prezzo: "" }),
      note: "Il piano nasce in vendita: si nasconde o si modifica dopo da «Piani».",
      save: async (v) => {
        if (!(v.nome || "").trim()) throw new Error("Il piano deve avere un nome.");
        const r = await api("POST", "/api/su/piani", { ...v, attivo: true, ordine: A.piani.length + 1 });
        A.piani = await api("GET", "/api/su/piani"); toast("Piano salvato");
        return A.piani.find((p) => p.id === r.id);
      },
    },
  });
};

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
        const r = await api("POST", "/api/su/aziende", { ragione: v("#naRagione"), piva: v("#naPiva"), indirizzo: v("#naIndirizzo"), cap: v("#naCap"), telefono: v("#naTel"), email: v("#naEmail"), admin_nome: v("#naNome"), admin_email: v("#naAdminEmail"), admin_cf: v("#naCf"), admin_sigillo: v("#naSigillo"), abbonamento_fine: v("#naFine"), max_tecnici: v("#naMax"), piano_id: v("#naPiano"), note: v("#naNote"), prova: $("#naProva").checked });
        await loadAll(); await openAz(r.id); A.secret = { email: r.email, password: r.password, inviata: r.email_inviata }; render(); toast("Azienda creata"); break;
      }
      case "abilita": {
        const r = await api("POST", `/api/su/aziende/${id}/abilita`, { abbonamento_fine: v("#abFine"), max_tecnici: v("#abMax") });
        await refreshAz(); if (r.password) A.secret = { email: r.email, password: r.password, inviata: r.email_inviata }; renderSheet(); toast("Azienda abilitata"); break;
      }
      case "save-az":
        await api("PUT", `/api/su/aziende/${id}`, { ragione: v("#azRagione"), piva: v("#azPiva"), indirizzo: v("#azIndirizzo"), cap: v("#azCap"), telefono: v("#azTel"), email: v("#azEmail"), stato: v("#azStato"), abbonamento_fine: v("#azFine"), max_tecnici: v("#azMax"), piano_id: v("#azPiano"), note: v("#azNote") });
        await refreshAz(); toast("Salvato"); break;
      case "filtro-pag": A.filtroPag = el.dataset.v; render(); break;
      case "go-pag": A.tab = "pagamenti"; A.filtroPag = el.dataset.v || "tutti"; history.replaceState(null, "", "#pagamenti"); render(); break;
      case "conf-bon": { if (el.dataset.ok !== "1") { el.dataset.ok = "1"; el.textContent = "Accredito visto: conferma"; el.classList.add("danger"); break; } const r = await api("POST", `/api/su/pagamenti/${id}/conferma`); A.sheet?.kind === "az" ? await refreshAz() : (await loadAll(), render()); toast(`Bonifico confermato: fattura ${r.pagamento.fattura}, ricevuta inviata`); break; }
      case "ann-pag": { if (el.dataset.ok !== "1") { el.dataset.ok = "1"; el.textContent = "Sicuro? Annulla"; break; } await api("POST", `/api/su/pagamenti/${id}/annulla`); A.sheet?.kind === "az" ? await refreshAz() : (await loadAll(), render()); toast("Pagamento annullato"); break; }
      case "reinvia": { const r = await api("POST", `/api/su/pagamenti/${id}/reinvia`, {}); A.sheet?.kind === "az" ? await refreshAz() : (await loadAll(), render()); toast(r.pagamento.fattura_errori ? "XML non generato: completa i dati del cedente" : "Ricevuta e XML reinviati"); break; }
      case "converti": await api("POST", `/api/su/aziende/${id}/converti`); await refreshAz(); toast("Prova convertita in abbonamento"); break;
      case "riepilogo": { const r = await api("POST", "/api/su/avvisi/riepilogo"); toast(r.inviato ? "Riepilogo inviato" : "Riepilogo non inviato: controlla l'email (SMTP) e ADMIN_NOTIFY_EMAIL"); break; }
      case "save-imp": await api("PUT", "/api/su/impostazioni", { giorni_tolleranza: v("#imTol"), giorni_sola_lettura: v("#imSl"), giorni_avviso: v("#imAvv"), giorni_avviso_prova: v("#imAvvP") }); A.imp = await api("GET", "/api/su/impostazioni"); render(); toast("Regole salvate"); break;
      case "save-modello": await api("PUT", `/api/su/modelli/${id}`, { oggetto: v("#mo_" + id), corpo: v("#mc_" + id) }); A.imp = await api("GET", "/api/su/impostazioni"); toast("Testo salvato"); break;
      case "reset-modello": await api("POST", `/api/su/modelli/${id}/predefinito`); A.imp = await api("GET", "/api/su/impostazioni"); render(); toast("Testo predefinito ripristinato"); break;
      case "pagamento": {
        const r = await api("POST", `/api/su/aziende/${id}/pagamento`, { piano_id: v("#pgPiano"), mesi: v("#pgMesi"), fine: v("#pgFine"), importo: v("#pgImporto"), metodo: v("#pgMetodo"), descrizione: v("#pgDescr"), resta_prova: !!$("#pgRestaProva")?.checked });
        await refreshAz(); toast(r.periodo_a ? `Abbonamento esteso fino al ${fmtD(r.periodo_a)}` : "Pagamento registrato"); break;
      }
      case "del-pag": await api("DELETE", `/api/su/pagamenti/${id}`); await refreshAz(); toast("Registrazione rimossa"); break;
      case "reset": { const u = A.sheet.data.utenti.find((x) => x.id === id); const r = await api("POST", `/api/su/utenti/${id}/reset`); A.secret = { email: u.email, password: r.password, inviata: r.email_inviata }; await refreshAz(); break; }
      case "ut-toggle": await api("PUT", `/api/su/utenti/${id}`, { attivo: el.dataset.on === "1" }); await refreshAz(); break;
      case "del-az": await api("DELETE", `/api/su/aziende/${id}`, { conferma: v("#delConf") }); closeSheet(); await loadAll(); render(); toast("Azienda eliminata"); break;
      case "new-piano": openSheet({ kind: "piano", piano: null }); break;
      case "edit-piano": openSheet({ kind: "piano", piano: A.piani.find((p) => p.id === id) }); break;
      case "save-piano": {
        const body = { id: v("#plId"), nome: v("#plNome"), descrizione: v("#plDescr"), max_tecnici: v("#plMax"), mesi: v("#plMesi"), prezzo: v("#plPrezzo"), prezzo_mese: v("#plPrezzoMese"), ordine: v("#plOrdine"), attivo: $("#plAttivo").checked };
        if (id) await api("PUT", `/api/su/piani/${id}`, body); else await api("POST", "/api/su/piani", body);
        closeSheet(); await loadAll(); render(); toast("Piano salvato"); break;
      }
      case "controlla": { const r = await api("POST", "/api/su/avvisi/controlla"); await loadAll(); render(); toast(r.creati ? `${r.creati} avvisi inviati` : "Nessun avviso da inviare oggi"); break; }
      case "csv-pag": {
        const rows = [["Data", "Azienda", "P.IVA", "Descrizione", "Metodo", "Stato", "Fattura", "Causale", "Dal", "Al", "Canone", "Bollo", "Totale"], ...A.pagamenti.map((p) => [fmtD(p.pagato_il || p.creato), p.ragione, p.piva, p.descrizione, METODI[p.metodo] || p.metodo, p.stato, p.fattura || "", p.causale || "", fmtD(p.periodo_da), fmtD(p.periodo_a), (p.importo_cent / 100).toFixed(2).replace(".", ","), ((p.rimborso_bollo_cent || 0) / 100).toFixed(2).replace(".", ","), ((p.totale_cent || 0) / 100).toFixed(2).replace(".", ",")])];
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
