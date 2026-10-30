import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserFindUnique, mockUserUpdate } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
  },
}));

import { GET, PATCH } from "./route";

function request(method: string, body?: unknown, withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new Request("http://localhost/api/notifications/preferences", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authUserRow() {
  return { id: "user-1", email: "student@example.com" };
}

function preferencesRow() {
  return {
    notifyTonight: true,
    notifyGradePosted: true,
    notifyDueTomorrow: true,
    nightlyReminderTime: "20:00",
  };
}

describe("/api/notifications/preferences", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mockUserFindUnique.mockReset().mockResolvedValue(authUserRow());
    mockUserUpdate.mockReset().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...preferencesRow(),
      ...args.data,
    }));
  });

  it("returns the authenticated student's saved preferences", async () => {
    mockUserFindUnique.mockResolvedValueOnce(authUserRow()).mockResolvedValue(preferencesRow());
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(preferencesRow());
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        notifyTonight: true,
        notifyGradePosted: true,
        notifyDueTomorrow: true,
        nightlyReminderTime: true,
      },
    });
  });

  it("requires an app session to read preferences", async () => {
    const response = await GET(request("GET", undefined, false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("updates one field and leaves the others untouched", async () => {
    const response = await PATCH(request("PATCH", { notifyTonight: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...preferencesRow(), notifyTonight: false });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { notifyTonight: false },
      select: {
        notifyTonight: true,
        notifyGradePosted: true,
        notifyDueTomorrow: true,
        nightlyReminderTime: true,
      },
    });
  });

  it("updates several fields at once", async () => {
    const response = await PATCH(request("PATCH", { notifyGradePosted: false, nightlyReminderTime: "21:30" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ...preferencesRow(),
      notifyGradePosted: false,
      nightlyReminderTime: "21:30",
    });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notifyGradePosted: false, nightlyReminderTime: "21:30" },
      }),
    );
  });

  it("accepts every time inside 00:00 through 23:59", async () => {
    for (const nightlyReminderTime of ["00:00", "09:05", "13:45", "23:59"]) {
      const response = await PATCH(request("PATCH", { nightlyReminderTime }));
      expect(response.status).toBe(200);
    }
  });

  it("rejects a nightly reminder time outside HH:MM or the 00:00-23:59 range", async () => {
    for (const nightlyReminderTime of ["24:00", "8:30", "09:60", "20:00 ", " 20:00", "20", "20:000", ""]) {
      const response = await PATCH(request("PATCH", { nightlyReminderTime }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Send notifyTonight, notifyGradePosted and notifyDueTomorrow as true or false, and nightlyReminderTime as HH:MM from 00:00 to 23:59." });
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-boolean toggles", async () => {
    for (const field of ["notifyTonight", "notifyGradePosted", "notifyDueTomorrow"]) {
      const response = await PATCH(request("PATCH", { [field]: "yes" }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Send notifyTonight, notifyGradePosted and notifyDueTomorrow as true or false, and nightlyReminderTime as HH:MM from 00:00 to 23:59." });
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects fields that are not notification preferences", async () => {
    const response = await PATCH(request("PATCH", { email: "student@example.com" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Send notifyTonight, notifyGradePosted and notifyDueTomorrow as true or false, and nightlyReminderTime as HH:MM from 00:00 to 23:59." });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a body that is not an object", async () => {
    for (const body of ["notify", [true], 7]) {
      const response = await PATCH(request("PATCH", body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body." });
    }
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("requires an app session to change preferences", async () => {
    const response = await PATCH(request("PATCH", { notifyTonight: false }, false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
