"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { useT, type TFunction } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import type { MetaIdSource, MetaPlatformStatus } from "@/server/platform/meta-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAgo } from "@/components/settings/webhook-signature-status";

/**
 * 013 — /admin → Piattaforma → Meta (solo super-admin). App ID e
 * Configuration ID dell'Embedded Signup senza SSH: si salvano qui (non sono
 * segreti). Se la variabile d'ambiente c'è, vince lei e la scheda lo dice.
 * L'App Secret resta nell'ambiente: qui solo presenza e firme verificate.
 */

/** Stessa regola del server (`META_ID_PATTERN`): solo cifre, da 6 a 25. */
const ID_RE = /^\d{6,25}$/;

/** Link alla documentazione di Meta per i passi da fare una volta. */
const META_LINKS = {
  apps: "https://developers.facebook.com/apps/",
  embeddedSignup: "https://developers.facebook.com/docs/whatsapp/embedded-signup/",
  coexistence:
    "https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/",
  loginForBusiness: "https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/",
  webhooks: "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/",
} as const;

export function MetaPlatformCard() {
  const { t, locale } = useT();
  const [status, setStatus] = useState<MetaPlatformStatus | "loading" | "error">("loading");
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((s: MetaPlatformStatus) => {
    setStatus(s);
    setAppId(s.appId.stored ?? "");
    setConfigId(s.configId.stored ?? "");
  }, []);

  useEffect(() => {
    void fetch("/api/admin/platform/meta", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MetaPlatformStatus>) : null))
      .then((s) => (s ? apply(s) : setStatus("error")))
      .catch(() => setStatus("error"));
  }, [apply]);

  const invalid = (v: string) => v.trim() !== "" && !ID_RE.test(v.trim());

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/admin/platform/meta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: appId.trim() || null, configId: configId.trim() || null }),
    }).catch(() => null);
    setSaving(false);
    const data = (await res?.json().catch(() => null)) as
      | (MetaPlatformStatus & { error?: undefined })
      | { error?: { message?: string } }
      | null;
    if (!res?.ok || !data || data.error) {
      setError(data?.error?.message ?? t("admin.platform.saveError"));
      return;
    }
    apply(data as MetaPlatformStatus);
    setSaved(true);
  }

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">{t("admin.orgs.loading")}</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("admin.platform.loadError")}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("admin.platform.title")}
          {status.embeddedSignupReady ? (
            <Badge variant="success">{t("admin.platform.badgeReady")}</Badge>
          ) : (
            <Badge variant="warning">{t("admin.platform.badgeNotReady")}</Badge>
          )}
        </CardTitle>
        <CardDescription>{t("admin.platform.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ReadyLine status={status} t={t} />

        <div className="grid gap-4 md:grid-cols-2">
          <IdField
            id="meta-app-id"
            label={t("admin.platform.appId")}
            envName="META_APP_ID"
            value={appId}
            onChange={(v) => {
              setAppId(v);
              setSaved(false);
            }}
            resolved={status.appId}
            invalid={invalid(appId)}
            t={t}
          />
          <IdField
            id="meta-config-id"
            label={t("admin.platform.configId")}
            envName="META_ES_CONFIG_ID"
            value={configId}
            onChange={(v) => {
              setConfigId(v);
              setSaved(false);
            }}
            resolved={status.configId}
            invalid={invalid(configId)}
            t={t}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={saving || invalid(appId) || invalid(configId)} onClick={() => void save()}>
            {saving ? t("admin.platform.saving") : t("admin.platform.save")}
          </Button>
          <span role="status" className="text-sm text-success">
            {saved ? t("admin.platform.saved") : ""}
          </span>
        </div>

        <SecretStatus status={status} t={t} locale={locale} />

        <Checklist status={status} t={t} />
      </CardContent>
    </Card>
  );
}

function ReadyLine({ status, t }: { status: MetaPlatformStatus; t: TFunction }) {
  if (status.embeddedSignupReady) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t("admin.platform.ready")}
      </p>
    );
  }
  const missing = [
    !status.appId.value && t("admin.platform.appId"),
    !status.configId.value && t("admin.platform.configId"),
    !status.appSecret.present && "META_APP_SECRET",
  ].filter((x): x is string => Boolean(x));
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {status.wapiGateway
        ? t("admin.platform.wapiGateway")
        : t("admin.platform.notReady", { items: missing.join(", ") })}
    </p>
  );
}

function IdField({
  id,
  label,
  envName,
  value,
  onChange,
  resolved,
  invalid,
  t,
}: {
  id: string;
  label: string;
  envName: string;
  value: string;
  onChange: (v: string) => void;
  resolved: { value: string | null; source: MetaIdSource; stored: string | null };
  invalid: boolean;
  t: TFunction;
}) {
  const envWins = resolved.source === "env";
  return (
    <div className="space-y-1.5">
      {/* La fonte sta FUORI dalla <label> (non fa parte del nome del campo) e
          si legge come descrizione (aria-describedby). */}
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Badge
          id={`${id}-source`}
          variant={resolved.source === "none" ? "warning" : "secondary"}
          data-testid={`${id}-source`}
        >
          {t(`admin.platform.source.${resolved.source}`)}
        </Badge>
      </div>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder={t("admin.platform.placeholder")}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-source ${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
        {invalid
          ? t("admin.platform.invalid")
          : envWins
            ? t("admin.platform.envWins", { name: envName, value: resolved.value ?? "" })
            : t("admin.platform.help")}
      </p>
    </div>
  );
}

function SecretStatus({
  status,
  t,
  locale,
}: {
  status: MetaPlatformStatus;
  t: TFunction;
  locale: Locale;
}) {
  const s = status.appSecret;
  return (
    <div className="space-y-1.5 rounded-md border p-3 text-sm" data-testid="app-secret-status">
      <p className="flex items-center gap-2 font-medium">
        <KeyRound className="h-4 w-4 text-text-3" aria-hidden="true" />
        {t("admin.platform.secret.title")}
      </p>
      {!s.present ? (
        <p className="text-warning-text">{t("admin.platform.secret.missing")}</p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-success">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("admin.platform.secret.present")}
          </p>
          <p className="text-muted-foreground">
            {s.lastVerifiedAt
              ? t("admin.platform.secret.verified", { when: formatAgo(s.lastVerifiedAt, locale) })
              : t("admin.platform.secret.noneVerified")}
          </p>
          {s.invalidSinceBoot > 0 && (
            <p role="alert" className="text-warning-text">
              {t("admin.platform.secret.rejected", { count: s.invalidSinceBoot })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Checklist({ status, t }: { status: MetaPlatformStatus; t: TFunction }) {
  const c = status.checklist;
  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-medium text-brand-text underline-offset-2 hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("admin.platform.checklist.title")}</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          {t("admin.platform.checklist.app")} {link(META_LINKS.apps, t("admin.platform.checklist.linkApps"))}
        </li>
        <li>
          {t("admin.platform.checklist.config", { featureType: c.featureType })}{" "}
          {link(META_LINKS.loginForBusiness, t("admin.platform.checklist.linkLogin"))} ·{" "}
          {link(META_LINKS.coexistence, t("admin.platform.checklist.linkCoexistence"))}
        </li>
        <li>
          {t("admin.platform.checklist.domain", { domain: c.domain })}{" "}
          {link(META_LINKS.embeddedSignup, t("admin.platform.checklist.linkEs"))}
        </li>
        <li>
          {t("admin.platform.checklist.webhook", { count: c.webhookFields.length })}{" "}
          <code className="break-words text-xs text-foreground">{c.webhookFields.join(", ")}</code>{" "}
          {link(META_LINKS.webhooks, t("admin.platform.checklist.linkWebhooks"))}
        </li>
        <li>{t("admin.platform.checklist.secret")}</li>
      </ol>
    </div>
  );
}
