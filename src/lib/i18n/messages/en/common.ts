import type base from "../es/common";

/** EN dictionary — common strings. Must mirror the ES shape (typecheck). */
const messages: typeof base = {
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  close: "Close",
  loading: "Loading…",
  create: "Create",
  creating: "Creating…",
  edit: "Edit",
  delete: "Delete",
  generate: "Generate",
  email: "Email",
  name: "Name",
  password: "Password",
  tempPassword: "Temporary password",
  minChars: "at least 8 characters",
  meta: {
    titleSuffix: "WhatsApp",
    description: "The WhatsApp CRM with an AI agent and a self-testing Lab",
  },
};
export default messages;
