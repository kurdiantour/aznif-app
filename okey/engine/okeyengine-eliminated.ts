import type { OkeyGameState, OkeyMeld, OkeyPlayer, OkeyTeamId, OkeyTile } from "../types/okey.ts";

/** Existing burn ownership rule: the seat stays in turn order. */
export function isEliminatedOkeyPlayer(player: Pick<OkeyPlayer, "eliminated"> | null | undefined): boolean {
  return Boolean(player?.eliminated);
}

export function isActiveOkeyPlayer(player: OkeyPlayer | null | undefined): player is OkeyPlayer {
  return Boolean(player && !player.eliminated);
}

export function isGhostOkeySeat(player: OkeyPlayer | null | undefined): boolean {
  return isEliminatedOkeyPlayer(player);
}

/** Burned turns keep the drawn tile in hand and discard an older hand tile. */
export function chooseOkeyEliminatedTurnDiscardTile(
  player: Pick<OkeyPlayer, "hand">,
  drawnTile: OkeyTile,
): OkeyTile {
  return player.hand[0] ?? drawnTile;
}

/** Mark the player only; callers retain the existing turn-advance behavior. */
export function markOkeyPlayerEliminated(state: OkeyGameState, playerIndex: number): OkeyGameState {
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;
  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === playerIndex ? { ...entry, eliminated: true } : entry,
    ),
  };
}

/** A burned opener no longer raises the opposing team's opening threshold. */
export function getOkeyTeamFirstOpenScoreForCurrentRules(state: OkeyGameState, teamId: OkeyTeamId): number | null {
  const score = state.teamFirstOpenScores[teamId] ?? null;
  if (score === null) return null;

  const firstOpenOwner = state.players.find((player) =>
    player.teamId === teamId && player.firstOpenScore === score,
  );
  if (!firstOpenOwner || !isEliminatedOkeyPlayer(firstOpenOwner)) return score;

  return state.players.find((player) =>
    player.teamId === teamId && isActiveOkeyPlayer(player) && player.opened && player.firstOpenScore !== null,
  )?.firstOpenScore ?? null;
}

export function hasOkeyTeammateOpenedForCurrentRules(state: OkeyGameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  if (!player) return false;
  return state.players.some((entry, index) =>
    index !== playerIndex && entry.teamId === player.teamId && isActiveOkeyPlayer(entry) && entry.opened,
  );
}

/** Current lock queries include burned owners' melds; this preserves behavior. */
export function getOkeyLockMeldsForCurrentRules(player: OkeyPlayer): OkeyMeld[] {
  return player.melds;
}

/** Current reshuffle excludes burned owners' complete sets. */
export function getOkeyRecyclableMeldsForCurrentRules(player: OkeyPlayer): OkeyMeld[] {
  return isActiveOkeyPlayer(player) ? player.melds : [];
}
