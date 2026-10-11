import type base from "../es/dashboard";

/** English dictionary — «Sintesi» (dashboard) page. */
const messages: typeof base = {
  title: "Summary",
  period: "Period",
  periodDays: "{{days}} days",
  error: "The summary couldn't be loaded.",
  retry: "Retry",
  stages: {
    title: "Conversations by pipeline stage",
    empty: "No conversations in the pipeline yet.",
    aria: "Conversations by stage: {{items}}.",
  },
  firstResponse: {
    title: "First response time",
    median: "Median",
    p90: "90th percentile",
    minutes: "{{value}} min",
    answered: "{{count}} conversations answered",
    empty: "No measured replies in this period yet.",
    aria: "First response: median {{median}} minutes, 90th percentile {{p90}} minutes, over {{answered}} conversations.",
  },
  outgoing: {
    title: "AI vs person",
    ai: "from AI",
    human: "from people",
    aria: "Outgoing messages: {{ai}} from AI and {{human}} from people.",
    handoffsTitle: "Handoffs to a person by reason",
    handoffEmpty: "No handoffs to a person in this period.",
    empty: "No outgoing messages in this period yet.",
    unknownReason: "No reason",
    reason: {
      cliente: "Customer asked for one",
      modelo: "Model decision",
      error: "Error",
      ventana: "24 h window",
      hostilidad: "Hostility",
      manual_reply: "Reply from the phone",
    },
  },
  conversions: {
    title: "Conversions",
    won: "Leads that reached the won stage",
    empty: "No conversions in this period yet.",
  },
  trend: {
    title: "Inbound and outbound per day (UTC)",
    inbound: "Inbound",
    outbound: "Outbound",
    empty: "No messages in this period yet.",
    aria: "Messages per day: {{inbound}} inbound and {{outbound}} outbound.",
  },
};
export default messages;
