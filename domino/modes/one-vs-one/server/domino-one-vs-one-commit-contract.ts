type CommitBase = {
  roomId: string;
  expectedVersion: number;
  state: any;
  hands: any[][];
  boneyard: any[];
  currentTurnPlayerId: string | null;
  status: string | null;
  playerId: string;
};

function base(args: CommitBase) {
  return {
    p_mode: "1v1",
    p_room_id: args.roomId,
    p_expected_version: args.expectedVersion,
    p_state: args.state,
    p_hands: args.hands,
    p_boneyard: args.boneyard,
    p_current_turn_player_id: args.currentTurnPlayerId,
    p_status: args.status,
    p_player_id: args.playerId,
  };
}

export function buildOneVsOneMoveCommit(args: CommitBase & {
  tile: any;
  branch: string | null;
  moveScore: number;
  wasOpeningMove: boolean;
}) {
  return {
    ...base(args),
    p_action: "play_tile",
    p_payload: {
      tile: args.tile,
      branch: args.branch,
      moveScore: args.moveScore,
      wasOpeningMove: args.wasOpeningMove,
    },
  };
}

export function buildOneVsOneDrawCommit(args: CommitBase & {
  action: string;
  currentTurnDrawCount: number;
  timedOut: boolean;
  autoPassed: boolean;
  triggeredByUserId: string;
}) {
  return {
    ...base(args),
    p_action: args.action,
    p_payload: {
      remainingBoneyard: args.boneyard.length,
      currentTurnDrawCount: args.currentTurnDrawCount,
      autoDrawn: args.timedOut,
      autoPassed: args.autoPassed,
      triggeredByUserId: args.triggeredByUserId,
    },
  };
}

export function buildOneVsOnePassCommit(args: CommitBase & {
  timedOut: boolean;
  blockedRoundResolved: boolean;
}) {
  return {
    ...base(args),
    p_action: "pass_turn",
    p_payload: {
      nextPlayerId: args.currentTurnPlayerId,
      timedOut: args.timedOut,
      blockedRoundResolved: args.blockedRoundResolved,
    },
  };
}
