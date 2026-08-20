import type { DominoTileData, KozelBranch } from '@/types/game';
import type { TurnTimeoutClaim } from '@/lib/multiplayer/multiplayerApi';

export type DominoTwoVsTwoCommand =
  | { type: 'play'; tile: DominoTileData; branch: KozelBranch }
  | { type: 'pass' }
  | { type: 'timeout-pass'; claim: TurnTimeoutClaim };

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
  processBotTurn(): Promise<any>;
  startNextHand(): Promise<any>;
  subscribe(observer: DominoTwoVsTwoSubscription): () => void;
}
