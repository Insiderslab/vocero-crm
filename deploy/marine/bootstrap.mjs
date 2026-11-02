#!/usr/bin/env node
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const APP = "http://bambola-arm-private-app:3000";
const PUBLIC = "https://bambola.heili.cloud";
const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const accountsPath = value("--accounts");
const resultPath = value("--result");
if (!accountsPath || !resultPath || args.some((x, i) => x.startsWith("--") && !["--accounts", "--result"].includes(x)) || args.includes("--accounts") && !value("--accounts") || args.includes("--result") && !value("--result")) {
  process.stderr.write("Bootstrap requires --accounts and --result paths.\n");
  process.exit(2);
}

class Client {
  cookies = new Map();
  async request(path, method = "GET", body) {
    const headers = { host: "bambola.heili.cloud", origin: PUBLIC, accept: "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${APP}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";", 1)[0]; const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    let data;
    try { data = await response.json(); } catch { throw new Error("unexpected response"); }
    return { status: response.status, data };
  }
}

async function expect(client, path, method, body, status) {
  const result = await client.request(path, method, body);
  if (result.status !== status) throw new Error("unexpected API status");
  return result.data;
}

try {
  const parsed = JSON.parse(await fs.readFile(accountsPath, "utf8"));
  const accounts = parsed.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 5 || accounts.map((a) => a.role).join(",") !== "owner,admin,crew1,crew2,crew3") throw new Error("unexpected account manifest");
  for (const a of accounts) {
    if (typeof a.name !== "string" || !a.name.includes("PRUEBA") || !/^bambola-[a-z0-9]+@example\.invalid$/.test(a.email) || typeof a.password !== "string" || a.password.length < 20) throw new Error("invalid synthetic account");
  }
  const [owner, rosanni, ...crew] = accounts;
  const ownerClient = new Client();
  const signup = await ownerClient.request("/api/auth/sign-up/email", "POST", { name: owner.name, email: owner.email, password: owner.password });
  if (![200, 201].includes(signup.status)) {
    const login = await ownerClient.request("/api/auth/sign-in/email", "POST", { email: owner.email, password: owner.password });
    if (login.status !== 200) throw new Error("owner bootstrap failed");
  }
  const ownerSession = await expect(ownerClient, "/api/auth/get-session", "GET", undefined, 200);
  const organizationId = ownerSession?.session?.activeOrganizationId ?? ownerSession?.user?.activeOrganizationId;
  if (!organizationId) throw new Error("owner organization missing");
  const initial = await expect(ownerClient, "/api/settings/team", "GET", undefined, 200);
  for (const account of [rosanni, ...crew]) {
    if (!initial.members.some((m) => m.email === account.email)) {
      await expect(ownerClient, "/api/settings/team", "POST", { name: account.name, email: account.email, password: account.password }, 201);
    }
  }
  const team = await expect(ownerClient, "/api/settings/team", "GET", undefined, 200);
  const rosanniMember = team.members.find((m) => m.email === rosanni.email);
  if (!rosanniMember) throw new Error("admin member missing");
  if (rosanniMember.role !== "admin") {
    const changed = await expect(ownerClient, "/api/auth/organization/update-member-role", "POST", { memberId: rosanniMember.id, role: "admin", organizationId }, 200);
    const member = changed?.member ?? changed;
    if (!member || member.id !== rosanniMember.id || member.role !== "admin" || member.organizationId !== organizationId) throw new Error("role update not confirmed");
  }
  const freshAdmin = new Client();
  await expect(freshAdmin, "/api/auth/sign-in/email", "POST", { email: rosanni.email, password: rosanni.password }, 200);
  const adminMarine = await expect(freshAdmin, "/api/marine", "GET", undefined, 200);
  if (adminMarine?.role !== "admin") throw new Error("fresh admin marine role verification failed");
  const verified = await expect(freshAdmin, "/api/settings/team", "GET", undefined, 200);
  if (verified.members.find((m) => m.email === rosanni.email)?.role !== "admin") throw new Error("fresh admin role verification failed");
  const marine = adminMarine;
  let sample = marine.trips?.find((trip) => trip.title === "Tour piloto inicial — PRUEBA");
  if (!sample) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
    const created = await expect(freshAdmin, "/api/marine", "POST", { action: "createTrip", requestId: randomUUID(), title: "Tour piloto inicial — PRUEBA", startAt: start.toISOString(), endAt: end.toISOString(), mode: "public", capacity: 20 }, 200);
    sample = created.trip;
  }
  if (!sample?.id) throw new Error("synthetic sample tour missing");
  const freshOwner = new Client();
  await expect(freshOwner, "/api/auth/sign-in/email", "POST", { email: owner.email, password: owner.password }, 200);
  const ownerMarine = await expect(freshOwner, "/api/marine", "GET", undefined, 200);
  if (ownerMarine?.role !== "owner") throw new Error("fresh owner role verification failed");
  for (const account of crew) {
    const crewClient = new Client();
    await expect(crewClient, "/api/auth/sign-in/email", "POST", { email: account.email, password: account.password }, 200);
    const crewMarine = await expect(crewClient, "/api/marine", "GET", undefined, 200);
    if (crewMarine?.role !== "member") throw new Error("fresh crew role verification failed");
  }
  const closedSignup = await new Client().request("/api/auth/sign-up/email", "POST", { name: "Control PRUEBA", email: `bambola-negative-${Date.now()}@example.invalid`, password: "not-a-real-account-1234" });
  if (closedSignup.status !== 403) throw new Error("signup closure was not confirmed");
  await fs.writeFile(resultPath, JSON.stringify({ version: 1, ok: true, ownerCreated: true, rosanniRole: "admin", crewCount: crew.length, signupClosed: true, sampleTourId: sample.id }) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write("Private bootstrap completed; redacted result written.\n");
} catch {
  process.stderr.write("Private bootstrap failed; inspect private redacted evidence.\n");
  process.exitCode = 1;
}
