/**
 * Self-test E2E de comportamiento — custom heili.cloud (specs/custom-heili):
 *
 *   Fase 1: panel admin multi-empresa (super-admin, provisioning, aislamiento)
 *   Fase 2: tags en contactos + API de extracción (X-API-Key, json/csv)
 *   Fase 3: automatizaciones WhatsApp (regla tag→plantilla, cadencia, ventana)
 *
 * Uso: node --env-file=.env scripts/e2e-custom-heili.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, EXPORT_API_KEY (≥16) y
 * SUPERADMIN_EMAILS incluyendo e2e@vocero.test.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const EXPORT_KEY = process.env.EXPORT_API_KEY ?? "";

let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Cliente con su propio tarro de cookies (una sesión por cliente). */
function client() {
  let cookie = "";
  return async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) {
      cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    }
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);
const WABA = "WABA-CHEILI";
const PN = "PN-CHEILI-1";

async function loginOrRegister(api, email, password, name) {
  let r = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  if (!r.res.ok) {
    r = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  return r;
}

async function main() {
  if (!EXPORT_KEY || EXPORT_KEY.length < 16) {
    console.error("EXPORT_API_KEY ausente o corta (<16): no puede correr el test.");
    process.exit(1);
  }

  const admin = client();
  const email = "e2e@vocero.test";
  const su = await loginOrRegister(admin, email, "password-e2e-123", "Operador E2E");
  ok("login del super-admin (e2e@vocero.test)", su.res.ok, JSON.stringify(su.json));

  console.log("\n== Fase 1: panel admin multi-empresa ==");
  const orgsBefore = await admin("/api/admin/orgs");
  ok("GET /api/admin/orgs → 200", orgsBefore.res.ok, JSON.stringify(orgsBefore.json));
  const myOrgId = (await admin("/api/my-orgs")).json?.activeOrgId;
  ok("mi org activa está en el panel", (orgsBefore.json?.orgs ?? []).some((o) => o.id === myOrgId));

  const ownerEmail = `dueno-${stamp}@cliente.test`;
  const created = await admin("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({
      name: `Cliente E2E ${stamp}`,
      owner: { name: "Dueño Cliente", email: ownerEmail, password: "password-cliente-123" },
    }),
  });
  ok("crear org + cuenta del cliente → 201", created.res.status === 201, JSON.stringify(created.json));
  const newOrg = created.json?.org;

  const orgsAfter = await admin("/api/admin/orgs");
  const newOrgRow = (orgsAfter.json?.orgs ?? []).find((o) => o.id === newOrg?.id);
  ok("la org nueva aparece con 2 miembros", newOrgRow?.memberCount === 2, JSON.stringify(newOrgRow));

  const dup = await admin("/api/admin/orgs", {
    method: "POST",
    body: JSON.stringify({
      name: "Otra org",
      owner: { name: "X", email: ownerEmail, password: "password-cliente-123" },
    }),
  });
  ok("correo duplicado → 409 sin dejar org a medias", dup.res.status === 409, `status=${dup.res.status}`);

  const myOrgs = await admin("/api/my-orgs");
  ok("el super-admin ve sus 2 orgs en el switcher", (myOrgs.json?.orgs ?? []).length >= 2);

  console.log("\n== Fase 1: el cliente NO es super-admin ==");
  const customer = client();
  const clogin = await loginOrRegister(customer, ownerEmail, "password-cliente-123", "Dueño Cliente");
  ok("login del cliente", clogin.res.ok, JSON.stringify(clogin.json));
  const forbidden = await customer("/api/admin/orgs");
  ok("GET /api/admin/orgs del cliente → 403", forbidden.res.status === 403, `status=${forbidden.res.status}`);
  const custOrgs = await customer("/api/my-orgs");
  ok("el cliente solo ve SU org", (custOrgs.json?.orgs ?? []).length === 1, JSON.stringify(custOrgs.json));

  console.log("\n== Fase 1: cambio de org activa + aislamiento ==");
  const switchRes = await admin("/api/auth/organization/set-active", {
    method: "POST",
    body: JSON.stringify({ organizationId: newOrg.id }),
  });
  ok("set-active a la org del cliente", switchRes.res.ok, JSON.stringify(switchRes.json));
  const activeNow = (await admin("/api/my-orgs")).json?.activeOrgId;
  ok("la org activa cambió", activeNow === newOrg.id, `active=${activeNow}`);

  const tagInOrg2 = await admin("/api/tags", {
    method: "POST",
    body: JSON.stringify({ name: `solo-org2-${stamp}` }),
  });
  ok("tag creado en la org del cliente", tagInOrg2.res.status === 201, JSON.stringify(tagInOrg2.json));
  const tagsOrg2 = (await admin("/api/tags")).json?.tags ?? [];
  ok("visible en la org activa", tagsOrg2.some((t) => t.name === `solo-org2-${stamp}`));

  await admin("/api/auth/organization/set-active", {
    method: "POST",
    body: JSON.stringify({ organizationId: myOrgId }),
  });
  const tagsOrg1 = (await admin("/api/tags")).json?.tags ?? [];
  ok(
    "el tag de la otra org NO se ve al volver (aislamiento)",
    !tagsOrg1.some((t) => t.name === `solo-org2-${stamp}`)
  );
  ok("de vuelta en mi org", (await admin("/api/my-orgs")).json?.activeOrgId === myOrgId);

  console.log("\n== Fase 2: tags en contactos ==");
  const vip = await admin("/api/tags", {
    method: "POST",
    body: JSON.stringify({ name: `vip-${stamp}`, color: "#25D366" }),
  });
  ok("crear tag → 201", vip.res.status === 201, JSON.stringify(vip.json));
  const tagId = vip.json?.tag?.id;

  const again = await admin("/api/tags", {
    method: "POST",
    body: JSON.stringify({ name: `vip-${stamp}` }),
  });
  ok("nombre repetido devuelve el existente (200, mismo id)", again.res.status === 200 && again.json?.tag?.id === tagId);

  const phone = `5255${String(Date.now()).slice(-8)}`;
  const contact = await admin("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: `Cliente Export ${stamp}`, phone }),
  });
  ok("contacto creado → 201", contact.res.status === 201, JSON.stringify(contact.json));
  const contactId = contact.json?.contact?.id;

  const put = await admin(`/api/contacts/${contactId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds: [tagId] }),
  });
  ok("asignar tag al contacto", put.res.ok && (put.json?.tags ?? []).length === 1, JSON.stringify(put.json));

  const badPut = await admin(`/api/contacts/${contactId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds: ["tag_inexistente"] }),
  });
  ok("tag de otra org/inexistente → 422", badPut.res.status === 422, `status=${badPut.res.status}`);

  const byTag = (await admin(`/api/contacts?tag=${tagId}`)).json?.contacts ?? [];
  ok("filtro ?tag= encuentra al contacto", byTag.some((c) => c.id === contactId));
  const all = (await admin("/api/contacts")).json?.contacts ?? [];
  ok("la lista incluye los tags del contacto", all.find((c) => c.id === contactId)?.tags?.[0]?.id === tagId);

  console.log("\n== Fase 2: API de extracción ==");
  const noKey = await fetch(`${BASE}/api/export/contacts?org=${myOrgId}`);
  ok("sin X-API-Key → 401", noKey.status === 401);
  const badKey = await fetch(`${BASE}/api/export/contacts?org=${myOrgId}`, {
    headers: { "x-api-key": "x".repeat(EXPORT_KEY.length) },
  });
  ok("key equivocada → 401", badKey.status === 401);
  const noOrg = await admin("/api/export/contacts", { headers: { "x-api-key": EXPORT_KEY } });
  ok("sin ?org= → 422 org_required", noOrg.res.status === 422 && noOrg.json?.error?.code === "org_required", JSON.stringify(noOrg.json));

  const exp = await admin(`/api/export/contacts?org=${myOrgId}`, { headers: { "x-api-key": EXPORT_KEY } });
  const expRow = (exp.json?.contacts ?? []).find((c) => c.id === contactId);
  ok("extracción JSON trae al contacto con su tag", exp.res.ok && expRow?.tags?.includes(`vip-${stamp}`), JSON.stringify(expRow));

  const expCsv = await fetch(`${BASE}/api/export/contacts?org=${myOrgId}&format=csv`, {
    headers: { "x-api-key": EXPORT_KEY },
  });
  const csvText = await expCsv.text();
  ok(
    "extracción CSV (content-type + fila del contacto)",
    (expCsv.headers.get("content-type") ?? "").includes("csv") && csvText.includes(`Cliente Export ${stamp}`),
    expCsv.headers.get("content-type")
  );

  const expOther = await admin(`/api/export/contacts?org=${newOrg.id}`, { headers: { "x-api-key": EXPORT_KEY } });
  ok(
    "la extracción de la otra org NO trae mi contacto (aislamiento)",
    expOther.res.ok && !(expOther.json?.contacts ?? []).some((c) => c.id === contactId)
  );

  console.log("\n== Fase 3: automatizaciones ==");
  const conn = await admin("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: "tok-cheili" }),
  });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, JSON.stringify(conn.json));

  const tplName = `seguimiento_${stamp}`;
  const tpl = await admin("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name: tplName,
      language: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}}, ¿retomamos el contacto?",
    }),
  });
  ok("plantilla de 1 variable creada", tpl.res.ok, JSON.stringify(tpl.json));
  await admin("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA, name: tplName, language: "es_MX", event: "APPROVED", category: "UTILITY", notify: false }),
  });
  await admin("/api/templates/sync", { method: "POST" });
  const templates = (await admin("/api/templates")).json?.templates ?? [];
  const approved = templates.find((t) => t.name === tplName);
  ok("plantilla aprobada (pull, modo agencia)", approved?.status === "approved", approved?.status);

  const tpl2Name = `dosvars_${stamp}`;
  await admin("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name: tpl2Name, language: "es_MX", category: "UTILITY", body: "Hola {{1}}, tu pedido {{2}} salió" }),
  });
  await admin("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA, name: tpl2Name, language: "es_MX", event: "APPROVED", category: "UTILITY", notify: false }),
  });
  await admin("/api/templates/sync", { method: "POST" });
  const approved2 = templates.length ? (await admin("/api/templates")).json?.templates?.find((t) => t.name === tpl2Name) : null;

  const multiVar = await admin("/api/automations", {
    method: "POST",
    body: JSON.stringify({ name: "Regla multivar", tagId, templateId: approved2?.id, intervalDays: 7 }),
  });
  ok("plantilla con 2 variables → 422 template_multi_variable", multiVar.res.status === 422 && multiVar.json?.error?.code === "template_multi_variable", JSON.stringify(multiVar.json));

  const rule = await admin("/api/automations", {
    method: "POST",
    body: JSON.stringify({ name: `Re-engagement VIP ${stamp}`, tagId, templateId: approved?.id, intervalDays: 7 }),
  });
  ok("regla creada → 201", rule.res.status === 201, JSON.stringify(rule.json));
  const ruleId = rule.json?.rule?.id;

  await admin("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const run1 = await admin("/api/automations/run", { method: "POST" });
  ok("ejecutar ahora: 1 enviado", run1.json?.stats?.sent === 1, JSON.stringify(run1.json?.stats));

  await sleep(600);
  const outbox = (await admin("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const tplSend = outbox.find((o) => o.type === "template");
  ok("la plantilla salió por el canal (outbox)", !!tplSend, JSON.stringify(outbox.map((o) => o.type)));
  ok("al teléfono del contacto", (tplSend?.to ?? "").includes(phone.slice(-8)), tplSend?.to);

  const runs = await admin(`/api/automations/${ruleId}/runs`);
  ok("bitácora: 1 corrida sent", (runs.json?.runs ?? []).filter((r) => r.status === "sent").length === 1, JSON.stringify(runs.json));

  const run2 = await admin("/api/automations/run", { method: "POST" });
  ok(
    "re-ejecutar no repite (cadencia de 7 días)",
    run2.json?.stats?.sent === 0 && run2.json?.stats?.skippedCooldown >= 1,
    JSON.stringify(run2.json?.stats)
  );

  const rules = await admin("/api/automations");
  ok("GET /api/automations lista la regla con nombres", (rules.json?.rules ?? []).some((r) => r.id === ruleId && r.tagName === `vip-${stamp}` && r.templateName === tplName));

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Fallo no controlado:", err);
  process.exit(1);
});
