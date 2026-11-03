"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { MarineTripSummary } from "@/lib/marine/types";

const ZONE = "America/Caracas";
export const MARINE_VIEW_LIMIT = "Vista limitada a los 50 paseos disponibles; no es el historial completo";

export type CalendarDay = { date: string; trips: MarineTripSummary[] };
export type CalendarMode = "Hoy" | "3 días" | "7 días" | "Mes";

export function caracasDate(value: string) {
  return DateTime.fromISO(value, { zone: ZONE }).setZone(ZONE).toISODate()!;
}

export function caracasMonth(value: string | DateTime = DateTime.now().setZone(ZONE)) {
  const date = typeof value === "string" ? DateTime.fromISO(value, { zone: ZONE }) : value.setZone(ZONE);
  if (!date.isValid) throw new Error("Fecha inválida");
  return date.toFormat("yyyy-MM");
}

export function tripsForDate(trips: MarineTripSummary[], date: string) {
  return trips
    .filter((trip) => caracasDate(trip.startAt) === date)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function calendarRangeDates(selectedDate: string, mode: Exclude<CalendarMode, "Mes">) {
  const count = mode === "Hoy" ? 1 : mode === "3 días" ? 3 : 7;
  return Array.from({ length: count }, (_, index) =>
    DateTime.fromISO(selectedDate, { zone: ZONE }).plus({ days: index }).toISODate()!,
  );
}

export function shiftCalendarDate(selectedDate: string, mode: CalendarMode, direction: -1 | 1) {
  const date = DateTime.fromISO(selectedDate, { zone: ZONE });
  if (!date.isValid) throw new Error("Fecha inválida");

  if (mode !== "Mes") {
    const step = mode === "Hoy" ? 1 : mode === "3 días" ? 3 : 7;
    return date.plus({ days: direction * step }).toISODate()!;
  }

  const targetMonth = date.plus({ months: direction });
  return targetMonth.set({ day: Math.min(date.day, targetMonth.daysInMonth!) }).toISODate()!;
}

export function calendarDays(trips: MarineTripSummary[], month: string): CalendarDay[] {
  const first = DateTime.fromFormat(month, "yyyy-MM", { zone: ZONE }).startOf("month");
  if (!first.isValid) throw new Error("Mes inválido");

  const mondayOffset = first.weekday - 1;
  const cellCount = Math.ceil((mondayOffset + first.daysInMonth!) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = first.plus({ days: index - mondayOffset }).toISODate()!;
    return { date, trips: tripsForDate(trips, date) };
  });
}

function today() {
  return DateTime.now().setZone(ZONE).toISODate()!;
}

function dayLabel(date: string) {
  return DateTime.fromISO(date, { zone: ZONE }).setLocale("es").toFormat("cccc d LLLL yyyy");
}

function statusLabel(status: MarineTripSummary["status"]) {
  return {
    planned: "Planificado",
    boarding: "Abordando",
    underway: "En paseo",
    completed: "Finalizado",
    cancelled: "Cancelado",
  }[status];
}

function localTime(value: string) {
  return DateTime.fromISO(value).setZone(ZONE).toFormat("HH:mm");
}

type AdminPanelsProps = {
  trips: MarineTripSummary[];
  onOpenTrip: (id: string) => void;
  onOperations: () => void;
  onAdministration: () => void;
  onOpenAdministration?: (id: string) => void;
  onCreateForDate?: (date: string) => void;
  onRefresh?: () => void;
  createDisabled?: boolean;
  initialCalendarDate?: string;
  initialCalendarMode?: CalendarMode;
  onCalendarChange?: (date: string, mode: CalendarMode) => void;
  navigationDisabled?: boolean;
  initialPanel?: "Resumen" | "Calendario";
  calendarOnly?: boolean;
};

export function AdminPanels({
  trips,
  onOpenTrip,
  onOperations,
  onAdministration,
  onOpenAdministration,
  onCreateForDate,
  onRefresh,
  createDisabled = false,
  initialCalendarDate,
  initialCalendarMode = "Hoy",
  onCalendarChange,
  navigationDisabled = false,
  initialPanel = "Resumen",
  calendarOnly = false,
}: AdminPanelsProps) {
  const [panel, setPanel] = useState(initialPanel);
  const [mode, setMode] = useState<CalendarMode>(initialCalendarMode);
  const [selectedDate, setSelectedDate] = useState(initialCalendarDate || today());
  const month = caracasMonth(selectedDate);
  const days = useMemo(() => calendarDays(trips, month), [trips, month]);
  const range = mode === "Mes" ? [] : calendarRangeDates(selectedDate, mode);
  const now = DateTime.now().setZone(ZONE);
  const upcomingTrips = trips
    .filter((trip) => DateTime.fromISO(trip.startAt).toMillis() >= now.toMillis() && !["completed", "cancelled"].includes(trip.status))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  function chooseDate(date: string) {
    setSelectedDate(date);
    onCalendarChange?.(date, mode);
  }

  function chooseMode(nextMode: CalendarMode) {
    const date = nextMode === "Hoy" ? today() : selectedDate;
    setMode(nextMode);
    setSelectedDate(date);
    onCalendarChange?.(date, nextMode);
  }

  function move(direction: -1 | 1) {
    chooseDate(shiftCalendarDate(selectedDate, mode, direction));
  }

  function renderTripCard(trip: MarineTripSummary) {
    return (
      <li key={trip.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3">
        <div className="min-w-0">
          <strong className="break-words">{trip.title}</strong>
          <p className="text-sm text-slate-600">
            {localTime(trip.startAt)}–{localTime(trip.endAt)} · {statusLabel(trip.status)} · {trip.mode === "private" ? "Privado" : "Público"} · {trip.totals.reserved}/{trip.capacity} reservados · {trip.totals.registered} registrados
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={navigationDisabled}
            className="min-h-11 rounded-xl bg-sky-800 px-3 font-semibold text-white disabled:opacity-50"
            onClick={() => onOpenTrip(trip.id)}
          >
            Abrir paseo
          </button>
          {onOpenAdministration && (
            <button
              disabled={navigationDisabled}
              className="min-h-11 rounded-xl border px-3 font-semibold disabled:opacity-50"
              onClick={() => onOpenAdministration(trip.id)}
            >
              Reservas y servicios
            </button>
          )}
        </div>
      </li>
    );
  }

  function renderDaySection(date: string, dayTrips: MarineTripSummary[]) {
    return (
      <section key={date} className="mt-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold capitalize">{dayLabel(date)}</h3>
          {onCreateForDate && (
            <button
              disabled={navigationDisabled || createDisabled}
              className="min-h-11 rounded-xl border px-3 font-semibold disabled:opacity-50"
              onClick={() => onCreateForDate(date)}
            >
              Nuevo tour
            </button>
          )}
        </div>
        {dayTrips.length ? (
          <ul>{dayTrips.map(renderTripCard)}</ul>
        ) : (
          <p className="py-3 text-slate-600">Sin paseos en esta vista</p>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {!calendarOnly && (
        <nav aria-label="Calendario y tours" className="grid grid-cols-2 gap-2">
          <button disabled={navigationDisabled} aria-pressed={panel === "Resumen"} className="min-h-12 rounded-xl border px-3 font-semibold" onClick={() => setPanel("Resumen")}>
            Tours
          </button>
          <button disabled={navigationDisabled} aria-pressed={panel === "Calendario"} className="min-h-12 rounded-xl border px-3 font-semibold" onClick={() => setPanel("Calendario")}>
            Calendario
          </button>
          <button disabled={navigationDisabled} className="min-h-12 rounded-xl border px-3 font-semibold" onClick={onOperations}>
            Operaciones
          </button>
          <button disabled={navigationDisabled} className="min-h-12 rounded-xl border px-3 font-semibold" onClick={onAdministration}>
            Administración de tours
          </button>
        </nav>
      )}

      {panel === "Resumen" && (
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="text-xl font-bold">Resumen</h2>
          <p className="my-2 rounded bg-amber-50 p-3 text-sm">{MARINE_VIEW_LIMIT}</p>
          <p className="font-semibold">Paseos: {trips.length} <span className="font-normal">· En esta vista</span></p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {(["planned", "boarding", "underway", "completed", "cancelled"] as const).map((status) => (
              <p key={status} className="rounded-lg bg-slate-50 p-2">
                {statusLabel(status)}: <strong>{trips.filter((trip) => trip.status === status).length}</strong>
                <span className="block text-xs text-slate-600">En esta vista</span>
              </p>
            ))}
          </div>
          {upcomingTrips.length ? (
            <ul className="mt-2">{upcomingTrips.slice(0, 8).map(renderTripCard)}</ul>
          ) : (
            <p className="py-3 text-slate-600">Sin paseos próximos en esta vista</p>
          )}
        </section>
      )}

      {panel === "Calendario" && (
        <section className="rounded-2xl border bg-white p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold">Calendario</h2>
            {onRefresh && (
              <button className="min-h-11 rounded-xl border px-3" disabled={navigationDisabled} onClick={onRefresh}>
                Actualizar
              </button>
            )}
          </div>
          <p className="my-2 rounded bg-amber-50 p-3 text-sm">{MARINE_VIEW_LIMIT}</p>

          <div className="flex flex-wrap gap-2" aria-label="Modo de calendario">
            {(["Hoy", "3 días", "7 días", "Mes"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={navigationDisabled}
                aria-pressed={mode === value}
                className={`min-h-11 rounded-xl border px-3 font-semibold ${mode === value ? "bg-sky-100" : "bg-white"}`}
                onClick={() => chooseMode(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button className="min-h-11 rounded-xl border px-3" aria-label="Anterior" disabled={navigationDisabled} onClick={() => move(-1)}>
              ←
            </button>
            <div className="min-w-0 flex-1 px-1 text-center text-sm sm:text-base">
              <h3 className="font-bold">
                {mode === "Mes"
                  ? DateTime.fromISO(selectedDate, { zone: ZONE }).setLocale("es").toFormat("LLLL yyyy")
                  : mode === "Hoy"
                    ? dayLabel(selectedDate)
                    : `${dayLabel(selectedDate)} – ${dayLabel(range.at(-1)!)}`}
              </h3>
              <p className="text-sm">Fecha seleccionada: {dayLabel(selectedDate)}</p>
            </div>
            <button className="min-h-11 rounded-xl border px-3" aria-label="Siguiente" disabled={navigationDisabled} onClick={() => move(1)}>
              →
            </button>
          </div>
          <button className="mt-2 min-h-11 rounded-xl border px-3" disabled={navigationDisabled} onClick={() => chooseMode("Hoy")}>
            Ir a hoy
          </button>

          {mode === "Mes" ? (
            <>
              <div className="mt-3 grid grid-cols-7 text-center">
                {["L", "M", "X", "J", "V", "S", "D"].map((weekday) => (
                  <span key={weekday} className="py-2 text-sm font-bold" aria-hidden="true">
                    {weekday}
                  </span>
                ))}
                {days.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    disabled={navigationDisabled}
                    aria-label={`${day.date}${day.trips.length ? `, ${day.trips.length} paseos` : ", sin paseos en esta vista"}`}
                    aria-pressed={selectedDate === day.date}
                    onClick={() => chooseDate(day.date)}
                    className={`min-h-11 rounded-lg border text-sm ${day.date.slice(0, 7) !== month ? "text-slate-400" : ""} ${selectedDate === day.date ? "border-sky-800 bg-sky-100" : "border-slate-200"}`}
                  >
                    {Number(day.date.slice(-2))}
                    {day.trips.length > 0 && <span className="block text-xs font-bold">{day.trips.length}</span>}
                  </button>
                ))}
              </div>
              {renderDaySection(selectedDate, tripsForDate(trips, selectedDate))}
            </>
          ) : (
            range.map((date) =>
              renderDaySection(
                date,
                tripsForDate(trips, date),
              ),
            )
          )}
        </section>
      )}
    </div>
  );
}
