import LoginForm from "@/components/login-form";
import { getWorkspaceProfile } from "@/lib/workspace/profile";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const marine = getWorkspaceProfile() === "marine";
  return <LoginForm afterLoginHref={marine ? "/dashboard" : "/inbox"} allowRegistration={!marine} />;
}
