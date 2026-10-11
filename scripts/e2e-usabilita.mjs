/**
 * Self-test E2E en NAVEGADOR — 009 usabilidad P1 (specs/custom-heili/009-usabilita-p1.md).
 *
 * Lo que la API sola no puede ver: lo que el usuario tiene delante.
 *  - E3: esqueleto (no "Nessun contatto") mientras la API tarda;
 *  - E6: el primer clic tras navegar (carga completa y navegación por el
 *    lateral) abre «Gestisci fasi» y el acordeón del Laboratorio;
 *  - E1: filtro «Assistenza umana», etiqueta «Errore del provider IA»,
 *    «Riprova risposta IA», aviso (toast) en otra pantalla y su enlace;
 *  - E2/E9: etapas traducidas, título de la pestaña;
 *  - E7/E8/E10: contraste de la hora en la burbuja saliente, separador de día
 *    visible, pie del lateral sin solapes, interruptor del agente.
 *
 * Uso: node scripts/e2e-usabilita.mjs (app en `next dev` con
 * WA_MOCK_ENABLED=true, ai-mock y AGENT_RETRY_MS corto, p. ej. 4000).
 * Chromium: el de Playwright, o PLAYWRIGHT_CHROMIUM=<ruta al ejecutable>.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "scratch/usabilita";
const PN = "PN-UX-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* reintenta */
    }
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
};

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
ctx.setDefaultNavigationTimeout(180000);
ctx.setDefaultTimeout(30000);
const req = ctx.request;

console.log("== Setup ==");
let r = await req.post(`${BASE}/api/auth/sign-up/email`, {
  headers: { origin: BASE },
  data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123" },
  });
ok("login", r.ok());
await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-UX", phoneNumberId: PN, token: "tok-ux" },
});
const ERROR_REPLY = `Ora non riesco a rispondere (${S}); ti scrive una persona.`;
await req.put(`${BASE}/api/agent/profile`, { data: { enabled: true, errorReply: ERROR_REPLY } });

const inbound = (from, name, text) =>
  req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    data: { phoneNumberId: PN, from, name, text, waMessageId: `wamid.ux.${S}.${from}.${Date.now()}` },
  });
const convs = async () => (await (await req.get(`${BASE}/api/conversations`)).json()).conversations;

// Una conversación que el proveedor de IA tumba (ai-mock: «mock-proveedor-caido»).
const DOWN_NAME = `Caido${S}`;
const DOWN = `39347${Math.floor(Math.random() * 9e6) + 1e6}`;
await inbound(DOWN, DOWN_NAME, "mock-proveedor-caido, avete posto?");
const failed = await until(
  async () => (await convs()).some((c) => c.contact.name === DOWN_NAME && c.handoffReason === "error"),
  60000
);
ok("conversación con handoff `error` preparada", failed);

// Calienta las rutas (en `next dev` la primera visita compila).
for (const ruta of ["/inbox", "/pipeline", "/contacts", "/agent", "/lab", "/automations"]) {
  await req.get(`${BASE}${ruta}`, { timeout: 180000 });
}

/* ------------------------------- E9 + E2 ------------------------------- */
console.log("\n== E9 título · E2 etapas ==");
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pipeline`);
  ok("E9: título de la pestaña", (await page.title()).endsWith("— WhatsApp"), await page.title());
  await page.getByText("Gestisci fasi").waitFor();
  await page.waitForSelector("[data-loading]", { state: "detached" });
  const body = await page.locator("main").innerText();
  ok("E2: columnas con etapas de fábrica en italiano", /Nuovo/.test(body) && /Perso/.test(body), body.slice(0, 200));
  ok("pie de columna sin «Nessun importo inserito» repetido", !body.includes("Nessun importo inserito"));
  await ctx.addCookies([{ name: "heili-locale", value: "en", url: BASE }]);
  await page.reload();
  await page.getByText("Manage stages").waitFor();
  await page.waitForSelector("[data-loading]", { state: "detached" });
  const bodyEn = await page.locator("main").innerText();
  ok("E2: con la interfaz en inglés las mismas etapas se leen en inglés", /\bNew\b/.test(bodyEn) && /\bLost\b/.test(bodyEn), bodyEn.slice(0, 200));
  await ctx.addCookies([{ name: "heili-locale", value: "it", url: BASE }]);
  await page.close();
}

/* --------------------------------- E3 --------------------------------- */
console.log("\n== E3: esqueletos mientras la API tarda ==");
for (const [ruta, api, vacio] of [
  ["/contacts", "**/api/contacts?**", "Nessun contatto"],
  ["/pipeline", "**/api/pipeline/board", null],
  ["/lab", "**/api/lab/runs", "Nessuna"],
  ["/automations", "**/api/automations", null],
  ["/agent", "**/api/agent/profile", null],
]) {
  const page = await ctx.newPage();
  let release;
  const gate = new Promise((res) => (release = res));
  await page.route(api, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`${BASE}${ruta}`);
  const skeleton = await until(async () => (await page.locator("[data-loading]").count()) > 0, 15000);
  const texto = await page.locator("main").innerText();
  ok(`${ruta}: esqueleto mientras carga`, skeleton);
  if (vacio) ok(`${ruta}: sin estado vacío falso durante la carga`, !texto.includes(vacio), texto.slice(0, 120));
  release();
  ok(
    `${ruta}: el esqueleto se va al llegar los datos`,
    await until(async () => (await page.locator("main [data-loading]").count()) === 0, 20000)
  );
  await page.close();
}

/* --------------------------------- E6 --------------------------------- */
console.log("\n== E6: el primer clic tras navegar ==");
{
  // Carga completa: se hace clic en cuanto el botón ESTÁ, sin esperar a nada.
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pipeline`, { waitUntil: "commit" });
  // `force`: sin esperar a nada más que a que el botón exista y se vea —
  // justo lo que hace una persona impaciente antes de la hidratación.
  await page.getByRole("button", { name: "Gestisci fasi" }).click({ force: true });
  ok(
    "carga completa: el primer clic en «Gestisci fasi» abre el gestor",
    await until(async () => page.getByRole("heading", { name: "Fasi della pipeline" }).isVisible(), 15000)
  );
  // Navegación por el lateral: igual.
  await page.goto(`${BASE}/inbox`);
  await page.getByRole("link", { name: "Pipeline" }).click();
  await page.getByRole("button", { name: "Gestisci fasi" }).click();
  ok(
    "navegación por el lateral: el primer clic abre el gestor",
    await until(async () => page.getByRole("heading", { name: "Fasi della pipeline" }).isVisible(), 15000)
  );
  await page.close();
}
{
  // Acordeón del Laboratorio: hace falta una corrida terminada.
  const launch = await req.post(`${BASE}/api/lab/runs`);
  const runId = (await launch.json().catch(() => ({})))?.runId;
  const done = await until(async () => {
    const d = await (await req.get(`${BASE}/api/lab/runs`)).json();
    return d.runs.some((x) => x.id === runId && x.status !== "running");
  }, 120000);
  ok("corrida del Laboratorio terminada", Boolean(runId) && done);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/lab`, { waitUntil: "commit" });
  const first = page.locator("main button", { hasText: /Acquirente deciso|Cacciatore di prezzi|Cliente arrabbiato/ }).first();
  await first.waitFor({ state: "visible" });
  await first.click({ force: true });
  ok(
    "Laboratorio: el primer clic abre el acordeón (transcripción visible)",
    await until(async () => page.getByText("Trascrizione").first().isVisible(), 15000)
  );
  await page.close();
}

/* --------------------------------- E1 --------------------------------- */
console.log("\n== E1: visibilidad del handoff ==");
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/inbox`);
  await page.waitForSelector("ul li button");
  const filtro = page.getByRole("button", { name: /Assistenza umana/ });
  ok("filtro «Assistenza umana» junto a Tutte / Non lette", await filtro.isVisible());
  const primera = await page.locator("ul li button").first().innerText();
  ok("las conversaciones con handoff van arriba", /Errore del provider IA|Assistenza umana|telefono|persona|Finestra/.test(primera), primera);
  await filtro.click();
  const filas = await page.locator("ul li button").allInnerTexts();
  ok("con el filtro, solo conversaciones con handoff", filas.length > 0 && filas.some((t) => t.includes(DOWN_NAME)), String(filas.length));
  const fila = page.locator("ul li button", { hasText: DOWN_NAME });
  ok("etiqueta «Errore del provider IA» en la fila", (await fila.innerText()).includes("Errore del provider IA"));
  await fila.click();
  const riprova = page.getByRole("button", { name: "Riprova risposta IA" });
  ok("«Riprova risposta IA» en el panel", await until(() => riprova.isVisible(), 15000));
  await riprova.click();
  ok(
    "al reintentar se avisa que la IA está respondiendo",
    // En `next dev` la primera llamada a la ruta la compila: margen amplio.
    await until(() => page.getByText("L'IA sta rispondendo").isVisible(), 60000)
  );

  // E7: hora legible en la burbuja saliente (la cortesía es un saliente).
  await page.waitForSelector("[data-bubble-time]");
  const contraste = await page.evaluate(() => {
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const out = [...document.querySelectorAll("[data-bubble-time]")].find((el) =>
      el.className.includes("bubble-out-meta")
    );
    if (!out) return 0;
    let bubble = out.parentElement;
    while (bubble && getComputedStyle(bubble).backgroundColor === "rgba(0, 0, 0, 0)") bubble = bubble.parentElement;
    const a = lum(parse(getComputedStyle(out).color));
    const b = lum(parse(getComputedStyle(bubble).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  ok("E7: hora en la burbuja saliente ≥ 4,5:1", contraste >= 4.5, contraste.toFixed(2));
  const sep = await page.evaluate(() => {
    const s = document.querySelector("[data-day-separator] span");
    const box = s.closest(".overflow-y-auto").getBoundingClientRect();
    const r = s.getBoundingClientRect();
    return r.top >= box.top && r.bottom <= box.bottom;
  });
  ok("E7: el separador de día se ve entero", sep);
  await page.screenshot({ path: `${SHOTS}/inbox-handoff.png` });

  // E8: pie del lateral.
  const pie = await page.evaluate(() => {
    const footer = document.querySelector("[data-user-footer]");
    const lang = footer.querySelector('button[aria-label^="Language"]').getBoundingClientRect();
    const name = footer.querySelector("[title]");
    const role = name.nextElementSibling.getBoundingClientRect();
    const cruza = !(lang.right <= role.left || lang.left >= role.right || lang.bottom <= role.top || lang.top >= role.bottom);
    return { cruza, cortado: name.scrollWidth > name.clientWidth };
  });
  ok("E8: el botón del idioma no pisa el rol", !pie.cruza);
  ok("E8: el nombre no se corta", !pie.cortado);
  await page.close();
}
{
  // Aviso en OTRA pantalla y su enlace.
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pipeline`);
  await page.getByText("Gestisci fasi").waitFor();
  await sleep(1500); // SSE conectado
  const HUMAN_NAME = `Umano${S}`;
  await inbound(`39348${Math.floor(Math.random() * 9e6) + 1e6}`, HUMAN_NAME, "quiero hablar con un humano");
  const toast = page.getByRole("status").filter({ hasText: `${HUMAN_NAME} ha bisogno di una persona` });
  ok("aviso de handoff en la pipeline (sin servicios externos)", await until(() => toast.isVisible(), 30000));
  await page.screenshot({ path: `${SHOTS}/toast.png` });
  await toast.getByRole("link", { name: "Apri conversazione" }).click();
  ok(
    "el enlace del aviso abre esa conversación en la posta",
    await until(
      async () =>
        page.url().includes("/inbox?conversation=") &&
        // El 2.º <header> de la posta es el del hilo abierto (el 1.º, la lista).
        (await page.locator("main header").nth(1).innerText()).includes(HUMAN_NAME),
      60000
    )
  );
  await page.close();
}

/* --------------------------------- E10 -------------------------------- */
console.log("\n== E10: interruptor del agente ==");
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/agent`);
  const sw = page.getByRole("switch", { name: "Agente attivo" });
  await sw.waitFor();
  const antes = await sw.getAttribute("aria-checked");
  const knob = await page.evaluate(() => {
    const k = document.querySelector('[role="switch"] [data-knob]');
    const r = k.getBoundingClientRect();
    return { w: r.width, bg: getComputedStyle(k).backgroundColor, track: getComputedStyle(k.parentElement).backgroundColor };
  });
  ok("la manopola existe y se ve", knob.w >= 12 && knob.bg !== knob.track, JSON.stringify(knob));
  await sw.click();
  ok("clic → aria-checked cambia", await until(async () => (await sw.getAttribute("aria-checked")) !== antes, 15000));
  await page.screenshot({ path: `${SHOTS}/agent-switch.png` });
  await sw.click();
  await until(async () => (await sw.getAttribute("aria-checked")) === antes, 15000);
  await page.close();
}

await req.put(`${BASE}/api/agent/profile`, { data: { enabled: false, errorReply: "" } });
await browser.close();
console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures > 0 ? 1 : 0);
