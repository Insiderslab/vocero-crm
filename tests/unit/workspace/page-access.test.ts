import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  listening: vi.fn(), checklist: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({ getSessionOrNull: mocks.session }));
vi.mock("@/server/listening/mode", () => ({ isListeningMode: mocks.listening }));
vi.mock("@/server/onboarding/checklist", () => ({ getOnboardingChecklist: mocks.checklist, showOnboardingChecklist: () => false }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => ({ t: (key: string) => key }) }));
vi.mock("@/components/inbox/inbox-client", () => ({ InboxClient: () => null }));
vi.mock("@/components/dashboard/dashboard-client", () => ({ DashboardClient: () => null }));
vi.mock("@/components/onboarding/primi-passi", () => ({ PrimiPassi: () => null }));
import InboxPage from "@/app/(app)/inbox/page";
import DashboardPage from "@/app/(app)/dashboard/page";

describe("direct CRM page access", () => {
  beforeEach(() => {
    mocks.session.mockReset(); mocks.redirect.mockClear(); mocks.listening.mockReset(); mocks.checklist.mockReset();
    vi.stubEnv("APP_WORKSPACE", "marine");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([() => InboxPage(), () => DashboardPage({ searchParams: Promise.resolve({}) })])(
    "redirects anonymous and marine member requests before organization reads",
    async (page) => {
      mocks.session.mockResolvedValueOnce(null);
      await expect(page()).rejects.toThrow("redirect:/login");
      mocks.session.mockResolvedValueOnce({ userId: "u", organizationId: "o", role: "member" });
      await expect(page()).rejects.toThrow("redirect:/nautica");
      expect(mocks.listening).not.toHaveBeenCalled();
      expect(mocks.checklist).not.toHaveBeenCalled();
    }
  );

  it("preserves the listening banner path for an authorized CRM admin", async () => {
    mocks.session.mockResolvedValue({ userId: "u", organizationId: "o", role: "admin" });
    mocks.listening.mockResolvedValue(true);
    const page = await InboxPage();
    expect(mocks.listening).toHaveBeenCalledWith("o");
    expect(page).toBeTruthy();
  });

  it("preserves the standard anonymous inbox fallback without organization reads", async () => {
    vi.stubEnv("APP_WORKSPACE", "standard");
    mocks.session.mockResolvedValue(null);
    const page = await InboxPage();
    expect(page).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.listening).not.toHaveBeenCalled();
  });
});
