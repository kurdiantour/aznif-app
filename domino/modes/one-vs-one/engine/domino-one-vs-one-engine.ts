export type DominoPipTile = Readonly<{ left: number; right: number }>;

export const DOMINO_ONE_VS_ONE_RULES = Object.freeze({
  playerCount: 2,
  maximumHumanDrawsPerTurn: 3,
  turnDurationMs: 20_000,
  teamByPlayerIndex: ["teamA", "teamB"] as const,
});

export type DominoOneVsOneHandResult = Readonly<{
  winnerIndex: 0 | 1;
  loserIndex: 0 | 1;
  remainingPips: number;
  awardedPoints: number;
}>;

export function handPips(hand: readonly DominoPipTile[]): number {
  return hand.reduce((sum, tile) => sum + tile.left + tile.right, 0);
}

export function roundScore(value: number): number {
  return Math.round(value / 5) * 5;
}

export function resolveEmptyHand(
  hands: readonly (readonly DominoPipTile[])[],
  winnerIndex: 0 | 1,
): DominoOneVsOneHandResult {
  assertTwoHands(hands);
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const remainingPips = handPips(hands[loserIndex]);
  return { winnerIndex, loserIndex, remainingPips, awardedPoints: roundScore(remainingPips) };
}

/** Production parity: player index 0 wins an equal-pip blocked hand. */
export function resolveBlockedHand(
  hands: readonly (readonly DominoPipTile[])[],
): DominoOneVsOneHandResult {
  assertTwoHands(hands);
  const winnerIndex: 0 | 1 = handPips(hands[0]) <= handPips(hands[1]) ? 0 : 1;
  return resolveEmptyHand(hands, winnerIndex);
}

export function shouldOfferDraw(input: Readonly<{
  boardStarted: boolean;
  roundFinished: boolean;
  matchFinished: boolean;
  handHasPlayableTile: boolean;
  boneyardHasPlayableTile: boolean;
  boneyardCount: number;
}>): boolean {
  return input.boardStarted && !input.roundFinished && !input.matchFinished &&
    !input.handHasPlayableTile && input.boneyardHasPlayableTile && input.boneyardCount > 0;
}

export function canDrawOneVsOne(input: Readonly<{
  boardStarted: boolean;
  roundFinished: boolean;
  matchFinished: boolean;
  handHasPlayableTile: boolean;
  boneyardCount: number;
  currentTurnDrawCount: number;
}>): boolean {
  return (
    input.boardStarted &&
    !input.roundFinished &&
    !input.matchFinished &&
    !input.handHasPlayableTile &&
    input.boneyardCount > 0 &&
    input.currentTurnDrawCount < DOMINO_ONE_VS_ONE_RULES.maximumHumanDrawsPerTurn
  );
}

export function resolveOneVsOneDrawProgress(input: Readonly<{
  nextTurnDrawCount: number;
  hasPlayableTileAfterDraw: boolean;
  remainingBoneyardCount: number;
}>): Readonly<{
  shouldAutoPass: boolean;
  stillNeedsDraw: boolean;
  storedTurnDrawCount: number;
}> {
  const shouldAutoPass =
    !input.hasPlayableTileAfterDraw &&
    (input.nextTurnDrawCount >= DOMINO_ONE_VS_ONE_RULES.maximumHumanDrawsPerTurn ||
      input.remainingBoneyardCount === 0);
  const stillNeedsDraw =
    !shouldAutoPass &&
    !input.hasPlayableTileAfterDraw &&
    input.remainingBoneyardCount > 0;

  return {
    shouldAutoPass,
    stillNeedsDraw,
    storedTurnDrawCount: shouldAutoPass ? 0 : input.nextTurnDrawCount,
  };
}
function assertTwoHands(
  hands: readonly (readonly DominoPipTile[])[],
): asserts hands is readonly [readonly DominoPipTile[], readonly DominoPipTile[]] {
  if (hands.length !== DOMINO_ONE_VS_ONE_RULES.playerCount) {
    throw new Error("domino_1v1_requires_exactly_two_hands");
  }
}
