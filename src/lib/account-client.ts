import type { ApiResult } from "./api-client";
import { apiRequest } from "./api-client";
import { getToken } from "./session";

// Asks the API to delete the signed-in student's account. The password is the
// proof the API checks against Supabase; the server removes the Prisma row and
// the Supabase auth user, which frees the email for signing up again.
export async function deleteAccount(password: string): Promise<ApiResult<{ deleted: true }>> {
  return apiRequest<{ deleted: true }>("/api/account/delete", {
    method: "POST",
    body: { password },
    token: getToken(),
  });
}
