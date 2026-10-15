/**
 * Self-test E2E nel BROWSER — 013 «Collegamento WhatsApp guidato»
 * (specs/custom-heili/013-collegamento-whatsapp-guidato.md).
 *
 * Con l'app viva e i mock accesi (WA_MOCK_ENABLED=true, META_APP_SECRET
 * sintetico, SUPERADMIN_EMAILS = operatore E2E, SENZA META_APP_ID /
 * META_ES_CONFIG_ID nell'ambiente):
 *  - /admin → Piattaforma → Meta: validazione nel modulo, salvataggio, fonte;
 *  - Configurazione → WhatsApp in un'azienda NUOVA, stato per stato:
 *    non configurata → pronta → collegata (coexistence, ultimo messaggio
 *    in diretta via SSE) → da ricollegare → coexistence tagliata;
 *  - «Avanzate» chiusa per default, con WABA/token/webhook/Wapi dentro;
 *  - nessun overflow orizzontale a 390 px.
 * Salva le schermate in SHOTS (default docs/lavoro/img/013).
 *
 * Lo stato «da ricollegare» si ottiene solo con un token che Meta rifiuta in
 * un invio: qui si scrive direttamente nel DB di prova (DATABASE_URL) e si
 * riallinea `channel_account` con `channels_legacy_sync_accounts` (V2 = 0).
 *
 * Uso: node --env-file=<env> scripts/e2e-whatsapp-guidato.mjs
 *      (PW_CHROMIUM=<ruta> si el Chromium instalado no es el de Playwright)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "docs/lavoro/img/013";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
const WABA = `77013${Date.now().toString().slice(-8)}`;
const PN = `${WABA}-phone`; // il wa-mock deduce il numero dalla WABA
const APP_ID = "609974691965875";
const CONFIG_ID = "998877665544";

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* riprova */
    }
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
};

if (process.env.META_APP_ID || process.env.META_ES_CONFIG_ID) {
  console.error("Questo guion esige META_APP_ID / META_ES_CONFIG_ID ASSENTI (lo stato «non configurata»).");
  process.exit(1);
}
if (!process.env.META_APP_SECRET) {
  console.error("Serve META_APP_SECRET (sintetico): senza, il pulsante non compare mai.");
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

// PW_CHROMIUM: ruta de un Chromium ya instalado si no coincide con la versión de Playwright.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "it-IT" });
const req = ctx.request;
const H = { origin: BASE };

console.log("== Setup: login del super-admin + azienda nuova ==");
let r = await req.post(`${BASE}/api/auth/sign-in/email`, {
  headers: H,
  data: { email: "e2e@vocero.test", password: "password-e2e-123" },
});
if (!r.ok()) {
  r = await req.post(`${BASE}/api/auth/sign-up/email`, {
    headers: H,
    data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
  });
}
ok("login dell'operatore", r.ok());
const org = await req.post(`${BASE}/api/admin/orgs`, { headers: H, data: { name: `Guida 013 ${S}` } });
ok("azienda nuova creata (super-admin)", org.status() === 201, await org.text());
const orgId = (await org.json()).org?.id;
const act = await req.post(`${BASE}/api/auth/organization/set-active`, { headers: H, data: { organizationId: orgId } });
ok("azienda nuova attiva", act.ok());
// Lingua e tema per dispositivo (cookie): italiano, chiaro.
const host = new URL(BASE).hostname;
await ctx.addCookies([
  { name: "heili-locale", value: "it", domain: host, path: "/" },
  { name: "vocero-theme", value: "light", domain: host, path: "/" },
]);
const setTheme = (value) => ctx.addCookies([{ name: "vocero-theme", value, domain: host, path: "/" }]);

// Partenza pulita: niente ID salvati.
await req.put(`${BASE}/api/admin/platform/meta`, { headers: H, data: { appId: null, configId: null } });

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function shot(name, p = page) {
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function noHorizontalOverflow(p = page) {
  return p.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return main.scrollWidth <= main.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
  });
}
const guideState = () => page.locator("[data-guide-state]").getAttribute("data-guide-state");

/* ------------------------------ /admin ------------------------------ */
console.log("\n== /admin → Piattaforma → Meta ==");
await page.goto(`${BASE}/admin`);
await page.getByRole("heading", { name: "Piattaforma" }).waitFor();
// La scheda carica il suo stato dal client: si aspetta il contenuto.
ok("la scheda Meta è visibile", await until(() => page.getByText("Meta (Embedded Signup)").first().isVisible()));
ok("stato iniziale: da completare", await page.getByText("Da completare").first().isVisible());
ok(
  "dell'App Secret solo la presenza",
  await page.getByText("Presente nella configurazione del server (META_APP_SECRET).").isVisible()
);
const html0 = await page.content();
ok("il segreto non è nella pagina", !html0.includes(process.env.META_APP_SECRET));
ok("checklist con featureType e i 6 campi", html0.includes("whatsapp_business_app_onboarding") && html0.includes("smb_app_state_sync"));

await page.fill("#meta-app-id", "12345");
ok("5 cifre → messaggio di errore e Salva disabilitato",
  (await page.getByText("Solo cifre, da 6 a 25.").first().isVisible()) &&
    (await page.getByRole("button", { name: "Salva", exact: true }).isDisabled()));
await page.fill("#meta-app-id", APP_ID);
await page.fill("#meta-config-id", CONFIG_ID);
await shot("admin-meta-compilata");
await page.getByRole("button", { name: "Salva", exact: true }).click();
ok("salvato (annunciato in role=status)", await until(() => page.getByRole("status").getByText("Salvato ✓").isVisible()));
ok("la fonte descrive il campo (aria-describedby), fuori dalla label",
  ((await page.locator("#meta-app-id").getAttribute("aria-describedby")) ?? "").includes("meta-app-id-source") &&
    (await page.locator('label[for="meta-app-id"] [data-testid="meta-app-id-source"]').count()) === 0);
ok("fonte «salvato qui» per entrambi", (await page.locator('[data-testid="meta-app-id-source"]').innerText()) === "salvato qui" &&
  (await page.locator('[data-testid="meta-config-id-source"]').innerText()) === "salvato qui");
ok("badge Pronto", await page.getByText("Pronto", { exact: true }).isVisible());
await shot("admin-meta-chiaro");
await setTheme("dark");
await page.reload();
await page.getByText("Pronto", { exact: true }).waitFor();
await shot("admin-meta-scuro");
await setTheme("light");
const phone = await ctx.newPage();
// Alto: el contenido vive en un contenedor con scroll propio y fullPage no lo ve.
await phone.setViewportSize({ width: 390, height: 1900 });
await phone.goto(`${BASE}/admin`);
await phone.getByText("Pronto", { exact: true }).waitFor();
ok("/admin a 390 px senza scorrimento orizzontale", await noHorizontalOverflow(phone));
await shot("admin-meta-390", phone);

/* ---------------------- Configurazione → WhatsApp ---------------------- */
console.log("\n== Configurazione → WhatsApp, stato per stato ==");
await req.put(`${BASE}/api/admin/platform/meta`, { headers: H, data: { appId: null, configId: null } });
await page.goto(`${BASE}/settings/whatsapp`);
ok("1) non configurata", await until(async () => (await guideState()) === "not_configured"));
ok("   messaggio per l'amministratore",
  await page.getByText("Il tuo amministratore deve completare la configurazione Meta.").first().isVisible());
ok("   nessun pulsante «Collega con Meta»", (await page.getByRole("button", { name: "Collega con Meta" }).count()) === 0);
ok("   firma «—» finché non c'è un numero", (await page.locator('[data-testid="guide-signature"]').innerText()) === "—");
const details = page.locator("details#avanzate");
ok("   «Avanzate» chiusa per default", (await details.getAttribute("open")) === null);
ok("   i campi tecnici non si vedono", !(await page.locator("#waba-id").isVisible()));
await shot("guida-1-non-configurata");
await page.getByRole("button", { name: "Hai già un token? Apri Avanzate." }).click();
ok("   il link apre «Avanzate» con WABA e token", await until(() => page.locator("#waba-id").isVisible()));
ok("   …e il webhook (owner)", await page.getByText("URL del webhook (callback URL)").isVisible());
ok("   …e la chiave Wapi", await page.getByText("Chiave Wapi di questa organizzazione").isVisible());

await req.put(`${BASE}/api/admin/platform/meta`, { headers: H, data: { appId: APP_ID, configId: CONFIG_ID } });
await page.goto(`${BASE}/settings/whatsapp`);
ok("2) pronta", await until(async () => (await guideState()) === "ready"));
ok("   il grande pulsante «Collega con Meta»", await until(() => page.getByRole("button", { name: "Collega con Meta" }).isVisible()));
ok("   la frase sull'app che resta sul telefono", await page.getByText("l'app WhatsApp Business resta sul telefono", { exact: false }).isVisible());
await shot("guida-2-pronta");

// Collegamento come lo farebbe il popup di Meta: canje del code nel server (wa-mock).
const es = await req.post(`${BASE}/api/settings/whatsapp/embedded-signup`, {
  headers: H,
  data: { code: `e2e-013-${S}`, wabaId: WABA, phoneNumberId: null, coexistence: true },
});
ok("Embedded Signup (wa-mock) → collegata in coexistence", es.ok(), await es.text());
await page.goto(`${BASE}/settings/whatsapp`);
ok("3) collegata", await until(async () => (await guideState()) === "connected"));
ok("   striscia: modalità App + CRM", await page.getByText("App + CRM (coexistence)").isVisible());
ok("   passo 3 in attesa del primo messaggio", await page.getByText("In attesa del primo messaggio…").isVisible());
// In diretta: un messaggio dall'«altro telefono» aggiorna la pagina senza ricaricare (SSE).
const inbound = await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  headers: H,
  data: { phoneNumberId: PN, from: "393331234013", name: "Altro telefono", text: "ciao, prova!", waMessageId: `wamid.e2e.013.ui.${S}` },
});
ok("   messaggio di prova consegnato al webhook", inbound.ok(), await inbound.text());
ok(
  "   «Ultimo messaggio ricevuto» compare in diretta, senza ricaricare",
  await until(() => page.locator('[data-testid="guide-last-inbound"]').getByText("Ultimo messaggio ricevuto").isVisible(), 15000)
);
ok("   i 3 passi fatti", (await page.locator('[data-step-status="done"]').count()) === 3);
ok("   annuncio per i lettori di schermo all'arrivo", (await page.locator('[data-testid="guide-announcement"]').innerText()).includes("Nuovo messaggio ricevuto"));
await shot("guida-3-collegata");
ok("   in Avanzate: «Collega un altro numero con Meta»", (await page.locator('[data-testid="another-number"]').count()) === 1);
await setTheme("dark");
await page.reload();
await until(async () => (await guideState()) === "connected");
await shot("guida-3-collegata-scuro");
await setTheme("light");
await phone.goto(`${BASE}/settings/whatsapp`);
await until(async () => (await phone.locator("[data-guide-state]").getAttribute("data-guide-state")) === "connected");
ok("   a 390 px senza scorrimento orizzontale", await noHorizontalOverflow(phone));
await shot("guida-3-collegata-390", phone);

// 4) Token rifiutato da Meta (vedi intestazione): stato scritto nel DB di prova.
const [mc] = await sql`select id from meta_credentials where organization_id = ${orgId}`;
await sql`update meta_credentials set status = 'reconnect_required', updated_at = now() where id = ${mc.id}`;
await sql`select channels_legacy_sync_accounts(array[${mc.id}]::text[])`;
await page.goto(`${BASE}/settings/whatsapp`);
ok("4) da ricollegare", await until(async () => (await guideState()) === "reconnect_required"));
ok("   allerta rossa con «Ricollega con Meta»", await until(() => page.getByRole("button", { name: "Ricollega con Meta" }).isVisible()));
ok("   alternativa manuale in Avanzate", await page.getByRole("button", { name: "Oppure incolla un token nuovo in Avanzate." }).isVisible());
await shot("guida-4-da-ricollegare");
await sql`update meta_credentials set status = 'connected', updated_at = now() where id = ${mc.id}`;
await sql`select channels_legacy_sync_accounts(array[${mc.id}]::text[])`;

// 5) Coexistence tagliata da Meta (account_update), poi ripristinata.
const coex = (event) =>
  req.post(`${BASE}/api/dev/wa-mock/coexistence`, { headers: H, data: { field: "account_update", phoneNumberId: PN, value: { event } } });
ok("   ACCOUNT_OFFBOARDED consegnato", (await coex("ACCOUNT_OFFBOARDED")).ok());
await page.goto(`${BASE}/settings/whatsapp`);
ok("5) coexistence tagliata", await until(async () => (await guideState()) === "app_disconnected"));
ok("   «Meta ha scollegato il numero dal CRM» + Ricollega",
  (await page.getByText("Meta ha scollegato il numero dal CRM.").isVisible()) &&
    (await page.getByRole("button", { name: "Ricollega con Meta" }).isVisible()));
await shot("guida-5-coexistence-tagliata");
await coex("ACCOUNT_RECONNECTED");
await page.goto(`${BASE}/settings/whatsapp`);
ok("   ACCOUNT_RECONNECTED → di nuovo collegata", await until(async () => (await guideState()) === "connected"));

ok("nessun errore JavaScript nelle pagine", errors.length === 0, errors.join(" | "));

// Pulizia: l'istanza di prova torna senza ID salvati (le altre corse partono uguali).
await req.put(`${BASE}/api/admin/platform/meta`, { headers: H, data: { appId: null, configId: null } });
await browser.close();
await sql.end();
console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
process.exit(failures > 0 ? 1 : 0);
