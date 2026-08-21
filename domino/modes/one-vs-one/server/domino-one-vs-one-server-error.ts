export type DominoOneVsOneServerError = {
  message: string;
  name?: string;
  code?: string;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  stack?: string;
};

function readableValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (value === null || value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" ? json : undefined;
  } catch {
    return undefined;
  }
}

export function describeDominoOneVsOneServerError(
  error: unknown,
): DominoOneVsOneServerError {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return {
      name: error.name,
      message: error.message || readableValue(cause) || "Unknown server error",
      stack: error.stack,
      ...(cause === undefined ? {} : { details: cause }),
    };
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      message:
        readableValue(value.message) ||
        readableValue(value.error) ||
        readableValue(error) ||
        "Unknown server error",
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.code === "string" ? { code: value.code } : {}),
      ...(value.details === undefined ? {} : { details: value.details }),
      ...(value.hint === undefined ? {} : { hint: value.hint }),
      ...(value.status === undefined ? {} : { status: value.status }),
    };
  }

  return { message: readableValue(error) || "Unknown server error" };
}