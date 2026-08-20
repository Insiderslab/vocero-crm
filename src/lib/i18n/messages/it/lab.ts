import type base from "../es/lab";

/** Dizionario IT — lab. */
const messages: typeof base = {
  title: "Laboratorio",
  subtitle: "Sandbox interna — non invia messaggi reali",
  run: "Esegui valutazione",
  running: "Esecuzione in corso…",
  launchError: "Impossibile avviare l'esecuzione",
  setupTitle: "Configura il tuo provider IA per usare il Laboratorio",
  setupBody1: "Il Laboratorio richiede l'agente attivo: aggiungi ",
  setupBody2: " all'istanza e torna qui.",
  progress: "Valutazione delle personas in corso…",
  emptyFirst:
    "Esegui la tua prima valutazione: 6 clienti simulati converseranno con il tuo agente e un giudice valuterà ogni conversazione.",
  emptySelect: "Scegli un'esecuzione dallo storico.",
  history: "Storico",
  historyEmpty: "Nessuna esecuzione ancora.",
  statusRunning: "In corso…",
  statusFailed: "Fallita",
  score: "Punteggio {{score}}",
  report: "Report",
  failed: "L'esecuzione è fallita: {{error}}. Riprova.",
  unknownError: "errore sconosciuto",
  verdicts: {
    verde: "Verdi",
    amarillo: "Gialli",
    rojo: "Rossi",
  },
  judgeFailed:
    "{{count}} caso/i senza verdetto (il giudice non ha risposto in modo valido); esclusi dal punteggio.",
  noVerdict: "senza verdetto",
  findingsCount: "{{count}} riscontro/i",
  transcript: "Trascrizione",
  customer: "Cliente",
  agentRole: "Agente",
  findings: {
    alucinacion: "Allucinazione",
    fuera_de_kb: "Fuori dalla conoscenza",
    debio_escalar: "Doveva escalare",
    tono: "Tono",
  },
  addToKb: "Aggiungi alla conoscenza",
  addedToKb: "Aggiunto alla conoscenza ✓",
  evidence: "Evidenza:",
  question: "Domanda",
  answer: "Risposta",
  saving: "Salvataggio…",
  saveToKb: "Salva nel KB",
  cancel: "Annulla",
};
export default messages;
