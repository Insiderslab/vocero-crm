"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useEvents } from "@/components/use-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";

type Run = {
  id: string;
  status: "running" | "done" | "failed";
  score: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  delta: number | null;
};

type Hallazgo = {
  tipo: "alucinacion" | "fuera_de_kb" | "debio_escalar" | "tono";
  evidencia: string;
  sugerencia?: { pregunta: string; respuesta: string };
};

type Case = {
  id: string;
  persona: string;
  personaLabel: string;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Hallazgo[];
  transcript: { role: "cliente" | "agente"; text: string }[];
};

const TIPO_KEYS: Record<Hallazgo["tipo"], string> = {
  alucinacion: "lab.findings.alucinacion",
  fuera_de_kb: "lab.findings.fuera_de_kb",
  debio_escalar: "lab.findings.debio_escalar",
  tono: "lab.findings.tono",
};

export function LabClient() {
  const { t } = useT();
  const [runs, setRuns] = useState<Run[]>([]);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: Run; cases: Case[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetchRuns = useCallback(async () => {
    const res = await fetch("/api/lab/runs").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { runs: Run[]; aiConfigured: boolean };
    setRuns(data.runs);
    setAiConfigured(data.aiConfigured);
    if (!selectedRunId && data.runs[0]) setSelectedRunId(data.runs[0].id);
  }, [selectedRunId]);

  const refetchDetail = useCallback(async (runId: string) => {
    const res = await fetch(`/api/lab/runs/${runId}`).catch(() => null);
    if (!res?.ok) return;
    setDetail((await res.json()) as { run: Run; cases: Case[] });
  }, []);

  useEffect(() => {
    void refetchRuns();
  }, [refetchRuns]);

  useEffect(() => {
    if (selectedRunId) void refetchDetail(selectedRunId);
  }, [selectedRunId, refetchDetail]);

  useEvents({
    onLabRun: (data) => {
      setProgress(data.status === "running" ? data.progress : null);
      void refetchRuns();
      if (selectedRunId === data.runId || !selectedRunId) {
        setSelectedRunId(data.runId);
        void refetchDetail(data.runId);
      }
    },
  });

  async function launch() {
    setLaunching(true);
    setError(null);
    const res = await fetch("/api/lab/runs", { method: "POST" }).catch(() => null);
    setLaunching(false);
    if (!res) return;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? t("lab.launchError"));
      return;
    }
    const data = (await res.json()) as { runId: string };
    setSelectedRunId(data.runId);
    setProgress({ done: 0, total: 6 });
    void refetchRuns();
  }

  if (!aiConfigured) {
    return (
      <div className="flex h-full flex-col">
        <Header running={false} launching={false} onLaunch={() => {}} disabled />
        <div className="m-6 rounded-lg border border-brand-soft bg-brand-tint p-8 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">
            {t("lab.setupTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("lab.setupBody1")}
            <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code>
            {t("lab.setupBody2")}
          </p>
        </div>
      </div>
    );
  }

  const running = runs.some((r) => r.status === "running");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Header
        running={running}
        launching={launching}
        onLaunch={() => void launch()}
        disabled={false}
      />
      {error && <p className="px-4 pt-3 text-sm text-destructive sm:px-6">{error}</p>}

      {running && progress && (
        <div className="mx-6 mt-4 rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">{t("lab.progress")}</span>
            <span className="text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-[280px_1fr]">
        <HistoryList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
        {detail ? (
          <Report detail={detail} onApplied={() => void refetchDetail(detail.run.id)} />
        ) : (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {runs.length === 0
              ? t("lab.emptyFirst")
              : t("lab.emptySelect")}
          </div>
        )}
      </div>
    </div>
  );
}

function Header({
  running,
  launching,
  onLaunch,
  disabled,
}: {
  running: boolean;
  launching: boolean;
  onLaunch: () => void;
  disabled: boolean;
}) {
  const { t } = useT();
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <FlaskConical className="h-4 w-4 text-primary" /> {t("lab.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("lab.subtitle")}
        </p>
      </div>
      <Button onClick={onLaunch} disabled={disabled || running || launching}>
        <Play className="h-4 w-4" />
        {running ? t("lab.running") : t("lab.run")}
      </Button>
    </header>
  );
}

function HistoryList({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("lab.history")}
      </p>
      {runs.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("lab.historyEmpty")}</p>
      )}
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 ${
            selectedRunId === run.id ? "border-primary/50 bg-accent/60" : "bg-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <ScoreBadge run={run} />
            {run.delta !== null && run.delta !== 0 && (
              <span
                className={`flex items-center gap-0.5 text-xs font-medium ${
                  run.delta > 0 ? "text-success" : "text-destructive"
                }`}
              >
                {run.delta > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {run.delta > 0 ? "+" : ""}
                {run.delta}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {new Date(run.startedAt).toLocaleString(locale, {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </button>
      ))}
    </div>
  );
}

function ScoreBadge({ run }: { run: Run }) {
  const { t } = useT();
  if (run.status === "running") return <Badge variant="secondary">{t("lab.statusRunning")}</Badge>;
  if (run.status === "failed") return <Badge variant="destructive">{t("lab.statusFailed")}</Badge>;
  const score = run.score ?? 0;
  const variant = score >= 80 ? "success" : score >= 50 ? "warning" : "destructive";
  return <Badge variant={variant}>{t("lab.score", { score })}</Badge>;
}

function Report({
  detail,
  onApplied,
}: {
  detail: { run: Run; cases: Case[] };
  onApplied: () => void;
}) {
  const { t } = useT();
  const { run, cases } = detail;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("lab.report")}</CardTitle>
            <ScoreBadge run={run} />
          </div>
          {run.status === "failed" && (
            <p className="text-sm text-destructive">
              {t("lab.failed", { error: run.error ?? t("lab.unknownError") })}
            </p>
          )}
        </CardHeader>
        {run.status === "done" && (
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              {(["verde", "amarillo", "rojo"] as const).map((v) => (
                <div key={v} className="rounded-md border p-3">
                  <p className="text-2xl font-bold">
                    {cases.filter((c) => c.veredicto === v).length}
                  </p>
                  <p className="capitalize text-muted-foreground">{t(`lab.verdicts.${v}`)}</p>
                </div>
              ))}
            </div>
            {cases.some((c) => c.status === "judge_failed") && (
              <p className="mt-3 text-xs text-warning-text">
                {t("lab.judgeFailed", {
                  count: cases.filter((c) => c.status === "judge_failed").length,
                })}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {cases.map((c) => (
        <CaseCard key={c.id} testCase={c} onApplied={onApplied} />
      ))}
    </div>
  );
}

function CaseCard({ testCase, onApplied }: { testCase: Case; onApplied: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const c = testCase;
  const customerLabel = t("lab.customer");
  const agentLabel = t("lab.agentRole");
  const icon =
    c.veredicto === "verde" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : c.veredicto === "amarillo" ? (
      <AlertTriangle className="h-4 w-4 text-warning-text" />
    ) : c.veredicto === "rojo" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setOpen(!open)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {c.personaLabel}
            {c.status === "judge_failed" && (
              <Badge variant="secondary">{t("lab.noVerdict")}</Badge>
            )}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {c.hallazgos.length > 0 && t("lab.findingsCount", { count: c.hallazgos.length })}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {c.hallazgos.map((h, i) => (
            <HallazgoCard key={i} hallazgo={h} caseId={c.id} index={i} onApplied={onApplied} />
          ))}
          <div className="rounded-md border bg-background/40 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("lab.transcript")}
            </p>
            <div className="space-y-1.5 text-sm">
              {c.transcript.map((t, i) => (
                <p key={i}>
                  <span
                    className={
                      t.role === "cliente" ? "text-info" : "text-primary"
                    }
                  >
                    {t.role === "cliente" ? customerLabel : agentLabel}:
                  </span>{" "}
                  {t.text}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function HallazgoCard({
  hallazgo,
  caseId,
  index,
  onApplied,
}: {
  hallazgo: Hallazgo;
  caseId: string;
  index: number;
  onApplied: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [pregunta, setPregunta] = useState(hallazgo.sugerencia?.pregunta ?? "");
  const [respuesta, setRespuesta] = useState(hallazgo.sugerencia?.respuesta ?? "");
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    const res = await fetch("/api/lab/suggestions/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, hallazgoIndex: index, pregunta, respuesta }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setApplied(true);
      setEditing(false);
      onApplied();
    }
  }

  return (
    <div className="rounded-md border border-warning-soft bg-warning-tint p-3">
      <div className="flex items-center justify-between">
        <Badge variant="warning">{t(TIPO_KEYS[hallazgo.tipo])}</Badge>
        {hallazgo.sugerencia && !applied && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {t("lab.addToKb")}
          </Button>
        )}
        {applied && (
          <span className="text-xs text-success">{t("lab.addedToKb")}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{t("lab.evidence")}</span>{" "}
        {hallazgo.evidencia}
      </p>
      {editing && hallazgo.sugerencia && (
        <div className="mt-3 space-y-2 rounded-md border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor={`sug-q-${caseId}-${index}`}>{t("lab.question")}</Label>
            <Input
              id={`sug-q-${caseId}-${index}`}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`sug-a-${caseId}-${index}`}>{t("lab.answer")}</Label>
            <Textarea
              id={`sug-a-${caseId}-${index}`}
              rows={3}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={saving || !pregunta.trim() || !respuesta.trim()}
            >
              {saving ? t("lab.saving") : t("lab.saveToKb")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("lab.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
