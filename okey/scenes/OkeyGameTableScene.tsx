import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View, } from "react-native";

import WaitingPlayersPopup from "@/okey/components/WaitingPlayersPopup";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import PlayerProfilePopup from "@/components/game/PlayerProfilePopup";
import TableBackground from "@/components/game/TableBackground";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import MultiplayerGameChat from "@/components/game/MultiplayerGameChat";
import { MemoizedOkeyCenterPiles } from "@/okey/components/OkeyCenterPiles";
import { OkeyDiscardHistoryPopup } from "@/okey/components/OkeyDiscardHistoryPopup";
import { OkeyFinalTileCelebration } from "@/okey/components/OkeyFinalTileCelebration";
import { OkeyForcedKonkan } from "@/okey/components/OkeyForcedKonkan";
import { OkeyKonkanReveal } from "@/okey/components/OkeyKonkanReveal";
import {
  OkeyMatchResultPopup,
} from "@/okey/components/OkeyMatchResultPopup";
import OkeyLeaveMatchConfirmPopup, { type OkeyMatchMode } from "@/okey/components/OkeyLeaveMatchConfirmPopup";
import { chunkOkeyMeldRows, OkeyMeldView } from "@/okey/components/OkeyMeldView";
import { MemoizedOkeyOpponentSeat } from "@/okey/components/OkeyOpponentSeat";
import { MemoizedOkeyPlayerRack } from "@/okey/components/OkeyPlayerRack";
import { OkeyScoreDetailsPopup } from "@/okey/components/OkeyScoreDetailsPopup";
import { MemoizedOkeyTableMeldAreas } from "@/okey/components/OkeyTableMeldAreas";
import { styles } from "@/okey/components/okeyStyles";
import { useOkeyFeedback, useOkeyGameFeedback } from "@/okey/hooks/useOkeyFeedback";
import { useOkeyMultiplayerGame } from "@/okey/hooks/useOkeyMultiplayerGame";
import { selectOkeyTurnView } from "@/okey/selectors/okey-turn-view";
import { useOkeyAuthoritativeRackRemovalPresentation, useOkeyMeldDropOrchestration, useOkeyOpponentTileFlightCoordinator, useOkeyOptimisticRackPresentation, useOkeyPlayerTileFlightCommands, useOkeyPresentationResetLifecycle, useOkeyTakeoverPresentationExit, useOkeyTileFlightCompletion, useOkeyTileFlightCoordinator, useOkeyTimeoutTileFlightCoordinator } from "@/okey/hooks/useOkeyTileFlightCoordinator";
import { OkeyResponsiveLayoutProvider, useOkeyResponsiveLayout } from "@/okey/layout/OkeyResponsiveLayoutProvider";
import { useOkeyTableGeometry } from "@/okey/layout/useOkeyTableGeometry";
import { OkeyTileFlightOverlay } from "@/okey/presentation/OkeyTileFlightOverlay";
import { useOkeyGameplayReadiness, useOkeyMatchExitLifecycle, useOkeyRoomLifecycle } from "@/okey/multiplayer/useOkeyRoomLifecycle";
import {
  type ScreenRect,
} from "@/okey/presentation/okey-game-presentation";
import { useOkeyHumanMeldDropAvailability, useOkeyRackMoveInteraction, useOkeyRackTileInteraction, useOkeyTableActions } from "@/okey/presentation/useOkeyTableActions";
import { useOkeyTablePresentation } from "@/okey/presentation/useOkeyTablePresentation";
import { useOkeyTableViewModel } from "@/okey/presentation/useOkeyTableViewModel";
import {
  useOkeyAdapterPresentationLifecycle,
  useOkeyFinalTilePresentationPolicy,
  useOkeyForcedKonkanPresentation,
  useOkeyTimeoutWarningPresentation,
  useOkeyStagedMeldCleanup,
} from "@/okey/presentation/useOkeyPresentationPolicy";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";

const EMPTY_OKEY_TILES: OkeyTile[] = [];
const PLAYER_PREVIEW_MELD_TILE_WIDTH = 18;
const PLAYER_PREVIEW_MELD_TILE_HEIGHT = 24;

function useStableEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}

export default function OkeyGameTableScene() {
  return (
    <OkeyResponsiveLayoutProvider>
      <OkeyGameTableSceneContent />
    </OkeyResponsiveLayoutProvider>
  );
}

function getRouteParam(
  value: string | string[] | undefined,
) {
  return Array.isArray(value)
    ? value[0]
    : value;
}

function OkeyGameTableSceneContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    matchId?: string | string[];
    mode?: string | string[];
  }>();

  const onlineMatchId = getRouteParam(params.matchId);

  const okeyMatchMode: OkeyMatchMode =
    getRouteParam(params.mode) === "aznif"
      ? "aznif"
      : "fun";

  const exitRoute = okeyMatchMode === "aznif" ? "/(tabs)/aznif" : "/(tabs)/play";

  const {
    room: onlineRoom,
    currentUserId,
    activeMatchId: activeOnlineMatchId,
    waitingForPlayers: waitingForOnlinePlayers,
    countdownInProgress,
    canCancelWaiting,
    leavingWaitingRoom,
    cancelWaiting: handleCancelWaiting,
  } = useOkeyRoomLifecycle({ matchId: onlineMatchId, exitRoute });
  const {
    konkanRevealData, setKonkanRevealData, showKonkanReveal,
    completeKonkanRevealEntrance, resetPresentationOverlays, finishKonkanReveal,
    finishFinalTilePresentation, resetTablePresentation,
    selectedTileId, setSelectedTileId, rackSetScore, setRackSetScore,
    openableRackMelds, setOpenableRackMelds, droppedMelds, setDroppedMelds,
    localDragCommittedMeldSignatures, setLocalDragCommittedMeldSignatures,
    tableMeldOffsets, setTableMeldOffsets, showScoreDetails, setShowScoreDetails,
    showDiscardHistory, setShowDiscardHistory,
    showFinalTileCelebration, setShowFinalTileCelebration,
    turnWarningToastVisible, setTurnWarningToastVisible,
    dealOrigin, setDealOrigin, profilePlayer, setProfilePlayer, moveTableMeld, removeStagedMeld,
    discardDropPlacement, setDiscardDropPlacement,
    optimisticRackTile, setOptimisticRackTile,
    isDiscardDragActive, setIsDiscardDragActive,
    hoveredMeldTarget, setHoveredMeldTarget,
    pendingDrawRef, handleExternalDropPlaced,
  } = useOkeyTablePresentation();
  const { emitFeedback } = useOkeyFeedback();
  const responsiveLayout = useOkeyResponsiveLayout();
const onlineController = useOkeyMultiplayerGame(
    activeOnlineMatchId,
    currentUserId,
  );

  const {
    showMatchMenu,
    matchMenuTranslateX,
    openMatchMenu,
    closeMatchMenu,
  } = useMatchMenu();

  const {
    state,
    currentRound,
    maxRounds,
    matchScores,
    roundResults,
    showRoundResultPopup,
    currentRoundResult,
    matchFinished,
    matchWinnerTeamId,
    showMatchResultPopup,
    finalPresentationComplete,
    completeFinalPresentation,
    draw,
    discard,
    commitOpenIntent,
    declareKonkan,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    turnTimeLeft,
    turnTimeLeftMilliseconds,
    serverClockOffsetMs,
    isAppActive,
    lifecycleResumeToken,
    onlineProjection,
    onlineAdapter,
    leaveOnlineMatch,
    requestExit,
    cancelExit,
    exitConfirmationVisible,
    leaving,
  } = onlineController;

  useOkeyAdapterPresentationLifecycle({
    adapter: onlineAdapter,
    showKonkanReveal,
    resetOverlays: resetPresentationOverlays,
  });


  const {
    gameplayReady: onlineGameplayReady,
    startTransitionPending: initialStartTransitionPending,
  } = useOkeyGameplayReadiness({
    projectionReady: onlineProjection !== null, room: onlineRoom,
    matchFinished, phase: state.phase, showRoundResult: showRoundResultPopup,
    showMatchResult: showMatchResultPopup, matchId: onlineMatchId,
  });
  const shouldShowWaitingPlayers = waitingForOnlinePlayers || initialStartTransitionPending;

  const dealLifecycleKey = onlineGameplayReady
    ? `playing-${onlineMatchId}-${currentRound}`
    : "waiting";

  const turnView = useMemo(
    () => selectOkeyTurnView(onlineProjection),
    [onlineProjection],
  );

  const {
    tileFlight,
    setTileFlight,
    hiddenRackTileIds,
    setHiddenRackTileIds,
    hideDeckTopTile,
    setHideDeckTopTile,
    hideDiscardTopTile,
    setHideDiscardTopTile,
   discardPresentationFallback,
    setDiscardPresentationFallback,
    holdDiscardUntilAuthoritative,
    releaseAuthoritativeDiscardHold,
    launchTileFlight,
    presentedTablePlayers,
    setPresentedPlayers,
    presentedTopDiscard,
    setPresentedTopDiscard,
    resetPresentationRuntime,
    awaitingDiscardRemovalTileIdRef,
    activePresentationRef,
  } = useOkeyTileFlightCoordinator(
    state.players,
    state.discardPile[state.discardPile.length - 1] ?? null,
  );
  const stableOpponentTileCounts = useMemo(
    () => Object.fromEntries(
      presentedTablePlayers.map((player) => [player.id, player.hand.length]),
    ),
    [presentedTablePlayers],
  );
  const {
    humanPlayer, isHumanTurn, opponentSeats, seatOrderedPlayers, presentedSeatOrderedPlayers,
    profileTargetForPlayer, playerIdBySeat, viewerTeamId, opponentTeamId, teamScores,
    displayRoundResults, playerNamesById, displayCurrentRoundScoreDetails, viewerWon,
    matchSettlementRewards, shouldRenderMatchResultPopup,
  } = useOkeyTableViewModel({
    state, currentUserId, onlineProjection, presentedTablePlayers,
    stableOpponentTileCounts, onlineGameplayReady,
    turnPlayerIndex: turnView.playerIndex, turnPlayerId: turnView.playerId,
    turnPhase: turnView.phase, turnDeadlineAt: turnView.deadlineAt,
    turnDurationSeconds: turnView.durationSeconds, turnTimeLeftMilliseconds,
    serverClockOffsetMs, currentRoundResult, roundResults, matchScores, matchWinnerTeamId,
    showMatchResultPopup, matchFinished,
  });

  const presentedHumanRackTiles = useOkeyOptimisticRackPresentation(
    humanPlayer.hand,
    optimisticRackTile,
    setOptimisticRackTile,
  );
  const topDiscard = state.discardPile[state.discardPile.length - 1] ?? null;
  const drawPending = pendingDrawRef.current !== null;
  const presentedDeckCount = Math.max(0, state.deck.length - (pendingDrawRef.current?.source === "deck" ? 1 : 0));
  const presentedDiscardCount = Math.max(0, state.discardPile.length - (pendingDrawRef.current?.source === "discard" ? 1 : 0));
  const {
    screenRef, deckTopRectRef, discardTopRectRef,
    opponentSeatRectsRef, rackRectRef, rackTileRectsRef, drawLandingRectRef,
    meldDropRectsRef, hoveredMeldTargetRef, humanMeldDropZoneRef,
    measureScreen, measureHumanMeldDropZone, toLocalRect,
    isInsideRack: isPointInsideRack, isInsideDiscardPile: isPointInsideDiscardPile,
    isInsideHumanMeldZone, registerMeldDropRect, findMeldDropTarget,
  } = useOkeyTableGeometry();



  useOkeyGameFeedback({
    state,
    roundResults,
    showMatchResultPopup,
    matchWinnerTeamId,
    matchScores,
    currentRound,
    humanTeamId: humanPlayer.teamId,
    isAppActive,
    lifecycleResumeToken,
    emitFeedback,
    suppressLocalMeldFeedbackSignatures: localDragCommittedMeldSignatures,
  });


const shouldShowScorePopup =
  (showScoreDetails && state.phase !== "finished") ||
  showRoundResultPopup;
  const {
    visible: forceKonkanAnnouncementVisible,
    panelProgress: forceKonkanPanelProgress,
    countdownProgress: forceKonkanCountdownProgress,
  } = useOkeyForcedKonkanPresentation(
    onlineProjection?.forcedKonkanTeamId,
    onlineProjection?.roundStartsAt,
  );
  const droppedTileIds = useMemo(
    () => droppedMelds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
    [droppedMelds],
  );
  const clearStagedMelds = useCallback(() => setDroppedMelds([]), [setDroppedMelds]);
  useOkeyStagedMeldCleanup(humanPlayer.opened, droppedMelds.length, clearStagedMelds);
  const {
    startNextQueuedPresentation,
    retryQueuedOpponentFlight,
    completeOpponentPresentationFlight,
    hasQueuedPresentation,
    presentedTurnPlayerId,
  } = useOkeyOpponentTileFlightCoordinator({
    state,
    adapter: onlineAdapter,
    projectionVersion: onlineProjection ? Number(onlineProjection.version) : null,
    tileFlight,
    deckTopRectRef,
    discardTopRectRef,
    opponentSeatRectsRef,
    rackRectRef,
    activePresentationRef,
    setPresentedPlayers,
    launchTileFlight,
    toLocalRect,
  });



  useOkeyTimeoutWarningPresentation({
    currentRound,
    deadlineAt: turnView.deadlineAt,
    durationSeconds: turnView.durationSeconds,
    playerId: turnView.playerId,
    hasDrawn: state.hasDrawnThisTurn,
    ready: onlineGameplayReady,
    appActive: isAppActive,
    humanTurn: isHumanTurn,
    timeLeft: turnTimeLeft,
    showWarning: setTurnWarningToastVisible,
    emitWarning: (key) => emitFeedback("timeout-warning", `timeout-warning:${key}`),
  });

  const {
    canDraw, canDrawDiscard, canPlayAfterDraw, canDiscardTile,
    canDiscardSelectedTile, selectedTile, openAction, executeOpenAction, openActionButtonLabel, remainingMeldSlots,
    selectOpenAction, selectTableMeldAction,
  } = useOkeyTableActions({
    state, humanPlayer, isHumanTurn, selectedTileId,
    rackMeldSelection: openableRackMelds, declareKonkan, commitOpenIntent, setSelectedTileId,
  });


const { resetTimeoutPresentation } = useOkeyTimeoutTileFlightCoordinator({
    isOnline: true,
    onlineMatchId,
    onlineProjection,
    state,
    humanPlayer,
    tileFlight,
    rackRectRef,
    rackTileRectsRef,
    deckTopRectRef,
    discardTopRectRef,
    setHideDeckTopTile,
    setHideDiscardTopTile,
    setDiscardPresentationFallback,
    setTileFlight,
    toLocalRect,
    activePresentationRef,
  });

  const completeActivePresentation = useOkeyTileFlightCompletion({
    tileFlight,
    topDiscard,
    pendingDrawRef,
    setPresentedTopDiscard,
    activePresentationRef,
    setTileFlight,
    setHiddenRackTileIds,
   setHideDeckTopTile,
    setHideDiscardTopTile,
    setDiscardPresentationFallback,
    holdDiscardUntilAuthoritative,
    toLocalRect,
    resetTimeoutPresentation,
    startNextQueuedPresentation,
    completeOpponentPresentationFlight,
  });
  const exitAfterTakeoverPresentation = useCallback(() => router.replace(exitRoute), [exitRoute, router]);
  useOkeyTakeoverPresentationExit({
    matchId: onlineMatchId,
    projection: onlineProjection,
    activePresentationRef,
    presentationToken: tileFlight,
    onExit: exitAfterTakeoverPresentation,
  });


  useOkeyAuthoritativeRackRemovalPresentation(
    humanPlayer.hand,
    awaitingDiscardRemovalTileIdRef,
    setHiddenRackTileIds,
  );

  const isInsideHumanMeldDropZone = useOkeyHumanMeldDropAvailability({
    isInsideHumanMeldZone,
    blocked: showScoreDetails || showRoundResultPopup || showMatchResultPopup ||
      showDiscardHistory || showFinalTileCelebration || isDiscardDragActive,
  });
  const {
    updateTileDragMeldTarget,
    dropTileOnTableMeld,
    handleDropMeldGroup,
  } = useOkeyMeldDropOrchestration({
    canPlayAfterDraw,
    remainingMeldSlots,
    humanOpened: humanPlayer.opened,
    humanHandCount: humanPlayer.hand.length,
    droppedMelds,
    hoveredTargetRef: hoveredMeldTargetRef,
    findMeldTarget: findMeldDropTarget,
    isInsideHumanMeldZone: isInsideHumanMeldDropZone,
    selectTableMeldAction,
    awaitingTileIdRef: awaitingDiscardRemovalTileIdRef,
    setHiddenTileIds: setHiddenRackTileIds,
    setSelectedTileId,
    setHoveredTarget: setHoveredMeldTarget,
    setDroppedMelds,
    setCommittedSignatures: setLocalDragCommittedMeldSignatures,
    lockKonkan: lockKonkanSetOnTable,
    spendTile: spendTileOnTableMeld,
    commitOpenIntent,
    selectOpenAction,
    emitFeedback,
  });
  useOkeyPresentationResetLifecycle({
    resumeToken: lifecycleResumeToken,
    round: currentRound,
    players: state.players,
    topDiscard,
    resetRuntime: resetPresentationRuntime,
    resetTablePresentation,
    pendingDrawRef,
    hoveredMeldTargetRef,
    meldDropRectsRef,
    setDiscardDropPlacement,
    setIsDiscardDragActive,
    setHoveredMeldTarget,
  });

  const turnTimerVisible = onlineGameplayReady && state.phase === "playing" && !showRoundResultPopup && !showMatchResultPopup;

  const {
    startDrawFlight,
    startDiscardFlight,
    handleDiscardDroppedOnRack,
    dropTileFromRack,
    handleDeckDroppedOnRack: handleDeckDroppedOnRackCommand,
  } = useOkeyPlayerTileFlightCommands({
    state, humanPlayer, topDiscard, canDraw, canDiscardTile, droppedMelds, tileFlight,
    deckTopRectRef, discardTopRectRef, drawLandingRectRef, rackTileRectsRef,
    pendingDrawRef, awaitingDiscardRemovalTileIdRef, isPointInsideRack,
    isPointInsideDiscardPile, toLocalRect, draw, discard, commitOpenIntent,
    selectOpenAction, dropTileOnTableMeld,
    emitInvalid: (key) => emitFeedback("invalid", key),
    launchTileFlight, setTileFlight, setHiddenRackTileIds, setHideDeckTopTile,
    setHideDiscardTopTile, setDiscardPresentationFallback, setPresentedTopDiscard,
    holdDiscardUntilAuthoritative, releaseAuthoritativeDiscardHold,
    setOptimisticRackTile, setDiscardDropPlacement, setSelectedTileId,
    setLocalDragCommittedMeldSignatures,
  });
  const handleTopOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[0]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
    retryQueuedOpponentFlight();
  });
  const handleLeftOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[1]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
    retryQueuedOpponentFlight();
  });
  const handleRightOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[2]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
    retryQueuedOpponentFlight();
  });
  const handleMeldMeasured = useStableEvent(registerMeldDropRect);
  const handleRackTileSelect = useOkeyRackTileInteraction({
    canDiscardTile, canDiscardSelectedTile, selectedTileId, setSelectedTileId,
    discardTile: startDiscardFlight, emitFeedback,
  });
  const openOpponentProfile = useStableEvent((playerId: string) => {
    setProfilePlayer(profileTargetForPlayer(playerId));
  });
  const handleConfirmLeaveMatch = useOkeyMatchExitLifecycle({ leaveOnlineMatch, leaving, exitRoute });
  const handleDrawDeck = useStableEvent(() => startDrawFlight("deck"));
  const handleDrawDiscard = useStableEvent(() => startDrawFlight("discard"));
  const handleViewDiscards = useStableEvent(() => setShowDiscardHistory(true));
  const handleDiscardDroppedOnRackStable = useStableEvent(handleDiscardDroppedOnRack);
  const handleDeckDroppedOnRack = useStableEvent(handleDeckDroppedOnRackCommand);
  const handleDeckMeasured = useStableEvent((rect: ScreenRect) => {
    deckTopRectRef.current = rect;
    retryQueuedOpponentFlight();
  });
  const handleDiscardMeasured = useStableEvent((rect: ScreenRect) => {
    discardTopRectRef.current = rect;
    const nextOrigin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    setDealOrigin((current) =>
      current?.x === nextOrigin.x && current?.y === nextOrigin.y ? current : nextOrigin,
    );
    retryQueuedOpponentFlight();
  });
  const { handleDropTile, handleMoveRackTile } = useOkeyRackMoveInteraction({
    dropTile: dropTileFromRack, setSelectedTileId, emitFeedback,
  });
  const handleDropMeldGroupStable = useStableEvent(handleDropMeldGroup);
  const handleTileDragPointChange = useStableEvent(updateTileDragMeldTarget);
  const handleRackMeasured = useStableEvent((rect: ScreenRect) => {
    rackRectRef.current = rect;
  });
  const handleDrawLandingRectChange = useStableEvent((rect: ScreenRect | null) => {
    drawLandingRectRef.current = rect;
  });
  const handleRackTileMeasured = useStableEvent((tileId: string, rect: ScreenRect) => {
    rackTileRectsRef.current[tileId] = rect;
  });
  const skipEnterAnimationTileIds = useMemo(
    () => discardDropPlacement ? [discardDropPlacement.tileId] : [],
    [discardDropPlacement],
  );

  useOkeyFinalTilePresentationPolicy({
    phase: state.phase,
    finalPresentationComplete,
    hasQueuedPresentation,
    tileFlightActive: tileFlight !== null,
    roundResultVisible: showRoundResultPopup,
    matchResultVisible: showMatchResultPopup,
    konkanRevealVisible: konkanRevealData.visible,
    setVisible: setShowFinalTileCelebration,
  });




  
  return (
<TableBackground>
  <View
    ref={screenRef}
    onLayout={measureScreen}
    style={[styles.screen, responsiveLayout.screen]}
  >

<WaitingPlayersPopup
  visible={shouldShowWaitingPlayers}
  entryFee={onlineRoom?.entryFee ?? 0}
  currency={onlineRoom?.currency ?? "fun"}
  members={onlineRoom?.members ?? []}
  countdownEndsAt={onlineRoom?.countdownEndsAt ?? null}
  canCancel={
    !countdownInProgress &&
    !initialStartTransitionPending &&
    canCancelWaiting
  }
  loading={leavingWaitingRoom}
  onCancel={handleCancelWaiting}
/>

<View style={finishRevealStyles.topRightActions}>
  <Pressable style={finishRevealStyles.topRightActionButton} onPress={openMatchMenu}>
    <Ionicons name="menu-outline" size={22} color="#f8f3df" />
  </Pressable>
</View>


<View style={[styles.tableArea, isDiscardDragActive && styles.activeDiscardDragTableLayer]}>
  <View style={styles.tableSurface}>
    <View style={styles.feltTexture} />

    <MemoizedOkeyOpponentSeat
      {...opponentSeats[0]}
      playerId={opponentSeats[0]?.id}
      side="top"
      onMeasured={handleTopOpponentMeasured}
      onPress={
        opponentSeats[0]?.name
          ? () => openOpponentProfile(opponentSeats[0]?.id ?? "")
          : undefined
      }
    />

    <MemoizedOkeyOpponentSeat
      {...opponentSeats[1]}
      playerId={opponentSeats[1]?.id}
      side="left"
      onMeasured={handleLeftOpponentMeasured}
      onPress={
        opponentSeats[1]?.name
          ? () => openOpponentProfile(opponentSeats[1]?.id ?? "")
          : undefined
      }
    />

    <MemoizedOkeyOpponentSeat
      {...opponentSeats[2]}
      playerId={opponentSeats[2]?.id}
      side="right"
      onMeasured={handleRightOpponentMeasured}
      onPress={
        opponentSeats[2]?.name
          ? () => openOpponentProfile(opponentSeats[2]?.id ?? "")
          : undefined
      }
    />

<MemoizedOkeyTableMeldAreas
      players={presentedSeatOrderedPlayers}
      okeyTile={state.okeyTile}
      onMeldMeasured={handleMeldMeasured}
      meldOffsets={tableMeldOffsets}
      onMeldOffsetChange={moveTableMeld}
      highlightedMeldId={hoveredMeldTarget?.meldId ?? null}
      suppressLocalEntryAnimationMeldSignatures={localDragCommittedMeldSignatures}
            />
            <View
              ref={humanMeldDropZoneRef}
              pointerEvents="box-none"
              onLayout={measureHumanMeldDropZone}
              style={[styles.meldArea, responsiveLayout.meldAreas.bottom, styles.humanMeldDropZone]}
            >
              <View pointerEvents="auto" style={styles.previewMeldContent}>
                {chunkOkeyMeldRows(droppedMelds).map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.meldRow}>
                    {row.map((meld) => (
                      <Pressable
                        key={meld.id}
                        onPress={() => removeStagedMeld(meld.id)}
                      >
                        <OkeyMeldView
                          meld={meld}
                          okeyTile={state.okeyTile}
                          tileWidth={PLAYER_PREVIEW_MELD_TILE_WIDTH}
                          tileHeight={PLAYER_PREVIEW_MELD_TILE_HEIGHT}
                        />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            </View>
            {onlineGameplayReady ? (
              <MemoizedOkeyCenterPiles
                deckCount={presentedDeckCount}
                topDiscard={presentedTopDiscard}
                discardUnderlayTile={state.discardPile[state.discardPile.length - 2] ?? null}
                discardCount={presentedDiscardCount}
                canDraw={canDraw && !drawPending}
                canDrawDiscard={canDrawDiscard && !drawPending}
                indicatorTile={state.indicatorTile}
                okeyTile={state.okeyTile}
                onDrawDeck={handleDrawDeck}
                onDrawDiscard={handleDrawDiscard}
                onViewDiscards={handleViewDiscards}
                onDiscardDroppedOnRack={handleDiscardDroppedOnRackStable}
                onDeckDroppedOnRack={handleDeckDroppedOnRack}
                onDiscardDragActiveChange={setIsDiscardDragActive}
                onDeckMeasured={handleDeckMeasured}
                onDiscardMeasured={handleDiscardMeasured}
                hideTopDeckTile={hideDeckTopTile}
                hideTopDiscardTile={hideDiscardTopTile}
                discardPresentationFallback={discardPresentationFallback}
              />
            ) : null}
          </View>
        </View>
        <Pressable
          style={styles.okeyMiniScoreBoard}
          onPress={() => setShowScoreDetails(true)}
        >
          <View style={styles.okeyMiniScoreItem}>
            <Text style={styles.okeyMiniScoreLabel}>تیمی تۆ</Text>
            <Text style={styles.okeyMiniScoreValue}>{teamScores.teamA}</Text>
          </View>
          <View style={styles.okeyMiniScoreDivider} />
          <View style={styles.okeyMiniScoreItem}>
            <Text style={styles.okeyMiniScoreLabel}>تیمی بەرامبەر</Text>
            <Text style={styles.okeyMiniScoreValue}>{teamScores.teamB}</Text>
          </View>
        </Pressable>
        <OkeyDiscardHistoryPopup
          visible={showDiscardHistory}
          tiles={state.discardPile}
          okeyTile={state.okeyTile}
          onClose={() => setShowDiscardHistory(false)}
        />
        <View style={styles.playerSetScoreWrap} pointerEvents="box-none">
             {canPlayAfterDraw && openAction.allowed &&
             (!humanPlayer.konkan || openAction.mode === "declare-konkan") ? (
            <Pressable
              style={styles.openSetsButton}
              onPress={executeOpenAction}
            >
              <Text style={styles.openSetsButtonText}>
                {openActionButtonLabel}
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.playerSetScore} pointerEvents="none">
            <Text style={styles.playerSetScoreLabel}>
              {humanPlayer.konkan ? "دۆخ" : "نمرەی دەستە"}
            </Text>
            {humanPlayer.konkan ? (
              <Text style={styles.playerSetScoreValue}>کۆنکان</Text>
            ) : (
              <View style={styles.playerSetScoreValueRow}>
                <Text style={styles.playerSetScoreTarget}>
                  {humanPlayer.opened ? humanPlayer.scoreOpened : openAction.requiredScore}
                </Text>
                <Text style={styles.playerSetScoreSlash}>{" / "}</Text>
                <Text style={styles.playerSetScoreCurrent}>
                  {rackSetScore}
                </Text>
              </View>
            )}
          </View>
        </View>
        <MemoizedOkeyPlayerRack
          key={`${dealLifecycleKey}-rack`}
          tiles={onlineGameplayReady ? presentedHumanRackTiles : EMPTY_OKEY_TILES}
          selectedTileId={selectedTileId}
          okeyTile={state.okeyTile}
          onSelectTile={handleRackTileSelect}

          onRackScoreChange={setRackSetScore}
          onOpenableMeldsChange={setOpenableRackMelds}
          onDropMeldGroup={handleDropMeldGroupStable}
          onDropTile={handleDropTile}
          stagedTileIds={droppedTileIds}
          onTileDragPointChange={handleTileDragPointChange}
          hiddenTileIds={hiddenRackTileIds}
          skipEnterAnimationTileIds={skipEnterAnimationTileIds}
         externalDropPlacement={discardDropPlacement}
          eliminated={!!humanPlayer.eliminated}
          onExternalDropPlaced={handleExternalDropPlaced}

          turnTimerActive={
            turnTimerVisible &&
            isHumanTurn
          }
          turnWarningToastVisible={turnWarningToastVisible}
          turnWarningToastMessage={
            state.hasDrawnThisTurn
              ? "هەلدانی تاشەبەردێک انجام بدە"
              : undefined
          }
          turnTimeLeftMilliseconds={turnTimeLeftMilliseconds}
          turnDeadlineAt={turnView.deadlineAt}
          serverClockOffsetMs={serverClockOffsetMs}
          turnDurationSeconds={turnView.durationSeconds}
          turnTimerPhase={state.hasDrawnThisTurn ? "throw" : "draw"}
          dealResetKey={dealLifecycleKey}
          isDealer={onlineGameplayReady && state.dealerIndex === 0}
          dealOrigin={dealOrigin}
          onRackMeasured={handleRackMeasured}
          onDrawLandingRectChange={handleDrawLandingRectChange}
          onTileMeasured={handleRackTileMeasured}

          onMoveTile={handleMoveRackTile}

        />
        {tileFlight ? (
          <OkeyTileFlightOverlay key={tileFlight.id} flight={tileFlight} okeyTile={state.okeyTile} onDone={completeActivePresentation} />
        ) : null}
        <OkeyKonkanReveal
          visible={konkanRevealData.visible}
          runTiles={konkanRevealData.runTiles}
          completionMeldTiles={konkanRevealData.completionMeldTiles}
          okeyTile={state.okeyTile}
          onClose={() => finishKonkanReveal(completeFinalPresentation)}
          onEntered={completeKonkanRevealEntrance}
        />
        <OkeyForcedKonkan
          visible={forceKonkanAnnouncementVisible}
          panelProgress={forceKonkanPanelProgress}
          countdownProgress={forceKonkanCountdownProgress}
        />
      </View>
      <PlayerProfilePopup
        player={profilePlayer}
        onDismiss={() => setProfilePlayer(null)}
      />
      <MultiplayerGameChat
        gameType="okey"
        matchId={onlineMatchId}
        currentUserId={currentUserId}
        playerIdBySeat={playerIdBySeat}
        enabled={!!onlineMatchId && !!currentUserId && onlineGameplayReady}
      /><MatchMenuDrawer
  visible={showMatchMenu}
  players={seatOrderedPlayers}
  humanPlayer={humanPlayer}
  activePlayerId={presentedTurnPlayerId}
  translateX={matchMenuTranslateX}
  onClose={closeMatchMenu}
  onLeavePress={() => {
    closeMatchMenu();
    requestExit();
  }}
/>
<OkeyLeaveMatchConfirmPopup
  visible={exitConfirmationVisible}
  mode={okeyMatchMode}
  loading={leaving}
  onCancel={cancelExit}
  onConfirm={() => {
    void handleConfirmLeaveMatch();
  }}
/>

      {/* Dedicated Topmost Presentation Overlay (Always painted on top of Rack and all scene layers) */}
      <View pointerEvents="box-none" style={presentationOverlayStyles.root}>
        {showFinalTileCelebration ? (
          <OkeyFinalTileCelebration
            tile={topDiscard ?? state.indicatorTile}
            okeyTile={state.okeyTile}
            sourceRect={discardTopRectRef.current ? toLocalRect(discardTopRectRef.current) : null}
            playFinishSound
            onComplete={() => finishFinalTilePresentation(completeFinalPresentation)}
          />
        ) : null}

        <OkeyScoreDetailsPopup
          visible={shouldShowScorePopup}
          onClose={showRoundResultPopup ? undefined : () => setShowScoreDetails(false)}
          scoreDetails={displayCurrentRoundScoreDetails}
          round={currentRoundResult?.round ?? currentRound}
          playerNamesById={playerNamesById}
          maxRounds={maxRounds}
          roundResults={displayRoundResults}
          matchScores={teamScores}
          waitingForNextRound={showRoundResultPopup}
          isTileCycleLimit={
            showRoundResultPopup &&
            currentRoundResult?.endReason === "tile-cycle-limit"
          }
        />

        <OkeyMatchResultPopup
          visible={shouldRenderMatchResultPopup}
          viewerWon={viewerWon}
          viewerScore={matchScores[viewerTeamId]}
          opponentScore={matchScores[opponentTeamId]}
          rewards={matchSettlementRewards}
          onNewMatch={() => {
            router.replace(exitRoute);
          }}
        />
      </View>
    </TableBackground>
  );
}
const finishRevealStyles = StyleSheet.create({
  topRightActions: {
    position: "absolute",
    top: 18,
    right: 18,
    zIndex: 900,
    elevation: 900,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  topRightActionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,243,223,0.22)",
  },

});



const presentationOverlayStyles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
});
