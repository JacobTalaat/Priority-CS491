import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockGetToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiRequest: mocks.mockApiRequest,
}));

vi.mock("./session", () => ({
  getToken: mocks.mockGetToken,
}));

import { deleteAccount } from "./account-client";

describe("deleteAccount", () => {
  beforeEach(() => {
    mocks.mockApiRequest.mockReset();
    mocks.mockGetToken.mockReset().mockReturnValue("signed-in-token");
  });

  it("posts the password with the signed-in student's session", () => {
    deleteAccount("correct-password");

    expect(mocks.mockApiRequest).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      token: "signed-in-token",
      body: { password: "correct-password" },
    });
  });
});
