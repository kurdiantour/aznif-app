import type { OkeyGameState, OkeyMeld, OkeyTile } from "../types/okey.ts";
import { getCombinations, getEffectiveTile, getMeldScore, getOrderedMeldScore, getOrderedRunWildcardValue, isOkeyWildcard, isValidMeld, sortTiles } from "./okeyengine-melds.ts";
import { OKEY_RULESET_V1 } from "../rules/okey-ruleset-v1.ts";
import { advanceTurn, getTurnMessage, withJokerOrigin, withoutTile } from "./okeyengine-state-utils.ts";
import { getOkeyLockMeldsForCurrentRules, isActiveOkeyPlayer, isEliminatedOkeyPlayer, markOkeyPlayerEliminated } from "./okeyengine-eliminated.ts";

type SpendTarget = { targetPlayerIndex: number; meldIndex: number; tiles: OkeyTile[]; score: number; delta: number; releasedTile?: OkeyTile };
type KonkanSetLockTarget = { targetPlayerIndex: number; meldIndex: number; tiles: OkeyTile[]; score: number };
export type OkeyRunEnd = "start" | "end";
type MeldAddCandidate = { tiles: OkeyTile[]; score: number; insertionIndex: number; runEnd: OkeyRunEnd | null };
export function resolveKonkanDiscardPick(state: OkeyGameState, playerIndex: number, discardOwnerPlayerIndex: number | null): { allowed: boolean; count: number; restricted: boolean; mustFinishPlayerId: string | null } {
  const player = state.players[playerIndex];
  const owner = discardOwnerPlayerIndex === null ? null : state.players[discardOwnerPlayerIndex];
  if (!player || isEliminatedOkeyPlayer(owner)) return { allowed: false, count: 0, restricted: false, mustFinishPlayerId: state.mustFinishAfterSecondKonkanDiscardPickPlayerId };
  const restricted = !!owner?.konkan && owner.id !== player.id && !(player.konkan && owner.konkan);
  const count = state.konkanDiscardPickCounts[player.id] ?? 0;
  if (restricted && count >= OKEY_RULESET_V1.konkan.maximumRestrictedDiscardPicks) return { allowed: false, count, restricted, mustFinishPlayerId: state.mustFinishAfterSecondKonkanDiscardPickPlayerId };
  const nextCount = restricted ? count + 1 : count;
  return { allowed: true, count: nextCount, restricted, mustFinishPlayerId: restricted && (player.opened || nextCount === OKEY_RULESET_V1.konkan.maximumRestrictedDiscardPicks) ? player.id : state.mustFinishAfterSecondKonkanDiscardPickPlayerId };
}

export function getKonkanDiscardEntry(player: OkeyGameState["players"][number], fromDiscard: boolean) {
  const startsPending = fromDiscard && !player.opened && !player.konkan;
  return { pendingKonkanFromDiscard: player.pendingKonkanFromDiscard || startsPending };
}

export function getKonkanDiscardOutcome(player: OkeyGameState["players"][number]) {
  const entersKonkan = !!player.pendingKonkanFromDiscard && !player.opened && !player.konkan;
  return {
    entersKonkan,
    isKonkanFinish: player.konkan || entersKonkan,
    konkan: player.konkan || entersKonkan,
    konkanEntryReason: player.konkanEntryReason ?? (entersKonkan ? "discard-pick" as const : null),
    pendingKonkanFromDiscard: false,
  };
}

function getSpendCandidatePlayerIndexes(state: OkeyGameState, playerIndex: number) {
  const player = state.players[playerIndex];
  if (!player) return [];

  const ownIndexes = [playerIndex];
  const teammateIndexes = state.players
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) =>
      index !== playerIndex &&
      entry.teamId === player.teamId &&
      entry.opened &&
      isActiveOkeyPlayer(entry)
    )
    .map(({ index }) => index);
  const opponentIndexes = state.players
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      entry.teamId !== player.teamId &&
      entry.opened &&
      isActiveOkeyPlayer(entry)
    )
    .map(({ index }) => index);

  return [...ownIndexes, ...teammateIndexes, ...opponentIndexes];
}

function getMeldScoreForKind(kind: OkeyMeld["kind"], tiles: OkeyTile[], okeyTile: OkeyTile) {
  return kind === "run" ? getOrderedMeldScore(tiles, okeyTile) : getMeldScore(tiles, okeyTile);
}

function getMeldWithJokerReplaced(meld: OkeyMeld, tile: OkeyTile, okeyTile: OkeyTile) {
  if (meld.kind !== "run" && meld.kind !== "set") return null;
  if (tile.isFakeJoker || isOkeyWildcard(tile, okeyTile)) return null;

  let best: { tiles: OkeyTile[]; score: number; releasedTile: OkeyTile } | null = null;
  for (let tileIndex = 0; tileIndex < meld.tiles.length; tileIndex += 1) {
    const releasedTile = meld.tiles[tileIndex];
    if (!isOkeyWildcard(releasedTile, okeyTile)) continue;

    const tiles = [
      ...meld.tiles.slice(0, tileIndex),
      tile,
      ...meld.tiles.slice(tileIndex + 1),
    ];
    const score = getMeldScoreForKind(meld.kind, tiles, okeyTile);
    if (score === null) continue;

    if (!best || score > best.score) {
      best = { tiles, score, releasedTile };
    }
  }

  return best;
}
function getMeldAddCandidates(
  meld: OkeyMeld,
  tile: OkeyTile,
  okeyTile: OkeyTile,
): MeldAddCandidate[] {
  if (meld.kind !== "run" && meld.kind !== "set") return [];
  if (meld.locked && (meld.kind !== "run" || !meld.lockedTileId)) return [];

  const lockedTileIndex = meld.lockedTileId
    ? meld.tiles.findIndex((entry) => entry.id === meld.lockedTileId)
    : -1;
  if (meld.locked && lockedTileIndex !== 0 && lockedTileIndex !== meld.tiles.length - 1) return [];

  const candidates =
    meld.kind === "run"
      ? [
          [tile, ...meld.tiles],
          [...meld.tiles, tile],
        ]
      : [[...meld.tiles, tile]];

  const valid: MeldAddCandidate[] = [];

  for (
    let insertionIndex = 0;
    insertionIndex < candidates.length;
    insertionIndex += 1
  ) {
    const addsAtLockedEnd = meld.locked && (
      (lockedTileIndex === 0 && insertionIndex === 0) ||
      (lockedTileIndex === meld.tiles.length - 1 && insertionIndex === 1)
    );
    if (addsAtLockedEnd) continue;

    const tiles = candidates[insertionIndex];
    const score =
      meld.kind === "run"
        ? getOrderedMeldScore(tiles, okeyTile)
        : getMeldScore(tiles, okeyTile);

    if (score === null) continue;

    valid.push({
      tiles,
      score,
      insertionIndex,
      runEnd: meld.kind === "run" ? (insertionIndex === 0 ? "start" : "end") : null,
    });
  }

  return valid;
}

function getMeldWithTileAdded(
  meld: OkeyMeld,
  tile: OkeyTile,
  okeyTile: OkeyTile,
  runEnd?: OkeyRunEnd,
) {
  const valid = getMeldAddCandidates(meld, tile, okeyTile);
  const selected = runEnd
    ? valid.find((candidate) => candidate.runEnd === runEnd) ?? null
    : null;
  if (selected) return selected;
  if (runEnd) return null;

  // Only an ambiguous wildcard-Joker run requires an explicit player choice.
  // Ordinary spends retain their existing automatic resolution.
  if (meld.kind === "run" && isOkeyWildcard(tile, okeyTile) && valid.length > 1) {
    return null;
  }

  let best: MeldAddCandidate | null = null;
  for (const candidate of valid) {
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.insertionIndex > best.insertionIndex)
    ) best = candidate;
  }

  return best;
}

function hasKonkanLock(state: OkeyGameState, playerId: string): boolean {
  return state.players.some((entry) =>
    getOkeyLockMeldsForCurrentRules(entry).some((meld) => meld.locked && meld.lockedByPlayerId === playerId),
  );
}

export function hasPlayerExecutedKonkanSpend(state: OkeyGameState, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.konkan) return false;
  if ((player.konkanSpendsExecuted ?? 0) >= 1) return true;
  if (hasKonkanLock(state, playerId)) return true;
  for (const p of state.players) {
    for (const meld of p.melds) {
      if (meld.tiles.some((tile) => tile.spentByPlayerId === playerId)) {
        return true;
      }
    }
  }
  return false;
}

export function eliminateKonkanPlayerMidTurn(
  state: OkeyGameState,
  playerIndex: number,
  _reason?: "second-spend" | "normal-meld",
): OkeyGameState {
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;

  const eliminatedState = markOkeyPlayerEliminated(state, playerIndex);
  const nextState = advanceTurn(eliminatedState);
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];
  return {
    ...nextState,
    turnMessage: getTurnMessage(nextPlayer?.name ?? "", false),
  };
}

function findBestSpendTarget(state: OkeyGameState, playerIndex: number, tile: OkeyTile, runEnd?: OkeyRunEnd): SpendTarget | null {
  const player = state.players[playerIndex];
  if (!player) return null;
  let firstOrdinaryTarget: SpendTarget | null = null;

  for (const targetPlayerIndex of getSpendCandidatePlayerIndexes(state, playerIndex)) {
    const targetPlayer = state.players[targetPlayerIndex];
    if (!targetPlayer.opened || !isActiveOkeyPlayer(targetPlayer)) continue;

    let bestForPlayer: SpendTarget | null = null;
    for (let meldIndex = 0; meldIndex < targetPlayer.melds.length; meldIndex += 1) {
      const meld = targetPlayer.melds[meldIndex];
      const replaced = getMeldWithJokerReplaced(meld, tile, state.okeyTile);
      if (replaced) {
        const delta = replaced.score - meld.score;
        return { targetPlayerIndex, meldIndex, tiles: replaced.tiles, score: replaced.score, delta, releasedTile: replaced.releasedTile };
      }

      const added = getMeldWithTileAdded(meld, tile, state.okeyTile, meld.kind === "run" ? runEnd : undefined);
      if (!added) continue;

      const delta = added.score - meld.score;
      if (!bestForPlayer || delta > bestForPlayer.delta) {
        bestForPlayer = { targetPlayerIndex, meldIndex, tiles: added.tiles, score: added.score, delta };
      }
    }

    firstOrdinaryTarget ??= bestForPlayer;
  }

  return firstOrdinaryTarget;
}

export function canSpendTileOnBestMeld(state: OkeyGameState, playerIndex: number, tileId: string): boolean {
  if (state.phase !== "playing") return false;
  if (state.currentPlayerIndex !== playerIndex) return false;
  if (!state.hasDrawnThisTurn) return false;
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return false;
  const tile = player.hand.find((entry) => entry.id === tileId);
  return tile ? findBestSpendTarget(state, playerIndex, tile) !== null : false;
}

function findSpecificSpendTarget(
  state: OkeyGameState,
  playerIndex: number,
  tile: OkeyTile,
  targetPlayerId: string,
  targetMeldId: string,
  runEnd?: OkeyRunEnd,
): SpendTarget | null {
  const player = state.players[playerIndex];
  if (!player) return null;

  const allowedIndexes = new Set(getSpendCandidatePlayerIndexes(state, playerIndex));
  const targetPlayerIndex = state.players.findIndex((entry) => entry.id === targetPlayerId);
  if (!allowedIndexes.has(targetPlayerIndex)) return null;

  const targetPlayer = state.players[targetPlayerIndex];
  if (!targetPlayer?.opened || !isActiveOkeyPlayer(targetPlayer)) return null;

  const meldIndex = targetPlayer.melds.findIndex((meld) => meld.id === targetMeldId);
  if (meldIndex < 0) return null;

  const meld = targetPlayer.melds[meldIndex];
  const replaced = getMeldWithJokerReplaced(meld, tile, state.okeyTile);
  if (replaced) {
    return {
      targetPlayerIndex,
      meldIndex,
      tiles: replaced.tiles,
      score: replaced.score,
      delta: replaced.score - meld.score,
      releasedTile: replaced.releasedTile,
    };
  }

  const added = getMeldWithTileAdded(meld, tile, state.okeyTile, runEnd);
  if (!added) return null;

  return {
    targetPlayerIndex,
    meldIndex,
    tiles: added.tiles,
    score: added.score,
    delta: added.score - meld.score,
  };
}

export function canSpendTileOnMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): boolean {
  if (state.phase !== "playing") return false;
  if (state.currentPlayerIndex !== playerIndex) return false;
  if (!state.hasDrawnThisTurn) return false;
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return false;
  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return false;
  return findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId) !== null ||
    findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, "start") !== null ||
    findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, "end") !== null;
}

export function getLockedKonkanSetsForPlayer(state: OkeyGameState, playerId: string): OkeyMeld[] {
  return state.players.flatMap((player) =>
    getOkeyLockMeldsForCurrentRules(player).filter(
      (meld) => meld.locked && meld.lockedByPlayerId === playerId,
    ),
  );
}

function findKonkanSetLockTarget(
  state: OkeyGameState,
  playerIndex: number,
  tile: OkeyTile,
  targetPlayerId: string,
  targetMeldId: string,
  runEnd?: OkeyRunEnd,
): KonkanSetLockTarget | null {
  const player = state.players[playerIndex];
  if (!player?.konkan) return null;

  const targetPlayerIndex = state.players.findIndex((entry) => entry.id === targetPlayerId);
  if (targetPlayerIndex < 0) return null;

  const targetPlayer = state.players[targetPlayerIndex];
  if (!targetPlayer.opened || !isActiveOkeyPlayer(targetPlayer)) return null;
  const meldIndex = targetPlayer.melds.findIndex((meld) => meld.id === targetMeldId);
  if (meldIndex < 0) return null;

  const meld = targetPlayer.melds[meldIndex];
  if (meld.locked || (meld.kind !== "run" && meld.kind !== "set")) return null;
  const added = getMeldWithTileAdded(meld, tile, state.okeyTile, runEnd);
  if (!added) return null;

  return { targetPlayerIndex, meldIndex, tiles: added.tiles, score: added.score };
}

export function canLockKonkanSet(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): boolean {
  if (
    state.phase !== "playing" ||
    state.currentPlayerIndex !== playerIndex ||
    !state.hasDrawnThisTurn
  ) return false;
  const player = state.players[playerIndex];
  const tile = player?.hand.find((entry) => entry.id === tileId);
  if (!isActiveOkeyPlayer(player) || !tile) return false;
  if (findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId) !== null) return true;
  return findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, "start") !== null ||
    findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, "end") !== null;
}

export type OkeyTableMeldAction = {
  type: "lock-konkan" | "spend";
  tileId: string;
  targetPlayerId: string;
  targetMeldId: string;
  runEndOptions: { runEnd: OkeyRunEnd; value: number }[];
};

export function resolveTableMeldAction(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
): OkeyTableMeldAction | null {
  const action = {
    tileId,
    targetPlayerId,
    targetMeldId,
    runEndOptions: [] as { runEnd: OkeyRunEnd; value: number }[],
  };
  const player = state.players[playerIndex];
  const tile = player?.hand.find((entry) => entry.id === tileId);
  const targetPlayer = state.players.find((entry) => entry.id === targetPlayerId);
  const meld = targetPlayer?.melds.find((entry) => entry.id === targetMeldId);
  if (tile && meld?.kind === "run" && isOkeyWildcard(tile, state.okeyTile)) {
    action.runEndOptions = getMeldAddCandidates(meld, tile, state.okeyTile)
      .filter((candidate): candidate is MeldAddCandidate & { runEnd: OkeyRunEnd } => candidate.runEnd !== null)
      .map((candidate) => ({
        runEnd: candidate.runEnd,
        value: getOrderedRunWildcardValue(
          candidate.tiles,
          candidate.runEnd === "start" ? 0 : candidate.tiles.length - 1,
          state.okeyTile,
        ) ?? tile.value,
      }));
  }
  const replacementTarget = tile
    ? findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId)
    : null;
  if (replacementTarget?.releasedTile) {
    return { type: "spend", ...action };
  }
  if (canLockKonkanSet(state, playerIndex, tileId, targetPlayerId, targetMeldId)) {
    return { type: "lock-konkan", ...action };
  }
  return canSpendTileOnMeld(state, playerIndex, tileId, targetPlayerId, targetMeldId)
    ? { type: "spend", ...action }
    : null;
}

export function lockKonkanSet(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
  runEnd?: OkeyRunEnd,
): OkeyGameState {
  if (
    state.phase !== "playing" ||
    state.currentPlayerIndex !== playerIndex ||
    !state.hasDrawnThisTurn
  ) return state;
  const player = state.players[playerIndex];
  const tile = player?.hand.find((entry) => entry.id === tileId);
  if (!isActiveOkeyPlayer(player) || !tile) return state;

  const target = findKonkanSetLockTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, runEnd);
  if (!target) return state;

  if (player.konkan && hasPlayerExecutedKonkanSpend(state, player.id)) {
    return eliminateKonkanPlayerMidTurn(state, playerIndex, "second-spend");
  }

  const nextHand = withoutTile(player.hand, tileId);
  return {
    ...state,
    players: state.players.map((entry, index) => {
      const nextMelds = index === target.targetPlayerIndex
        ? entry.melds.map((meld, meldIndex) =>
            meldIndex === target.meldIndex
              ? {
                  ...meld,
                  tiles: target.tiles,
                  score: target.score,
                  locked: true,
                  lockedByPlayerId: player.id,
                  lockedTileId: tile.id,
                  originalOwnerPlayerId: meld.ownerId || entry.id,
                }
              : meld,
          )
        : entry.melds;

      if (index === playerIndex) {
        return {
          ...entry,
          hand: sortTiles(nextHand, state.okeyTile),
          melds: nextMelds,
          konkanSpendsExecuted: (entry.konkanSpendsExecuted ?? 0) + 1,
        };
      }
      if (index === target.targetPlayerIndex) {
        return {
          ...entry,
          melds: nextMelds,
        };
      }
      return entry;
    }),
    turnMessage: { code: "set-locked", playerName: player.name },
  };
}


function spendTileOnTarget(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  target: SpendTarget,
): OkeyGameState {
  const player = state.players[playerIndex];
  const isJokerReplacement = Boolean(target.releasedTile);
  const isRealSpend = !isJokerReplacement;
  const locksKonkanSpend = isRealSpend && player.konkan;
  const spentTiles = target.tiles.map((tile) =>
    tile.id === tileId && isRealSpend ? { ...tile, spentByPlayerId: player.id } : tile,
  );
  const spentHand = withoutTile(player.hand, tileId);
  const nextHand = target.releasedTile
    ? [...spentHand, withJokerOrigin(target.releasedTile, state.okeyTile, "stolen")]
    : spentHand;
  const nextPlayers = state.players.map((entry, index) => {
    const nextMelds = index === target.targetPlayerIndex
      ? entry.melds.map((meld, meldIndex) =>
          meldIndex === target.meldIndex
            ? {
                ...meld,
                tiles: spentTiles,
                score: target.score,
                ...(locksKonkanSpend
                  ? {
                      locked: true,
                      lockedByPlayerId: player.id,
                      lockedTileId: tileId,
                      originalOwnerPlayerId: meld.ownerId || entry.id,
                    }
                  : {}),
              }
            : meld,
        )
      : entry.melds;

    if (index === playerIndex) {
      const entersKonkan = !player.opened;
      return {
        ...entry,
        hand: sortTiles(nextHand, state.okeyTile),
        melds: nextMelds,
        konkan: entry.konkan || entersKonkan,
        konkanEntryReason: entry.konkanEntryReason ?? (entersKonkan
          ? target.releasedTile ? "joker-replacement" : "forced-table-add"
          : null),
        konkanSpendsExecuted: isRealSpend && (entry.konkan || entersKonkan)
          ? (entry.konkanSpendsExecuted ?? 0) + 1
          : (entry.konkanSpendsExecuted ?? 0),
      };
    }

    if (index === target.targetPlayerIndex) {
      return {
        ...entry,
        melds: nextMelds,
      };
    }

    return entry;
  });

  const nextState: OkeyGameState = {
    ...state,
    players: nextPlayers,
    turnMessage: target.releasedTile
      ? { code: "joker-released", playerName: player.name }
      : { code: "tile-added", playerName: player.name },
  };

  return nextState;
}

export function spendTileOnMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  targetPlayerId: string,
  targetMeldId: string,
  runEnd?: OkeyRunEnd,
): OkeyGameState {
  if (state.phase !== "playing") return state;
  if (state.currentPlayerIndex !== playerIndex) return state;
  if (!state.hasDrawnThisTurn) return state;
  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;
  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;
  const target = findSpecificSpendTarget(state, playerIndex, tile, targetPlayerId, targetMeldId, runEnd);
  if (!target) return state;

  if (!target.releasedTile && player.konkan && hasPlayerExecutedKonkanSpend(state, player.id)) {
    return eliminateKonkanPlayerMidTurn(state, playerIndex, "second-spend");
  }

  return spendTileOnTarget(state, playerIndex, tileId, target);
}
export function spendTileOnBestMeld(
  state: OkeyGameState,
  playerIndex: number,
  tileId: string,
  runEnd?: OkeyRunEnd,
): OkeyGameState {
  if (state.phase !== "playing") return state;
  if (state.currentPlayerIndex !== playerIndex) return state;
  if (!state.hasDrawnThisTurn) return state;

  const player = state.players[playerIndex];
  if (!isActiveOkeyPlayer(player)) return state;

  const tile = player.hand.find((entry) => entry.id === tileId);
  if (!tile) return state;

  const target = findBestSpendTarget(state, playerIndex, tile, runEnd);
  if (!target) return state;

  if (!target.releasedTile && player.konkan && hasPlayerExecutedKonkanSpend(state, player.id)) {
    return eliminateKonkanPlayerMidTurn(state, playerIndex, "second-spend");
  }

  return spendTileOnTarget(state, playerIndex, tileId, target);
}
function isOfficialKonkanRun(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length !== OKEY_RULESET_V1.konkan.officialRunSize) return false;

  const regularTiles = tiles
    .filter((tile) => !isOkeyWildcard(tile, okeyTile))
    .map((tile) => getEffectiveTile(tile, okeyTile));
  const wildcardCount = tiles.length - regularTiles.length;
  if (!regularTiles.length) return false;

  const color = regularTiles[0].color;
  if (!regularTiles.every((tile) => tile.color === color)) return false;

  const values = regularTiles.map((tile) => tile.value);
  if (new Set(values).size !== values.length) return false;

  const patterns = OKEY_RULESET_V1.konkan.officialRunPatterns;

  return patterns.some((pattern) => {
    const allRegularFit = values.every((value) => pattern.some((entry) => entry === value));
    if (!allRegularFit) return false;

    const missingCount = pattern.filter((value) => !values.includes(value)).length;
    return missingCount === wildcardCount;
  });
}

export function isOrderedOfficialKonkanRun(tiles: OkeyTile[], okeyTile: OkeyTile): boolean {
  if (tiles.length !== OKEY_RULESET_V1.konkan.officialRunSize) return false;
  const regularTiles = tiles.filter((tile) => !isOkeyWildcard(tile, okeyTile));
  if (!regularTiles.length) return false;
  const color = getEffectiveTile(regularTiles[0], okeyTile).color;
  if (!regularTiles.every((tile) => getEffectiveTile(tile, okeyTile).color === color)) return false;
  const allPatterns = [
    ...OKEY_RULESET_V1.konkan.officialRunPatterns,
    ...OKEY_RULESET_V1.konkan.officialRunPatterns.map((pattern) => [...pattern].reverse()),
  ];
  return allPatterns.some((pattern) =>
    tiles.every((tile, index) => isOkeyWildcard(tile, okeyTile) || getEffectiveTile(tile, okeyTile).value === pattern[index]),
  );
}

export function hasSmallKonkanMeld(
  tiles: OkeyTile[],
  okeyTile: OkeyTile,
  minSize: number = OKEY_RULESET_V1.konkan.completionMeldMinimumSize,
): boolean {
  for (
    let size = minSize;
    size <= OKEY_RULESET_V1.konkan.completionMeldMaximumSize;
    size += 1
  ) {
    const combinations = getCombinations(tiles, size);
    if (combinations.some((candidate) => isValidMeld(candidate, okeyTile))) return true;
  }
  return false;
}

export function hasLockedKonkanSet(melds: OkeyMeld[] = [], okeyTile?: OkeyTile): boolean {
  return melds.some(
    (meld) =>
      Boolean(meld.locked) &&
      meld.tiles.length >= OKEY_RULESET_V1.meld.minimumSize,
  );
}

export function canDeclareKonkanWin(hand: OkeyTile[], okeyTile: OkeyTile, lockedSets: OkeyMeld[] = []): boolean {
  const hasLockedSet = hasLockedKonkanSet(lockedSets, okeyTile);
  const requiredHandSize = hasLockedSet
    ? OKEY_RULESET_V1.konkan.officialRunSize + OKEY_RULESET_V1.konkan.completionMeldMinimumSize
    : OKEY_RULESET_V1.konkan.officialRunSize + OKEY_RULESET_V1.konkan.completionMeldMaximumSize;
  if (hand.length < requiredHandSize) return false;

  const requiredMeldMinSize = hasLockedSet
    ? OKEY_RULESET_V1.konkan.completionMeldMinimumSize
    : OKEY_RULESET_V1.konkan.completionMeldMaximumSize;

  const indexedTiles = hand.map((tile, index) => ({ tile, index }));
  const runCandidates = getCombinations(indexedTiles, OKEY_RULESET_V1.konkan.officialRunSize);

  return runCandidates.some((candidate) => {
    const runTiles = candidate.map((entry) => entry.tile);
    if (!isOfficialKonkanRun(runTiles, okeyTile)) return false;

    const runIndexes = new Set(candidate.map((entry) => entry.index));
    const remainingTiles = hand.filter((_, index) => !runIndexes.has(index));
    return hasSmallKonkanMeld(remainingTiles, okeyTile, requiredMeldMinSize);
  });
}

export function canDeclareKonkanOpen(
  state: OkeyGameState,
  playerIndex: number,
  orderedRunTileIds: string[] = [],
  completionMeldTileIds?: string[],
  discardTileId?: string,
): boolean {
  if (
    state.phase !== "playing" ||
    state.currentPlayerIndex !== playerIndex ||
    !state.hasDrawnThisTurn
  ) return false;
  const player = state.players[playerIndex];
  if (!player?.konkan || !isActiveOkeyPlayer(player)) return false;
  if (!Array.isArray(completionMeldTileIds) || typeof discardTileId !== "string") return false;
  if (orderedRunTileIds.length !== OKEY_RULESET_V1.konkan.officialRunSize) return false;

  const hasLockedSet = hasLockedKonkanSet(getLockedKonkanSetsForPlayer(state, player.id), state.okeyTile);
  const allowedCompletionSizes = hasLockedSet
    ? [OKEY_RULESET_V1.konkan.completionMeldMinimumSize, OKEY_RULESET_V1.konkan.completionMeldMaximumSize]
    : [OKEY_RULESET_V1.konkan.completionMeldMaximumSize];
  if (!allowedCompletionSizes.some((size) => size === completionMeldTileIds.length)) return false;

  const submittedIds = [...orderedRunTileIds, ...completionMeldTileIds, discardTileId];
  if (new Set(submittedIds).size !== submittedIds.length || submittedIds.length !== player.hand.length) return false;
  const tileById = new Map(player.hand.map((tile) => [tile.id, tile]));
  if (submittedIds.some((tileId) => !tileById.has(tileId))) return false;

  const orderedRun = orderedRunTileIds.map((tileId) => tileById.get(tileId) as OkeyTile);
  if (!isOrderedOfficialKonkanRun(orderedRun, state.okeyTile)) return false;
  const completionMeld = completionMeldTileIds.map((tileId) => tileById.get(tileId) as OkeyTile);
  if (getOrderedMeldScore(completionMeld, state.okeyTile) === null) return false;

  return player.hand.every((tile) => submittedIds.includes(tile.id));
}

export function declareKonkanOpen(
  state: OkeyGameState,
  playerIndex: number,
  orderedRunTileIds: string[] = [],
  completionMeldTileIds?: string[],
  discardTileId?: string,
): OkeyGameState {
  if (!canDeclareKonkanOpen(
    state,
    playerIndex,
    orderedRunTileIds,
    completionMeldTileIds,
    discardTileId,
  )) return state;
  const player = state.players[playerIndex];
  const finalDiscardTile = player.hand.find((tile) => tile.id === discardTileId);
  if (!finalDiscardTile) return state;

  const nextHand = withoutTile(player.hand, finalDiscardTile.id);
  const nextPlayers = state.players.map((entry, index) =>
    index === playerIndex
      ? {
          ...entry,
          hand: sortTiles(nextHand, state.okeyTile),
        }
      : entry,
  );

  return {
    ...state,
    players: nextPlayers,
    discardPile: [...state.discardPile, finalDiscardTile],
    discardOwners: [...state.discardOwners, { playerIndex, playerId: player.id }],
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    phase: "finished",
    winnerId: player.id,
    endReason: "win",
    turnMessage: { code: "winner", playerName: player.name },
  };
}