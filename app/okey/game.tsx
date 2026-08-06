import { Ionicons } from "@expo/vector-icons";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import GameChatDrawer from "@/components/game/GameChatDrawer";
import WaitingPlayersPopup from "@/okey/components/WaitingPlayersPopup";
import ConnectionOverlay from "@/okey/components/ConnectionOverlay";
import GameControls from "@/okey/components/GameControls";
import ConnectionErrorBanner from "@/okey/components/ConnectionErrorBanner";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import PlayerProfilePopup from "@/components/game/PlayerProfilePopup";
import TableBackground from "@/components/game/TableBackground";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { supabase } from "@/lib/supabase";
import { MemoizedOkeyCenterPiles } from "@/okey/components/OkeyCenterPiles";
import { OkeyDiscardHistoryPopup } from "@/okey/components/OkeyDiscardHistoryPopup";
import { OkeyFinalTileCelebration } from "@/okey/components/OkeyFinalTileCelebration";
import { OkeyMatchResultPopup } from "@/okey/components/OkeyMatchResultPopup";
import { chunkOkeyMeldRows, OkeyMeldView } from "@/okey/components/OkeyMeldView";
import { MemoizedOkeyOpponentSeat } from "@/okey/components/OkeyOpponentSeat";
import { MemoizedOkeyPlayerRack } from "@/okey/components/OkeyPlayerRack";
import { OkeyPlayerSetScore } from "@/okey/components/OkeyPlayerSetScore";
import { OkeyScoreDetailsPopup } from "@/okey/components/OkeyScoreDetailsPopup";
import { MemoizedOkeyTableMeldAreas } from "@/okey/components/OkeyTableMeldAreas";
import { styles } from "@/okey/components/okeyStyles";
import { canDeclareKonkanOpen, canLockKonkanSet, canSpendTileOnMeld, getRequiredOpenScore, getRoundResultScoreDetails, MAX_PLAYER_MELDS } from "@/okey/engine/okey-engine";
import { useOkeyFeedback } from "@/okey/hooks/useOkeyFeedback";
import { useOkeyGame } from "@/okey/hooks/useOkeyGame";
import { useOkeyTileFlightCoordinator } from "@/okey/hooks/useOkeyTileFlightCoordinator";
import { useStableEvent } from "@/okey/hooks/useStableEvent";
import { OkeyResponsiveLayoutProvider, useOkeyResponsiveLayout } from "@/okey/layout/OkeyResponsiveLayoutProvider";
import {
  getOkeyRoomStatus,
  leaveOkeyRoom,
  subscribeOkeyRoom,
  type OkeyRoomSnapshot,
} from "@/okey/multiplayer/okey-room-api";
import { getRelativeSeatMap, type RelativeSeat } from "@/okey/multiplayer/relative-seat-map";
import { OkeyTileFlightOverlay } from "@/okey/presentation/OkeyTileFlightOverlay";
import type {
  EliminatedTurnFlight,
  MeldDropRect,
  MeldOffset,
  QueuedOpponentDiscardFlight,
  ScreenRect,
  TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import {
  createOpponentDiscardFlight,
  findClosestMeldDropTarget,
  isPointInsideRect,
  toLocalScreenRect,
} from "@/okey/presentation/okey-table-interactions";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";
import type { Player } from "@/types/game";


const OKEY_TURN_DURATION_SECONDS = 20;
const TIMEOUT_TURN_WATCHDOG_MS = 2500;
const EMPTY_OKEY_TILES: OkeyTile[] = [];

export default function OkeyScreen() {
  return (
    <OkeyResponsiveLayoutProvider>
      <OkeyGameScreen />
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

function OkeyGameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
  matchId?: string | string[];
  tableId?: string | string[];
  table?: string | string[];
  mode?: string | string[];
}>();

const onlineMatchId =
  getRouteParam(params.matchId);

const onlineTableId =
  getRouteParam(params.tableId) ??
  getRouteParam(params.table);

const [onlineRoom, setOnlineRoom] =
  useState<OkeyRoomSnapshot | null>(null);
const [currentUserId, setCurrentUserId] = useState<string | null>(null);

const [
  leavingWaitingRoom,
  setLeavingWaitingRoom,
] = useState(false);

useEffect(() => {
  let active = true;
  void supabase.auth.getUser().then(({ data }) => {
    if (active) setCurrentUserId(data.user?.id ?? null);
  });
  return () => { active = false; };
}, []);
// Okey is an authoritative online game. A matchId is issued only by the
// matchmaking service, so a direct link must not fall back to a local game.
useEffect(() => {
  if (!onlineMatchId) {
    router.replace("/okey");
  }
}, [onlineMatchId, router]);

useEffect(() => {
  if (!onlineMatchId) {
    setOnlineRoom(null);
    return;
  }

  let active = true;

  void getOkeyRoomStatus(onlineMatchId)
    .then((room) => {
      if (active) {
        setOnlineRoom(room);
      }
    })
    .catch((error) => {
      console.warn(
        "Unable to load Okey room status",
        error,
      );
    });

  const unsubscribe = subscribeOkeyRoom(
    onlineMatchId,
    (room) => {
      if (active) {
        setOnlineRoom(room);
      }
    },
  );

  return () => {
    active = false;
    unsubscribe();
  };
}, [onlineMatchId]);

const handleCancelWaiting = useCallback(async () => {
  if (!onlineMatchId || leavingWaitingRoom || onlineRoom?.countdownEndsAt) {
    return;
  }

  setLeavingWaitingRoom(true);

  try {
    await leaveOkeyRoom(onlineMatchId);

    setOnlineRoom(null);

    router.replace("/okey");
  } catch (error) {
    console.warn(
      "Unable to leave Okey waiting room",
      error,
    );
  } finally {
    setLeavingWaitingRoom(false);
  }
}, [
  leavingWaitingRoom,
  onlineMatchId,
  onlineRoom?.countdownEndsAt,
  router,
]);

const activeOnlineMatchId =
  onlineRoom?.status === "playing"
    ? onlineMatchId
    : undefined;

const waitingForOnlinePlayers =
  Boolean(onlineMatchId) &&
  (onlineRoom === null || onlineRoom.status === "waiting");


const countdownInProgress =
  onlineRoom?.status === "waiting" &&
  onlineRoom.countdownEndsAt !== null;

const { emitFeedback } = useOkeyFeedback();
const responsiveLayout = useOkeyResponsiveLayout();
const [showGameChat, setShowGameChat] =
  useState(false);

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
  showFinishRevealPopup,
  currentRoundResult,
  matchFinished,
  matchWinnerTeamId,
  showMatchResultPopup,
  newGame,
  roundResultCountdownRemaining,
  draw,
  discard,
  moveTile,
  moveTiles,
  openMelds,
  declareKonkan,
  spendTileOnTableMeld,
  lockKonkanSetOnTable,
  playEliminated,
  pendingTimeoutDiscardTileId,
  beginTimeoutHumanTurn,
  commitPendingTimeoutDiscard,
  isAppActive,
  lifecycleResumeToken,
  isOnline,
  onlineReady,
  onlineError,
  onlineCommandPending,
  reconnectOnline,
  leaveOnlineMatch,
} = useOkeyGame(
  onlineTableId,
  activeOnlineMatchId,
);

// The hook has a fully dealt local initial value while it waits for the
// authoritative projection. Keep it behind this lifecycle boundary so waiting
// rooms never receive gameplay data or deal triggers.
const onlineGameplayReady =
  onlineRoom?.status === "playing" &&
  onlineReady &&
  state.phase === "playing";

const dealLifecycleKey = onlineGameplayReady
  ? `playing-${currentRound}-${onlineRoom?.version ?? 0}`
  : "waiting";
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [rackSetScore, setRackSetScore] = useState(0);
  const [openableRackMelds, setOpenableRackMelds] = useState<{ melds: OkeyMeld[]; score: number }>({ melds: [], score: 0 });
  const [previewMelds, setPreviewMelds] = useState<OkeyMeld[]>([]);
  const [tableMeldOffsets, setTableMeldOffsets] = useState<Record<string, MeldOffset>>({});
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [showDiscardHistory, setShowDiscardHistory] = useState(false);
  const [showFinalTileCelebration, setShowFinalTileCelebration] = useState(false);
  const [dealOrigin, setDealOrigin] = useState<{ x: number; y: number } | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<Player | null>(null);
  const {
    tileFlight,
    setTileFlight,
    hiddenRackTileIds,
    setHiddenRackTileIds,
    hideDeckTopTile,
    setHideDeckTopTile,
    hideDiscardTopTile,
    setHideDiscardTopTile,
    drawFlightTileId,
    setDrawFlightTileId,
  } = useOkeyTileFlightCoordinator();
  const [discardDropPlacement, setDiscardDropPlacement] = useState<{ tileId: string; point: { x: number; y: number }; nonce: number } | null>(null);
  const [isDiscardDragActive, setIsDiscardDragActive] = useState(false);
  const [hoveredMeldTarget, setHoveredMeldTarget] = useState<{ playerId: string; meldId: string } | null>(null);
  const [discardDragPoint, setDiscardDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [turnTimedOut, setTurnTimedOut] = useState(false);
  const [stableOpponentTileCounts, setStableOpponentTileCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(state.players.slice(1).map((player) => [player.id, player.hand.length])),
  );
  const screenRef = useRef<View | null>(null);
  const screenRectRef = useRef<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const deckTopRectRef = useRef<ScreenRect | null>(null);
  const discardTopRectRef = useRef<ScreenRect | null>(null);
  const opponentSeatRectsRef = useRef<Record<string, ScreenRect>>({});
  const previousDiscardCountRef = useRef(state.discardPile.length);
  const queuedOpponentDiscardFlightsRef = useRef<QueuedOpponentDiscardFlight[]>([]);
  const suppressNextOpponentDiscardFlightTileIdRef = useRef<string | null>(null);
  const rackRectRef = useRef<ScreenRect | null>(null);
  const rackTileRectsRef = useRef<Record<string, ScreenRect>>({});
  const pendingDrawFlightRef = useRef<{ tileId: string; tile: OkeyTile | null; sourceRect: ScreenRect; face: "front" | "back" } | null>(null);
  const timeoutDrawLandingRectRef = useRef<ScreenRect | null>(null);
  const pendingDiscardTileIdRef = useRef<string | null>(null);
  const eliminatedTurnFlightRef = useRef<EliminatedTurnFlight | null>(null);
  const discardAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTurnKeyRef = useRef<string | null>(null);
  const timeoutDrawFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackSnapshotRef = useRef<typeof state | null>(null);
  const feedbackRoundResultsCountRef = useRef(roundResults.length);
  const feedbackMatchVisibleRef = useRef(showMatchResultPopup);
  const feedbackResumeTokenRef = useRef(lifecycleResumeToken);
  const humanMeldDropZoneRef = useRef<View | null>(null);
  const meldDropRectsRef = useRef<MeldDropRect[]>([]);
  const hoveredMeldTargetRef = useRef<MeldDropRect | null>(null);
  const humanMeldDropZone = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const humanPlayer = state.players[0];
  const currentPlayer = state.players[state.currentPlayerIndex];
  const selectedTile = humanPlayer.hand.find((tile) => tile.id === selectedTileId);
  const topDiscard = state.discardPile[state.discardPile.length - 1] ?? null;
  const topDiscardOwner = state.discardOwners[state.discardOwners.length - 1] ?? null;
  const topDiscardIsBlocked = !!topDiscardOwner && !!state.players[topDiscardOwner.playerIndex]?.eliminated;
  const isHumanTurn = state.phase === "playing" && currentPlayer?.kind === "human";
  const canDraw = isHumanTurn && !humanPlayer.eliminated && !state.hasDrawnThisTurn;
  const canDrawDiscard = canDraw && !topDiscardIsBlocked;
  const canDiscard = isHumanTurn && state.hasDrawnThisTurn && !!selectedTile;
  const canDiscardTile = isHumanTurn && state.hasDrawnThisTurn;
  const requiredOpenScore = getRequiredOpenScore(state, 0);
  const previewScore = previewMelds.reduce((total, meld) => total + meld.score, 0);
  const activeOpenMelds = [...previewMelds, ...openableRackMelds.melds];
  const activeOpenScore = previewScore + openableRackMelds.score;
  const remainingMeldSlots = Math.max(0, MAX_PLAYER_MELDS - humanPlayer.melds.length);
  const canOpenActiveMelds = isHumanTurn && !humanPlayer.eliminated && (humanPlayer.konkan
    ? canDeclareKonkanOpen(state, 0)
    : activeOpenMelds.length > 0 &&
      activeOpenMelds.length <= remainingMeldSlots &&
      (humanPlayer.opened || activeOpenScore >= requiredOpenScore));
  const roundScoreDetails = useMemo(() => getRoundResultScoreDetails(state), [state]);


  useEffect(() => {
    const previous = feedbackSnapshotRef.current;
    const resumed = feedbackResumeTokenRef.current !== lifecycleResumeToken;
    feedbackResumeTokenRef.current = lifecycleResumeToken;
    if (!isAppActive || resumed || !previous) {
      feedbackSnapshotRef.current = state;
      feedbackRoundResultsCountRef.current = roundResults.length;
      feedbackMatchVisibleRef.current = showMatchResultPopup;
      return;
    }
    const previousHandCount = previous.players[previous.currentPlayerIndex]?.hand.length ?? 0;
    const currentHandCount = state.players[previous.currentPlayerIndex]?.hand.length ?? 0;
    if (currentHandCount > previousHandCount) {
      const source = state.discardPile.length < previous.discardPile.length ? "draw-discard" : "draw-deck";
      const drawn = state.players[previous.currentPlayerIndex]?.hand.find((tile) => !previous.players[previous.currentPlayerIndex]?.hand.some((entry) => entry.id === tile.id));
      emitFeedback(source, `draw:${drawn?.id ?? state.currentPlayerIndex}:${state.discardPile.length}`);
    }
    if (state.discardPile.length > previous.discardPile.length) {
      const discarded = state.discardPile[state.discardPile.length - 1];
      emitFeedback("discard", `discard:${discarded?.id ?? state.discardPile.length}`);
    }
    const previousMeldCount = previous.players.reduce((total, player) => total + player.melds.length, 0);
    const currentMeldCount = state.players.reduce((total, player) => total + player.melds.length, 0);
    if (currentMeldCount > previousMeldCount) {
      const enteredKonkan = state.players.some((player, index) => player.konkan && (!previous.players[index]?.konkan || (!previous.players[index]?.opened && player.opened)));
      emitFeedback(enteredKonkan ? "konkan" : "meld-open", `meld:${currentRound}:${currentMeldCount}`);
    }
    if (state.currentPlayerIndex !== previous.currentPlayerIndex && state.currentPlayerIndex === 0) {
      emitFeedback("turn-start", `turn:${currentRound}:${state.discardPile.length}:0`);
    }
    if (roundResults.length > feedbackRoundResultsCountRef.current) {
      const result = roundResults[roundResults.length - 1];
      const event = result?.winnerTeamId === null ? "round-draw" : result?.winnerTeamId === humanPlayer.teamId ? "round-win" : "round-loss";
      emitFeedback(event, `round-result:${result?.round ?? currentRound}`);
    }
    if (showMatchResultPopup && !feedbackMatchVisibleRef.current) {
      const event = matchWinnerTeamId === null ? "match-draw" : matchWinnerTeamId === humanPlayer.teamId ? "match-win" : "match-loss";
      emitFeedback(event, `match-result:${currentRound}:${matchScores.teamA}:${matchScores.teamB}`);
    }
    feedbackSnapshotRef.current = state;
    feedbackRoundResultsCountRef.current = roundResults.length;
    feedbackMatchVisibleRef.current = showMatchResultPopup;
  }, [currentRound, emitFeedback, humanPlayer.teamId, isAppActive, lifecycleResumeToken, matchScores.teamA, matchScores.teamB, matchWinnerTeamId, roundResults, showMatchResultPopup, state]);

  const teamScores = matchScores;
  const shouldShowScorePopup = showScoreDetails || showRoundResultPopup;
  const previewTileIds = useMemo(() => previewMelds.flatMap((meld) => meld.tiles.map((tile) => tile.id)), [previewMelds]);
  const toLocalRect = useCallback(
    (rect: ScreenRect) => toLocalScreenRect(rect, screenRectRef.current),
    [],
  );
  const measureScreen = () => {
    screenRef.current?.measureInWindow((x, y, width, height) => {
      screenRectRef.current = { x, y, width, height };
    });
  };
  const buildOpponentDiscardFlight = useCallback(
    (entry: QueuedOpponentDiscardFlight): TileFlight | null => createOpponentDiscardFlight(
      entry,
      opponentSeatRectsRef.current[entry.ownerPlayerId] ?? null,
      discardTopRectRef.current,
      screenRectRef.current,
    ),
    [],
  );

  const startNextQueuedOpponentDiscardFlight = useCallback(() => {
    while (queuedOpponentDiscardFlightsRef.current.length > 0) {
      const next = queuedOpponentDiscardFlightsRef.current.shift();
      if (!next) return false;
      const nextFlight = buildOpponentDiscardFlight(next);
      if (!nextFlight) continue;
      setHideDiscardTopTile(true);
      setTileFlight(nextFlight);
      return true;
    }
    return false;
  }, [buildOpponentDiscardFlight, setHideDiscardTopTile, setTileFlight]);
  const startTimeoutDiscardFlight = useCallback((tileId: string) => {
    const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
    const sourceRect = rackTileRectsRef.current[tileId] ?? timeoutDrawLandingRectRef.current;
    const targetRect = discardTopRectRef.current;

    if (!tile || !sourceRect || !targetRect) {
      timeoutDrawLandingRectRef.current = null;
      pendingDiscardTileIdRef.current = null;
      commitPendingTimeoutDiscard();
      return;
    }

    pendingDiscardTileIdRef.current = tileId;
    setSelectedTileId(null);
    setHiddenRackTileIds([tileId]);
    setHideDiscardTopTile(false);
    timeoutDrawLandingRectRef.current = null;
    setTileFlight({
      id: `timeout-discard-${tileId}-${Date.now()}`,
      tile,
      face: "front",
      from: toLocalRect(sourceRect),
      to: toLocalRect(targetRect),
    });
  }, [commitPendingTimeoutDiscard, humanPlayer.hand, setHiddenRackTileIds, setHideDiscardTopTile, setTileFlight, toLocalRect]);
  const finishTileFlight = () => {
    setTileFlight(null);
    setHiddenRackTileIds([]);
    setDrawFlightTileId(null);
    setHideDeckTopTile(false);
    setHideDiscardTopTile(false);

    const eliminatedFlight = eliminatedTurnFlightRef.current;
    if (eliminatedFlight?.stage === "draw") {
      eliminatedFlight.stage = "discard";
      setTileFlight({
        id: `eliminated-discard-${eliminatedFlight.tile.id}-${Date.now()}`,
        tile: eliminatedFlight.tile,
        face: "front",
        from: toLocalRect(eliminatedFlight.playerRect),
        to: toLocalRect(eliminatedFlight.discardRect),
      });
      return;
    }
    if (eliminatedFlight?.stage === "discard") {
      eliminatedFlight.stage = "committing";
      suppressNextOpponentDiscardFlightTileIdRef.current = eliminatedFlight.tile.id;
      playEliminated();
      return;
    }

    const pendingDiscardTileId = pendingDiscardTileIdRef.current;
    if (pendingDiscardTileId) {
      pendingDiscardTileIdRef.current = null;
      if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
      if (pendingTimeoutDiscardTileId === pendingDiscardTileId) {
        commitPendingTimeoutDiscard();
      } else {
        discard(pendingDiscardTileId);
      }
      return;
    }

    requestAnimationFrame(() => {
      startNextQueuedOpponentDiscardFlight();
    });
  };
  const startDrawFlight = (source: "deck" | "discard") => {
    if (!canDraw || tileFlight) return;
    const drawnTile = source === "deck" ? state.deck[0] ?? null : topDiscard;
    const sourceRect = source === "deck" ? deckTopRectRef.current : discardTopRectRef.current;
    if (!drawnTile || !sourceRect) {
      draw(source);
      return;
    }

    pendingDrawFlightRef.current = {
      tileId: drawnTile.id,
      tile: source === "deck" ? null : drawnTile,
      sourceRect,
      face: source === "deck" ? "back" : "front",
    };
    setDrawFlightTileId(drawnTile.id);
    setHiddenRackTileIds([drawnTile.id]);
    if (source === "deck") setHideDeckTopTile(true);
    if (source === "discard") setHideDiscardTopTile(true);
    draw(source);
  };
  const isPointInsideRack = (point: { x: number; y: number }) => {
    const rackRect = rackRectRef.current;
    if (!rackRect) return false;

  return (
      point.x >= rackRect.x &&
      point.x <= rackRect.x + rackRect.width &&
      point.y >= rackRect.y &&
      point.y <= rackRect.y + rackRect.height
    );
  };
  const handleDiscardDroppedOnRack = (point: { x: number; y: number }) => {
    if (!canDraw || !topDiscard || tileFlight) return false;
    if (!isPointInsideRack(point)) return false;

    const tileId = topDiscard.id;
    pendingDrawFlightRef.current = null;
    setDrawFlightTileId(null);
    setHideDiscardTopTile(false);
    setDiscardDropPlacement({ tileId, point, nonce: Date.now() });
    draw("discard");
    return true;
  };

  const isPointInsideDiscardPile = (point: { x: number; y: number }) => {
    const discardRect = discardTopRectRef.current;
    if (!discardRect) return false;
    const dropPadding = 26;
    return (
      point.x >= discardRect.x - dropPadding &&
      point.x <= discardRect.x + discardRect.width + dropPadding &&
      point.y >= discardRect.y - dropPadding &&
      point.y <= discardRect.y + discardRect.height + dropPadding
    );
  };

  const commitDiscardFromRack = (tileId: string) => {
    if (!canDiscardTile || tileFlight) return false;

    if (discardAdvanceTimerRef.current) {
      clearTimeout(discardAdvanceTimerRef.current);
      discardAdvanceTimerRef.current = null;
    }

    pendingDiscardTileIdRef.current = null;
    setSelectedTileId(null);
    setHiddenRackTileIds([tileId]);
    setHideDiscardTopTile(false);
    discard(tileId);
    return true;
  };

  const dropTileFromRack = (tileId: string, point: { x: number; y: number }) => {
    if (isPointInsideDiscardPile(point)) {
      return commitDiscardFromRack(tileId);
    }

    return dropTileOnTableMeld(tileId, point);
  };

  const startDiscardFlight = (tileId: string) => {
    if (!canDiscardTile || tileFlight) return;

    const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
    const sourceRect = rackTileRectsRef.current[tileId] ?? timeoutDrawLandingRectRef.current;
    const targetRect = discardTopRectRef.current;

    if (!tile || !sourceRect || !targetRect) {
      void commitDiscardFromRack(tileId);
      return;
    }

    if (discardAdvanceTimerRef.current) {
      clearTimeout(discardAdvanceTimerRef.current);
      discardAdvanceTimerRef.current = null;
    }

    pendingDiscardTileIdRef.current = null;
    setSelectedTileId(null);
    setHiddenRackTileIds([tileId]);
    pendingDiscardTileIdRef.current = tileId;
    setHideDiscardTopTile(false);
    setTileFlight({
      id: `discard-${tileId}-${Date.now()}`,
      tile,
      face: "front",
      from: toLocalRect(sourceRect),
      to: toLocalRect(targetRect),
    });
  };

  const completePendingDrawFlight = useCallback((tileId: string, targetRect: ScreenRect) => {
    const pending = pendingDrawFlightRef.current;
    if (!pending || pending.tileId !== tileId) return;

    pendingDrawFlightRef.current = null;
    setTileFlight({
      id: `draw-${pending.tileId}-${Date.now()}`,
      tile: pending.tile,
      face: pending.face,
      from: toLocalRect(pending.sourceRect),
      to: toLocalRect(targetRect),
    });
  }, [setTileFlight, toLocalRect]);

  useEffect(() => {
    const pendingTimeoutTileId = pendingTimeoutDiscardTileId;
    if (!pendingTimeoutTileId || tileFlight || !pendingDrawFlightRef.current || !state.hasDrawnThisTurn) return;
    if (!humanPlayer.hand.some((tile) => tile.id === pendingTimeoutTileId)) return;
    if (timeoutDrawFallbackTimerRef.current) return;

    timeoutDrawFallbackTimerRef.current = setTimeout(() => {
      timeoutDrawFallbackTimerRef.current = null;
      const stillPendingTimeoutTileId = pendingTimeoutDiscardTileId;
      if (!stillPendingTimeoutTileId || tileFlight || !pendingDrawFlightRef.current) return;
      if (!humanPlayer.hand.some((tile) => tile.id === stillPendingTimeoutTileId)) return;

      const rackRect = rackRectRef.current;
      const pendingDraw = pendingDrawFlightRef.current;
      if (!rackRect || !pendingDraw) return;
      const tileWidth = discardTopRectRef.current?.width ?? pendingDraw.sourceRect.width;
      const tileHeight = discardTopRectRef.current?.height ?? pendingDraw.sourceRect.height;
      const landingRect = {
        x: rackRect.x + rackRect.width / 2 - tileWidth / 2,
        y: rackRect.y + rackRect.height / 2 - tileHeight / 2,
        width: tileWidth,
        height: tileHeight,
      };
      timeoutDrawLandingRectRef.current = landingRect;
      completePendingDrawFlight(stillPendingTimeoutTileId, landingRect);
    }, 450);

    return () => {
      if (timeoutDrawFallbackTimerRef.current) {
        clearTimeout(timeoutDrawFallbackTimerRef.current);
        timeoutDrawFallbackTimerRef.current = null;
      }
    };
  }, [completePendingDrawFlight, humanPlayer.hand, pendingTimeoutDiscardTileId, state.hasDrawnThisTurn, tileFlight]);
  useEffect(() => {
    const pendingTimeoutTileId = pendingTimeoutDiscardTileId;
    if (!pendingTimeoutTileId || tileFlight || pendingDrawFlightRef.current || !state.hasDrawnThisTurn) return;
    if (!humanPlayer.hand.some((tile) => tile.id === pendingTimeoutTileId)) return;

    startTimeoutDiscardFlight(pendingTimeoutTileId);
  }, [humanPlayer.hand, pendingTimeoutDiscardTileId, startTimeoutDiscardFlight, state.hasDrawnThisTurn, tileFlight]);
  useEffect(() => {
    if (!pendingTimeoutDiscardTileId) {
      if (discardAdvanceTimerRef.current) {
        clearTimeout(discardAdvanceTimerRef.current);
        discardAdvanceTimerRef.current = null;
      }
      return;
    }

    if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
    discardAdvanceTimerRef.current = setTimeout(() => {
      discardAdvanceTimerRef.current = null;
      pendingDrawFlightRef.current = null;
      timeoutDrawLandingRectRef.current = null;
      pendingDiscardTileIdRef.current = null;
      setTileFlight(null);
      setDrawFlightTileId(null);
      setHiddenRackTileIds([]);
      setHideDeckTopTile(false);
      setHideDiscardTopTile(false);
      commitPendingTimeoutDiscard();
    }, TIMEOUT_TURN_WATCHDOG_MS);

    return () => {
      if (discardAdvanceTimerRef.current) {
        clearTimeout(discardAdvanceTimerRef.current);
        discardAdvanceTimerRef.current = null;
      }
    };
  }, [commitPendingTimeoutDiscard, pendingTimeoutDiscardTileId, setDrawFlightTileId, setHiddenRackTileIds, setHideDeckTopTile, setHideDiscardTopTile, setTileFlight]);
  useEffect(() => {
    const pending = pendingDrawFlightRef.current;
    if (!pending) return;
    const targetRect = rackTileRectsRef.current[pending.tileId];
    if (!targetRect) return;

    completePendingDrawFlight(pending.tileId, targetRect);
  }, [completePendingDrawFlight, humanPlayer.hand, tileFlight]);

  useLayoutEffect(() => {
    const previousCount = previousDiscardCountRef.current;
    const nextCount = state.discardPile.length;
    previousDiscardCountRef.current = nextCount;

    if (nextCount <= previousCount) return;

    const newOpponentDiscards: QueuedOpponentDiscardFlight[] = [];
    for (let index = previousCount; index < nextCount; index += 1) {
      const owner = state.discardOwners[index];
      const discardedTile = state.discardPile[index];
      if (discardedTile && suppressNextOpponentDiscardFlightTileIdRef.current === discardedTile.id) {
        suppressNextOpponentDiscardFlightTileIdRef.current = null;
        continue;
      }
      if (!owner || owner.playerIndex === 0 || !discardedTile) continue;
      newOpponentDiscards.push({
        tile: discardedTile,
        ownerPlayerId: owner.playerId,
        discardCount: index + 1,
      });
    }

    if (newOpponentDiscards.length === 0) return;

    queuedOpponentDiscardFlightsRef.current.push(...newOpponentDiscards);
    if (!tileFlight) {
      startNextQueuedOpponentDiscardFlight();
    }
  }, [startNextQueuedOpponentDiscardFlight, state.discardOwners, state.discardPile, tileFlight]);
  useEffect(() => () => {
    if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
    if (timeoutDrawFallbackTimerRef.current) clearTimeout(timeoutDrawFallbackTimerRef.current);
  }, []);

  const measureHumanMeldDropZone = () => {
    humanMeldDropZoneRef.current?.measureInWindow((x, y, width, height) => {
      humanMeldDropZone.current = { x, y, width, height };
    });
  };
  const isInsideHumanMeldDropZone = (point: { x: number; y: number }) => {
    return isPointInsideRect(point, humanMeldDropZone.current);
  };
  const registerMeldDropRect = (playerId: string, meldId: string, rect: { x: number; y: number; width: number; height: number }) => {
    meldDropRectsRef.current = [
      ...meldDropRectsRef.current.filter((entry) => entry.playerId !== playerId || entry.meldId !== meldId),
      { playerId, meldId, ...rect },
    ];
  };
  const moveTableMeld = (_playerId: string, meldId: string, offset: MeldOffset) => {
    setTableMeldOffsets((current) => ({ ...current, [meldId]: offset }));
  };
  const getClosestValidMeldDropTarget = (tileId: string, point: { x: number; y: number }) =>
    findClosestMeldDropTarget(
      meldDropRectsRef.current,
      point,
      (rect) => canLockKonkanSet(state, 0, tileId, rect.playerId, rect.meldId)
        || canSpendTileOnMeld(state, 0, tileId, rect.playerId, rect.meldId),
    );
  const updateTileDragMeldTarget = (tileId: string | null, point: { x: number; y: number } | null) => {
    const target = tileId && point ? getClosestValidMeldDropTarget(tileId, point) : null;
    hoveredMeldTargetRef.current = target;
    setHoveredMeldTarget((current) =>
      current?.playerId === target?.playerId && current?.meldId === target?.meldId
        ? current
        : target ? { playerId: target.playerId, meldId: target.meldId } : null,
    );
  };
  const dropTileOnTableMeld = (tileId: string, _point: { x: number; y: number }) => {
    if (!isHumanTurn) return false;
    const target = hoveredMeldTargetRef.current;
    if (!target) return false;

    if (canLockKonkanSet(state, 0, tileId, target.playerId, target.meldId)) {
      lockKonkanSetOnTable(tileId, target.playerId, target.meldId);
      setSelectedTileId(null);
      return true;
    }
    if (!canSpendTileOnMeld(state, 0, tileId, target.playerId, target.meldId)) return false;

    spendTileOnTableMeld(tileId, target.playerId, target.meldId);
    setSelectedTileId(null);
    return true;
  };
  const addPreviewMeld = (meld: OkeyMeld, point: { x: number; y: number }) => {
    if (!isHumanTurn) return false;
    if (!isInsideHumanMeldDropZone(point)) return false;
    if (previewMelds.length >= remainingMeldSlots) return false;
    const existingIds = new Set(previewMelds.flatMap((entry) => entry.tiles.map((tile) => tile.id)));
    if (meld.tiles.some((tile) => existingIds.has(tile.id))) return false;

    const nextMelds = [
      ...previewMelds,
      { ...meld, id: `human-preview-${Date.now()}-${previewMelds.length}` },
    ];
    const nextScore = nextMelds.reduce((total, entry) => total + entry.score, 0);

    if (humanPlayer.opened || nextScore >= requiredOpenScore) {
      openMelds(nextMelds, nextScore);
      setPreviewMelds([]);
    } else {
      setPreviewMelds(nextMelds);
    }
    setSelectedTileId(null);
    return true;
  };
  useEffect(() => {
    if (lifecycleResumeToken === 0) return;
    if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
    if (timeoutDrawFallbackTimerRef.current) clearTimeout(timeoutDrawFallbackTimerRef.current);
    discardAdvanceTimerRef.current = null;
    timeoutDrawFallbackTimerRef.current = null;
    pendingDrawFlightRef.current = null;
    pendingDiscardTileIdRef.current = null;
    eliminatedTurnFlightRef.current = null;
    queuedOpponentDiscardFlightsRef.current = [];
    timeoutTurnKeyRef.current = null;
    setTileFlight(null);
    setHiddenRackTileIds([]);
    setHideDeckTopTile(false);
    setHideDiscardTopTile(false);
    setDrawFlightTileId(null);
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
    setDiscardDragPoint(null);
    setTurnTimedOut(false);
  }, [lifecycleResumeToken, setDrawFlightTileId, setHiddenRackTileIds, setHideDeckTopTile, setHideDiscardTopTile, setTileFlight]);

  const turnTimerVisible = onlineGameplayReady && (state.phase === "playing" || showFinishRevealPopup);
  const turnTimerResetKey = `${currentRound}-${state.currentPlayerIndex}-${state.phase}`;

useEffect(() => {
  if (
    isOnline ||
    !isAppActive ||
    state.phase !== "playing"
  ) {
    setTurnTimedOut(false);
    return;
  }

    timeoutTurnKeyRef.current = null;
    setTurnTimedOut(false);
    const turnKey = `${currentRound}-${state.currentPlayerIndex}`;
    const warning = setTimeout(() => emitFeedback("timeout-warning", `timeout-warning:${turnKey}`), (OKEY_TURN_DURATION_SECONDS - 5) * 1000);
    const timeout = setTimeout(() => {
      emitFeedback("timeout", `timeout:${turnKey}`);
      setTurnTimedOut(true);
    }, OKEY_TURN_DURATION_SECONDS * 1000);
    return () => {
      clearTimeout(warning);
      clearTimeout(timeout);
    };
}, [
  currentRound,
  emitFeedback,
  isAppActive,
  isOnline,
  state.currentPlayerIndex,
  state.phase,
]);

  useEffect(() => {
    // Timeout is resolved once for the whole player turn. Drawing a tile changes
    // hasDrawnThisTurn, but it must not create a second timeout for the same turn.
    const turnKey = `${currentRound}-${state.currentPlayerIndex}`;
if (
  isOnline ||
  !isAppActive ||
  state.phase !== "playing" ||
  state.currentPlayerIndex !== 0 ||
  !turnTimedOut
) {
  return;
}    if (timeoutTurnKeyRef.current === turnKey) return;
    if (tileFlight || pendingTimeoutDiscardTileId || pendingDiscardTileIdRef.current) return;

    // Lock the turn before starting draw/discard state updates or animations.
    timeoutTurnKeyRef.current = turnKey;
    setSelectedTileId(null);

    if (!state.hasDrawnThisTurn) {
      const forcedTile = state.deck[0] ?? null;
      if (!forcedTile) {
        beginTimeoutHumanTurn();
        return;
      }
      if (deckTopRectRef.current) {
        pendingDrawFlightRef.current = {
          tileId: forcedTile.id,
          tile: null,
          sourceRect: deckTopRectRef.current,
          face: "back",
        };
        setDrawFlightTileId(forcedTile.id);
        setHiddenRackTileIds([forcedTile.id]);
        setHideDeckTopTile(true);
      }
      beginTimeoutHumanTurn();
      return;
    }

    beginTimeoutHumanTurn();
  }, [beginTimeoutHumanTurn, currentRound, isAppActive, pendingTimeoutDiscardTileId, setDrawFlightTileId, setHiddenRackTileIds, setHideDeckTopTile, state.currentPlayerIndex, state.deck, state.hasDrawnThisTurn, state.phase, tileFlight, turnTimedOut]);
  useEffect(() => {
    const pending = eliminatedTurnFlightRef.current;
    if (pending?.stage === "committing") {
      if (state.currentPlayerIndex !== pending.playerIndex) eliminatedTurnFlightRef.current = null;
      return;
    }
    if (!isAppActive || pending || tileFlight || state.phase !== "playing") return;

    const playerIndex = state.currentPlayerIndex;
    const player = state.players[playerIndex];
    if (!player?.eliminated) return;

    const timer = setTimeout(() => {
      const tile = state.deck[0];
      const deckRect = deckTopRectRef.current;
      const discardRect = discardTopRectRef.current;
      const playerAreaRect = playerIndex === 0 ? rackRectRef.current : opponentSeatRectsRef.current[player.id];
      if (!tile || !deckRect || !discardRect || !playerAreaRect) {
        playEliminated();
        return;
      }

      const playerRect = {
        x: playerAreaRect.x + playerAreaRect.width / 2 - discardRect.width / 2,
        y: playerAreaRect.y + playerAreaRect.height / 2 - discardRect.height / 2,
        width: discardRect.width,
        height: discardRect.height,
      };
      eliminatedTurnFlightRef.current = {
        playerIndex,
        playerId: player.id,
        tile,
        stage: "draw",
        playerRect,
        discardRect,
      };
      setHideDeckTopTile(true);
      setTileFlight({
        id: `eliminated-draw-${tile.id}-${Date.now()}`,
        tile: null,
        face: "back",
        from: toLocalRect(deckRect),
        to: toLocalRect(playerRect),
      });
    }, 650);

    return () => clearTimeout(timer);
  }, [isAppActive, playEliminated, setHideDeckTopTile, setTileFlight, state.currentPlayerIndex, state.deck, state.phase, state.players, tileFlight, toLocalRect]);
  useEffect(() => {
    setStableOpponentTileCounts((current) => {
      const next = Object.fromEntries(
        state.players.slice(1).map((player) => [player.id, player.hand.length]),
      );
      const unchanged =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([playerId, count]) => current[playerId] === count);
      return unchanged ? current : next;
    });
  }, [state.players]);
  const localPlayerIndex = useMemo(
    () => onlineRoom?.members.find((member) => member.userId === currentUserId)?.playerIndex ?? null,
    [currentUserId, onlineRoom?.members],
  );
  const relativeSeatMap = useMemo(
    () => localPlayerIndex === null ? null : getRelativeSeatMap(localPlayerIndex),
    [localPlayerIndex],
  );
  const playerByServerIndex = useMemo(() => {
    const byIndex = new Map<number, typeof state.players[number]>();
    for (const member of onlineRoom?.members ?? []) {
      const player = state.players.find((entry) => entry.id === member.userId);
      if (player) byIndex.set(member.playerIndex, player);
    }
    return byIndex;
  }, [onlineRoom?.members, state.players]);
  const playerForSeat = useCallback((seat: RelativeSeat) => {
    if (!relativeSeatMap) return null;
    return playerByServerIndex.get(relativeSeatMap[seat]) ?? null;
  }, [playerByServerIndex, relativeSeatMap]);
  const opponentSeats = useMemo(
    () => (["top", "left", "right"] as const).map((side) => {
      const serverIndex = relativeSeatMap?.[side] ?? null;
      const member = serverIndex === null ? null : onlineRoom?.members.find((entry) => entry.playerIndex === serverIndex) ?? null;
      const player = playerForSeat(side);
      return {
        side,
        id: player?.id ?? member?.userId ?? `waiting-${side}`,
        name: member?.displayName ?? "",
        count: onlineGameplayReady ? (player ? stableOpponentTileCounts[player.id] ?? player.hand.length : 0) : 0,
        active: onlineGameplayReady && currentPlayer?.id === player?.id,
        timerResetKey: turnTimerResetKey,
        dealResetKey: dealLifecycleKey,
      };
    }),
    [currentPlayer?.id, dealLifecycleKey, onlineGameplayReady, onlineRoom?.members, playerForSeat, relativeSeatMap, stableOpponentTileCounts, turnTimerResetKey],
  );
  const seatOrderedPlayers = useMemo(() => {
    if (!relativeSeatMap) return [state.players[0], state.players[2], state.players[3], state.players[1]];
    return ["bottom", "top", "left", "right"].map((seat) => playerForSeat(seat as RelativeSeat) ?? state.players[0]);
  }, [playerForSeat, relativeSeatMap, state.players]);
  const openOpponentProfile = useStableEvent((playerId: string, seat: Player["seat"]) => {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) return;
    const tileCount = stableOpponentTileCounts[player.id] ?? player.hand.length;
    setProfilePlayer({
      id: player.id,
      name: player.name,
      seat,
      kind: player.kind,
      teamId: player.teamId,
      isActive: currentPlayer?.id === player.id,
      timeLeft: OKEY_TURN_DURATION_SECONDS,
      tileCount,
      score: 0,
      isLeader: false,
      avatarId: player.kind === "bot" ? "bot-avatar" : undefined,
    });
  });

  const handleTopOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[0]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
  });
  const handleLeftOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[1]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
  });
  const handleRightOpponentMeasured = useStableEvent((rect: ScreenRect) => {
    const playerId = opponentSeats[2]?.id;
    if (playerId) opponentSeatRectsRef.current[playerId] = rect;
  });
  const handleMeldMeasured = useStableEvent(registerMeldDropRect);
  const handleMeldOffsetChange = useStableEvent(moveTableMeld);
  const handleDrawDeck = useStableEvent(() => startDrawFlight("deck"));
  const handleDrawDiscard = useStableEvent(() => startDrawFlight("discard"));
  const handleViewDiscards = useStableEvent(() => setShowDiscardHistory(true));
  const handleDiscardDroppedOnRackStable = useStableEvent(handleDiscardDroppedOnRack);
  const handleDeckMeasured = useStableEvent((rect: ScreenRect) => {
    deckTopRectRef.current = rect;
  });
  const handleDiscardMeasured = useStableEvent((rect: ScreenRect) => {
    discardTopRectRef.current = rect;
    const nextOrigin = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    setDealOrigin((current) =>
      current?.x === nextOrigin.x && current?.y === nextOrigin.y ? current : nextOrigin,
    );
  });
  const handleRackTileSelect = useStableEvent((tileId: string) => {
    if (canDiscard && selectedTileId === tileId) {
      startDiscardFlight(tileId);
      return;
    }
    setSelectedTileId((current) => (current === tileId ? null : tileId));
    emitFeedback("rack-select", `rack-select:${tileId}:${Date.now()}`);
  });
  const handleDropMeldGroup = useStableEvent((meld: OkeyMeld, point: { x: number; y: number }) => {
    const accepted = addPreviewMeld(meld, point);
    emitFeedback(accepted ? "rack-move" : "invalid", `meld-drop:${meld.id}:${Date.now()}`);
    return accepted;
  });
  const handleDropTile = useStableEvent((tileId: string, point: { x: number; y: number }) => {
    const accepted = dropTileFromRack(tileId, point);
    emitFeedback(accepted ? "rack-move" : "invalid", `tile-drop:${tileId}:${Date.now()}`);
    return accepted;
  });
  const handleTileDragPointChange = useStableEvent(updateTileDragMeldTarget);
  const handleExternalDropPlaced = useStableEvent((tileId: string, targetIndex: number) => {
    moveTile(tileId, targetIndex);
    setSelectedTileId(tileId);
    setDiscardDropPlacement(null);
    setDiscardDragPoint(null);
  });
  const handleRackMeasured = useStableEvent((rect: ScreenRect) => {
    rackRectRef.current = rect;
  });
  const handleRackTileMeasured = useStableEvent((tileId: string, rect: ScreenRect) => {
    rackTileRectsRef.current[tileId] = rect;
    completePendingDrawFlight(tileId, rect);
  });
  const handleMoveRackTile = useStableEvent((tileId: string, targetIndex: number) => {
    moveTile(tileId, targetIndex);
    setSelectedTileId(tileId);
    emitFeedback("rack-move", `rack-move:${tileId}:${targetIndex}:${Date.now()}`);
  });
  const handleMoveRackTiles = useStableEvent((tileIds: string[], targetIndex: number) => {
    moveTiles(tileIds, targetIndex);
    setSelectedTileId(tileIds[0] ?? null);
    emitFeedback("rack-move", `rack-group:${tileIds.join("-")}:${targetIndex}:${Date.now()}`);
  });
  const skipEnterAnimationTileIds = useMemo(
    () => [
      ...(drawFlightTileId ? [drawFlightTileId] : []),
      ...(discardDropPlacement ? [discardDropPlacement.tileId] : []),
    ],
    [discardDropPlacement, drawFlightTileId],
  );
  useEffect(() => {
    setPreviewMelds([]);
    setSelectedTileId(null);
    setShowScoreDetails(false);
  }, [currentRound]);

  useEffect(() => {
    if (!showFinishRevealPopup) {
      setShowFinalTileCelebration(false);
      return;
    }
    if (tileFlight) return;

    const timer = setTimeout(() => setShowFinalTileCelebration(true), 350);
    return () => clearTimeout(timer);
  }, [showFinishRevealPopup, tileFlight]);


  
  return (
<TableBackground>
  <View
    ref={screenRef}
    onLayout={measureScreen}
    style={[styles.screen, responsiveLayout.screen]}
  >

<WaitingPlayersPopup
  visible={waitingForOnlinePlayers}
  memberCount={onlineRoom?.memberCount ?? 0}
  entryFee={onlineRoom?.entryFee ?? 0}
  currency={onlineRoom?.currency ?? "fun"}
  members={onlineRoom?.members ?? []}
  countdownEndsAt={onlineRoom?.countdownEndsAt ?? null}
  canCancel={!countdownInProgress}
  loading={leavingWaitingRoom}
  onCancel={handleCancelWaiting}
/>

<ConnectionOverlay
  visible={
    isOnline &&
    !onlineReady &&
    !waitingForOnlinePlayers
  }
/>

<ConnectionErrorBanner
  visible={isOnline && !!onlineError}
  loading={onlineCommandPending}
  onRetry={reconnectOnline}
/>


{!showMatchMenu ? (
  <GameControls
    onOpenMenu={openMatchMenu}
    onOpenChat={() => setShowGameChat(true)}
  />
) : null}


        <View style={[styles.tableArea, isDiscardDragActive && styles.activeDiscardDragTableLayer]}>
          <View style={styles.tableSurface}>
            <View style={styles.feltTexture} />
            <MemoizedOkeyOpponentSeat {...opponentSeats[0]} side="top" dealOrder={2} dealOrigin={dealOrigin} onMeasured={handleTopOpponentMeasured} onPress={opponentSeats[0]?.name ? () => openOpponentProfile(opponentSeats[0]?.id ?? "", "top") : undefined} />
            <MemoizedOkeyOpponentSeat {...opponentSeats[1]} side="left" dealOrder={1} dealOrigin={dealOrigin} onMeasured={handleLeftOpponentMeasured} onPress={opponentSeats[1]?.name ? () => openOpponentProfile(opponentSeats[1]?.id ?? "", "left") : undefined} />
            <MemoizedOkeyOpponentSeat {...opponentSeats[2]} side="right" dealOrder={3} dealOrigin={dealOrigin} onMeasured={handleRightOpponentMeasured} onPress={opponentSeats[2]?.name ? () => openOpponentProfile(opponentSeats[2]?.id ?? "", "right") : undefined} />
            <MemoizedOkeyTableMeldAreas
              players={seatOrderedPlayers}
              okeyTile={state.okeyTile}
              onMeldMeasured={handleMeldMeasured}
              meldOffsets={tableMeldOffsets}
              onMeldOffsetChange={handleMeldOffsetChange}
              highlightedMeldId={hoveredMeldTarget?.meldId ?? null}
            />
            <View
              ref={humanMeldDropZoneRef}
              pointerEvents="box-none"
              onLayout={measureHumanMeldDropZone}
              style={[styles.meldArea, responsiveLayout.meldAreas.bottom, styles.humanMeldDropZone]}
            >
              <View pointerEvents="auto" style={[styles.previewMeldContent, responsiveLayout.meldContent]}>
                {chunkOkeyMeldRows(previewMelds).map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.meldRow}>
                    {row.map((meld) => (
                      <Pressable
                        key={meld.id}
                        onPress={() => setPreviewMelds((current) => current.filter((entry) => entry.id !== meld.id))}
                      >
                        <OkeyMeldView meld={meld} okeyTile={state.okeyTile} />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            </View>
            {onlineGameplayReady ? (
              <MemoizedOkeyCenterPiles
                deckCount={state.deck.length}
                topDiscard={topDiscard}
                discardCount={state.discardPile.length}
                canDraw={canDraw}
                canDrawDiscard={canDrawDiscard}
                indicatorTile={state.indicatorTile}
                okeyTile={state.okeyTile}
                onDrawDeck={handleDrawDeck}
                onDrawDiscard={handleDrawDiscard}
                onViewDiscards={handleViewDiscards}
                onDiscardDroppedOnRack={handleDiscardDroppedOnRackStable}
                onDiscardDragActiveChange={setIsDiscardDragActive}
                onDiscardDragPointChange={setDiscardDragPoint}
                onDeckMeasured={handleDeckMeasured}
                onDiscardMeasured={handleDiscardMeasured}
                hideTopDeckTile={hideDeckTopTile}
                hideTopDiscardTile={hideDiscardTopTile}
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
        <OkeyScoreDetailsPopup
          visible={shouldShowScorePopup}
          onClose={showRoundResultPopup ? undefined : () => setShowScoreDetails(false)}
          scoreDetails={currentRoundResult?.scoreDetails ?? roundScoreDetails}
          finishedMessage={showRoundResultPopup && state.endReason === "win" ? "خولەکە تەواو بوو" : undefined}
          round={currentRound}
          maxRounds={maxRounds}
          roundResults={roundResults}
          matchScores={matchScores}
          matchFinished={matchFinished}
          matchWinnerTeamId={matchWinnerTeamId}
          countdownRemaining={roundResultCountdownRemaining}
          isTileCycleLimit={showRoundResultPopup && state.endReason === "tile-cycle-limit"}
        />
        <OkeyMatchResultPopup
          visible={showMatchResultPopup}
          winnerTeamId={matchWinnerTeamId}
          matchScores={matchScores}
          onNewMatch={() => {
            setPreviewMelds([]);
            setSelectedTileId(null);
            setShowScoreDetails(false);
            newGame();
          }}
        />
        {showFinalTileCelebration ? (
          <OkeyFinalTileCelebration
            tile={topDiscard ?? state.indicatorTile}
            okeyTile={state.okeyTile}
            sourceRect={discardTopRectRef.current ? toLocalRect(discardTopRectRef.current) : null}
          />
        ) : null}
        <OkeyPlayerSetScore
          score={previewMelds.length > 0 ? activeOpenScore : rackSetScore}
          canOpen={canOpenActiveMelds}
          konkan={humanPlayer.konkan}
          onOpen={() => {
            if (!canOpenActiveMelds) return;
            if (humanPlayer.konkan) {
              declareKonkan();
            } else {
              openMelds(activeOpenMelds, activeOpenScore);
            }
            setPreviewMelds([]);
            setSelectedTileId(null);
          }}
        />
        <MemoizedOkeyPlayerRack
          tiles={onlineGameplayReady ? humanPlayer.hand : EMPTY_OKEY_TILES}
          selectedTileId={selectedTileId}
          okeyTile={state.okeyTile}
          onSelectTile={handleRackTileSelect}

          onRackScoreChange={setRackSetScore}
          onOpenableMeldsChange={setOpenableRackMelds}
          stagedTileIds={previewTileIds}
          onDropMeldGroup={handleDropMeldGroup}
          onDropTile={handleDropTile}
          onTileDragPointChange={handleTileDragPointChange}
          hiddenTileIds={hiddenRackTileIds}
          skipEnterAnimationTileIds={skipEnterAnimationTileIds}
          fixedDrawTileId={drawFlightTileId}
          externalDropPlacement={discardDropPlacement}
          externalHoverPoint={discardDragPoint}
          eliminated={!!humanPlayer.eliminated}
          onExternalDropPlaced={handleExternalDropPlaced}

          turnTimerActive={turnTimerVisible && state.currentPlayerIndex === 0}
          turnTimerResetKey={turnTimerResetKey}
          dealResetKey={dealLifecycleKey}
          isDealer={onlineGameplayReady && state.dealerIndex === 0}
          dealOrigin={dealOrigin}
          onRackMeasured={handleRackMeasured}
          onTileMeasured={handleRackTileMeasured}

          onMoveTile={handleMoveRackTile}

          onMoveTiles={handleMoveRackTiles}

        />
        {tileFlight ? (
          <OkeyTileFlightOverlay key={tileFlight.id} flight={tileFlight} okeyTile={state.okeyTile} onDone={finishTileFlight} />
        ) : null}
      </View>
      <PlayerProfilePopup
        player={profilePlayer}
        onDismiss={() => setProfilePlayer(null)}
      />
      <GameChatDrawer
        visible={showGameChat}
        mode="2v2"
        roomId=""
        enabled={false}
        onClose={() => setShowGameChat(false)}
      />
<MatchMenuDrawer
  visible={showMatchMenu}
  players={seatOrderedPlayers}
  humanPlayer={humanPlayer}
  translateX={matchMenuTranslateX}
  onClose={closeMatchMenu}
  onLeavePress={() => {
    closeMatchMenu();

    if (isOnline) {
      void leaveOnlineMatch()
        .catch((error) => {
          console.warn(
            "Unable to leave Okey match",
            error,
          );
        })
        .finally(() => {
          router.replace("/okey");
        });

      return;
    }

    router.replace("/okey");
  }}
/>



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