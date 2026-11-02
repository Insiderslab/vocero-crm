import type { ReactNode } from "react";
import { NauticaSessionShell } from "./session-shell";

export const metadata = {
  manifest: "/nautica/manifest.webmanifest",
  appleWebApp: { capable: true, title: "La Bambola Crew", statusBarStyle: "default" as const },
};

export default function NauticaLayout({ children }: { children: ReactNode }) {
  return <NauticaSessionShell>{children}</NauticaSessionShell>;
}
