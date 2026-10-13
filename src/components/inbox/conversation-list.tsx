"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, Search, Sparkles, Trash2, UserRound, X } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { matchesQuery } from "@/lib/search";
import { useT } from "@/lib/i18n/client";
import { isOrgAdmin } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { useRole } from "@/components/role-context";
import { Button } from "@/components/ui/button";
import { defaultStageKeyOf, stageLabel, type DefaultStageKey } from "@/lib/stages";
import { ListSkeleton } from "@/components/ui/skeleton";
import {
  formatTime,
  handoffLabel,
  matchesInboxFilter,
  needsHuman,
  previewText,
  sortHandoffFirst,
  type InboxFilter,
} from "./helpers";

/** Color del punto de cada etapa de fábrica (por clave: vale en los tres idiomas). */
const STAGE_DOT: Record<DefaultStageKey, string> = {
  new: "#9ca3af",
  talking: "#7b93b3",
  interested: "#b08b5e",
  won: "#5f8f74",
  lost: "#a2504c",
};

function stageDot(name: string): string {
  const key = defaultStageKeyOf(name);
  return key ? STAGE_DOT[key] : "#9ca3af";
}

function EmptyState({ onSeeded }: { onSeeded: () => void }) {
  const { t } = useT();
  const [seeding, setSeeding] = useState(false);
  const [failed, setFailed] = useState(false);
  // Cargar la demo es de owner/admin (la API lo exige): al resto no se le ofrece.
  const canSeed = isOrgAdmin(useRole());

  async function seed() {
    setSeeding(true);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(
      () => null
    );
    setSeeding(false);
    if (res?.ok) onSeeded();
    else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium">{t("inbox.empty.title")}</p>
      <p className="text-xs text-text-3">{t("inbox.empty.body")}</p>
      {canSeed && !failed && (
        <Button
          size="sm"
          variant="outline"
          disabled={seeding}
          onClick={() => void seed()}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.7} />
          {seeding ? t("inbox.empty.seeding") : t("inbox.empty.seed")}
        </Button>
      )}
    </div>
  );
}

/**
 * 007 — "Quitar datos demo", junto a la carga de la demo. Como la demo solo
 * se carga con la bandeja vacía, este control aparece cuando la organización
 * TIENE datos demo (GET /api/seed/demo), con o sin conversaciones. Solo
 * owner/admin (la API lo exige igual).
 */
function DemoRemoval({
  refreshKey,
  onRemoved,
}: {
  refreshKey: number;
  onRemoved: () => void;
}) {
  const { t } = useT();
  const canManage = isOrgAdmin(useRole());
  const [hasDemo, setHasDemo] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    void fetch("/api/seed/demo")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasDemo?: boolean } | null) => {
        if (alive) setHasDemo(Boolean(data?.hasDemo));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [canManage, refreshKey]);

  if (!canManage || !hasDemo) return null;

  async function remove() {
    if (!window.confirm(t("inbox.empty.removeDemoConfirm"))) return;
    setRemoving(true);
    setFailed(false);
    const res = await fetch("/api/seed/demo", { method: "DELETE" }).catch(
      () => null
    );
    setRemoving(false);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setHasDemo(false);
    onRemoved();
  }

  return (
    <div className="flex items-center gap-2 border-b bg-secondary px-4 py-2 text-xs text-text-2">
      <span className="min-w-0 flex-1">
        {failed ? t("inbox.empty.removeDemoError") : t("inbox.empty.demoLoaded")}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={removing}
        onClick={() => void remove()}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.7} />
        {removing ? t("inbox.empty.removingDemo") : t("inbox.empty.removeDemo")}
      </Button>
    </div>
  );
}

export function ConversationList({
  conversations: conversationsProp,
  selectedId,
  onSelect,
  onSeeded,
  loadFailed = false,
}: {
  conversations: ConversationDto[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeeded: () => void;
  /** 009 (E3): la primera carga falló (la lista sigue en `null`). */
  loadFailed?: boolean;
}) {
  const { t, locale } = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [stage, setStage] = useState<string>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Rescate de lo tecleado ANTES de que hidratara el JS. La caja se pinta en
   * el HTML del servidor, así que se puede escribir en ella mientras carga la
   * página; al montar, React la dejaba vacía y esas pulsaciones se perdían en
   * silencio (el usuario veía la lista entera "sin filtrar"). Por eso el input
   * es NO controlado: el DOM manda y aquí solo adoptamos su valor.
   */
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const loading = conversationsProp === null;
  const conversations = conversationsProp ?? [];
  // Solo NOMBRE y TELÉFONO, como cualquier filtro de contactos. Antes también
  // miraba el preview, y como el agente nombra al dueño en sus propios
  // mensajes, buscar ese nombre devolvía media bandeja. Encima era una
  // búsqueda de mensajes a medias: solo el último de cada hilo, no el historial.
  const searched = conversations.filter(
    (c) =>
      matchesQuery(query, {
        text: [c.contact.name],
        phone: c.contact.phone,
      }) && (stage === "all" || c.stageName === stage)
  );
  const unreadCount = searched.filter((c) => c.unreadCount > 0).length;
  const handoffCount = searched.filter(needsHuman).length;
  // 009 (E1c): lo que espera a una persona va arriba, en cualquier filtro.
  const visible = sortHandoffFirst(
    searched.filter((c) => matchesInboxFilter(c, filter))
  );

  // Etapas presentes en la bandeja, en el orden en que llegan del pipeline.
  const stages: string[] = [];
  for (const c of conversations) {
    if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
  }

  function clearQuery() {
    if (inputRef.current) inputRef.current.value = "";
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 pb-3 pt-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[17px] font-[650] tracking-tight">{t("inbox.title")}</h2>
          <span className="text-sm text-text-3">{conversations.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-secondary px-3 py-[7px] transition-colors focus-within:border-brand focus-within:bg-background focus-within:ring-[3px] focus-within:ring-brand-soft">
          <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
          <input
            ref={inputRef}
            placeholder={t("inbox.search")}
            aria-label={t("inbox.searchAria")}
            defaultValue=""
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
          {query && (
            <button
              onClick={clearQuery}
              aria-label={t("inbox.clearSearch")}
              className="shrink-0 rounded-full p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
        {(
          [
            { id: "all", label: t("inbox.filters.all"), count: searched.length },
            { id: "unread", label: t("inbox.filters.unread"), count: unreadCount },
            { id: "handoff", label: t("inbox.filters.handoff"), count: handoffCount },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors",
              filter === f.id
                ? "border-brand bg-brand text-brand-fg"
                : "bg-background text-text-2 hover:bg-accent"
            )}
          >
            {f.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px]",
                filter === f.id ? "bg-brand-veil" : "bg-secondary text-text-3"
              )}
            >
              {f.count}
            </span>
          </button>
        ))}

        {stages.length > 0 && (
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label={t("inbox.filters.stageAria")}
            className={cn(
              "ml-auto min-w-0 max-w-[42%] truncate rounded-full border px-2 py-[5px] text-[12.5px] font-medium transition-colors",
              stage === "all"
                ? "bg-background text-text-2 hover:bg-accent"
                : "border-brand bg-brand text-brand-fg"
            )}
          >
            <option value="all">{t("inbox.filters.allStages")}</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {stageLabel(s, locale)}
              </option>
            ))}
          </select>
        )}
      </div>

      <DemoRemoval refreshKey={conversations.length} onRemoved={onSeeded} />

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          loadFailed ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <p className="text-xs text-text-3">{t("common.loadError")}</p>
              <Button size="sm" variant="outline" onClick={onSeeded}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <ListSkeleton rows={7} />
          )
        ) : conversations.length === 0 ? (
          <EmptyState onSeeded={onSeeded} />
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-3">
            {t("inbox.noResults")}
          </p>
        ) : (
          <ul>
            {visible.map((c) => {
              const unread = c.unreadCount > 0;
              const active = selectedId === c.id;
              return (
                <li key={c.id} className="relative border-b border-border/70">
                  {active && (
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
                  )}
                  <button
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "flex w-full items-start gap-[11px] px-4 py-[var(--row-py)] text-left transition-colors",
                      active ? "bg-[var(--bg-active)]" : "hover:bg-subtle"
                    )}
                  >
                    <span className="relative shrink-0">
                      <ContactAvatar name={c.contact.name} seed={c.contact.id} size="lg" />
                      {c.windowOpen && (
                        <span className="absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full border-[2.5px] border-background bg-success" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            unread ? "font-[680]" : "font-semibold"
                          )}
                        >
                          {c.contact.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[11.5px]",
                            unread ? "font-semibold text-brand" : "text-text-3"
                          )}
                        >
                          {formatTime(c.lastMessageAt, locale)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            unread ? "font-medium text-text-2" : "text-text-3"
                          )}
                        >
                          {previewText(c.preview, t)}
                        </span>
                        {unread && (
                          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-brand-fg">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        {c.stageName && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-2 py-0.5 text-[11px] text-text-2">
                            <span
                              className="h-[7px] w-[7px] rounded-full"
                              style={{
                                background: stageDot(c.stageName),
                              }}
                            />
                            {stageLabel(c.stageName, locale)}
                          </span>
                        )}
                        {c.agentRetryAt ? (
                          // 009 (E1): el agente reintentará solo; aún no es
                          // trabajo para una persona.
                          <span
                            data-retry-pending=""
                            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-info-soft bg-info-tint px-2 py-0.5 text-[11px] text-info-text"
                          >
                            <RotateCcw className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                            <span className="truncate">{t("inbox.retryPending")}</span>
                          </span>
                        ) : c.handoffAt && (
                          // 009 (E1c): el motivo a la vista; un fallo del
                          // proveedor de IA se distingue en rojo.
                          <span
                            title={t("inbox.handoff")}
                            className={cn(
                              "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                              c.handoffReason === "error"
                                ? "border-danger-soft bg-danger-tint text-danger-text"
                                : "border-warning-soft bg-warning-tint text-warning-text"
                            )}
                          >
                            {c.handoffReason === "error" ? (
                              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.8} />
                            ) : (
                              <UserRound className="h-3 w-3 shrink-0" strokeWidth={1.7} />
                            )}
                            <span className="truncate">{handoffLabel(c.handoffReason, t)}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
