import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmailUnavailableError,
  superadminEmailCreationAllowed,
} from "@/server/auth/superadmin-email";

/**
 * 013 (revisione PR #15) — Un account con un'email di SUPERADMIN_EMAILS si
 * crea solo nel bootstrap (istanza vuota) o da /admin. Prova end-to-end con
 * Better Auth e PostgreSQL in tests/golden/superadmin-accounts.golden.test.ts.
 */

afterEach(() => vi.unstubAllEnvs());

describe("superadminEmailCreationAllowed", () => {
  it.each([
    ["email normale, da chiunque", "collega@x.test", false, false, true],
    ["super-admin, dall'owner (alta di equipo)", "root@heili.test", false, false, false],
    ["super-admin, maiuscole e spazi", "  ROOT@Heili.test ", false, false, false],
    ["super-admin, da /admin", "root@heili.test", true, false, true],
    ["super-admin, bootstrap (istanza vuota)", "root@heili.test", false, true, true],
  ] as const)("%s", (_n, email, bySuperadmin, instanceEmpty, expected) => {
    vi.stubEnv("SUPERADMIN_EMAILS", "root@heili.test");
    expect(superadminEmailCreationAllowed({ email, bySuperadmin, instanceEmpty })).toBe(expected);
  });

  it("riconosce solo il proprio codice d'errore", () => {
    expect(isEmailUnavailableError({ body: { code: "EMAIL_UNAVAILABLE" } })).toBe(true);
    expect(isEmailUnavailableError({ body: { code: "USER_ALREADY_EXISTS" } })).toBe(false);
    expect(isEmailUnavailableError(new Error("x"))).toBe(false);
    expect(isEmailUnavailableError(null)).toBe(false);
  });
});
