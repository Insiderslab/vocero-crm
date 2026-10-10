"use client";

import { apiErrorMessage } from "@/lib/api-error-message";
import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  FileText,
  MapPin,
  Paperclip,
  Send,
  UserRound,
  X,
} from "lucide-react";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining } from "./helpers";
import { TemplateSender } from "./template-sender";

/** 008 — Panel secundario del clip: formulario de ubicación o contacto. */
type AttachPanel = "location" | "contact" | null;

/** Extrae lat,long de "21.019, -101.257" o de un enlace de Google Maps. */
function parseCoords(raw: string): { latitude: number; longitude: number } | null {
  const m =
    raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ??
    raw.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function Composer({
  conversation,
  onSend,
  onSent,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [panel, setPanel] = useState<AttachPanel>(null);
  const [coordsRaw, setCoordsRaw] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // La URL del preview de imagen se libera al reemplazar/limpiar el archivo.
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function pickFile(f: File | null) {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(f);
    setFilePreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setPanel(null);
    setError(null);
  }

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(path, init);
    if (res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    return apiErrorMessage(data, t("inbox.composer.errorStatus", { status: res.status }));
  }

  async function submit() {
    setError(null);

    if (file) {
      // El adjunto sí espera: sube el archivo y no tiene sentido encolar otro
      // mientras tanto.
      if (sending) return;
      setSending(true);
      const form = new FormData();
      form.set("file", file);
      const caption = text.trim();
      if (caption) form.set("caption", caption);
      const err = await apiSend(
        `/api/conversations/${conversation.id}/messages/media`,
        { method: "POST", body: form }
      );
      setSending(false);
      if (err) {
        setError(err);
        return;
      }
      pickFile(null);
      setText("");
      if (taRef.current) taRef.current.style.height = "auto";
      onSent();
      return;
    }

    const value = text.trim();
    if (!value) return;
    // Aquí NO se espera al servidor. Enviar tarda ~1.5 s (el viaje a Meta) y
    // durante ese rato el renglón siguiente se escribía encima del anterior y
    // salía todo como un solo mensaje. El campo se limpia ya; la burbuja
    // "enviando" del hilo es la que informa el estado real.
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    const err = await onSend(value);
    if (err) {
      setError(err);
      // Lo que no salió vuelve al campo. Si ya empezaste a escribir otra cosa
      // se antepone en vez de pisarte: nada se pierde en silencio.
      setText((actual) => (actual ? `${value}\n${actual}` : value));
      taRef.current?.focus();
      setTimeout(autogrow, 0);
    }
  }

  async function submitLocation() {
    const coords = parseCoords(coordsRaw);
    if (!coords) {
      setError(t("inbox.composer.invalidCoords"));
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "location",
        location: { ...coords, ...(placeName.trim() ? { name: placeName.trim() } : {}) },
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setCoordsRaw("");
    setPlaceName("");
    onSent();
  }

  async function submitContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setError(t("inbox.composer.contactIncomplete"));
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "contacts",
        contacts: [{ name: contactName.trim(), phone: contactPhone.trim() }],
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setContactName("");
    setContactPhone("");
    onSent();
  }

  if (!conversation.windowOpen) {
    return (
      <div className="border-t bg-background px-[18px] py-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="font-medium">{t("inbox.windowClosed.title")}</p>
            <p className="opacity-80">{t("inbox.windowClosed.body")}</p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  const canSubmit = file !== null || text.trim().length > 0;

  return (
    <div className="border-t bg-background px-[18px] pb-3.5 pt-3">
      {templates.length > 0 && !file && panel === null && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {templates.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className="rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-text-2 transition-colors hover:border-brand-soft hover:bg-brand-tint hover:text-brand-text"
              onClick={() => {
                const firstName = conversation.contact.name.split(" ")[0] ?? "";
                setText(t.body.replace(/\{\{\s*1\s*\}\}/g, firstName));
                taRef.current?.focus();
                setTimeout(autogrow, 0);
              }}
              title={t.body}
            >
              {t.name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {file && (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-md border bg-secondary/50 p-2.5">
          {filePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={filePreview}
              alt={file.name}
              className="h-14 w-14 rounded object-cover"
            />
          ) : (
            <FileText className="h-8 w-8 shrink-0 text-brand" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-text-3">
              {t("inbox.composer.attachmentCaption", {
                size: formatBytes(file.size),
              })}
            </p>
          </div>
          <button
            onClick={() => pickFile(null)}
            aria-label={t("inbox.composer.removeAttachment")}
            className="rounded p-1 text-text-3 hover:bg-secondary hover:text-text-1"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "location" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-secondary/50 p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            {t("inbox.composer.coordsLabel")}
            <input
              value={coordsRaw}
              onChange={(e) => setCoordsRaw(e.target.value)}
              placeholder="21.019, -101.257"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            {t("inbox.composer.placeNameLabel")}
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Oficina AISHIA"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <button
            onClick={() => void submitLocation()}
            disabled={sending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-40"
          >
            {t("inbox.composer.sendLocation")}
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label={t("inbox.composer.cancel")}
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "contact" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-secondary/50 p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            {t("inbox.composer.contactName")}
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Xavier Pérez"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            {t("inbox.composer.contactPhone")}
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+52 462 123 4567"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <button
            onClick={() => void submitContact()}
            disabled={sending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-40"
          >
            {t("inbox.composer.sendContact")}
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label={t("inbox.composer.cancel")}
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-md border bg-background px-3 py-2 transition-shadow focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label={t("inbox.composer.attach")}
            title={t("inbox.composer.attachTitle")}
            className="rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-text-1"
          >
            <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "location" ? null : "location")}
            aria-label={t("inbox.composer.sendLocation")}
            title={t("inbox.composer.sendLocation")}
            className={cn(
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-text-1",
              panel === "location" && "bg-secondary text-brand"
            )}
          >
            <MapPin className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <button
            onClick={() => setPanel(panel === "contact" ? null : "contact")}
            aria-label={t("inbox.composer.shareContact")}
            title={t("inbox.composer.shareContact")}
            className={cn(
              "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-text-1",
              panel === "contact" && "bg-secondary text-brand"
            )}
          >
            <UserRound className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
        <textarea
          ref={taRef}
          placeholder={
            file
              ? t("inbox.composer.captionPlaceholder")
              : t("inbox.composer.placeholder")
          }
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-[120px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label={t("inbox.composer.send")}
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand text-brand-fg transition-opacity hover:bg-brand-hover",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
        <p className="text-[11px] text-text-3">
          {t("inbox.composer.windowRemaining", {
            remaining: formatRemaining(conversation.windowRemainingMs),
          })}
        </p>
      </div>
    </div>
  );
}
