import { describe, expect, it, vi, afterEach } from "vitest";
import { canAccessCrm, getWorkspaceProfile, parseWorkspaceProfile } from "@/lib/workspace/profile";

describe("workspace profile", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to standard and validates explicit values", () => {
    expect(parseWorkspaceProfile(undefined)).toBe("standard");
    expect(parseWorkspaceProfile("marine")).toBe("marine");
    expect(() => parseWorkspaceProfile("unknown")).toThrow();
  });
  it("reads only APP_WORKSPACE and fails closed on invalid values", () => {
    vi.stubEnv("APP_WORKSPACE", "marine");
    expect(getWorkspaceProfile()).toBe("marine");
    vi.stubEnv("APP_WORKSPACE", "unexpected");
    expect(() => getWorkspaceProfile()).toThrow();
  });
  it("limits marine CRM to owner/admin while preserving standard access", () => {
    expect(canAccessCrm("marine", "owner")).toBe(true);
    expect(canAccessCrm("marine", "admin")).toBe(true);
    expect(canAccessCrm("marine", "member")).toBe(false);
    expect(canAccessCrm("marine", "unknown")).toBe(false);
    expect(canAccessCrm("standard", "member")).toBe(true);
  });
});
