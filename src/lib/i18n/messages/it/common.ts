import type base from "../es/common";

/** Dizionario IT — stringhe condivise. */
const messages: typeof base = {
  save: "Salva",
  saving: "Salvataggio…",
  cancel: "Annulla",
  close: "Chiudi",
  loading: "Caricamento…",
  create: "Crea",
  creating: "Creazione…",
  edit: "Modifica",
  delete: "Elimina",
  adminOnly:
    "Solo il proprietario o un amministratore dell'organizzazione gestisce questa sezione.",
  generate: "Genera",
  email: "Email",
  name: "Nome",
  password: "Password",
  tempPassword: "Password temporanea",
  minChars: "minimo 8 caratteri",
  meta: {
    titleSuffix: "WhatsApp",
    description:
      "Il CRM di WhatsApp con agente IA e Laboratorio di auto-valutazione",
  },
};
export default messages;
