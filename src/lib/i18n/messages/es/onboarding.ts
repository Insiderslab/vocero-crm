/** Diccionario ES — checklist «Primeros pasos». Fuente de la forma para en/it. */
const messages = {
  title: "Primeros pasos",
  description: "Completa estos pasos para llegar a tu primer mensaje con el agente.",
  progress: "{{done}} de {{total}}",
  done: "Hecho",
  pending: "Pendiente",
  reopen: "Ver de nuevo los primeros pasos",
  reopenDescription: "¿Quieres repasar la puesta en marcha?",
  steps: {
    whatsapp: {
      title: "WhatsApp conectado",
      hint: "Conecta tu número en Ajustes → WhatsApp.",
    },
    template: {
      title: "Plantilla aprobada por Meta",
      hint: "Crea una plantilla y espera su aprobación.",
    },
    agent: {
      title: "Agente configurado",
      hint: "Escribe sus instrucciones y carga conocimiento.",
    },
    lab: {
      title: "Evaluación ejecutada",
      hint: "Corre una evaluación en el Laboratorio.",
    },
    enabled: {
      title: "Agente encendido",
      hint: "Enciéndelo en la página del Agente.",
    },
  },
};
export default messages;
