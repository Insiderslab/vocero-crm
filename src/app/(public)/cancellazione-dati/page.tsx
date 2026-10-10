import { LegalPage, legalMetadata } from "@/components/legal/legal-page";

export const generateMetadata = () => legalMetadata("deletion");

export default function Page() {
  return <LegalPage kind="deletion" />;
}
