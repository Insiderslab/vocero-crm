"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCENT_PRESETS, isValidHex, resolveAccentSet, type Branding } from "@/lib/branding";
import { useT } from "@/lib/i18n/client";
import { CURRENCIES, DEFAULT_CURRENCY, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/components/use-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Las etiquetas de los presets viven en lib/branding; aquí se mapean a i18n. */
const PRESET_LABEL_KEYS: Record<string, string> = {
  "Azul acero": "settings.branding.preset.azulAcero",
  Grafito: "settings.branding.preset.grafito",
  "Verde apagado": "settings.branding.preset.verdeApagado",
  Ciruela: "settings.branding.preset.ciruela",
};

export function BrandingClient() {
  const router = useRouter();
  const { t } = useT();
  const mode = useResolvedTheme();
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#3f5972");
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding: Branding } | null) => {
        if (d) {
          setName(d.branding.name);
          setAccent(d.branding.accent);
          if (d.branding.currency) setCurrency(d.branding.currency);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const isPreset = accent.toLowerCase() in ACCENT_PRESETS;
  // La vista previa muestra el acento tal como se verá en el tema activo: los
  // presets están pensados para fondo claro y en oscuro se aclaran.
  const previewSet = resolveAccentSet(accent, mode);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), accent, currency }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? t("settings.branding.saveError"));
      return;
    }
    setSaved(true);
    // Re-renderiza el árbol server (layout raíz inyecta el acento y el título)
    router.refresh();
  }

  if (!loaded) return <p className="text-sm text-text-3">{t("common.loading")}</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.branding.title")}</CardTitle>
          <CardDescription>
            {t("settings.branding.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">{t("common.name")}</Label>
            <Input
              id="brand-name"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Heili CRM"
              className="max-w-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-currency">{t("settings.branding.currencyLabel")}</Label>
            <select
              id="brand-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="h-9 max-w-xs rounded-md border border-input bg-card px-2 text-sm"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-3">
              {t("settings.branding.currencyHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("settings.branding.accentLabel")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(ACCENT_PRESETS).map(([hex, preset]) => {
                const presetLabel = t(
                  PRESET_LABEL_KEYS[preset.label] ??
                    "settings.branding.preset.azulAcero"
                );
                return (
                  <button
                    key={hex}
                    onClick={() => setAccent(hex)}
                    title={presetLabel}
                    aria-label={presetLabel}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                      accent.toLowerCase() === hex
                        ? "border-foreground/40 bg-secondary"
                        : "hover:bg-accent"
                    )}
                  >
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ background: resolveAccentSet(hex, mode).accent }}
                    />
                    {presetLabel}
                  </button>
                );
              })}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  !isPreset ? "border-foreground/40 bg-secondary" : "hover:bg-accent"
                )}
              >
                <input
                  type="color"
                  value={isValidHex(accent) ? accent : "#3f5972"}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-4 w-4 cursor-pointer appearance-none border-0 bg-transparent p-0"
                />
                {t("settings.branding.custom")}
              </label>
            </div>
            <p className="text-xs text-text-3">
              {t("settings.branding.accentHelp")}
            </p>
          </div>

          {/* Vista previa */}
          <div className="rounded-md border p-4" style={{ background: previewSet.tint }}>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-sm text-[15px] font-bold"
                style={{ background: previewSet.accent, color: previewSet.fg }}
              >
                {(name.trim() || "Heili CRM").charAt(0).toUpperCase()}
              </span>
              <span>
                <span className="block text-[15px] font-[650] leading-tight">
                  {name.trim() || "Heili CRM"}
                </span>
                <span className="block text-[11px] text-text-3">CRM · WhatsApp</span>
              </span>
              <span className="flex-1" />
              <span
                className="rounded-md px-3 py-1.5 text-xs font-medium"
                style={{ background: previewSet.accent, color: previewSet.fg }}
              >
                {t("settings.branding.previewButton")}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm" style={{ color: previewSet.text }}>{t("settings.branding.saved")}</p>}
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? t("common.saving") : t("settings.branding.submit")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
