import { useCallback, useMemo } from "react";

import type { PlayerProfileTarget } from "@/components/game/player-profile-target";
import { mapOkeySettlementToPopupRewards, shouldShowOkeyMatchResultPopup } from "@/okey/components/OkeyMatchResultPopup";
import { getRoundResultScoreDetails } from "@/okey/engine/okey-engine";
import type { OkeyRoundResult } from "@/okey/hooks/useOkeyMultiplayerGame";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyGameState, OkeyPlayer, OkeyTeamId } from "@/okey/types/okey";

export type OkeyRelativeSeat = "bottom" | "right" | "top" | "left";

function getRelativeSeatMap(localPlayerIndex: number): Record<OkeyRelativeSeat, number> {
  const local = ((localPlayerIndex % 4) + 4) % 4;
  return { bottom: local, right: (local + 1) % 4, top: (local + 2) % 4, left: (local + 3) % 4 };
}

export function useOkeyTableViewModel(input: {
  state: OkeyGameState;
  currentUserId: string | null;
  localPreview: boolean;
  onlineProjection: OkeyMatchServerProjection | null;
  presentedTablePlayers: OkeyPlayer[];
  stableOpponentTileCounts: Record<string, number>;
  onlineGameplayReady: boolean;
  turnPlayerIndex: number | null;
  turnPlayerId: string | null;
  turnPhase: string | null;
  turnDeadlineAt: string | null;
  turnDurationSeconds: number | null;
  turnTimeLeftMilliseconds: number;
  serverClockOffsetMs: number;
  currentRoundResult: OkeyRoundResult | null;
  roundResults: OkeyRoundResult[];
  matchScores: Record<OkeyTeamId, number>;
  matchWinnerTeamId: OkeyTeamId | null;
  showMatchResultPopup: boolean;
  matchFinished: boolean;
}) {
  const { state, currentUserId, localPreview, onlineProjection, presentedTablePlayers,
    stableOpponentTileCounts, onlineGameplayReady, turnPlayerIndex, turnPlayerId, turnPhase, turnDeadlineAt,
    turnDurationSeconds, turnTimeLeftMilliseconds, serverClockOffsetMs,
    currentRoundResult, roundResults, matchScores, matchWinnerTeamId, showMatchResultPopup, matchFinished } = input;
  const humanPlayer = useMemo(
    () => state.players.find((player) => player.id === currentUserId) ?? state.players[0],
    [currentUserId, state.players],
  );
  const isHumanTurn = turnPhase === 'playing' && turnPlayerId === humanPlayer.id;
  const localPlayerIndex = useMemo(() => {
    if (!currentUserId) return null;
    const players = localPreview ? state.players : onlineProjection?.players;
    if (!players) return null;
    const index = players.findIndex((player) => player.id === currentUserId);
    return index >= 0 ? index : null;
  }, [currentUserId, localPreview, onlineProjection?.players, state.players]);
  const seatMap = useMemo(() => localPlayerIndex === null ? null : getRelativeSeatMap(localPlayerIndex), [localPlayerIndex]);
  const playerForSeat = useCallback((seat: OkeyRelativeSeat) => {
    if (!seatMap) return null;
    if (localPreview) return state.players[seatMap[seat]] ?? null;
    const projectedPlayer = onlineProjection?.players[seatMap[seat]];
    return projectedPlayer ? state.players.find((player) => player.id === projectedPlayer.id) ?? null : null;
  }, [localPreview, onlineProjection?.players, seatMap, state.players]);
  const opponentSeats = useMemo(() => (["top", "left", "right"] as const).map((side) => {
    const serverIndex = seatMap?.[side] ?? null;
    const player = playerForSeat(side);
    return {
      side, id: player?.id ?? `waiting-${side}`, name: player?.name ?? "",
      count: onlineGameplayReady && player ? stableOpponentTileCounts[player.id] ?? player.hand.length : 0,
      active: onlineGameplayReady && serverIndex !== null && turnPlayerIndex === serverIndex,
      turnTimeLeftMilliseconds, turnDeadlineAt, serverClockOffsetMs, turnDurationSeconds,
      turnTimerPhase: state.hasDrawnThisTurn ? "throw" as const : "draw" as const,
    };
  }), [onlineGameplayReady, playerForSeat, seatMap, serverClockOffsetMs, stableOpponentTileCounts,
    state.hasDrawnThisTurn, turnDeadlineAt, turnDurationSeconds, turnPlayerIndex, turnTimeLeftMilliseconds]);
  const seatOrderedPlayers = useMemo(() => {
    const fallback: Record<OkeyRelativeSeat, OkeyPlayer> = {
      bottom: state.players[0], right: state.players[1], top: state.players[2], left: state.players[3],
    };
    return (["bottom", "top", "left", "right"] as const).map((seat) => playerForSeat(seat) ?? fallback[seat]);
  }, [playerForSeat, state.players]);
  const presentedSeatOrderedPlayers = useMemo(() => seatOrderedPlayers.map((player) =>
    player.id === humanPlayer.id ? player : presentedTablePlayers.find((entry) => entry.id === player.id) ?? player,
  ), [humanPlayer.id, presentedTablePlayers, seatOrderedPlayers]);
  const profileTargetForPlayer = useCallback((playerId: string): PlayerProfileTarget | null => {
    const player = state.players.find((entry) => entry.id === playerId);
    return player ? { id: player.id, name: player.name, avatarId: player.kind === "bot" ? "bot-avatar" : undefined } : null;
  }, [state.players]);
  const playerIdBySeat = useMemo(() => ({
    bottom: playerForSeat("bottom")?.id, right: playerForSeat("right")?.id,
    top: playerForSeat("top")?.id, left: playerForSeat("left")?.id,
  }), [playerForSeat]);
  const viewerTeamId: OkeyTeamId = onlineProjection?.players.find((player) => player.id === currentUserId)?.teamId === "teamB" ? "teamB" : "teamA";
  const opponentTeamId: OkeyTeamId = viewerTeamId === "teamA" ? "teamB" : "teamA";
  const teamScores = { teamA: matchScores[viewerTeamId], teamB: matchScores[opponentTeamId] };
  const displayRoundResults = useMemo(() => roundResults.map((result) => ({
    ...result,
    winnerTeamId: result.winnerTeamId === null ? null : result.winnerTeamId === viewerTeamId ? "teamA" as const : "teamB" as const,
    scoreDetails: { ...result.scoreDetails, scores: { teamA: result.scoreDetails.scores[viewerTeamId], teamB: result.scoreDetails.scores[opponentTeamId] } },
  })), [opponentTeamId, roundResults, viewerTeamId]);
  const playerNamesById = useMemo(() => Object.fromEntries(state.players.map((player) => [player.id, player.name])), [state.players]);
  const computedScoreDetails = useMemo(() => getRoundResultScoreDetails(state), [state]);
  const rawScoreDetails = currentRoundResult?.scoreDetails ?? computedScoreDetails;
  const displayCurrentRoundScoreDetails = useMemo(() => ({ ...rawScoreDetails, scores: {
    teamA: rawScoreDetails.scores[viewerTeamId], teamB: rawScoreDetails.scores[opponentTeamId],
  } }), [opponentTeamId, rawScoreDetails, viewerTeamId]);
  const viewerWon = matchWinnerTeamId === null ? null : matchWinnerTeamId === viewerTeamId;
  const matchSettlementRewards = useMemo(() => mapOkeySettlementToPopupRewards(
    onlineProjection?.settlement, matchWinnerTeamId, viewerTeamId,
  ), [matchWinnerTeamId, onlineProjection?.settlement, viewerTeamId]);
  const shouldRenderMatchResultPopup = shouldShowOkeyMatchResultPopup(showMatchResultPopup, matchFinished, onlineProjection?.settlement);
  return { humanPlayer, isHumanTurn, opponentSeats, seatOrderedPlayers, presentedSeatOrderedPlayers,
    profileTargetForPlayer, playerIdBySeat, viewerTeamId, opponentTeamId, teamScores,
    displayRoundResults, playerNamesById, displayCurrentRoundScoreDetails, viewerWon, matchSettlementRewards, shouldRenderMatchResultPopup };
}