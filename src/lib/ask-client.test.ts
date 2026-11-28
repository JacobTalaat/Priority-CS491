import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ getToken: () => "app-token" }));

import { askClasses } from "./ask-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ask my classes client", () => {
  it("sends a question to the authenticated Ask API", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      found: false,
      message: "Priority couldn't find that in your syllabus or Canvas data.",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await askClasses("When is my next assignment due?");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer app-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ question: "When is my next assignment due?" }),
      }),
    );
  });
});
