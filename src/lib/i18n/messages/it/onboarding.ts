import type base from "../es/onboarding";

/** Dizionario IT — checklist «Primi passi». */
const messages: typeof base = {
  title: "Primi passi",
  description: "Completa questi passi per arrivare al primo messaggio con l'agente.",
  progress: "{{done}} di {{total}}",
  done: "Fatto",
  pending: "Da fare",
  reopen: "Rivedi i primi passi",
  reopenDescription: "Vuoi ripassare la messa in opera?",
  steps: {
    whatsapp: {
      title: "Numero WhatsApp collegato",
      hint: "Collega il numero in Impostazioni → WhatsApp.",
    },
    template: {
      title: "Modello approvato da Meta",
      hint: "Crea un modello e attendi l'approvazione.",
    },
    agent: {
      title: "Agente configurato",
      hint: "Scrivi le istruzioni e carica la base di conoscenza.",
    },
    lab: {
      title: "Valutazione eseguita",
      hint: "Esegui una valutazione nel Laboratorio.",
    },
    enabled: {
      title: "Agente acceso",
      hint: "Accendilo nella pagina Agente.",
    },
  },
};
export default messages;
