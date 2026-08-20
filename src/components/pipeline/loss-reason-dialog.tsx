"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { LOSS_REASON_LABEL, type LossReason } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const REASONS = Object.keys(LOSS_REASON_LABEL) as LossReason[];

/**
 * Motivo de pérdida. Se pide al ENTRAR a la etapa perdida y es
 * obligatorio: sin él el trato no se marca como perdido, ni aquí ni en la API,
 * ni en la base (hay un CHECK). Es la métrica que dice qué cambiar en la oferta
 * o en el anuncio, y solo se puede capturar en el momento en que se sabe.
 */
export function LossReasonDialog({
  leadName,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  onCancel: () => void;
  onConfirm: (reason: LossReason, note: string) => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState<LossReason | null>(null);
  const [note, setNote] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label={t("pipeline.loss.ariaLabel")}
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">{t("pipeline.loss.title")}</h3>
        <p className="mb-4 text-xs text-text-3">
          {t("pipeline.loss.description", { name: leadName })}
        </p>

        <div className="space-y-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              aria-pressed={reason === r}
              className={
                reason === r
                  ? "w-full rounded-md border border-brand bg-brand-tint px-3 py-2 text-left text-sm font-medium"
                  : "w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-subtle"
              }
            >
              {t(`pipeline.loss.reasons.${r}`)}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-1.5">
          <label className="text-sm font-medium" htmlFor="loss-note">
            {t("pipeline.loss.noteLabel")}
          </label>
          <Textarea
            id="loss-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("pipeline.loss.notePlaceholder")}
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("pipeline.loss.cancel")}
          </Button>
          <Button
            disabled={!reason}
            onClick={() => reason && onConfirm(reason, note.trim())}
          >
            {t("pipeline.loss.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
