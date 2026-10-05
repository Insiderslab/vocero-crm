"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Claves de servicio de la organización activa para un ámbito: `bot` (vbk_,
 * /api/bot/*) o `export` (vex_, /api/export/*). Usa solo las rutas existentes
 * de /api/settings/{bot,export}-keys, que ya exigen owner/admin. La clave en
 * claro llega UNA vez (respuesta del POST) y solo vive en el estado de esta
 * tarjeta hasta que se oculta.
 */

type ApiKey = {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function ApiKeysClient({ scope }: { scope: "bot" | "export" }) {
  const { t, locale } = useT();
  const base = `/api/settings/${scope}-keys`;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ label: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { keys: ApiKey[] };
    setKeys(data.keys);
  }, [base]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function errorOf(res: Response | null, fallback: string): Promise<string> {
    const data = (await res?.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return data?.error?.message ?? fallback;
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(await errorOf(res, t("settings.apiKeys.createError")));
      return;
    }
    const data = (await res.json()) as { label: string; key: string };
    setCreated({ label: data.label, key: data.key });
    setLabel("");
    void refetch();
  }

  async function revoke(k: ApiKey) {
    if (!confirm(t("settings.apiKeys.confirmRevoke", { label: k.label }))) return;
    setError(null);
    const res = await fetch(`${base}/${encodeURIComponent(k.id)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setError(await errorOf(res, t("settings.apiKeys.revokeError")));
      return;
    }
    void refetch();
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>{t(`settings.apiKeys.${scope}.title`)}</CardTitle>
          <CardDescription>{t(`settings.apiKeys.${scope}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${scope}-key-label`}>{t("settings.apiKeys.labelLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id={`${scope}-key-label`}
                value={label}
                maxLength={80}
                placeholder={t("settings.apiKeys.labelPlaceholder")}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button disabled={saving || !label.trim()} onClick={() => void create()}>
                <KeyRound className="h-4 w-4" />
                {saving ? t("common.creating") : t("settings.apiKeys.submit")}
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {created && (
            <div className="space-y-2 rounded-md border border-success-soft bg-success-tint p-3 text-sm">
              <p className="font-medium text-success-text">
                {t("settings.apiKeys.created", { label: created.label })}
              </p>
              <p className="text-success-text opacity-90">{t("settings.apiKeys.shareNow")}</p>
              <code className="block break-all rounded bg-background px-2 py-1 text-xs">
                {created.key}
              </code>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(created.key)}>
                  {copied ? t("settings.apiKeys.copied") : t("settings.apiKeys.copy")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                  {t("settings.apiKeys.hide")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.apiKeys.empty")}</p>
      ) : (
        keys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{k.label}</p>
              <p className="text-xs text-muted-foreground">
                <code>{k.keyPrefix}…</code> · {t("settings.apiKeys.createdAt", { date: date(k.createdAt) })}
                {" · "}
                {k.lastUsedAt
                  ? t("settings.apiKeys.lastUsed", { date: date(k.lastUsedAt) })
                  : t("settings.apiKeys.neverUsed")}
              </p>
            </div>
            {k.revokedAt ? (
              <Badge variant="secondary">{t("settings.apiKeys.revoked")}</Badge>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void revoke(k)}>
                {t("settings.apiKeys.revoke")}
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
