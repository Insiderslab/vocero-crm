import assert from "node:assert/strict";
import { AUTH_PACING_INTERVAL_MS, Client, createAuthPacer } from "../bootstrap.mjs";

assert.equal(AUTH_PACING_INTERVAL_MS, 11000);
const originalFetch = globalThis.fetch;
const starts = [];
const sleeps = [];
let fourSecondCounter = null;
const fourSecondStatuses = [1000, 5000, 9000, 13000].map((now) => {
  if (!fourSecondCounter || now - fourSecondCounter.lastRequest > 10000) fourSecondCounter = { count: 1, lastRequest: now };
  else if (fourSecondCounter.count >= 3) return 429;
  else { fourSecondCounter.count++; fourSecondCounter.lastRequest = now; }
  return 200;
});
assert.deepEqual(fourSecondStatuses, [200, 200, 200, 429], "Better Auth's lastRequest window rejects the fourth 4-second-spaced request");
let clock = 1000;
let counter = null;
const pacer = createAuthPacer({
  intervalMs: AUTH_PACING_INTERVAL_MS,
  now: () => clock,
  sleep: async (ms) => { sleeps.push(ms); clock += ms; },
});
globalThis.fetch = async (url, options) => {
  const request = { path: new URL(url).pathname, method: options.method, at: clock };
  starts.push(request);
  if (request.path.startsWith("/api/auth/sign-in/email") || request.path.startsWith("/api/auth/sign-up/email")) {
    if (!counter || clock - counter.lastRequest > 10000) counter = { count: 1, lastRequest: clock };
    else if (counter.count >= 3) return { status: 429, headers: { getSetCookie: () => [] }, json: async () => ({ ok: false }) };
    else { counter.count++; counter.lastRequest = clock; }
  }
  return { status: 200, headers: { getSetCookie: () => [] }, json: async () => ({ ok: true }) };
};

try {
  const authResponses = await Promise.all([
    new Client(pacer).request("/api/auth/sign-in/email", "POST", { email: "one@example.invalid" }),
    new Client(pacer).request("/api/auth/sign-up/email", "POST", { email: "two@example.invalid" }),
    new Client(pacer).request("/api/auth/sign-in/email", "POST", { email: "three@example.invalid" }),
    new Client(pacer).request("/api/auth/sign-in/email", "POST", { email: "four@example.invalid" }),
  ]);
  assert.deepEqual(authResponses.map((response) => response.status), [200, 200, 200, 200]);
  assert.deepEqual(starts.map((request) => request.at), [1000, 12000, 23000, 34000]);
  assert.ok(starts.slice(1).every((request, index) => request.at - starts[index].at >= AUTH_PACING_INTERVAL_MS));
  assert.deepEqual(sleeps, [11000, 11000, 11000]);

  await new Client(pacer).request("/api/settings/team", "GET");
  assert.equal(starts.at(-1).at, 34000, "non-auth requests are not paced");
  console.log("PASS shared 11-second auth pacing across Client instances; other requests remain unpaced");
} finally {
  globalThis.fetch = originalFetch;
}
