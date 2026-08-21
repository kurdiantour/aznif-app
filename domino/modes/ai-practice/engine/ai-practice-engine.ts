import type { AvatarId } from '@/constants/avatars';
import { FULL_DOMINO_SET } from '@/domino/core/constants/domino-set';
import { dealDominoHands } from '@/domino/core/setup/deal';
import { shuffleArray } from '@/domino/core/setup/shuffle';
import type { DominoTileData, Player, TeamId } from '@/domino/types/domino-game';
import { assignDominoBotIdentities } from '@/domino/shared/bot-identity';

export type AiSeatDefinition = {
  id: string;
  name: string;
  avatarId: AvatarId;
  seat: Player['seat'];
  kind: Player['kind'];
  teamId: TeamId;
};

export function createAiPracticeSeats(): AiSeatDefinition[] {
  const botName = assignDominoBotIdentities([
    { id: 'p1', playerIndex: 0 },
    { id: 'p3', playerIndex: 1 },
  ]).get('p3')!.name;
  return [
    {
      id: 'p1',
      name: 'You',
      avatarId: 'avatar-2',
      seat: 'bottom',
      kind: 'human',
      teamId: 'teamA',
    },
    {
      id: 'p3',
      name: botName,
      avatarId: 'bot-avatar',
      seat: 'top',
      kind: 'bot',
      teamId: 'teamB',
    },
  ];
}

export function findAiOpeningDoubleAndStarter(hands: DominoTileData[][]) {
  for (let doubleValue = 6; doubleValue >= 0; doubleValue -= 1) {
    for (let i = 0; i < hands.length; i += 1) {
      const found = hands[i]?.some(
        (tile) => tile.left === doubleValue && tile.right === doubleValue,
      );

      if (found) {
        return {
          starterIndex: i,
          openingDouble: doubleValue,
        };
      }
    }
  }

  return {
    starterIndex: 0,
    openingDouble: null as number | null,
  };
}

export function createAiPracticeDeal(playerCount: number) {
  let nextDeal = dealDominoHands(shuffleArray(FULL_DOMINO_SET), playerCount);

  while (
    !nextDeal.hands.some((hand) =>
      hand.some((tile) => tile.left === 6 && tile.right === 6),
    )
  ) {
    nextDeal = dealDominoHands(shuffleArray(FULL_DOMINO_SET), playerCount);
  }

  return nextDeal;
}
