#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.MARINE_LOGOUT_BASE_URL || "http://127.0.0.1:3130";
function testIpHint() { return `198.51.100.${Math.floor(Math.random() * 200) + 1}`; }

async function credentials() {
  if (process.env.MARINE_LOGOUT_EMAIL && process.env.MARINE_LOGOUT_PASSWORD) {
    return { email: process.env.MARINE_LOGOUT_EMAIL, password: process.env.MARINE_LOGOUT_PASSWORD };
  }
  const file = process.env.MARINE_LOGOUT_CREDENTIALS_FILE;
  if (!file) throw new Error("Set credential environment variables or MARINE_LOGOUT_CREDENTIALS_FILE.");
  const source = JSON.parse(await readFile(file, "utf8"));
  const account = Array.isArray(source.accounts)
    ? source.accounts.find((entry) => entry.role === (process.env.MARINE_LOGOUT_ROLE || "owner"))
    : source;
  if (!account?.email || !account?.password) throw new Error("Credential file has no selected test account.");
  return { email: account.email, password: account.password };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(page, account) {
  await page.goto(`${baseUrl}/nautica`);
  await page.getByRole("heading", { name: "Entrar a operaciones" }).waitFor();
  await page.getByLabel("Correo").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Salir" }).waitFor();
}

const account = await credentials();
const browser = await chromium.launch({ headless: true });
let checks = 0;
try {
  const successContext = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": testIpHint() } });
  const successPage = await successContext.newPage();
  await login(successPage, account);
  const sessionCookies = (await successContext.cookies(baseUrl)).filter((cookie) => /session_token/i.test(cookie.name));
  check(sessionCookies.length > 0, "Authenticated session cookie was not present before logout.");
  checks++;
  await successPage.getByRole("button", { name: "Salir" }).click();
  await successPage.getByRole("heading", { name: "Entrar a operaciones" }).waitFor();
  check(!(await successPage.getByRole("button", { name: "Salir" }).count()), "Logout control remained after successful logout.");
  checks++;
  const staleCookie = sessionCookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const staleResponse = await successContext.request.get(`${baseUrl}/api/marine`, { headers: { cookie: staleCookie } });
  check(staleResponse.status() === 401, "Previous session cookie can still read the authenticated Marine API.");
  checks++;
  await successContext.close();

  const failureContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": testIpHint() } });
  const failurePage = await failureContext.newPage();
  await login(failurePage, account);
  let failureIntercepted = false;
  await failurePage.route("**/api/auth/sign-out", async (route) => {
    failureIntercepted = true;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "synthetic failure" }) });
  });
  await failurePage.getByRole("button", { name: "Salir" }).click();
  await failurePage.getByRole("alert").waitFor();
  const sessionState = await failurePage.evaluate(async () => {
    const response = await fetch("/api/auth/get-session");
    const value = await response.json().catch(() => null);
    return { status: response.status, hasUser: Boolean(value?.user?.id) };
  });
  check(failureIntercepted, "Synthetic sign-out failure was not injected.");
  check(sessionState.status === 200 && sessionState.hasUser, "Logout failure invalidated the session.");
  check(await failurePage.getByRole("button", { name: "Salir" }).isVisible(), "Logout failure hid the sign-out control.");
  check(await failurePage.getByRole("heading", { name: "Operaciones" }).isVisible(), "Logout failure cleared the authenticated screen.");
  check(await failurePage.getByRole("heading", { name: "Entrar a operaciones" }).count() === 0, "Logout failure removed the authenticated screen.");
  checks++;
  await failureContext.close();
} finally {
  await browser.close();
}
console.log(`Logout checks passed: ${checks}`);
