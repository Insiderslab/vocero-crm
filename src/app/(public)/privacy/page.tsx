import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

export const generateMetadata = () => legalMetadata("privacy");

export default function Page() {
  return <LegalPage kind="privacy" />;
}
