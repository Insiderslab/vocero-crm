/** Diccionario ES — página «Síntesis» (dashboard). Fuente de la forma para en/it. */
const messages = {
  title: "Síntesis",
  period: "Período",
  periodDays: "{{days}} días",
  error: "No se pudo cargar la síntesis.",
  retry: "Reintentar",
  stages: {
    title: "Conversaciones por etapa del pipeline",
    empty: "Aún no hay conversaciones en el pipeline.",
    aria: "Conversaciones por etapa: {{items}}.",
  },
  firstResponse: {
    title: "Tiempo de primera respuesta",
    median: "Mediana",
    p90: "Percentil 90",
    minutes: "{{value}} min",
    answered: "{{count}} conversaciones respondidas",
    empty: "Aún no hay respuestas medidas en este período.",
    aria: "Primera respuesta: mediana {{median}} minutos, percentil 90 {{p90}} minutos, sobre {{answered}} conversaciones.",
  },
  outgoing: {
    title: "IA contra persona",
    ai: "de IA",
    human: "de personas",
    aria: "Mensajes salientes: {{ai}} de IA y {{human}} de personas.",
    handoffsTitle: "Pasos a una persona por motivo",
    handoffEmpty: "Sin pasos a una persona en este período.",
    empty: "Aún no hay mensajes salientes en este período.",
    unknownReason: "Sin motivo",
    reason: {
      cliente: "Lo pidió el cliente",
      modelo: "Decisión del modelo",
      error: "Error",
      ventana: "Ventana de 24 h",
      hostilidad: "Hostilidad",
      manual_reply: "Respuesta desde el teléfono",
    },
  },
  conversions: {
    title: "Conversiones",
    won: "Leads que llegaron a la etapa ganada",
    empty: "Aún no hay conversiones en este período.",
  },
  trend: {
    title: "Entrantes y salientes por día (UTC)",
    inbound: "Entrantes",
    outbound: "Salientes",
    empty: "Aún no hay mensajes en este período.",
    aria: "Mensajes por día: {{inbound}} entrantes y {{outbound}} salientes.",
  },
};
export default messages;
