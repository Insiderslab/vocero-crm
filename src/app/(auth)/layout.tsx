import { DEFAULT_BRANDING } from "@/lib/branding";
import { getT } from "@/lib/i18n/server";
import { getBranding } from "@/server/branding";
import { HeiliMark } from "@/components/heili-mark";

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const { t } = await getT();
  return (
    <main
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "var(--heili-paper)" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <HeiliMark size={44} className="text-[var(--heili-verde-brand)]" />
          <div>
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--heili-font-display)", color: "var(--heili-ink)" }}
            >
              {branding.name}
            </h1>
            <p
              className="text-xs mt-2 uppercase tracking-[0.08em]"
              style={{ color: "var(--heili-soft)" }}
            >
              {t("auth.tagline")}
            </p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
