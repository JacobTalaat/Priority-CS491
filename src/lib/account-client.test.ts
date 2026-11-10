import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "./account-client";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });
  fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteAccount", () => {
  it("posts the password to the delete route with the app token", async () => {
    await deleteAccount("correct-password");
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-token" },
      body: JSON.stringify({ password: "correct-password" }),
    });
  });

  it("answers ok with the deleted confirmation on success", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ deleted: true }));
    const result = await deleteAccount("correct-password");
    expect(result).toEqual({ ok: true, status: 200, data: { deleted: true } });
  });

  it("passes the API's error through, including the retry-again message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Your data was deleted, but your account is still there. Try again." }, { status: 500 })
    );
    const result = await deleteAccount("correct-password");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(
      "Your data was deleted, but your account is still there. Try again."
    );
  });
});
