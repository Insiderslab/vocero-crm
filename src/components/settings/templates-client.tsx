"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { useT } from "@/lib/i18n/client";
import {
  countVariables,
  defaultTemplateLanguage,
  TEMPLATE_LANGUAGES,
  validateBodyVariables,
} from "@/lib/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_VARIANT: Record<
  TemplateDto["status"],
  "secondary" | "warning" | "success" | "destructive"
> = {
  draft: "secondary",
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

export function TemplatesClient() {
  const { t } = useT();
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/templates").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: TemplateDto[] };
    setTemplates(data.templates);
  }, []);

  /**
   * `silent`: sincronización automática al abrir la pantalla. Meta entrega
   * `message_template_status_update` al callback A NIVEL APP, que en modo
   * agencia no es el de esta instancia — sin este pull la plantilla se queda
   * "Pendiente de Meta" para siempre aunque ya esté aprobada.
   */
  const sync = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setSyncing(true);
        setSyncMsg(null);
      }
      const res = await fetch("/api/templates/sync", { method: "POST" }).catch(
        () => null
      );
      if (!silent) setSyncing(false);
      if (res?.ok) {
        const data = (await res.json()) as { updated: number };
        if (!silent) {
          setSyncMsg(
            data.updated > 0
              ? t("settings.templates.syncUpdated", { count: data.updated })
              : t("settings.templates.syncUpToDate")
          );
        }
        if (!silent || data.updated > 0) void refetch();
      } else if (!silent) {
        // El auto-sync falla en silencio: la lista local ya se pintó.
        const data = (await res?.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setSyncMsg(data?.error?.message ?? t("settings.templates.syncError"));
      }
    },
    [refetch, t]
  );

  useEffect(() => {
    void refetch().then(() => sync({ silent: true }));
  }, [refetch, sync]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("settings.templates.intro")}
        </p>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {t("settings.templates.sync")}
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}

      <CreateForm onCreated={() => void refetch()} />

      <div className="space-y-2">
        {templates.map((tpl) => (
          <div key={tpl.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-sm font-medium">
                {tpl.name}{" "}
                <span className="text-muted-foreground">
                  ({tpl.language} · {tpl.category})
                </span>
              </p>
              <Badge variant={STATUS_VARIANT[tpl.status]}>
                {t(`settings.templates.status.${tpl.status}`)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{tpl.body}</p>
            {tpl.status === "rejected" && tpl.rejectionReason && (
              <p className="mt-2 text-xs text-destructive">
                {t("settings.templates.rejectionReason", {
                  reason: tpl.rejectionReason,
                })}
              </p>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("settings.templates.empty")}
          </p>
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { t, locale } = useT();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<string>(defaultTemplateLanguage(locale));
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Misma validación que el servidor: avisa antes de gastar una llamada a Meta.
  const bodyError = body.trim() ? validateBodyVariables(body) : null;
  const variableCount = countVariables(body);

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, language, category, body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? t("settings.templates.createError"));
      return;
    }
    setName("");
    setBody("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.templates.createTitle")}</CardTitle>
        <CardDescription>
          {t("settings.templates.createIntro1")}
          <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, <code>{"{{3}}"}</code>
          {t("settings.templates.createIntro2")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t("common.name")}</Label>
            <Input
              id="tpl-name"
              placeholder="seguimiento_cotizacion"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-lang">{t("settings.templates.languageLabel")}</Label>
            <select
              id="tpl-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              {TEMPLATE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-cat">{t("settings.templates.categoryLabel")}</Label>
            <select
              id="tpl-cat"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as "UTILITY" | "MARKETING")
              }
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="UTILITY">{t("settings.templates.utilityOption")}</option>
              <option value="MARKETING">MARKETING</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">{t("settings.templates.bodyLabel")}</Label>
          <Textarea
            id="tpl-body"
            rows={3}
            placeholder={t("settings.templates.bodyPlaceholder")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {bodyError ? (
            <p className="text-xs text-destructive">{bodyError}</p>
          ) : (
            variableCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {variableCount === 1
                  ? t("settings.templates.variableOne")
                  : t("settings.templates.variableMany", { count: variableCount })}
              </p>
            )
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={saving || !name.trim() || !body.trim() || bodyError !== null}
          onClick={() => void create()}
        >
          {saving
            ? t("settings.templates.submitting")
            : t("settings.templates.submit")}
        </Button>
      </CardContent>
    </Card>
  );
}
