import { describe, expect, it } from "vitest";
import { HTML_TO_TEXT_MAX_CHARS, htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  it("returns null for absent or non-string input", () => {
    expect(htmlToText(undefined)).toBeNull();
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText(42)).toBeNull();
    expect(htmlToText({ p: 1 })).toBeNull();
  });

  it("strips tags and collapses the whitespace they leave behind", () => {
    expect(htmlToText("<p>Read chapter 3.</p><p>Then do problems 1-10.</p>")).toBe(
      "Read chapter 3. Then do problems 1-10."
    );
    expect(htmlToText("<div>\n  <strong>Due</strong>   Friday\n  <em>10 points</em>\n</div>")).toBe(
      "Due Friday 10 points"
    );
  });

  it("decodes the common entities", () => {
    expect(htmlToText("A &amp; B")).toBe("A & B");
    expect(htmlToText("5 &lt; 10 &gt; 3")).toBe("5 < 10 > 3");
    expect(htmlToText('The &quot;final&quot; exam')).toBe('The "final" exam');
    expect(htmlToText("It&#39;s due")).toBe("It's due");
    expect(htmlToText("Hard&nbsp;space")).toBe("Hard space");
  });

  it("decodes entities only once, so &amp;lt; stays readable", () => {
    expect(htmlToText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
  });

  it("drops whole elements including script and style bodies", () => {
    const text = htmlToText("<p>Do the lab.</p><script>alert('hi')</script><style>.x{}</style>");
    expect(text).toBe("Do the lab.");
    expect(text).not.toContain("alert");
  });

  it("caps the result at 4000 characters", () => {
    expect(HTML_TO_TEXT_MAX_CHARS).toBe(4000);
    expect(htmlToText("<p>" + "a".repeat(5000) + "</p>")).toBe("a".repeat(4000));
    expect(htmlToText("<p>" + "b".repeat(4000) + "</p>")).toBe("b".repeat(4000));
  });

  it("returns null when nothing readable is left", () => {
    expect(htmlToText("")).toBeNull();
    expect(htmlToText("  ")).toBeNull();
    expect(htmlToText("<br/><hr/>")).toBeNull();
    expect(htmlToText("&nbsp;")).toBeNull();
  });

  it("leaves text without tags or entities untouched", () => {
    expect(htmlToText("Just read pages 12 through 30.")).toBe("Just read pages 12 through 30.");
  });
});

describe("htmlToText on real Canvas HTML", () => {
  it("decodes decimal and hex numeric entities", () => {
    expect(htmlToText("<p>Don&#8217;t forget &#x2014; it&#x2019;s due</p>")).toBe("Don’t forget — it’s due");
  });

  it("does not leak text from a quoted attribute containing >", () => {
    expect(htmlToText('<span title="1 > 2">read</span>')).toBe("read");
  });

  it("drops comments even when they contain >", () => {
    expect(htmlToText("before<!-- a > b secret -->after")).toBe("before after");
  });

  it("leaves an out-of-range numeric entity as written", () => {
    expect(htmlToText("x &#99999999; y")).toBe("x &#99999999; y");
  });
});
