/**
 * Self-test E2E de comportamiento — conduce la app real en localhost con los
 * mocks (wa-mock + ai-mock) por las superficies de usuario, en vez de darle
 * el guion al humano. Cubre tests/e2e/us-bsuid.md y tests/e2e/us-bot-api.md.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      BOT_API_KEY configurada y BD migrada
 *   2) node --env-file=.env scripts/e2e-selftest.mjs
 *
 * Sale con código 1 si algún check falla (apto para CI o para el gate previo
 * a declarar "Hecho").
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
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
}

function bot(path, opts = {}) {
  return api(path, {
    ...opts,
    headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PN = "PN-E2E-1";

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error(
      "BOT_API_KEY ausente o corta (<16): los checks de /api/bot/* no pueden correr."
    );
    process.exit(1);
  }

  console.log("== Setup: registro/login + conexión WhatsApp ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Re-corrida: el registro se cierra tras la primera organización.
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión WhatsApp guardada (vía wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json)
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  console.log("\n== us-bsuid: inbound sin wa_id ==");
  const inb1 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  ok("inbound BSUID entregado", inb1.res.ok, JSON.stringify(inb1.json));
  await sleep(1200);

  let convs = (await api("/api/conversations")).json?.conversations ?? [];
  const bsuidConv = convs.find((c) => c.contact.name === "Dueña Dental");
  ok("conversación con nombre de perfil (no el BSUID crudo)", !!bsuidConv);
  ok("contacto BSUID sin teléfono", bsuidConv?.contact.phone === null);

  const reply = await api(`/api/conversations/${bsuidConv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "¡Hola! Te atendemos enseguida" }),
  });
  ok("respuesta a contacto BSUID enviable", reply.res.ok, JSON.stringify(reply.json));

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el destinatario del envío es el BSUID",
    outbox.some((o) => o.to === "bsu_e2e_1"),
    JSON.stringify(outbox.map((o) => o.to))
  );

  // Idempotencia: re-entrega del mismo wa_message_id
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  await sleep(800);
  const msgs =
    (await api(`/api/conversations/${bsuidConv?.id}/messages`)).json?.messages ??
    [];
  const inCount = msgs.filter((m) => m.direction === "in").length;
  ok("webhook duplicado no duplica mensajes", inCount === 1, `in=${inCount}`);

  console.log("\n== us-bsuid: reconciliación 521/52 ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5214621349768",
      name: "Kevin MX",
      text: "uno",
    }),
  });
  await sleep(800);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: "524621349768", text: "dos" }),
  });
  await sleep(800);
  const contacts =
    (await api("/api/contacts?q=Kevin%20MX")).json?.contacts ?? [];
  ok(
    "521 y 52 resuelven a UN solo contacto",
    contacts.length === 1,
    `n=${contacts.length}`
  );

  const mxConv = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Kevin MX"
  );
  ok("el contacto reconciliado conserva su conversación", !!mxConv);

  console.log("\n== us-bot-api: autorización ==");
  const noKey = await api("/api/bot/media/media123");
  ok("media sin API key → 401", noKey.res.status === 401);
  const badKey = await api("/api/bot/media/media123", {
    headers: { "x-api-key": "x".repeat(BOT_KEY.length) },
  });
  ok("media con API key equivocada → 401", badKey.res.status === 401);
  const resetNoKey = await api("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: mxConv?.id }),
  });
  ok("reset sin API key → 401", resetNoKey.res.status === 401);

  console.log("\n== us-bot-api: typing + leído ==");
  const convId = mxConv?.id;
  const outboxBeforeTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const typ = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/typing → ok:true (leído + escribiendo…)",
    typ.res.ok && typ.json?.ok === true,
    JSON.stringify(typ.json)
  );
  const outboxAfterTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "typing NO contamina el outbox",
    outboxAfterTyping === outboxBeforeTyping,
    `antes=${outboxBeforeTyping} después=${outboxAfterTyping}`
  );

  const typ404 = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe" }),
  });
  ok("typing con conversación inexistente → 404", typ404.res.status === 404);

  console.log("\n== us-bot-api: media proxy ==");
  const med = await bot("/api/bot/media/media123");
  const medBytes = med.res.ok ? await med.res.arrayBuffer() : new ArrayBuffer(0);
  ok(
    "GET /api/bot/media/{id} → binario con content-type",
    med.res.ok &&
      medBytes.byteLength > 0 &&
      (med.res.headers.get("content-type") ?? "").includes("image"),
    `status=${med.res.status} bytes=${medBytes.byteLength}`
  );
  const medBad = await bot("/api/bot/media/no-es-media");
  ok(
    "mediaId que Graph no reconoce → error tipado, no 500",
    medBad.res.status === 404 || medBad.res.status === 502,
    `status=${medBad.res.status}`
  );

  console.log("\n== us-bot-api: perfil del agente + knowledge base ==");
  const profNoKey = await api("/api/bot/profile");
  ok("perfil sin API key → 401", profNoKey.res.status === 401);

  const putProf = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({
      name: "Sofi",
      tone: "cálido y directo",
      instructions: "Vendemos limpiezas dentales.",
      escalationRules: "Urgencias de dolor → humano.",
      greeting: "¡Hola! Soy Sofi",
      enabled: false,
    }),
  });
  ok("perfil guardado desde la pantalla Agente", putProf.res.ok);
  const kbQa = await api("/api/kb", {
    method: "POST",
    body: JSON.stringify({
      kind: "qa",
      question: "¿Cuánto cuesta?",
      answer: "$800.",
    }),
  });
  ok("entrada de KB creada desde la pantalla", kbQa.res.ok, JSON.stringify(kbQa.json));

  const prof = await bot("/api/bot/profile");
  ok(
    "GET /api/bot/profile → 200 con el perfil de la pantalla",
    prof.res.ok && prof.json?.profile?.name === "Sofi",
    JSON.stringify(prof.json?.profile)
  );
  ok(
    "el knowledge base viaja renderizado (P:/R:)",
    typeof prof.json?.kb === "string" && prof.json.kb.includes("P: ¿Cuánto cuesta?"),
    JSON.stringify(prof.json?.kb)
  );
  ok(
    "`enabled` NO viaja: gobierna la IA in-process, no al bot externo",
    prof.json?.profile && !("enabled" in prof.json.profile)
  );
  ok("`resources` presente y vacío", Array.isArray(prof.json?.resources));

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ tone: "seco y breve" }),
  });
  const profAgain = await bot("/api/bot/profile");
  ok(
    "editar el tono se refleja al instante (sin caché)",
    profAgain.json?.profile?.tone === "seco y breve",
    JSON.stringify(profAgain.json?.profile?.tone)
  );

  console.log("\n== us-bot-api: contexto conversacional ==");
  const ctxNoKey = await api(`/api/bot/context?conversationId=${convId}`);
  ok("contexto sin API key → 401", ctxNoKey.res.status === 401);

  const ctx = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "GET /api/bot/context por conversationId → 200",
    ctx.res.ok && ctx.json?.conversation?.id === convId,
    JSON.stringify(ctx.json?.conversation)
  );
  ok(
    "trae la identidad estable del contacto (no solo el teléfono)",
    typeof ctx.json?.contact?.waIdentity === "string" &&
      ctx.json.contact.waIdentity.length > 0
  );
  ok(
    "trae la etapa del lead en el pipeline",
    typeof ctx.json?.lead?.stageName === "string",
    JSON.stringify(ctx.json?.lead)
  );
  ok(
    "la ventana de 24 h viaja abierta tras un entrante reciente",
    ctx.json?.conversation?.windowOpen === true &&
      ctx.json?.conversation?.windowRemainingMs > 0,
    JSON.stringify(ctx.json?.conversation)
  );

  const ctxByIdentity = await bot(
    `/api/bot/context?waIdentity=${encodeURIComponent(ctx.json.contact.waIdentity)}`
  );
  ok(
    "resolver por waIdentity da la MISMA conversación",
    ctxByIdentity.json?.conversation?.id === convId,
    JSON.stringify(ctxByIdentity.json?.conversation?.id)
  );

  const ctxSinArgs = await bot("/api/bot/context");
  ok("contexto sin waIdentity ni conversationId → 422", ctxSinArgs.res.status === 422);
  const ctx404 = await bot("/api/bot/context?conversationId=cv_no_existe");
  ok("contexto de una conversación inexistente → 404", ctx404.res.status === 404);

  console.log("\n== us-bot-api: ficha de calificación ==");
  const fichaNoKey = await api("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId, ficha: { rubro: "x" } }),
  });
  ok("ficha sin API key → 401", fichaNoKey.res.status === 401);

  const f1 = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { rubro: "dentista", geo: "Querétaro", calificado: true },
    }),
  });
  ok(
    "PUT /api/bot/ficha → 200 con la ficha completa",
    f1.res.ok && f1.json?.ficha?.rubro === "dentista",
    JSON.stringify(f1.json)
  );
  ok(
    "las claves las pone el negocio: el CRM guarda lo que le manden",
    f1.json?.ficha?.geo === "Querétaro" && f1.json?.ficha?.calificado === true,
    JSON.stringify(f1.json?.ficha)
  );

  const ctxConFicha = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "la ficha viaja en el contexto del siguiente turno",
    ctxConFicha.json?.contact?.ficha?.rubro === "dentista",
    JSON.stringify(ctxConFicha.json?.contact?.ficha)
  );

  const f2 = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { presupuesto: "20 mil", geo: null },
    }),
  });
  ok(
    "merge campo a campo: lo ausente se conserva",
    f2.json?.ficha?.rubro === "dentista" && f2.json?.ficha?.presupuesto === "20 mil",
    JSON.stringify(f2.json?.ficha)
  );
  ok(
    "null explícito borra la clave",
    f2.json?.ficha && !("geo" in f2.json.ficha),
    JSON.stringify(f2.json?.ficha)
  );

  const fBasura = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { anidado: { a: 1 }, vacío: "", bueno: "  sí  " },
    }),
  });
  ok(
    "lo que no se entiende se ignora sin 422 (no se le tiran datos al bot)",
    fBasura.res.ok &&
      fBasura.json?.ficha?.bueno === "sí" &&
      !("anidado" in fBasura.json.ficha) &&
      !("vacío" in fBasura.json.ficha),
    JSON.stringify(fBasura.json?.ficha)
  );

  const fNoConv = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: "cv_no_existe", ficha: { a: "b" } }),
  });
  ok("ficha de conversación inexistente → 404", fNoConv.res.status === 404);
  const fSinFicha = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok("cuerpo sin `ficha` → 422", fSinFicha.res.status === 422);

  console.log("\n== us-bot-api: el bot envía a través del CRM ==");
  const sendNoKey = await api("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "hola" }),
  });
  ok("envío sin API key → 401", sendNoKey.res.status === 401);

  const outboxBeforeBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const botSend = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "Hola, soy el bot." }),
  });
  ok(
    "POST /api/bot/messages → 200 con messageId",
    botSend.res.ok && typeof botSend.json?.messageId === "string",
    JSON.stringify(botSend.json)
  );
  const outboxAfterBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "el mensaje salió de verdad por el canal de WhatsApp",
    outboxAfterBot === outboxBeforeBot + 1,
    `antes=${outboxBeforeBot} después=${outboxAfterBot}`
  );
  const botMsg = ((await api(`/api/conversations/${convId}/messages`)).json
    ?.messages ?? []).find((m) => m.id === botSend.json?.messageId);
  ok(
    "queda en la bandeja marcado como IA (aiGenerated + origin=ai)",
    botMsg?.aiGenerated === true && botMsg?.origin === "ai",
    JSON.stringify({ aiGenerated: botMsg?.aiGenerated, origin: botMsg?.origin })
  );
  const sendNoConv = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", text: "hola" }),
  });
  ok("envío a conversación inexistente → 404", sendNoConv.res.status === 404);
  const sendVacio = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "" }),
  });
  ok("texto vacío → 422 (no se manda un mensaje en blanco)", sendVacio.res.status === 422);

  console.log("\n== us-bot-api: el bot pide un humano ==");
  const hoNoKey = await api("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  ok("handoff sin API key → 401", hoNoKey.res.status === 401);

  const ho = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "hostilidad" }),
  });
  ok("POST /api/bot/handoff → 200", ho.res.ok && ho.json?.ok === true);
  await sleep(300);
  let convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "la conversación queda pausada y con su motivo",
    convTrasHandoff?.aiEnabled === false &&
      !!convTrasHandoff?.handoffAt &&
      convTrasHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      aiEnabled: convTrasHandoff?.aiEnabled,
      reason: convTrasHandoff?.handoffReason,
    })
  );
  const primerHandoffAt = convTrasHandoff?.handoffAt;

  const hoRepe = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "repetir el handoff es idempotente: no pisa la hora ni el motivo original",
    hoRepe.res.ok &&
      convTrasHandoff?.handoffAt === primerHandoffAt &&
      convTrasHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      antes: primerHandoffAt,
      ahora: convTrasHandoff?.handoffAt,
      reason: convTrasHandoff?.handoffReason,
    })
  );

  const hoNoConv = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", reason: "cliente" }),
  });
  ok("handoff de conversación inexistente → 404", hoNoConv.res.status === 404);

  // El handoff jamás debe perderse por un motivo que no esté en el catálogo:
  // el bot se quedaría hablándole a alguien que pidió un humano.
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoRaro = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "porque sí" }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "un motivo fuera del catálogo NO tira el handoff (cae a 'modelo')",
    hoRaro.res.ok &&
      convTrasHandoff?.aiEnabled === false &&
      convTrasHandoff?.handoffReason === "modelo",
    JSON.stringify({
      status: hoRaro.res.status,
      reason: convTrasHandoff?.handoffReason,
    })
  );

  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoSinReason = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  convTrasHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "sin motivo también pausa (cae a 'modelo')",
    hoSinReason.res.ok && convTrasHandoff?.handoffReason === "modelo",
    JSON.stringify(convTrasHandoff?.handoffReason)
  );
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);

  console.log("\n== us-bot-api: IA pausada y reset ==");
  const pause = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("IA pausada desde la bandeja", pause.res.ok, JSON.stringify(pause.json));

  const typPaused = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "typing con IA pausada → ok:false ai_paused (no toca Meta)",
    typPaused.res.ok &&
      typPaused.json?.ok === false &&
      typPaused.json?.reason === "ai_paused",
    JSON.stringify(typPaused.json)
  );

  const outboxBeforePaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const sendPaused = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "¿sigo yo?" }),
  });
  ok(
    "el bot NO habla sobre una conversación tomada por un humano → 409 ai_paused",
    sendPaused.res.status === 409 &&
      sendPaused.json?.error?.code === "ai_paused",
    JSON.stringify(sendPaused.json)
  );
  const outboxAfterPaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "y el rechazo ocurre ANTES de tocar Meta",
    outboxAfterPaused === outboxBeforePaused,
    `antes=${outboxBeforePaused} después=${outboxAfterPaused}`
  );

  const msgsBeforeReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  const rst = await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/reset → ok:true",
    rst.res.ok && rst.json?.ok === true,
    JSON.stringify(rst.json)
  );
  await sleep(400);
  convs = (await api("/api/conversations")).json?.conversations ?? [];
  const afterReset = convs.find((c) => c.id === convId);
  ok(
    "reset reactiva la IA (sale del handoff)",
    afterReset?.aiEnabled === true && !afterReset?.handoffAt,
    JSON.stringify({
      aiEnabled: afterReset?.aiEnabled,
      handoffAt: afterReset?.handoffAt,
    })
  );
  const msgsAfterReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  ok(
    "el reset conserva el historial (auditoría)",
    msgsAfterReset === msgsBeforeReset,
    `antes=${msgsBeforeReset} después=${msgsAfterReset}`
  );

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
  const detail = (await api(`/api/contacts/${afterReset?.contact.id}`)).json;
  ok(
    "reset regresa el lead a la primera etapa",
    !detail?.lead || detail?.stage?.id === firstStage?.id,
    `etapa=${detail?.stage?.name} esperada=${firstStage?.name}`
  );

  console.log("\n== 008: paridad inbox — echoes de coexistence (US1) ==");
  const LEAD = "5214627008001"; // canónica: 524627008001

  // Un inbound primero: la conversación existe y la ventana queda abierta.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 008",
      text: "hola, quiero informes",
      waMessageId: "wamid.e2e.008.in.1",
    }),
  });
  await sleep(1200);
  const findConv008 = async () =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008001"
    );
  let conv008 = await findConv008();
  ok("conversación del lead 008 creada", Boolean(conv008), "sin conversación");
  const inboundAtBefore = conv008?.lastInboundAt;

  // Echo: el dueño contesta A MANO desde la app del teléfono.
  const echo1 = await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  ok("echo entregado al webhook", echo1.res.ok, JSON.stringify(echo1.json));
  await sleep(900);

  const msgs1 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const manual1 = msgs1.find((m) => m.text === "te contesto yo, dame un minuto");
  ok(
    "el mensaje manual aparece como saliente origin=manual",
    manual1?.direction === "out" && manual1?.origin === "manual" && manual1?.status === "sent",
    JSON.stringify(manual1)
  );

  conv008 = await findConv008();
  ok(
    "la IA quedó pausada con handoff manual_reply",
    conv008?.aiEnabled === false && conv008?.handoffReason === "manual_reply",
    JSON.stringify({ aiEnabled: conv008?.aiEnabled, reason: conv008?.handoffReason })
  );
  ok(
    "el echo NO tocó la ventana de 24 h (lastInboundAt intacto)",
    conv008?.lastInboundAt === inboundAtBefore,
    `${inboundAtBefore} → ${conv008?.lastInboundAt}`
  );

  // Idempotencia: el mismo echo otra vez no duplica.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  await sleep(700);
  const msgs2 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo duplicado (mismo wamid) no duplica el mensaje",
    msgs2.filter((m) => m.text === "te contesto yo, dame un minuto").length === 1
  );

  // Variante defensiva: echoes bajo la clave `messages`.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "segundo mensaje manual",
      waMessageId: "wamid.e2e.008.echo.2",
      useMessagesKey: true,
    }),
  });
  await sleep(700);
  const msgs3 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo bajo la clave `messages` también se ingiere (parser tolerante)",
    msgs3.some((m) => m.text === "segundo mensaje manual" && m.origin === "manual")
  );

  // Echo hacia un número SIN conversación previa → la crea.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: "5214627008002",
      text: "hola, te escribo del anuncio",
      waMessageId: "wamid.e2e.008.echo.3",
    }),
  });
  await sleep(700);
  const convNew = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524627008002"
  );
  ok("echo a número nuevo crea contacto y conversación", Boolean(convNew));

  // Reactivación desde el CRM (flujo existente de handoff).
  const react = await api(`/api/conversations/${conv008.id}`, {
    method: "PATCH",
    body: JSON.stringify({ reactivate: true }),
  });
  conv008 = await findConv008();
  ok(
    "reactivar la IA desde el CRM limpia el handoff",
    react.res.ok && conv008?.aiEnabled === true && !conv008?.handoffReason
  );

  console.log("\n== 008: enviar adjuntos desde el composer (US2) ==");
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
  const mediaForm = new FormData();
  mediaForm.set(
    "file",
    new Blob([JPEG_BYTES], { type: "image/jpeg" }),
    "local.jpg"
  );
  mediaForm.set("caption", "mira nuestro local");
  const upRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: mediaForm,
  });
  const upJson = await upRes.json().catch(() => null);
  ok("imagen con caption enviada (201)", upRes.status === 201, JSON.stringify(upJson));

  const msgs4 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentImg = msgs4.find((m) => m.media?.caption === "mira nuestro local");
  ok(
    "el saliente con imagen trae asset disponible y origin=operator",
    sentImg?.type === "image" &&
      sentImg?.origin === "operator" &&
      sentImg?.media?.fetchStatus === "available",
    JSON.stringify(sentImg)
  );

  const imgBin = await fetch(`${BASE}/api/media/${sentImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok(
    "GET /api/media/{id} sirve el binario con su content-type",
    imgBin.ok && (imgBin.headers.get("content-type") ?? "").includes("image/jpeg")
  );

  const outbox008 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el envío llegó a Graph como type=image con media id subido",
    outbox008.some((o) => o.type === "image" && JSON.stringify(o.body).includes("media-up-"))
  );

  // Camino infeliz: archivo que excede el límite (imagen > 5 MB) → 413 previo.
  const bigForm = new FormData();
  bigForm.set(
    "file",
    new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }),
    "grande.png"
  );
  const bigRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: bigForm,
  });
  ok("imagen de 6 MB → 413 too_large ANTES de enviar", bigRes.status === 413);

  // Ubicación (payload estructurado, sin archivo).
  const locRes = await api(`/api/conversations/${conv008.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina Central" },
    }),
  });
  ok("ubicación enviada", locRes.res.ok, JSON.stringify(locRes.json));
  const msgs5 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentLoc = msgs5.find((m) => m.type === "location" && m.direction === "out");
  ok(
    "la ubicación viaja como payload (lat/long/name) sin binario",
    sentLoc?.media?.kind === "location" && sentLoc?.media?.payload?.latitude === 21.019,
    JSON.stringify(sentLoc?.media)
  );
  const outboxLoc = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió type=location",
    outboxLoc.some((o) => o.type === "location")
  );

  console.log("\n== 008: previews de adjuntos entrantes (US3) ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "media-e2e-img-1",
      caption: "foto de mi negocio",
      waMessageId: "wamid.e2e.008.in.img",
    }),
  });
  await sleep(1600); // ingesta + descarga in-process del binario
  const msgs6 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inImg = msgs6.find((m) => m.media?.caption === "foto de mi negocio");
  ok(
    "imagen entrante queda disponible tras la descarga in-process",
    inImg?.direction === "in" &&
      inImg?.media?.kind === "image" &&
      inImg?.media?.fetchStatus === "available",
    JSON.stringify(inImg?.media)
  );
  const inImgBin = await fetch(`${BASE}/api/media/${inImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok("el binario entrante se sirve desde el volumen local", inImgBin.ok);

  // Ubicación entrante: payload directo, sin binario (404 en /api/media).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "location",
      location: { latitude: 20.5, longitude: -100.8, name: "Mi taller" },
      waMessageId: "wamid.e2e.008.in.loc",
    }),
  });
  await sleep(900);
  const msgs7 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inLoc = msgs7.find((m) => m.type === "location" && m.direction === "in");
  ok(
    "ubicación entrante trae payload directo",
    inLoc?.media?.payload?.name === "Mi taller",
    JSON.stringify(inLoc?.media)
  );

  // Camino infeliz: media cuya descarga falla (metadata sin url) → failed,
  // el mensaje se conserva y /api/media responde 410.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "broken-no-url",
      waMessageId: "wamid.e2e.008.in.broken",
    }),
  });
  await sleep(1600);
  const msgs8 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const broken = msgs8.find((m) => m.id !== inImg?.id && m.media?.fetchStatus === "failed");
  ok(
    "descarga fallida degrada a failed sin perder el mensaje",
    Boolean(broken),
    JSON.stringify(msgs8.filter((m) => m.media).map((m) => m.media))
  );
  if (broken) {
    const goneRes = await fetch(`${BASE}/api/media/${broken.media.assetId}`, {
      headers: { cookie, origin: BASE },
    });
    ok("asset fallido → 410 gone en /api/media", goneRes.status === 410);
  }

  // Echo CON adjunto (AC-5 de US1): la foto que el dueño mandó desde el cel.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      type: "image",
      mediaId: "media-e2e-echo-img",
      caption: "así quedaría tu logo",
      waMessageId: "wamid.e2e.008.echo.img",
    }),
  });
  await sleep(1600);
  const msgs9 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const echoImg = msgs9.find((m) => m.media?.caption === "así quedaría tu logo");
  ok(
    "echo con imagen: manual + asset descargado y previsualizable",
    echoImg?.origin === "manual" && echoImg?.media?.fetchStatus === "available",
    JSON.stringify(echoImg?.media)
  );

  // C3: clave Wapi por organización (guardar, consultar, revocar). La clave
  // es FICTICIA y no sale a ningún servicio: el mock no hace de Wapi, así que
  // aquí se prueba el flujo de la API/BD y que la clave jamás vuelve en claro;
  // el enrutamiento real hacia Wapi lo cubren los tests unitarios.
  console.log("\n== c3-wapi: guardar y revocar la clave Wapi de la organización ==");
  const WAPI_FAKE = "hlp_live_E2EFICTICIA0123456789WXYZ";
  const wk = "/api/settings/whatsapp/wapi-key";
  const rawOf = (r) => JSON.stringify(r.json ?? {});
  const w0 = await api(wk);
  ok("GET clave Wapi: 200 y no-store", w0.res.status === 200 && w0.res.headers.get("cache-control")?.includes("no-store"));
  const wBad = await api(wk, { method: "PUT", body: JSON.stringify({ key: "EAAG-token-meta-0123456789" }) });
  ok(
    "PUT con formato inválido → 422 sin reflejar el valor",
    wBad.res.status === 422 && !rawOf(wBad).includes("EAAG-token-meta"),
    rawOf(wBad)
  );
  const wPut = await api(wk, { method: "PUT", body: JSON.stringify({ key: WAPI_FAKE }) });
  ok("PUT clave válida → 200, configurada, últimos 4", wPut.res.ok && wPut.json?.configured === true && wPut.json?.last4 === "WXYZ", rawOf(wPut));
  ok("la respuesta del PUT no contiene la clave", !rawOf(wPut).includes(WAPI_FAKE) && !rawOf(wPut).includes("E2EFICTICIA"));
  if (wPut.json?.gatewayEnabled) {
    ok("con gateway activo, el enrutamiento pasa a own_key", wPut.json?.routing === "own_key", rawOf(wPut));
  }
  const wGet = await api(wk);
  ok("GET tras guardar: configurada y sin clave en claro", wGet.json?.configured === true && !rawOf(wGet).includes("E2EFICTICIA"), rawOf(wGet));
  const wDel = await api(wk, { method: "DELETE" });
  ok("DELETE revoca: configurada=false, last4 nulo", wDel.res.ok && wDel.json?.configured === false && wDel.json?.last4 === null, rawOf(wDel));
  const wDel2 = await api(wk, { method: "DELETE" });
  ok("DELETE es idempotente", wDel2.res.ok && wDel2.json?.configured === false);
  ok("tras revocar el enrutamiento ya no es own_key", wDel.json?.routing !== "own_key", rawOf(wDel));
  const wAnon = await fetch(`${BASE}${wk}`, { headers: { origin: BASE } });
  ok("sin sesión → 401", wAnon.status === 401);

  await teamAssistantSection();

  // Al final a propósito: el Embedded Signup cambia el número de la org.
  await coexistenceSection();

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

/**
 * 007 — Asistente interno del equipo (specs/custom-heili/007-assistente-interno.md):
 * acceso reservado del agente (externo vs. número del equipo, con ai-mock),
 * quitar la demo SOLO en la organización activa (y recargarla en otra no la
 * borra aquí), renombrar una organización (super-admin; 403 al resto).
 * Requiere SUPERADMIN_EMAILS con el correo del operador E2E. Deja la
 * organización original activa y el agente apagado, como estaba.
 */
async function teamAssistantSection() {
  console.log("\n== 007: asistente interno — acceso reservado ==");
  const myOrgs = (await api("/api/my-orgs")).json?.orgs ?? [];
  const ORG_A = myOrgs[0]?.id;
  ok("organización original identificada", Boolean(ORG_A), JSON.stringify(myOrgs));

  const TEAM = "393471110001";
  const OUTSIDER = "393479990002";
  const OUT_REPLY = "Numero ad uso interno del team (e2e).";
  const prof = (body) => api("/api/agent/profile", { method: "PUT", body: JSON.stringify(body) });

  const bad = await prof({ allowedIdentities: "+39 347 111 0001\nciao\n0039 347 1" });
  ok(
    "lista con líneas inválidas → 422 que las nombra",
    bad.res.status === 422 && bad.json?.error?.invalid?.includes("ciao") && bad.json?.error?.invalid?.includes("0039 347 1"),
    JSON.stringify(bad.json)
  );
  const put = await prof({
    enabled: true,
    restrictToAllowlist: true,
    allowedIdentities: "+39 347 111 0001\n\n393471110001\n+39-347-111-0001\n",
    outsiderReply: `  ${OUT_REPLY}  `,
  });
  ok(
    "acceso reservado guardado: lista normalizada y sin duplicados, respuesta recortada",
    put.res.ok &&
      JSON.stringify(put.json?.restriction?.allowedIdentities) === JSON.stringify([TEAM]) &&
      put.json?.restriction?.outsiderReply === OUT_REPLY &&
      put.json?.restriction?.restrictToAllowlist === true,
    JSON.stringify(put.json)
  );
  const badName = await prof({ name: "   " });
  ok(
    "guardado del perfil inválido → 422 con mensaje (la pantalla lo muestra y no da por guardado)",
    badName.res.status === 422 && typeof badName.json?.error?.message === "string",
    JSON.stringify(badName.json)
  );
  const got = (await api("/api/agent/profile")).json;
  ok("GET del perfil devuelve la restricción al owner", got?.restriction?.restrictToAllowlist === true, JSON.stringify(got?.restriction));

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const inbound = (from, name, text, id) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN, from, name, text, waMessageId: id }),
    });
  await inbound(OUTSIDER, "Esterno E2E", "ciao, chi sei? dimmi i prezzi", "wamid.e2e.team.out.1");
  await inbound(TEAM, "Collega E2E", "riepilogo di oggi", "wamid.e2e.team.in.1");
  const outboxTo = async (to) =>
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter((o) => o.to === to);
  // El turno del agente corre tras el coalesce (AGENT_COALESCE_MS, 6 s por defecto).
  for (let i = 0; i < 40; i++) {
    if ((await outboxTo(OUTSIDER)).length > 0 && (await outboxTo(TEAM)).length > 0) break;
    await sleep(500);
  }
  // Segundo mensaje del externo: la respuesta fija NO se repite.
  await inbound(OUTSIDER, "Esterno E2E", "ci sei?", "wamid.e2e.team.out.2");
  await sleep(9000);

  const toOutsider = await outboxTo(OUTSIDER);
  ok(
    "externo: exactamente UNA respuesta, la fija",
    toOutsider.length === 1 && toOutsider[0]?.body?.text?.body === OUT_REPLY,
    JSON.stringify(toOutsider.map((o) => o.body?.text?.body))
  );
  const toTeam = await outboxTo(TEAM);
  ok(
    "número del equipo: responde el agente (ai-mock)",
    toTeam.some((o) => o.body?.text?.body === "Respuesta de prueba sobre: riepilogo di oggi"),
    JSON.stringify(toTeam.map((o) => o.body?.text?.body))
  );
  ok("el número del equipo no recibe la respuesta fija", !toTeam.some((o) => o.body?.text?.body === OUT_REPLY));
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  const outsiderConv = convs.find((c) => c.contact.phone === OUTSIDER);
  const outsiderMsgs = (await api(`/api/conversations/${outsiderConv?.id}/messages`)).json?.messages ?? [];
  const outsiderOut = outsiderMsgs.filter((m) => m.direction === "out");
  ok(
    "conversación del externo: 2 entrantes, 1 saliente (sin respuesta de la IA)",
    outsiderMsgs.filter((m) => m.direction === "in").length === 2 &&
      outsiderOut.length === 1 &&
      outsiderOut[0]?.text === OUT_REPLY,
    JSON.stringify(outsiderMsgs.map((m) => [m.direction, m.text]))
  );
  ok("el externo sigue en la bandeja sin handoff", outsiderConv && !outsiderConv.handoffAt, JSON.stringify(outsiderConv?.handoffAt));

  const restore = await prof({ enabled: false, restrictToAllowlist: false, allowedIdentities: "", outsiderReply: "" });
  ok(
    "restricción apagada y lista vaciada (estado original)",
    restore.res.ok &&
      restore.json?.restriction?.restrictToAllowlist === false &&
      restore.json?.restriction?.allowedIdentities?.length === 0 &&
      restore.json?.restriction?.outsiderReply === null,
    JSON.stringify(restore.json)
  );

  console.log("\n== 007: quitar datos demo, solo en la organización activa ==");
  const mkOrg = async (name) => (await api("/api/admin/orgs", { method: "POST", body: JSON.stringify({ name }) })).json?.org?.id;
  const ORG_B = await mkOrg("E2E Team B");
  const ORG_C = await mkOrg("E2E Team C");
  ok("super-admin crea dos organizaciones de prueba", Boolean(ORG_B && ORG_C));
  const use = (organizationId) =>
    api("/api/auth/organization/set-active", { method: "POST", body: JSON.stringify({ organizationId }) });
  const contactsCount = async () => ((await api("/api/contacts")).json?.contacts ?? []).length;

  await use(ORG_C);
  const seedC = await api("/api/seed/demo", { method: "POST" });
  ok("demo cargada en C", seedC.res.ok && seedC.json?.contacts === 8, JSON.stringify(seedC.json));
  await use(ORG_B);
  const seedB = await api("/api/seed/demo", { method: "POST" });
  ok("demo cargada en B", seedB.res.ok && seedB.json?.contacts === 8, JSON.stringify(seedB.json));
  await use(ORG_C);
  ok("cargar la demo en B NO borró la demo de C (limpieza por organización)", (await contactsCount()) === 8, `C=${await contactsCount()}`);
  const kbC = ((await api("/api/kb")).json?.entries ?? []).length;

  await use(ORG_B);
  const real = await api("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Cliente Real B", phone: "393470000777" }),
  });
  ok("contacto real creado en B", real.res.ok, JSON.stringify(real.json));
  await api("/api/kb", { method: "POST", body: JSON.stringify({ kind: "qa", question: "¿Turni?", answer: "Lun-ven" }) });
  ok("B tiene datos demo (GET)", (await api("/api/seed/demo")).json?.hasDemo === true);
  const del = await api("/api/seed/demo", { method: "DELETE" });
  ok("DELETE /api/seed/demo → 8 contactos y 8 entradas de KB demo", del.res.ok && del.json?.contacts === 8 && del.json?.kbEntries === 8, JSON.stringify(del.json));
  const leftB = (await api("/api/contacts")).json?.contacts ?? [];
  ok("en B queda solo el contacto real", leftB.length === 1 && leftB[0]?.name === "Cliente Real B", JSON.stringify(leftB.map((c) => c.name)));
  const kbB = (await api("/api/kb")).json?.entries ?? [];
  ok("en B queda solo el KB propio", kbB.length === 1 && kbB[0]?.question === "¿Turni?", JSON.stringify(kbB.map((e) => e.question)));
  ok("B ya no tiene datos demo (GET)", (await api("/api/seed/demo")).json?.hasDemo === false);
  const del2 = await api("/api/seed/demo", { method: "DELETE" });
  ok("quitar la demo otra vez no hace nada", del2.res.ok && del2.json?.contacts === 0 && del2.json?.kbEntries === 0, JSON.stringify(del2.json));
  await use(ORG_C);
  ok("C conserva su demo completa", (await contactsCount()) === 8 && ((await api("/api/kb")).json?.entries ?? []).length === kbC);

  console.log("\n== 007: renombrar organización (super-admin) ==");
  const ren = (id, name, extra = {}) =>
    api(`/api/admin/orgs/${id}`, { method: "PATCH", body: JSON.stringify({ name }), ...extra });
  const r1 = await ren(ORG_B, "  Assistente Team E2E  ");
  ok("super-admin renombra (recortado)", r1.res.ok && r1.json?.org?.name === "Assistente Team E2E", JSON.stringify(r1.json));
  const listed = ((await api("/api/admin/orgs")).json?.orgs ?? []).find((o) => o.id === ORG_B);
  ok("el nombre nuevo aparece en /admin y el slug no cambia", listed?.name === "Assistente Team E2E" && listed?.slug === "e2e-team-b", JSON.stringify(listed));
  ok("nombre vacío → 422", (await ren(ORG_B, "   ")).res.status === 422);
  ok("nombre de 81 caracteres → 422", (await ren(ORG_B, "x".repeat(81))).res.status === 422);
  ok("nombre de 80 caracteres → 200", (await ren(ORG_C, "y".repeat(80))).res.ok);
  ok("organización inexistente → 404", (await ren("org_no_existe", "Nada")).res.status === 404);
  const anon = await fetch(`${BASE}/api/admin/orgs/${ORG_B}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ name: "Anon" }),
  });
  ok("renombrar sin sesión → 401", anon.status === 401);

  // Cuentas sin super-admin: un owner y un member de B.
  const pass = "password-team-e2e-1";
  for (const [email, role] of [["owner-team@vocero.test", "owner"], ["member-team@vocero.test", "member"]]) {
    const created = await api(`/api/admin/orgs/${ORG_B}/users`, {
      method: "POST",
      body: JSON.stringify({ name: `E2E ${role}`, email, password: pass, role }),
    });
    ok(`cuenta ${role} de B creada`, created.res.status === 201, JSON.stringify(created.json));
  }
  const mainCookie = cookie;
  for (const [email, role] of [["owner-team@vocero.test", "owner"], ["member-team@vocero.test", "member"]]) {
    cookie = "";
    const si = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password: pass }) });
    ok(`login ${role} de B`, si.res.ok, JSON.stringify(si.json));
    const r = await ren(ORG_B, `Tomado por ${role}`);
    ok(`${role} (no super-admin) no puede renombrar → 403`, r.res.status === 403 && r.json?.error?.code === "not_superadmin", JSON.stringify(r.json));
    const d = await api("/api/seed/demo", { method: "DELETE" });
    if (role === "member") {
      ok("member no puede quitar la demo → 403", d.res.status === 403, JSON.stringify(d.json));
      const p = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ tone: "x" }) });
      ok(
        "member no puede guardar el perfil → 403 con mensaje (la pantalla lo muestra)",
        p.res.status === 403 && typeof p.json?.error?.message === "string",
        JSON.stringify(p.json)
      );
      const g = (await api("/api/agent/profile")).json;
      ok("member no recibe la lista de números del equipo", g && !("restriction" in g), JSON.stringify(g));
    }
    else ok("owner (no super-admin) sí puede quitar la demo de SU organización", d.res.ok, JSON.stringify(d.json));
  }
  cookie = mainCookie;
  const still = ((await api("/api/admin/orgs")).json?.orgs ?? []).find((o) => o.id === ORG_B);
  ok("los 403 no cambiaron el nombre", still?.name === "Assistente Team E2E", JSON.stringify(still));

  await use(ORG_A);
  ok("vuelta a la organización original", ((await api("/api/my-orgs")).json?.orgs ?? []).length >= 3);
}

/**
 * 009 — Coexistence: Embedded Signup (canje del code en el servidor) +
 * webhooks history / smb_app_state_sync / account_update.
 * Requiere META_APP_ID, META_ES_CONFIG_ID y META_APP_SECRET en la app; si
 * faltan, la sección se salta (el botón tampoco aparece en producción).
 */
async function coexistenceSection() {
  console.log("\n== 009: coexistence — Embedded Signup + historial + agenda ==");
  const cfg = (await api("/api/settings/whatsapp/embedded-signup")).json;
  if (!cfg?.enabled) {
    console.log("  SKIP Embedded Signup no configurado (META_APP_ID / META_ES_CONFIG_ID / META_APP_SECRET)");
    return;
  }
  ok("config pública sin App Secret", !JSON.stringify(cfg).includes(process.env.META_APP_SECRET ?? "§"));

  const WABA = "1234567890";
  const PN2 = `${WABA}-phone`; // el wa-mock deduce el número de la WABA

  // Camino infeliz: code vencido → 422 y la conexión anterior intacta.
  const bad = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "e2e-code-invalid", wabaId: WABA, phoneNumberId: null, coexistence: true }),
  });
  ok("code inválido → 422 code_exchange_failed", bad.res.status === 422 && bad.json?.error?.code === "code_exchange_failed", JSON.stringify(bad.json));
  let settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("la conexión anterior sigue intacta tras el fallo", settings?.phoneNumberId === PN, settings?.phoneNumberId);

  // Input inválido (WABA no numérica) → 422 sin llamar a Meta.
  const badInput = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "x", wabaId: "../etc", coexistence: true }),
  });
  ok("WABA ID inválido → 422", badInput.res.status === 422);

  // El número del popup debe pertenecer a la WABA (IDs del navegador, no fiables).
  const foreign = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "e2e-code-x", wabaId: WABA, phoneNumberId: "999888777666", coexistence: true }),
  });
  ok("número que no es de la WABA → 422 phone_not_found", foreign.res.status === 422 && foreign.json?.error?.code === "phone_not_found", JSON.stringify(foreign.json));
  // Número nuevo (sin coexistence) no soportado aún: falta /register con PIN.
  const notCoex = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "e2e-code-y", wabaId: WABA, coexistence: false }),
  });
  ok("coexistence=false → 422 (sin /register no se acepta)", notCoex.res.status === 422);

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const es = await api("/api/settings/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify({ code: "e2e-code-1", wabaId: WABA, phoneNumberId: null, coexistence: true }),
  });
  ok(
    "Embedded Signup completo (code canjeado, número deducido de la WABA)",
    es.res.ok && es.json?.onboardingMode === "coexistence",
    JSON.stringify(es.json)
  );
  ok(
    "agenda e historial pedidos a Meta",
    es.json?.sync?.contacts === "requested" && es.json?.sync?.history === "requested",
    JSON.stringify(es.json?.sync)
  );
  const syncReqs = (await api("/api/dev/wa-mock/outbox")).json?.syncRequests ?? [];
  ok(
    "smb_app_data: primero agenda, luego historial, al número correcto",
    syncReqs.map((r) => `${r.phoneNumberId}:${r.syncType}`).join(",") ===
      `${PN2}:smb_app_state_sync,${PN2}:history`,
    JSON.stringify(syncReqs)
  );
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok(
    "conexión guardada en modo coexistence, token solo …last4",
    settings?.phoneNumberId === PN2 && settings?.onboardingMode === "coexistence" &&
      settings?.tokenLast4?.length === 4 && !JSON.stringify(settings).includes("mock-es-token"),
    JSON.stringify(settings)
  );

  const GIULIA = "393331112222";
  const MARCO = "393334445555";
  const coex = (field, value) =>
    api("/api/dev/wa-mock/coexistence", {
      method: "POST",
      body: JSON.stringify({ field, phoneNumberId: PN2, value }),
    });

  // Agenda primero: Giulia todavía no es contacto del CRM.
  const sync1 = await coex("smb_app_state_sync", {
    state_sync: [
      { type: "contact", contact: { full_name: "Giulia Rossi", phone_number: GIULIA }, action: "add", metadata: { timestamp: "1760000000" } },
    ],
  });
  ok("agenda entregada al webhook", sync1.res.ok, JSON.stringify(sync1.json));
  await sleep(700);
  const contactsBefore = (await api("/api/conversations")).json?.conversations ?? [];
  ok("la agenda NO crea conversaciones", !contactsBefore.some((c) => c.contact.phone === GIULIA));

  const now = Math.floor(Date.now() / 1000);
  const history = {
    history: [
      {
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [
          {
            id: GIULIA,
            messages: [
              { from: GIULIA, id: "wamid.e2e.009.h1", timestamp: String(now - 7200), type: "text", text: { body: "ciao, avete posto sabato?" }, history_context: { status: "READ" } },
              { from: "393470000000", to: GIULIA, id: "wamid.e2e.009.h2", timestamp: String(now - 7000), type: "text", text: { body: "sì, alle 20" }, history_context: { status: "READ" } },
            ],
          },
          {
            id: MARCO,
            messages: [
              { from: MARCO, id: "wamid.e2e.009.h3", timestamp: String(now - 3600), type: "text", text: { body: "grazie!" }, history_context: { status: "DELIVERED" } },
            ],
          },
        ],
      },
    ],
  };
  const h1 = await coex("history", history);
  ok("historial entregado al webhook", h1.res.ok, JSON.stringify(h1.json));
  await sleep(1200);

  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  const giulia = convs.find((c) => c.contact.phone === GIULIA);
  const marco = convs.find((c) => c.contact.phone === MARCO);
  ok("historial crea el hilo de Giulia con el nombre de la agenda", giulia?.contact.name === "Giulia Rossi", JSON.stringify(giulia?.contact));
  ok("sin agenda, Marco queda con su teléfono como nombre", marco?.contact.name === MARCO, JSON.stringify(marco?.contact));
  ok(
    "historial NO abre la ventana de 24 h ni suma no-leídos",
    giulia?.lastInboundAt === null && giulia?.unreadCount === 0,
    JSON.stringify({ lastInboundAt: giulia?.lastInboundAt, unread: giulia?.unreadCount })
  );
  ok(
    "el hilo se ordena por el último mensaje del historial",
    giulia?.lastMessageAt === new Date((now - 7000) * 1000).toISOString(),
    `${giulia?.lastMessageAt}`
  );
  const gMsgs = giulia ? (await api(`/api/conversations/${giulia.id}/messages`)).json?.messages ?? [] : [];
  ok(
    "dirección correcta: entrante del cliente, saliente manual del dueño",
    gMsgs.find((m) => m.text === "ciao, avete posto sabato?")?.direction === "in" &&
      gMsgs.find((m) => m.text === "sì, alle 20")?.direction === "out" &&
      gMsgs.find((m) => m.text === "sì, alle 20")?.origin === "manual",
    JSON.stringify(gMsgs.map((m) => [m.direction, m.origin, m.text]))
  );
  const gDetail = giulia ? (await api(`/api/contacts/${giulia.contact.id}`)).json : null;
  ok("historial NO crea leads en el pipeline", gDetail && !gDetail.lead, JSON.stringify(gDetail?.lead));

  // Idempotencia: Meta reenvía el bloque.
  await coex("history", history);
  await sleep(900);
  const gMsgs2 = (await api(`/api/conversations/${giulia?.id}/messages`)).json?.messages ?? [];
  ok("bloque de historial repetido no duplica", gMsgs2.length === gMsgs.length, `${gMsgs.length} → ${gMsgs2.length}`);

  // Orden en el tiempo: un mensaje EN VIVO y después un bloque de historial
  // más antiguo (fase 1–90 días): el hilo queda en orden cronológico y el
  // último mensaje sigue siendo el de hoy.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN2, from: GIULIA, name: "Giulia", text: "e domenica?", waMessageId: "wamid.e2e.009.live.1" }),
  });
  await sleep(900);
  await coex("history", {
    history: [{ metadata: { phase: 1, chunk_order: 1, progress: 100 }, threads: [{ id: GIULIA, messages: [
      { from: GIULIA, id: "wamid.e2e.009.old.1", timestamp: String(now - 60 * 86400), type: "text", text: { body: "ciao, info di agosto" }, history_context: { status: "READ" } },
    ] }] }],
  });
  await sleep(1200);
  const ordered = (await api(`/api/conversations/${giulia?.id}/messages`)).json?.messages ?? [];
  const texts = ordered.map((m) => m.text);
  ok(
    "historial tardío y antiguo queda al principio; el mensaje en vivo sigue al final",
    texts[0] === "ciao, info di agosto" && texts[texts.length - 1] === "e domenica?",
    JSON.stringify(texts)
  );

  // Historial no compartido: entrega OK, sin efectos ni errores.
  const declined = await coex("history", {
    history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }],
  });
  ok("historial rechazado por el negocio → webhook 200", declined.res.ok);

  // La agenda nombra a un contacto que ya existe con nombre de relleno…
  await coex("smb_app_state_sync", {
    state_sync: [{ type: "contact", contact: { full_name: "Marco Bianchi", phone_number: MARCO }, action: "add" }],
  });
  // …pero respeta el nombre que tiene Giulia (no es de relleno).
  await coex("smb_app_state_sync", {
    state_sync: [{ type: "contact", contact: { full_name: "Giulia (vecchio)", phone_number: GIULIA }, action: "add" }],
  });
  await sleep(900);
  const convs2 = (await api("/api/conversations")).json?.conversations ?? [];
  ok("agenda renombra el contacto con nombre de relleno", convs2.find((c) => c.contact.phone === MARCO)?.contact.name === "Marco Bianchi");
  ok("agenda respeta un nombre ya puesto", convs2.find((c) => c.contact.phone === GIULIA)?.contact.name === "Giulia Rossi");

  // Corte y reconexión de la coexistence (account_update, nivel WABA).
  await coex("account_update", { event: "ACCOUNT_OFFBOARDED" });
  await sleep(700);
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("ACCOUNT_OFFBOARDED marca la coexistence cortada", Boolean(settings?.appDisconnectedAt), JSON.stringify(settings));
  await coex("account_update", { event: "ACCOUNT_RECONNECTED" });
  await sleep(700);
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("ACCOUNT_RECONNECTED la restablece", settings?.appDisconnectedAt === null, JSON.stringify(settings));
  // PARTNER_REMOVED de OTRO número de la misma WABA: no toca esta conexión.
  await coex("account_update", { event: "PARTNER_REMOVED", phone_number: "+1 555 000 1111" });
  await sleep(600);
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("PARTNER_REMOVED de otro número no marca esta conexión", settings?.appDisconnectedAt === null, JSON.stringify(settings));
  await coex("account_update", { event: "PARTNER_REMOVED", phone_number: settings?.displayPhoneNumber });
  await sleep(600);
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("PARTNER_REMOVED de ESTE número sí la marca", Boolean(settings?.appDisconnectedAt), JSON.stringify(settings));
  await coex("account_update", { event: "ACCOUNT_RECONNECTED" });
  await sleep(600);
  await coex("account_update", { event: "VERIFIED_ACCOUNT" });
  await sleep(500);
  settings = (await api("/api/settings/whatsapp")).json?.connection;
  ok("otros eventos de account_update no cambian nada", settings?.appDisconnectedAt === null);
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
