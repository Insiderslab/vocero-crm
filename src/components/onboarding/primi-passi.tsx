import Link from "next/link";
import {
  ONBOARDING_STEPS,
  type OnboardingChecklist,
} from "@/server/onboarding/checklist";

/**
 * 010 — tarjeta «Primi passi» (checklist de primer avvio). Componente de
 * servidor SÍNCRONO: `t` llega por prop desde la página (ya resuelto en el
 * servidor) y el estado lo calcula `getOnboardingChecklist`. Quién la muestra
 * lo decide `showOnboardingChecklist` en cada página (owner/admin, mientras
 * falte algún paso o venga de la reapertura de Impostazioni).
 */
export type PrimiPassiT = (
  key: string,
  vars?: Record<string, string | number>
) => string;

export function PrimiPassi({
  checklist,
  t,
}: {
  checklist: OnboardingChecklist;
  t: PrimiPassiT;
}) {
  const done = ONBOARDING_STEPS.filter((step) => checklist[step.field]).length;

  return (
    <section aria-labelledby="primi-passi-title" className="rounded-lg border bg-subtle p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="primi-passi-title" className="text-sm font-semibold">
          {t("onboarding.title")}
        </h3>
        <span className="text-xs tabular-nums text-text-3">
          {t("onboarding.progress", { done, total: ONBOARDING_STEPS.length })}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.description")}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {ONBOARDING_STEPS.map((step) => {
          const ok = checklist[step.field];
          return (
            <li key={step.key} className="rounded-md border bg-card">
              <Link href={step.href} className="flex items-start gap-2 px-3 py-2">
                <span aria-hidden="true" className={ok ? "text-brand" : "text-text-3"}>
                  {ok ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`onboarding.steps.${step.key}.title`)}
                    <span
                      className={
                        ok
                          ? "ml-1.5 text-xs font-normal text-brand-text"
                          : "ml-1.5 text-xs font-normal text-text-3"
                      }
                    >
                      {ok ? t("onboarding.done") : t("onboarding.pending")}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`onboarding.steps.${step.key}.hint`)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
