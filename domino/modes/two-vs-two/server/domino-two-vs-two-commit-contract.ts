type CommitBase = {
  roomId: string;
  expectedVersion: number;
  state: any;
  hands: any[];
  boneyard: any[];
  currentTurnPlayerId: string | null;
  status: string | null;
  playerId: string | null;
};

export function buildTwoVsTwoCommit(args: CommitBase & {
  action: string;
  payload: Record<string, unknown>;
}) {
  return {
    p_mode: '2v2',
    p_room_id: args.roomId,
    p_expected_version: args.expectedVersion,
    p_state: args.state,
    p_hands: args.hands,
    p_boneyard: args.boneyard,
    p_current_turn_player_id: args.currentTurnPlayerId,
    p_status: args.status,
    p_player_id: args.playerId,
    p_action: args.action,
    p_payload: args.payload,
  };
}
