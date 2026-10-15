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
    namePlaceholder: "seguimiento_cotizacion",
    variableOne: "1 variable: al enviar pedirá su valor.",
    variableMany: "{{count}} variables: al enviar pedirá los {{count}} valores.",
    createError: "No se pudo crear la plantilla",
    submitting: "Enviando a Meta…",
    submit: "Crear y enviar a aprobación",
  },
  whatsapp: {
    forbidden:
      "Solo el propietario o un administrador de la organización gestiona la conexión de WhatsApp.",
    reconnectTitle: "El token de WhatsApp expiró o fue revocado.",
    reconnectBody: "Los envíos están pausados hasta que vuelvas a conectar el número.",
    // 009 — Embedded Signup + coexistence
    coexPoint2: "Puedes compartir hasta 6 meses de chats: entran al CRM como historial, sin despertar a la IA.",
    coexPoint3: "Grupos, mensajes temporales y listas de difusión no pasan al CRM.",
    coexButton: "Conectar con Meta",
    coexConnecting: "Conectando con Meta…",
    coexCancelled: "Conexión cancelada en la ventana de Meta.",
    coexSdkFailed: "No se pudo cargar la ventana de Meta. Revisa bloqueadores de anuncios o el dominio permitido en la app de Meta.",
    coexFailed: "No se pudo completar la conexión.",
    coexSuccess: "Número {{number}} conectado (app + CRM).",
    coexSyncRequested: "Pedimos a Meta la agenda y el historial: llegan en los próximos minutos.",
    coexSyncFailed: "No se pudo pedir la agenda o el historial a Meta: los mensajes nuevos llegan igual.",
    coexKeepAlive: "Recuerda abrir la app WhatsApp Business en el teléfono al menos cada 13 días.",
    disconnectedTitle: "Meta desconectó el número del CRM.",
    disconnectedBody:
      "Suele pasar si la app WhatsApp Business no se abrió en ~14 días, si cambió el teléfono o si se quitó el acceso. Abre la app y vuelve a conectar con Meta.",
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
    originAgency2: " (README). Hoy NO está soportado: con la firma obligatoria haría falta el App Secret de la agencia en este servidor, y ese secreto nunca se comparte.",
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
    signatureLastVerified: "Último evento firmado verificado: {{when}}.",
    signatureNoneVerified:
      "Aún no ha llegado ningún evento firmado verificado desde el último arranque.",
    signatureRejected:
      "{{count}} eventos rechazados desde el arranque (último {{when}}): la firma no es válida — si no llega ninguno verificado, el secreto no coincide con la app que firma.",
    signatureMissing:
      "Falta META_APP_SECRET: la firma es obligatoria, así que el webhook RECHAZA todos los eventos (503) y no llega ningún mensaje a la bandeja. Agrega a la instancia el App Secret de la app de Meta que envía los webhooks (el de tu propia app — el modo agencia con override de callback no está soportado con la firma obligatoria, nunca copies aquí el App Secret de la agencia; detrás de Wapi, el secreto del endpoint) y reinicia.",
    signatureTestMode:
      "Entorno de pruebas (mocks activos): sin META_APP_SECRET se aceptan eventos sin firma. En producción la firma es siempre obligatoria.",
    // 013 — Conexión guiada (3 pasos + franja de estado)
    guide: {
      title: "Conecta WhatsApp en 3 pasos",
      intro:
        "Necesitas el teléfono con la app WhatsApp Business y el acceso a Facebook del negocio. Toma un par de minutos.",
      loadError: "No se pudo cargar el estado de WhatsApp: recarga la página.",
      advanced: "Avanzado",
      advancedHint:
        "Conexión manual (WABA y token), webhook, override de la agencia y clave Wapi. Solo para quien configura la app de Meta.",
      stepState: {
        done: "Hecho",
        current: "Ahora",
        todo: "Después",
        blocked: "Esperando al administrador",
      },
      steps: {
        connect: {
          title: "Conecta el número",
          body: "Pulsa el botón y entra con Facebook: la app WhatsApp Business sigue en el teléfono y funcionando, y los mensajes llegan también aquí.",
          done: "Número {{number}} conectado.",
          reconnectHint: "Hay que volver a conectar el número: usa el botón de arriba.",
          reconnectManualHint: "Hay que volver a conectar el número con un token nuevo: usa el botón de arriba.",
        },
        confirm: {
          title: "Confirma en el teléfono",
          body: "En la ventana de Meta elige el número, confirma desde la app WhatsApp Business del teléfono y toca «Compartir historial».",
        },
        test: {
          title: "Prueba",
          body: "Escribe al número desde otro teléfono: el mensaje aparece aquí y en la Bandeja.",
          waiting: "Esperando el primer mensaje…",
          received: "Último mensaje recibido: {{when}}.",
          openInbox: "Abrir la Bandeja",
        },
      },
      notConfigured: {
        title: "Tu administrador debe completar la configuración de Meta.",
        body: "Mientras tanto, el botón «Conectar con Meta» no aparece.",
        wapi: "Esta instancia usa el gateway Wapi: el número se conecta desde Avanzado.",
        manual: "¿Ya tienes un token? Abre Avanzado.",
      },
      banner: {
        connected: "WhatsApp está conectado: {{number}}.",
        ready: "Todo listo: sigue los 3 pasos de abajo para conectar tu número.",
        reconnectButton: "Reconectar con Meta",
        manualAlternative: "O pega un token nuevo en Avanzado.",
        manualReconnectBody:
          "Este número está conectado a mano (WABA y token): para reconectarlo pega un token nuevo. No lo reconectamos con Meta, para no cambiar su modo.",
        manualReconnectButton: "Pegar un token nuevo",
      },
      status: {
        label: "Estado de WhatsApp",
        number: "Número",
        numberNone: "Ningún número conectado",
        mode: "Modo",
        mode_coexistence: "App + CRM (coexistence)",
        mode_api: "Solo API",
        signature: "Firma del webhook",
        sigVerified: "Verificada {{when}}",
        sig_waiting: "Esperando el primer evento firmado",
        sig_rejected: "Firmas rechazadas: el App Secret no coincide",
        sig_missing: "Falta el App Secret (configuración del servidor)",
        sig_test_mode: "Entorno de pruebas (mocks)",
        lastInbound: "Último mensaje recibido",
        lastInboundNone: "Ninguno todavía",
      },
    },
    wapi: {
      title: "Clave de Wapi de esta organización",
      description:
        "Si tu instancia usa el gateway Wapi, cada organización usa SU propia clave (hlp_live_…). Se guarda cifrada y nunca se vuelve a mostrar: solo ves los últimos 4 caracteres.",
      forbidden:
        "Solo el propietario o un administrador de la organización gestiona la clave de Wapi.",
      gatewayOff:
        "Esta instancia no tiene el gateway Wapi activo (WAPI_BASE_URL): la clave se puede guardar, pero hoy no se usa y todo va directo a Meta.",
      routing: {
        own_key: "Los envíos de esta organización van por Wapi con su clave propia.",
        legacy_global:
          "Modo heredado: esta organización usa la clave global de la instancia. Guarda una clave propia para dejar de depender de ella.",
        blocked:
          "Envíos bloqueados: la instancia tiene varias organizaciones en la lista de Wapi y esta no tiene clave propia. Guarda su clave abajo.",
        direct: "Los envíos de esta organización van directos a Meta.",
      },
      configured: "Clave guardada (…{{last4}})",
      notConfigured: "Sin clave propia",
      keyLabel: "Clave de Wapi",
      keyPlaceholder: "hlp_live_…",
      save: "Guardar clave",
      saving: "Guardando…",
      saved: "Clave guardada ✓",
      saveError: "No se pudo guardar la clave",
      invalidFormat: "La clave debe empezar por hlp_live_",
      remove: "Revocar clave",
      confirmRemove:
        "¿Revocar la clave de Wapi de esta organización? Los envíos por Wapi se detendrán hasta guardar otra.",
      removeError: "No se pudo revocar la clave",
      loadError:
        "No se pudo cargar el estado de la clave de Wapi: recarga la página.",
    },
  },
};
export default messages;
