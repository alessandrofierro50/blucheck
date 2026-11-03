"use strict";
/*
 * BluCheck - documenti dell'acquisto dal sito: contratto di abbonamento (PDF compilato con i dati del cliente) e, per i privati
 * consumatori, il modulo tipo di recesso. Il testo è una BOZZA da far rivedere a un legale prima dell'uso (modello: BluGest).
 */
const PAG = require("./pagamenti");

const CONTRACT_VERSION = "1.0";
const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const eurIt = (cent) => (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const RECESSO_PRO = "Il Cliente professionista può non rinnovare alla scadenza; non è previsto recesso anticipato con rimborso del canone.";
const RECESSO_CONSUMATORE = "Il Cliente consumatore ha diritto di recedere entro 14 giorni dalla conclusione del contratto, senza motivo (artt. 52 ss. D.Lgs. 206/2005), "
  + "inviando il modulo allegato o una dichiarazione esplicita a {email}. Se chiede di iniziare subito l'uso del servizio, in caso di recesso paga la parte di servizio "
  + "già fruita, in proporzione; se il servizio è stato eseguito per intero e il Cliente ha dato il consenso espresso e ha riconosciuto di perdere il diritto di recesso, "
  + "il recesso non è più possibile (art. 59 lett. a).";

const CLAUSE = [
  ["Oggetto", "{cedente} (di seguito «BluCode») concede al Cliente il diritto di usare, in modalità online (SaaS), il software {prodotto} per la gestione delle "
    + "verificazioni periodiche dei registratori telematici (scadenze, lista di controllo, firma, stampa dei rapporti, lettura del QR della targhetta), piano {piano} "
    + "con un massimo di {tecnici} tecnici, e di ricevere l'assistenza prevista. Il software resta di proprietà di BluCode: al Cliente spetta un diritto d'uso non "
    + "esclusivo e non trasferibile, limitato alla durata del contratto e ai limiti del piano."],
  ["Durata e rinnovo", "Il contratto dura dodici mesi dalla data di attivazione, indicata nella ricevuta di pagamento. Alla scadenza non si rinnova da solo: BluCode avvisa "
    + "il Cliente per email e il Cliente può rinnovare dalla pagina «Abbonamento». Se il rinnovo non arriva, valgono il periodo di tolleranza e la sola lettura previsti "
    + "dai termini di utilizzo, poi l'accesso viene sospeso."],
  ["Corrispettivo e pagamento", "Il canone annuale è di {importo}{bollo_txt}, per un totale di {totale}, pagato in anticipo con carta, PayPal o bonifico. BluCode opera in "
    + "regime forfettario (art. 1, commi 54-89, L. 190/2014): fattura senza IVA e senza ritenuta d'acconto. La fattura elettronica è emessa subito se si paga con carta o "
    + "PayPal; se si paga con bonifico, dopo l'accredito sul conto di BluCode. Il canone non è rimborsabile, salvo quanto previsto dalla legge."],
  ["Termini di utilizzo", "Fanno parte del contratto, e il Cliente dichiara di averli letti e accettati, i termini di utilizzo (versione {termini}), che regolano accessi, "
    + "dati, assistenza, sospensione, sola lettura, cancellazione dei dati e responsabilità."],
  ["Dati personali", "Per i dati dei suoi clienti e dei registratori telematici caricati nel software il Cliente è titolare del trattamento e BluCode ne è responsabile ai "
    + "sensi dell'art. 28 del Regolamento (UE) 2016/679: li tratta solo per fornire il servizio, con misure di sicurezza adeguate, e ne cancella o restituisce una copia alla "
    + "fine del contratto su richiesta. Per i dati del Cliente stesso BluCode è titolare: vale l'informativa sulla privacy allegata."],
  ["Assistenza", "L'assistenza è fornita per email e telefono, nei giorni e orari lavorativi. Il manuale e i video tutorial sono raggiungibili dai link nell'email di conferma."],
  ["Responsabilità", "BluCode risponde dei danni solo per dolo o colpa grave e, negli altri casi, fino all'importo del canone annuale pagato. Il Cliente resta responsabile "
    + "della correttezza dei dati inseriti e degli adempimenti di legge relativi alle verificazioni periodiche (prove eseguite, moduli firmati, comunicazioni all'Agenzia delle "
    + "Entrate): il programma è uno strumento di supporto al lavoro del laboratorio abilitato."],
  ["Recesso", "{recesso}"],
  ["Legge e foro", "Il contratto è regolato dalla legge italiana. Per i Clienti professionisti il foro competente è quello di Lecce; per i consumatori vale il foro di "
    + "residenza o domicilio del consumatore."],
];

/** PDF del contratto compilato. `p` = riga del pagamento (importi in centesimi), `dati` = dati di fatturazione, `piano` = riga dei piani. */
function contrattoPdf({ piano, p, dati, metodo, terminiVersione, data }) {
  const { jsPDF } = require("jspdf");
  const c = PAG.cedente();
  const T = (s) => String(s ?? "").replace(/€/g, "EUR").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").replace(/·/g, "-").replace(/«/g, '"').replace(/»/g, '"');
  const d = new jsPDF({ unit: "mm", format: "a4" });
  const BLU = [35, 64, 168], INK = [11, 33, 71], MUTED = [74, 91, 117];
  const X = 18, W = 174, FINE = 280;
  let y = 20;
  const nuovaPagina = () => { d.addPage(); y = 20; };
  const par = (testo, { size = 9.5, bold = false, color = INK, gap = 2, dopo = 2 } = {}) => {
    d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(size); d.setTextColor(...color);
    for (const riga of d.splitTextToSize(T(testo), W)) { if (y > FINE) nuovaPagina(); d.text(riga, X, y); y += size * 0.5 + gap; }
    y += dopo;
  };
  const titolo = (t) => { if (y > FINE - 12) nuovaPagina(); y += 3; par(t, { size: 10.5, bold: true, color: BLU, dopo: 0 }); };
  const consumatore = dati.tipo === "privato";
  const prodotto = "BluCheck", contatto = env("SUPPORT_EMAIL", "info@blucodeinformatica.it");
  const dataIt = (data || new Date().toISOString().slice(0, 10)).split("-").reverse().join("/");

  par(`Contratto di abbonamento ${prodotto}`, { size: 17, bold: true, color: BLU, gap: 3, dopo: 1 });
  par(`Versione ${CONTRACT_VERSION} - stipulato online il ${dataIt} - rif. ${p.causale}`, { size: 8, color: MUTED, dopo: 4 });
  titolo("Le parti");
  par(`Fornitore: ${c.denominazione}, ${c.indirizzo}, ${c.cap} ${c.comune} (${c.provincia}), P.IVA ${c.piva}${c.cf ? ", C.F. " + c.cf : ""}, ${contatto}.`);
  par(`Cliente: ${PAG.nomeCliente(dati)}, ${dati.indirizzo || ""}, ${dati.cap || ""} ${dati.comune || ""}${dati.provincia ? " (" + dati.provincia + ")" : ""}`
    + (dati.partita_iva ? `, P.IVA ${dati.partita_iva}` : "") + (dati.codice_fiscale ? `, C.F. ${dati.codice_fiscale}` : "")
    + (dati.codice_destinatario ? `, codice destinatario ${dati.codice_destinatario}` : "") + (dati.pec ? `, PEC ${dati.pec}` : "") + ".");
  const vals = {
    cedente: c.denominazione, prodotto, piano: piano.nome, tecnici: piano.max_tecnici, importo: eurIt(p.importo_cent), totale: eurIt(p.totale_cent), termini: terminiVersione,
    bollo_txt: p.rimborso_bollo_cent ? ` più ${eurIt(p.rimborso_bollo_cent)} di rimborso dell'imposta di bollo` : "",
    recesso: (consumatore ? RECESSO_CONSUMATORE : RECESSO_PRO).replace("{email}", contatto),
  };
  CLAUSE.forEach(([t, testo], i) => {
    titolo(`${i + 1}. ${t}`);
    par(testo.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? ""));
  });
  y += 4;
  par("Il Cliente ha accettato il contratto e i termini di utilizzo con il modulo di acquisto del sito (accettazione registrata con data, ora e indirizzo IP). "
    + `Metodo di pagamento scelto: ${PAG.METODI[metodo] || metodo}. `
    + "Ai sensi degli artt. 1341 e 1342 c.c. il Cliente professionista approva specificamente le clausole 7 (Responsabilità) e 9 (Legge e foro).", { size: 8, color: MUTED });
  if (consumatore) {
    nuovaPagina();
    par("Modulo tipo di recesso", { size: 17, bold: true, color: BLU, gap: 3, dopo: 1 });
    par("(da compilare e restituire solo se si desidera recedere dal contratto)", { size: 8, color: MUTED, dopo: 6 });
    par(`A: ${c.denominazione}, ${c.indirizzo}, ${c.cap} ${c.comune} - ${contatto}`, { dopo: 4 });
    par(`Con la presente io sottoscritto/a notifico il recesso dal contratto di abbonamento ${prodotto} (${p.causale}).`, { dopo: 4 });
    par("Ordinato il: ____________   Nome e cognome: ______________________________", { dopo: 3 });
    par("Indirizzo: ______________________________________________   Data: ____________", { dopo: 3 });
    par("Firma (solo se il modulo è inviato in versione cartacea): ______________________");
  }
  return Buffer.from(d.output("arraybuffer"));
}

module.exports = { contrattoPdf, CONTRACT_VERSION };
