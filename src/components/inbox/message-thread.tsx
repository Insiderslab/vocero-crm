"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Globe,
  MapPin,
  Paperclip,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { MessageDto, MessageMediaDto } from "@/lib/types";
import { useT, type TFunction } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatBytes, mediaLabel } from "./helpers";

function StatusTicks({ status }: { status: MessageDto["status"] }) {
  const cls = "h-[13px] w-[13px]";
  if (status === "pending") return <Clock3 className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "sent") return <Check className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "delivered")
    return <CheckCheck className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "read")
    return <CheckCheck className={cn(cls, "text-[#53bdeb]")} strokeWidth={1.7} />;
  return <AlertTriangle className={cn(cls, "text-destructive")} strokeWidth={1.7} />;
}

type LocationPayload = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

type ContactPayload = {
  name?: { formatted_name?: string; first_name?: string } | string;
  phones?: { phone?: string }[];
  phone?: string;
};

/** 008 — Previsualización del adjunto de un mensaje, por tipo. */
function MediaBlock({ media }: { media: MessageMediaDto }) {
  const { t } = useT();
  const src = `/api/media/${media.assetId}`;

  if (media.kind === "location") {
    const loc = (media.payload ?? {}) as LocationPayload;
    const coords =
      typeof loc.latitude === "number" && typeof loc.longitude === "number"
        ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`
        : null;
    return (
      <span className="flex items-start gap-1.5">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
        <span className="min-w-0">
          <span className="block font-medium">
            {loc.name ?? t("inbox.media.location")}
          </span>
          {loc.address && (
            <span className="block text-[12.5px] text-text-3">{loc.address}</span>
          )}
          {coords && (
            <a
              className="text-[12.5px] text-brand underline-offset-2 hover:underline"
              href={`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {coords} — {t("inbox.media.openMap")}
            </a>
          )}
        </span>
      </span>
    );
  }

  if (media.kind === "contacts") {
    const list = Array.isArray(media.payload)
      ? (media.payload as ContactPayload[])
      : [];
    return (
      <span className="flex flex-col gap-1">
        {list.length ? (
          list.map((c, i) => {
            const name =
              typeof c.name === "string"
                ? c.name
                : c.name?.formatted_name ??
                  c.name?.first_name ??
                  t("inbox.media.contact");
            const phone = c.phones?.[0]?.phone ?? c.phone ?? null;
            return (
              <span key={i} className="flex items-center gap-1.5">
                <UserRound className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
                <span>
                  <span className="block font-medium">{name}</span>
                  {phone && (
                    <span className="block text-[12.5px] text-text-3">{phone}</span>
                  )}
                </span>
              </span>
            );
          })
        ) : (
          <span className="text-text-3">{t("inbox.media.contacts")}</span>
        )}
      </span>
    );
  }

  if (media.fetchStatus !== "available") {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-3">
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        {media.fetchStatus === "failed"
          ? t("inbox.media.unavailable", { label: mediaLabel(media.kind, t) })
          : t("inbox.media.downloading", { label: mediaLabel(media.kind, t) })}
      </span>
    );
  }

  if (media.kind === "image" || media.kind === "sticker") {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        title={t("inbox.media.viewFull")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={media.caption ?? mediaLabel(media.kind, t)}
          className="max-h-72 max-w-full rounded-md object-contain"
          loading="lazy"
        />
      </a>
    );
  }
  if (media.kind === "video") {
    return (
      <video controls preload="metadata" className="max-h-72 max-w-full rounded-md">
        <source src={src} type={media.mimeType ?? undefined} />
      </video>
    );
  }
  if (media.kind === "audio") {
    return <audio controls preload="metadata" src={src} className="max-w-full" />;
  }
  // document
  return (
    <a
      className="flex items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 hover:bg-background"
      href={src}
      download={media.fileName ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
    >
      <FileText className="h-6 w-6 shrink-0 text-brand" strokeWidth={1.5} />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {media.fileName ?? t("inbox.media.document")}
        </span>
        {media.fileSize != null && (
          <span className="block text-[12px] text-text-3">
            {formatBytes(media.fileSize)}
          </span>
        )}
      </span>
    </a>
  );
}

function dayLabel(iso: string, t: TFunction): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return t("inbox.days.today");
  if (d.toDateString() === yesterday.toDateString())
    return t("inbox.days.yesterday");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function MessageThread({ messages }: { messages: MessageDto[] }) {
  const { t } = useT();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollRef}
      className="flex flex-1 flex-col gap-[3px] overflow-y-auto bg-chat px-3 py-5 sm:px-[6%]"
    >
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay =
          !prev ||
          new Date(prev.createdAt).toDateString() !==
            new Date(m.createdAt).toDateString();
        const grouped =
          !newDay && prev !== undefined && prev.direction === m.direction;
        const out = m.direction === "out";

        return (
          <div key={m.id}>
            {newDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-full border bg-background px-3 py-1 text-[11.5px] font-semibold text-text-2 shadow-sm">
                  {dayLabel(m.createdAt, t)}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex",
                out ? "justify-end" : "justify-start",
                grouped ? "mt-[3px]" : "mt-2.5"
              )}
            >
              <div
                className={cn(
                  // En el teléfono la burbuja necesita casi todo el renglón:
                  // con 64% cada mensaje se parte en tres líneas.
                  "max-w-[85%] rounded-lg px-3 pb-1.5 pt-2 text-sm leading-[1.45] shadow-sm sm:max-w-[64%]",
                  out
                    ? "border border-brand-soft bg-bubble-out text-bubble-out-text"
                    : "bg-background",
                  !grouped && (out ? "rounded-tr-[5px]" : "rounded-tl-[5px]")
                )}
              >
                {m.media ? (
                  <span className="block">
                    <MediaBlock media={m.media} />
                    {m.media.caption && (
                      <span className="mt-1 block whitespace-pre-wrap break-words">
                        {m.media.caption}
                      </span>
                    )}
                  </span>
                ) : m.type === "text" || m.type === "template" ? (
                  <span className="whitespace-pre-wrap break-words">
                    {m.text}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-text-3">
                    <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
                    {mediaLabel(m.type, t)}
                    {m.text ? ` — ${m.text}` : ""}
                  </span>
                )}
                <span className="float-right ml-2 mt-1 flex items-center gap-1">
                  {m.aiGenerated && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand"
                      title={t("inbox.thread.aiTitle")}
                    >
                      <Sparkles className="h-3 w-3" strokeWidth={1.7} />{" "}
                      {t("inbox.thread.aiBadge")}
                    </span>
                  )}
                  {m.channel === "web" && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-text-3"
                      title={t("inbox.thread.webTitle")}
                    >
                      <Globe className="h-3 w-3" strokeWidth={1.7} />{" "}
                      {t("inbox.thread.webBadge")}
                    </span>
                  )}
                  {m.origin === "manual" && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-text-3"
                      title={t("inbox.thread.manualTitle")}
                    >
                      <Smartphone className="h-3 w-3" strokeWidth={1.7} />{" "}
                      {t("inbox.thread.manualBadge")}
                    </span>
                  )}
                  <span className="text-[10.5px] text-text-4">
                    {bubbleTime(m.createdAt)}
                  </span>
                  {out && <StatusTicks status={m.status} />}
                </span>
                {out && m.status === "failed" && (
                  // El triángulo solo decía "algo falló". El motivo lo manda
                  // Meta y lo guardábamos sin enseñarlo nunca.
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-danger-soft bg-danger-tint px-2 py-1.5 text-[11.5px] leading-snug text-danger-text">
                    <AlertTriangle
                      className="mt-[1px] h-3.5 w-3.5 shrink-0"
                      strokeWidth={1.8}
                    />
                    <span>
                      <span className="font-semibold">
                        {t("inbox.thread.notDelivered")}
                      </span>{" "}
                      {m.error ?? t("inbox.thread.noReason")}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
