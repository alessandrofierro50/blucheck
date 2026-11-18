// Precaricato nei test (node -r): simula Stripe e PayPal sostituendo fetch. Non usare in produzione.
const orig = global.fetch;
const sessioni = new Map();
// QR delle targhette usati da test/importa-qr.mjs
const AE = {
  Q1: { matricola: "99MEX000001", marca: "RCH", modello: "PRINT F", vp: "10/03/2025", fw: "1.2", piva: "01234567890", nome: "BAR UNO SRL" },
  Q2: { matricola: "99MEX000002", marca: "RCH", modello: "PRINT F", vp: "", fw: "1.2", piva: "01234567890", nome: "BAR UNO SRL" },
  Q3: { matricola: "72CUS000003", marca: "CUSTOM", modello: "Q3X", vp: "05/05/2024", fw: "3.0", piva: "05555555555", nome: "PIZZERIA DUE SNC" },
  Q4: { matricola: "72CUS000004", marca: "CUSTOM", modello: "Q3X", vp: "", fw: "3.0", piva: "05555555555", nome: "PIZZERIA DUE SNC" },
  Q5: { matricola: "80EPS000005", marca: "EPSON", modello: "FP-81", vp: "01/02/2026", fw: "9.9", piva: "06666666666", nome: "ESISTENTE SAS" },
  Q7: { matricola: "99MEX000001", marca: "RCH", modello: "PRINT F", vp: "10/03/2025", fw: "1.2", piva: "01234567890", nome: "BAR UNO SRL" },
  Q8: { matricola: "55OLI000008", marca: "OLIVETTI", modello: "FORM 200", vp: "", fw: "", piva: "07777777777", nome: "Negozio Tre" },
};
global.__mock = { sessioni, pagato: new Set(), ae: AE };
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.stripe.com/v1/checkout/sessions")) {
    if ((opt.method || "GET") === "POST") {
      const f = new URLSearchParams(opt.body.toString()); const id = "cs_test_" + f.get("client_reference_id");
      sessioni.set(id, { id, metadata: { payment_id: f.get("metadata[payment_id]") }, amount_total: Number(f.get("line_items[0][price_data][unit_amount]")) });
      return J({ id, url: "https://checkout.stripe.com/c/pay/" + id });
    }
    const id = decodeURIComponent(u.split("/").pop()); const s = sessioni.get(id);
    return s ? J({ ...s, payment_status: global.__mock.pagato.has(id) ? "paid" : "unpaid" }) : J({ error: {} }, 404);
  }
  if (u.includes("paypal.com/v1/oauth2/token")) return J({ access_token: "tok" });
  if (u.includes("paypal.com/v2/checkout/orders") && u.endsWith("/capture")) return J({ id: u.split("/").slice(-2)[0], status: "COMPLETED" });
  if (u.includes("paypal.com/v2/checkout/orders")) { const b = JSON.parse(opt.body); return J({ id: "PPORD" + b.purchase_units[0].custom_id, links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=X" }] }); }
  if (u.includes("paypal.com/v1/notifications/verify-webhook-signature")) return J({ verification_status: "SUCCESS" });
  // pagina «Stato Fiscalizzazione Dispositivo» dell'Agenzia (QR delle targhette): dati da global.__mock.ae[<id>]
  if (u.startsWith("https://ivaservizi.agenziaentrate.gov.it/ser/mobile/fiscalizzazione/")) {
    const id = u.split("/stato/")[1]?.split("?")[0]; const d = global.__mock.ae[id];
    if (!d) return new Response("<html><body>Dispositivo non trovato</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    const r = (l, v) => `<div><span>${l}</span><span>${v}</span></div>`;
    return new Response(`<html><body>${r("Matricola", d.matricola)}${r("Stato", "Attivato")}
      <h3>Informazioni Dispositivo</h3>${r("Marca", "XX")}${r("Descrizione Marca", d.marca)}${r("Modello", "YY")}${r("Descrizione Modello", d.modello)}${r("Tipo Sigillo", "Piombo")}
      <h3>Ultima Verificazione Periodica</h3>${r("Data", d.vp || "")}<span>01 - Esito Positivo</span>
      <h3>Ultima versione software del dispositivo</h3>${r("Versione", d.fw || "")}${r("Data Rilascio", "01/01/2024")}
      <h3>Esercente</h3>${r("Partita IVA", d.piva || "")}${r("Denominazione", d.nome || "")}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (u.includes("blucodeinformatica.it/termini") || u.includes("blucodeinformatica.it/privacy")) return new Response("", { status: 404 });
  return orig(url, opt);
};
