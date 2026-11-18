"use strict";
/* BluCheck - Planning: il lavoro da fare in un giorno, in un mese o da data a data.
   Mette insieme, per cliente e per giorno, le scadenze delle verificazioni periodiche (biennali), dei DGFE (annuali)
   e gli aggiornamenti software ancora da fare. I clienti cessati e gli apparecchi dismessi restano fuori (come in Scadenze).
   Gli aggiornamenti non hanno una data: si agganciano alla visita del cliente nel periodo; quelli dei clienti senza
   visite nel periodo sono in fondo, «da fissare». Usa gli stessi dati e funzioni di app.js (caricato dopo). */

const PL = { modo: "giorno", giorno: "", mese: "", da: "", a: "", arretrati: true, agg: true, tipo: "tutti" };
const PL_TIPI = { VP: "Verificazione periodica", DGFE: "DGFE annuale", SW: "Aggiornamento software" };
const PL_GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const PL_MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const plIso = (t) => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
const plDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const plGiorno = (iso) => { const t = plDate(iso); return `${PL_GIORNI[t.getDay()]} ${fmtD(iso)}`; };
const plMeseNome = (ym) => { const [y, m] = ym.split("-").map(Number); return `${PL_MESI[m - 1]} ${y}`; };
function plInit() {
  const oggi = todayISO();
  if (!PL.giorno) PL.giorno = oggi;
  if (!PL.mese) PL.mese = oggi.slice(0, 7);
  if (!PL.da) PL.da = oggi;
  if (!PL.a) { const t = plDate(oggi); t.setDate(t.getDate() + 6); PL.a = plIso(t); }
}
/** Il periodo scelto: { da, a, titolo } con date ISO comprese. */
function plPeriodo() {
  plInit();
  if (PL.modo === "giorno") return { da: PL.giorno, a: PL.giorno, titolo: `Planning di ${plGiorno(PL.giorno)}` };
  if (PL.modo === "mese") {
    const [y, m] = PL.mese.split("-").map(Number);
    return { da: `${PL.mese}-01`, a: plIso(new Date(y, m, 0)), titolo: `Planning di ${plMeseNome(PL.mese)}` };
  }
  const da = PL.da <= PL.a ? PL.da : PL.a, a = PL.da <= PL.a ? PL.a : PL.da;
  return { da, a, titolo: da === a ? `Planning di ${plGiorno(da)}` : `Planning dal ${fmtD(da)} al ${fmtD(a)}` };
}
function plSposta(n) {
  plInit();
  if (PL.modo === "giorno") { const t = plDate(PL.giorno); t.setDate(t.getDate() + n); PL.giorno = plIso(t); }
  else if (PL.modo === "mese") { const [y, m] = PL.mese.split("-").map(Number); const t = new Date(y, m - 1 + n, 1); PL.mese = plIso(t).slice(0, 7); }
  else {
    const p = plPeriodo(), giorni = Math.round((plDate(p.a) - plDate(p.da)) / 86400000) + 1;
    const s = (iso) => { const t = plDate(iso); t.setDate(t.getDate() + n * giorni); return plIso(t); };
    PL.da = s(p.da); PL.a = s(p.a);
  }
}

/** Le righe del planning: una per cliente e giorno, con i lavori da fare. */
function righePlanning(tipo = PL.tipo) {
  const p = plPeriodo();
  const swDaFare = (c) => (PL.agg || tipo === "SW") && c && usaGestionale(c) && statoAgg(c).k === "da_fare";
  const gruppi = new Map();
  let senzaData = 0;
  for (const r of allScadenze()) {
    if (!r.data) { senzaData++; continue; }
    if (r.data > p.a) continue;
    const arretrato = r.data < p.da;
    if (arretrato && !PL.arretrati) continue;
    const key = `${arretrato ? "0" : r.data}|${r.c?.id || "a:" + r.a.id}`;
    if (!gruppi.has(key)) gruppi.set(key, { data: r.data, arretrato, c: r.c, lavori: [] });
    const g = gruppi.get(key);
    if (r.data < g.data) g.data = r.data;
    g.lavori.push({ tipo: r.tipo, a: r.a, data: r.data, st: r.st });
  }
  const visitati = new Set();
  let righe = [...gruppi.values()];
  righe.sort((x, y) => (x.arretrato !== y.arretrato ? (x.arretrato ? -1 : 1) : x.data !== y.data ? (x.data < y.data ? -1 : 1) : norm(x.c?.ragione).localeCompare(norm(y.c?.ragione))));
  // l'aggiornamento software si fa alla prima visita del cliente nel periodo
  for (const g of righe) if (g.c && swDaFare(g.c) && !visitati.has(g.c.id)) { g.lavori.push({ tipo: "SW" }); visitati.add(g.c.id); }
  if (tipo !== "tutti") righe = righe.map((g) => ({ ...g, lavori: g.lavori.filter((l) => l.tipo === tipo) })).filter((g) => g.lavori.length);
  // aggiornamenti da fare dei clienti senza visite nel periodo: senza data, da fissare
  const daFissare = tipo === "tutti" || tipo === "SW"
    ? S.clienti.filter((c) => swDaFare(c) && !visitati.has(c.id)).sort((x, y) => norm(x.ragione).localeCompare(norm(y.ragione))) : [];
  return { p, righe, daFissare, senzaData };
}
const plConta = (righe, tipo) => righe.reduce((n, g) => n + g.lavori.filter((l) => l.tipo === tipo).length, 0);
const plApp = (a) => (a.modello || a.matricola ? `${a.modello || ""}${a.matricola ? " " + a.matricola : ""}`.trim() : "registratore da completare");
const plLavoroTesto = (l) => (l.tipo === "SW" ? "Aggiornamento software" : `${l.tipo === "VP" ? "Verificazione periodica" : "DGFE"} - ${plApp(l.a)}`);

function viewPlanning() {
  const { p, righe, daFissare, senzaData } = righePlanning();
  const seg = (v, l) => `<button data-pl-act="modo" data-v="${v}" aria-pressed="${PL.modo === v}">${l}</button>`;
  const chip = (k, l) => `<button class="chip" aria-pressed="${PL.tipo === k}" data-pl-act="tipo" data-v="${k}">${l}</button>`;
  const scelta = PL.modo === "giorno" ? `<input type="date" id="plGiorno" data-pl="giorno" value="${esc(PL.giorno)}" aria-label="Giorno">`
    : PL.modo === "mese" ? `<input type="month" id="plMese" data-pl="mese" value="${esc(PL.mese)}" aria-label="Mese">`
    : `<span class="pl-range"><label>Da <input type="date" id="plDa" data-pl="da" value="${esc(PL.da)}"></label><label>a <input type="date" id="plA" data-pl="a" value="${esc(PL.a)}"></label></span>`;
  const arr = righe.filter((g) => g.arretrato), nel = righe.filter((g) => !g.arretrato);
  const tot = PL.tipo === "tutti" ? { righe, daFissare } : righePlanning("tutti"), totNel = tot.righe.filter((g) => !g.arretrato);
  const st = (k, cls, n, l) => `<button class="stat ${cls} ${PL.tipo === k ? "sel" : ""}" data-pl-act="tipo" data-v="${PL.tipo === k ? "tutti" : k}"><b>${n}</b><span class="faint">${l}</span></button>`;
  const item = (g) => {
    const tel = g.c?.telefono ? ` · ${esc(g.c.telefono)}` : "";
    const dove = [...new Set(g.lavori.filter((l) => l.a).map((l) => [l.a.indirizzo, l.a.localita].filter(Boolean).join(", ")).filter(Boolean))].join(" · ") || g.c?.domicilio || "";
    const lavori = g.lavori.map((l) => `<span style="display:block"><span class="tag">${l.tipo}</span>${l.tipo === "SW" ? `Aggiornamento software${g.c?.software ? " " + esc(g.c.software) : ""}` : `${esc(l.a.modello || "Registratore da completare")}${l.a.matricola ? ` · <span class="mono">${esc(l.a.matricola)}</span>` : ""}${g.arretrato ? ` · scaduta il ${fmtD(l.data)}` : ""}`}</span>`).join("");
    const cls = g.arretrato || g.lavori.some((l) => l.st?.cls === "bad") ? "bad" : g.lavori.some((l) => l.st?.cls === "warn" || l.tipo === "SW") ? "warn" : "ok";
    return `<button class="item" ${g.c ? `data-act="open-cli" data-id="${g.c.id}"` : `data-act="open-app" data-id="${g.lavori[0].a.id}"`}><span class="stripe ${cls}"></span>
      <span style="min-width:0"><span class="t">${esc(g.c?.ragione || "Cliente non indicato")}</span>${tel ? `<span class="faint">${tel}</span>` : ""}<br>
      <span class="s">${lavori}${dove ? `<span class="faint">${esc(dove)}</span>` : ""}</span></span>
      <span class="when">${g.arretrato ? `<span class="pill bad">Arretrato</span>` : PL.modo === "giorno" ? "" : `<span class="d">${fmtD(g.data)}</span>`}<span class="pill n">${g.lavori.length} ${g.lavori.length === 1 ? "lavoro" : "lavori"}</span></span></button>`;
  };
  let corpo = "";
  if (arr.length) corpo += `<h3 class="pl-day bad">Arretrati: scaduti prima del ${fmtD(p.da)} <span class="faint">(${arr.length})</span></h3><div class="list">${arr.map(item).join("")}</div>`;
  if (nel.length) {
    const perGiorno = new Map(); for (const g of nel) { if (!perGiorno.has(g.data)) perGiorno.set(g.data, []); perGiorno.get(g.data).push(g); }
    for (const [d, gs] of perGiorno) corpo += `<h3 class="pl-day giorno${d === todayISO() ? " oggi" : ""}">${plGiorno(d)}${d === todayISO() ? " · oggi" : ""} <span class="faint">(${gs.length})</span></h3><div class="list">${gs.map(item).join("")}</div>`;
  } else corpo += `<div class="list"><div class="empty">Nessuna scadenza ${PL.modo === "giorno" ? "in questo giorno" : PL.modo === "mese" ? "in questo mese" : "in questo periodo"}${PL.tipo !== "tutti" ? " per questo tipo di lavoro" : ""}.</div></div>`;
  if (daFissare.length) corpo += `<h3 class="pl-day">Aggiornamenti software da fissare <span class="faint">(${daFissare.length}, clienti senza scadenze nel periodo)</span></h3>
    <div class="list">${daFissare.map((c) => `<button class="item" data-act="open-agg" data-id="${c.id}"><span class="stripe warn"></span><span style="min-width:0"><span class="t">${esc(c.ragione)}</span><br>
    <span class="s"><span class="tag">SW</span>${esc(c.software || "Software non indicato")}${c.telefono ? " · " + esc(c.telefono) : ""}</span></span><span class="when"><span class="pill warn">Da fare</span></span></button>`).join("")}</div>`;
  return `<div class="spread"><h2>${esc(p.titolo)}</h2>
    <div class="row"><button class="btn sm" data-pl-act="txt">Esporta TXT</button><button class="btn sm" data-pl-act="pdf">Esporta PDF</button></div></div>
  <div class="spread">
    <div class="seg choose" role="group" aria-label="Periodo">${seg("giorno", "Giorno")}${seg("mese", "Mese")}${seg("periodo", "Da data a data")}</div>
    <div class="pl-nav"><button class="btn sm" data-pl-act="prec" aria-label="Periodo precedente">‹</button>${scelta}<button class="btn sm" data-pl-act="succ" aria-label="Periodo successivo">›</button><button class="btn sm ghost" data-pl-act="oggi">Oggi</button></div>
  </div>
  <div class="stats">
    ${st("VP", "", plConta(totNel, "VP"), "Verifiche")}${st("DGFE", "", plConta(totNel, "DGFE"), "DGFE")}${st("SW", "warn", plConta(totNel, "SW") + tot.daFissare.length, "Aggiornamenti software")}
    <div class="stat pl-stat bad"><b>${tot.righe.filter((g) => g.arretrato).reduce((n, g) => n + g.lavori.length, 0)}</b><span class="faint">Arretrati</span></div>
  </div>
  <div class="spread">
    <div class="chips" role="group" aria-label="Tipo di lavoro">${chip("tutti", "Visualizza tutti")}${chip("VP", "Verifiche")}${chip("DGFE", "DGFE")}${chip("SW", "Aggiornamento software")}</div>
    <div class="row"><label class="check"><input type="checkbox" data-pl="arretrati" ${PL.arretrati ? "checked" : ""}> Arretrati</label>${PL.tipo === "tutti" ? `<label class="check"><input type="checkbox" data-pl="agg" ${PL.agg ? "checked" : ""}> Con gli aggiornamenti software</label>` : ""}</div>
  </div>
  ${senzaData ? `<p class="faint" style="margin:0">${senzaData} ${senzaData === 1 ? "scadenza non ha" : "scadenze non hanno"} la data dell'ultima verifica e ${senzaData === 1 ? "resta" : "restano"} fuori: si vedono in Scadenze, «Senza data».</p>` : ""}
  ${corpo}`;
}

function plTitoloExport(p) {
  const t = PL.tipo === "tutti" ? "" : ` - solo ${PL_TIPI[PL.tipo].toLowerCase()}`;
  return `${p.titolo}${t}`;
}
function exportPlanningTxt() {
  const { p, righe, daFissare } = righePlanning(), L = lab();
  const out = [L.ragione || "", plTitoloExport(p).toUpperCase(), `Stampato il ${fmtD(todayISO())}`, ""];
  const cli = (g) => {
    out.push(`  ${g.c?.ragione || "Cliente non indicato"}${g.c?.telefono ? " - tel. " + g.c.telefono : ""}`);
    const dove = [...new Set(g.lavori.filter((l) => l.a).map((l) => [l.a.indirizzo, l.a.localita].filter(Boolean).join(", ")).filter(Boolean))].join(" / ") || g.c?.domicilio;
    if (dove) out.push(`    Dove: ${dove}`);
    for (const l of g.lavori) out.push(`    [ ] ${plLavoroTesto(l)}${l.tipo === "SW" && g.c?.software ? " (" + g.c.software + ")" : ""}${g.arretrato && l.data ? " - scaduta il " + fmtD(l.data) : ""}`);
  };
  const arr = righe.filter((g) => g.arretrato), nel = righe.filter((g) => !g.arretrato);
  if (arr.length) { out.push("=".repeat(60), `ARRETRATI (scaduti prima del ${fmtD(p.da)})`, "=".repeat(60)); arr.forEach(cli); out.push(""); }
  let giorno = "";
  for (const g of nel) { if (g.data !== giorno) { giorno = g.data; out.push("=".repeat(60), plGiorno(giorno).toUpperCase(), "=".repeat(60)); } cli(g); }
  if (!nel.length) out.push("Nessuna scadenza nel periodo.");
  if (daFissare.length) {
    out.push("", "=".repeat(60), "AGGIORNAMENTI SOFTWARE DA FISSARE (clienti senza scadenze nel periodo)", "=".repeat(60));
    for (const c of daFissare) out.push(`  [ ] ${c.ragione}${c.software ? " - " + c.software : ""}${c.telefono ? " - tel. " + c.telefono : ""}`);
  }
  scaricaFile(`Planning_${p.da}${p.a !== p.da ? "_" + p.a : ""}.txt`, new Blob(["﻿" + out.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" }));
}
function exportPlanningPdf() {
  if (!window.jspdf) return toast("Modulo PDF non caricato: ricarica la pagina.");
  const dati = righePlanning();
  const doc = pdfPlanning(dati, lab(), plTitoloExport(dati.p));
  scaricaFile(`Planning_${dati.p.da}${dati.p.a !== dati.p.da ? "_" + dati.p.a : ""}.pdf`, doc.output("blob"));
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-pl-act]"); if (!el) return;
  const act = el.dataset.plAct;
  if (act === "modo") PL.modo = el.dataset.v;
  else if (act === "tipo") PL.tipo = el.dataset.v;
  else if (act === "prec") plSposta(-1);
  else if (act === "succ") plSposta(1);
  else if (act === "oggi") { const o = todayISO(); PL.giorno = o; PL.mese = o.slice(0, 7); const t = plDate(o); t.setDate(t.getDate() + 6); PL.da = o; PL.a = plIso(t); }
  else if (act === "txt") return exportPlanningTxt();
  else if (act === "pdf") return exportPlanningPdf();
  render();
});
document.addEventListener("change", (e) => {
  const t = e.target, k = t.dataset?.pl; if (!k) return;
  if (t.type === "checkbox") PL[k] = t.checked;
  else if (t.value) PL[k] = t.value;
  else return;
  render();
});
