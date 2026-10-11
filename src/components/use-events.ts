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
 */
const shared: {
  source: EventSource | null;
  subscribers: Set<HandlersRef>;
  hadError: boolean;
} = { source: null, subscribers: new Set(), hadError: false };

function connect(): void {
  if (shared.source) return;
  const source = new EventSource("/api/events");
  shared.source = source;
  shared.hadError = false;
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
  };
  source.onopen = () => {
    if (!shared.hadError) return;
    shared.hadError = false;
    for (const ref of [...shared.subscribers]) ref.current.onReconnect?.();
  };
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
    if (shared.subscribers.size === 0 && shared.source) {
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
