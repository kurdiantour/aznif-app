export type OkeyColor = "red" | "blue" | "black" | "yellow";

export type OkeyJokerOrigin = "natural" | "stolen";

export type OkeyTile = {
  id: string;
  color: OkeyColor;
  value: number;
  copy: 1 | 2;
  isFakeJoker?: boolean;
  jokerOrigin?: OkeyJokerOrigin;
  spentByPlayerId?: string;
};

export type OkeyPlayerKind = "human" | "bot";

export type OkeyBotDifficulty = "easy" | "normal" | "hard";

export type OkeyTeamId = "teamA" | "teamB";

export type OkeyKonkanEntryReason = "discard-pick" | "forced-table-add" | "joker-replacement" | "forced-final-round";

export type OkeyMeldKind = "run" | "set";

export type OkeyMeld = {
  id: string;
  ownerId: string;
  kind: OkeyMeldKind;
  tiles: OkeyTile[];
  score: number;
  locked?: boolean;
  lockedByPlayerId?: string;
  lockedTileId?: string;
  originalOwnerPlayerId?: string;
};

export type OkeyPlayer = {
  id: string;
  name: string;
  kind: OkeyPlayerKind;
  botDifficulty?: OkeyBotDifficulty;
  controlledByBot?: boolean;
  botNumber?: number;
  teamId: OkeyTeamId;
  hand: OkeyTile[];
  opened: boolean;
  melds: OkeyMeld[];
  scoreOpened: number;
  firstOpenScore: number | null;
  konkan: boolean;
  konkanEntryReason: OkeyKonkanEntryReason | null;
  pendingKonkanFromDiscard?: boolean;
  eliminated?: boolean;
};

export type OkeyDrawSource = "deck" | "discard";

export type OkeyGamePhase = "playing" | "finished";

export type OkeyRoundEndReason = "win" | "tile-cycle-limit";

export type OkeyTurnMessage =
  | { code: "discard-tile"; playerName: string }
  | { code: "draw-tile"; playerName: string }
  | { code: "set-locked"; playerName: string }
  | { code: "joker-released"; playerName: string }
  | { code: "tile-added"; playerName: string }
  | { code: "tile-cycle-limit" }
  | { code: "draw-pile-reshuffled"; current: number; maximum: number }
  | { code: "winner"; playerName: string };

export type OkeyDiscardOwner = { playerIndex: number; playerId: string } | null;

export type OkeyGameState = {
  players: OkeyPlayer[];
  stagingMelds: OkeyMeld[];
  teamFirstOpenScores: Record<OkeyTeamId, number | null>;
  currentPlayerIndex: number;
  dealerIndex: number;
  deck: OkeyTile[];
  discardPile: OkeyTile[];
  discardOwners: OkeyDiscardOwner[];
  konkanDiscardPickCounts: Record<string, number>;
  mustFinishAfterSecondKonkanDiscardPickPlayerId: string | null;
  reshuffleCount: number;
  indicatorTile: OkeyTile;
  okeyTile: OkeyTile;
  phase: OkeyGamePhase;
  winnerId: string | null;
  endReason: OkeyRoundEndReason | null;
  turnMessage: OkeyTurnMessage;
  hasDrawnThisTurn: boolean;
};











