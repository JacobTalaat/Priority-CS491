import { describe, expect, it } from "vitest";
import { svgDataUri } from "./svg-data-uri";

// The easiest SVG to round-trip: encode it, decode the payload back, and
// compare against the original markup.
const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">QR</svg>`;

describe("svgDataUri", () => {
  it("encodes a raw SVG data URI with its trailing newline into a safe URI", () => {
    const raw = `data:image/svg+xml;utf-8,${SVG}\n`;
    const encoded = svgDataUri(raw);
    expect(encoded.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(encoded).not.toMatch(/[\s<>"']/);
    expect(decodeURIComponent(encoded.split(",")[1])).toBe(SVG);
  });

  it("keeps an already base64 encoded data URI as is", () => {
    const raw = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(svgDataUri(`${raw}\n`)).toBe(raw);
  });

  it("returns an empty string for values that are not data URIs", () => {
    expect(svgDataUri("https://example.com/qr.svg")).toBe("");
    expect(svgDataUri("not a data uri at all")).toBe("");
  });

  it("returns an empty string for an SVG data URI with no payload", () => {
    expect(svgDataUri("data:image/svg+xml;utf-8,")).toBe("");
  });
});
