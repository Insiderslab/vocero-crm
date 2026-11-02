import type { MarineService, MarineServiceAssignment, MarineTeamMember } from "@/lib/marine/types";

/** Resolve presentation only; legacy text is never proof of membership. */
export function resolveMarineAssignment(
  service: Pick<MarineService, "assignedMemberId" | "assignedTo">,
  team: MarineTeamMember[],
): MarineServiceAssignment {
  if (service.assignedMemberId) {
    const member = team.find((candidate) => candidate.id === service.assignedMemberId);
    return member
      ? { label: `Responsable: ${member.name}`, verified: true }
      : { label: "Miembro ya no disponible", verified: false };
  }
  if (service.assignedTo) return { label: `${service.assignedTo} · asignación sin verificar`, verified: false };
  return { label: "Sin asignar", verified: false };
}
