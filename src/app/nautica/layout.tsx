import type { ReactNode } from "react";
import { NauticaSessionShell } from "./session-shell";

export default function NauticaLayout({ children }: { children: ReactNode }) {
  return <NauticaSessionShell>{children}</NauticaSessionShell>;
}
