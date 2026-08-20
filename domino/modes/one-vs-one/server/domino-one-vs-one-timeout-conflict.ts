import type { AuthoritativeCommitResult } from "../../../../lib/multiplayer/core/authoritative-commit.ts";
import { multiplayerConflictResponse } from "../../../../lib/multiplayer/core/authoritative-commit.ts";
import { loadDominoOneVsOneRoom } from "./domino-one-vs-one-server-context.ts";

type TimeoutCode = "stale_timeout" | "already_processed";

export async function reconcileDominoOneVsOneCommit<T>(args: {
  client: any;
  commit: AuthoritativeCommitResult<T>;
  timedOut: boolean;
  roomId: string;
  expectedVersion: number;
  originalRoom: any;
  alreadyProcessedMessage: string;
  staleMessage: string;
  timeoutResponse: (code: TimeoutCode, message: string, room: any) => Response;
}): Promise<{ ok: true; updatedRoom: T } | { ok: false; response: Response }> {
  if (args.commit.ok) return { ok: true, updatedRoom: args.commit.data };

  if (!args.timedOut) {
    return {
      ok: false,
      response: multiplayerConflictResponse("Stale 1v1 state, please retry"),
    };
  }

  const { data: latestRoom, error } = await loadDominoOneVsOneRoom(
    args.client,
    args.roomId,
  );
  if (error) throw error;

  if (latestRoom && Number(latestRoom.version) > args.expectedVersion) {
    return {
      ok: false,
      response: args.timeoutResponse(
        "already_processed",
        args.alreadyProcessedMessage,
        latestRoom,
      ),
    };
  }

  return {
    ok: false,
    response: args.timeoutResponse(
      "stale_timeout",
      args.staleMessage,
      latestRoom ?? args.originalRoom,
    ),
  };
}
