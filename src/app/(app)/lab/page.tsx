import { adminOnly } from "@/components/admin-only";
import { LabClient } from "@/components/lab/lab-client";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  return adminOnly(<LabClient />);
}
