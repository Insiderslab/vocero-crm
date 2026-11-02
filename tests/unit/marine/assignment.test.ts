import { describe, expect, it } from "vitest";
import { resolveMarineAssignment } from "@/lib/marine/assignment";
import { marineCommandSchema } from "@/lib/marine/validation";

const team = [{ id: "membership-new", name: "Ana Pérez" }];

describe("marine membership assignments", () => {
  it("resolves only the membership id and never a removed/recreated membership", () => {
    expect(resolveMarineAssignment({ assignedMemberId: "membership-new", assignedTo: "" }, team))
      .toEqual({ label: "Responsable: Ana Pérez", verified: true });
    expect(resolveMarineAssignment({ assignedMemberId: "membership-old", assignedTo: "" }, team))
      .toEqual({ label: "Miembro ya no disponible", verified: false });
  });

  it("keeps legacy text unverified even when it collides with a current id", () => {
    expect(resolveMarineAssignment({ assignedTo: "membership-new" }, team))
      .toEqual({ label: "membership-new · asignación sin verificar", verified: false });
  });

  it("labels null and absent assignments as unassigned", () => {
    expect(resolveMarineAssignment({ assignedMemberId: null, assignedTo: "" }, team).label).toBe("Sin asignar");
    expect(resolveMarineAssignment({ assignedTo: "" }, team).label).toBe("Sin asignar");
  });

  it("accepts absent, null, or membership id and rejects legacy assignment text", () => {
    const base = { action: "addService", requestId: "ab9235a1-f8c8-4bb6-b389-b74d12a85460", tripId: "demo", label: "Paella", quantity: 1 };
    expect(marineCommandSchema.safeParse(base).success).toBe(true);
    expect(marineCommandSchema.safeParse({ ...base, assignedMemberId: null }).success).toBe(true);
    expect(marineCommandSchema.safeParse({ ...base, assignedMemberId: "membership-new" }).success).toBe(true);
    expect(marineCommandSchema.safeParse({ ...base, assignedTo: "Ana Pérez" }).success).toBe(false);
  });
});
