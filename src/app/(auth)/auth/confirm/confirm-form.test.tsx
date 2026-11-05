import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockGetSession, mockSetToken } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  const client = {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      resend: vi.fn(),
    },
  };
  return {
    mockCreateClient: vi.fn(() => client),
    mockGetSession: client.auth.getSession,
    mockSetToken: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/session", () => ({
  setToken: mockSetToken,
  getToken: () => null,
  clearToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ConfirmForm, ConfirmScreen, finishConfirmation } from "./confirm-form";
import type { ConfirmationOutcome } from "@/lib/auth-client";

const noop = () => {};

describe("ConfirmForm", () => {
  it("does not guess what the link did until supabase-js has read the fragment", () => {
    const html = renderToStaticMarkup(<ConfirmForm />);
    expect(html).toContain("Checking your link");
    expect(html).not.toContain("not valid");
    expect(html).not.toContain("expired");
  });
});

function stubBrowser(hash: string) {
  // In-place so readConfirmationResult's reads happen before the client could
  // touch supabase(), the way the real page loads.
  vi.stubGlobal("window", { location: { hash } });
}

let navigateTo: string | null = null;
function trackNavigation(path: string) {
  navigateTo = path;
}

describe("finishConfirmation", () => {
  it("stores nothing and goes nowhere for an error fragment, even while signed in", async () => {
    stubBrowser("#error=access_denied&error_code=otp_expired");
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "stale-token" } } });
    await expect(finishConfirmation(trackNavigation)).resolves.toEqual({
      status: "expired",
    });
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(navigateTo).toBeNull();
  });

  it("calls a stray visit invalid even if a student is signed in", async () => {
    stubBrowser("");
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "stale-token" } } });
    await expect(finishConfirmation(trackNavigation)).resolves.toEqual({
      status: "invalid",
    });
    expect(mockSetToken).not.toHaveBeenCalled();
    expect(navigateTo).toBeNull();
  });

  it("stores the token from the link's session and heads for the app", async () => {
    stubBrowser("#access_token=link-token&type=signup");
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "link-token" } } });
    await expect(finishConfirmation(trackNavigation)).resolves.toEqual({
      status: "confirmed",
      token: "link-token",
    });
    expect(mockSetToken).toHaveBeenCalledWith("link-token");
    expect(navigateTo).toBe("/classes");
  });
});

describe("ConfirmScreen", () => {
  it("clearly reports an expired or already used link and offers a fresh one", () => {
    const outcome: ConfirmationOutcome = { status: "expired" };
    const html = renderToStaticMarkup(
      <ConfirmScreen outcome={outcome} typedEmail="" onTypedEmail={noop} />,
    );
    expect(html).toContain("This confirmation link has expired or was already used.");
    expect(html).toContain('type="email"');
    expect(html).toContain("Send a new link");
    expect(html).not.toContain("not valid");
  });

  it("tells the student a link without anything to confirm is not valid", () => {
    const outcome: ConfirmationOutcome = { status: "invalid" };
    const html = renderToStaticMarkup(
      <ConfirmScreen outcome={outcome} typedEmail="" onTypedEmail={noop} />,
    );
    expect(html).toContain("This link is not valid.");
    expect(html).toContain('href="/login"');
  });
});
