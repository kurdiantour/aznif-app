import { supabase } from "@/lib/supabase";

export type OkeyPreviewTestMatchResult = {
  matchId: string;
  status: string;
  resumed: boolean;
};

export async function getOrCreateOkeyPreviewTestMatch(
  reset = false,
): Promise<OkeyPreviewTestMatchResult> {
  const { data, error } = await supabase.functions.invoke("okey_test_match", {
    body: {
      action: reset ? "reset" : "get_or_create",
    },
  });

  if (error) {
    let errorBody: { error?: string; details?: string } | null = null;
    try {
      if ("context" in error && error.context) {
        errorBody = await error.context.json();
      }
    } catch {
      errorBody = null;
    }
    throw new Error(
      errorBody?.details
        ? `${errorBody.error ?? "okey_preview_request_failed"}: ${errorBody.details}`
        : errorBody?.error ?? error.message ?? "okey_preview_request_failed",
    );
  }

  if (!data?.matchId) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "okey_preview_response_invalid",
    );
  }

  return {
    matchId: String(data.matchId),
    status: String(data.status ?? "playing"),
    resumed: Boolean(data.resumed),
  };
}
