import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { calendarDays, caracasDate, caracasMonth, monthBounds, MARINE_VIEW_LIMIT } from "@/components/marine/admin-panels";
import type { MarineTripSummary } from "@/lib/marine/types";

function trip(startAt: string, id = "trip"): MarineTripSummary {
  return { id, title: id, startAt, endAt: startAt, mode: "public", capacity: 10, status: "planned", revision: 1, totals: { reserved: 2, registered: 0, aboard: 0, away: 0, deboarded: 0, waiting: 0, capacity: 10 } };
}

describe("marine calendar presentation", () => {
  it("uses Caracas dates even when UTC crosses into another day or month", () => {
    expect(caracasDate("2026-03-01T02:30:00.000Z")).toBe("2026-02-28");
    expect(caracasMonth("2026-03-01T02:30:00.000Z")).toBe("2026-02");
  });

  it("builds a Monday-first leap February grid and groups trips by local day", () => {
    const rows = [trip("2024-02-29T15:00:00-04:00", "leap")];
    const days = calendarDays(rows, "2024-02");
    expect(days[0]?.date).toBe("2024-01-29"); // Monday
    expect(days).toHaveLength(35);
    expect(days.find((day) => day.date === "2024-02-29")?.trips.map((x) => x.id)).toEqual(["leap"]);
  });

  it("bounds navigation by returned months and the current Caracas month", () => {
    const bounds = monthBounds([trip("2026-01-31T23:00:00-04:00"), trip("2026-04-01T00:00:00-04:00")], DateTime.fromISO("2026-02-01T02:00:00Z"));
    expect(bounds).toEqual({ min: "2026-01", max: "2026-04", current: "2026-01" });
    expect(monthBounds([], DateTime.fromISO("2026-02-01T02:00:00Z"))).toEqual({ min: "2026-01", max: "2026-01", current: "2026-01" });
  });

  it("labels a truncated 50-row view as non-exhaustive", () => {
    const rows = Array.from({ length: 50 }, (_, i) => trip(`2026-05-${String((i % 28) + 1).padStart(2, "0")}T10:00:00-04:00`, `t${i}`));
    expect(rows).toHaveLength(50);
    expect(MARINE_VIEW_LIMIT).toContain("no es el historial completo");
    expect(monthBounds(rows, DateTime.fromISO("2026-02-01T02:00:00Z")).max).toBe("2026-05");
  });
});
