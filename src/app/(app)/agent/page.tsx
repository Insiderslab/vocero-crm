import { adminOnly } from "@/components/admin-only";
import { AgentClient } from "@/components/agent/agent-client";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  return adminOnly(<AgentClient />);
}
