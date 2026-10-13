import { describe, expect, it } from "vitest";
import { normalizeSummaryDays } from "@/server/dashboard/summary";

/**
 * 010 — el período de «Sintesi» solo admite 7, 30 o 90 días; cualquier otra
 * cosa la rotta la responde 422 (nunca un rango arbitrario contra la BD).
 */

describe("010 período de la Sintesi", () => {
  it("acepta 7, 30 y 90, como número o como texto", () => {
    expect(normalizeSummaryDays(7)).toBe(7);
    expect(normalizeSummaryDays("30")).toBe(30);
    expect(normalizeSummaryDays(90)).toBe(90);
  });

  it("rechaza todo lo demás", () => {
    for (const value of [0, 1, 8, 60, 91, 7.5, "7d", "abc", "", null, undefined, {}]) {
      expect(normalizeSummaryDays(value)).toBeNull();
    }
  });
});
