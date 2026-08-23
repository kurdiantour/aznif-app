import { useEffect, useRef } from "react";

import type { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";

export function useOkeyMultiplayerBotController(input: {
  matchId?: string;
  projection: OkeyMatchServerProjection | null;
  adapter: SupabaseOkeyMatchAdapter | null;
}) {
  const inFlightTurnKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const { matchId, projection, adapter } = input;
    if (!matchId || !projection || !adapter) return;
    if (projection.phase !== "playing" || projection.matchFinished) return;

    const player = projection.players[projection.currentPlayerIndex];
    if (!player?.controlledByBot) return;

    const expectedVersion = Number(projection.version);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return;

    const turnKey = `${matchId}:${expectedVersion}:${player.id}`;
    if (inFlightTurnKeysRef.current.has(turnKey)) return;

    inFlightTurnKeysRef.current.add(turnKey);
    void adapter
      .processBotTurn({
        expectedVersion,
        expectedActorId: player.id,
      })
      .catch((error) => {
        console.warn("process_bot_turns Okey failed", error);
      })
      .finally(() => {
        inFlightTurnKeysRef.current.delete(turnKey);
      });
  }, [input.matchId, input.projection, input.adapter]);
}

