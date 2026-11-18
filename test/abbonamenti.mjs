// Prova dell'import degli abbonamenti software (POST /api/importa-abbonamenti): anno dal codice articolo, note di credito,
// clienti non trovati da abbinare, nomi BluGest ricordati, anni tolti, backup. Database nuovo, server come in test/LEGGIMI.md:
// node test/abbonamenti.mjs
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
let r = await pub("POST", "/api/public/prova", { company_name: "Lab Abbonamenti Srl", vat_number: "04321780753", name: "Mario Abb", email: "abb@lab.it", privacy: true, terms: true, terms_version: "1.0", elapsed_ms: 5000 });
ok(r.s === 201, "azienda di prova creata");
const A = (await su("GET", "/api/su/aziende")).j.find((x) => x.ragione === "Lab Abbonamenti Srl");
const uid = (await su("GET", `/api/su/aziende/${A.id}`)).j.utenti[0].id;
const pwd = (await su("POST", `/api/su/utenti/${uid}/reset`)).j.password;
await az("POST", "/api/login", { email: "abb@lab.it", password: pwd });
await az("POST", "/api/me/password", { attuale: pwd, nuova: "Nuovapass2026" });
await az("PUT", "/api/dati/clienti/c1", { data: { ragione: "RISTO SRLS" } });
await az("PUT", "/api/dati/clienti/c2", { data: { ragione: "Bar Due", gestionale: "si", abbSw: { "2024": { canoni: 1, importo: 150, documenti: [] } } } });
await az("PUT", "/api/dati/clienti/c3", { data: { ragione: "RUPE DELLE STELLE DI NAPOLITANO GIANNI" } });
await az("PUT", "/api/dati/apparecchi/a1", { data: { clienteId: "c1", matricola: "99MEX000001" } });
await az("PUT", "/api/dati/apparecchi/a3", { data: { clienteId: "c3", matricola: "99MEX000003" } });
await az("PUT", "/api/dati/apparecchi/a3b", { data: { clienteId: "c3", matricola: "99MEX000033" } });

const riga = (soggetto, documento, data, quantita, importo) => ({ soggetto, documento, data, quantita, importo });
const file = { formato: "blucheck-abbonamenti-1", fonte: "prova", anni: [
  { anno: "2024", righe: [riga("BAR DUE", "Fattura 1", "2025-01-10", 1, 150)] },
  { anno: "2025", righe: [riga("RISTO SRLS", "Fattura 174", "2025-03-12", 1, 150), riga("RISTO SRLS", "Fattura 319", "2025-05-14", 1, 150), riga("RISTO SRLS", "Nota di credito 10", "2025-05-22", -1, -150),
    riga("AZ.AGR.RUPE DELLE STELLE DI NAPOLITANO G.", "Fattura 9", "2026-02-01", 1, 150), riga("FATANO SPA", "Fattura 86", "2025-02-04", 1, 150)] },
] };
r = await az("POST", "/api/importa-abbonamenti", { formato: "x", anni: [] }); ok(r.s === 400, "dati sconosciuti rifiutati");
r = await az("POST", "/api/importa-abbonamenti", file);
ok(r.s === 200 && r.j.anteprima && r.j.nonTrovati.length === 2, "anteprima: 2 nomi BluGest da abbinare " + JSON.stringify(r.j.nonTrovati));
const risto = r.j.cambi.find((c) => c.ragione === "RISTO SRLS");
ok(risto && risto.righe[0].anno === "2025" && risto.righe[0].canoni === 1 && risto.righe[0].importo === 150 && risto.segnaGestionale, "nota di credito: 1 canone netto, gestionale da segnare");
ok(r.j.invariati === 1, "Bar Due 2024 già uguale");
r = await az("POST", "/api/importa-abbonamenti", { ...file, conferma: true }); ok(r.s === 400, "conferma rifiutata finché ci sono nomi da abbinare");
const abbinamenti = { "AZ.AGR.RUPE DELLE STELLE DI NAPOLITANO G.": "c3", "FATANO SPA": "nuovo" };
r = await az("POST", "/api/importa-abbonamenti", { ...file, abbinamenti });
ok(r.j.nonTrovati.length === 0 && r.j.nuoviClienti === 1 && r.j.abbonamentiNuovi === 3, "con gli abbinamenti: 1 cliente nuovo, 3 abbonamenti " + JSON.stringify({ n: r.j.nuoviClienti, a: r.j.abbonamentiNuovi }));
r = await az("GET", "/api/bootstrap"); ok(r.j.clienti.length === 3, "l'anteprima non scrive nulla");
r = await az("POST", "/api/importa-abbonamenti", { ...file, abbinamenti, conferma: true });
ok(r.s === 200 && r.j.aggiornati === 3 && /^blucheck-prima-import-abbonamenti-.*\.db$/.test(r.j.backup), "conferma: 3 clienti, backup " + r.j.backup);
r = await az("GET", "/api/bootstrap");
const cli = (n) => r.j.clienti.find((c) => c.ragione === n);
ok(cli("RISTO SRLS").gestionale === "si" && cli("RISTO SRLS").abbSw["2025"].canoni === 1 && cli("RISTO SRLS").abbSw["2025"].documenti.length === 3, "Risto: 2025 pagato, documenti salvati");
ok(cli("RUPE DELLE STELLE DI NAPOLITANO GIANNI").nomiBlugest?.[0] === "AZ.AGR.RUPE DELLE STELLE DI NAPOLITANO G.", "nome BluGest ricordato");
ok(cli("FATANO SPA")?.abbSw?.["2025"] && cli("FATANO SPA").gestionale === "si", "cliente nuovo creato");
ok(cli("Bar Due").abbSw["2024"], "anno non nel file lasciato com'è");
const app = (id) => r.j.apparecchi.find((a) => a.id === id);
ok(app("a1").abbSw === true && app("a3").abbSw === undefined && app("a3b").abbSw === undefined, "1 canone e 1 registratore: collegato; 1 canone e 2 registratori: da scegliere");
// secondo import: niente abbinamenti a mano, niente cambi; senza la riga di Risto il 2025 di Risto si toglie
r = await az("POST", "/api/importa-abbonamenti", file);
ok(r.j.nonTrovati.length === 0 && r.j.cambi.length === 0, "secondo import: nomi ricordati, nessun cambio " + JSON.stringify(r.j.cambi.map((c) => c.ragione)));
const senzaRisto = { ...file, anni: [file.anni[0], { anno: "2025", righe: file.anni[1].righe.filter((x) => x.soggetto !== "RISTO SRLS") }] };
r = await az("POST", "/api/importa-abbonamenti", senzaRisto);
ok(r.j.abbonamentiTolti === 1 && r.j.cambi[0].ragione === "RISTO SRLS", "anno non più nel file: si toglie");
r = await az("POST", "/api/importa-abbonamenti", { ...file, anni: [{ anno: "25", righe: [] }] }); ok(r.s === 400, "anno non valido rifiutato");
console.log(fallite ? `\n${fallite} prove fallite` : "\nTutto a posto");
process.exit(fallite ? 1 : 0);
