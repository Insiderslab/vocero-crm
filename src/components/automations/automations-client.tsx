"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import type { TagDto } from "@/lib/types";
import { useT } from "@/lib/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TemplateDto = {
  id: string;
  name: string;
  body: string;
  status: string;
};

type Rule = {
  id: string;
  name: string;
  tagId: string;
  tagName: string;
  templateId: string;
  templateName: string;
  templateStatus: string;
  templateBody: string;
  intervalDays: number;
  enabled: boolean;
  createdAt: string;
};

type Run = {
  id: string;
  contactName: string;
  contactPhone: string | null;
  status: "sent" | "failed" | "skipped";
  detail: string | null;
  createdAt: string;
};

export function AutomationsClient() {
  const { t } = useT();
  const [rules, setRules] = useState<Rule[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);

  const [name, setName] = useState("");
  const [tagId, setTagId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [intervalDays, setIntervalDays] = useState("90");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/automations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { rules: Rule[] };
    setRules(data.rules);
  }, []);

  useEffect(() => {
    void refetch();
    void (async () => {
      const [tagsRes, tplRes] = await Promise.all([
        fetch("/api/tags").catch(() => null),
        fetch("/api/templates").catch(() => null),
      ]);
      if (tagsRes?.ok) {
        const data = (await tagsRes.json()) as { tags: TagDto[] };
        setTags(data.tags);
      }
      if (tplRes?.ok) {
        const data = (await tplRes.json()) as { templates: TemplateDto[] };
        setTemplates(data.templates.filter((t) => t.status === "approved"));
      }
    })();
  }, [refetch]);

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        tagId,
        templateId,
        intervalDays: Number(intervalDays),
      }),
    }).catch(() => null);
    setCreating(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? t("admin.automations.createError"));
      return;
    }
    setName("");
    setTagId("");
    setTemplateId("");
    void refetch();
  }

  async function toggleEnabled(rule: Rule) {
    await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    }).catch(() => null);
    void refetch();
  }

  async function remove(rule: Rule) {
    if (!confirm(t("admin.automations.confirmDelete", { name: rule.name })))
      return;
    await fetch(`/api/automations/${rule.id}`, { method: "DELETE" }).catch(
      () => null
    );
    void refetch();
  }

  async function toggleRuns(ruleId: string) {
    if (expanded === ruleId) {
      setExpanded(null);
      return;
    }
    setExpanded(ruleId);
    const res = await fetch(`/api/automations/${ruleId}/runs`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { runs: Run[] };
    setRuns(data.runs);
  }

  async function runNow() {
    setRunning(true);
    setRunResult(null);
    const res = await fetch("/api/automations/run", { method: "POST" }).catch(
      () => null
    );
    setRunning(false);
    if (!res?.ok) {
      setRunResult(t("admin.automations.runFailed"));
      return;
    }
    const data = (await res.json()) as {
      stats: { sent: number; failed: number; skippedWindow: number; skippedCooldown: number };
    };
    const s = data.stats;
    setRunResult(
      t("admin.automations.runResult", {
        sent: s.sent,
        failed: s.failed,
        skippedWindow: s.skippedWindow,
        skippedCooldown: s.skippedCooldown,
      })
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.automations.newTitle")}</CardTitle>
          <CardDescription>
            {t("admin.automations.newDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">
              {t("admin.automations.ruleName")}
            </Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin.automations.ruleNamePlaceholder")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="rule-tag">{t("admin.automations.tag")}</Label>
              <select
                id="rule-tag"
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">{t("admin.automations.choose")}</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-template">
                {t("admin.automations.template")}
              </Label>
              <select
                id="rule-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">{t("admin.automations.choose")}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-interval">
                {t("admin.automations.interval")}
              </Label>
              <Input
                id="rule-interval"
                type="number"
                min={1}
                max={3650}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
              />
            </div>
          </div>
          {templates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("admin.automations.noTemplates")}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            disabled={
              creating ||
              !name.trim() ||
              !tagId ||
              !templateId ||
              !Number(intervalDays)
            }
            onClick={() => void create()}
          >
            <Plus className="h-4 w-4" />
            {creating
              ? t("admin.automations.creating")
              : t("admin.automations.createSubmit")}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("admin.automations.rulesTitle")}
        </p>
        <div className="flex items-center gap-2">
          {runResult && (
            <span className="text-xs text-muted-foreground">{runResult}</span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={running}
            onClick={() => void runNow()}
          >
            <Play className="h-4 w-4" />
            {running
              ? t("admin.automations.running")
              : t("admin.automations.runNow")}
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Zap className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("admin.automations.emptyPre")}{" "}
            <em>{t("admin.automations.emptyTag")}</em>
            {t("admin.automations.emptyPost")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  onClick={() => void toggleRuns(r.id)}
                  aria-label={
                    expanded === r.id
                      ? t("admin.automations.collapse")
                      : t("admin.automations.viewRuns")
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  {expanded === r.id ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.automations.summary", {
                      tag: r.tagName,
                      template: r.templateName,
                      days: r.intervalDays,
                    })}
                  </p>
                </div>
                {r.templateStatus !== "approved" && (
                  <Badge variant="secondary">
                    {t("admin.automations.templateStatus", {
                      status: r.templateStatus,
                    })}
                  </Badge>
                )}
                <Badge variant={r.enabled ? "default" : "secondary"}>
                  {r.enabled
                    ? t("admin.automations.active")
                    : t("admin.automations.paused")}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void toggleEnabled(r)}
                >
                  {r.enabled
                    ? t("admin.automations.pause")
                    : t("admin.automations.resume")}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("admin.automations.delete")}
                  onClick={() => void remove(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {expanded === r.id && (
                <div className="border-t px-4 py-3">
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("admin.automations.noRuns")}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {runs.map((run) => (
                        <li
                          key={run.id}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <Badge
                            variant={
                              run.status === "sent" ? "default" : "destructive"
                            }
                          >
                            {run.status === "sent"
                              ? t("admin.automations.statusSent")
                              : t("admin.automations.statusFailed")}
                          </Badge>
                          <span className="font-medium">{run.contactName}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(run.createdAt).toLocaleString()}
                            {run.detail ? ` · ${run.detail}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
