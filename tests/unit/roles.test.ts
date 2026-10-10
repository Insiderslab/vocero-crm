import { describe, expect, it } from "vitest";
import { canManageApiKeys } from "@/lib/roles";

describe("canManageApiKeys: comparación exacta del rol", () => {
  it("owner y admin sí", () => {
    expect(canManageApiKeys("owner")).toBe(true);
    expect(canManageApiKeys("admin")).toBe(true);
  });

  it.each(["owner-x", "xadmin", "Owner", "ADMIN", "owner,admin", " admin", "member", "agent", ""])(
    "%j no",
    (role) => {
      expect(canManageApiKeys(role)).toBe(false);
    }
  );
});
