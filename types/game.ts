export type PlayerSeatPosition = "bottom" | "left" | "top" | "right";
export type PlayerKind = "human" | "bot";
export type TeamId = "teamA" | "teamB";
export type GameMode = "1v1" | "2v2";

import type { AvatarId } from "@/constants/avatars";

export type MatchReward = {
  coin: number;
  gem: number;
  points: number;
};

export type Player = {
  id: string;
  name: string;
  seat: PlayerSeatPosition;
  kind: PlayerKind;
  teamId: TeamId;
  isActive: boolean;
  timeLeft: number;
  tileCount: number;
  score: number;
  isLeader: boolean;
  avatarId?: AvatarId;
  level?: number;
  points?: number;
};

export type DominoTileData = {
  id: string;
  left: number;
  right: number;
  imageKey: string;
};

export type KozelBranch = "up" | "right" | "down" | "left";

export type BoardPlacedTile = DominoTileData & {
  branch: KozelBranch;
  order: number;

  /**
   * The pip value that touches the existing board path.
   * Example: if 6-0 is placed on an open 0, connectedValue = 0.
   */
  connectedValue: number;

  /**
   * The pip value that remains open after placement.
   * Example: if 6-0 is placed on an open 0, outwardValue = 6.
   */
  outwardValue: number;
};

export type BoardBranchState = {
  branch: KozelBranch;
  tiles: BoardPlacedTile[];
  openValue: number | null;
  blocked: boolean;
};

export type KozelBoardState = {
  centerTile: DominoTileData | null;
  branches: Record<KozelBranch, BoardBranchState>;
};

export type TeamScore = {
  teamId: TeamId;
  name: string;
  score: number;
};

export type ScoringEvent = {
  playerId: string;
  teamId: TeamId;
  points: number;
  openEndsTotal: number;
};

export type RoundPhase =
  | "playing"
  | "round_result_reveal"
  | "next_round_countdown"
  | "dealing";

export type RoundResult = {
  winnerId?: string;
  winnerTeam?: TeamId;
  endReason?: "blocked" | "empty_hand";
  awardedPoints: number;
  remainingTilesByPlayer: Record<string, DominoTileData[]>;
  remainingPipsByPlayer: Record<string, number>;
};

export type GameState = {
  players: Player[];
  currentTurnPlayerId: string;

  board: KozelBoardState;
  myHand: DominoTileData[];
  boneyardCount: number;
  mode: GameMode;

  roundWinnerPlayerId: string | null;
  lastPlayedTile: DominoTileData | null;
  lastScoringEvent: ScoringEvent | null;
  /** Points awarded for tiles left in the opponents' hands. */
  endOfHandScoringEvent?: ScoringEvent | null;

  teamScores: Record<TeamId, number>;
  winningTeamId: TeamId | null;
  matchReward?: MatchReward | null;

  leaderPlayerId: string;
  isFirstRound: boolean;

  phase?: RoundPhase;
  roundResult?: RoundResult | null;
  nextRoundCountdown?: number;

  availableBranchesForTile: (tile: DominoTileData) => KozelBranch[];
  playTile: (tile: DominoTileData, branch?: KozelBranch) => boolean;
};
