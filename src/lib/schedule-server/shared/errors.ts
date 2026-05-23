import type { ErrorCode } from "./types";

const SQLSTATE_TO_ERROR: Record<string, ErrorCode> = {
  PT001: "UNAUTHENTICATED",
  PT002: "IDENTITY_MISMATCH",
  PT003: "FORBIDDEN",
};

export function sqlstateToErrorCode(sqlstate: string | undefined): ErrorCode {
  if (!sqlstate) return "INTERNAL";
  return SQLSTATE_TO_ERROR[sqlstate] ?? "INTERNAL";
}

export function err<E extends ErrorCode>(
  error: E,
  details?: unknown,
): { ok: false; error: E; details?: unknown } {
  return details === undefined ? { ok: false, error } : { ok: false, error, details };
}
