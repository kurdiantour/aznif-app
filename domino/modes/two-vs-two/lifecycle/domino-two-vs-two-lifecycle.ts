export type DominoTwoVsTwoLifecycle = 'loading' | 'active' | 'round_finished' | 'match_finished';

export function deriveDominoTwoVsTwoLifecycle(state: any): DominoTwoVsTwoLifecycle {
  if (!state) return 'loading';
  if (state.winningTeamId || state.status === 'finished') return 'match_finished';
  if (state.roundWinnerPlayerId) return 'round_finished';
  return 'active';
}

export const canSubmitDominoTwoVsTwoTurn = (state: any) =>
  deriveDominoTwoVsTwoLifecycle(state) === 'active';
