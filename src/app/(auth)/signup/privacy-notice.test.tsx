import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyNotice } from "./privacy-notice";

describe("PrivacyNotice", () => {
  it("explains stored data, AI use, and account deletion in one paragraph", () => {
    const html = renderToStaticMarkup(<PrivacyNotice />);
    expect(html.match(/<p\b/g)).toHaveLength(1);
    expect(html).toContain("email, a salted password hash");
    expect(html).toContain("encrypted Canvas access token");
    expect(html).toContain("does not use AI or send your data to AI services");
    expect(html).toContain("Settings → Account → Delete account");
    expect(html).toContain("does not delete records in Canvas or revoke your Canvas token there");
  });
});
