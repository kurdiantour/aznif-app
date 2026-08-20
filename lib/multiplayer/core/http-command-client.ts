export type MultiplayerRequestBody = Record<string, unknown>;

export type MultiplayerCommandClientOptions = {
  getAccessToken: () => Promise<string | null>;
  getBaseUrl: () => string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  expectedErrorCodes?: ReadonlySet<string>;
};

export class MultiplayerRequestError extends Error {
  readonly status: number | null;
  readonly ambiguous: boolean;
  readonly code: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number | null,
    ambiguous: boolean,
    code: string | null = null,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "MultiplayerRequestError";
    this.status = status;
    this.ambiguous = ambiguous;
    this.code = code;
    this.details = details;
  }
}

export function createMultiplayerCommandClient(options: MultiplayerCommandClientOptions) {
  return async (functionName: string, body: MultiplayerRequestBody) => {
    const token = await options.getAccessToken();
    if (!token) throw new Error("User not authenticated");

    const baseUrl = options.getBaseUrl()?.replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Missing multiplayer service URL");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let response: Response;

    try {
      response = await (options.fetchImpl ?? fetch)(`${baseUrl}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: any) {
      throw new MultiplayerRequestError(
        error?.message ?? `${functionName} request failed`,
        null,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch (error: any) {
      throw new MultiplayerRequestError(
        error?.message ?? `${functionName} response failed`,
        null,
        true,
      );
    }

    let json: any = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const code = typeof json?.code === "string" ? json.code : null;
      const expected = code !== null && options.expectedErrorCodes?.has(code);
      if (!expected) {
        console.warn(`${functionName} failed`, {
          status: response.status,
          statusText: response.statusText,
          code,
          error: json?.error ?? null,
          details: json?.details ?? null,
          rawResponse: responseText,
        });
      }

      throw new MultiplayerRequestError(
        json?.error || responseText || `${functionName} failed`,
        response.status,
        false,
        code,
        json && typeof json === "object" ? json : null,
      );
    }

    return json;
  };
}
