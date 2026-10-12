import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 010 — agregados de la página «Sintesi» (specs/custom-heili/010-sintesi-e-primo-avvio.md).
 *
 * Solo lectura y solo la organización recibida: cada consulta combina sus
 * condiciones con `scoped(...)`. Las cinco corren en paralelo y agregan en SQL
 * (GROUP BY / percentile_cont): jamás se cargan mensajes en memoria.
 *
 * Índices: `message` se filtra SIEMPRE también por su propia
 * `organization_id` (`messageScope`), así el plan usa
 * `message_org_conv_idx` (organization_id, conversation_id, created_at) en vez
 * de recorrer los mensajes de todas las organizaciones; el embudo usa
 * (organization_id, to_stage_kind, occurred_at) de `lead_stage_event` y las
 * etapas (organization_id, ...). Los rangos de tiempo por `message.created_at`
 * y `conversation.handoff_at` no tienen índice org-first con la fecha en
 * segunda posición: quedan anotados como candidatos en el registro de trabajo;
 * aquí no se crea ninguna migración.
 *
 * 008 — Las solicitudes del formulario del sitio (`message.channel = 'web'`)
 * NO entran en estas métricas: son métricas de la conversación de WhatsApp.
 * Una solicitud web no abre la ventana de 24 h y el equipo la contesta muchas
 * veces fuera del CRM (teléfono, email): contarla como «primer entrante»
 * adelantaría el inicio del reloj de la primera respuesta del cliente que
 * luego escribe por WhatsApp, y en el andamento mezclaría dos canales en la
 * misma línea de «entrantes». IA/persona solo cuenta salientes (nunca `web`):
 * el filtro es simétrico y a prueba de futuro.
 *
 * Zona horaria: las columnas son `timestamp` sin zona y Drizzle guarda la hora
 * UTC; el período se compara en UTC y el andamento se agrupa por día UTC.
 */

export const SUMMARY_DAYS = [7, 30, 90] as const;
export type SummaryDays = (typeof SUMMARY_DAYS)[number];

/** Días de período aceptados; cualquier otra cosa → null (la rotta risponde 422). */
export function normalizeSummaryDays(value: unknown): SummaryDays | null {
  const n = typeof value === "string" ? Number(value) : value;
  return (SUMMARY_DAYS as readonly unknown[]).includes(n)
    ? (n as SummaryDays)
    : null;
}

export type SummaryStage = {
  id: string;
  name: string;
  conversations: number;
};

export type SummaryHandoff = {
  reason: string | null;
  conversations: number;
};

export type SummaryDailyPoint = {
  /** Fecha UTC en formato `YYYY-MM-DD`. */
  date: string;
  inbound: number;
  outbound: number;
};

export type DashboardSummary = {
  days: SummaryDays;
  stages: SummaryStage[];
  firstResponse: {
    medianMinutes: number | null;
    p90Minutes: number | null;
    answered: number;
  };
  outgoing: {
    ai: number;
    human: number;
  };
  handoffs: SummaryHandoff[];
  conversions: {
    /** Leads distintos que entraron a la etapa ganada dentro del período. */
    won: number;
  };
  daily: SummaryDailyPoint[];
};

export async function getDashboardSummary(
  organizationId: string,
  days: SummaryDays
): Promise<DashboardSummary> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  // postgres-js no serializa un Date dentro de `sql`...`: va como texto ISO (UTC, como lo guarda Drizzle).
  const sinceSql = since.toISOString();

  const conversationScope = scoped(
    schema.conversation.organizationId,
    organizationId,
    sql`conversation.is_test = false`
  );
  // `message` también por su organización: sin esto el JOIN recorre la tabla entera.
  const messageScope = scoped(schema.message.organizationId, organizationId);

  const [stageRows, responseRows, aiRows, handoffRows, conversionRows, dailyRows] =
    await Promise.all([
      // 1. Conversaciones (reales) por etapa ACTUAL del lead del contacto.
      db.execute<{ id: string; name: string; conversations: number }>(sql`
        select pipeline_stage.id, pipeline_stage.name, count(conversation.id)::int as conversations
        from pipeline_stage
        left join lead
          on lead.stage_id = pipeline_stage.id
         and lead.organization_id = pipeline_stage.organization_id
        left join conversation
          on conversation.contact_id = lead.contact_id
         and conversation.organization_id = pipeline_stage.organization_id
         and conversation.is_test = false
        where ${scoped(schema.pipelineStage.organizationId, organizationId)}
        group by pipeline_stage.id, pipeline_stage.name, pipeline_stage.position
        order by pipeline_stage.position, pipeline_stage.name
      `),

      // 2. Primera respuesta: mediana y p90, POR CONVERSACIÓN:
      //    primer entrante del período → primera saliente posterior.
      db.execute<{
        median_minutes: number | null;
        p90_minutes: number | null;
        answered: number;
      }>(sql`
        with first_in as (
          select conversation.id, min(message.created_at) as first_in
          from conversation
          join message
            on message.conversation_id = conversation.id
           and message.direction = 'in'
           and message.channel <> 'web'
          where ${conversationScope}
            and ${messageScope}
            and message.created_at >= ${sinceSql}::timestamp
          group by conversation.id
        ),
        answered as (
          select first_in.id, first_in.first_in, min(message.created_at) as first_out
          from first_in
          join message
            on message.conversation_id = first_in.id
           and message.direction = 'out'
           and message.channel <> 'web'
           and message.status <> 'failed'
           -- 009: la cortesía automática (origin = 'system') no es una respuesta.
           and message.origin <> 'system'
           and message.created_at > first_in.first_in
          where ${messageScope}
          group by first_in.id, first_in.first_in
        )
        select
          round(
            (percentile_cont(0.5) within group (
              order by extract(epoch from (first_out - first_in)) / 60
            ))::numeric,
            1
          )::float8 as median_minutes,
          round(
            (percentile_cont(0.9) within group (
              order by extract(epoch from (first_out - first_in)) / 60
            ))::numeric,
            1
          )::float8 as p90_minutes,
          count(*)::int as answered
        from answered
      `),

      // 3a. Salientes del período: IA contra persona.
      db.execute<{ ai_generated: boolean; n: number }>(sql`
        select message.ai_generated, count(*)::int as n
        from message
        join conversation on conversation.id = message.conversation_id
        where ${conversationScope}
          and ${messageScope}
          and message.direction = 'out'
          and message.channel <> 'web'
          and message.created_at >= ${sinceSql}::timestamp
        group by message.ai_generated
      `),

      // 3b. Conversaciones pasadas a una persona en el período, por motivo.
      db.execute<{ handoff_reason: string | null; n: number }>(sql`
        select conversation.handoff_reason, count(*)::int as n
        from conversation
        where ${conversationScope}
          and conversation.handoff_at >= ${sinceSql}::timestamp
        group by conversation.handoff_reason
        order by count(*) desc, conversation.handoff_reason
      `),

      // 4. Conversiones: leads distintos que entran a una etapa ganada en el período.
      db.execute<{ won: number }>(sql`
        select count(distinct lead_stage_event.lead_id)::int as won
        from lead_stage_event
        where ${scoped(schema.leadStageEvent.organizationId, organizationId)}
          and lead_stage_event.to_stage_kind = 'won'
          and lead_stage_event.occurred_at >= ${sinceSql}::timestamp
      `),

      // 5. Andamento: entrantes y salientes por día (UTC).
      db.execute<{ date: string; inbound: number; outbound: number }>(sql`
        select
          to_char(message.created_at, 'YYYY-MM-DD') as date,
          (count(*) filter (where message.direction = 'in'))::int as inbound,
          (count(*) filter (where message.direction = 'out'))::int as outbound
        from message
        join conversation on conversation.id = message.conversation_id
        where ${conversationScope}
          and ${messageScope}
          and message.channel <> 'web'
          and message.created_at >= ${sinceSql}::timestamp
        group by 1
        order by 1
      `),
    ]);

  const response = responseRows[0];
  const ai = aiRows.find((r) => r.ai_generated)?.n ?? 0;
  const human = aiRows.find((r) => !r.ai_generated)?.n ?? 0;

  return {
    days,
    stages: stageRows.map((r) => ({
      id: r.id,
      name: r.name,
      conversations: r.conversations,
    })),
    firstResponse: {
      medianMinutes: response?.median_minutes ?? null,
      p90Minutes: response?.p90_minutes ?? null,
      answered: response?.answered ?? 0,
    },
    outgoing: { ai, human },
    handoffs: handoffRows.map((r) => ({
      reason: r.handoff_reason,
      conversations: r.n,
    })),
    conversions: { won: conversionRows[0]?.won ?? 0 },
    daily: dailyRows.map((r) => ({
      date: r.date,
      inbound: r.inbound,
      outbound: r.outbound,
    })),
  };
}
