import { MarineApp } from "@/components/marine/marine-app";
import { getWorkspaceProfile } from "@/lib/workspace/profile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "La Bambola · Operaciones",
  description: "Operaciones de paseo de La Bambola Morrocoy",
};

export default function NauticaPage() {
  return <MarineApp view={getWorkspaceProfile() === "marine" ? "crew" : "legacy"} />;
}
