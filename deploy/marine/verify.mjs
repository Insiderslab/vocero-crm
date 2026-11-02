#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

const PUBLIC_BASE = "https://bambola.heili.cloud";
const LOCAL_BASE = "http://127.0.0.1:3130";
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function argsOf(argv) {
  const result = { local: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--local") result.local = true;
    else if (["--credentials", "--tenant-proof", "--result"].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith("--")) result[arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = argv[++i];
    else throw new Error("invalid command arguments");
  }
  if (!result.credentials) throw new Error("--credentials is required");
  if (process.env.MARINE_VERIFY_BASE_URL) throw new Error("use --local for the explicit local preview; custom base URLs are not accepted");
  result.base = result.local ? LOCAL_BASE : PUBLIC_BASE;
  return result;
}

async function readAccounts(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : (parsed.email && parsed.password ? [parsed] : null);
  if (!accounts?.length || accounts.some((account) => typeof account.email !== "string" || typeof account.password !== "string")) throw new Error("invalid credentials file");
  return accounts;
}

function redactFailure(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "request timed out";
  return "request failed";
}

const checks = [];
const createdTripIds = [];
let reportOptions = null;
function record(name, passed, state = passed ? "pass" : "fail") {
  checks.push({ name, status: state });
  return passed;
}
function requireCheck(name, passed) {
  if (!record(name, passed)) throw new Error("workflow prerequisite failed");
}

class Client {
  constructor(base, origin) { this.base = base; this.origin = origin; this.cookies = new Map(); }
  async request(path, { method = "GET", body, rawBody, stream = false, headers = {}, origin = this.origin, timeout = 15000 } = {}) {
    const requestHeaders = { accept: "application/json", ...headers };
    if (origin) requestHeaders.origin = origin;
    if (this.cookies.size) requestHeaders.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    let payload = rawBody;
    if (body !== undefined) { requestHeaders["content-type"] = "application/json"; payload = JSON.stringify(body); }
    if (stream) {
      const bytes = new TextEncoder().encode(payload ?? "");
      payload = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    }
    const response = await fetch(new URL(path, this.base), {
      method, headers: requestHeaders, body: payload,
      ...(stream ? { duplex: "half" } : {}), redirect: "manual", signal: AbortSignal.timeout(timeout),
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("json") ? await response.json().catch(() => null) : null;
    return { response, data };
  }
  async login(account) {
    return this.request("/api/auth/sign-in/email", { method: "POST", body: { email: account.email, password: account.password } });
  }
  async command(data, options = {}) { return this.request("/api/marine", { method: "POST", body: data, ...options }); }
}

function tripView(result) { return result.data?.trip ?? null; }
function hasSecurityHeaders(headers) {
  return (headers.get("cache-control") ?? "").toLowerCase().includes("no-store")
    && headers.get("referrer-policy") === "no-referrer"
    && headers.get("x-robots-tag") === "noindex"
    && (headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'");
}

async function verifyForbiddenSurface(client) {
  const paths = [
    ["GET", "/api/auth/sign-up/email"],
    ["GET", "/api/auth/organization/update-member-role"],
    ["GET", "/api/settings/team"],
    ["GET", "/api/dev/wa-mock/graph/version"],
    ["GET", "/api/bot/messages"],
    ["GET", "/api/webhooks/meta"],
    ["GET", "/api/booking"],
    ["GET", "/_next/image?url=%2Flogo.png&w=640&q=75"],
    ["GET", "/api/auth/sign-in/magic-link"],
    ["GET", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/sign-in/magic-link"],
    ["POST", "/api/auth/device/authorize"],
    ["POST", "/api/auth/forget-password"],
    ["GET", "/api/auth/device/authorize"],
    ["GET", "/api/auth/oauth-proxy-callback"],
    ["GET", "/__vitest__/"],
    ["GET", "/__vitest_api__/"],
    ["GET", "/@vite/client"],
    ["GET", "/@fs/etc/passwd"],
    ["GET", "/__open-in-editor"],
    ["GET", "/_next/webpack-hmr"],
    ["GET", "/_next/static/dependency-probe.js.map"],
    ["GET", "/api%2Fauth%2Fsign-up%2Femail"],
    ["GET", "/api/auth/%2e%2e/auth/sign-up/email"],
    ["POST", "/api/auth/%2e%2e/sign-up/email"],
    ["POST", "/api%2Fauth%2Fsign-up%2Femail"],
    ["PUT", "/api/marine"],
    ["DELETE", "/api/public/marine"],
    ["POST", "/nautica"],
  ];
  let allDenied = true;
  for (const [method, path] of paths) {
    const response = await client.request(path, { method });
    allDenied &&= response.response.status === 404;
  }
  record("gateway denies inherited, encoded, image and unsupported method routes", allDenied);
}

async function bodyLimitChecks(owner) {
  const authBody = JSON.stringify({ email: "not-an-account@example.invalid", password: "x", pad: "a".repeat(34000) });
  const authDeclared = await owner.request("/api/auth/sign-in/email", { method: "POST", rawBody: authBody, headers: { "content-type": "application/json" } });
  record("declared auth body above 32 KiB is rejected", authDeclared.response.status === 413);
  const authChunked = await owner.request("/api/auth/sign-in/email", { method: "POST", rawBody: authBody, stream: true, headers: { "content-type": "application/json" } });
  record("chunked auth body above 32 KiB is rejected", authChunked.response.status === 413);

  const marineBody = JSON.stringify({ action: "addIncident", tripId: "oversize_probe", requestId: randomUUID(), text: "x".repeat(17000) });
  const marineDeclared = await owner.request("/api/marine", { method: "POST", rawBody: marineBody, headers: { "content-type": "application/json" } });
  record("declared Marine body above 16 KiB is rejected", marineDeclared.response.status === 413);
  const marineChunked = await owner.request("/api/marine", { method: "POST", rawBody: marineBody, stream: true, headers: { "content-type": "application/json" } });
  record("chunked Marine body above 16 KiB is rejected", marineChunked.response.status === 413);
}

async function authSpoofProbe(client) {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const result = await client.request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "marine-rate-limit-probe@example.invalid", password: "synthetic-wrong-password" },
      headers: { "x-forwarded-for": `198.51.100.${10 + i}` },
    });
    statuses.push(result.response.status);
  }
  const firstLimited = statuses.indexOf(429);
  const sustained = firstLimited >= 0 && statuses.slice(firstLimited).every((status) => status === 429);
  const sustainedTail = statuses.slice(-3).every((status) => status === 429);
  record("spoofed X-Forwarded-For cannot evade the shared auth login limiter", sustained && sustainedTail && statuses.every((status) => status === 401 || status === 429));
}

function makeInvalidMarineToken(index) {
  const secret = index.toString(16).padStart(32, "0").toUpperCase();
  return Buffer.from(JSON.stringify({ v: 1, organizationId: "org_probe", tripId: "trip_probe", passengerId: "passenger_probe", secret })).toString("base64url");
}

async function marineIpSpoofProbe(base) {
  const statuses = [];
  for (let i = 0; i < 62; i++) {
    const token = makeInvalidMarineToken(i + 1);
    const response = await fetch(new URL("/api/public/marine", base), {
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": `198.51.100.${10 + (i % 200)}` },
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    statuses.push(response.status);
    await response.body?.cancel();
  }
  const firstLimited = statuses.indexOf(429);
  const sustained = firstLimited >= 0 && statuses.slice(firstLimited).every((status) => status === 429);
  const sustainedTail = statuses.slice(-3).every((status) => status === 429);
  const boundedErrors = statuses.every((status) => status === 404 || status === 429);
  record("spoofed X-Forwarded-For cannot evade the 60-per-IP Marine limiter", sustained && sustainedTail && boundedErrors);
}

async function runMarineWorkflow(owner, member) {
  const requestId = () => randomUUID();
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
  const created = await owner.command({ action: "createTrip", requestId: requestId(), title: `Verificación HTTP · PRUEBA ${Date.now()}`, startAt: start.toISOString(), endAt: end.toISOString(), mode: "public", capacity: 2 });
  requireCheck("owner creates a labelled synthetic tour", created.response.status === 200 && Boolean(tripView(created)?.id));
  const trip = tripView(created);
  createdTripIds.push(trip.id);
  const tripId = trip.id;

  const bookingResult = await owner.command({ action: "createBooking", tripId, requestId: requestId(), reference: `VERIFY-${randomUUID().slice(0, 8)}`, customerName: "Pasajero sintético PRUEBA", customerPhone: "+584120000001", seats: 1, status: "confirmed", agency: "PRUEBA", totalMinor: 0, currency: "USD" });
  requireCheck("owner books one synthetic seat", bookingResult.response.status === 200);
  let current = tripView(bookingResult);
  const passenger = current?.passengers?.find((person) => person.registrationLink);
  requireCheck("booking creates one registration credential", Boolean(passenger?.registrationLink));
  const registrationToken = new URL(passenger.registrationLink).hash.slice(1);
  requireCheck("registration token is present only in-memory", registrationToken.length > 0);

  const boarding = await owner.command({ action: "changeTripStatus", tripId, status: "boarding", requestId: requestId() });
  requireCheck("admin opens boarding", boarding.response.status === 200);
  const registration = await fetch(new URL("/api/public/marine", owner.base), { headers: { authorization: `Bearer ${registrationToken}`, accept: "application/json" }, redirect: "manual" });
  record("public bearer reads its assigned slot with security headers", registration.status === 200 && hasSecurityHeaders(registration.headers));
  await registration.json().catch(() => null);
  const registered = await fetch(new URL("/api/public/marine", owner.base), {
    method: "POST", headers: { authorization: `Bearer ${registrationToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name: "Pasajero PRUEBA", documentType: "passport", documentNumber: "TEST-1234", phone: "+584120000001", email: "", minor: false, confirmed: true, marketingOptIn: false, requestId: requestId() }),
    redirect: "manual",
  });
  requireCheck("public bearer registers only the synthetic passenger with security headers", registered.status === 200 && hasSecurityHeaders(registered.headers));
  const registrationResult = await registered.json().catch(() => null);
  const ticketCode = registrationResult?.ticketCode;
  requireCheck("public registration returns a ticket code", typeof ticketCode === "string" && ticketCode.length >= 32);

  const lookup = await member.command({ action: "lookupTicket", tripId, ticketCode, requestId: requestId() });
  requireCheck("member looks up the ticket with a redacted passenger", lookup.response.status === 200 && lookup.data?.passenger?.id === passenger.id && !JSON.stringify(lookup.data).includes("TEST-1234"));
  const board = await member.command({ action: "movePassenger", tripId, ticketCode, movement: "board", requestId: requestId() });
  requireCheck("member boards the scanned passenger", board.response.status === 200);
  const service = await member.command({ action: "addServiceRequest", tripId, requestId: requestId(), label: "Agua de prueba PRUEBA", quantity: 1 });
  requireCheck("member adds an unpriced synthetic service request", service.response.status === 200);
  const serviceId = tripView(service)?.services?.find((item) => item.label === "Agua de prueba PRUEBA")?.id;
  requireCheck("service request is returned to the crew", Boolean(serviceId));
  const doing = await member.command({ action: "changeServiceStatus", tripId, serviceId, status: "doing", requestId: requestId() });
  const done = await member.command({ action: "changeServiceStatus", tripId, serviceId, status: "done", requestId: requestId() });
  requireCheck("crew completes its synthetic service", doing.response.status === 200 && done.response.status === 200);

  const underway = await owner.command({ action: "changeTripStatus", tripId, status: "underway", physicalCount: 1, paperEntriesResolved: true, requestId: requestId() });
  requireCheck("admin stops boarding and starts the synthetic tour", underway.response.status === 200);
  const offboard = await member.command({ action: "movePassenger", tripId, passengerId: passenger.id, movement: "offboard", requestId: requestId() });
  requireCheck("member records a passenger stop", offboard.response.status === 200);
  const returned = await member.command({ action: "movePassenger", tripId, passengerId: passenger.id, movement: "return", requestId: requestId() });
  requireCheck("member records passenger return", returned.response.status === 200);
  const deboard = await member.command({ action: "movePassenger", tripId, passengerId: passenger.id, movement: "deboard", requestId: requestId() });
  requireCheck("member records disembarkation", deboard.response.status === 200);
  const complete = await owner.command({ action: "changeTripStatus", tripId, status: "completed", physicalCount: 0, paperEntriesResolved: true, requestId: requestId() });
  requireCheck("admin completes and cleans up the synthetic tour", complete.response.status === 200);
}

async function cleanupTrips(owner) {
  for (const tripId of createdTripIds) {
    try {
      const detail = await owner.request(`/api/marine?tripId=${encodeURIComponent(tripId)}`);
      const trip = detail.data?.trip;
      if (!trip || ["completed", "cancelled"].includes(trip.status)) continue;
      for (const passenger of trip.passengers ?? []) {
        if (passenger.movement === "away" && trip.status === "underway") {
          await owner.command({ action: "movePassenger", tripId, passengerId: passenger.id, movement: "return", requestId: randomUUID() });
        }
        const refresh = await owner.request(`/api/marine?tripId=${encodeURIComponent(tripId)}`);
        const person = refresh.data?.trip?.passengers?.find((item) => item.id === passenger.id);
        if (person?.movement === "aboard" && ["boarding", "underway"].includes(refresh.data.trip.status)) {
          await owner.command({ action: "movePassenger", tripId, passengerId: person.id, movement: "deboard", requestId: randomUUID() });
        }
      }
      const after = await owner.request(`/api/marine?tripId=${encodeURIComponent(tripId)}`);
      const safe = after.data?.trip;
      if (!safe || safe.totals?.aboard !== 0 || safe.totals?.away !== 0) {
        record("new synthetic tour cleanup is safe", false);
        continue;
      }
      if (safe.status === "underway") {
        const result = await owner.command({ action: "changeTripStatus", tripId, status: "completed", physicalCount: 0, paperEntriesResolved: true, requestId: randomUUID() });
        record("incomplete synthetic tour closed as completed", result.response.status === 200);
      } else {
        const result = await owner.command({ action: "changeTripStatus", tripId, status: "cancelled", reason: "Cierre del tour sintético de verificación.", requestId: randomUUID() });
        record("incomplete synthetic tour cancelled", result.response.status === 200);
      }
    } catch {
      record("new synthetic tour cleanup completed", false);
    }
  }
}

async function crossTenantCheck(options) {
  if (!options.tenantProof) {
    record("cross-tenant negative requires the completed tenant proof artifact", false, "blocked");
    return;
  }
  const proof = JSON.parse(await readFile(options.tenantProof, "utf8"));
  const completed = typeof proof.completedAt === "string" ? Date.parse(proof.completedAt) : NaN;
  const age = Date.now() - completed;
  const valid = proof.version === 1
    && proof.ok === true
    && options.base === PUBLIC_BASE
    && proof.base === PUBLIC_BASE
    && typeof proof.sourceAppImageId === "string" && /^sha256:[0-9a-f]{64}$/.test(proof.sourceAppImageId)
    && Number.isFinite(completed) && age >= 0 && age <= 60 * 60 * 1000
    && ["readIsolation", "writeIsolation", "sessionRestored", "logout"].every((key) => proof.checks?.[key] === true)
    && typeof proof.originalOrganizationId === "string" && SAFE_ID.test(proof.originalOrganizationId)
    && typeof proof.sampleTourId === "string" && SAFE_ID.test(proof.sampleTourId);
  record("recent tenant isolation proof matches the fixed public app image", valid);
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  reportOptions = options;
  const origin = options.base;
  const accounts = await readAccounts(options.credentials);
  const ownerAccount = accounts.find((a) => a.role === "owner");
  const adminAccount = accounts.find((a) => a.role === "admin");
  const memberAccount = accounts.find((a) => a.role === "crew1" || a.role === "member");
  if (!ownerAccount || !adminAccount || !memberAccount) throw new Error("credentials must include owner, admin and crew member roles");
  const owner = new Client(options.base, origin);
  const admin = new Client(options.base, origin);
  const member = new Client(options.base, origin);

  const root = await owner.request("/", { timeout: 20000 });
  record("root landing redirects to Nautica", root.response.status === 302 && root.response.headers.get("location")?.endsWith("/nautica"));
  const page = await owner.request("/nautica", { origin: null, timeout: 20000 });
  record("Nautica page is served with no-store and framing protections", page.response.status === 200 && hasSecurityHeaders(page.response.headers));
  await verifyForbiddenSurface(owner);

  const anonymous = new Client(options.base, origin);
  const anonymousRead = await anonymous.request("/api/marine");
  record("anonymous Marine API read is unauthorized", anonymousRead.response.status === 401);
  const publicNoBearer = await anonymous.request("/api/public/marine", { origin: null });
  record("public Marine API requires a bearer token and security headers", publicNoBearer.response.status === 401 && hasSecurityHeaders(publicNoBearer.response.headers));
  const signup = await anonymous.request("/api/auth/sign-up/email", { method: "POST", body: { name: "Control PRUEBA", email: `marine-signup-${Date.now()}@example.invalid`, password: "synthetic-password-123" } });
  record("public signup route is denied", signup.response.status === 404);

  const ownerLogin = await owner.login(ownerAccount);
  const adminLogin = await admin.login(adminAccount);
  const memberLogin = await member.login(memberAccount);
  record("owner login succeeds", ownerLogin.response.status === 200);
  record("admin login succeeds", adminLogin.response.status === 200);
  record("crew login succeeds", memberLogin.response.status === 200);
  const [ownerView, adminView, memberView] = await Promise.all([owner.request("/api/marine"), admin.request("/api/marine"), member.request("/api/marine")]);
  record("owner role is recognized", ownerView.data?.role === "owner");
  record("Rosanni admin role is recognized", adminView.data?.role === "admin");
  record("crew role is restricted to member", memberView.data?.role === "member");
  record("authenticated Marine response carries no-store and framing protections", hasSecurityHeaders(ownerView.response.headers));
  const memberCreate = await member.command({ action: "createTrip", title: "Rejected PRUEBA", startAt: new Date(Date.now() + 86400000).toISOString(), endAt: new Date(Date.now() + 90000000).toISOString(), mode: "public", capacity: 1, requestId: randomUUID() });
  record("member cannot create tours", memberCreate.response.status === 403);
  const memberExport = await member.command({ action: "exportManifest", tripId: "not_a_trip", requestId: randomUUID() });
  record("member cannot export identity manifests", memberExport.response.status === 403);
  const foreignOrigin = await owner.command({ action: "addIncident", tripId: "not_a_trip", text: "origin probe", requestId: randomUUID() }, { origin: "https://example.invalid" });
  record("authenticated mutation rejects foreign Origin", foreignOrigin.response.status === 403);

  const health = await anonymous.request("/api/health", { origin: null });
  record("gateway and application health endpoint responds", health.response.status === 200);
  await bodyLimitChecks(owner);

  try { await runMarineWorkflow(owner, member); }
  catch { record("synthetic tour lifecycle completed", false); }
  await cleanupTrips(owner);
  await crossTenantCheck(options);

  const staleCookies = [...owner.cookies].filter(([name]) => /session_token/i.test(name));
  record("owner session cookie captured for logout invalidation probe", staleCookies.length > 0);
  const staleCookieHeader = staleCookies.map(([name, value]) => `${name}=${value}`).join("; ");
  const logout = await owner.request("/api/auth/sign-out", { method: "POST", body: {}, headers: { "content-type": "application/json" } });
  record("owner sign-out succeeds", logout.response.ok);
  const stale = await new Client(options.base, origin).request("/api/marine", { headers: { cookie: staleCookieHeader } });
  record("old cookie cannot read the authenticated Marine API", stale.response.status === 401);

  await authSpoofProbe(anonymous);
  await marineIpSpoofProbe(options.base);

  const failed = checks.filter((item) => item.status === "fail").length;
  const blocked = checks.filter((item) => item.status === "blocked").length;
  const report = { version: 1, generatedAt: new Date().toISOString(), base: options.base, status: failed ? "failed" : blocked ? "blocked" : "passed", checks };
  await saveReport(report, options.result);
  console.log(JSON.stringify(report));
  if (failed || blocked) process.exitCode = 1;
}

async function saveReport(report, resultPath) {
  if (!resultPath) return;
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try { await chmod(resultPath, 0o600); } catch { /* Windows ACLs are managed by the local runtime owner. */ }
}

try {
  await main();
} catch (error) {
  checks.push({ name: "verification run completed", status: "fail", reason: redactFailure(error) });
  const failed = checks.filter((item) => item.status === "fail").length;
  const blocked = checks.filter((item) => item.status === "blocked").length;
  if (reportOptions?.result) {
    try {
      await saveReport({ version: 1, generatedAt: new Date().toISOString(), base: reportOptions.base, status: failed ? "failed" : blocked ? "blocked" : "passed", checks }, reportOptions.result);
    } catch { /* keep output redacted even when local evidence cannot be written */ }
  }
  console.log(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), base: reportOptions?.base ?? null, status: "failed", checks }));
  process.exitCode = 1;
}
