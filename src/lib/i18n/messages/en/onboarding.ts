import type base from "../es/onboarding";

/** English dictionary — «First steps» checklist. */
const messages: typeof base = {
  title: "First steps",
  description: "Complete these steps to reach your first message with the agent.",
  progress: "{{done}} of {{total}}",
  done: "Done",
  pending: "To do",
  reopen: "See the first steps again",
  reopenDescription: "Want to review the setup?",
  steps: {
    whatsapp: {
      title: "WhatsApp connected",
      hint: "Connect your number in Settings → WhatsApp.",
    },
    template: {
      title: "Template approved by Meta",
      hint: "Create a template and wait for approval.",
    },
    agent: {
      title: "Agent configured",
      hint: "Write its instructions and load knowledge.",
    },
    lab: {
      title: "Evaluation run",
      hint: "Run an evaluation in the Laboratory.",
    },
    enabled: {
      title: "Agent turned on",
      hint: "Turn it on in the Agent page.",
    },
  },
};
export default messages;
