/**
 * Normalización de las instantáneas golden (005-livello-canali, T003).
 *
 * Una instantánea debe salir IGUAL en cada corrida y en cada máquina, y no
 * debe contener ningún secreto. Por eso:
 * - IDs aleatorios (`ct_…`, `msg_…`) → marcadores estables (`<ct#1>`), en el
 *   orden en que aparecen al recorrer la instantánea;
 * - fechas → relativas al reloj fijo del caso (`<now-60s>`) o `<db-now>` si
 *   las puso `now()` de PostgreSQL;
 * - bearer y secretos conocidos → su TIPO (`meta_token(org_golden_a)`), jamás
 *   el valor. Un secreto que aparezca fuera de una cabecera queda marcado
 *   como `<secret:…>`: el golden lo haría visible.
 */

/** Reloj fijo de los golden: 2030-01-01T12:00:00Z (lejos del reloj real). */
export const FIXED_NOW_MS = Date.UTC(2030, 0, 1, 12, 0, 0);
export const FIXED_NOW_S = FIXED_NOW_MS / 1000;

/**
 * Campos ADITIVOS declarados (FR-010, T033): un campo nuevo en un DTO solo se
 * acepta si está aquí Y anotado en el registro de trabajo del paquete que lo
 * añade. Se quitan antes de comparar. Hoy: ninguno.
 */
export const DECLARED_ADDITIVE_KEYS: readonly string[] = [];

/** Prefijos de `newId` (src/lib/db/ids.ts) + los que añada el plan (cha, ci). */
const ID_RE =
  /\b(org|mem|ct|cv|msg|ld|stg|lse|cred|agp|kb|tpl|run|case|ma|tag|ctg|rule|arun|bk|wk|abk|cha|ci)_[0-9a-z]{20}\b/g;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const DAY = 24 * 60 * 60 * 1000;

export type Secrets = Record<string, string>; // valor → etiqueta

export class Normalizer {
  private ids = new Map<string, string>();
  private counters = new Map<string, number>();

  constructor(
    private readonly secrets: Secrets,
    private readonly realNowMs: number = Date.now()
  ) {}

  private idLabel(id: string, prefix: string): string {
    let label = this.ids.get(id);
    if (!label) {
      const n = (this.counters.get(prefix) ?? 0) + 1;
      this.counters.set(prefix, n);
      label = `<${prefix}#${n}>`;
      this.ids.set(id, label);
    }
    return label;
  }

  time(ms: number): string {
    const d = ms - FIXED_NOW_MS;
    if (Math.abs(d) <= 400 * DAY) {
      if (d === 0) return "<now>";
      return `<now${d > 0 ? "+" : "-"}${formatDuration(Math.abs(d))}>`;
    }
    // Lo escribió el DEFAULT now() de PostgreSQL (reloj real, no el del caso).
    if (Math.abs(ms - this.realNowMs) <= 2 * DAY) return "<db-now>";
    return new Date(ms).toISOString();
  }

  string(s: string): string {
    if (ISO_RE.test(s)) {
      const ms = Date.parse(s);
      if (Number.isFinite(ms)) return this.time(ms);
    }
    let out = s;
    for (const [value, label] of Object.entries(this.secrets)) {
      if (value && out.includes(value)) out = out.split(value).join(`<secret:${label}>`);
    }
    return out.replace(ID_RE, (id, prefix: string) => this.idLabel(id, prefix));
  }

  /** Cabecera Authorization → tipo del bearer. */
  bearer(header: string | null | undefined): string {
    if (!header) return "<none>";
    const m = /^Bearer (.*)$/.exec(header);
    if (!m) return "<not-bearer>";
    return this.secrets[m[1] ?? ""] ?? "<unknown-bearer>";
  }

  value(v: unknown): unknown {
    if (v === null || v === undefined) return v ?? null;
    if (v instanceof Date) return this.time(v.getTime());
    if (typeof v === "string") return this.string(v);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return Number(v);
    if (Array.isArray(v)) return v.map((x) => this.value(x));
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (DECLARED_ADDITIVE_KEYS.includes(k)) continue;
        if (x === undefined) continue;
        out[k] = this.value(x);
      }
      return out;
    }
    return String(v);
  }
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
