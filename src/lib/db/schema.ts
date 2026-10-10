import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * 005 — Canales previstos (ADR 0001 §3.1). Añadir uno = valor nuevo +
 * adaptador + migración del CHECK.
 */
export const CHANNEL_KINDS = ["whatsapp", "instagram", "messenger", "email"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
const CHANNEL_KINDS_SQL = sql.raw(CHANNEL_KINDS.map((c) => `'${c}'`).join(", "));

/**
 * 008 (custom heili) — Canales de un MENSAJE: los de arriba más `web` (una
 * solicitud del formulario del sitio). Solo el mensaje: `web` no es una
 * cuenta (`channel_account`) ni una identidad (`contact_identity`), porque al
 * sitio no se le responde. drizzle/0015 cambia el CHECK NOT VALID y el runner
 * lo valida (fase B, por nombre).
 */
export const MESSAGE_CHANNELS = [...CHANNEL_KINDS, "web"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
const MESSAGE_CHANNELS_SQL = sql.raw(MESSAGE_CHANNELS.map((c) => `'${c}'`).join(", "));

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Llave de resolución WhatsApp (003): teléfono normalizado (521→52) o
     * `bsuid:<id>` cuando Meta no manda wa_id. Estable de por vida.
     */
    waIdentity: text("wa_identity").notNull(),
    /** Teléfono como ATRIBUTO opcional (003): falta en contactos BSUID. */
    phone: text("phone"),
    /** Business-Scoped User ID si se conoce (003). */
    waUserId: text("wa_user_id"),
    name: text("name").notNull(),
    /**
     * 008 — Email como ATRIBUTO (como `phone`), en minúsculas. NO es una
     * identidad: hasta R3 la única llave es `wa_identity`. Lo escribe la
     * solicitud del sitio; sirve para encontrar al contacto cuando el
     * formulario trae solo el email.
     */
    email: text("email"),
    notes: text("notes"),
    /**
     * Ficha de calificación que levanta un cerebro externo por
     * `PUT /api/bot/ficha`. Es un objeto libre a propósito: los datos que
     * importan de un lead los define cada negocio (una clínica querrá
     * "tratamiento", una constructora "metros"), y cablearlos como columnas
     * obligaría a migrar el CRM cada vez que alguien cambia su cuestionario.
     * Merge campo a campo; `null` explícito borra la clave.
     */
    ficha: jsonb("ficha").$type<Record<string, unknown>>(),
    /**
     * De dónde salió el prospecto. NULL = nadie la capturó, y entonces la API
     * la deduce. Así no hace falta backfill ni marcar en falso los contactos
     * que ya existían.
     */
    source: text("source", {
      // 008: "sito" = llegó por el formulario del sitio web.
      enum: ["anuncio", "organico", "referido", "conocido", "otro", "sito"],
    }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_wa_identity_uq").on(t.organizationId, t.waIdentity),
    index("contact_org_wa_user_id_idx").on(t.organizationId, t.waUserId),
    index("contact_org_name_idx").on(t.organizationId, t.name),
    // 005 (R1) — Destino de las FK compuestas `(organization_id, contact_id)`.
    // Se crea CONCURRENTLY en el runner (fase B), no en drizzle/0013.
    uniqueIndex("contact_org_id_uq").on(t.organizationId, t.id),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    /**
     * Monto de la negociación en CENTAVOS ENTEROS. NULL = nadie lo capturó, que
     * no es lo mismo que cero: un trato sin monto no vale $0, simplemente no se
     * sabe, y el tablero lo dice con palabras en vez de sumar un cero.
     */
    amountCents: integer("amount_cents"),
    /** Moneda del monto; la del negocio al capturarlo (Ajustes → Marca). */
    currency: text("currency"),
    /**
     * Prioridad de cierre. NULL = nadie la ha decidido, que NO es lo mismo que
     * "media": nada la escribe automáticamente, así que el dueño puede confiar
     * en que lo que ve es lo que él puso.
     */
    priority: text("priority", { enum: ["alta", "media", "baja"] }),
    priorityUpdatedAt: timestamp("priority_updated_at"),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

/**
 * Bitácora de movimientos de etapa: append-only. Nada se actualiza ni se borra;
 * corregir un dato es agregar un movimiento nuevo.
 *
 * Es el cimiento de todo lo histórico: sin ella el CRM solo sabe dónde está
 * cada lead HOY, y "¿cuánto cerré en julio?" no tiene respuesta.
 *
 * Regla dura: la ÚNICA puerta que escribe aquí —y que escribe `lead.stage_id`—
 * es `src/server/leads/stage-history.ts`. Un unit test de vigilancia falla si
 * aparece otra escritura, porque un camino que mueva el lead sin registrar el
 * evento no truena: solo hace que las gráficas mientan meses después.
 */
export const leadStageEvent = pgTable(
  "lead_stage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    /** Denormalizado a propósito: casi toda agregación cruza con el contacto,
     *  y el join extra se pagaría en cada consulta. */
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** NULL = el lead nació en `toStage` (evento de creación). */
    fromStageId: text("from_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    fromStageName: text("from_stage_name"),
    toStageId: text("to_stage_id").references(() => pipelineStage.id, {
      onDelete: "set null",
    }),
    /** Snapshots: sobreviven al renombre y al borrado de la etapa, para que
     *  reorganizar el tablero de hoy no reescriba el embudo del pasado. */
    toStageName: text("to_stage_name").notNull(),
    toStageKind: text("to_stage_kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    /** Cuándo PASÓ (no cuándo se registró). */
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    /** NULL = no lo movió una persona (bot, sistema, migración). */
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source", {
      enum: ["dueno", "bot", "sistema", "migracion"],
    })
      .notNull()
      .default("dueno"),
    /** true = fecha SEMBRADA en la migración, no observada. Cuenta para los
     *  totales pero jamás para promedios de tiempo. */
    approximate: boolean("approximate").notNull().default(false),
    lossReason: text("loss_reason", {
      enum: [
        "precio",
        "no_es_perfil",
        "sin_presupuesto",
        "eligio_otro",
        "nunca_contesto",
        "otro",
      ],
    }),
    lossNote: text("loss_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lse_org_occurred_idx").on(t.organizationId, t.occurredAt),
    index("lse_lead_occurred_idx").on(t.leadId, t.occurredAt),
    index("lse_org_kind_occurred_idx").on(
      t.organizationId,
      t.toStageKind,
      t.occurredAt
    ),
    // Perder un trato sin motivo es imposible a nivel de BASE, no por
    // disciplina de cada ruta. La excepción es la siembra de la migración: no
    // puede inventar un motivo que nadie capturó.
    check(
      "lse_loss_reason_ck",
      sql`${t.toStageKind} <> 'lost' OR ${t.approximate} = true OR ${t.lossReason} IS NOT NULL`
    ),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      // 008: manual_reply = el dueño respondió desde la app del teléfono.
      // hostilidad = el lead se puso agresivo y el agente se retiró.
      enum: [
        "cliente",
        "modelo",
        "error",
        "ventana",
        "hostilidad",
        "manual_reply",
      ],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    /**
     * 005 (R1) — Cuenta de canal de la conversación. NULL en el Laboratorio
     * (`is_test`, simula WhatsApp) y si la organización no tiene cuenta.
     * R1 la escribe y no la lee (ADR 0001 §3.2).
     */
    channelAccountId: text("channel_account_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
    // 005 — Una conversación solo puede apuntar a una cuenta de SU
    // organización. NO ACTION (no RESTRICT): el borrado en cascada de la
    // organización no depende del orden. drizzle/0013 la crea NOT VALID; el
    // runner la valida (fase B).
    foreignKey({
      name: "conversation_channel_account_fk",
      columns: [t.organizationId, t.channelAccountId],
      foreignColumns: [channelAccount.organizationId, channelAccount.id],
    }),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** ID de WhatsApp — UNIQUE (idempotencia). Nullable en salientes de prueba. */
    waMessageId: text("wa_message_id").unique(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /**
     * 008 — Origen del saliente: IA (bot), operador del CRM, manual desde la
     * app de WhatsApp Business del teléfono (echo), o plantilla. En entrantes
     * queda el default y la UI lo ignora.
     */
    origin: text("origin", {
      enum: ["ai", "operator", "manual", "template"],
    })
      .notNull()
      .default("operator"),
    /** 008 — Adjunto del mensaje (imagen, doc, ubicación…), si lo hay. */
    mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * 005 (R1) — Canal del mensaje. R1 lo escribe; lo lee solo el agente
     * (008) para no contestar por WhatsApp a una solicitud `web`.
     */
    channel: text("channel", { enum: MESSAGE_CHANNELS })
      .notNull()
      .default("whatsapp"),
    /**
     * 005 (R1) — ID del proveedor (WhatsApp: = wa_message_id). NULL en el
     * Laboratorio y en los fallidos antes del envío. En R3 su índice por
     * organización pasa a ser el árbitro de la idempotencia.
     */
    externalMessageId: text("external_message_id"),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
    // 005 — drizzle/0013 crea el CHECK NOT VALID y el runner lo valida; el
    // índice se crea CONCURRENTLY en el runner (fase B), no en drizzle/0013.
    check("message_channel_ck", sql`${t.channel} in (${MESSAGE_CHANNELS_SQL})`),
    uniqueIndex("message_org_channel_ext_uq").on(
      t.organizationId,
      t.channel,
      t.externalMessageId
    ),
  ]
);

/**
 * 008 — Adjuntos: archivo (imagen/video/audio/documento/sticker) copiado al
 * volumen local (`MEDIA_DIR`) o contenido estructurado (location/contacts) en
 * `payload`. Meta expira sus archivos (~30 días): el disco propio es la
 * fuente durable (constitución II: sin S3/R2).
 */
export const mediaAsset = pgTable(
  "media_asset",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
      ],
    }).notNull(),
    /** media id de Graph (entrantes/salientes subidos); NULL en location/contacts. */
    waMediaId: text("wa_media_id"),
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    caption: text("caption"),
    /** location {latitude, longitude, name?, address?} o contacts (subset). */
    payload: jsonb("payload"),
    /** Ruta relativa dentro de MEDIA_DIR; NULL si aún no descargado o no aplica. */
    storagePath: text("storage_path"),
    fetchStatus: text("fetch_status", {
      enum: ["available", "pending", "failed"],
    })
      .notNull()
      .default("pending"),
    fetchError: text("fetch_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("media_asset_org_idx").on(t.organizationId, t.createdAt),
    index("media_asset_wa_media_idx").on(t.waMediaId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    /**
     * 009 — Cómo se conectó: a mano en el wizard (`manual`), con el Embedded
     * Signup (`embedded`) o con el Embedded Signup sobre el número de la app
     * WhatsApp Business del teléfono (`coexistence`).
     */
    onboardingMode: text("onboarding_mode", {
      enum: ["manual", "embedded", "coexistence"],
    })
      .notNull()
      .default("manual"),
    /**
     * 009 — Meta avisó (account_update) que la coexistence se cortó: el número
     * salió de la API (app sin abrir ~14 días, cambio de teléfono o partner
     * removido). NULL = activa. Se limpia con ACCOUNT_RECONNECTED o al
     * reconectar.
     */
    appDisconnectedAt: timestamp("app_disconnected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

/**
 * 005 (R1, ADR 0001 §3.2) — Cuenta de un canal conectada por una organización
 * (≈ channel + inbox de Chatwoot). En R1 y R2 es una COPIA de
 * `meta_credentials` (doble escritura + reconciliación al arrancar); la
 * fuente de verdad sigue siendo `meta_credentials` hasta R3.
 */
export const channelAccount = pgTable(
  "channel_account",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    /** WA phone_number_id · IG user_id · ID de Página · dirección de email. */
    externalAccountId: text("external_account_id").notNull(),
    /** WA waba_id (eventos de plantillas). */
    externalParentId: text("external_parent_id"),
    displayName: text("display_name"),
    verifiedName: text("verified_name"),
    /** Token cifrado con lib/crypto (mismo formato que meta_credentials.token_*). */
    secretCipher: text("secret_cipher"),
    secretIv: text("secret_iv"),
    secretTag: text("secret_tag"),
    secretExpiresAt: timestamp("secret_expires_at"),
    status: text("status", {
      enum: ["connected", "reconnect_required", "expiring", "disconnected"],
    })
      .notNull()
      .default("connected"),
    /**
     * Datos del canal NO secretos. WhatsApp (009, coexistence):
     * `{ onboardingMode, appDisconnectedAt }`, copiados de meta_credentials
     * por la función SQL `channels_legacy_wa_config` (única fuente del
     * formato: la fecha va como en `to_jsonb(timestamp)`, sin zona = UTC).
     */
    config: jsonb("config").$type<Record<string, unknown>>(),
    /** Rastro del backfill (fila de meta_credentials copiada). Se quita en R3. */
    legacyMetaCredentialsId: text("legacy_meta_credentials_id").unique(
      "channel_account_legacy_meta_credentials_id_unique"
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Guardia de aislamiento del enrutamiento: dos organizaciones no pueden
    // reclamar el mismo número/cuenta (hoy meta_credentials_phone_uq).
    uniqueIndex("channel_account_channel_ext_uq").on(t.channel, t.externalAccountId),
    // M1: una cuenta por canal y organización (D4).
    uniqueIndex("channel_account_org_channel_uq").on(t.organizationId, t.channel),
    index("channel_account_channel_parent_idx").on(t.channel, t.externalParentId),
    // Destino de las FK compuestas (organization_id, channel_account_id).
    uniqueIndex("channel_account_org_id_uq").on(t.organizationId, t.id),
    check("channel_account_channel_ck", sql`${t.channel} in (${CHANNEL_KINDS_SQL})`),
    check(
      "channel_account_status_ck",
      sql`${t.status} in ('connected', 'reconnect_required', 'expiring', 'disconnected')`
    ),
    check(
      "channel_account_secret_ck",
      sql`(${t.secretCipher} is null) = (${t.secretIv} is null) and (${t.secretIv} is null) = (${t.secretTag} is null)`
    ),
  ]
);

/**
 * 005 (R1, ADR 0001 §3.2) — Identidad de un contacto en un canal (≈
 * contact_inboxes de Chatwoot). WhatsApp: `external_id` = `wa_identity`, una
 * por contacto (D5). La FK compuesta impide apuntar a un contacto de otra
 * organización incluso por un error del código.
 */
export const contactIdentity = pgTable(
  "contact_identity",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull(),
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    externalId: text("external_id").notNull(),
    /** Solo para IDs con ámbito de cuenta (IGSID, PSID); NULL en WhatsApp. */
    channelAccountId: text("channel_account_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // El runner la crea (fase B) cuando existe contact_org_id_uq.
    foreignKey({
      name: "contact_identity_contact_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contact.organizationId, contact.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "contact_identity_channel_account_fk",
      columns: [t.organizationId, t.channelAccountId],
      foreignColumns: [channelAccount.organizationId, channelAccount.id],
    }),
    uniqueIndex("contact_identity_org_channel_ext_uq").on(
      t.organizationId,
      t.channel,
      t.externalId
    ),
    index("contact_identity_org_contact_idx").on(t.organizationId, t.contactId),
    check("contact_identity_channel_ck", sql`${t.channel} in (${CHANNEL_KINDS_SQL})`),
  ]
);

/**
 * C3 — Clave del gateway Wapi POR organización (bearer `hlp_live_…`). Cifrada
 * en reposo con la misma ENCRYPTION_KEY que el token Meta (AES-256-GCM); solo
 * se guardan los últimos 4 caracteres en claro para mostrarlos en la UI. Una
 * fila por organización; revocar = `revoked_at` (la fila se conserva como
 * rastro, el cifrado sigue ahí pero ya no se usa para enrutar).
 */
export const wapiCredentials = pgTable(
  "wapi_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    keyCipher: text("key_cipher").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    keyLast4: text("key_last4").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("wapi_credentials_org_uq").on(t.organizationId)]
);

/**
 * Claves de servicio POR organización (custom heili.cloud): `/api/bot/*`
 * (scope "bot", `vbk_…`), `/api/export/*` (scope "export", `vex_…`, C2) y el
 * formulario del sitio `/api/public/site-requests` (scope "site", `vsk_…`, 008).
 * El nombre de la tabla es histórico (C1).
 * Solo se guarda el SHA-256 de la clave (alta entropía): el texto plano se
 * muestra una única vez al crearla. La organización se deriva SIEMPRE de la
 * clave, nunca de una elección implícita de la instancia.
 */
export const botApiKey = pgTable(
  "bot_api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // Ámbito de la clave (C2): "bot" (/api/bot/*) o "export" (/api/export/*).
    scope: text("scope", { enum: ["bot", "export", "site"] }).notNull().default("bot"),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("bot_api_key_hash_uq").on(t.keyHash),
    index("bot_api_key_org_idx").on(t.organizationId, t.createdAt),
    // 008 — Una sola clave del sitio ACTIVA por organización, garantizado por
    // la base de datos (además del lock de la rotación).
    uniqueIndex("bot_api_key_site_active_uq")
      .on(t.organizationId)
      .where(sql`${t.scope} = 'site' and ${t.revokedAt} is null`),
  ]
);

/**
 * 008 — Configuración del formulario del sitio, una fila por organización.
 * Hoy solo las origenes autorizadas (CORS), en forma canónica `URL.origin`.
 * La clave vive en `bot_api_key` (scope "site"): una activa por organización.
 */
export const siteRequestConfig = pgTable(
  "site_request_config",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("site_request_config_org_uq").on(t.organizationId)]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    /**
     * 007 — Acceso reservado (asistente interno del equipo): con el flag
     * encendido el agente SOLO atiende a las identidades de la lista
     * (teléfonos normalizados como `wa_identity`); al resto, como mucho,
     * `outsider_reply` una vez por conversación. Apagado = comportamiento
     * de siempre.
     */
    restrictToAllowlist: boolean("restrict_to_allowlist").notNull().default(false),
    allowedIdentities: text("allowed_identities")
      .array()
      .notNull()
      .default(sql`'{}'`),
    outsiderReply: text("outsider_reply"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * Custom heili.cloud: tags, extracción y automatizaciones
 * ============================================================ */

/** Etiqueta libre de contactos (por org). La usan la UI y las reglas. */
export const tag = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Hex opcional (#rrggbb) para el chip; null = color neutro. */
    color: text("color"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tag_org_name_uq").on(t.organizationId, t.name),
    index("tag_org_idx").on(t.organizationId),
  ]
);

/** Asignación N:M contacto ↔ tag. Cascada en ambos lados a propósito. */
export const contactTag = pgTable(
  "contact_tag",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_tag_uq").on(t.contactId, t.tagId),
    index("contact_tag_org_tag_idx").on(t.organizationId, t.tagId),
    index("contact_tag_org_contact_idx").on(t.organizationId, t.contactId),
  ]
);

/**
 * Regla de automatización: a los contactos con `tagId`, cada `intervalDays`
 * días, enviar la plantilla aprobada `templateId`. Fuera de la ventana de
 * 24 h Meta solo permite plantillas — por eso la acción es siempre plantilla.
 */
export const automationRule = pgTable(
  "automation_rule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),
    intervalDays: integer("interval_days").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("automation_rule_org_idx").on(t.organizationId)]
);

/**
 * Bitácora del motor: solo se registran envíos logrados y fallos (los saltos
 * por ventana abierta son efímeros y llenarían la tabla de ruido). El último
 * `sent` por (regla, contacto) es lo que alimenta la cadencia de N días.
 */
export const automationRun = pgTable(
  "automation_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["sent", "failed", "skipped"] }).notNull(),
    /** Mensaje de error cuando status = failed. */
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("automation_run_rule_contact_idx").on(
      t.ruleId,
      t.contactId,
      t.createdAt
    ),
    index("automation_run_org_idx").on(t.organizationId, t.createdAt),
  ]
);

/* ============================================================
 * 009 — Coexistence: agenda de la app WhatsApp Business
 * ============================================================ */

/**
 * Nombres de la agenda del teléfono que Meta sincroniza (`smb_app_state_sync`).
 * Tabla aparte a propósito: la agenda trae amigos y familia, y crear un
 * contacto del CRM por cada entrada llenaría el pipeline de no-prospectos.
 * Solo sirve para poner nombre a un contacto cuando ya existe o cuando escribe.
 */
export const waAddressBookEntry = pgTable(
  "wa_address_book_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Teléfono normalizado (misma llave que contact.wa_identity). */
    waIdentity: text("wa_identity").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wa_address_book_org_identity_uq").on(
      t.organizationId,
      t.waIdentity
    ),
  ]
);
