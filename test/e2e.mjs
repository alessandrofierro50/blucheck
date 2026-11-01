// Prova end-to-end delle API: avviare prima il server con i gestori simulati (vedi test/LEGGIMI.md), poi: node test/e2e.mjs
import crypto from "node:crypto";
import fs from "node:fs";
const B = process.env.BASE || "http://localhost:3999";
function client() {
  let cookie = "";
  return async (m, u, b, h = {}) => {
    const r = await fetch(B + u, { method: m, redirect: "manual", headers: { "content-type": "application/json", "x-blucheck": "1", cookie, ...h }, body: b === undefined ? undefined : (typeof b === "string" ? b : JSON.stringify(b)) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") || ""; let j = null;
    if (ct.includes("json")) j = await r.json(); else j = await r.arrayBuffer();
    return { s: r.status, j, h: r.headers };
  };
}
let fallite = 0;
const ok = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) fallite++; };
const iso = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const su = client(), az = client(), pub = client();

let r = await su("POST", "/api/login", { email: "su@test.it", password: "supersegreta123" }); ok(r.s === 200, "login superuser");
// prova dal sito
r = await pub("POST", "/api/public/prova", { company_name: "Lab Prova Srl", vat_number: "05357210755", name: "Mario Prova", email: "prova@lab.it", privacy: true, terms: true, terms_version: "1.0", elapsed_ms: 5000 }); ok(r.s === 201, "prova dal sito creata");
r = await su("GET", "/api/su/aziende"); const A = r.j.find((x) => x.ragione === "Lab Prova Srl"); ok(A.abbonamento.stato === "prova", "stato prova: " + A.abbonamento.etichetta);
r = await su("POST", `/api/su/utenti/${(await su("GET", `/api/su/aziende/${A.id}`)).j.utenti[0].id}/reset`); const pwd = r.j.password;
r = await az("POST", "/api/login", { email: "prova@lab.it", password: pwd }); ok(r.s === 200, "login azienda in prova");
r = await az("POST", "/api/me/password", { attuale: pwd, nuova: "Nuovapass2026" }); ok(r.s === 200, "cambio password");
r = await az("GET", "/api/bootstrap"); ok(r.s === 200 && r.j.abbonamento.stato === "prova", "bootstrap in prova");

// avvisi della prova: 3 giorni prima
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(3) });
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("prova_3")), "avviso prova a 3 giorni: " + r.j.inviati.join(","));
r = await su("POST", "/api/su/avvisi/controlla"); ok(!r.j.inviati.some((x) => x.includes("Lab Prova")), "nessun doppione");
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(0) });
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("prova_0")), "avviso ultimo giorno di prova");
// prova finita = subito sospesa
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(-1) });
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("prova_scaduta")), "avviso prova scaduta");
r = await az("GET", "/api/bootstrap"); ok(r.s === 402 && r.j.code === "prova_scaduta", "prova scaduta: bootstrap 402 prova_scaduta");
r = await az("PUT", "/api/dati/clienti/c1", { data: { ragione: "X" } }); ok(r.s === 402 && r.j.code === "prova_scaduta", "prova scaduta: scrittura 402");
r = await az("GET", "/api/me"); ok(r.s === 200, "prova scaduta: /api/me consentito");
r = await az("GET", "/api/abbonamento"); ok(r.s === 200 && r.j.stato.stato === "prova_scaduta", "prova scaduta: pagina Abbonamento consentita");
ok(r.j.metodi.map((m) => m.id).join(",") === "carta,paypal,bonifico", "metodi attivi: carta, PayPal, bonifico");

// pagamento: servono i dati di fatturazione
const piano = r.j.piani.find((p) => p.id === "team");
r = await az("POST", "/api/app/pagamenti/checkout", { piano: "team", periodicita: "annuale", metodo: "bonifico" }); ok(r.s === 422 && r.j.code === "dati_fatturazione", "checkout senza dati di fatturazione: 422");
r = await az("PUT", "/api/app/pagamenti/dati-fatturazione", { tipo: "azienda", denominazione: "Lab Prova Srl", partita_iva: "12345678901", indirizzo: "Via Roma 1", cap: "73100", comune: "Lecce", provincia: "LE", codice_destinatario: "M5UXCR1" }); ok(r.s === 422, "P.IVA sbagliata rifiutata: " + r.j.error);
r = await az("PUT", "/api/app/pagamenti/dati-fatturazione", { tipo: "azienda", denominazione: "Lab Prova Srl", partita_iva: "IT05357210755", indirizzo: "Via Roma 1", cap: "73100", comune: "Lecce", provincia: "le", codice_destinatario: "m5uxcr1", email: "fatture@lab.it" }); ok(r.s === 200 && r.j.dati_fatturazione.partita_iva === "05357210755", "dati di fatturazione salvati");

// bonifico: in attesa, nessun documento
r = await az("POST", "/api/app/pagamenti/checkout", { piano: "team", periodicita: "annuale", metodo: "bonifico", importo: 1 }); ok(r.s === 200 && r.j.bonifico?.causale?.startsWith("BLUCODE BC "), "bonifico: istruzioni " + JSON.stringify(r.j.bonifico));
ok(r.j.bonifico.importo_cent === piano.annuale.totale && piano.annuale.totale === 19900 + 200, "importo dal listino con rimborso bollo (199 + 2)");
const bonId = r.j.bonifico.id;
r = await az("POST", "/api/app/pagamenti/checkout", { piano: "team", periodicita: "annuale", metodo: "bonifico" }); ok(r.j.gia_in_attesa && r.j.bonifico.id === bonId, "secondo bonifico: restituisce quello in attesa");
r = await az("GET", "/api/bootstrap"); ok(r.s === 402, "bonifico non confermato: ancora sospesa");
r = await su("GET", "/api/su/pagamenti?stato=in_attesa"); ok(r.j.length === 1 && !r.j[0].fattura, "pannello: bonifico in attesa senza numero di fattura");
r = await su("POST", `/api/su/pagamenti/${bonId}/conferma`); ok(r.s === 200 && r.j.pagamento.fattura === "1/BC", "conferma bonifico: fattura 1/BC");
r = await su("POST", `/api/su/pagamenti/${bonId}/conferma`); ok(r.s === 400, "doppia conferma rifiutata");
r = await az("GET", "/api/bootstrap"); ok(r.s === 200 && r.j.abbonamento.stato === "attivo" && !r.j.abbonamento.prova, "dopo il pagamento: attivo, prova convertita");
ok(r.j.abbonamento.fine === iso(0).slice(0, 4) - 0 + 1 + iso(0).slice(4) || r.j.abbonamento.giorni >= 364, "periodo di un anno da oggi: fino al " + r.j.abbonamento.fine);
const fine1 = r.j.abbonamento.fine;
r = await su("GET", `/api/su/pagamenti/${bonId}/xml`); const xml = Buffer.from(r.j).toString("utf8"); ok(r.s === 200 && xml.includes("<Numero>1/BC</Numero>") && xml.includes("<ModalitaPagamento>MP05</ModalitaPagamento>"), "XML FatturaPA scaricabile (MP05)");
fs.writeFileSync(process.env.XML_OUT || "/tmp/blucheck-fattura.xml", xml);
r = await az("GET", `/api/app/pagamenti/${bonId}/proforma.pdf`); ok(r.s === 200 && Buffer.from(r.j).slice(0, 4).toString() === "%PDF", "proforma PDF per il cliente");

// carta (Stripe simulato): ritorno + webhook firmato, idempotente
r = await az("POST", "/api/app/pagamenti/checkout", { piano: "team", periodicita: "annuale", metodo: "carta" }); ok(r.s === 200 && r.j.redirect_url.includes("checkout.stripe.com"), "carta: pagina di Stripe");
const pidCarta = r.j.redirect_url.split("cs_test_")[1];
r = await az("GET", `/api/app/pagamenti/${pidCarta}/esito`); ok(r.j.pagamento.stato === "in_attesa", "carta non ancora pagata: in attesa");
const ev = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_" + pidCarta, payment_status: "paid", metadata: { payment_id: pidCarta }, payment_intent: "pi_1" } } });
const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac("sha256", "whsec_test").update(`${t}.${ev}`).digest("hex");
r = await pub("POST", "/api/pagamenti/webhook/stripe", ev, { "stripe-signature": `t=${t},v1=deadbeef` }); ok(r.s === 400, "webhook con firma sbagliata rifiutato");
r = await pub("POST", "/api/pagamenti/webhook/stripe", ev, { "stripe-signature": `t=${t},v1=${sig}` }); ok(r.s === 200, "webhook Stripe firmato accettato");
r = await pub("POST", "/api/pagamenti/webhook/stripe", ev, { "stripe-signature": `t=${t},v1=${sig}` }); ok(r.j.doppione, "stesso evento: doppione ignorato");
r = await az("GET", `/api/app/pagamenti/${pidCarta}/esito`); ok(r.j.pagamento.stato === "pagato" && r.j.pagamento.fattura === "2/BC", "carta pagata: fattura 2/BC");
ok(r.j.stato.fine > fine1, "rinnovo dalla fine del periodo precedente: " + fine1 + " → " + r.j.stato.fine);
// PayPal simulato: ritorno con cattura
r = await az("POST", "/api/app/pagamenti/checkout", { piano: "lab", periodicita: "annuale", metodo: "paypal" }); ok(r.s === 200 && r.j.redirect_url.includes("paypal.com"), "PayPal: pagina di PayPal");
r = await su("GET", "/api/su/pagamenti?stato=in_attesa"); const pp = r.j.find((x) => x.metodo === "paypal");
r = await az("GET", `/api/app/pagamenti/paypal/ritorno?pid=${pp.id}&token=PPORD${pp.id}`); ok(r.s === 302 && r.h.get("location").includes("esito=ok"), "ritorno da PayPal: cattura e conferma");
r = await az("GET", "/api/abbonamento"); ok(r.j.pagamenti.filter((p) => p.stato === "pagato").length === 3 && r.j.piano === "Laboratorio", "3 pagamenti, piano Laboratorio");
const evp = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1", custom_id: pp.id } };
r = await pub("POST", "/api/pagamenti/webhook/paypal", JSON.stringify(evp), { "paypal-auth-algo": "a", "paypal-cert-url": "b", "paypal-transmission-id": "c", "paypal-transmission-sig": "d", "paypal-transmission-time": "e" });
ok(r.s === 200, "webhook PayPal dopo il ritorno: nessun doppio periodo");
r = await az("GET", "/api/abbonamento"); ok(r.j.pagamenti.filter((p) => p.stato === "pagato").length === 3, "ancora 3 pagamenti");

// ciclo dopo la scadenza (abbonamento pagato)
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(-10) });
r = await az("PUT", "/api/dati/clienti/c1", { data: { ragione: "Cliente" } }); ok(r.s === 200, "tolleranza (10 gg dopo): si scrive ancora");
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(-15) });
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("fine_tolleranza")), "avviso fine tolleranza (da domani sola lettura)");
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(-20) });
r = await az("GET", "/api/bootstrap"); ok(r.s === 200 && r.j.abbonamento.stato === "sola_lettura", "sola lettura: si legge");
r = await az("PUT", "/api/dati/clienti/c2", { data: { ragione: "X" } }); ok(r.s === 402 && r.j.code === "sola_lettura", "sola lettura: 402 sola_lettura");
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(-46) });
r = await az("GET", "/api/bootstrap"); ok(r.s === 402 && r.j.code === "abbonamento_sospeso", "dopo 15+30 giorni: 402 abbonamento_sospeso");
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("sospensione")), "avviso sospensione");
await su("PUT", `/api/su/aziende/${A.id}`, { abbonamento_fine: iso(7) });
r = await su("POST", "/api/su/avvisi/controlla"); ok(r.j.inviati.some((x) => x.includes("giorni_7")), "avviso a 7 giorni");

// periodo manuale e protezione delle fatture
r = await su("POST", `/api/su/aziende/${A.id}/pagamento`, { mesi: 1, importo: "0", metodo: "omaggio" }); ok(r.s === 200, "periodo manuale (omaggio) senza fattura");
r = await su("DELETE", `/api/su/pagamenti/${bonId}`); ok(r.s === 400, "una fattura emessa non si cancella");

// Console
r = await pub("GET", "/api/console/riepilogo"); ok(r.s === 401, "console senza chiave: 401");
r = await pub("GET", "/api/console/riepilogo", undefined, { authorization: "Bearer chiaveconsole123" });
ok(r.s === 200 && r.j.prodotto === "BluCheck" && r.j.andamento_12_mesi.length === 12, "console riepilogo");
console.log("    aziende", JSON.stringify(r.j.aziende), "ricavi", JSON.stringify(r.j.ricavi), "mov", JSON.stringify(r.j.movimenti_30_giorni));
r = await pub("POST", "/api/console/super-admin/credenziali", { password: "debole" }, { authorization: "Bearer chiaveconsole123", "x-console-admin-key": "chiaveadmin456" }); ok(r.s === 422, "credenziali: password debole 422");
r = await pub("POST", "/api/console/super-admin/credenziali", { password: "NuovaPassword2026" }, { authorization: "Bearer chiaveconsole123", "x-console-admin-key": "sbagliata" }); ok(r.s === 401, "credenziali: chiave admin sbagliata 401");
r = await pub("POST", "/api/console/super-admin/credenziali", { email: "titolare@blucode.it", password: "NuovaPassword2026" }, { authorization: "Bearer chiaveconsole123", "x-console-admin-key": "chiaveadmin456" }); ok(r.s === 200 && r.j.email === "titolare@blucode.it", "credenziali cambiate dalla Console");
r = await su("GET", "/api/su/dashboard"); ok(r.s === 401, "sessioni del super amministratore invalidate");
const su2 = client(); r = await su2("POST", "/api/login", { email: "titolare@blucode.it", password: "NuovaPassword2026" }); ok(r.s === 200, "accesso con le nuove credenziali");
console.log(fallite ? `\n${fallite} prove fallite` : "\nTutte le prove sono passate");
process.exit(fallite ? 1 : 0);
