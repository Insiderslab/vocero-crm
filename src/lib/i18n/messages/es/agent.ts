/** Diccionario ES — agent. Fuente de la forma para en/it. */
const messages = {
  loading: "Cargando…",
  title: "Agente de IA",
  saved: "Guardado ✓",
  statusOn: "Encendido",
  statusOff: "Apagado",
  toggleLabel: "Agente encendido",
  setupTitle: "Configura tu proveedor de IA para activar el agente",
  setupBody1: "Agrega ",
  setupBody2: " y ",
  setupBody3:
    " a las variables de entorno de la instancia y reiníciala. Mientras tanto puedes dejar listo el comportamiento y el conocimiento aquí abajo.",
  behavior: {
    title: "Comportamiento",
    description:
      "Cómo se presenta y actúa el agente al responder a tus clientes.",
    nameLabel: "Nombre del agente",
    toneLabel: "Tono",
    tonePlaceholder: "p. ej. cercano y directo, con usted",
    instructionsLabel: "Instrucciones",
    instructionsPlaceholder: "Qué debe y no debe hacer el agente…",
    escalationLabel: "Reglas de escalado",
    escalationPlaceholder: "Cuándo pasar la conversación a un humano…",
    greetingLabel: "Saludo",
    greetingPlaceholder: "Saludo para conversaciones nuevas",
    save: "Guardar comportamiento",
  },
  kb: {
    title: "Knowledge base",
    description:
      "La única fuente de verdad del agente: lo que no está aquí, no lo afirma.",
    chars: "{{chars}} caracteres",
    warning:
      "El conocimiento se acerca al límite del contexto del modelo (v1 lo inyecta completo en cada turno). Considera depurar entradas.",
    newQa: "Nueva pregunta / respuesta",
    questionPlaceholder: "Pregunta (p. ej. ¿Hacen envíos?)",
    answerPlaceholder: "Respuesta",
    addQa: "Agregar P/R",
    newBlock: "Nuevo bloque de texto libre",
    blockPlaceholder: "Horarios, direcciones, políticas…",
    addBlock: "Agregar bloque",
    removeEntry: "Eliminar entrada",
    empty: "Sin entradas todavía: agrega lo que el agente debe saber.",
  },
};
export default messages;
