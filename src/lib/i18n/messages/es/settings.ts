/** Diccionario ES — pantallas de configuración. Fuente de la forma para en/it. */
const messages = {
  title: "Configuración",
  tabs: {
    whatsapp: "WhatsApp",
    branding: "Marca",
    templates: "Plantillas",
    team: "Equipo",
    apiKeys: "Claves de API",
  },
  branding: {
    title: "Marca del CRM",
    description:
      "Este CRM es tuyo: ponle el nombre de tu negocio y tu color. Se reflejan en toda la interfaz y en la pantalla de inicio de sesión.",
    currencyLabel: "Moneda del negocio",
    currencyHelp:
      "Es la única que el Pipeline suma. Los montos capturados en otra moneda se muestran, pero quedan fuera del total de su columna.",
    accentLabel: "Color de acento",
    accentHelp:
      "Con un color personalizado, los tonos derivados (hover, fondos suaves) se calculan solos y se ajusta el contraste.",
    preset: {
      azulAcero: "Azul acero",
      grafito: "Grafito",
      verdeApagado: "Verde apagado",
      ciruela: "Ciruela",
    },
    custom: "Personalizado",
    previewButton: "Botón de ejemplo",
    saveError: "No se pudo guardar",
    saved: "Marca guardada ✓",
    submit: "Guardar marca",
  },
  favicon: {
    title: "Icono de la pestaña",
    previewAlt: "Vista previa del icono de la pestaña",
    own: "Logo propio",
    ownHelp: "Reemplaza al generado. Puedes quitarlo para volver a él.",
    generated: "Generado con tu marca",
    generatedHelp:
      "La inicial sobre tu color de acento. Sube un logo para reemplazarlo.",
    tooBig: "El icono no puede pasar de {{kb}} KB.",
    uploadError: "No se pudo subir el icono",
    removeError: "No se pudo quitar el icono",
    uploading: "Subiendo…",
    change: "Cambiar logo",
    upload: "Subir logo",
    remove: "Quitar",
    formats:
      "PNG, SVG, ICO, JPEG o WebP, hasta {{kb}} KB. Cuadrado se ve mejor.",
  },
  team: {
    title: "Crear cuenta de equipo",
    description:
      "Sin correos ni invitaciones: comparte tú mismo la contraseña temporal con tu compañero (se muestra UNA sola vez).",
    createError: "No se pudo crear la cuenta",
    created: "Cuenta creada ✓",
    shareNow: "Comparte estos datos ahora (no se volverán a mostrar):",
    passwordPrefix: "contraseña",
    submit: "Crear cuenta",
    membersTitle: "Miembros",
    owner: "Propietario",
    member: "Miembro",
  },
  apiKeys: {
    forbidden:
      "Solo el propietario o un administrador de la organización gestiona las claves de API.",
    bot: {
      title: "Claves del bot (vbk_)",
      description:
        "Para el cerebro externo que usa /api/bot/*. Cada clave vale solo para esta organización.",
    },
    export: {
      title: "Claves de extracción (vex_)",
      description:
        "Para scripts y automatizaciones de solo lectura sobre /api/export/*. Cada clave vale solo para esta organización.",
    },
    labelLabel: "Nombre de la clave",
    labelPlaceholder: "p. ej. bot de producción, n8n",
    submit: "Crear clave",
    createError: "No se pudo crear la clave",
    created: "Clave «{{label}}» creada ✓",
    shareNow:
      "Cópiala ahora: no se volverá a mostrar. Guárdala en el gestor de secretos del servicio que la usará.",
    copy: "Copiar clave",
    copied: "Copiada ✓",
    hide: "Ocultar",
    listError:
      "No se pudo cargar la lista de claves: recarga la página. Puede haber claves activas.",
    empty: "Aún no hay claves de este tipo.",
    createdAt: "creada {{date}}",
    lastUsed: "último uso {{date}}",
    neverUsed: "sin uso",
    revoke: "Revocar",
    revoked: "Revocada",
    confirmRevoke:
      "¿Revocar la clave «{{label}}»? El servicio que la usa dejará de funcionar de inmediato.",
    revokeError: "No se pudo revocar la clave",
  },
  templates: {
    intro:
      "Las plantillas permiten reabrir conversaciones con la ventana de 24 h cerrada. Meta las aprueba en horas o días y puede reclasificar la categoría (lo que cambia el costo por conversación). Esta pantalla consulta el estado a Meta cada vez que la abres; Sincronizar fuerza la consulta sin recargar.",
    sync: "Sincronizar",
    syncUpdated: "{{count}} plantilla(s) actualizada(s)",
    syncUpToDate: "Todo al día",
    syncError: "No se pudo sincronizar",
    rejectionReason: "Razón del rechazo: {{reason}}",
    empty:
      "Sin plantillas todavía. Crea la primera arriba — por ejemplo un «seguimos disponibles, ¿retomamos tu cotización?» para conversaciones frías.",
    status: {
      draft: "Borrador",
      pending: "Pendiente de Meta",
      approved: "Aprobada",
      rejected: "Rechazada",
    },
    createTitle: "Nueva plantilla",
    createIntro1: "Cuerpo con las variables que necesites: numéralas ",
    createIntro2:
      "… en orden y sin saltos. Se envía a aprobación de Meta al crearla.",
    languageLabel: "Idioma",
    categoryLabel: "Categoría",
    utilityOption: "UTILITY (seguimiento)",
    bodyLabel: "Cuerpo",
    bodyPlaceholder: "Hola {{1}}, te confirmo tu sesión el {{2}} a las {{3}}.",
    variableOne: "1 variable: al enviar pedirá su valor.",
    variableMany: "{{count}} variables: al enviar pedirá los {{count}} valores.",
    createError: "No se pudo crear la plantilla",
    submitting: "Enviando a Meta…",
    submit: "Crear y enviar a aprobación",
  },
  whatsapp: {
    reconnectTitle: "El token de WhatsApp expiró o fue revocado.",
    reconnectBody:
      "Los envíos están pausados. Pega un token nuevo abajo y prueba la conexión para reconectar.",
    connectedNumber: "Número conectado: {{number}}",
    tokenTail: "token …{{last4}}",
    connected: "Conectado",
    titleReconnect: "Reconectar / actualizar el número",
    titleConnect: "Conectar tu número de WhatsApp",
    connectDescription:
      "Pega las credenciales de WhatsApp Cloud API. El token se valida contra Meta ANTES de guardarse y se almacena cifrado.",
    originTitle: "¿De dónde sale el token?",
    originDirectTitle: "Modo directo",
    originDirect1: "El negocio tiene su propia app en ",
    originDirect2: ": usa un token de ",
    originSystemUser: "usuario del sistema",
    originDirect3:
      " (no expira) con permisos de WhatsApp. En este modo conviene configurar también el App Secret para la firma del webhook.",
    originAgencyTitle: "Modo agencia (Tech Provider)",
    originAgency1:
      "Tu agencia hace el Embedded Signup en SU plataforma y su backend obtiene el token del cliente; te lo entrega para pegarlo aquí. El webhook se conecta con el ",
    originAgencyWaba: "override por WABA",
    originAgency2: " (checklist de 5 pasos en el README).",
    wabaPlaceholder: "ID de la cuenta de WhatsApp Business",
    phoneIdPlaceholder: "ID del número de teléfono",
    tokenLabel: "Token de acceso",
    tokenPlaceholderSaved:
      "Guardado (…{{last4}}) — pega uno nuevo para cambiarlo",
    tokenValid: "✓ Token válido para {{display}}. Ya puedes guardar.",
    noServer: "Sin conexión con el servidor",
    validationFailed: "La validación falló",
    saveError: "No se pudo guardar la conexión",
    testing: "Probando…",
    test: "Probar conexión",
    save: "Guardar conexión",
    webhookTitle: "Webhook de WhatsApp",
    webhookDesc1:
      "Pega estos valores en el panel de Meta (modo directo) o úsalos en el override de tu backend de agencia (a nivel WABA). ",
    webhookDescStrong: "Guarda la conexión ANTES de configurar el webhook:",
    webhookDesc2:
      " la verificación (handshake) funciona sin guardar, pero los mensajes solo se reciben si la conexión está guardada — se enrutan por tu Phone Number ID.",
    httpsWarning:
      "La URL configurada no es https: Meta exige https para los webhooks. Ajusta APP_BASE_URL con tu dominio público.",
    urlLabel: "URL del webhook (callback URL)",
    copyUrl: "Copiar URL",
    copiedUrl: "Copiada ✓",
    urlHelp:
      "La URL contiene el token secreto en la ruta: trátala como una contraseña.",
    copyToken: "Copiar verify token",
    copiedToken: "Copiado ✓",
    signatureActive:
      "Verificación de firma activa (META_APP_SECRET configurado): cada evento se valida con x-hub-signature-256.",
    signatureInactive:
      "Sin App Secret configurado: el webhook queda protegido por la URL secreta (normal en modo agencia). Para la capa extra de firma, agrega META_APP_SECRET a la instancia.",
  },
};
export default messages;
