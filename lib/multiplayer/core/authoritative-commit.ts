export type AuthoritativeCommitResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "stale"; error: any };

export function isStaleMultiplayerCommitError(error: any): boolean {
  return Boolean(error?.message?.includes("STALE_GAME_STATE"));
}

export async function commitMultiplayerAction<T = any>(
  client: any,
  parameters: Record<string, unknown>,
): Promise<AuthoritativeCommitResult<T>> {
  const { data, error } = await client.rpc(
    "commit_multiplayer_action",
    parameters,
  );

  if (!error) return { ok: true, data };
  if (isStaleMultiplayerCommitError(error)) {
    return { ok: false, kind: "stale", error };
  }
  throw error;
}

export function multiplayerConflictResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}
