import type base from "../es/agent";

/** EN dictionary — agent. */
const messages: typeof base = {
  loading: "Loading…",
  title: "AI Agent",
  saved: "Saved ✓",
    saveError: "Could not save; your changes are still in the form",
    unsaved: "Unsaved changes",
  statusOn: "On",
  statusOff: "Off",
  toggleLabel: "Agent on",
  setupTitle: "Set up your AI provider to activate the agent",
  setupBody1: "Add ",
  setupBody2: " and ",
  setupBody3:
    " to the instance's environment variables and restart it. In the meantime, you can get the behavior and knowledge ready below.",
  behavior: {
    title: "Behavior",
    description:
      "How the agent presents itself and acts when replying to your customers.",
    nameLabel: "Agent name",
    toneLabel: "Tone",
    tonePlaceholder: "e.g. friendly and direct, formal address",
    instructionsLabel: "Instructions",
    instructionsPlaceholder: "What the agent should and shouldn't do…",
    escalationLabel: "Escalation rules",
    escalationPlaceholder: "When to hand the conversation over to a human…",
    greetingLabel: "Greeting",
    greetingPlaceholder: "Greeting for new conversations",
    save: "Save behavior",
  },
  restricted: {
    title: "Restricted access",
    description:
      "Turns the agent into an internal team assistant: it only answers the numbers on the list. Everyone else gets no AI reply and never sees the knowledge base.",
    toggle: "Only answer the numbers on the list",
    listLabel: "Allowed numbers (one per line, with “+” and country code)",
    listPlaceholder: "+39 347 123 4567\n+1 415 555 0100",
    outsiderLabel: "Reply for unauthorized numbers (optional)",
    outsiderPlaceholder: "This number is for internal team use only.",
    outsiderHint: "Sent once per conversation. Empty = no reply at all.",
    save: "Save restricted access",
    invalid: "Invalid numbers: {{lines}}. Write each number with “+” and the country code, e.g. +39 347 123 4567.",
    saveError: "Could not save restricted access",
    count: "{{count}} allowed numbers",
  },
  kb: {
    title: "Knowledge base",
    description:
      "The agent's single source of truth: it won't assert anything that isn't here.",
    chars: "{{chars}} characters",
    warning:
      "Knowledge is approaching the model's context limit (v1 injects it in full on every turn). Consider pruning entries.",
    newQa: "New question / answer",
    questionPlaceholder: "Question (e.g. Do you ship?)",
    answerPlaceholder: "Answer",
    addQa: "Add Q/A",
    newBlock: "New free-text block",
    blockPlaceholder: "Hours, addresses, policies…",
    addBlock: "Add block",
    removeEntry: "Delete entry",
    saveError: "Could not save the entry; what you typed is still here",
    empty: "No entries yet: add what the agent needs to know.",
  },
};
export default messages;
