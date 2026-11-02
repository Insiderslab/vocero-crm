import { z } from "zod";

export const workspaceProfileSchema = z.enum(["standard", "marine"]);
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;

export function parseWorkspaceProfile(value: unknown): WorkspaceProfile {
  return workspaceProfileSchema.parse(value ?? "standard");
}

/** Reads only the workspace setting, so pages can resolve it without requiring unrelated secrets. */
export function getWorkspaceProfile(): WorkspaceProfile {
  const value = process.env.APP_WORKSPACE;
  return parseWorkspaceProfile(value === "" ? undefined : value);
}

export function canAccessCrm(profile: WorkspaceProfile, role: string): boolean {
  return profile === "standard" || role === "owner" || role === "admin";
}
