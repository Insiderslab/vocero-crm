import type base from "../es/auth";

/** Dizionario IT — login e registrazione. */
const messages: typeof base = {
  tagline: "Il CRM di WhatsApp con agente IA",
  login: {
    title: "Accedi",
    submit: "Accedi",
    submitting: "Accesso in corso…",
    badCredentials: "Email o password errati.",
    tooMany: "Troppi tentativi. Attendi qualche minuto.",
    noAccount: "Non hai un account?",
    createOne: "Creane uno",
  },
  register: {
    title: "Crea account",
    description:
      "La prima registrazione crea l'organizzazione di questa istanza e ne diventa proprietaria.",
    yourName: "Il tuo nome",
    submit: "Crea account",
    submitting: "Creazione…",
    closed:
      "Registrazione chiusa: questa istanza ha già la sua organizzazione. Chiedi accesso al proprietario.",
    tooMany: "Troppi tentativi. Attendi qualche minuto.",
    failed: "Impossibile creare l'account.",
    haveAccount: "Hai già un account?",
    signIn: "Accedi",
  },
};
export default messages;
