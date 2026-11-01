"use strict";
(async function () {
  try {
    const [cfg, piani] = await Promise.all([api("GET", "/api/config"), api("GET", "/api/piani")]);
    if (cfg.prova_giorni) $("#provaTxt").textContent = `I primi ${cfg.prova_giorni} giorni sono di prova. Poi rinnovi online con carta, Google Pay, Apple Pay o PayPal.`;
    $("#plans").innerHTML = piani.map((p) => `<div class="plan"><b style="font-family:var(--f-display);font-size:20px">${esc(p.nome)}</b>
      <div class="price">${euro(p.prezzo_cent)} <small>/ ${p.mesi === 12 ? "anno" : p.mesi + " mesi"}</small></div>
      <span class="faint">${esc(p.descrizione || "")}${p.descrizione ? " · " : ""}fino a ${p.max_tecnici} ${p.max_tecnici === 1 ? "tecnico" : "tecnici"}</span>
      <button class="btn primary" type="button" data-piano="${esc(p.id)}">Scegli ${esc(p.nome)}</button></div>`).join("") || `<p class="faint">Contattaci per un preventivo.</p>`;
    $("#rqPiano").innerHTML += piani.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} · ${euro(p.prezzo_cent)}</option>`).join("");
    const c = cfg.contatti || {};
    $("#contatti").textContent = [c.email, c.telefono, c.sito].filter(Boolean).join(" · ");
  } catch { $("#plans").innerHTML = `<p class="faint">Prezzi non disponibili al momento.</p>`; }
})();
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-piano]"); if (!b) return;
  $("#rqPiano").value = b.dataset.piano; $("#reqForm").scrollIntoView({ behavior: "smooth" }); setTimeout(() => $("#rqRagione").focus(), 400);
});
$("#reqForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("#rqErr").textContent = "";
  if (!$("#rqPrivacy").checked) { $("#rqErr").textContent = "Per inviare la richiesta serve il consenso al trattamento dei dati."; return; }
  const btn = e.submitter; if (btn) btn.disabled = true;
  const email = $("#rqEmail").value;
  try {
    await api("POST", "/api/richiesta", { ragione: $("#rqRagione").value, piva: $("#rqPiva").value, nome: $("#rqNome").value, cf: $("#rqCf").value, email: $("#rqEmail").value, telefono: $("#rqTel").value, indirizzo: $("#rqIndirizzo").value, cap: $("#rqCap").value, piano_id: $("#rqPiano").value, messaggio: $("#rqMsg").value });
    $("#reqForm").innerHTML = `<h2>Richiesta inviata</h2><p>Grazie! Riceverai le credenziali di accesso all'indirizzo <b>${esc(email)}</b> appena il laboratorio è abilitato.</p>`;
  } catch (err) { $("#rqErr").textContent = err.message; if (btn) btn.disabled = false; }
});
