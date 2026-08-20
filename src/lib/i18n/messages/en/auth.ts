import type base from "../es/auth";

/** EN dictionary — login and register. */
const messages: typeof base = {
  tagline: "The WhatsApp CRM with an AI agent",
  login: {
    title: "Sign in",
    submit: "Sign in",
    submitting: "Signing in…",
    badCredentials: "Wrong email or password.",
    tooMany: "Too many attempts. Wait a few minutes.",
    noAccount: "Don't have an account?",
    createOne: "Create one",
  },
  register: {
    title: "Create account",
    description:
      "The first registration creates this instance's organization and becomes its owner.",
    yourName: "Your name",
    submit: "Create account",
    submitting: "Creating…",
    closed:
      "Registration is closed: this instance already has its organization. Ask the owner for access.",
    tooMany: "Too many attempts. Wait a few minutes.",
    failed: "The account could not be created.",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },
};
export default messages;
