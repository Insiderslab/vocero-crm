import { z } from "zod";
import { normalizeMx } from "@/lib/meta/client";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";
import { translate } from "@/lib/i18n/t";
import { messagesFor } from "@/lib/i18n/messages";

/**
 * 008 — Solicitudes del formulario del sitio web: lógica PURA (sin base de
 * datos ni red), para poder probarla entera en unit tests. La ruta pública
 * (`/api/public/site-requests`) y la ingesta la usan tal cual.
 */

/** Tope del body: un formulario de contacto cabe de sobra en 16 KiB. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Cotas de `fields` (campos libres del formulario del sitio). */
export const MAX_FIELDS = 20;
export const MAX_FIELD_KEY = 40;
export const MAX_FIELD_VALUE = 500;

/** Máximo de orígenes autorizados por organización. */
export const MAX_ORIGINS = 20;

/**
 * Límite por IP del cliente y organización (además del de la clave, 30/min en
 * `API_KEY_SCOPES.site`): un visitante no manda 10 solicitudes en 10 minutos.
 */
export const SITE_IP_LIMIT = { windowMs: 10 * 60_000, max: 10 };

/** Límite de preflights por IP (cada uno consulta la base de datos). */
export const SITE_PREFLIGHT_LIMIT = { windowMs: 60_000, max: 60 };

/** Nombre del campo trampa (honeypot): un humano no lo ve ni lo llena. */
export const HONEYPOT_FIELD = "website";

/**
 * Teléfono del formulario → misma forma que la identidad de WhatsApp (dígitos
 * con código de país, 521→52 con `normalizeMx`). Se aceptan espacios, `-`,
 * `.`, `(`, `)`; `+` o `00` al inicio son el prefijo internacional. Un número
 * local (0 inicial tras quitar el prefijo, o menos de 7 dígitos) se rechaza:
 * sin código de país jamás coincidiría con el WhatsApp de la misma persona.
 */
export function normalizeSitePhone(
  raw: string
): { ok: true; phone: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) {
    return { ok: false, reason: "solo dígitos, espacios, +, -, ., ( )" };
  }
  let digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+") && digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) {
    return { ok: false, reason: "falta el código de país (ej. +58 412 1234567)" };
  }
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, reason: "entre 7 y 15 dígitos con código de país" };
  }
  return { ok: true, phone: normalizeMx(digits) };
}

/**
 * Caracteres invisibles que engañan al lector humano: controles bidi
 * (U+202A–202E, U+2066–2069, «Trojan Source») y de ancho cero (U+200B–200D,
 * U+FEFF). Fuera de TODO campo.
 */
const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g;
/** Controles C0/C1 salvo \n (se trata aparte). */
const CONTROLS_EXCEPT_LF = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
/** Separadores de línea: \r, \n, tab, U+2028/2029. */
const LINE_BREAKS = /[\r\n\t\u2028\u2029]/g;

/**
 * Una sola línea (nombre, claves de `fields`, teléfono, email, URL, locale):
 * saltos y tabuladores → espacio, invisibles y controles fuera, espacios
 * colapsados. Así nadie puede fingir en el mensaje una línea «Teléfono: …»
 * dentro del nombre.
 */
export function sanitizeSingleLine(s: string): string {
  return s
    .replace(LINE_BREAKS, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROLS_EXCEPT_LF, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Texto multilínea (mensaje y valores de `fields`): \r\n, \r, U+2028/2029 →
 * \n; tabulador → espacio; invisibles y demás controles fuera.
 */
export function sanitizeMultiLine(s: string): string {
  return s
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROLS_EXCEPT_LF, "")
    .trim();
}

const singleLine = (min: number, max: number) =>
  z.string().transform(sanitizeSingleLine).pipe(z.string().min(min).max(max));
const multiLine = (min: number, max: number) =>
  z.string().transform(sanitizeMultiLine).pipe(z.string().min(min).max(max));

const fieldsSchema = z
  .record(singleLine(1, MAX_FIELD_KEY), multiLine(0, MAX_FIELD_VALUE))
  .refine((r) => Object.keys(r).length <= MAX_FIELDS, {
    message: `máximo ${MAX_FIELDS} campos`,
  });

/** Un campo vacío del formulario ("" o solo espacios) cuenta como ausente. */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const clean = sanitizeSingleLine(v);
    return clean === "" ? undefined : clean;
  }, schema.optional());
}

export const siteRequestSchema = z
  .object({
    name: singleLine(1, 120),
    phone: optional(z.string().trim().max(40)),
    email: optional(z.string().trim().toLowerCase().max(254).email("email no válido")),
    message: multiLine(1, 4000),
    pageUrl: optional(
      z
        .string()
        .trim()
        .max(500)
        .url()
        .refine((u) => /^https?:\/\//i.test(u), "solo http(s)")
    ),
    locale: optional(
      z
        .string()
        .trim()
        .max(20)
        .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "locale no válido")
    ),
    fields: fieldsSchema.optional(),
    [HONEYPOT_FIELD]: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.phone && !d.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "hace falta el teléfono o el email",
      });
    }
    if (d.phone) {
      const n = normalizeSitePhone(d.phone);
      if (!n.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: n.reason });
      }
    }
  });

export type SiteRequestInput = z.infer<typeof siteRequestSchema>;

/** Datos ya normalizados que usa la ingesta. */
export type SiteRequest = {
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  pageUrl: string | null;
  locale: string | null;
  fields: Record<string, string>;
};

/** El honeypot trae algo: es un bot. */
export function isHoneypotFilled(input: SiteRequestInput): boolean {
  return Boolean(input[HONEYPOT_FIELD]?.trim());
}

/** De la entrada validada a la solicitud normalizada (teléfono como identidad). */
export function toSiteRequest(input: SiteRequestInput): SiteRequest {
  const phone = input.phone ? normalizeSitePhone(input.phone) : null;
  return {
    name: input.name,
    phone: phone?.ok ? phone.phone : null,
    email: input.email ?? null,
    message: input.message,
    pageUrl: input.pageUrl ?? null,
    locale: input.locale ?? null,
    fields: Object.fromEntries(
      Object.entries(input.fields ?? {}).filter(([, v]) => v.length > 0)
    ),
  };
}

/** Idioma de las etiquetas del mensaje: el de la solicitud si es es/en/it. */
export function labelLocale(locale: string | null): Locale {
  const base = (locale ?? "").toLowerCase().split("-")[0] ?? "";
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : DEFAULT_LOCALE;
}

/**
 * Texto del mensaje entrante que ve el equipo en la bandeja. Las etiquetas van
 * en el idioma de la solicitud (si es es/en/it) o en el de la instancia.
 */
export function formatSiteRequest(req: SiteRequest): string {
  const messages = messagesFor(labelLocale(req.locale)) as Record<string, unknown>;
  const t = (key: string) => translate(messages, `inbox.siteRequest.${key}`);
  const lines = [t("title"), `${t("name")}: ${req.name}`];
  if (req.phone) lines.push(`${t("phone")}: +${req.phone}`);
  if (req.email) lines.push(`${t("email")}: ${req.email}`);
  lines.push("", req.message);
  const extra = Object.entries(req.fields);
  if (extra.length > 0) {
    lines.push("");
    for (const [k, v] of extra) lines.push(`${k}: ${v}`);
  }
  if (req.pageUrl) lines.push("", `${t("page")}: ${req.pageUrl}`);
  return lines.join("\n");
}

/* ------------------------------ orígenes ------------------------------ */

/**
 * Una línea → origen canónico (`URL.origin`: esquema y host en minúsculas,
 * puerto por defecto fuera). Sin ruta, query, fragmento, credenciales ni `*`.
 */
export function normalizeOrigin(raw: string): string | null {
  const s = raw.trim().replace(/\/$/, "");
  if (!s || s.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!url.hostname) return null;
  return url.origin;
}

/** Lista (texto con una por línea, o arreglo) → orígenes, o las líneas inválidas. */
export function parseOrigins(
  input: string | readonly string[]
): { ok: true; origins: string[] } | { ok: false; invalid: string[] } | { ok: false; tooMany: true } {
  const lines = (typeof input === "string" ? input.split(/\r?\n/) : [...input])
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const invalid: string[] = [];
  const origins: string[] = [];
  for (const line of lines) {
    const o = normalizeOrigin(line);
    if (!o) invalid.push(line.slice(0, 200));
    else if (!origins.includes(o)) origins.push(o);
  }
  if (invalid.length > 0) return { ok: false, invalid };
  if (origins.length > MAX_ORIGINS) return { ok: false, tooMany: true };
  return { ok: true, origins };
}

/**
 * El origen de la petición está en la lista. La cabecera `Origin` se compara
 * en forma canónica (un navegador ya la manda así; un "null" no coincide).
 */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const o = normalizeOrigin(origin);
  return o !== null && allowed.includes(o);
}

/** Cabeceras CORS de una respuesta a un origen autorizado. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
}

/** Cabeceras del preflight a un origen autorizado. */
export function preflightHeaders(origin: string): Record<string, string> {
  return {
    ...corsHeaders(origin),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-site-key",
    "access-control-max-age": "600",
  };
}

/**
 * Lee el body como texto con tope de bytes, aunque falte `Content-Length` o
 * mienta (chunked). Pasado el tope cancela la lectura y devuelve null.
 */
export async function readBodyCapped(req: Request, max: number = MAX_BODY_BYTES): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
