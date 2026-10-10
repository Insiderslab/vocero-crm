"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, KeyRound, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { buildSiteSnippet } from "@/lib/site-snippet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 008 — Configuración → Sitio web: clave del sitio (`vsk_`, una activa por
 * organización: crear = rotar), orígenes autorizados (CORS) y el fragmento
 * para pegar en el sitio. Solo usa `/api/settings/site{,/key}`, que ya exigen
 * owner/admin. La clave en claro llega UNA vez (POST) y solo vive en el estado
 * de esta pantalla hasta que se oculta.
 */

type SiteKey = { id: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null };
type SiteState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; key: SiteKey | null; allowedOrigins: string[]; endpoint: string };

export function SiteClient() {
  const { t, locale } = useT();
  const [state, setState] = useState<SiteState>({ status: "loading" });
  const [origins, setOrigins] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "snippet" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originsMsg, setOriginsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/site", { cache: "no-store" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { key: SiteKey | null; allowedOrigins: string[]; endpoint: string }
      | null;
    if (!res?.ok || !data || !Array.isArray(data.allowedOrigins)) {
      setState({ status: "error" });
      return;
    }
    setState({ status: "ready", ...data });
    setOrigins(data.allowedOrigins.join("\n"));
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function errorOf(res: Response | null, fallback: string): Promise<string> {
    const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
    return data?.error?.message ?? fallback;
  }

  async function createOrRotate(rotating: boolean) {
    if (rotating && !confirm(t("settings.site.confirmRotate"))) return;
    setBusy(true);
    setError(null);
    setCopied(null);
    const res = await fetch("/api/settings/site/key", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await errorOf(res, t("settings.site.keyError")));
      return;
    }
    const data = (await res.json()) as { key: string };
    setCreated(data.key);
    void refetch();
  }

  async function revoke() {
    if (!confirm(t("settings.site.confirmRevoke"))) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/site/key", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await errorOf(res, t("settings.site.keyError")));
      return;
    }
    setCreated(null);
    void refetch();
  }

  async function saveOrigins() {
    setBusy(true);
    setOriginsMsg(null);
    const res = await fetch("/api/settings/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedOrigins: origins }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setOriginsMsg({ ok: false, text: await errorOf(res, t("settings.site.originsError")) });
      return;
    }
    const data = (await res.json()) as { allowedOrigins: string[] };
    setOrigins(data.allowedOrigins.join("\n"));
    setOriginsMsg({ ok: true, text: t("settings.site.originsSaved") });
  }

  function copy(text: string, what: "key" | "snippet") {
    void navigator.clipboard.writeText(text).then(() => setCopied(what));
  }

  const endpoint = state.status === "ready" ? state.endpoint : "";
  const snippet = useMemo(
    () =>
      buildSiteSnippet({
        endpoint,
        siteKey: created ?? t("settings.site.placeholderKey"),
        labels: {
          name: t("settings.site.form.name"),
          phone: t("settings.site.form.phone"),
          email: t("settings.site.form.email"),
          message: t("settings.site.form.message"),
          submit: t("settings.site.form.submit"),
          thanks: t("settings.site.form.thanks"),
          error: t("settings.site.form.error"),
        },
      }),
    [endpoint, created, t]
  );

  if (state.status === "loading") {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("settings.site.loadError")}
      </p>
    );
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const key = state.key;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.site.keyTitle")}</CardTitle>
          <CardDescription>{t("settings.site.keyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm" data-testid="site-key-status">
            {key ? (
              <code className="text-xs">
                {t("settings.site.activeKey", {
                  prefix: key.keyPrefix,
                  created: date(key.createdAt),
                  used: key.lastUsedAt
                    ? t("settings.site.lastUsed", { date: date(key.lastUsedAt) })
                    : t("settings.site.neverUsed"),
                })}
              </code>
            ) : (
              <span className="text-muted-foreground">{t("settings.site.noKey")}</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {key ? (
              <>
                <Button disabled={busy} onClick={() => void createOrRotate(true)}>
                  <RefreshCw className="h-4 w-4" />
                  {t("settings.site.rotate")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void revoke()}>
                  {t("settings.site.revoke")}
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={() => void createOrRotate(false)}>
                <KeyRound className="h-4 w-4" />
                {t("settings.site.create")}
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {created && (
            <div className="space-y-2 rounded-md border border-success-soft bg-success-tint p-3 text-sm">
              <p className="font-medium text-success-text">{t("settings.site.created")}</p>
              <p className="text-success-text opacity-90">{t("settings.site.shareNow")}</p>
              <code className="block break-all rounded bg-background px-2 py-1 text-xs">{created}</code>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(created, "key")}>
                  {copied === "key" ? t("settings.site.copied") : t("settings.site.copy")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                  {t("settings.site.hide")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.site.originsTitle")}</CardTitle>
          <CardDescription>{t("settings.site.originsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="site-origins" className="sr-only">
            {t("settings.site.originsTitle")}
          </Label>
          <Textarea
            id="site-origins"
            rows={4}
            value={origins}
            placeholder={t("settings.site.originsPlaceholder")}
            onChange={(e) => {
              setOrigins(e.target.value);
              setOriginsMsg(null);
            }}
          />
          <div className="flex items-center gap-3">
            <Button disabled={busy} onClick={() => void saveOrigins()}>
              <Globe className="h-4 w-4" />
              {t("settings.site.originsSave")}
            </Button>
            {originsMsg && (
              <p className={originsMsg.ok ? "text-sm text-success-text" : "text-sm text-destructive"}>
                {originsMsg.text}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.site.snippetTitle")}</CardTitle>
          <CardDescription>{t("settings.site.snippetDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="break-all text-xs text-muted-foreground">
            {t("settings.site.endpoint", { url: state.endpoint })}
          </p>
          {!created && (
            <p className="text-xs text-muted-foreground">{t("settings.site.snippetPlaceholderNote")}</p>
          )}
          <Textarea
            readOnly
            rows={14}
            value={snippet}
            className="font-mono text-xs"
            aria-label={t("settings.site.snippetTitle")}
          />
          <Button variant="outline" size="sm" onClick={() => copy(snippet, "snippet")}>
            {copied === "snippet" ? t("settings.site.copied") : t("settings.site.snippetCopy")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
