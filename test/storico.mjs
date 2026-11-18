// Prova dell'import dello storico (POST /api/importa-storico): anteprima, conferma con backup, niente doppioni al secondo import.
// Stesso server e variabili di test/LEGGIMI.md, su un database nuovo: node test/storico.mjs
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
let r = await pub("POST", "/api/public/prova", { company_name: "Lab Storico Srl", vat_number: "04321780753", name: "Mario Storico", email: "storico@lab.it", privacy: true, terms: true, terms_version: "1.0", elapsed_ms: 5000 });
ok(r.s === 201, "azienda di prova creata");
const A = (await su("GET", "/api/su/aziende")).j.find((x) => x.ragione === "Lab Storico Srl");
const uid = (await su("GET", `/api/su/aziende/${A.id}`)).j.utenti[0].id;
const pwd = (await su("POST", `/api/su/utenti/${uid}/reset`)).j.password;
await az("POST", "/api/login", { email: "storico@lab.it", password: pwd });
await az("POST", "/api/me/password", { attuale: pwd, nuova: "Nuovapass2026" });
await az("PUT", "/api/dati/clienti/c0", { data: { ragione: "Già Presente Snc" } });

const file = { formato: "blucheck-storico-1", fonte: "prova", clienti: [
  { ragione: "Bar Uno", domicilio: "Lecce", ultimaVerifica: "2024-11-20", storicoVerifiche: ["2022-11-02", "2024-11-20"] },
  { ragione: "Negozio Due", ultimaVerifica: "2019-03-01", cessato: true, verificato: true, segnalazioni: "riga rossa" },
  { ragione: "GIA' PRESENTE SNC", ultimaVerifica: "2024-01-01" },
  { ragione: "bar uno", ultimaVerifica: "2020-01-01" },
] };
r = await az("POST", "/api/importa-storico", { formato: "altro", clienti: [] }); ok(r.s === 400, "file sconosciuto rifiutato");
r = await az("POST", "/api/importa-storico", file);
ok(r.s === 200 && r.j.anteprima && r.j.nuovi === 2 && r.j.cessati === 1 && r.j.saltati.length === 2, "anteprima: 2 nuovi, 1 cessato, 2 saltati " + JSON.stringify(r.j));
r = await az("GET", "/api/bootstrap"); ok(r.j.clienti.length === 1, "l'anteprima non scrive nulla");
r = await az("POST", "/api/importa-storico", { ...file, conferma: true });
ok(r.s === 200 && r.j.importati === 2 && /^blucheck-prima-import-.*\.db$/.test(r.j.backup), "conferma: 2 importati, backup " + r.j.backup);
r = await az("GET", "/api/bootstrap");
const uno = r.j.clienti.find((c) => c.ragione === "BAR UNO"), due = r.j.clienti.find((c) => c.ragione === "NEGOZIO DUE");
ok(uno && !uno.verificato && !uno.cessato && uno.storicoVerifiche.length === 2 && uno.domicilio === "LECCE", "cliente importato con storico e segni");
ok(due && due.cessato, "cliente cessato importato");
const app1 = r.j.apparecchi.find((a) => a.clienteId === uno.id);
ok(app1 && app1.ultimaVerifica === "2024-11-20" && app1.importato && !app1.matricola, "apparecchio da completare con l'ultima verifica");
r = await az("POST", "/api/importa-storico", { ...file, conferma: true }); ok(r.j.importati === 0 && r.j.saltati.length === 4, "secondo import: nessun doppione");
r = await su("GET", "/api/su/dashboard"); ok(r.s === 200, "server ancora in piedi");
console.log(fallite ? `\n${fallite} prove fallite` : "\nTutte le prove sono passate");
process.exit(fallite ? 1 : 0);
