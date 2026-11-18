// Prova dell'import dei QR code da file (POST /api/importa-qr/leggi e /api/importa-qr): riepilogo, conferma con backup,
// completamento dei registratori dello storico, clienti nuovi, già presenti, doppioni e QR non validi.
// Le pagine dell'Agenzia sono simulate da mock-gestori.js. Stesso server e variabili di test/LEGGIMI.md, su un database nuovo.
const B = process.env.BASE || "http://localhost:3999";
function client() {
  let cookie = "";
  return async (m, u, b) => {
    const r = await fetch(B + u, { method: m, headers: { "content-type": "application/json", "x-blucheck": "1", cookie }, body: b === undefined ? undefined : JSON.stringify(b) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { s: r.status, j: await r.json() };
  };
}
let fallite = 0;
const ok = (c, m) => { console.log((c ? "OK  " : "FAIL") + " " + m); if (!c) fallite++; };
const su = client(), az = client(), pub = client();
await su("POST", "/api/login", { email: "su@test.it", password: "supersegreta123" });
let r = await pub("POST", "/api/public/prova", { company_name: "Lab QR Srl", vat_number: "04321780753", name: "Mario QR", email: "qr@lab.it", privacy: true, terms: true, terms_version: "1.0", elapsed_ms: 5000 });
ok(r.s === 201, "azienda di prova creata");
const A = (await su("GET", "/api/su/aziende")).j.find((x) => x.ragione === "Lab QR Srl");
const uid = (await su("GET", `/api/su/aziende/${A.id}`)).j.utenti[0].id;
const pwd = (await su("POST", `/api/su/utenti/${uid}/reset`)).j.password;
await az("POST", "/api/login", { email: "qr@lab.it", password: pwd });
await az("POST", "/api/me/password", { attuale: pwd, nuova: "Nuovapass2026" });

// archivio di partenza: un cliente dallo storico (registratore da completare), uno già con il suo apparecchio, uno senza P.IVA
r = await az("POST", "/api/importa-storico", { formato: "blucheck-storico-1", conferma: true, clienti: [{ ragione: "Bar Uno Srl", piva: "01234567890", ultimaVerifica: "2023-03-01" }] });
ok(r.j.importati === 1, "storico: 1 cliente con registratore da completare");
await az("PUT", "/api/dati/clienti/cE", { data: { ragione: "ESISTENTE SAS", piva: "06666666666" } });
await az("PUT", "/api/dati/apparecchi/aE", { data: { clienteId: "cE", matricola: "80EPS000005", modello: "EPSON FP-81", firmware: "9.0", ultimaVerifica: "2024-02-01" } });
await az("PUT", "/api/dati/clienti/cT", { data: { ragione: "NEGOZIO TRE", piva: "" } });

const U = (id) => `https://ivaservizi.agenziaentrate.gov.it/ser/mobile/fiscalizzazione/v1/stato/${id}?seed=1`;
const urls = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"].map(U).concat([U("Q1"), "https://example.com/altro"]);
r = await az("POST", "/api/importa-qr/leggi", { urls: urls.slice(0, 5) });
ok(r.s === 200 && r.j.righe.length === 5 && r.j.righe.every((x) => x.dati), "lettura a gruppi delle pagine dell'Agenzia");
r = await az("POST", "/api/importa-qr/leggi", { urls: new Array(21).fill(0).map((_, i) => U("X" + i)) });
ok(r.s === 413, "massimo 20 per gruppo");
r = await az("POST", "/api/importa-qr", { urls });
const E = (u) => r.j.righe.find((x) => x.url === u);
ok(r.s === 200 && r.j.anteprima, "riepilogo " + JSON.stringify({ ...r.j, righe: undefined }));
ok(E(U("Q1")).esito === "completa" && E(U("Q1")).cliente === "BAR UNO SRL", "Q1 completa il registratore dello storico del cliente con la stessa P.IVA");
ok(E(U("Q2")).esito === "nuovo" && E(U("Q2")).cliente === "BAR UNO SRL" && !E(U("Q2")).clienteNuovo, "Q2: secondo registratore dello stesso cliente = nuovo apparecchio");
ok(E(U("Q3")).esito === "nuovo" && E(U("Q3")).clienteNuovo && E(U("Q4")).clienteNuovo, "Q3 e Q4: esercente sconosciuto = cliente nuovo");
ok(r.j.clienti_nuovi === 1, "Q3 e Q4 dello stesso esercente creano un solo cliente");
ok(E(U("Q5")).esito === "presente" && E(U("Q5")).cambi.includes("firmware") && E(U("Q5")).cambi.includes("ultima verificazione"), "Q5 già presente: firmware e verifica da aggiornare");
ok(E(U("Q6")).esito === "errore", "Q6: pagina senza dispositivo = non leggibile");
ok(E(U("Q7")).esito === "doppio", "Q7: stessa matricola di Q1 = doppione");
ok(E(U("Q8")).esito === "nuovo" && E(U("Q8")).cliente === "NEGOZIO TRE" && E(U("Q8")).avvisi.some((a) => /ragione sociale/.test(a)), "Q8: cliente riconosciuto dalla ragione sociale");
ok(E("https://example.com/altro").esito === "errore", "indirizzo che non è dell'Agenzia = non leggibile");
ok(r.j.righe.filter((x) => x.url === U("Q1")).length === 1, "stesso indirizzo due volte = una riga");
r = await az("GET", "/api/bootstrap"); ok(r.j.apparecchi.length === 2 && r.j.clienti.length === 3, "il riepilogo non scrive nulla");

r = await az("POST", "/api/importa-qr", { urls, conferma: true, escludi: [U("Q4")] });
ok(r.s === 200 && r.j.salvati === 5 && /^blucheck-prima-import-qr-.*\.db$/.test(r.j.backup), "conferma: 5 salvati (Q4 escluso), backup " + r.j.backup);
ok(r.j.fatti.nuovi === 3 && r.j.fatti.completati === 1 && r.j.fatti.aggiornati === 1 && r.j.fatti.clienti === 1, "conteggi " + JSON.stringify(r.j.fatti));
r = await az("GET", "/api/bootstrap");
const ap = (m) => r.j.apparecchi.find((a) => a.matricola === m);
const uno = r.j.clienti.find((c) => c.ragione === "BAR UNO SRL");
ok(ap("99MEX000001")?.clienteId === uno.id && ap("99MEX000001").importato && ap("99MEX000001").ultimaVerifica === "2025-03-10" && ap("99MEX000001").modello === "RCH PRINT F" && !ap("99MEX000001").note, "registratore dello storico completato (matricola, modello, verifica, nota tolta)");
ok(r.j.apparecchi.filter((a) => a.clienteId === uno.id).length === 2, "il cliente ha ora due registratori, nessuno da completare in più");
ok(ap("80EPS000005").firmware === "9.9" && ap("80EPS000005").ultimaVerifica === "2026-02-01" && ap("80EPS000005").qrUrl === U("Q5") && ap("80EPS000005").ae?.matricola, "già presente aggiornato con i dati dell'Agenzia");
const due = r.j.clienti.find((c) => c.ragione === "PIZZERIA DUE SNC");
ok(due?.piva === "05555555555" && ap("72CUS000003")?.clienteId === due.id && !ap("72CUS000004"), "cliente nuovo creato, Q4 escluso non salvato");
ok(r.j.clienti.find((c) => c.id === "cT").piva === "07777777777" && ap("55OLI000008")?.clienteId === "cT", "P.IVA aggiunta al cliente riconosciuto per nome");

r = await az("POST", "/api/importa-qr", { urls });
ok(r.j.nuovi === 1 && r.j.invariati === 5 && r.j.clienti_nuovi === 0 && r.j.righe.find((x) => x.url === U("Q4")).cliente === "PIZZERIA DUE SNC", "secondo import: solo Q4 nuovo (sul cliente creato prima), gli altri invariati " + JSON.stringify({ ...r.j, righe: undefined }));

console.log(fallite ? `\n${fallite} prove FALLITE` : "\nTutte le prove superate");
process.exit(fallite ? 1 : 0);
