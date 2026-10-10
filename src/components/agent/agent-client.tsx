"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import {
  createLatestGate,
  initServerForm,
  readSaveResult,
  serverFormReducer,
  type SaveResult,
} from "./form-sync";

type Profile = {
  enabled: boolean;
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
};

type Restriction = {
  restrictToAllowlist: boolean;
  allowedIdentities: string[];
  outsiderReply: string | null;
};

type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

/** Campos del formulario de comportamiento (el interruptor va aparte). */
type BehaviorForm = Omit<Profile, "enabled">;

function behaviorOf(p: Profile): BehaviorForm {
  return {
    name: p.name,
    tone: p.tone,
    instructions: p.instructions,
    escalationRules: p.escalationRules,
    greeting: p.greeting,
  };
}

/** Mensaje de error de un guardado: el texto fijo + el del servidor si lo hay. */
function saveErrorText(fallback: string, message: string | null): string {
  return message ? `${fallback} (${message})` : fallback;
}

export function AgentClient() {
  const { t } = useT();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restriction, setRestriction] = useState<Restriction | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [kbSize, setKbSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Un segundo clic con el primer PUT en vuelo mandaría el mismo valor viejo.
  const [toggling, setToggling] = useState(false);

  // Solo la respuesta del ÚLTIMO refetch se aplica (las viejas se ignoran).
  const refetchGate = useRef(createLatestGate());

  const refetch = useCallback(async () => {
    const ticket = refetchGate.current.begin();
    const [p, kb, size] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (!refetchGate.current.isLatest(ticket)) return;
    if (p) {
      setProfile(p.profile);
      setRestriction(p.restriction ?? null);
      setAiConfigured(p.aiConfigured);
    }
    if (kb) setEntries(kb.entries);
    if (size) setKbSize(size);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("agent.loading")}
      </div>
    );
  }

  /**
   * PUT del perfil. Solo marca "guardado" y recarga si el servidor lo
   * aceptó; si no, devuelve el error y NO toca nada (los valores del usuario
   * se quedan en su formulario).
   */
  async function saveProfile(patch: Partial<Profile>): Promise<SaveResult> {
    const res = await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const result = await readSaveResult(res);
    if (!result.ok) return result;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void refetch();
    return result;
  }

  async function toggleEnabled() {
    setToggleError(null);
    setToggling(true);
    const result = await saveProfile({ enabled: !profile!.enabled });
    setToggling(false);
    if (!result.ok) setToggleError(saveErrorText(t("agent.saveError"), result.message));
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">{t("agent.title")}</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-primary">{t("agent.saved")}</span>}
          {toggleError && <span className="text-xs text-destructive">{toggleError}</span>}
          <span className="text-sm text-muted-foreground">
            {profile.enabled ? t("agent.statusOn") : t("agent.statusOff")}
          </span>
          <button
            role="switch"
            aria-checked={profile.enabled}
            aria-label={t("agent.toggleLabel")}
            disabled={!aiConfigured || toggling}
            onClick={() => void toggleEnabled()}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${
              profile.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-knob transition-transform ${
                profile.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </header>

      {!aiConfigured && (
        <div className="mx-4 mt-4 rounded-lg border border-brand-soft bg-brand-tint p-5 text-center sm:mx-6 sm:mt-6 sm:p-6">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">{t("agent.setupTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("agent.setupBody1")}
            <code className="rounded bg-secondary px-1">OPENROUTER_API_TOKEN</code>
            {t("agent.setupBody2")}
            <code className="rounded bg-secondary px-1">OPENROUTER_MODEL</code>
            {t("agent.setupBody3")}
          </p>
        </div>
      )}

      <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-2">
        <ProfileSection profile={profile} onSave={saveProfile} />
        <KbSection entries={entries} kbSize={kbSize} onChanged={() => void refetch()} />
        {restriction && <RestrictedSection restriction={restriction} onSave={saveProfile} />}
      </div>
    </div>
  );
}

export function ProfileSection({
  profile,
  onSave,
}: {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => Promise<SaveResult>;
}) {
  const { t } = useT();
  const [state, dispatch] = useReducer(
    serverFormReducer<BehaviorForm>,
    behaviorOf(profile),
    initServerForm
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Un refetch (KB, interruptor, otra sección) solo resincroniza si no hay
  // cambios sin guardar aquí.
  useEffect(() => dispatch({ type: "server", value: behaviorOf(profile) }), [profile]);
  const form = state.form;
  const edit = (patch: Partial<BehaviorForm>) => dispatch({ type: "edit", patch });

  async function save() {
    setSaving(true);
    setError(null);
    // Solo los campos de ESTE formulario: jamás el `enabled` de una foto vieja.
    const sent = { ...form };
    const result = await onSave(sent);
    setSaving(false);
    if (!result.ok) {
      setError(saveErrorText(t("agent.saveError"), result.message));
      return;
    }
    dispatch({ type: "saved", value: sent });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("agent.behavior.title")}</CardTitle>
        <CardDescription>
          {t("agent.behavior.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">{t("agent.behavior.nameLabel")}</Label>
          <Input
            id="agent-name"
            value={form.name}
            disabled={saving}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-tone">{t("agent.behavior.toneLabel")}</Label>
          <Input
            id="agent-tone"
            placeholder={t("agent.behavior.tonePlaceholder")}
            value={form.tone ?? ""}
            disabled={saving}
            onChange={(e) => edit({ tone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">{t("agent.behavior.instructionsLabel")}</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            placeholder={t("agent.behavior.instructionsPlaceholder")}
            value={form.instructions ?? ""}
            disabled={saving}
            onChange={(e) => edit({ instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-escalation">{t("agent.behavior.escalationLabel")}</Label>
          <Textarea
            id="agent-escalation"
            rows={3}
            placeholder={t("agent.behavior.escalationPlaceholder")}
            value={form.escalationRules ?? ""}
            disabled={saving}
            onChange={(e) => edit({ escalationRules: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-greeting">{t("agent.behavior.greetingLabel")}</Label>
          <Input
            id="agent-greeting"
            placeholder={t("agent.behavior.greetingPlaceholder")}
            value={form.greeting ?? ""}
            disabled={saving}
            onChange={(e) => edit({ greeting: e.target.value })}
          />
        </div>
        {state.dirty && !error && (
          <p className="text-xs text-muted-foreground">{t("agent.unsaved")}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={saving} onClick={() => void save()}>
          {t("agent.behavior.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

type RestrictionForm = { enabled: boolean; list: string; reply: string };

function restrictionFormOf(r: Restriction): RestrictionForm {
  return {
    enabled: r.restrictToAllowlist,
    // Se guardan solo dígitos; se muestran con «+» (lo que exige la validación).
    list: r.allowedIdentities.map((id) => `+${id}`).join("\n"),
    reply: r.outsiderReply ?? "",
  };
}

/**
 * 007 — Acceso reservado: el agente como asistente interno del equipo. La
 * lista viaja como texto (un número por línea); el servidor la normaliza,
 * valida y deduplica, y la pantalla muestra lo que quedó guardado. Mismas
 * reglas de formulario que el comportamiento (no se pisa lo no guardado).
 */
function RestrictedSection({
  restriction,
  onSave,
}: {
  restriction: Restriction;
  onSave: (patch: Record<string, unknown>) => Promise<SaveResult>;
}) {
  const { t } = useT();
  const [state, dispatch] = useReducer(
    serverFormReducer<RestrictionForm>,
    restrictionFormOf(restriction),
    initServerForm
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(
    () => dispatch({ type: "server", value: restrictionFormOf(restriction) }),
    [restriction]
  );
  const form = state.form;
  const edit = (patch: Partial<RestrictionForm>) => dispatch({ type: "edit", patch });

  async function save() {
    setSaving(true);
    setError(null);
    const result = await onSave({
      restrictToAllowlist: form.enabled,
      allowedIdentities: form.list,
      outsiderReply: form.reply,
    });
    setSaving(false);
    if (!result.ok) {
      setError(
        result.invalid.length > 0
          ? t("agent.restricted.invalid", { lines: result.invalid.join(", ") })
          : saveErrorText(t("agent.restricted.saveError"), result.message)
      );
      return;
    }
    // Lo que de verdad quedó guardado (normalizado) vuelve al formulario.
    const savedRestriction = (result.json as { restriction?: Restriction } | null)?.restriction;
    dispatch({
      type: "saved",
      value: savedRestriction ? restrictionFormOf(savedRestriction) : form,
    });
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{t("agent.restricted.title")}</CardTitle>
            <CardDescription>{t("agent.restricted.description")}</CardDescription>
          </div>
          <Badge variant="secondary">
            {t("agent.restricted.count", {
              count: restriction.allowedIdentities.length,
            })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={saving}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />
          {t("agent.restricted.toggle")}
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="agent-allowlist">{t("agent.restricted.listLabel")}</Label>
          <Textarea
            id="agent-allowlist"
            rows={5}
            placeholder={t("agent.restricted.listPlaceholder")}
            value={form.list}
            disabled={saving}
            onChange={(e) => edit({ list: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-outsider-reply">{t("agent.restricted.outsiderLabel")}</Label>
          <Textarea
            id="agent-outsider-reply"
            rows={2}
            placeholder={t("agent.restricted.outsiderPlaceholder")}
            value={form.reply}
            disabled={saving}
            onChange={(e) => edit({ reply: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t("agent.restricted.outsiderHint")}</p>
        </div>
        {state.dirty && !error && (
          <p className="text-xs text-muted-foreground">{t("agent.unsaved")}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={saving} onClick={() => void save()}>
          {t("agent.restricted.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: { chars: number; warnAt: number; warning: boolean } | null;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [block, setBlock] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Mientras una escritura está en vuelo los campos se bloquean: lo tecleado
  // en ese momento lo borraría el «limpiar» del éxito.
  const [busy, setBusy] = useState(false);

  /**
   * POST/DELETE del KB. Solo limpia el formulario y recarga si el servidor
   * aceptó; si no, muestra el error y deja lo escrito donde estaba.
   */
  async function submit(url: string, init: RequestInit): Promise<boolean> {
    setError(null);
    setBusy(true);
    const res = await fetch(url, init).catch(() => null);
    const result = await readSaveResult(res);
    setBusy(false);
    if (!result.ok) {
      setError(saveErrorText(t("agent.kb.saveError"), result.message));
      return false;
    }
    onChanged();
    return true;
  }

  async function addQa() {
    if (!question.trim() || !answer.trim()) return;
    const ok = await submit("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "qa", question, answer }),
    });
    if (!ok) return;
    setQuestion("");
    setAnswer("");
  }

  async function addBlock() {
    if (!block.trim()) return;
    const ok = await submit("/api/kb", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "block", content: block }),
    });
    if (ok) setBlock("");
  }

  async function remove(id: string) {
    await submit(`/api/kb/${id}`, { method: "DELETE" });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("agent.kb.title")}</CardTitle>
            <CardDescription>
              {t("agent.kb.description")}
            </CardDescription>
          </div>
          {kbSize && (
            <Badge variant={kbSize.warning ? "warning" : "secondary"}>
              {t("agent.kb.chars", { chars: kbSize.chars.toLocaleString(locale) })}
            </Badge>
          )}
        </div>
        {kbSize?.warning && (
          <p className="text-xs text-warning-text">
            {t("agent.kb.warning")}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t("agent.kb.newQa")}</p>
          <Input
            placeholder={t("agent.kb.questionPlaceholder")}
            value={question}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder={t("agent.kb.answerPlaceholder")}
            rows={2}
            value={answer}
            disabled={busy}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void addQa()}
            disabled={busy || !question.trim() || !answer.trim()}
          >
            <Plus className="h-4 w-4" /> {t("agent.kb.addQa")}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t("agent.kb.newBlock")}</p>
          <Textarea
            placeholder={t("agent.kb.blockPlaceholder")}
            rows={3}
            value={block}
            disabled={busy}
            onChange={(e) => setBlock(e.target.value)}
          />
          <Button size="sm" onClick={() => void addBlock()} disabled={busy || !block.trim()}>
            <Plus className="h-4 w-4" /> {t("agent.kb.addBlock")}
          </Button>
        </div>

        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1 text-sm">
                {e.kind === "qa" ? (
                  <>
                    <p className="font-medium">{e.question}</p>
                    <p className="mt-0.5 text-muted-foreground">{e.answer}</p>
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("agent.kb.removeEntry")}
                disabled={busy}
                onClick={() => void remove(e.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              {t("agent.kb.empty")}
            </p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
