"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 009 — Botón "Conectar con Meta" (Embedded Signup en modo coexistence).
 *
 * El SDK JS de Meta abre su popup; al terminar entrega (1) un `code` de un
 * solo uso en el callback de FB.login y (2) los IDs de WABA y número por
 * postMessage (`WA_EMBEDDED_SIGNUP`). El code se canjea en el servidor: el
 * navegador jamás ve el token. Sin config en la instancia, no se muestra.
 */

type EsConfig =
  | { enabled: true; appId: string; configId: string; graphVersion: string }
  | { enabled: false };

type FbLoginResponse = { authResponse?: { code?: string } | null };

type FbSdk = {
  init: (opts: Record<string, unknown>) => void;
  login: (cb: (res: FbLoginResponse) => void, opts: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

let sdkPromise: Promise<FbSdk> | null = null;

function loadFacebookSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const init = () => {
      if (!window.FB) return reject(new Error("sdk"));
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    if (window.FB) return init();
    const timer = window.setTimeout(() => reject(new Error("timeout")), 15000);
    window.fbAsyncInit = () => {
      window.clearTimeout(timer);
      init();
    };
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("load"));
    };
    document.body.appendChild(script);
  }).catch((err) => {
    sdkPromise = null; // reintento posible tras quitar el bloqueador
    throw err;
  });
  return sdkPromise;
}

type SessionInfo = { wabaId: string; phoneNumberId: string | null };

/** Lee el postMessage del popup. Solo se aceptan orígenes de facebook.com. */
function parseSessionMessage(
  event: MessageEvent
): { kind: "finish"; info: SessionInfo } | { kind: "cancel" } | null {
  let url: URL;
  try {
    url = new URL(event.origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol !== "https:") return null;
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let data: unknown = event.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const msg = data as {
    type?: string;
    event?: string;
    data?: { waba_id?: string; phone_number_id?: string };
  } | null;
  if (msg?.type !== "WA_EMBEDDED_SIGNUP") return null;
  const ev = msg.event ?? "";
  if (ev.startsWith("FINISH") && msg.data?.waba_id) {
    return {
      kind: "finish",
      info: {
        wabaId: String(msg.data.waba_id),
        phoneNumberId: msg.data.phone_number_id ? String(msg.data.phone_number_id) : null,
      },
    };
  }
  if (ev === "CANCEL" || ev === "ERROR") return { kind: "cancel" };
  return null;
}

type Result =
  | { ok: true; number: string; syncOk: boolean }
  | { ok: false; message: string };

export function CoexistenceConnect({ onConnected }: { onConnected: () => void }) {
  const { t } = useT();
  const [config, setConfig] = useState<EsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);

  useEffect(() => {
    void fetch("/api/settings/whatsapp/embedded-signup")
      .then((r) => (r.ok ? (r.json() as Promise<EsConfig>) : null))
      .then((c) => setConfig(c ?? { enabled: false }))
      .catch(() => setConfig({ enabled: false }));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const parsed = parseSessionMessage(event);
      if (!parsed) return;
      if (parsed.kind === "finish") {
        sessionRef.current = parsed.info;
        return;
      }
      // Ventana cerrada o error en Meta: el botón vuelve a estar disponible
      // aunque el callback de FB.login no llegue (popup bloqueado, etc.).
      setBusy(false);
      setResult({ ok: false, message: t("settings.whatsapp.coexCancelled") });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);

  if (!config?.enabled) return null;
  const cfg = config;

  async function waitForSession(): Promise<SessionInfo | null> {
    // El postMessage puede llegar justo antes o justo después del callback.
    for (let i = 0; i < 20 && !sessionRef.current; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return sessionRef.current;
  }

  async function finalize(code: string) {
    const session = await waitForSession();
    if (!session) {
      setBusy(false);
      setResult({ ok: false, message: t("settings.whatsapp.coexFailed") });
      return;
    }
    const res = await fetch("/api/settings/whatsapp/embedded-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId,
        coexistence: true,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      sync?: { contacts: string; history: string };
      error?: { message?: string };
    } | null;
    setBusy(false);
    if (!res?.ok || !data?.displayPhoneNumber) {
      setResult({
        ok: false,
        message: data?.error?.message ?? t("settings.whatsapp.coexFailed"),
      });
      return;
    }
    setResult({
      ok: true,
      number: data.displayPhoneNumber,
      syncOk:
        data.sync?.contacts === "requested" && data.sync?.history === "requested",
    });
    onConnected();
  }

  async function connect() {
    setBusy(true);
    setResult(null);
    sessionRef.current = null;
    let fb: FbSdk;
    try {
      fb = await loadFacebookSdk(cfg.appId, cfg.graphVersion);
    } catch {
      setBusy(false);
      setResult({ ok: false, message: t("settings.whatsapp.coexSdkFailed") });
      return;
    }
    // El SDK exige un callback síncrono: el trabajo async va en finalize().
    fb.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          setResult({ ok: false, message: t("settings.whatsapp.coexCancelled") });
          return;
        }
        void finalize(code);
      },
      {
        config_id: cfg.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          {t("settings.whatsapp.coexTitle")}
        </CardTitle>
        <CardDescription>{t("settings.whatsapp.coexDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("settings.whatsapp.coexPoint1")}</li>
          <li>{t("settings.whatsapp.coexPoint2")}</li>
          <li>{t("settings.whatsapp.coexPoint3")}</li>
        </ul>
        {result && (
          <div
            className={`text-sm ${result.ok ? "text-success" : "text-destructive"}`}
            role="status"
          >
            <p>
              {result.ok
                ? t("settings.whatsapp.coexSuccess", { number: result.number })
                : result.message}
            </p>
            {result.ok && (
              <p className="text-muted-foreground">
                {result.syncOk
                  ? t("settings.whatsapp.coexSyncRequested")
                  : t("settings.whatsapp.coexSyncFailed")}
              </p>
            )}
          </div>
        )}
        <Button disabled={busy} onClick={() => void connect()}>
          {busy ? t("settings.whatsapp.coexConnecting") : t("settings.whatsapp.coexButton")}
        </Button>
      </CardContent>
    </Card>
  );
}
