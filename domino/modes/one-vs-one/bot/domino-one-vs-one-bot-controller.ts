import { commitMultiplayerAction } from "../../../../lib/multiplayer/core/authoritative-commit.ts";
import {
  reduceDominoOneVsOneBotTurn,
  type DominoOneVsOneBotRules,
} from "./domino-one-vs-one-bot-engine.ts";

export async function processDominoOneVsOneBotTurn(args: {
  client: any;
  room: any;
  state: any;
  hands: any[][];
  boneyard: any[];
  players: any[];
  playerIndex: number;
  currentTurnPlayerId: string;
  rules: DominoOneVsOneBotRules;
}): Promise<
  | { ok: true; action: string; state: any; updatedRoom: any }
  | { ok: false; reason: "stale" }
> {
  const transition = reduceDominoOneVsOneBotTurn(args);
  const commit = await commitMultiplayerAction(args.client, {
    p_mode: "1v1",
    p_room_id: args.room.id,
    p_expected_version: args.room.version,
    p_state: transition.nextState,
    p_hands: transition.nextHands,
    p_boneyard: transition.nextBoneyard,
    p_current_turn_player_id:
      transition.nextState.currentTurnPlayerId ?? transition.nextPlayerId,
    p_status: null,
    p_player_id: args.currentTurnPlayerId,
    p_action: transition.action,
    p_payload: transition.payload,
  });
  if (!commit.ok) return { ok: false, reason: "stale" };

  if (transition.nextState.roundWinnerPlayerId) {
    const { data: forfeit, error: forfeitError } = await args.client.rpc(
      "resolve_one_vs_one_round_leave_forfeits",
      { p_room_id: args.room.id },
    );
    if (forfeitError) throw forfeitError;

    if (!forfeit?.forfeit && transition.nextState.winningTeamId) {
      const { error: finishError } = await args.client
        .from("one_vs_one_rooms")
        .update({ status: "finished", current_turn_player_id: null })
        .eq("id", args.room.id);
      if (finishError) throw finishError;
      const { error: rewardError } = await args.client.rpc(
        "domino_settle_match",
        { p_mode: "1v1", p_room_id: args.room.id },
      );
      if (rewardError) throw rewardError;
    }
  }

  return {
    ok: true,
    action: transition.action,
    state: transition.nextState,
    updatedRoom: commit.data,
  };
}
