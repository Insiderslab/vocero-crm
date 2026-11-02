import { decryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import type {
  AdminPassenger,
  CrewBooking,
  CrewPassenger,
  CrewService,
  MarineAgencyReport,
  MarineIncident,
  MarineReport,
  MarineReportCurrency,
  MarineRole,
  MarineTrip,
  MarineTripSummary,
  MarineTripView,
} from "@/lib/marine/types";
import { encodeMarineToken } from "./crypto";

function isAdminRole(role: string): role is "owner" | "admin" {
  if (role === "owner" || role === "admin") return true;
  if (role === "member") return false;
  throw new TypeError("Invalid marine role");
}

function safeAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new RangeError("Marine report total exceeds safe integer range");
  return sum;
}

export function marineTotals(trip: MarineTrip): MarineTripSummary["totals"] {
  const confirmed = trip.payload.bookings.filter((booking) => booking.status === "confirmed");
  const confirmedIds = new Set(confirmed.map((booking) => booking.id));
  const passengers = trip.payload.passengers.filter((passenger) => confirmedIds.has(passenger.bookingId));
  return {
    reserved: confirmed.reduce((total, booking) => safeAdd(total, booking.seats), 0),
    registered: passengers.filter((passenger) => passenger.registered).length,
    aboard: passengers.filter((passenger) => passenger.movement === "aboard").length,
    away: passengers.filter((passenger) => passenger.movement === "away").length,
    deboarded: passengers.filter((passenger) => passenger.movement === "deboarded").length,
    waiting: trip.payload.bookings.filter((booking) => booking.status === "waitlist").reduce((total, booking) => safeAdd(total, booking.seats), 0),
    capacity: trip.capacity,
  };
}

export function projectTripSummary(trip: MarineTrip): MarineTripSummary {
  return {
    id: trip.id,
    title: trip.title,
    startAt: trip.startAt,
    endAt: trip.endAt,
    mode: trip.mode,
    capacity: trip.capacity,
    status: trip.status,
    revision: trip.revision,
    totals: marineTotals(trip),
  };
}

function toCrewPassenger(passenger: MarineTrip["payload"]["passengers"][number]): CrewPassenger {
  return {
    id: passenger.id,
    bookingId: passenger.bookingId,
    name: passenger.name,
    documentType: passenger.documentType,
    documentMasked: passenger.documentMasked,
    registered: passenger.registered,
    minor: passenger.minor,
    representativeName: passenger.representativeName,
    movement: passenger.movement,
  };
}

function toCrewBooking(booking: MarineTrip["payload"]["bookings"][number]): CrewBooking {
  return {
    id: booking.id,
    reference: booking.reference,
    customerName: booking.customerName,
    seats: booking.seats,
    status: booking.status,
  };
}

function projectAdminPassenger(trip: MarineTrip, passenger: MarineTrip["payload"]["passengers"][number], baseUrl: string): AdminPassenger {
  let registrationLink: string | null = null;
  if (passenger.registrationEncrypted && passenger.registrationHash) {
    const secret = decryptSecret(passenger.registrationEncrypted);
    const token = encodeMarineToken({ organizationId: trip.organizationId, tripId: trip.id, passengerId: passenger.id, secret });
    registrationLink = `${baseUrl.replace(/\/$/, "")}/pasajero#${token}`;
  }
  return {
    ...toCrewPassenger(passenger),
    registrationLink,
    ticketCode: passenger.ticketEncrypted ? decryptSecret(passenger.ticketEncrypted) : null,
    phone: passenger.phone,
    email: passenger.email,
  };
}

function projectReport(trip: MarineTrip): MarineReport {
  const bookings = trip.payload.bookings.filter((booking) => booking.status === "confirmed");
  const currencies = new Set([
    ...bookings.map((booking) => booking.currency),
    ...trip.payload.payments.map((payment) => payment.currency),
    ...trip.payload.costs.map((cost) => cost.currency),
    ...trip.payload.services.filter((service) => service.status !== "cancelled").map((service) => service.currency),
  ]);
  const byCurrency: MarineReportCurrency[] = [...currencies].sort().map((currency) => {
    const currencyBookings = bookings.filter((booking) => booking.currency === currency);
    const currencyPayments = trip.payload.payments.filter((payment) => payment.currency === currency);
    const receivedMinor = currencyPayments.reduce((sum, payment) => safeAdd(sum, payment.amountMinor), 0);
    const bookingTotalMinor = currencyBookings.reduce((sum, booking) => safeAdd(sum, booking.totalMinor), 0);
    const outstandingMinor = currencyBookings.reduce((sum, booking) => {
      const received = currencyPayments.filter((payment) => payment.bookingId === booking.id).reduce((subtotal, payment) => safeAdd(subtotal, payment.amountMinor), 0);
      return safeAdd(sum, Math.max(0, booking.totalMinor - received));
    }, 0);
    const extrasMinor = trip.payload.services.filter((service) => service.status !== "cancelled" && service.currency === currency)
      .reduce((sum, service) => safeAdd(sum, service.quantity * service.unitAmountMinor), 0);
    const costMinor = trip.payload.costs.filter((cost) => cost.currency === currency)
      .reduce((sum, cost) => safeAdd(sum, cost.amountMinor), 0);
    return {
      currency,
      bookingTotalMinor,
      receivedMinor,
      outstandingMinor,
      extrasMinor,
      costMinor,
      cashMarginMinor: safeAdd(receivedMinor, -costMinor),
    };
  });
  const agencies = new Map<string, MarineAgencyReport>();
  for (const booking of bookings) {
    const agency = booking.agency.trim() || "Directo";
    const current = agencies.get(agency) ?? { agency, bookings: 0, seats: 0 };
    current.bookings = safeAdd(current.bookings, 1);
    current.seats = safeAdd(current.seats, booking.seats);
    agencies.set(agency, current);
  }
  return { byCurrency, agency: [...agencies.values()].sort((a, b) => a.agency.localeCompare(b.agency, "es")) };
}

function projectBriefing(trip: MarineTrip): string[] {
  const totals = marineTotals(trip);
  return [
    `${trip.title} · ${new Date(trip.startAt).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" })}`,
    `Reservas confirmadas: ${totals.reserved}/${trip.capacity} plazas · registros completos: ${totals.registered}.`,
    `Pasajeros pendientes de registrar: ${Math.max(0, totals.reserved - totals.registered)}. Lista de pasajeros disponible para revisión del equipo.`
  ];
}

function projectDrafts(trip: MarineTrip) {
  const date = new Date(trip.startAt).toLocaleDateString("es-VE", { dateStyle: "long", timeZone: "America/Caracas" });
  const reason = trip.status === "cancelled" && trip.payload.cancellationReason
    ? ` Motivo informado: ${trip.payload.cancellationReason}.`
    : "";
  return {
    preTrip: `Hola. Te esperamos para ${trip.title} el ${date}. Revisa tu boleto y llega con tiempo. Este es un borrador para revisión del equipo.`,
    followUp: `Gracias por acompañarnos en ${trip.title}. Esperamos que hayas disfrutado el paseo. Este es un borrador para revisión del equipo.`,
    cancellation: `Hola. El paseo ${trip.title} previsto para el ${date} fue cancelado.${reason} El equipo te contactará para coordinar los próximos pasos. Este es un borrador para revisión del equipo.`,
  };
}

export function projectTrip(trip: MarineTrip, role: MarineRole): MarineTripView {
  const admin = isAdminRole(role);
  const base = {
    id: trip.id,
    title: trip.title,
    startAt: trip.startAt,
    endAt: trip.endAt,
    mode: trip.mode,
    capacity: trip.capacity,
    status: trip.status,
    revision: trip.revision,
    bookings: admin ? trip.payload.bookings : trip.payload.bookings.map(toCrewBooking),
    passengers: admin
      ? trip.payload.passengers.map((passenger) => projectAdminPassenger(trip, passenger, getEnv().APP_BASE_URL))
      : trip.payload.passengers.map(toCrewPassenger),
    services: admin ? trip.payload.services : trip.payload.services.map((service): CrewService => ({
      id: service.id, bookingId: service.bookingId, label: service.label, quantity: service.quantity,
      status: service.status, assignedTo: service.assignedTo, assignedMemberId: service.assignedMemberId, createdAt: service.createdAt,
    })),
    totals: marineTotals(trip),
    incidents: trip.payload.incidents.map((incident): MarineIncident => ({ id: incident.id, text: incident.text, createdAt: incident.createdAt, actorId: incident.actorId })),
    reconciliationRequired: trip.payload.reconciliationRequired,
    reconciliationNote: trip.payload.reconciliationNote,
  };
  if (!admin) return base;
  return {
    ...base,
    payments: trip.payload.payments,
    costs: trip.payload.costs,
    report: projectReport(trip),
    briefing: projectBriefing(trip),
    drafts: projectDrafts(trip),
  };
}

export function projectPublic(trip: MarineTrip, passengerId: string, includeTicketCode = true) {
  const passenger = trip.payload.passengers.find((item) => item.id === passengerId);
  if (!passenger) return null;
  return {
    tour: { title: trip.title, startAt: trip.startAt },
    passenger: { id: passenger.id, name: passenger.name, registered: passenger.registered, documentMasked: passenger.documentMasked, minor: passenger.minor },
    ...(includeTicketCode && passenger.registered && passenger.ticketEncrypted ? { ticketCode: decryptSecret(passenger.ticketEncrypted) } : {}),
  };
}

function csvCell(value: string | number | boolean | null): string {
  let text = value == null ? "" : String(value);
  if (/^[\u0000-\u0020]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportManifestCsv(trip: MarineTrip): string {
  const rows: Array<Array<string | number | boolean | null>> = [[
    "Tour", "Fecha", "Titular de la reserva", "Referencia", "Pasajero", "Documento", "Tipo de documento", "Teléfono", "Menor", "Representante", "Registro", "Movimiento",
  ]];
  for (const passenger of trip.payload.passengers) {
    const booking = trip.payload.bookings.find((item) => item.id === passenger.bookingId);
    if (!booking || booking.status !== "confirmed") continue;
    const document = passenger.documentEncrypted ? decryptSecret(passenger.documentEncrypted) : "";
    rows.push([
      trip.title,
      new Date(trip.startAt).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }),
      booking.customerName,
      booking.reference,
      passenger.name,
      document,
      passenger.documentType,
      passenger.phone,
      passenger.minor,
      passenger.representativeName, passenger.registered ? "Sí" : "Pendiente", passenger.movement,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
