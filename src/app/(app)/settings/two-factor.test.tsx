// @vitest-environment jsdom
import { Buffer } from "node:buffer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section is the whole two factor lifecycle in Settings: read the status,
// enroll and verify, show the codes once, and turn two factor off again.
const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  enrollAuthenticator: vi.fn(),
  unenrollPendingFactor: vi.fn(),
  verifyAuthenticatorCode: vi.fn(),
  twoFactorStatus: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getToken: mocks.getToken,
}));

import { TwoFactor } from "./two-factor";

vi.mock("@/lib/two-factor-client", () => mocks);

const RECOVERY_CODES = [
  "abcd-efgh-jk",
  "mnpq-rstu-vw",
  "2345-6789-ab",
  "cdef-ghjk-lm",
  "npqr-stuv-wx",
  "3456-789a-bc",
  "defg-hjkl-mn",
  "pqr-stuv-wx",
  "4567-89ab-cd",
  "efgh-jklm-np",
];

function statusResponse(enabled: boolean, recoveryCodesLeft = 0) {
  return { ok: true as const, status: 200, data: { enabled, recoveryCodesLeft } };
}

// A short SVG data URI is all the QR rendering needs: the <img> just gets it.
const QR_DATA_URI = "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64");

describe("TwoFactor", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.getToken.mockReturnValue("session-token");
    mocks.twoFactorStatus.mockResolvedValue(statusResponse(false));
    mocks.verifyAuthenticatorCode.mockResolvedValue({ ok: true, token: "fresh-aal2-token" });
    mocks.enableTwoFactor.mockResolvedValue({
      ok: true as const,
      status: 200,
      data: { recoveryCodes: RECOVERY_CODES },
    });
    mocks.disableTwoFactor.mockResolvedValue({
      ok: true as const,
      status: 200,
      data: { disabled: true },
    });
    Object.assign(navigator, { clipboard: { writeText: mocks.writeText } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  function findButton(label: string): HTMLButtonElement | null {
    const buttons = [...container.querySelectorAll("button")];
    return buttons.find((button) => button.textContent?.includes(label)) ?? null;
  }

  function submitForm() {
    return act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
  }

  it("starts in the Off state for a student without two factor", async () => {
    await act(async () => {
      root.render(<TwoFactor />);
    });
    expect(container.textContent).toContain("Off");
    expect(findButton("Turn two factor on")).not.toBeNull();
  });

  it("turns on: enrolls, shows the QR code and the secret, and asks for the verify code", async () => {
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "JBSWY3DPEHPK3PXP",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    expect(mocks.enrollAuthenticator).toHaveBeenCalledTimes(1);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(QR_DATA_URI);
    expect(img?.getAttribute("alt")).toContain("QR code");
    expect(container.textContent).toContain("JBSWY3DPEHPK3PXP");
    // Nothing is turned on in the app until the six digit code checks out.
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled();
  });

  it("renders the enrollment QR from a raw unencoded SVG data URI without crashing", async () => {
    // Supabase hands back exactly this shape: raw markup with a trailing
    // newline, which next/image refuses unless it is rebuilt first.
    const rawUri = `data:image/svg+xml;utf-8,<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">QR</svg>\n`;
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: rawUri,
      secret: "SECRET",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    const img = container.querySelector("img");
    const src = img?.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(src).not.toMatch(/[\n<]/);
    // The manual secret stays either way.
    expect(container.textContent).toContain("SECRET");
  });

  it("verifies the code, calls enable with the fresh token, and shows the codes once", async () => {
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "SECRET",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "123456");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    expect(mocks.verifyAuthenticatorCode).toHaveBeenCalledWith("factor-1", "123456");
    expect(mocks.enableTwoFactor).toHaveBeenCalledWith("fresh-aal2-token");
    expect(mockRecoveryCodesVisible()).toEqual(RECOVERY_CODES);
    expect(mocks.unenrollPendingFactor).not.toHaveBeenCalled();
  });

  it("keeps the codes gone for good after \"I saved these\" and refreshes the status", async () => {
    // The first read (mount) sees Off; the refresh after saving sees the
    // setup the enable route just finished, codes untouched.
    mocks.twoFactorStatus
      .mockResolvedValueOnce(statusResponse(false))
      .mockResolvedValue(statusResponse(true, 10));
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "SECRET",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "123456");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    await act(async () => {
      findButton("I saved these")?.click();
    });
    expect(mockRecoveryCodesVisible()).toEqual([]);
    // The status read comes back with the "On" view, never with the codes.
    expect(mocks.twoFactorStatus).toHaveBeenCalledTimes(2);
    expect(findButton("Turn off")).not.toBeNull();
  });

  it("copies the codes once without hiding them", async () => {
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "SECRET",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "123456");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    mocks.writeText.mockResolvedValue(undefined);
    await act(async () => {
      findButton("Copy")?.click();
    });
    expect(mocks.writeText).toHaveBeenCalledWith(RECOVERY_CODES.join("\n"));
    expect(mockRecoveryCodesVisible()).toEqual(RECOVERY_CODES);
  });

  it("unenrolls the factor instead of leaving it behind when setup is cancelled", async () => {
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "SECRET",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    await act(async () => {
      findButton("Cancel")?.click();
    });
    expect(mocks.unenrollPendingFactor).toHaveBeenCalledWith("factor-1");
    expect(container.querySelector("img")).toBeNull();
    expect(findButton("Turn two factor on")).not.toBeNull();
  });

  it("shows the inline error on a wrong setup code and does not enable", async () => {
    mocks.enrollAuthenticator.mockResolvedValue({
      factorId: "factor-1",
      qrCode: QR_DATA_URI,
      secret: "SECRET",
    });
    mocks.verifyAuthenticatorCode.mockResolvedValue({ ok: false });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn two factor on")?.click();
    });
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "111111");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    expect(container.textContent).toContain("That code is not right. Try again.");
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled();
  });

  it("shows On with the recovery codes left and asks for a current code before turning off", async () => {
    // The route re-checks the code server-side, acting as the student, so the
    // section's only job is to hand the code over.
    mocks.twoFactorStatus.mockResolvedValue(statusResponse(true, 8));
    await act(async () => {
      root.render(<TwoFactor />);
    });
    expect(container.textContent).toContain("Recovery codes left");
    await act(async () => {
      findButton("Turn off")?.click();
    });
    expect(findButton("Verify and turn off")).not.toBeNull();
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "123456");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    expect(mocks.disableTwoFactor).toHaveBeenCalledWith("123456");
    expect(container.textContent).toContain("Off");
  });

  it("shows the inline error when the server refuses the turn-off code", async () => {
    mocks.twoFactorStatus.mockResolvedValue(statusResponse(true, 8));
    mocks.disableTwoFactor.mockResolvedValue({
      ok: false as const,
      status: 400,
      error: "That code is not right. Try again.",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    await act(async () => {
      findButton("Turn off")?.click();
    });
    const codeInput = container.querySelector<HTMLInputElement>('input[name="authenticator-code"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        ?.set as (value: string) => void;
      setter.call(codeInput!, "111111");
      codeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm();
    expect(container.textContent).toContain("That code is not right. Try again.");
    expect(findButton("Verify and turn off")).not.toBeNull();
  });

  it("answers the status read failure with an error notice", async () => {
    mocks.twoFactorStatus.mockResolvedValue({
      ok: false as const,
      status: 0,
      error: "Can't reach Priority right now. Check your connection and try again.",
    });
    await act(async () => {
      root.render(<TwoFactor />);
    });
    expect(container.textContent).toContain("Can't reach Priority right now.");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  function mockRecoveryCodesVisible(): string[] {
    return [...container.querySelectorAll("li")].map((entry) => entry.textContent ?? "");
  }
});
