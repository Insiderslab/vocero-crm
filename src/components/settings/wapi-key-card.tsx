"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * C3 — Clave Wapi de la organización activa. Usa solo
 * /api/settings/whatsapp/wapi-key (owner/admin). La clave se escribe, se envía
 * y se borra del estado: la API nunca la devuelve, solo los últimos 4.
 */

type WapiStatus = {
  gatewayEnabled: boolean;
  configured: boolean;
  last4: string | null;
  routing: "own_key" | "legacy_global" | "blocked" | "direct";
};

const BASE = "/api/settings/whatsapp/wapi-key";

export function WapiKeyCard() {
  const { t } = useT();
  const [status, setStatus] = useState<WapiStatus | "loading" | "error">("loading");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(BASE, { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as WapiStatus | null) : null;
    setStatus(data ?? "error");
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function call(method: "PUT" | "DELETE", fallback: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(BASE, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "PUT" ? JSON.stringify({ key }) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setError(
        data?.error?.code === "invalid_wapi_key"
          ? t("settings.whatsapp.wapi.invalidFormat")
          : (data?.error?.message ?? fallback)
      );
      return;
    }
    setKey("");
    setSaved(method === "PUT");
    setStatus((await res.json()) as WapiStatus);
  }

  function remove() {
    if (!confirm(t("settings.whatsapp.wapi.confirmRemove"))) return;
    void call("DELETE", t("settings.whatsapp.wapi.removeError"));
  }

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("settings.whatsapp.wapi.loadError")}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.whatsapp.wapi.title")}</CardTitle>
        <CardDescription>{t("settings.whatsapp.wapi.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status.gatewayEnabled && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("settings.whatsapp.wapi.gatewayOff")}
          </p>
        )}
        {status.gatewayEnabled && (
          <p
            className={`text-xs ${status.routing === "blocked" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {t(`settings.whatsapp.wapi.routing.${status.routing}`)}
          </p>
        )}
        <div className="flex items-center gap-2 text-sm">
          {status.configured ? (
            <Badge variant="success">
              {t("settings.whatsapp.wapi.configured", { last4: status.last4 ?? "" })}
            </Badge>
          ) : (
            <Badge variant="secondary">{t("settings.whatsapp.wapi.notConfigured")}</Badge>
          )}
          {status.configured && (
            <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
              {t("settings.whatsapp.wapi.remove")}
            </Button>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wapi-key">{t("settings.whatsapp.wapi.keyLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="wapi-key"
              type="password"
              autoComplete="off"
              maxLength={200}
              placeholder={t("settings.whatsapp.wapi.keyPlaceholder")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button
              disabled={busy || !key.trim()}
              onClick={() => void call("PUT", t("settings.whatsapp.wapi.saveError"))}
            >
              <KeyRound className="h-4 w-4" />
              {busy ? t("settings.whatsapp.wapi.saving") : t("settings.whatsapp.wapi.save")}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-success">{t("settings.whatsapp.wapi.saved")}</p>}
      </CardContent>
    </Card>
  );
}
