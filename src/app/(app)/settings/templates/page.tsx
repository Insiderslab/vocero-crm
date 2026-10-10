import { adminOnly } from "@/components/admin-only";
import { TemplatesClient } from "@/components/settings/templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  return adminOnly(<TemplatesClient />);
}
