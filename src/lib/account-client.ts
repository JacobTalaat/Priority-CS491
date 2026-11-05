import { apiRequest } from "./api-client";
import { getToken } from "./session";

export function deleteAccount(password: string) {
  return apiRequest<{ deleted: true }>("/api/account/delete", {
    method: "POST",
    token: getToken(),
    body: { password },
  });
}
