"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { intlLocale } from "@/lib/i18n";
import type { AdminDeletionRequest, DeletionStatus } from "@/server/meta/data-deletion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

/**
 * 015 — /admin → Privacy → «Richieste di cancellazione Meta» (solo
 * super-admin). Chi le gestisce (amministrazione: Denise) le controlla almeno
 * una volta a settimana, cancella a mano i dati e segna lo stato; la pagina
 * pubblica /cancellazione-dati?id=<codice> lo mostra subito.
 */
export function MetaDeletionCard() {
  const { t, locale } = useT();
  const [items, setItems] = useState<AdminDeletionRequest[] | "loading" | "error">("loading");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/meta-deletion", { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { requests: AdminDeletionRequest[] } | null) : null;
    if (!data) return setItems("error");
    setItems(data.requests);
    setNotes(Object.fromEntries(data.requests.map((r) => [r.id, r.note ?? ""])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mark(id: string, status: DeletionStatus) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/meta-deletion/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note: notes[id] ?? null }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(t("admin.deletion.saveError"));
    await load();
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <Card data-testid="meta-deletion-card">
      <CardHeader>
        <CardTitle>{t("admin.deletion.title")}</CardTitle>
        <CardDescription>{t("admin.deletion.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items === "loading" ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : items === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {t("admin.deletion.loadError")}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.deletion.empty")}</p>
        ) : (
          <ul className="space-y-4">
            {items.map((r) => (
              <li key={r.id} className="space-y-2 rounded-md border p-3 text-sm" data-status={r.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "completed" ? "success" : "warning"}>
                    {t(`admin.deletion.status_${r.status}`)}
                  </Badge>
                  {r.daysLeft !== null && (
                    <span className={r.daysLeft < 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {r.daysLeft < 0
                        ? t("admin.deletion.overdue", { days: -r.daysLeft })
                        : t("admin.deletion.daysLeft", { days: r.daysLeft })}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">{t("admin.deletion.metaUser")}</dt>
                  <dd className="break-all font-mono">{r.metaUserId}</dd>
                  <dt className="text-muted-foreground">{t("admin.deletion.code")}</dt>
                  <dd className="font-mono">
                    {r.confirmationCode}{" "}
                    <a
                      href={`/cancellazione-dati?id=${encodeURIComponent(r.confirmationCode)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline"
                    >
                      {t("admin.deletion.statusPage")}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </dd>
                  <dt className="text-muted-foreground">{t("admin.deletion.received")}</dt>
                  <dd>{fmt(r.createdAt)}</dd>
                </dl>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">{t("admin.deletion.note")}</span>
                  <Textarea
                    value={notes[r.id] ?? ""}
                    maxLength={1000}
                    rows={2}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                </label>
                {r.status !== "completed" && (
                  <div className="flex flex-wrap gap-2">
                    {r.status === "received" && (
                      <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void mark(r.id, "in_progress")}>
                        {t("admin.deletion.markInProgress")}
                      </Button>
                    )}
                    <Button size="sm" disabled={busy === r.id} onClick={() => void mark(r.id, "completed")}>
                      {t("admin.deletion.markCompleted")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
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
