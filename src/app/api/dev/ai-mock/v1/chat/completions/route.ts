import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion, aiMockShouldFail } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
  };
  if (aiMockShouldFail(body.messages ?? [])) {
    return Response.json(
      { error: { message: "ai-mock: proveedor no disponible (simulado)" } },
      { status: 503 }
    );
  }
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
