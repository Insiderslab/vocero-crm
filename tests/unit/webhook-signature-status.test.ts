import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WebhookSignatureStatus,
  formatAgo,
  type SignatureStats,
} from "@/components/settings/webhook-signature-status";
import type { Locale } from "@/lib/i18n";
import { messagesFor } from "@/lib/i18n/messages";
import { translate } from "@/lib/i18n/t";

/**
 * Configuración → WhatsApp: con secreto, «firma activa» va acompañada de lo
 * que pasó de verdad (última firma verificada, rechazos), en los tres idiomas.
 */

const NOW = Date.parse("2026-10-13T12:00:00Z");

function render(stats: SignatureStats | undefined, locale: Locale): string {
  const messages = messagesFor(locale) as unknown as Record<string, unknown>;
  const t = ((key: string, vars?: Record<string, string | number>) =>
    translate(messages, key, vars)) as Parameters<typeof WebhookSignatureStatus>[0]["t"];
  return renderToStaticMarkup(createElement(WebhookSignatureStatus, { stats, t, locale, now: NOW }));
}

const verified5min: SignatureStats = {
  lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(),
  lastInvalidAt: null,
  invalidSinceBoot: 0,
};
const rejected: SignatureStats = {
  lastVerifiedAt: null,
  lastInvalidAt: new Date(NOW - 30_000).toISOString(),
  invalidSinceBoot: 7,
};

describe("formatAgo", () => {
  it.each([
    ["es", "hace 5 minutos"],
    ["en", "5 minutes ago"],
    ["it", "5 minuti fa"],
  ] as const)("%s → %s", (locale, expected) => {
    expect(formatAgo(verified5min.lastVerifiedAt!, locale, NOW)).toBe(expected);
  });
});

describe("WebhookSignatureStatus", () => {
  it.each([
    ["es", "Último evento firmado verificado: hace 5 minutos"],
    ["en", "Last verified signed event: 5 minutes ago"],
    ["it", "Ultimo evento firmato verificato: 5 minuti fa"],
  ] as const)("%s: última firma verificada «hace X»", (locale, expected) => {
    const html = render(verified5min, locale);
    expect(html).toContain(expected);
    expect(html).not.toContain('data-testid="signature-rejected"');
  });

  it.each([
    ["es", "7 eventos rechazados", "el secreto no coincide"],
    ["en", "7 events rejected", "the secret does not match"],
    ["it", "7 eventi rifiutati", "il segreto non coincide"],
  ] as const)("%s: rechazos como alerta, con el número", (locale, count, why) => {
    const html = render(rejected, locale);
    expect(html).toContain('role="alert"');
    expect(html).toContain(count);
    expect(html).toContain(why);
    expect(html).not.toContain("{{");
  });

  it("sin ninguna verificada aún lo dice (no «firma activa» a secas)", () => {
    expect(render(rejected, "it")).toContain("non è ancora arrivato nessun evento firmato verificato");
  });

  it("sin contadores (API vieja) solo «firma activa»", () => {
    const html = render(undefined, "es");
    expect(html).toContain("Verificación de firma activa");
    expect(html).not.toContain("signature-last-verified");
  });
});
