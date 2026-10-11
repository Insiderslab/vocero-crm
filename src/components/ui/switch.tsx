"use client";

import { cn } from "@/lib/utils";

/**
 * 009 (E10) — Interruptor accesible. El del agente («Acceso») se veía como
 * una píldora sin manopola: la manopola blanca sobre el carril gris claro no
 * se distinguía y no se sabía si estaba encendido. Aquí:
 * - apagado: carril claro CON borde y manopola gris (contraste ≥ 3:1);
 * - encendido: carril del acento y manopola blanca, desplazada a la derecha;
 * - `role="switch"` + `aria-checked` + nombre accesible obligatorio.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  describedBy,
  size = "md",
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Nombre accesible (lo que lee un lector de pantalla). */
  label: string;
  disabled?: boolean;
  /** id del texto visible que describe el estado ("Acceso"/"Spento"). */
  describedBy?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      data-state={checked ? "on" : "off"}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-50",
        sm ? "h-5 w-9" : "h-6 w-11",
        checked ? "border-brand bg-brand" : "border-border-strong bg-secondary",
        className
      )}
    >
      <span
        aria-hidden
        data-knob=""
        className={cn(
          "pointer-events-none absolute left-[2px] rounded-full shadow-sm ring-1 ring-black/10 transition-transform",
          sm ? "h-[14px] w-[14px]" : "h-[18px] w-[18px]",
          checked
            ? cn("bg-white", sm ? "translate-x-4" : "translate-x-5")
            : "translate-x-0 bg-text-3"
        )}
      />
    </button>
  );
}
