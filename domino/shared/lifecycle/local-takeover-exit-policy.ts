export type DominoTakeoverRosterSeat = {
  user_id?: string | null;
  bot_takeover?: boolean | null;
};

/**
 * Shared Domino lifecycle rule: once a human's own seat is bot-controlled,
 * that human client no longer belongs on the active Game Screen.
 */
export function shouldExitLocalHumanAfterTakeover(
  currentUserId: string | null,
  roster: readonly DominoTakeoverRosterSeat[],
): boolean {
  if (!currentUserId) return false;
  return roster.some(
    (seat) => seat.user_id === currentUserId && seat.bot_takeover === true,
  );
}