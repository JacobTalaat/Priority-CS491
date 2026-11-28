import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

describe("Privacy page", () => {
  it("explains the data collected, AI processing, usage, retention, and student choices", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);

    expect(html).toContain("Privacy policy");
    expect(html).toContain("Canvas access token is encrypted");
    expect(html).toContain("does not retain the uploaded PDF");
    expect(html).toContain("currently OpenRouter");
    expect(html).toContain("question text may identify you");
    expect(html).toContain("permanently delete your account");
    expect(html).toContain('href="/settings"');
  });
});
