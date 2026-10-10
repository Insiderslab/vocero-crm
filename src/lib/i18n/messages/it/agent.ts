import type base from "../es/agent";

/** Dizionario IT — agent. */
const messages: typeof base = {
  loading: "Caricamento…",
  title: "Agente IA",
  saved: "Salvato ✓",
    saveError: "Salvataggio non riuscito; le tue modifiche sono ancora nel modulo",
    unsaved: "Modifiche non salvate",
  statusOn: "Acceso",
  statusOff: "Spento",
  toggleLabel: "Agente attivo",
  setupTitle: "Configura il tuo provider IA per attivare l'agente",
  setupBody1: "Aggiungi ",
  setupBody2: " e ",
  setupBody3:
    " alle variabili d'ambiente dell'istanza e riavviala. Nel frattempo puoi preparare qui sotto il comportamento e la conoscenza.",
  behavior: {
    title: "Comportamento",
    description:
      "Come si presenta e agisce l'agente quando risponde ai tuoi clienti.",
    nameLabel: "Nome dell'agente",
    toneLabel: "Tono",
    tonePlaceholder: "es. cordiale e diretto, con tono formale",
    instructionsLabel: "Istruzioni",
    instructionsPlaceholder: "Cosa deve e non deve fare l'agente…",
    escalationLabel: "Regole di escalation",
    escalationPlaceholder: "Quando passare la conversazione a un umano…",
    greetingLabel: "Saluto",
    greetingPlaceholder: "Saluto per le nuove conversazioni",
    save: "Salva comportamento",
  },
  restricted: {
    title: "Accesso riservato",
    description:
      "Trasforma l'agente in un assistente interno del team: risponde solo ai numeri della lista. Agli altri non risponde l'IA e non vedono la conoscenza.",
    toggle: "Rispondi solo ai numeri della lista",
    listLabel: "Numeri autorizzati (uno per riga, con prefisso internazionale)",
    listPlaceholder: "+39 347 123 4567\n+39 02 1234 5678",
    outsiderLabel: "Risposta per i numeri non autorizzati (facoltativa)",
    outsiderPlaceholder: "Questo numero è a uso interno del team.",
    outsiderHint: "Inviata una sola volta per conversazione. Vuota = nessuna risposta.",
    save: "Salva accesso riservato",
    invalid: "Numeri non validi: {{lines}}",
    saveError: "Impossibile salvare l'accesso riservato",
    count: "{{count}} numeri autorizzati",
  },
  kb: {
    title: "Knowledge base",
    description:
      "L'unica fonte di verità dell'agente: ciò che non è qui, non lo afferma.",
    chars: "{{chars}} caratteri",
    warning:
      "La conoscenza si avvicina al limite di contesto del modello (la v1 la inietta per intero a ogni turno). Valuta di ripulire le voci.",
    newQa: "Nuova domanda / risposta",
    questionPlaceholder: "Domanda (es. Fate spedizioni?)",
    answerPlaceholder: "Risposta",
    addQa: "Aggiungi D/R",
    newBlock: "Nuovo blocco di testo libero",
    blockPlaceholder: "Orari, indirizzi, politiche…",
    addBlock: "Aggiungi blocco",
    removeEntry: "Elimina voce",
    saveError: "Impossibile salvare la voce; quello che hai scritto è ancora qui",
    empty: "Nessuna voce ancora: aggiungi ciò che l'agente deve sapere.",
  },
};
export default messages;
