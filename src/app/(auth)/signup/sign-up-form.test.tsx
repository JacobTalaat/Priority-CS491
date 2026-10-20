import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { SignUpForm } from "./sign-up-form";

describe("SignUpForm privacy disclosure", () => {
  it("explains stored data, AI inputs, and account deletion", () => {
    const html = renderToStaticMarkup(<SignUpForm />);

    expect(html).toContain("email and password hash");
    expect(html).toContain("encrypted Canvas credentials");
    expect(html).toContain("synced classes, assignments and grades");
    expect(html).toContain("extracted syllabus text");
    expect(html).toContain("syllabus text and instructions for analyzing it");
    expect(html).toContain("not your password, Canvas credentials, or grades");
    expect(html).toContain("password-confirmed POST request to");
    expect(html).toContain("<code>/api/account/delete</code>");
  });
});
