import type { AvatarId } from '@/types/avatar';

import type { DamaPieceColor } from './mock-position';

export type DamaPlayerView = {
  id: string;
  username: string;
  avatarId?: AvatarId;
  avatarUrl?: string;
  pieceColor: DamaPieceColor;
  secondsRemaining: number;
  capturedCount: number;
  isCurrentTurn: boolean;
};

export const MOCK_DAMA_PLAYERS: Readonly<{
  self: DamaPlayerView;
  opponent: DamaPlayerView;
}> = {
  self: {
    id: 'local-player',
    username: 'AlexR',
    avatarId: 'avatar-2',
    pieceColor: 'cream',
    secondsRemaining: 154,
    capturedCount: 2,
    isCurrentTurn: true,
  },
  opponent: {
    id: 'opponent',
    username: 'Maya_k',
    avatarId: 'avatar-3',
    pieceColor: 'black',
    secondsRemaining: 117,
    capturedCount: 1,
    isCurrentTurn: false,
  },
};
