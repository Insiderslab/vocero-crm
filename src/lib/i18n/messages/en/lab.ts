import type base from "../es/lab";

/** EN dictionary — lab. */
const messages: typeof base = {
  title: "Laboratory",
  subtitle: "Internal sandbox — doesn't send real messages",
  run: "Run evaluation",
  running: "Run in progress…",
  launchError: "Couldn't launch the run",
  setupTitle: "Set up your AI provider to use the Laboratory",
  setupBody1: "The Laboratory needs the agent to be active: add ",
  setupBody2: " to the instance and come back here.",
  progress: "Evaluating personas…",
  emptyFirst:
    "Run your first evaluation: 6 simulated customers will chat with your agent and a judge will grade each conversation.",
  emptySelect: "Pick a run from the history.",
  history: "History",
  historyEmpty: "No runs yet.",
  statusRunning: "Running…",
  statusFailed: "Failed",
  score: "Score {{score}}",
  report: "Report",
  failed: "The run failed: {{error}}. Please try again.",
  unknownError: "unknown error",
  verdicts: {
    verde: "Green",
    amarillo: "Yellow",
    rojo: "Red",
  },
  judgeFailed:
    "{{count}} case(s) without a verdict (the judge didn't return a valid response); excluded from the score.",
  noVerdict: "no verdict",
  findingsCount: "{{count}} finding(s)",
  transcript: "Transcript",
  customer: "Customer",
  agentRole: "Agent",
  findings: {
    alucinacion: "Hallucination",
    fuera_de_kb: "Outside knowledge",
    debio_escalar: "Should have escalated",
    tono: "Tone",
  },
  addToKb: "Add to knowledge",
  addedToKb: "Added to knowledge ✓",
  evidence: "Evidence:",
  question: "Question",
  answer: "Answer",
  saving: "Saving…",
  saveToKb: "Save to KB",
  cancel: "Cancel",
};
export default messages;
