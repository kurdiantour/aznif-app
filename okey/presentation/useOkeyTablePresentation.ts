import type { OkeyRoomSnapshot } from "@/okey/multiplayer/okey-room-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

import type { PlayerProfileTarget } from "@/components/game/player-profile-target";
import type { OkeyPresentationSource } from "@/okey/adapters/okey-match-adapter";
import { mapOkeySettlementToPopupRewards, shouldShowOkeyMatchResultPopup } from "@/okey/components/OkeyMatchResultPopup";
import { getRoundResultScoreDetails } from "@/okey/engine/okey-engine";
import type { OkeyRoundResult } from "@/okey/hooks/useOkeyMultiplayerGame";
import type { MeldOffset } from "@/okey/presentation/okey-game-presentation";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import type { OkeyGameState, OkeyMeld, OkeyPlayer, OkeyTeamId, OkeyTile } from "@/okey/types/okey";

/** Local, disposable UI state. Nothing returned by this hook is authoritative. */
export function useOkeyTablePresentation() {
  const [konkanRevealData, setKonkanRevealData] = useState<{
    visible: boolean;
    runTiles: OkeyTile[];
    completionMeldTiles: OkeyTile[];
  }>({ visible: false, runTiles: [], completionMeldTiles: [] });
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [openableRackMelds, setOpenableRackMelds] = useState<{
    melds: OkeyMeld[];
    score: number;
    contiguousGroups: OkeyTile[][];
  }>({ melds: [], score: 0, contiguousGroups: [] });
  const [droppedMelds, setDroppedMelds] = useState<OkeyMeld[]>([]);
  const [pendingNormalMeld, setPendingNormalMeld] = useState<{
    meld: OkeyMeld;
    signature: string;
    tileIds: string[];
  } | null>(null);
  const [localDragCommittedMeldSignatures, setLocalDragCommittedMeldSignatures] = useState<string[]>([]);
  const [tableMeldOffsets, setTableMeldOffsets] = useState<Record<string, MeldOffset>>({});
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [showDiscardHistory, setShowDiscardHistory] = useState(false);
  const [showFinalTileCelebration, setShowFinalTileCelebration] = useState(false);
  const [turnWarningToastVisible, setTurnWarningToastVisible] = useState(false);
  const [dealOrigin, setDealOrigin] = useState<{ x: number; y: number } | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<PlayerProfileTarget | null>(null);
  const [discardDropPlacement, setDiscardDropPlacement] = useState<{
    tileId: string;
    point: { x: number; y: number };
    nonce: number;
  } | null>(null);
  const [optimisticRackTile, setOptimisticRackTile] = useState<OkeyTile | null>(null);
  const [isDiscardDragActive, setIsDiscardDragActive] = useState(false);
  const [hoveredMeldTarget, setHoveredMeldTarget] = useState<{ playerId: string; meldId: string } | null>(null);
  const pendingDrawRef = useRef<{
    tileId: string;
    source: "deck" | "discard";
  } | null>(null);

  const closeKonkanReveal = useCallback(() => {
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
  }, []);  const showKonkanReveal = useCallback((runTiles: OkeyTile[], completionMeldTiles: OkeyTile[]) => {
    setKonkanRevealData({ visible: true, runTiles, completionMeldTiles });
  }, []);
  const completeKonkanRevealEntrance = useCallback(() => {
    setShowFinalTileCelebration(false);
  }, []);
  const resetPresentationOverlays = useCallback(() => {
    setShowScoreDetails(false);
    setShowDiscardHistory(false);
    setShowFinalTileCelebration(false);
    setTurnWarningToastVisible(false);
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
    setProfilePlayer(null);
  }, []);
  const finishKonkanReveal = useCallback((complete: () => void) => {
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
    complete();
  }, []);
  const finishFinalTilePresentation = useCallback((complete: () => void) => {
    setShowFinalTileCelebration(false);
    complete();
  }, []);
  const moveTableMeld = useCallback((_playerId: string, meldId: string, offset: MeldOffset) => {
    setTableMeldOffsets((current) => ({ ...current, [meldId]: offset }));
  }, []);
  const removeStagedMeld = useCallback((meldId: string) => {
    setDroppedMelds((current) => current.filter((entry) => entry.id !== meldId));
  }, []);
  const handleExternalDropPlaced = useCallback((tileId: string) => {
    setSelectedTileId(tileId);
    setDiscardDropPlacement(null);
  }, []);
const resetTablePresentation = useCallback(() => {
  setTableMeldOffsets({});
  setSelectedTileId(null);
  setDroppedMelds([]);
  setPendingNormalMeld(null);
  setLocalDragCommittedMeldSignatures([]);
  setOpenableRackMelds({ melds: [], score: 0, contiguousGroups: [] });
  setOptimisticRackTile(null);
  setDiscardDropPlacement(null);
  setIsDiscardDragActive(false);
  setHoveredMeldTarget(null);
  resetPresentationOverlays();
}, [resetPresentationOverlays]);

  return {
    konkanRevealData, setKonkanRevealData, closeKonkanReveal, showKonkanReveal,
    completeKonkanRevealEntrance, resetPresentationOverlays, finishKonkanReveal,
    finishFinalTilePresentation, resetTablePresentation,
    selectedTileId, setSelectedTileId,
    openableRackMelds, setOpenableRackMelds,
    droppedMelds, setDroppedMelds, removeStagedMeld,
    pendingNormalMeld, setPendingNormalMeld,
    localDragCommittedMeldSignatures, setLocalDragCommittedMeldSignatures,
    tableMeldOffsets, setTableMeldOffsets, moveTableMeld,
    showScoreDetails, setShowScoreDetails,
    showDiscardHistory, setShowDiscardHistory,
    showFinalTileCelebration, setShowFinalTileCelebration,
    turnWarningToastVisible, setTurnWarningToastVisible,
    dealOrigin, setDealOrigin,
    profilePlayer, setProfilePlayer,
    discardDropPlacement, setDiscardDropPlacement,
    optimisticRackTile, setOptimisticRackTile,
    isDiscardDragActive, setIsDiscardDragActive,
    hoveredMeldTarget, setHoveredMeldTarget,
    pendingDrawRef, handleExternalDropPlaced,
  };
}

export type OkeyRelativeSeat = "bottom" | "right" | "top" | "left";

export function getRelativeSeatMap(localPlayerIndex: number): Record<OkeyRelativeSeat, number> {
  const local = ((localPlayerIndex % 4) + 4) % 4;
  return { bottom: local, right: (local + 1) % 4, top: (local + 2) % 4, left: (local + 3) % 4 };
}

export function useOkeyTableViewModel(input: {
  state: OkeyGameState;
  currentUserId: string | null;
  onlineProjection: OkeyMatchServerProjection | null;
  waitingRoom?: OkeyRoomSnapshot | null;
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
  const { state, currentUserId, onlineProjection, waitingRoom, presentedTablePlayers,
    stableOpponentTileCounts, onlineGameplayReady, turnPlayerIndex, turnPlayerId, turnPhase, turnDeadlineAt,
    turnDurationSeconds, turnTimeLeftMilliseconds, serverClockOffsetMs,
    currentRoundResult, roundResults, matchScores, matchWinnerTeamId, showMatchResultPopup, matchFinished } = input;
  const humanPlayer = useMemo(
    () => state.players.find((player) => player.id === currentUserId) ?? state.players[0],
    [currentUserId, state.players],
  );
  const isHumanTurn = turnPhase === "playing" && turnPlayerId === humanPlayer.id;
  const localPlayerIndex = useMemo(() => {
    if (!currentUserId) return null;
    if (waitingRoom) return waitingRoom.members.find(member => member.userId === currentUserId)?.playerIndex ?? null;
    const players = onlineProjection?.players;
    if (!players) return null;
    const index = players.findIndex((player) => player.id === currentUserId);
    return index >= 0 ? index : null;
  }, [currentUserId, onlineProjection?.players, waitingRoom]);
  const seatMap = useMemo(() => localPlayerIndex === null ? null : getRelativeSeatMap(localPlayerIndex), [localPlayerIndex]);
  const playerForSeat = useCallback((seat: OkeyRelativeSeat) => {
    if (!seatMap) return null;
    const projectedPlayer = onlineProjection?.players[seatMap[seat]];
    return projectedPlayer ? state.players.find((player) => player.id === projectedPlayer.id) ?? null : null;
  }, [onlineProjection?.players, seatMap, state.players]);
  const opponentSeats = useMemo(() => (["top", "left", "right"] as const).map((side) => {
    const serverIndex = seatMap?.[side] ?? null;
    const player = waitingRoom ? null : playerForSeat(side);
    const member = waitingRoom?.members.find(entry => entry.playerIndex === serverIndex);
    return {
      side, playerIndex: serverIndex, id: member?.userId ?? player?.id,
      name: member?.displayName ?? player?.name ?? "",
      count: onlineGameplayReady && player ? stableOpponentTileCounts[player.id] ?? player.hand.length : 0,
      active: !waitingRoom && onlineGameplayReady && serverIndex !== null && turnPlayerIndex === serverIndex,
      turnTimeLeftMilliseconds, turnDeadlineAt, serverClockOffsetMs, turnDurationSeconds,
      turnTimerPhase: state.hasDrawnThisTurn ? "throw" as const : "draw" as const,
    };
  }), [waitingRoom, onlineGameplayReady, playerForSeat, seatMap, serverClockOffsetMs, stableOpponentTileCounts,
    state.hasDrawnThisTurn, turnDeadlineAt, turnDurationSeconds, turnPlayerIndex, turnTimeLeftMilliseconds]);
  const seatOrderedPlayers = useMemo(() => {
    const fallback: Record<OkeyRelativeSeat, OkeyPlayer> = {
      bottom: state.players[0], right: state.players[1], top: state.players[2], left: state.players[3],
    };
    return (["bottom", "top", "left", "right"] as const).map((seat) => playerForSeat(seat) ?? fallback[seat]);
  }, [playerForSeat, state.players]);
  const presentedSeatOrderedPlayers = useMemo(() => seatOrderedPlayers.map((player) =>
    presentedTablePlayers.find((entry) => entry.id === player.id) ?? player,
  ), [humanPlayer.id, presentedTablePlayers, seatOrderedPlayers]);
  const profileTargetForPlayer = useCallback((playerId: string): PlayerProfileTarget | null => {
    const player = state.players.find((entry) => entry.id === playerId);
    return player ? { id: player.id, name: player.name, avatarId: (player.avatarId ?? undefined) as any, avatarUrl: player.avatarUrl ?? undefined } : null;
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

export function useOkeyAdapterPresentationLifecycle({ adapter, showKonkanReveal, resetOverlays }: {
  adapter: OkeyPresentationSource | null;
  showKonkanReveal: (runTiles: OkeyTile[], completionMeldTiles: OkeyTile[]) => void;
  resetOverlays: () => void;
}) {
  useEffect(() => {
    if (!adapter) return;
    const unsubscribeEvents = adapter.subscribeActionEvents((event) => {
      if (event.type === "konkan" && event.payload?.kind === "declare") {
        showKonkanReveal(
          (event.payload.runTiles as OkeyTile[]) ?? [],
          (event.payload.completionMeldTiles as OkeyTile[]) ?? [],
        );
      }
    });
    const unsubscribeReset = adapter.subscribeReset(resetOverlays);
    return () => { unsubscribeEvents(); unsubscribeReset(); };
  }, [adapter, resetOverlays, showKonkanReveal]);
}

export function useOkeyForcedKonkanPresentation(forcedTeamId?: string | null, roundStartsAt?: string | null) {
  const [visible, setVisible] = useState(false);
  const [panelProgress] = useState(() => new Animated.Value(0));
  const [countdownProgress] = useState(() => new Animated.Value(1));
  const endsAt = forcedTeamId ? Date.parse(roundStartsAt ?? "") : Number.NaN;

  useEffect(() => {
    const panelAnimation = Animated.timing(panelProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 360 : 260,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    panelAnimation.start();
    countdownProgress.stopAnimation();
    if (visible) {
      countdownProgress.setValue(1);
      Animated.timing(countdownProgress, {
        toValue: 0,
        duration: Math.max(0, endsAt - Date.now()),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    return () => panelAnimation.stop();
  }, [countdownProgress, endsAt, panelProgress, visible]);

  useEffect(() => {
    const remainingMs = endsAt - Date.now();
    const nextVisible = Number.isFinite(endsAt) && remainingMs > 0;
    const update = setTimeout(() => setVisible(nextVisible), 0);
    const expiry = nextVisible ? setTimeout(() => setVisible(false), remainingMs) : null;
    return () => { clearTimeout(update); if (expiry) clearTimeout(expiry); };
  }, [endsAt]);

  return { visible, panelProgress, countdownProgress };
}

export function useOkeyTileCycleAnnouncementPresentation(active: boolean, durationMs: number) {
  const [visible, setVisible] = useState(false);
  const [panelProgress] = useState(() => new Animated.Value(0));
  const [countdownProgress] = useState(() => new Animated.Value(1));

  useEffect(() => {
    setVisible(active);
  }, [active]);

  useEffect(() => {
    const panelAnimation = Animated.timing(panelProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 360 : 260,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    panelAnimation.start();

    countdownProgress.stopAnimation();
    if (visible) {
      countdownProgress.setValue(1);
      Animated.timing(countdownProgress, {
        toValue: 0,
        duration: Math.max(0, durationMs),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    return () => panelAnimation.stop();
  }, [countdownProgress, durationMs, panelProgress, visible]);

  return { visible, panelProgress, countdownProgress };
}

export function useOkeyStagedMeldCleanup(
  authoritativeOpened: boolean,
  stagedMeldCount: number,
  clearStagedMelds: () => void,
) {
  useEffect(() => {
    if (!authoritativeOpened || stagedMeldCount === 0) return;
    clearStagedMelds();
  }, [authoritativeOpened, clearStagedMelds, stagedMeldCount]);
}
