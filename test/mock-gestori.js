// Precaricato nei test (node -r): simula Stripe e PayPal sostituendo fetch. Non usare in produzione.
const orig = global.fetch;
const sessioni = new Map();
global.__mock = { sessioni, pagato: new Set() };
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
  if (u.includes("blucodeinformatica.it/termini") || u.includes("blucodeinformatica.it/privacy")) return new Response("", { status: 404 });
  return orig(url, opt);
};
