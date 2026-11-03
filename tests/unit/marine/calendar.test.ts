import { describe, expect, it } from "vitest";
import { calendarDays, calendarRangeDates, caracasDate, caracasMonth, shiftCalendarDate, tripsForDate, MARINE_VIEW_LIMIT } from "@/components/marine/admin-panels";
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

  it("steps through future empty months and clamps month-end dates", () => {
    expect(shiftCalendarDate("2026-01-31", "Mes", 1)).toBe("2026-02-28");
    expect(shiftCalendarDate("2026-02-28", "Mes", 1)).toBe("2026-03-28");
    expect(calendarDays([], caracasMonth("2030-02-01")).find((day) => day.date === "2030-02-15")?.trips).toEqual([]);
  });

  it("keeps short ranges anchored to the selected Caracas date", () => {
    expect(calendarRangeDates("2026-02-28", "3 días")).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(shiftCalendarDate("2026-02-28", "7 días", -1)).toBe("2026-02-21");
  });

  it("sorts same-day trips chronologically regardless of API order", () => {
    const later = trip("2026-02-28T15:00:00-04:00", "later");
    const earlier = trip("2026-02-28T09:00:00-04:00", "earlier");
    expect(tripsForDate([later, earlier], "2026-02-28").map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("labels a truncated 50-row view as non-exhaustive", () => {
    const rows = Array.from({ length: 50 }, (_, i) => trip(`2026-05-${String((i % 28) + 1).padStart(2, "0")}T10:00:00-04:00`, `t${i}`));
    expect(rows).toHaveLength(50);
    expect(MARINE_VIEW_LIMIT).toContain("no es el historial completo");
    expect(calendarDays(rows, "2026-05")).toHaveLength(35);
  });
});
