import { describe, expect, it } from "vitest";
import {
  SERVICE_ERROR,
  SERVICE_UNREACHABLE,
  SIGN_IN_UNAVAILABLE,
  TOO_MANY_ATTEMPTS,
  TOO_MANY_EMAILS,
  WRONG_CREDENTIALS,
  describeAuthError,
  isServiceProblem,
} from "./auth-errors";

describe("describeAuthError", () => {
  it("blames Priority, not the student, when its Supabase key is rejected or missing", () => {
    expect(describeAuthError({ message: "Invalid API key", status: 401 }, "signup")).toEqual({ message: SIGN_IN_UNAVAILABLE });
    expect(describeAuthError({ message: "Invalid API key", status: 401 }, "login")).toEqual({ message: SIGN_IN_UNAVAILABLE });
    expect(
      describeAuthError(new Error("Missing required environment variable NEXT_PUBLIC_SUPABASE_URL"), "signup"),
    ).toEqual({ message: SIGN_IN_UNAVAILABLE });
  });

  it("says the service couldn't be reached when there was no answer at all", () => {
    expect(describeAuthError({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }, "login")).toEqual({
      message: SERVICE_UNREACHABLE,
    });
    expect(describeAuthError(new TypeError("Failed to fetch"), "signup")).toEqual({ message: SERVICE_UNREACHABLE });
  });

  it("names rate limits for emails and for attempts", () => {
    expect(describeAuthError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "signup")).toEqual({
      message: TOO_MANY_EMAILS,
    });
    expect(describeAuthError({ status: 429, code: "over_request_rate_limit" }, "login")).toEqual({ message: TOO_MANY_ATTEMPTS });
    expect(describeAuthError({ status: 429, message: "Rate limit exceeded" }, "login")).toEqual({ message: TOO_MANY_ATTEMPTS });
  });

  it("points at the email field for problems with the address", () => {
    expect(describeAuthError({ status: 422, code: "user_already_exists" }, "signup")).toEqual({
      field: "email",
      message: "That email already has an account.",
    });
    expect(describeAuthError({ status: 422, message: "User already registered" }, "signup")).toEqual({
      field: "email",
      message: "That email already has an account.",
    });
    expect(describeAuthError({ status: 400, code: "email_address_invalid" }, "signup").field).toBe("email");
    expect(describeAuthError({ status: 400, code: "email_address_not_authorized" }, "signup")).toEqual({
      field: "email",
      message: "Priority can't send email to that address right now. Try a different email address.",
    });
  });

  it("passes Supabase's password rule to the password field", () => {
    expect(
      describeAuthError({ status: 422, code: "weak_password", message: "Password should be at least 8 characters" }, "signup"),
    ).toEqual({ field: "password", message: "Password is too weak. Password should be at least 8 characters" });
  });

  it("says when sign ups or email sign in are switched off", () => {
    expect(describeAuthError({ status: 422, code: "signup_disabled" }, "signup")).toEqual({
      message: "New accounts can't be created right now.",
    });
    expect(describeAuthError({ status: 403, message: "Signups not allowed for this instance" }, "signup")).toEqual({
      message: "New accounts can't be created right now.",
    });
    expect(describeAuthError({ status: 400, code: "email_provider_disabled" }, "login")).toEqual({
      message: "Signing in with email is turned off right now.",
    });
  });

  it("keeps wrong credentials for log in only", () => {
    expect(describeAuthError({ status: 400, code: "invalid_credentials" }, "login")).toEqual({ message: WRONG_CREDENTIALS });
    expect(describeAuthError({ status: 400, message: "Invalid login credentials" }, "login")).toEqual({ message: WRONG_CREDENTIALS });
  });

  it("reports server trouble, including a confirmation email that couldn't be sent", () => {
    expect(describeAuthError({ status: 500, message: "Error sending confirmation email" }, "signup")).toEqual({
      message: "We couldn't send the confirmation email. Try again in a few minutes.",
    });
    expect(describeAuthError({ status: 503, message: "Service Unavailable" }, "login")).toEqual({ message: SERVICE_ERROR });
    expect(describeAuthError({ status: 504, code: "request_timeout" }, "login")).toEqual({ message: SERVICE_ERROR });
  });

  it("falls back to a message for the flow instead of blaming the email or password", () => {
    expect(describeAuthError({ status: 400, code: "something_new" }, "signup")).toEqual({
      message: "Something went wrong while creating your account. Try again.",
    });
    expect(describeAuthError("nonsense", "login")).toEqual({ message: "Something went wrong while logging you in. Try again." });
  });
});

describe("isServiceProblem", () => {
  it("is true only for problems on Priority's side", () => {
    expect(isServiceProblem({ message: SIGN_IN_UNAVAILABLE })).toBe(true);
    expect(isServiceProblem({ message: SERVICE_ERROR })).toBe(true);
    expect(isServiceProblem({ message: WRONG_CREDENTIALS })).toBe(false);
  });
});
