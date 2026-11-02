"use client";

import { useState, type ReactNode } from "react";
import { useSession } from "@/lib/auth/client";

export function NauticaSessionShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [pending, setPending] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    if (pending || signedOut) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.error) throw new Error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      setSignedOut(true);
      window.location.replace("/nautica");
    } catch {
      setPending(false);
      setError("No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.");
    }
  }

  return (
    <>
      {session && !signedOut ? (
        <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pt-3">
          <button
            type="button"
            onClick={leave}
            disabled={pending}
            className="min-h-11 min-w-11 rounded-lg border border-slate-400 bg-white px-4 py-2 text-base font-semibold text-slate-900 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Saliendo…" : "Salir"}
          </button>
        </div>
      ) : null}
      {error ? <p className="mx-auto mt-2 max-w-7xl px-4 text-base font-medium text-red-700" role="alert">{error}</p> : null}
      {!signedOut ? children : null}
    </>
  );
}
