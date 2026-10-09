import type { LegalMessages } from "@/lib/legal";

/**
 * Páginas públicas: privacidad, términos, eliminación de datos. BORRADOR a
 * revisar con un abogado antes del lanzamiento comercial (nota en
 * docs/lavoro/2026-10-10-app-review.md, no en la página). {{entity}},
 * {{email}} y {{product}} se rellenan con legalContext().
 */
const legal: LegalMessages = {
  chrome: {
    skipToContent: "Saltar al contenido",
    lastUpdated: "Última actualización",
    nav: "Información legal",
    privacy: "Política de privacidad",
    terms: "Términos del servicio",
    deletion: "Eliminación de datos",
    login: "Acceso",
  },
  privacy: {
    title: "Política de privacidad",
    summary:
      "Cómo {{product}} trata los datos de las cuentas de usuario y de las conversaciones de WhatsApp, Instagram y Messenger que las empresas gestionan con el servicio.",
    sections: [
      {
        title: "1. Quién es el responsable",
        body: [
          "{{product}} es un CRM de mensajería para empresas, ofrecido por {{entity}} («nosotros»). Contacto para cualquier asunto de privacidad: {{email}}.",
          "Hay dos tipos de datos con papeles distintos. De los datos de las cuentas de usuario (quien entra en el CRM) somos responsables del tratamiento. De los datos de las personas que escriben a una empresa por WhatsApp, Instagram o Messenger, el responsable es la empresa cliente que usa {{product}}; nosotros actuamos como encargados del tratamiento y solo seguimos sus instrucciones.",
        ],
        list: [],
      },
      {
        title: "2. Qué datos tratamos",
        body: ["Según el uso que haga cada empresa:"],
        list: [
          "Usuarios del CRM: nombre, correo electrónico, contraseña (guardada solo como huella cifrada, nunca en claro), rol dentro de la empresa y datos de sesión (dirección IP y navegador).",
          "Contactos y conversaciones: nombre del contacto, identificador del canal (número de WhatsApp o identificador de usuario que asigna Meta), contenido de los mensajes, archivos adjuntos, fecha y estado de entrega.",
          "Datos que la propia empresa añade: notas, etiquetas, etapas del embudo comercial y fichas de calificación.",
          "Conexión con Meta: identificadores de la cuenta de empresa conectada (por ejemplo, WhatsApp Business y número de teléfono) y la credencial de acceso que Meta concede a la empresa. La credencial se guarda cifrada y nunca se muestra completa.",
        ],
      },
      {
        title: "3. Para qué los usamos",
        body: [
          "Solo para prestar el servicio que la empresa ha contratado: recibir los mensajes de sus clientes, permitirle responder, organizar contactos y oportunidades, y mantener la seguridad y el buen funcionamiento de la plataforma.",
          "Base jurídica: la ejecución del contrato con la empresa cliente, nuestro interés legítimo en la seguridad del servicio y, para los datos de sus clientes finales, la base que la empresa responsable haya establecido (por ejemplo, el consentimiento o la relación contractual).",
        ],
        list: [],
      },
      {
        title: "4. Con quién compartimos los datos",
        body: ["No vendemos datos ni los usamos para publicidad. Solo intervienen estos terceros:"],
        list: [
          "Meta Platforms (WhatsApp, Instagram, Facebook Messenger): por los canales que la empresa conecta, recibimos y enviamos mensajes a través de sus interfaces oficiales.",
          "Proveedor de infraestructura y alojamiento: donde se ejecutan la aplicación y la base de datos, que actúa como encargado.",
          "Proveedor de modelos de lenguaje (compatible con OpenRouter): solo si la empresa activa el agente de IA, el contenido de las conversaciones necesario para redactar una respuesta se envía a ese proveedor. Si la empresa no lo activa, ningún contenido sale hacia IA.",
        ],
      },
      {
        title: "5. Datos recibidos de Meta",
        body: [
          "Los datos que llegan a través de las API de Meta se usan únicamente para las funciones que la empresa ha pedido (recibir y responder mensajes y administrar sus contactos). No se venden, no se usan para publicidad ni para elaborar perfiles ajenos al servicio, y no se transfieren a terceros salvo los encargados indicados arriba.",
        ],
        list: [],
      },
      {
        title: "6. Cuánto tiempo los conservamos",
        body: [
          "Conservamos los datos mientras la cuenta de la empresa esté activa. Al terminar el contrato, o cuando se recibe una solicitud de eliminación válida, los borramos en los plazos descritos en la página de eliminación de datos. Algunos datos pueden conservarse más tiempo solo si una ley lo exige.",
        ],
        list: [],
      },
      {
        title: "7. Seguridad",
        body: [
          "Cada empresa ve únicamente sus propios datos: el acceso está separado por organización. Las credenciales de los canales se cifran en reposo y las comunicaciones usan HTTPS. Ninguna medida es infalible; si detectamos una violación de datos que te afecte, actuaremos y la comunicaremos como exige la ley.",
        ],
        list: [],
      },
      {
        title: "8. Tus derechos",
        body: [
          "Puedes pedir acceso, rectificación, eliminación, limitación u oposición al tratamiento, y portabilidad de tus datos, y presentar una reclamación ante la autoridad de protección de datos de tu país (en Italia, el Garante per la protezione dei dati personali). Si eres cliente final de una empresa, dirige primero la solicitud a esa empresa; si nos escribes a {{email}} se la trasladaremos. Para pedir la eliminación sigue la página «Eliminación de datos».",
        ],
        list: [],
      },
      {
        title: "9. Cookies",
        body: [
          "Usamos solo cookies técnicas: la sesión de acceso y tus preferencias de idioma y tema. No usamos cookies de publicidad ni de analítica de terceros.",
        ],
        list: [],
      },
      {
        title: "10. Cambios",
        body: [
          "Si cambiamos esta política, publicaremos la nueva versión en esta página con su fecha de actualización.",
        ],
        list: [],
      },
    ],
  },
  terms: {
    title: "Términos del servicio",
    summary:
      "Condiciones de uso de {{product}}, el CRM de mensajería para WhatsApp, Instagram y Messenger.",
    sections: [
      {
        title: "1. Objeto",
        body: [
          "{{product}} es un servicio de {{entity}} que permite a una empresa recibir y gestionar conversaciones de sus clientes por WhatsApp, Instagram y Messenger, organizar contactos y oportunidades y, si lo activa, apoyarse en un agente de IA. Al usarlo aceptas estos términos en nombre propio y de la empresa que representas.",
        ],
        list: [],
      },
      {
        title: "2. Cuentas",
        body: [
          "El acceso es por invitación o alta autorizada. Eres responsable de custodiar tus credenciales y de lo que se haga con tu cuenta. Debes tener capacidad para obligar a la empresa que representas.",
        ],
        list: [],
      },
      {
        title: "3. Canales y plataformas de terceros",
        body: [
          "Conectas tus propias cuentas de empresa de Meta. Te obligas a cumplir los términos y políticas de Meta aplicables, en particular los de WhatsApp Business y de la plataforma de Meta. Meta puede limitar, suspender o cambiar sus servicios y la ventana de 24 horas o las plantillas de mensajes; no controlamos esas decisiones y no respondemos por ellas.",
        ],
        list: [],
      },
      {
        title: "4. Responsabilidad sobre tus comunicaciones",
        body: ["Eres el responsable de tus conversaciones y, en particular, debes:"],
        list: [
          "contar con una base jurídica válida y, cuando corresponda, el consentimiento previo de las personas a las que escribes por mensajería;",
          "informar a tus clientes de cómo tratas sus datos;",
          "enviar solo mensajes legítimos y respetar las bajas y oposiciones.",
        ],
      },
      {
        title: "5. Uso aceptable",
        body: ["Queda prohibido usar el servicio para:"],
        list: [
          "enviar spam, mensajes engañosos o masivos sin consentimiento;",
          "contenido ilegal, abusivo, discriminatorio o que vulnere derechos de terceros;",
          "intentar acceder a datos de otras organizaciones, saltarse controles de seguridad o sobrecargar el servicio;",
          "revender el acceso sin acuerdo escrito.",
        ],
      },
      {
        title: "6. Agente de IA",
        body: [
          "El agente de IA es opcional y lo activa y supervisa la empresa. Sus respuestas pueden ser incorrectas o incompletas: tú decides cuándo usarlo, puedes pasar una conversación a una persona y eres responsable de lo que se envía a tus clientes.",
        ],
        list: [],
      },
      {
        title: "7. Datos personales",
        body: [
          "Para los datos de tus clientes finales eres el responsable del tratamiento y nosotros somos el encargado, según la política de privacidad. Si lo necesitas, podemos firmar un acuerdo de encargo de tratamiento.",
        ],
        list: [],
      },
      {
        title: "8. Disponibilidad y garantías",
        body: [
          "Procuramos que el servicio funcione de forma continua, pero se ofrece «tal cual», sin garantía de disponibilidad ininterrumpida ni de que esté libre de errores ni de que los servicios de terceros funcionen.",
        ],
        list: [],
      },
      {
        title: "9. Responsabilidad",
        body: [
          "En la medida permitida por la ley, no respondemos de daños indirectos ni de lucro cesante, ni de fallos de plataformas de terceros. Nada de lo anterior limita la responsabilidad que la ley no permita limitar.",
        ],
        list: [],
      },
      {
        title: "10. Suspensión y terminación",
        body: [
          "Puedes dejar de usar el servicio cuando quieras. Podemos suspender una cuenta que incumpla estos términos o ponga en riesgo la seguridad. Al terminar, tus datos se tratan como se indica en la política de privacidad y en la página de eliminación de datos.",
        ],
        list: [],
      },
      {
        title: "11. Cambios y ley aplicable",
        body: [
          "Podemos actualizar estos términos y publicaremos la nueva versión aquí. Se rigen por la ley italiana, sin perjuicio de los derechos imperativos que te correspondan según tu país. Contacto: {{email}}.",
        ],
        list: [],
      },
    ],
  },
  deletion: {
    title: "Eliminación de datos",
    summary:
      "Cómo pedir que eliminemos tus datos de {{product}}, y cómo retirar el acceso que diste desde Facebook, Instagram o WhatsApp.",
    sections: [
      {
        title: "1. Cómo pedirlo",
        body: [
          "Escribe a {{email}} con el asunto «Eliminación de datos» e indica quién eres (tu nombre y el canal por el que usaste el servicio: número de WhatsApp, cuenta de Instagram o Facebook, o correo de tu cuenta) y qué quieres eliminar. No envíes contraseñas ni credenciales: no las necesitamos.",
          "Tratamos las solicitudes manualmente. Para proteger tus datos podemos pedirte una confirmación de identidad antes de borrar nada.",
        ],
        list: [],
      },
      {
        title: "2. Si escribiste a una empresa",
        body: [
          "Si eres cliente final de una empresa que usa {{product}}, esa empresa es la responsable de tus datos. Puedes pedírselo directamente; si nos escribes a nosotros, le trasladaremos la solicitud y la atenderemos por instrucción suya.",
        ],
        list: [],
      },
      {
        title: "3. Si conectaste una cuenta de Meta",
        body: [
          "Puedes retirar en cualquier momento el acceso que diste a {{product}} desde tu cuenta de Facebook (integraciones de empresa o aplicaciones y sitios web) o de Instagram (aplicaciones y sitios web); los nombres exactos de los menús pueden variar. Al retirarlo dejamos de poder recibir y enviar mensajes por esa cuenta. Los datos ya guardados no se borran solos: pide su eliminación como se explica arriba.",
        ],
        list: [],
      },
      {
        title: "4. Qué eliminamos",
        body: ["Al aceptar una solicitud eliminamos, según su alcance:"],
        list: [
          "el contacto, sus conversaciones, mensajes y archivos adjuntos;",
          "las notas, etiquetas y oportunidades asociadas;",
          "la cuenta de usuario y las credenciales de los canales conectados, si se cierra la cuenta de la empresa.",
        ],
      },
      {
        title: "5. Plazos y excepciones",
        body: [
          "Confirmamos la recepción y completamos la eliminación en un máximo de 30 días. Podemos conservar lo estrictamente necesario si una ley lo exige o para defender derechos en un procedimiento; en ese caso te lo explicaremos. Las copias de seguridad se eliminan al cumplirse su ciclo de conservación.",
        ],
        list: [],
      },
    ],
  },
};

export default legal;
