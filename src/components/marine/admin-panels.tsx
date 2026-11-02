"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { MarineTripSummary } from "@/lib/marine/types";

const ZONE = "America/Caracas";
export const MARINE_VIEW_LIMIT = "Vista limitada a los 50 paseos disponibles; no es el historial completo";
export type CalendarDay = { date: string; trips: MarineTripSummary[] };

export function caracasMonth(value: string | DateTime = DateTime.now().setZone(ZONE)) {
  const dt = typeof value === "string" ? DateTime.fromISO(value, { zone: ZONE }) : value.setZone(ZONE);
  if (!dt.isValid) throw new Error("Fecha inválida");
  return dt.toFormat("yyyy-MM");
}

export function monthBounds(trips: MarineTripSummary[], now: DateTime = DateTime.now().setZone(ZONE)) {
  const months = trips.map((trip) => caracasMonth(trip.startAt));
  const current = caracasMonth(now);
  const all = [...months, current].sort();
  return { min: all[0] ?? current, max: all[all.length - 1] ?? current, current };
}

export function calendarDays(trips: MarineTripSummary[], month: string): CalendarDay[] {
  const first = DateTime.fromFormat(month, "yyyy-MM", { zone: ZONE }).startOf("month");
  if (!first.isValid) throw new Error("Mes inválido");
  const offset = first.weekday - 1;
  const rows = Math.ceil((offset + first.daysInMonth!) / 7) * 7;
  return Array.from({ length: rows }, (_, i) => {
    const day = first.plus({ days: i - offset });
    const date = day.toISODate()!;
    return { date, trips: trips.filter((trip) => caracasDate(trip.startAt) === date) };
  });
}

export function caracasDate(value: string) { return DateTime.fromISO(value, { zone: ZONE }).setZone(ZONE).toISODate()!; }

export function AdminPanels({ trips, onOpenTrip, onOperations, onAdministration, navigationDisabled = false, initialPanel = "Resumen", calendarOnly = false }: { trips: MarineTripSummary[]; onOpenTrip: (id: string) => void; onOperations: () => void; onAdministration: () => void; navigationDisabled?: boolean; initialPanel?: "Resumen" | "Calendario"; calendarOnly?: boolean }) {
  const bounds = useMemo(() => monthBounds(trips), [trips]);
  const [month, setMonth] = useState(bounds.current);
  const [selectedDate, setSelectedDate] = useState(caracasDate(DateTime.now().setZone(ZONE).toISO()!));
  const [panel, setPanel] = useState(initialPanel);
  const boundedMonth = month < bounds.min ? bounds.min : month > bounds.max ? bounds.max : month;
  const days = useMemo(() => calendarDays(trips, boundedMonth), [trips, boundedMonth]);
  const selectedTrips = trips.filter((trip) => caracasDate(trip.startAt) === selectedDate);
  const now = DateTime.now().setZone(ZONE).toMillis();
  const byUpcoming = trips.filter((trip) => DateTime.fromISO(trip.startAt).toMillis() >= now && !["completed", "cancelled"].includes(trip.status)).sort((a, b) => DateTime.fromISO(a.startAt).toMillis() - DateTime.fromISO(b.startAt).toMillis());
  const goMonth = (amount: number) => {
    const next = DateTime.fromFormat(boundedMonth, "yyyy-MM", { zone: ZONE }).plus({ months: amount }).toFormat("yyyy-MM");
    if (next >= bounds.min && next <= bounds.max) { setMonth(next); setSelectedDate(`${next}-01`); }
  };
  return <div className="space-y-4">
      {!calendarOnly && <nav aria-label="Calendario y tours" className="grid grid-cols-2 gap-2"><button disabled={navigationDisabled} className={`min-h-12 rounded-xl border border-slate-300 px-3 font-semibold disabled:opacity-50 ${panel === "Resumen" ? "bg-sky-100" : "bg-white"}`} onClick={() => setPanel("Resumen")}>Tours</button><button disabled={navigationDisabled} className={`min-h-12 rounded-xl border border-slate-300 px-3 font-semibold disabled:opacity-50 ${panel === "Calendario" ? "bg-sky-100" : "bg-white"}`} onClick={() => setPanel("Calendario")}>Calendario</button><button disabled={navigationDisabled} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-50" onClick={onOperations}>Operaciones</button><button disabled={navigationDisabled} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-50" onClick={onAdministration}>Administración de tours</button></nav>}
    {panel === "Resumen" && <>
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <h2 className="text-xl font-bold">Resumen</h2><p className="my-2 rounded bg-amber-50 p-3 text-sm">{MARINE_VIEW_LIMIT}</p>
      <p className="font-semibold">Paseos: {trips.length} <span className="font-normal">· En esta vista</span></p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{(["planned", "boarding", "underway", "completed", "cancelled"] as const).map((status) => <p key={status} className="rounded-lg bg-slate-50 p-2">{statusLabel(status)}: <strong>{trips.filter((trip) => trip.status === status).length}</strong><span className="block text-xs text-slate-600">En esta vista</span></p>)}</div>
      {byUpcoming.length ? <ul className="divide-y">{byUpcoming.slice(0, 8).map((trip) => <li key={trip.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><strong>{trip.title}</strong><p className="text-sm text-slate-600">{new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: ZONE }).format(new Date(trip.startAt))} · {statusLabel(trip.status)} · {trip.totals.reserved}/{trip.capacity} reservados</p></div><button disabled={navigationDisabled} className="min-h-12 rounded-xl bg-sky-800 px-4 font-semibold text-white disabled:opacity-50" onClick={() => onOpenTrip(trip.id)}>Abrir paseo</button></li>)}</ul> : <p className="py-3 text-slate-600">Sin paseos próximos en esta vista</p>}
      <button className="min-h-12 rounded-xl border px-4 font-semibold" onClick={onOperations}>Abrir operaciones</button>
    </section>
    </>}
    {panel === "Calendario" &&
    <section className="rounded-2xl border bg-white p-2 shadow-sm sm:p-4">
      <h2 className="text-xl font-bold">Calendario</h2><p className="my-2 rounded bg-amber-50 p-3 text-sm">{MARINE_VIEW_LIMIT}</p>
      <div className="flex items-center justify-between gap-2"><button className="min-h-12 rounded-xl border px-3" aria-label="Mes anterior" disabled={navigationDisabled || boundedMonth <= bounds.min} onClick={() => goMonth(-1)}>←</button><h3 className="font-bold">{DateTime.fromFormat(boundedMonth, "yyyy-MM", { zone: ZONE }).setLocale("es").toFormat("LLLL yyyy")}</h3><button className="min-h-12 rounded-xl border px-3" aria-label="Mes siguiente" disabled={navigationDisabled || boundedMonth >= bounds.max} onClick={() => goMonth(1)}>→</button><button className="min-h-12 rounded-xl border px-3" disabled={navigationDisabled} onClick={() => { setMonth(bounds.current); setSelectedDate(caracasDate(DateTime.now().setZone(ZONE).toISO()!)); }}>Hoy</button></div>
      <div className="mt-3 grid grid-cols-7 gap-0 text-center">{["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d} className="py-2 text-sm font-bold" aria-hidden="true">{d}</span>)}{days.map((day) => { const inMonth = day.date.slice(0, 7) === boundedMonth; return <button key={day.date} type="button" disabled={navigationDisabled} aria-label={`${day.date}${day.trips.length ? `, ${day.trips.length} paseos` : ", sin paseos en esta vista"}`} aria-pressed={selectedDate === day.date} onClick={() => setSelectedDate(day.date)} className={`min-h-11 rounded-lg border p-0 text-sm disabled:opacity-50 ${!inMonth ? "text-slate-400" : ""} ${selectedDate === day.date ? "border-sky-800 bg-sky-100" : "border-slate-200"}`}>{Number(day.date.slice(-2))}{day.trips.length > 0 && <span className="block text-xs font-bold">{day.trips.length}</span>}</button>; })}</div>
      <h3 className="mt-4 font-bold">{DateTime.fromISO(selectedDate, { zone: ZONE }).setLocale("es").toFormat("d LLLL yyyy")}</h3>
      {selectedTrips.length ? <ul className="divide-y">{selectedTrips.map((trip) => <li key={trip.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><strong>{trip.title}</strong><p className="text-sm text-slate-600">{statusLabel(trip.status)} · Capacidad {trip.capacity} · {trip.totals.reserved} reservados</p></div><button disabled={navigationDisabled} className="min-h-12 rounded-xl bg-sky-800 px-4 text-white disabled:opacity-50" onClick={() => onOpenTrip(trip.id)}>Abrir paseo</button></li>)}</ul> : <p className="py-3 text-slate-600">Sin paseos en esta vista</p>}
    </section>}
  </div>;
}

function statusLabel(status: MarineTripSummary["status"]) { return ({ planned: "Planificado", boarding: "Abordando", underway: "En paseo", completed: "Finalizado", cancelled: "Cancelado" })[status]; }
