"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  ShieldCheck,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CoexistenceConnect } from "@/components/settings/coexistence-connect";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  /** 009 — manual / embedded / coexistence. */
  onboardingMode?: "manual" | "embedded" | "coexistence";
  /** 009 — Meta cortó la coexistence (ISO), null = activa. */
  appDisconnectedAt?: string | null;
  tokenLast4: string;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

export function WhatsappWizard() {
  const { t } = useT();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) setConnection(c.connection);
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              {t("settings.whatsapp.reconnectTitle")}
            </p>
            <p className="text-danger-text opacity-80">
              {t("settings.whatsapp.reconnectBody")}
            </p>
          </div>
        </div>
      )}

      {connection?.appDisconnectedAt && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              {t("settings.whatsapp.disconnectedTitle")}
            </p>
            <p className="text-danger-text opacity-80">
              {t("settings.whatsapp.disconnectedBody")}
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              {t("settings.whatsapp.connectedNumber", {
                number:
                  connection.displayPhoneNumber ?? connection.phoneNumberId,
              })}
            </p>
            <p className="text-success-text opacity-80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              {t("settings.whatsapp.tokenTail", {
                last4: connection.tokenLast4,
              })}
            </p>
            {connection.onboardingMode === "coexistence" && (
              <p className="text-success-text opacity-80">
                {t("settings.whatsapp.coexKeepAlive")}
              </p>
            )}
          </div>
          {connection.onboardingMode === "coexistence" && (
            <Badge variant="outline">{t("settings.whatsapp.coexBadge")}</Badge>
          )}
          <Badge variant="success">{t("settings.whatsapp.connected")}</Badge>
        </div>
      )}

      <CoexistenceConnect onConnected={() => void refetch()} />

      <ConnectForm existing={connection} onSaved={() => void refetch()} />

      {webhook && <WebhookCard webhook={webhook} />}
    </div>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: t("settings.whatsapp.noServer") });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? t("settings.whatsapp.validationFailed"),
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? t("settings.whatsapp.saveError"));
      return;
    }
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing
            ? t("settings.whatsapp.titleReconnect")
            : t("settings.whatsapp.titleConnect")}
        </CardTitle>
        <CardDescription>
          {t("settings.whatsapp.connectDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background/40 p-4 text-sm">
          <p className="font-medium">{t("settings.whatsapp.originTitle")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">{t("settings.whatsapp.originDirectTitle")}</p>
              <p className="text-muted-foreground">
                {t("settings.whatsapp.originDirect1")}
                <span className="text-foreground">developers.facebook.com</span>
                {t("settings.whatsapp.originDirect2")}
                <span className="text-foreground">{t("settings.whatsapp.originSystemUser")}</span>
                {t("settings.whatsapp.originDirect3")}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">{t("settings.whatsapp.originAgencyTitle")}</p>
              <p className="text-muted-foreground">
                {t("settings.whatsapp.originAgency1")}
                <span className="text-foreground">{t("settings.whatsapp.originAgencyWaba")}</span>
                {t("settings.whatsapp.originAgency2")}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder={t("settings.whatsapp.wabaPlaceholder")}
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder={t("settings.whatsapp.phoneIdPlaceholder")}
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">{t("settings.whatsapp.tokenLabel")}</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? t("settings.whatsapp.tokenPlaceholderSaved", { last4: existing.tokenLast4 }) : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? t("settings.whatsapp.tokenValid", {
                  display: testResult.display,
                })
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing
              ? t("settings.whatsapp.testing")
              : t("settings.whatsapp.test")}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? t("common.saving") : t("settings.whatsapp.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const { t } = useT();
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.whatsapp.webhookTitle")}</CardTitle>
        <CardDescription>
          {t("settings.whatsapp.webhookDesc1")}
          <strong className="text-foreground">
            {t("settings.whatsapp.webhookDescStrong")}
          </strong>
          {t("settings.whatsapp.webhookDesc2")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("settings.whatsapp.httpsWarning")}
          </p>
        )}
        <div className="space-y-1.5">
          <Label>{t("settings.whatsapp.urlLabel")}</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("settings.whatsapp.copyUrl")}
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">{t("settings.whatsapp.copiedUrl")}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.whatsapp.urlHelp")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("settings.whatsapp.copyToken")}
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">{t("settings.whatsapp.copiedToken")}</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> {t("settings.whatsapp.signatureActive")}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t("settings.whatsapp.signatureInactive")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
