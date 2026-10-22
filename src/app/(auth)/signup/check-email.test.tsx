import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckEmailScreen } from "./check-email";

describe("CheckEmailScreen", () => {
  it("hedges on whether the address is new and still names where the link went", () => {
    const html = renderToStaticMarkup(<CheckEmailScreen sentTo="student@njit.edu" />);
    expect(html).toContain("Check your email");
    expect(html).toContain(
      "If this address is new to Priority, we sent a confirmation link to student@njit.edu.",
    );
    expect(html).toContain("Send it again");
  });

  it("keeps an existing account a click away", () => {
    const html = renderToStaticMarkup(<CheckEmailScreen sentTo="student@njit.edu" />);
    expect(html).toContain("Already have an account?");
    expect(html).toContain('href="/login"');
  });

  it("offers nothing to fix — no sign-up form fields", () => {
    const html = renderToStaticMarkup(<CheckEmailScreen sentTo="student@njit.edu" />);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('type="email"');
  });
});
