"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, RotateCcw, Sparkles, UserRound } from "lucide-react";
import type {
  ConversationDto,
  FichaDto,
  FichaValue,
  StageDto,
} from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FichaPanel } from "@/components/ficha-panel";
import { handoffLabel } from "./helpers";
import { stageLabel } from "@/lib/stages";
import { Switch } from "@/components/ui/switch";
import { intlLocale } from "@/lib/i18n";

/** Resultado de «Riprova risposta IA»: `null` = lanzado; si no, el código. */
export type RetryAiResult =
  | null
  | "ai_not_configured"
  | "agent_disabled"
  | "not_retryable"
  | "already_answered"
  | "retry_cooldown"
  | "failed";

export const RETRY_AI_CODES = [
  "ai_not_configured",
  "agent_disabled",
  "not_retryable",
  "already_answered",
  "retry_cooldown",
] as const;

export function ContactPanel({
  conversation,
  refreshKey = 0,
  onPatchConversation,
  onRetryAi,
  onClose,
}: {
  conversation: ConversationDto;
  /** Aumenta con cada evento SSE relevante: dispara un refetch en vivo. */
  refreshKey?: number;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
  /** 009 (E1c): quita el handoff y lanza un turno del agente ya. */
  onRetryAi?: () => Promise<RetryAiResult>;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [notes, setNotes] = useState("");
  const [ficha, setFicha] = useState<FichaDto>({});
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  // Estado global del agente: sin esto, el toggle "Respondiendo" mentiría
  // cuando el agente aún no se ha configurado/encendido.
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState<{ ok: boolean; text: string } | null>(null);

  const contactId = conversation.contact.id;

  // El aviso de «Riprova» es de ESTA conversación: al cambiar, se va.
  useEffect(() => {
    setRetryNote(null);
  }, [conversation.id]);

  async function retryAi() {
    if (!onRetryAi) return;
    setRetrying(true);
    setRetryNote(null);
    const result = await onRetryAi();
    setRetrying(false);
    setRetryNote(
      result === null
        ? { ok: true, text: t("inbox.panel.retryStarted") }
        : { ok: false, text: t(`inbox.panel.retryErrors.${result}`) }
    );
  }

  const agentReady = aiConfigured && agentEnabled;
  // El control es la FUENTE DE VERDAD de la conversación: el agente in-process
  // y cualquier cerebro externo conectado por /api/bot/* respetan este flag,
  // así que el toggle opera siempre — `agentReady` solo matiza el texto.
  const aiActive = conversation.aiEnabled && !conversation.handoffAt;

  // Carga inicial (incluye notas): se re-ejecuta al cambiar de contacto.
  const refetch = useCallback(async () => {
    const [detail, stagesRes, agentRes] = await Promise.all([
      fetch(`/api/contacts/${contactId}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/pipeline/stages").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null]);
    if (detail) {
      setNotes(detail.contact?.notes ?? "");
      setFicha(detail.contact?.ficha ?? {});
      setCurrentStageId(detail.stage?.id ?? null);
      setLeadId(detail.lead?.id ?? null);
    }
    if (stagesRes) setStages(stagesRes.stages);
    setAgentEnabled(Boolean(agentRes?.profile?.enabled));
    setAiConfigured(Boolean(agentRes?.aiConfigured));
    setNotesLoaded(true);
  }, [contactId]);

  // Refetch en vivo (etapa/lead + estado del agente) SIN tocar las notas, para
  // no pisar lo que el operador esté escribiendo. Lo dispara el SSE.
  const refreshLive = useCallback(async () => {
    const [detail, agentRes] = await Promise.all([
      fetch(`/api/contacts/${contactId}`).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (detail) {
      // La ficha SÍ se refresca en vivo: el agente la va llenando mientras la
      // conversación ocurre, y verla aparecer sola es justo para lo que sirve.
      // No pisa una edición a medias — el borrador vive dentro del panel.
      setFicha(detail.contact?.ficha ?? {});
      setCurrentStageId(detail.stage?.id ?? null);
      setLeadId(detail.lead?.id ?? null);
    }
    if (agentRes) {
      setAgentEnabled(Boolean(agentRes.profile?.enabled));
      setAiConfigured(Boolean(agentRes.aiConfigured));
    }
  }, [contactId]);

  useEffect(() => {
    setNotesLoaded(false);
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!notesLoaded) return; // la carga inicial ya trae el estado fresco
    void refreshLive();
  }, [refreshKey, notesLoaded, refreshLive]);

  async function moveToStage(stageId: string) {
    if (!leadId || stageId === currentStageId) return;
    setCurrentStageId(stageId); // optimista
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId, position: 0 }),
    }).catch(() => null);
    void refreshLive();
  }

  /** Manda SOLO lo que cambió: el servidor hace merge (ver `server/bot/ficha`). */
  async function saveFicha(patch: Record<string, FichaValue | null>) {
    setFicha((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return next; // optimista: el refetch de abajo confirma
    });
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ficha: patch }),
    }).catch(() => null);
    void refreshLive();
  }

  async function saveNotes() {
    setSavingNotes(true);
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    }).catch(() => null);
    setSavingNotes(false);
  }

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 flex items-center justify-between border-b bg-background px-4 py-3">
        <h3 className="text-[13px] font-[650] uppercase tracking-wide text-text-2">
          {t("inbox.panel.title")}
        </h3>
        <button
          onClick={onClose}
          aria-label={t("inbox.panel.hide")}
          className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Contacto */}
        <section className="border-b p-4">
          <div className="flex items-center gap-3">
            <ContactAvatar
              name={conversation.contact.name}
              seed={conversation.contact.id}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-[650]">
                {conversation.contact.name}
              </p>
              <p className="text-xs text-text-3">
                {formatPhone(conversation.contact.phone)}
              </p>
              {conversation.contact.email && (
                <p className="truncate text-xs text-text-3">{conversation.contact.email}</p>
              )}
            </div>
          </div>

          {conversation.agentRetryAt && (
            // 009 (E1): handoff provisional — el agente reintentará solo.
            <div
              data-retry-pending=""
              className="mt-3 rounded-md border border-info-soft bg-info-tint p-3"
            >
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-info-text">
                <RotateCcw className="h-4 w-4" strokeWidth={1.7} /> {t("inbox.retryPending")}
              </p>
              <p className="mt-1 text-xs text-info-text opacity-80">
                {t("inbox.retryPendingHint", {
                  time: new Date(conversation.agentRetryAt).toLocaleTimeString(intlLocale(locale), {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </p>
              {onRetryAi && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  disabled={retrying}
                  onClick={() => void retryAi()}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {retrying ? t("inbox.panel.retrying") : t("inbox.panel.retryAi")}
                </Button>
              )}
            </div>
          )}
          {conversation.handoffAt && !conversation.agentRetryAt && (
            <div
              className={cn(
                "mt-3 rounded-md border p-3",
                conversation.handoffReason === "error"
                  ? "border-danger-soft bg-danger-tint"
                  : "border-warning-soft bg-warning-tint"
              )}
            >
              <p
                className={cn(
                  "flex items-center gap-1.5 text-[13px] font-medium",
                  conversation.handoffReason === "error"
                    ? "text-danger-text"
                    : "text-warning-text"
                )}
              >
                {conversation.handoffReason === "error" ? (
                  <AlertTriangle className="h-4 w-4" strokeWidth={1.7} />
                ) : (
                  <UserRound className="h-4 w-4" strokeWidth={1.7} />
                )}{" "}
                {t("inbox.handoff")}
              </p>
              <p
                className={cn(
                  "mt-1 text-xs opacity-80",
                  conversation.handoffReason === "error"
                    ? "text-danger-text"
                    : "text-warning-text"
                )}
              >
                {conversation.handoffReason
                  ? handoffLabel(conversation.handoffReason, t)
                  : t("inbox.handoffReasons.default")}
              </p>
              {onRetryAi && conversation.handoffReason === "error" && (
                // 009 (E1c): volver a intentar la respuesta de la IA AHORA.
                // Solo para un fallo del proveedor: con otro motivo (el
                // cliente pidió una persona, se contestó desde el teléfono…)
                // la IA no debe volver sola; para eso está «Riattiva IA».
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={retrying}
                  onClick={() => void retryAi()}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {retrying ? t("inbox.panel.retrying") : t("inbox.panel.retryAi")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                disabled={retrying}
                onClick={() => void onPatchConversation({ reactivate: true })}
              >
                {t("inbox.panel.reactivate")}
              </Button>
            </div>
          )}
          {retryNote && (
            <p
              role="status"
              className={cn(
                "mt-2 text-xs",
                retryNote.ok ? "text-text-2" : "text-danger-text"
              )}
            >
              {retryNote.text}
            </p>
          )}

          <div className="mt-3 rounded-md border bg-secondary/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{t("inbox.panel.aiTitle")}</p>
                <p className="text-[11px] text-text-3">
                  {conversation.agentRetryAt
                    ? t("inbox.retryPending")
                    : conversation.handoffAt
                    ? t("inbox.panel.stateHandoff")
                    : !conversation.aiEnabled
                      ? t("inbox.panel.statePaused")
                      : agentReady
                        ? t("inbox.panel.stateReplying")
                        : t("inbox.panel.stateEnabled")}
                </p>
              </div>
              <Switch
                size="sm"
                checked={aiActive}
                label={t("inbox.panel.aiTitle")}
                onCheckedChange={() => {
                  void onPatchConversation({
                    aiEnabled: !conversation.aiEnabled,
                  });
                }}
              />
            </div>

            {!agentReady && (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-2.5">
                <Sparkles
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text"
                  strokeWidth={1.7}
                />
                <p className="text-[11px] leading-relaxed text-warning-text">
                  {aiConfigured
                    ? t("inbox.panel.agentNotReady")
                    : t("inbox.panel.aiNotConfigured")}
                  {aiConfigured && (
                    <Link
                      href="/agent"
                      className="ml-1 whitespace-nowrap font-medium text-brand-text underline underline-offset-2 hover:text-brand"
                    >
                      {t("inbox.panel.configureAgent")}
                    </Link>
                  )}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Stepper de etapa */}
        {stages.length > 0 && leadId && (
          <section className="border-b p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              {t("inbox.panel.stage")}
            </p>
            <ol>
              {stages.map((s, i) => {
                const done = currentIndex >= 0 && i < currentIndex;
                const current = s.id === currentStageId;
                return (
                  <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < stages.length - 1 && (
                      <span
                        className={cn(
                          "absolute left-[7px] top-4 h-full w-px",
                          done ? "bg-brand" : "bg-border-strong"
                        )}
                      />
                    )}
                    <button
                      onClick={() => void moveToStage(s.id)}
                      aria-label={t("inbox.panel.moveTo", { name: stageLabel(s.name, locale) })}
                      className={cn(
                        "relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full transition-colors",
                        done && "bg-brand text-brand-fg",
                        current && "bg-brand ring-4 ring-brand-soft",
                        !done && !current && "border border-border-strong bg-background hover:border-brand"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => void moveToStage(s.id)}
                      className={cn(
                        "text-left text-[13px]",
                        current ? "font-[650] text-brand-text" : "text-text-2 hover:text-foreground"
                      )}
                    >
                      {stageLabel(s.name, locale)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Ficha: lo que se SABE del lead. Va antes de Notas —lo que alguien
            OPINA— porque es lo que se consulta a mitad de una conversación. */}
        <FichaPanel ficha={ficha} onSave={saveFicha} />

        {/* Notas */}
        <section className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t("inbox.panel.notes")}
          </p>
          <Textarea
            rows={5}
            placeholder={t("inbox.panel.notesPlaceholder")}
            value={notes}
            disabled={!notesLoaded}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={savingNotes || !notesLoaded}
            onClick={() => void saveNotes()}
          >
            {savingNotes ? t("inbox.panel.saving") : t("inbox.panel.saveNotes")}
          </Button>
        </section>
      </div>
    </div>
  );
}
