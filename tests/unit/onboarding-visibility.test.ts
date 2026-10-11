import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  showOnboardingChecklist,
  type OnboardingChecklist,
} from "@/server/onboarding/checklist";

/**
 * 010 — cuándo se ve «Primi passi»: owner/admin mientras falte algo, o cuando
 * viene de la reapertura de Impostazioni; un member nunca. Los cinco pasos
 * quedan mapeados a un campo booleano de la checklist (el typecheck vigila el
 * resto).
 */

const ALL_DONE: OnboardingChecklist = {
  whatsappConnected: true,
  templateApproved: true,
  agentConfigured: true,
  labRunDone: true,
  agentEnabled: true,
  allDone: true,
};

describe("010 visibilidad de «Primi passi»", () => {
  it("un miembro nunca la ve (ni siquiera reabierta)", () => {
    const pending = { ...ALL_DONE, allDone: false };
    expect(showOnboardingChecklist("member", pending, false)).toBe(false);
    expect(showOnboardingChecklist("member", pending, true)).toBe(false);
    expect(showOnboardingChecklist("", ALL_DONE, true)).toBe(false);
  });

  it("owner/admin la ven mientras falte algún paso", () => {
    const pending = { ...ALL_DONE, allDone: false };
    expect(showOnboardingChecklist("owner", pending, false)).toBe(true);
    expect(showOnboardingChecklist("admin", pending, false)).toBe(true);
  });

  it("completa desaparece; la reapertura la vuelve a mostrar", () => {
    expect(showOnboardingChecklist("owner", ALL_DONE, false)).toBe(false);
    expect(showOnboardingChecklist("owner", ALL_DONE, true)).toBe(true);
    expect(showOnboardingChecklist("admin", ALL_DONE, true)).toBe(true);
  });

  it("los cinco pasos: clave, campo de estado y destino", () => {
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      "whatsapp",
      "template",
      "agent",
      "lab",
      "enabled",
    ]);
    for (const step of ONBOARDING_STEPS) {
      expect(typeof ALL_DONE[step.field]).toBe("boolean");
      expect(step.href.startsWith("/")).toBe(true);
    }
  });
});
