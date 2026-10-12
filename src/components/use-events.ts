"use client";

import { useEffect, useRef } from "react";

export type HandoffAlert = {
  conversationId: string;
  reason: string;
  contactName: string | null;
};

export type EventHandlers = {
  onMessageNew?: (data: { conversationId: string; message: unknown }) => void;
  onMessageStatus?: (data: {
    conversationId: string;
    messageId: string;
    status: string;
    /** Motivo, presente solo cuando status = "failed". */
    error?: string | null;
  }) => void;
  onConversationUpdated?: (data: { conversation: unknown }) => void;
  /** 009 (E1d): una conversación acaba de pasar a una persona. */
  onHandoff?: (data: HandoffAlert) => void;
  onLabRun?: (data: {
    runId: string;
    status: string;
    progress: { done: number; total: number };
    score?: number | null;
  }) => void;
  /** Se llama tras RECONECTAR (no en la conexión inicial): catch-up con refetch. */
  onReconnect?: () => void;
};

type HandlersRef = { current: EventHandlers };

/** Evento SSE → manejador. */
const EVENT_HANDLERS: [string, keyof EventHandlers][] = [
  ["message.new", "onMessageNew"],
  ["message.status", "onMessageStatus"],
  ["conversation.updated", "onConversationUpdated"],
  ["conversation.handoff", "onHandoff"],
  ["lab.run", "onLabRun"],
];

/**
 * UNA conexión SSE por pestaña, compartida por todos los componentes que
 * escuchan (barra lateral, avisos, bandeja, Laboratorio). Antes cada uno
 * abría su propio EventSource: en HTTP/1.1 el navegador solo permite 6
 * conexiones por servidor, y dos o tres SSE permanentes más los prefetch de
 * la navegación bastaban para dejar en cola las peticiones de un clic.
 *
 * Al ser compartida y vivir más que cada pantalla, tiene que saber volver a
 * empezar:
 * - al cambiar de organización (`resetEvents`): el canal del servidor es por
 *   organización y se elige al CONECTAR — la conexión vieja seguiría
 *   entregando los eventos de la organización anterior;
 * - cuando el navegador la da por muerta (`readyState === CLOSED`, p. ej. el
 *   servidor respondió 401/5xx): EventSource ya no reintenta solo, así que se
 *   reabre con espera creciente (1 s, 2 s, 4 s… hasta 30 s).
 * En ambos casos, al volver a abrir se llama `onReconnect` (catch-up).
 */
const RECONNECT_MAX_MS = 30_000;
const CLOSED = 2; // EventSource.CLOSED (sin depender del global en el servidor)

const shared: {
  source: EventSource | null;
  subscribers: Set<HandlersRef>;
  hadError: boolean;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
} = { source: null, subscribers: new Set(), hadError: false, attempt: 0, retryTimer: null };

/** Espera antes del intento n (0, 1, 2…): 1 s, 2 s, 4 s… con techo de 30 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attempt);
}

function scheduleReconnect(): void {
  if (shared.retryTimer || shared.subscribers.size === 0) return;
  const delay = reconnectDelay(shared.attempt);
  shared.attempt += 1;
  shared.retryTimer = setTimeout(() => {
    shared.retryTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  if (shared.source || shared.subscribers.size === 0) return;
  const source = new EventSource("/api/events");
  shared.source = source;
  for (const [type, handler] of EVENT_HANDLERS) {
    source.addEventListener(type, (ev) => {
      let data: unknown;
      try {
        data = JSON.parse((ev as MessageEvent).data);
      } catch {
        return; // evento malformado: ignorar
      }
      for (const ref of [...shared.subscribers]) {
        try {
          (ref.current[handler] as ((d: unknown) => void) | undefined)?.(data);
        } catch (err) {
          // Un consumidor que falla no deja sin eventos a los demás.
          console.error(`[sse] manejador de ${type} falló:`, err);
        }
      }
    });
  }
  source.onerror = () => {
    shared.hadError = true;
    // CONNECTING: el navegador reintenta solo. CLOSED: ya no, hay que reabrir.
    if (source.readyState === CLOSED && shared.source === source) {
      source.close();
      shared.source = null;
      scheduleReconnect();
    }
  };
  source.onopen = () => {
    shared.attempt = 0;
    if (!shared.hadError) return;
    shared.hadError = false;
    for (const ref of [...shared.subscribers]) ref.current.onReconnect?.();
  };
}

/**
 * Cierra la conexión y abre otra (p. ej. tras cambiar de organización). Los
 * suscriptores reciben `onReconnect` en cuanto la nueva está abierta.
 */
export function resetEvents(): void {
  if (shared.retryTimer) clearTimeout(shared.retryTimer);
  shared.retryTimer = null;
  shared.attempt = 0;
  if (shared.source) {
    shared.source.close();
    shared.source = null;
  }
  if (shared.subscribers.size === 0) return;
  shared.hadError = true; // la apertura cuenta como reconexión → catch-up
  connect();
}

/**
 * Suscribe un conjunto de manejadores (vía ref, para leer siempre los más
 * nuevos) y devuelve la baja. La conexión se abre con el primero y se cierra
 * con el último.
 */
export function subscribeToEvents(ref: HandlersRef): () => void {
  shared.subscribers.add(ref);
  connect();
  return () => {
    shared.subscribers.delete(ref);
    if (shared.subscribers.size > 0) return;
    if (shared.retryTimer) clearTimeout(shared.retryTimer);
    shared.retryTimer = null;
    shared.attempt = 0;
    shared.hadError = false;
    if (shared.source) {
      shared.source.close();
      shared.source = null;
    }
  };
}

/**
 * Suscripción SSE (contrato sse.md). EventSource reconecta solo; el servidor
 * no garantiza replay, así que al reconectar el consumidor debe refetch con
 * `since=` (onReconnect).
 */
export function useEvents(handlers: EventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => subscribeToEvents(handlersRef), []);
}
