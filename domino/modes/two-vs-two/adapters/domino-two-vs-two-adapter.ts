import type { DominoTileData, KozelBranch } from '@/domino/types/domino-game';

export type DominoTwoVsTwoTurnTimeoutClaim = {
  expectedVersion: number;
  expectedTurnStartedAt: string;
  expectedTurnPlayerId: string;
};

export type DominoTwoVsTwoCommand =
  | { type: 'play'; tile: DominoTileData; branch: KozelBranch }
  | { type: 'pass' }
  | { type: 'timeout-pass'; claim: DominoTwoVsTwoTurnTimeoutClaim };

export type DominoTwoVsTwoSubscription = {
  onRoomInvalidated: (snapshot: unknown) => void;
  onRosterInvalidated: () => void;
  onStatus?: (channel: 'rooms' | 'players', status: string, error?: unknown) => void;
};

export interface DominoTwoVsTwoAdapter {
  getCurrentUserId(): Promise<string | null>;
  getSnapshot(): Promise<any>;
  getRoster(includeProfiles?: boolean): Promise<{ rows: any[]; profiles: any[] | null }>;
  dispatch(command: DominoTwoVsTwoCommand): Promise<any>;
  startNextHand(completedRoundId: string): Promise<any>;
  processBotTurn(): Promise<any>;
  subscribe(observer: DominoTwoVsTwoSubscription): () => void;
}
