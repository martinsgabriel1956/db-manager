import type { AppError } from "@/bindings";

function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof error.message === "string"
  );
}

/** Commands throw a serialized AppError (plain object), not an Error instance. */
export function errorMessage(error: unknown): string {
  if (isAppError(error) || error instanceof Error) {
    return error.message;
  }
  return String(error);
}
