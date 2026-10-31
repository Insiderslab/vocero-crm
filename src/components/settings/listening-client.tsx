"use client";

import { useCallback, useEffect, useState } from "react";
import { Ear } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/**
 * 016 — Impostazioni → Modalità ascolto: un interruttore sobre
 * `/api/settings/listening` (owner/admin). La regola vive nel server
 * (`src/server/listening/mode.ts`); qui solo lo si accende e spegne.
 */

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; enabled: boolean; enabledAt: string | null };

export function ListeningClient() {
  const { t, locale } = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/listening", { cache: "no-store" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { enabled: boolean; enabledAt: string | null }
      | null;
    setState(
      res?.ok && typeof data?.enabled === "boolean"
        ? { status: "ready", enabled: data.enabled, enabledAt: data.enabledAt }
        : { status: "error" }
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/listening", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as
      | { enabled: boolean; enabledAt: string | null; error?: { message?: string } }
      | null;
    if (!res?.ok || typeof data?.enabled !== "boolean") {
      setError(data?.error?.message ?? t("settings.listening.saveError"));
      return;
    }
    setState({ status: "ready", enabled: data.enabled, enabledAt: data.enabledAt });
  }

  if (state.status === "loading") {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("settings.listening.loadError")}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ear className="h-4 w-4" aria-hidden />
          {t("settings.listening.title")}
        </CardTitle>
        <CardDescription>{t("settings.listening.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={state.enabled}
            disabled={busy}
            onCheckedChange={(next) => void change(next)}
            label={t("settings.listening.toggleLabel")}
            describedBy="listening-state"
          />
          <span id="listening-state" className="text-sm font-medium">
            {state.enabled ? t("settings.listening.on") : t("settings.listening.off")}
          </span>
        </div>
        {state.enabled && state.enabledAt && (
          <p className="text-xs text-muted-foreground">
            {t("settings.listening.since", {
              date: new Date(state.enabledAt).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
