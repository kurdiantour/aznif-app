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
  let state = args.state;
  let hands = args.hands;
  let boneyard = args.boneyard;
  let expectedVersion = Number(args.room.version);
  let transition = reduceDominoOneVsOneBotTurn({ ...args, state, hands, boneyard });
  let updatedRoom: any = null;

  // A takeover bot owns its complete server turn. One turn can contain at most
  // three draws followed by a play; keeping the bounded loop here prevents a
  // departed player's client (or a Realtime refresh) from being required to
  // resume an otherwise valid authoritative turn.
  for (let actionCount = 0; actionCount < 5; actionCount += 1) {
    const commit = await commitMultiplayerAction(args.client, {
      p_mode: "1v1",
      p_room_id: args.room.id,
      p_expected_version: expectedVersion,
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

    updatedRoom = commit.data;
    state = transition.nextState;
    hands = transition.nextHands;
    boneyard = transition.nextBoneyard;

    if (
      state.roundWinnerPlayerId ||
      state.winningTeamId ||
      state.currentTurnPlayerId !== args.currentTurnPlayerId
    ) break;

    expectedVersion = Number(updatedRoom?.version ?? expectedVersion + 1);
    transition = reduceDominoOneVsOneBotTurn({
      ...args,
      state,
      hands,
      boneyard,
    });
  }

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
    updatedRoom,
  };
}