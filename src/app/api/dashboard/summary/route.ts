import { apiError, withAuth } from "@/lib/api";
import {
  getDashboardSummary,
  normalizeSummaryDays,
} from "@/server/dashboard/summary";

export const dynamic = "force-dynamic";

/**
 * Agregados de «Sintesi» para la organización de la sesión. Cualquier miembro
 * puede leerlos (son su propia operación); el período admite 7, 30 o 90 días.
 */
export const GET = withAuth(async (session, req: Request) => {
  const days = normalizeSummaryDays(
    new URL(req.url).searchParams.get("days") ?? 30
  );
  if (!days) {
    return apiError(422, "invalid_days", "El período debe ser 7, 30 o 90 días");
  }
  return Response.json(
    await getDashboardSummary(session.organizationId, days)
  );
});
