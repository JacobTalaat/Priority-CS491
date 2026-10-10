import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const { AuthGuard } = await import("./auth-guard");

describe("AuthGuard", () => {
  it("does not render the protected page before the session is confirmed", () => {
    const html = renderToStaticMarkup(
      <AuthGuard>
        <p>private grades</p>
      </AuthGuard>,
    );
    expect(html).not.toContain("private grades");
    expect(html).toContain("Loading");
  });
});
