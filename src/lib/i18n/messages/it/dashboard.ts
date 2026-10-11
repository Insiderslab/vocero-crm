import type base from "../es/dashboard";

/** Dizionario IT — pagina «Sintesi» (dashboard). */
const messages: typeof base = {
  title: "Sintesi",
  period: "Periodo",
  periodDays: "{{days}} giorni",
  error: "Non è stato possibile caricare la sintesi.",
  retry: "Riprova",
  stages: {
    title: "Conversazioni per fase della pipeline",
    empty: "Ancora nessun dato in questo periodo.",
    aria: "Conversazioni per fase: {{items}}.",
  },
  firstResponse: {
    title: "Tempo di prima risposta",
    median: "Mediana",
    p90: "90° percentile",
    minutes: "{{value}} min",
    answered: "{{count}} conversazioni con risposta",
    empty: "Ancora nessuna risposta misurata in questo periodo.",
    aria: "Prima risposta: mediana {{median}} minuti, 90° percentile {{p90}} minuti, su {{answered}} conversazioni.",
  },
  outgoing: {
    title: "IA contro persona",
    ai: "dall'IA",
    human: "da persone",
    aria: "Messaggi in uscita: {{ai}} dall'IA e {{human}} da persone.",
    handoffsTitle: "Passaggi a una persona per motivo",
    handoffEmpty: "Nessun passaggio a una persona in questo periodo.",
    empty: "Ancora nessun messaggio in uscita in questo periodo.",
    unknownReason: "Senza motivo",
    reason: {
      cliente: "Richiesto dal cliente",
      modelo: "Decisione del modello",
      error: "Errore",
      ventana: "Finestra di 24 h",
      hostilidad: "Ostilità",
      manual_reply: "Risposta dal telefono",
    },
  },
  conversions: {
    title: "Conversioni",
    won: "Lead arrivati alla fase vinta",
    empty: "Ancora nessuna conversione in questo periodo.",
  },
  trend: {
    title: "Entranti e uscenti per giorno",
    inbound: "Entranti",
    outbound: "Uscenti",
    empty: "Ancora nessun messaggio in questo periodo.",
    aria: "Messaggi per giorno: {{inbound}} entranti e {{outbound}} uscenti.",
  },
};
export default messages;
