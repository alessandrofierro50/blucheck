// Prova dell'acquisto dal sito (GET/POST /api/public/acquisto) con Stripe e PayPal simulati.
// Avviare il server su un database NUOVO con i gestori simulati (vedi test/LEGGIMI.md), poi: node test/acquisto.mjs
import crypto from "node:crypto";
import { createRequire } from "node:module";
const B = process.env.BASE || "http://localhost:3999";
const SITO = process.env.WEBSITE_URL || "https://blucodeinformatica.it";
let cookie = "";
const call = async (m, u, b, h = {}) => {
  const r = await fetch(B + u, { method: m, redirect: "manual", headers: { "content-type": "application/json", "x-blucheck": "1", cookie, ...h }, body: b === undefined ? undefined : (typeof b === "string" ? b : JSON.stringify(b)) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { s: r.status, j: ct.includes("json") ? await r.json() : await r.arrayBuffer(), h: r.headers };
};
let fallite = 0;
const ok = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) fallite++; };
const fatt = (o = {}) => ({ tipo: "azienda", denominazione: "Laboratorio Acquisto Srl", partita_iva: "IT01234567897", indirizzo: "Via Roma 1", cap: "73100", comune: "Lecce", provincia: "le", codice_destinatario: "m5uxcr1", email: "fatture@lab-acq.it", ...o });
const ordine = (o = {}) => ({ plan_code: "team", method: "bonifico", name: "Mario Acquisto", email: "mario@lab-acq.it", phone: "3331234567", billing: fatt(), privacy: true, terms: true, terms_version: "1.0", website: "", elapsed_ms: 20000, ...o });
const detail = (r) => (typeof r.j.detail === "object" ? r.j.detail : { message: r.j.detail });

// listino pubblico
let r = await call("GET", "/api/public/acquisto"); const info = r.j;
ok(r.s === 200 && info.enabled && info.product === "BluCheck" && info.periodicita === "annuale", "GET acquisto: attivo, solo annuale");
ok(info.metodi.join(",") === "carta,paypal,bonifico", "metodi: carta, PayPal, bonifico");
const team = info.piani.find((p) => p.code === "team");
ok(team && team.prezzi.annuale.importo === "199.00" && team.prezzi.annuale.bollo === "2.00" && team.prezzi.annuale.totale === "201.00", "prezzo del Team dal listino: 199 + 2 di bollo = 201");
ok(info.piani.length === 3 && info.terms_version === "1.0" && info.terms_url && info.privacy_url, "tre piani, versione termini, link a termini e privacy");

// CORS: solo il sito
r = await call("OPTIONS", "/api/public/acquisto", undefined, { origin: SITO, "access-control-request-method": "POST" });
ok(r.s === 204 && r.h.get("access-control-allow-origin") === SITO, "CORS aperto al sito");
r = await call("GET", "/api/public/acquisto", undefined, { origin: "https://altro.example" });
ok(!r.h.get("access-control-allow-origin"), "CORS chiuso agli altri siti");

// robot, consensi, dati
r = await call("POST", "/api/public/acquisto", ordine({ website: "http://spam" })); ok(r.s === 201 && r.j.robot, "campo trappola: finto successo");
r = await call("POST", "/api/public/acquisto", ordine({ elapsed_ms: 500 })); ok(r.s === 201 && r.j.robot, "troppo in fretta: finto successo");
r = await call("POST", "/api/public/acquisto", ordine({ terms: false })); ok(r.s === 422, "senza termini: 422");
r = await call("POST", "/api/public/acquisto", ordine({ terms_version: "0.9" })); ok(r.s === 422 && /aggiornati/.test(detail(r).message), "versione dei termini vecchia: 422");
r = await call("POST", "/api/public/acquisto", ordine({ method: "contanti" })); ok(r.s === 422, "metodo non valido: 422");
r = await call("POST", "/api/public/acquisto", ordine({ billing: fatt({ partita_iva: "12345678901" }) })); ok(r.s === 422 && detail(r).code === "dati_fatturazione", "P.IVA sbagliata: 422 dati_fatturazione");
r = await call("POST", "/api/public/acquisto", ordine({ plan_code: "inesistente" })); ok(r.s === 404, "pacchetto inesistente: 404");
r = await call("POST", "/api/public/acquisto", ordine({ plan_code: "team", billing: fatt(), importo: 1, totale: 1 })); ok(r.s === 201, "importi mandati dal browser ignorati");
const bonifico1 = r.j.bonifico;
ok(bonifico1 && bonifico1.importo === "201.00" && bonifico1.causale.startsWith("BLUCODE BC ") && bonifico1.iban && bonifico1.intestatario, "bonifico: importo dal listino, causale, IBAN " + JSON.stringify(bonifico1));
ok(r.j.credenziali_inviate === false || r.j.credenziali_inviate === true, "credenziali: email gestita (senza SMTP nei test)");
r = await call("POST", "/api/public/acquisto", ordine({ billing: fatt({ partita_iva: "00743110157" }) })); ok(r.s === 409 && detail(r).code === "email_registrata", "stessa email: 409 email_registrata");
r = await call("POST", "/api/public/acquisto", ordine({ email: "altro@lab-acq.it" })); ok(r.s === 409 && detail(r).code === "azienda_registrata", "stessa P.IVA: 409 azienda_registrata");

// bonifico: nessun documento prima della conferma
const su = (() => { let c = ""; return async (m, u, b) => { const x = await fetch(B + u, { method: m, headers: { "content-type": "application/json", "x-blucheck": "1", cookie: c }, body: b === undefined ? undefined : JSON.stringify(b) }); const sc = x.headers.get("set-cookie"); if (sc) c = sc.split(";")[0]; const ct = x.headers.get("content-type") || ""; return { s: x.status, j: ct.includes("json") ? await x.json() : await x.arrayBuffer() }; }; })();
r = await su("POST", "/api/login", { email: "su@test.it", password: "supersegreta123" }); ok(r.s === 200, "login superuser");
r = await su("GET", "/api/su/pagamenti?stato=in_attesa"); const pend = r.j.find((x) => x.id === bonifico1.pagamento);
ok(pend && !pend.fattura && pend.metodo === "bonifico", "bonifico in attesa: nessun numero di fattura");
r = await su("GET", "/api/su/aziende"); let az = r.j.find((x) => x.ragione === "Laboratorio Acquisto Srl");
ok(az && az.abbonamento.stato === "prova" && az.max_tecnici === 3, "azienda creata in prova col piano Team (3 tecnici), nessun periodo pagato");
r = await su("POST", `/api/su/pagamenti/${bonifico1.pagamento}/conferma`); ok(r.s === 200 && r.j.pagamento.fattura === "1/BC", "conferma bonifico: fattura 1/BC");
r = await su("GET", "/api/su/aziende"); az = r.j.find((x) => x.ragione === "Laboratorio Acquisto Srl");
ok(az.abbonamento.stato === "attivo" && !az.prova, "dopo la conferma: abbonamento attivo");

// carta: ritorno al sito, poi webhook firmato
r = await call("POST", "/api/public/acquisto", ordine({ email: "carta@altro-lab.it", method: "carta", plan_code: "solo", billing: fatt({ denominazione: "Carta Lab Srl", partita_iva: "12345678903", email: "" }), return_url: SITO + "/acquisto/esito/" }));
ok(r.s === 201 && r.j.redirect_url.includes("checkout.stripe.com"), "carta: pagina di Stripe");
const pidCarta = r.j.pagamento, csId = r.j.redirect_url.split("/").pop();
r = await su("GET", "/api/su/pagamenti?stato=in_attesa"); ok(r.j.some((x) => x.id === pidCarta && x.metodo === "carta"), "carta in attesa nel pannello");
const ev = JSON.stringify({ id: "evt_acq_1", type: "checkout.session.completed", data: { object: { id: csId, payment_status: "paid", metadata: { payment_id: pidCarta }, payment_intent: "pi_acq" } } });
const t = Math.floor(Date.now() / 1000), sig = crypto.createHmac("sha256", "whsec_test").update(`${t}.${ev}`).digest("hex");
r = await call("POST", "/api/pagamenti/webhook/stripe", ev, { "stripe-signature": `t=${t},v1=${sig}` }); ok(r.s === 200, "webhook Stripe firmato accettato");
r = await su("GET", "/api/su/pagamenti"); const pc = r.j.find((x) => x.id === pidCarta);
ok(pc && pc.stato === "pagato" && pc.fattura === "2/BC", "carta pagata: fattura 2/BC (alla conferma del webhook)");

// PayPal: ritorno dal sito → cattura → torna al sito
r = await call("POST", "/api/public/acquisto", ordine({ email: "paypal@altro-lab.it", method: "paypal", plan_code: "lab", billing: fatt({ tipo: "privato", denominazione: undefined, nome: "Giulia", cognome: "Verdi", partita_iva: undefined, codice_fiscale: "RSSMRA80A01H501U", email: "" }), return_url: SITO + "/acquisto/esito/" }));
ok(r.s === 201 && r.j.redirect_url.includes("paypal.com"), "PayPal: pagina di approvazione");
const pidPP = r.j.pagamento;
r = await call("GET", `/api/pagamenti/paypal/ritorno?id=${pidPP}&r=${encodeURIComponent(SITO + "/acquisto/esito/?stato=ok")}`);
ok(r.s === 302 && r.h.get("location") === SITO + "/acquisto/esito/?stato=ok", "ritorno PayPal: cattura e torna al sito con stato=ok → " + r.h.get("location"));
r = await su("GET", "/api/su/pagamenti"); const pp = r.j.find((x) => x.id === pidPP);
ok(pp && pp.stato === "pagato" && pp.fattura === "3/BC", "PayPal pagato: fattura 3/BC");
r = await call("GET", `/api/pagamenti/paypal/ritorno?id=${pidPP}&r=${encodeURIComponent("https://truffa.example/x")}`);
ok(r.s === 302 && !r.h.get("location").startsWith("https://truffa.example"), "ritorno PayPal: nessun redirect fuori dal sito");
r = await call("GET", "/api/pagamenti/paypal/ritorno?id=inesistente&r=" + encodeURIComponent(SITO + "/acquisto/esito/"));
ok(r.s === 302 && r.h.get("location").includes("stato=errore"), "ritorno PayPal con pagamento sconosciuto: stato=errore");

// la prova gratuita continua a funzionare (stessa funzione di creazione)
r = await call("POST", "/api/public/prova", { company_name: "Prova Dopo Acquisto", vat_number: "", name: "Luca Prova", email: "luca@prova-dopo.it", privacy: true, terms: true, terms_version: "1.0", elapsed_ms: 9000 });
ok(r.s === 201 && !r.j.robot, "prova gratuita ancora attiva");
r = await su("GET", "/api/su/aziende"); az = r.j.find((x) => x.ragione === "Prova Dopo Acquisto"); ok(az && az.max_tecnici === 10 && az.abbonamento.stato === "prova", "prova: piano più grande (10 tecnici)");

// contratto PDF
const require = createRequire(import.meta.url);
process.env.CEDENTE_DENOMINAZIONE ||= "BluCode Informatica"; process.env.CEDENTE_PIVA ||= "05357210755";
const { contrattoPdf } = require("../contratto.js");
const base = { piano: { nome: "Team", max_tecnici: 3 }, p: { causale: "BLUCODE BC TEST1234", importo_cent: 19900, rimborso_bollo_cent: 200, totale_cent: 20100 }, metodo: "bonifico", terminiVersione: "1.0", data: "2026-11-03" };
const pdfPro = contrattoPdf({ ...base, dati: fatt() }), pdfPriv = contrattoPdf({ ...base, dati: { tipo: "privato", nome: "Giulia", cognome: "Verdi", codice_fiscale: "RSSMRA80A01H501U", indirizzo: "Via Po 2", cap: "73100", comune: "Lecce", provincia: "LE" } });
const pagine = (b) => Number(/\/Count (\d+)/.exec(b.toString("latin1"))?.[1] || 0);
ok(pdfPro.slice(0, 4).toString() === "%PDF" && pagine(pdfPro) >= 1, "contratto PDF per l'azienda (" + pagine(pdfPro) + " pag.)");
ok(pagine(pdfPriv) === pagine(pdfPro) + 1, "contratto per il privato: pagina in più col modulo di recesso (" + pagine(pdfPriv) + " pag.)");

console.log(fallite ? `\n${fallite} prove fallite` : "\nTutte le prove sono passate");
process.exit(fallite ? 1 : 0);
