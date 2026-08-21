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

import GameChatDrawer, { type GameChatTransport } from "@/components/game/GameChatDrawer";
import type { GameChatMessage } from "@/lib/gameChat";
import { useGameParty } from "@/lib/gameInvitesProvider";
import WaitingPlayersPopup from "@/okey/components/WaitingPlayersPopup";
import GameControls from "@/okey/components/GameControls";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import PlayerProfilePopup from "@/components/game/PlayerProfilePopup";
import TableBackground from "@/components/game/TableBackground";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { supabase } from "@/lib/supabase";
import { MemoizedOkeyCenterPiles } from "@/okey/components/OkeyCenterPiles";
import { OkeyDiscardHistoryPopup } from "@/okey/components/OkeyDiscardHistoryPopup";
import { OkeyFinalTileCelebration } from "@/okey/components/OkeyFinalTileCelebration";
import { OkeyMatchResultPopup } from "@/okey/components/OkeyMatchResultPopup";
import OkeyLeaveMatchConfirmPopup, { type OkeyMatchMode } from "@/okey/components/OkeyLeaveMatchConfirmPopup";
import { chunkOkeyMeldRows, OkeyMeldView } from "@/okey/components/OkeyMeldView";
import { MemoizedOkeyOpponentSeat } from "@/okey/components/OkeyOpponentSeat";
import { MemoizedOkeyPlayerRack } from "@/okey/components/OkeyPlayerRack";
import { OkeyPlayerSetScore } from "@/okey/components/OkeyPlayerSetScore";
import { OkeyScoreDetailsPopup } from "@/okey/components/OkeyScoreDetailsPopup";
import { MemoizedOkeyTableMeldAreas } from "@/okey/components/OkeyTableMeldAreas";
import { styles } from "@/okey/components/okeyStyles";
import { canDeclareKonkanOpen, canLockKonkanSet, canSpendTileOnMeld, getRequiredOpenScore, getRoundResultScoreDetails, MAX_PLAYER_MELDS } from "@/okey/engine/okey-engine";
import { getOrderedKonkanRunCandidates } from "@/okey/engine/okey-rack-layout";
import { useOkeyFeedback } from "@/okey/hooks/useOkeyFeedback";
import { useOkeyGame } from "@/okey/hooks/useOkeyGame";
import { mapOkeySettlementToPopupRewards } from "@/okey/presentation/okey-match-rewards";
import type { OkeyGameController } from "@/okey/controllers/okey-game-controller";
import { useOkeyTileFlightCoordinator } from "@/okey/hooks/useOkeyTileFlightCoordinator";
import { useStableEvent } from "@/okey/hooks/useStableEvent";
import { OkeyResponsiveLayoutProvider, useOkeyResponsiveLayout } from "@/okey/layout/OkeyResponsiveLayoutProvider";
import {
  getOkeyRoomStatus,
  leaveOkeyRoom,
  subscribeOkeyRoom,
  getOkeyChatMessages,
  sendOkeyChatMessage,
  subscribeOkeyChat,
  type OkeyRoomSnapshot,
} from "@/okey/multiplayer/okey-room-api";
import { getRelativeSeatMap, type RelativeSeat } from "@/okey/multiplayer/relative-seat-map";
import { OkeyTileFlightOverlay } from "@/okey/presentation/OkeyTileFlightOverlay";
import {
  createOkeyMeldPresentationFrames,
  isOkeyTurnPresentationBlocked,
  type EliminatedTurnFlight,
  type MeldDropRect,
  type MeldOffset,
  type QueuedOpponentDiscardFlight,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import {
  createOpponentDiscardFlight,
  findClosestMeldDropTarget,
  isPointInsideRect,
  toLocalScreenRect,
} from "@/okey/presentation/okey-table-interactions";
import type {
  OkeyMeld,
  OkeyTeamId,
  OkeyTile,
} from "@/okey/types/okey";import type { Player } from "@/domino/types/domino-game";


const OKEY_TURN_DURATION_SECONDS = 20;
const TIMEOUT_TURN_WATCHDOG_MS = 2500;
const BOT_DECISION_PAUSE_MS = 2200;
const BOT_MELD_ACTION_GAP_MS = 650;
const BOT_DISCARD_AFTER_ACTION_MS = 450;
const EMPTY_OKEY_TILES: OkeyTile[] = [];

type OkeyGameTableSceneProps = {
  controller?: OkeyGameController;
  preview?: boolean;
};

export default function OkeyGameTableScene(props: OkeyGameTableSceneProps) {
  return (
    <OkeyResponsiveLayoutProvider>
      <OkeyGameTableSceneContent {...props} />
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

function OkeyGameTableSceneContent({ controller, preview = false }: OkeyGameTableSceneProps) {
  const router = useRouter();
  const { party } = useGameParty();
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

const okeyMatchMode: OkeyMatchMode =
  getRouteParam(params.mode) === "aznif"
    ? "aznif"
    : "fun";

const [onlineRoom, setOnlineRoom] =
  useState<OkeyRoomSnapshot | null>(null);
const [currentUserId, setCurrentUserId] = useState<string | null>(null);

const [
  leavingWaitingRoom,
  setLeavingWaitingRoom,
] = useState(false);

useEffect(() => {
  if (preview) return;
  let active = true;
  void supabase.auth.getUser().then(({ data }) => {
    if (active) setCurrentUserId(data.user?.id ?? null);
  });
  return () => { active = false; };
}, [preview]);
// Okey is an authoritative online game. A matchId is issued only by the
// matchmaking service, so a direct link must not fall back to a local game.
useEffect(() => {
  if (!preview && !onlineMatchId) {
    router.replace("/okey");
  }
}, [onlineMatchId, preview, router]);

useEffect(() => {
  if (preview) {
    setOnlineRoom(null);
    return;
  }
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
}, [onlineMatchId, preview]);

useEffect(() => {
  if (
    preview ||
    !onlineMatchId ||
    !currentUserId ||
    !party ||
    party.leaderId === currentUserId ||
    party.flowStatus !== "idle"
  ) {
    return;
  }

  setOnlineRoom(null);
  router.replace("/okey");
}, [currentUserId, onlineMatchId, party, preview, router]);
const handleCancelWaiting = useCallback(async () => {
  if (
    !onlineMatchId || leavingWaitingRoom || onlineRoom?.countdownEndsAt ||
    (party && party.leaderId !== currentUserId)
  ) {
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
  party,
  currentUserId,
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

const [initialStartTransitionMatchId, setInitialStartTransitionMatchId] =
  useState<string | null>(null);

useEffect(() => {
  if (
    onlineMatchId &&
    onlineRoom?.matchId === onlineMatchId &&
    onlineRoom.status === "waiting" &&
    onlineRoom.countdownEndsAt !== null
  ) {
    setInitialStartTransitionMatchId(onlineMatchId);
  }
}, [
  onlineMatchId,
  onlineRoom?.countdownEndsAt,
  onlineRoom?.matchId,
  onlineRoom?.status,
]);

const { emitFeedback } = useOkeyFeedback();
const responsiveLayout = useOkeyResponsiveLayout();
const [showGameChat, setShowGameChat] =
  useState(false);
const [showLeaveConfirm, setShowLeaveConfirm] =
  useState(false);
const [isLeavingMatch, setIsLeavingMatch] =
  useState(false);
const okeyChatMembersRef = useRef(onlineRoom?.members ?? []);
okeyChatMembersRef.current = onlineRoom?.members ?? [];

const okeyChatTransport = useMemo<GameChatTransport>(() => {
  const normalize = (message: Awaited<ReturnType<typeof sendOkeyChatMessage>>): GameChatMessage => {
    const member = okeyChatMembersRef.current.find((entry) => entry.userId === message.user_id);
    return {
      id: message.id,
      mode: "2v2",
      room_id: message.match_id,
      sender_user_id: message.user_id,
      sender_name: member?.displayName ?? "Player",
      sender_avatar_id: null,
      sender_avatar_url: member?.avatarUrl ?? null,
      body: message.body,
      created_at: message.created_at,
    };
  };

  return {
    getMessages: async (matchId) => (await getOkeyChatMessages(matchId)).map(normalize),
    sendMessage: async (matchId, body) => normalize(await sendOkeyChatMessage(matchId, body)),
    subscribe: subscribeOkeyChat,
  };
}, []);

const onlineController = useOkeyGame(
  onlineTableId,
  activeOnlineMatchId,
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
  setTurnPresentationBlocked,
  isOnline,
  onlineReady,
  onlineProjection,
  onlineAdapter,
  leaveOnlineMatch,
} = controller ?? onlineController;

const takeoverExitStartedRef = useRef(false);

useEffect(() => {
  if (preview || !onlineMatchId || !onlineReady || !onlineProjection) return;

  const viewer = onlineProjection.players.find((player) =>
    Array.isArray(player.hand),
  );

  if (
    (viewer?.controlledByBot === true || viewer?.kind === "bot") &&
    !takeoverExitStartedRef.current
  ) {
    takeoverExitStartedRef.current = true;
    // Timeout takeover already ended this Human's control of the seat.
    // Navigating away tears down room heartbeats, realtime subscriptions and
    // scheduled client timeout claims. Do not turn takeover into manual leave.
    router.replace("/okey");
  }
}, [onlineMatchId, onlineProjection, onlineReady, preview, router]);

const handleConfirmLeaveMatch = useCallback(async () => {
  if (isLeavingMatch) return;

  setIsLeavingMatch(true);
  try {
    await leaveOnlineMatch();
    setShowLeaveConfirm(false);
    router.replace("/okey");
  } catch (error) {
    console.warn("Unable to leave Okey match", error);
    setIsLeavingMatch(false);
  }
}, [isLeavingMatch, leaveOnlineMatch, router]);

// The hook has a fully dealt local initial value while it waits for the
// authoritative projection. Keep it behind this lifecycle boundary so waiting
// rooms never receive gameplay data or deal triggers.
const onlineGameplayReady =
  preview || (
    onlineRoom?.status === "playing" &&
    onlineReady &&
    state.phase === "playing"
  );

const initialStartTransitionPending =
  initialStartTransitionMatchId === onlineMatchId &&
  !onlineGameplayReady;

const shouldShowWaitingPlayers =
  waitingForOnlinePlayers || initialStartTransitionPending;

useEffect(() => {
  if (
    initialStartTransitionMatchId !== null &&
    (initialStartTransitionMatchId !== onlineMatchId || onlineGameplayReady)
  ) {
    setInitialStartTransitionMatchId(null);
  }
}, [initialStartTransitionMatchId, onlineGameplayReady, onlineMatchId]);

const dealLifecycleKey = onlineGameplayReady
  ? `playing-${onlineMatchId ?? "preview"}-${currentRound}`
  : "waiting";
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [rackSetScore, setRackSetScore] = useState(0);
  const [openableRackMelds, setOpenableRackMelds] = useState<{ melds: OkeyMeld[]; score: number; contiguousGroups: OkeyTile[][] }>({ melds: [], score: 0, contiguousGroups: [] });
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
  const [discardPresentationFallback, setDiscardPresentationFallback] = useState<OkeyTile | null>(null);
  const [
  opponentTurnTransitionActive,
  setOpponentTurnTransitionActive,
] = useState(false);
  const [stableOpponentTileCounts, setStableOpponentTileCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(state.players.slice(1).map((player) => [player.id, player.hand.length])),
  );
  const [presentedTablePlayers, setPresentedTablePlayers] = useState(() => state.players);
  const presentedTablePlayersRef = useRef(state.players);
  const screenRef = useRef<View | null>(null);
  const screenRectRef = useRef<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const deckTopRectRef = useRef<ScreenRect | null>(null);
  const discardTopRectRef = useRef<ScreenRect | null>(null);
  const opponentSeatRectsRef = useRef<Record<string, ScreenRect>>({});
  const previousDiscardCountRef = useRef(state.discardPile.length);
  const previousDiscardTopTileRef = useRef<OkeyTile | null>(state.discardPile[state.discardPile.length - 1] ?? null);
  const previousDeckCountRef = useRef(state.deck.length);
  // PRESENTATION CONTRACT (tested): these queues preserve draw → discard order
  // across asynchronous authoritative snapshots. Do not collapse or reorder them
  // without exercising every seat and both split/coalesced server updates.
  const queuedOpponentWallDrawFlightsRef = useRef<{ ownerPlayerId: string; eventId: string; source: "deck" | "discard"; tile: OkeyTile | null }[]>([]);
  const pendingOpponentDiscardAfterDrawRef = useRef<QueuedOpponentDiscardFlight | null>(null);
  const queuedOpponentDiscardFlightsRef = useRef<QueuedOpponentDiscardFlight[]>([]);
  const pendingOpponentMeldTargetRef = useRef<typeof state.players | null>(null);
  const botPresentationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextOpponentDiscardFlightTileIdRef = useRef<string | null>(null);
  const rackRectRef = useRef<ScreenRect | null>(null);
  const rackTileRectsRef = useRef<Record<string, ScreenRect>>({});
  const pendingDrawFlightRef = useRef<{ tileId: string; tile: OkeyTile | null; sourceRect: ScreenRect; face: "front" | "back" } | null>(null);
  const timeoutDrawLandingRectRef = useRef<ScreenRect | null>(null);
  const pendingDiscardTileIdRef = useRef<string | null>(null);
  const pendingDiscardLandingTileIdRef = useRef<string | null>(null);
  const awaitingDiscardRemovalTileIdRef = useRef<string | null>(null);
  const onlineTimeoutDiscardFlightRef = useRef<{
    eventId: string;
    tile: OkeyTile;
    stage: "deck-to-rack" | "rack-to-discard";
    rackRect: ScreenRect;
    discardRect: ScreenRect;
    previousDiscard: OkeyTile | null;
  } | null>(null);
  const handledOnlineTimeoutDiscardEventIdRef = useRef<string | null>(null);
  const onlineTimeoutProjectionInitializedRef = useRef(false);
  const onlineTimeoutMatchIdRef = useRef<string | undefined>(undefined);
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
  // State can advance one render before the previous opponent's discard
  // animation is queued. Keep the next timer stopped during that render too.
  const hasUnpresentedOpponentDiscard = state.discardPile
    .slice(previousDiscardCountRef.current)
    .some((_, offset) => state.discardOwners[previousDiscardCountRef.current + offset]?.playerIndex !== 0);
  const pendingHumanHandRemovalTileId = awaitingDiscardRemovalTileIdRef.current;
  const hasPendingHumanHandRemoval = !!pendingHumanHandRemovalTileId
    && humanPlayer.hand.some((tile) => tile.id === pendingHumanHandRemovalTileId);
  const turnPresentationBlocked = isOkeyTurnPresentationBlocked({
    opponentTransitionActive: opponentTurnTransitionActive,
    hasUnpresentedOpponentDiscard,
    hasTileFlight: !!tileFlight,
    hasPendingHumanHandRemoval,
  });
  useEffect(() => {
    setTurnPresentationBlocked(turnPresentationBlocked);
    return () => setTurnPresentationBlocked(false);
  }, [setTurnPresentationBlocked, turnPresentationBlocked]);
  const isHumanTurn =
  state.phase === "playing" &&
  currentPlayer?.kind === "human" &&
  !turnPresentationBlocked;
  const canDraw = isHumanTurn && !humanPlayer.eliminated && !state.hasDrawnThisTurn;
  const canDrawDiscard = canDraw && !topDiscardIsBlocked;
  const canDiscard = isHumanTurn && state.hasDrawnThisTurn && !!selectedTile;
  const canDiscardTile = isHumanTurn && state.hasDrawnThisTurn;
  const requiredOpenScore = getRequiredOpenScore(state, 0);
  const previewScore = previewMelds.reduce((total, meld) => total + meld.score, 0);
  const activeOpenMelds = [...previewMelds, ...openableRackMelds.melds];
  const activeOpenScore = previewScore + openableRackMelds.score;
  const orderedKonkanRunTileIds = useMemo(() => {
    return getOrderedKonkanRunCandidates(openableRackMelds.contiguousGroups)
      .find((tileIds) => canDeclareKonkanOpen(state, 0, tileIds)) ?? null;
  }, [openableRackMelds.contiguousGroups, state]);
  const remainingMeldSlots = Math.max(0, MAX_PLAYER_MELDS - humanPlayer.melds.length);
  const canOpenActiveMelds = isHumanTurn && !humanPlayer.eliminated && (humanPlayer.konkan
    ? orderedKonkanRunTileIds !== null
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


const viewerTeamId: OkeyTeamId =
  humanPlayer.teamId === "teamB"
    ? "teamB"
    : "teamA";

const opponentTeamId: OkeyTeamId =
  viewerTeamId === "teamA"
    ? "teamB"
    : "teamA";

const teamScores:
  Record<OkeyTeamId, number> = {
  teamA:
    matchScores[viewerTeamId],

  teamB:
    matchScores[opponentTeamId],
};

const displayRoundResults = useMemo(
  () =>
    roundResults.map((result) => {
      const displayWinnerTeamId: OkeyTeamId | null =
        result.winnerTeamId === null
          ? null
          : result.winnerTeamId === viewerTeamId
            ? "teamA"
            : "teamB";

      return {
        ...result,
        winnerTeamId: displayWinnerTeamId,
        scoreDetails: {
          ...result.scoreDetails,
          scores: {
            teamA: result.scoreDetails.scores[viewerTeamId],
            teamB: result.scoreDetails.scores[opponentTeamId],
          },
        },
      };
    }),
  [opponentTeamId, roundResults, viewerTeamId],
);

const playerNamesById = useMemo(
  () =>
    state.players.reduce<Record<string, string>>(
      (names, player) => ({
        ...names,
        [player.id]: player.name,
      }),
      {},
    ),
  [state.players],
);

const rawCurrentScoreDetails =
  currentRoundResult
    ?.scoreDetails ??
  roundScoreDetails;


const displayCurrentRoundScoreDetails =
  useMemo(
    () => ({
      ...rawCurrentScoreDetails,

      scores: {
        teamA:
          rawCurrentScoreDetails
            .scores[
              viewerTeamId
            ],

        teamB:
          rawCurrentScoreDetails
            .scores[
              opponentTeamId
            ],
      },
    }),
    [
      opponentTeamId,
      rawCurrentScoreDetails,
      viewerTeamId,
    ],
  );

const displayMatchWinnerTeamId:
  OkeyTeamId | null =
  matchWinnerTeamId === null
    ? null
    : matchWinnerTeamId ===
        viewerTeamId
      ? "teamA"
      : "teamB";

const matchSettlementRewards = useMemo(
  () => mapOkeySettlementToPopupRewards(
    onlineProjection?.settlement,
    matchWinnerTeamId,
    viewerTeamId,
  ),
  [matchWinnerTeamId, onlineProjection?.settlement, viewerTeamId],
);
const matchSettlementLoading =
  isOnline && matchFinished && !onlineProjection?.settlement;

useEffect(() => {
  if (!matchSettlementLoading || !onlineAdapter) return;

  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const refreshSettlement = async () => {
    if (cancelled) return;
    attempts += 1;
    try {
      await onlineAdapter.refresh();
    } catch {
      // Settlement recovery is idempotent; retry briefly while the popup loads.
    }

    if (!cancelled && attempts < 4) {
      retryTimer = setTimeout(refreshSettlement, 500);
    }
  };

  void refreshSettlement();
  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
  };
}, [matchSettlementLoading, onlineAdapter]);
const shouldShowScorePopup =
  showScoreDetails ||
  showRoundResultPopup;
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

const setPresentedPlayers = useCallback((players: typeof state.players) => {
    presentedTablePlayersRef.current = players;
    setPresentedTablePlayers(players);
  }, []);

  useEffect(() => {
    if (
      state.currentPlayerIndex !== 0 ||
      opponentTurnTransitionActive ||
      hasUnpresentedOpponentDiscard ||
      botPresentationTimerRef.current
    ) return;
    setPresentedPlayers(state.players);
  }, [hasUnpresentedOpponentDiscard, opponentTurnTransitionActive, setPresentedPlayers, state.currentPlayerIndex, state.players]);


  const startOpponentPostDrawSequence = useCallback((pendingDiscard: QueuedOpponentDiscardFlight) => {
    if (botPresentationTimerRef.current) clearTimeout(botPresentationTimerRef.current);
    const targetPlayers = pendingOpponentMeldTargetRef.current ?? state.players;
    const frames = createOkeyMeldPresentationFrames(presentedTablePlayersRef.current, targetPlayers);

    const startDiscard = () => {
      botPresentationTimerRef.current = null;
      pendingOpponentMeldTargetRef.current = null;
      setPresentedPlayers(targetPlayers);
      const discardFlight = buildOpponentDiscardFlight(pendingDiscard);
      if (!discardFlight) {
        setHideDiscardTopTile(false);
        setDiscardPresentationFallback(null);
        setOpponentTurnTransitionActive(false);
        return;
      }
      setDiscardPresentationFallback(state.discardPile[pendingDiscard.discardCount - 2] ?? null);
      setHideDiscardTopTile(true);
      setTileFlight(discardFlight);
    };

    const revealFrame = (index: number) => {
      if (index >= frames.length) {
        botPresentationTimerRef.current = setTimeout(startDiscard, BOT_DISCARD_AFTER_ACTION_MS);
        return;
      }
      setPresentedPlayers(frames[index]);
      botPresentationTimerRef.current = setTimeout(
        () => revealFrame(index + 1),
        BOT_MELD_ACTION_GAP_MS,
      );
    };

    botPresentationTimerRef.current = setTimeout(
      () => revealFrame(0),
      BOT_DECISION_PAUSE_MS,
    );
  }, [buildOpponentDiscardFlight, setHideDiscardTopTile, setPresentedPlayers, setTileFlight, state.discardPile, state.players]);
  // INTENTIONAL / TESTED: peek first, then shift only after both screen rects
  // exist. Shifting before measurement silently loses one player's animation.
  // Do not simplify this queue flow without full multiplayer presentation tests.
  const startNextQueuedOpponentDiscardFlight = useCallback(() => {
    const nextDraw = queuedOpponentWallDrawFlightsRef.current[0];
    if (nextDraw) {
      const sourceRect = nextDraw.source === "deck"
        ? deckTopRectRef.current
        : discardTopRectRef.current;
      const seatRect = opponentSeatRectsRef.current[nextDraw.ownerPlayerId] ?? null;
      if (sourceRect && seatRect) {
        queuedOpponentWallDrawFlightsRef.current.shift();
        const landingRect = {
          x: seatRect.x + seatRect.width / 2 - sourceRect.width / 2,
          y: seatRect.y + seatRect.height / 2 - sourceRect.height / 2,
          width: sourceRect.width,
          height: sourceRect.height,
        };
        if (nextDraw.source === "deck") setHideDeckTopTile(true);
        else setHideDiscardTopTile(true);
        setTileFlight({
          id: `opponent-draw-${nextDraw.eventId}`,
          tile: nextDraw.tile,
          face: nextDraw.source === "discard" ? "front" : "back",
          from: toLocalRect(sourceRect),
          to: toLocalRect(landingRect),
        });
        return true;
      }
      // Keep the event until both layout rects are available.
      return false;
    }

    while (queuedOpponentDiscardFlightsRef.current.length > 0) {
      const next = queuedOpponentDiscardFlightsRef.current[0];
      if (!next) return false;
      const previousDiscard = state.discardPile[next.discardCount - 2] ?? null;

      if (next.animateWallDraw) {
        const deckRect = deckTopRectRef.current;
        const seatRect = opponentSeatRectsRef.current[next.ownerPlayerId] ?? null;
        if (deckRect && seatRect) {
          queuedOpponentDiscardFlightsRef.current.shift();
          const landingRect = {
            x: seatRect.x + seatRect.width / 2 - deckRect.width / 2,
            y: seatRect.y + seatRect.height / 2 - deckRect.height / 2,
            width: deckRect.width,
            height: deckRect.height,
          };
          pendingOpponentDiscardAfterDrawRef.current = next;
          setDiscardPresentationFallback(previousDiscard);
          setHideDeckTopTile(true);
          setHideDiscardTopTile(true);
          setTileFlight({
            id: `opponent-draw-${next.ownerPlayerId}-${next.discardCount}`,
            tile: null,
            face: "back",
            from: toLocalRect(deckRect),
            to: toLocalRect(landingRect),
          });
          return true;
        }
        return false;
      }

      // The authoritative discard is already in state. Keep it hidden from the
      // first presentation frame so it cannot appear on the pile before flying.
      setDiscardPresentationFallback(previousDiscard);
      setHideDiscardTopTile(true);
      queuedOpponentDiscardFlightsRef.current.shift();
      startOpponentPostDrawSequence(next);
      return true;
    }
    return false;
  }, [setHideDeckTopTile, setHideDiscardTopTile, setTileFlight, startOpponentPostDrawSequence, state.discardPile, toLocalRect]);
  // Measurement may finish after an authoritative event. Retrying here is what
  // releases the intentionally retained queue item; it is not redundant work.
  const retryQueuedOpponentFlight = () => {
    if (tileFlight || onlineTimeoutDiscardFlightRef.current) return;
    if (
      queuedOpponentWallDrawFlightsRef.current.length === 0 &&
      queuedOpponentDiscardFlightsRef.current.length === 0
    ) return;
    startNextQueuedOpponentDiscardFlight();
  };
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
  // PRESENTATION CONTRACT (tested): discard landing is a two-phase handoff.
  // Keep this ordering unless the complete draw/discard animation suite is run;
  // otherwise the previous top discard can flash after the flight lands.
  const finishTileFlight = () => {
    const pendingDiscardTileId = pendingDiscardTileIdRef.current;
    const landedDiscardTile = tileFlight?.id.includes("discard-")
      ? tileFlight.tile
      : null;
    // When an opponent's draw and discard arrive in the same authoritative
    // update, the discard already exists in state while the draw is flying.
    // Keep that new top tile concealed until its second flight starts; clearing
    // this here briefly revealed it during the bot decision pause.
    const pendingOpponentDiscard = pendingOpponentDiscardAfterDrawRef.current;
    setTileFlight(null);
    // Online discard confirmation can arrive after the flight completes. Keep
    // the tile hidden until the authoritative hand no longer contains it so it
    // cannot flash back into the rack between animation and confirmation.
    setHiddenRackTileIds(pendingDiscardTileId ? [pendingDiscardTileId] : []);
    setDrawFlightTileId(null);
    setHideDeckTopTile(false);
    if (pendingOpponentDiscard) {
      // Preserve the old top only while the following discard flight is pending.
      setHideDiscardTopTile(true);
    } else if (landedDiscardTile) {
      // Keep the landed tile on top until the authoritative pile contains it.
      // This prevents the old discard from flashing during a delayed update.
      setDiscardPresentationFallback(landedDiscardTile);
      if (topDiscard?.id === landedDiscardTile.id) {
        setHideDiscardTopTile(false);
        setDiscardPresentationFallback(null);
      } else {
        pendingDiscardLandingTileIdRef.current = landedDiscardTile.id;
        setHideDiscardTopTile(true);
      }
    } else {
      setHideDiscardTopTile(false);
      setDiscardPresentationFallback(null);
    }

    const onlineTimeoutFlight = onlineTimeoutDiscardFlightRef.current;
    if (onlineTimeoutFlight?.stage === "deck-to-rack") {
      onlineTimeoutFlight.stage = "rack-to-discard";
      setDiscardPresentationFallback(onlineTimeoutFlight.previousDiscard);
      setHideDiscardTopTile(true);
      setTileFlight({
        id: `online-timeout-discard-${onlineTimeoutFlight.eventId}`,
        tile: onlineTimeoutFlight.tile,
        face: "front",
        from: toLocalRect(onlineTimeoutFlight.rackRect),
        to: toLocalRect(onlineTimeoutFlight.discardRect),
      });
      return;
    }
    if (onlineTimeoutFlight?.stage === "rack-to-discard") {
      onlineTimeoutDiscardFlightRef.current = null;
      requestAnimationFrame(() => {
        const started = startNextQueuedOpponentDiscardFlight();
        if (!started) setOpponentTurnTransitionActive(false);
      });
      return;
    }

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

    if (pendingOpponentDiscard) {
      pendingOpponentDiscardAfterDrawRef.current = null;
      startOpponentPostDrawSequence(pendingOpponentDiscard);
      return;
    }
    if (pendingDiscardTileId) {
      pendingDiscardTileIdRef.current = null;
      awaitingDiscardRemovalTileIdRef.current = pendingDiscardTileId;
      if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
      if (pendingTimeoutDiscardTileId === pendingDiscardTileId) {
        commitPendingTimeoutDiscard();
      } else {
        discard(pendingDiscardTileId);
      }
      return;
    }

requestAnimationFrame(() => {
  const started =
    startNextQueuedOpponentDiscardFlight();

  if (!started) {
    setOpponentTurnTransitionActive(false);
  }
});
  };
  // Release the landing fallback only after authoritative state confirms the same
  // tile. This covers delayed online confirmation without touching game logic.
  useEffect(() => {
    const pendingTileId = pendingDiscardLandingTileIdRef.current;
    if (!pendingTileId || topDiscard?.id !== pendingTileId) return;

    pendingDiscardLandingTileIdRef.current = null;
    setHideDiscardTopTile(false);
    setDiscardPresentationFallback((current) =>
      current?.id === pendingTileId ? null : current,
    );
  }, [setHideDiscardTopTile, topDiscard?.id]);
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
    awaitingDiscardRemovalTileIdRef.current = tileId;
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

  useLayoutEffect(() => {
    if (!isOnline || !onlineProjection) return;

    if (onlineTimeoutMatchIdRef.current !== onlineMatchId) {
      onlineTimeoutMatchIdRef.current = onlineMatchId;
      onlineTimeoutProjectionInitializedRef.current = false;
      handledOnlineTimeoutDiscardEventIdRef.current = null;
    }

    const event = onlineProjection.lastTimeoutDiscardEvent;
    if (!onlineTimeoutProjectionInitializedRef.current) {
      onlineTimeoutProjectionInitializedRef.current = true;
      handledOnlineTimeoutDiscardEventIdRef.current = event?.id ?? null;
      return;
    }

    if (!event || handledOnlineTimeoutDiscardEventIdRef.current === event.id) return;
    if (event.playerId !== humanPlayer.id) {
      handledOnlineTimeoutDiscardEventIdRef.current = event.id;
      return;
    }
    if (tileFlight || onlineTimeoutDiscardFlightRef.current) return;

    const tile = humanPlayer.hand.find((entry) => entry.id === event.tileId)
      ?? state.discardPile.find((entry) => entry.id === event.tileId);
    const timeoutDiscardIndex = state.discardPile.findIndex((entry) => entry.id === event.tileId);
    const previousDiscard = timeoutDiscardIndex > 0
      ? state.discardPile[timeoutDiscardIndex - 1] ?? null
      : null;
    const discardRect = discardTopRectRef.current;
    const rackRect = rackTileRectsRef.current[event.tileId];
    const deckRect = deckTopRectRef.current;
    const rackAreaRect = rackRectRef.current;
    if (!tile || !discardRect) return;

    if (event.source === "rack") {
      if (!rackRect) return;
      handledOnlineTimeoutDiscardEventIdRef.current = event.id;
      onlineTimeoutDiscardFlightRef.current = {
        eventId: event.id,
        tile,
        stage: "rack-to-discard",
        rackRect,
        discardRect,
        previousDiscard,
      };
      setOpponentTurnTransitionActive(true);
      setDiscardPresentationFallback(previousDiscard);
      setHideDiscardTopTile(true);
      setTileFlight({
        id: `online-timeout-discard-${event.id}`,
        tile,
        face: "front",
        from: toLocalRect(rackRect),
        to: toLocalRect(discardRect),
      });
      return;
    }

    if (!deckRect || !rackAreaRect) return;
    const deckLandingRect = {
      x: rackAreaRect.x + rackAreaRect.width / 2 - discardRect.width / 2,
      y: rackAreaRect.y + rackAreaRect.height / 2 - discardRect.height / 2,
      width: discardRect.width,
      height: discardRect.height,
    };
    handledOnlineTimeoutDiscardEventIdRef.current = event.id;
    onlineTimeoutDiscardFlightRef.current = {
      eventId: event.id,
      tile,
      stage: "deck-to-rack",
      rackRect: deckLandingRect,
      discardRect,
      previousDiscard,
    };
    setOpponentTurnTransitionActive(true);
    setDiscardPresentationFallback(previousDiscard);
    setHideDeckTopTile(true);
    setHideDiscardTopTile(true);
    setTileFlight({
      id: `online-timeout-draw-${event.id}`,
      tile: null,
      face: "back",
      from: toLocalRect(deckRect),
      to: toLocalRect(deckLandingRect),
    });
  }, [humanPlayer.hand, humanPlayer.id, isOnline, onlineMatchId, onlineProjection, setHideDeckTopTile, setHideDiscardTopTile, setTileFlight, state.discardPile, tileFlight, toLocalRect]);

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
  useEffect(() => {
    const tileId = awaitingDiscardRemovalTileIdRef.current;
    if (!tileId || humanPlayer.hand.some((tile) => tile.id === tileId)) return;

    awaitingDiscardRemovalTileIdRef.current = null;
    setHiddenRackTileIds((current) => current.filter((entry) => entry !== tileId));
  }, [humanPlayer.hand, setHiddenRackTileIds]);

  useLayoutEffect(() => {
    const previousCount = previousDiscardCountRef.current;
    const previousDiscardTopTile = previousDiscardTopTileRef.current;
    const nextCount = state.discardPile.length;
    previousDiscardCountRef.current = nextCount;
    previousDiscardTopTileRef.current = state.discardPile[nextCount - 1] ?? null;
    const wallDrawsThisUpdate = Math.max(0, previousDeckCountRef.current - state.deck.length);
    const discardDrawsThisUpdate = Math.max(0, previousCount - nextCount);
    previousDeckCountRef.current = state.deck.length;

    if (nextCount <= previousCount) {
      // A wall draw is its own presentation event. Queue/start it on the draw
      // state update instead of holding it until a later discard update.
      const opponent = state.currentPlayerIndex === 0
        ? null
        : state.players[state.currentPlayerIndex] ?? null;
      if ((wallDrawsThisUpdate > 0 || discardDrawsThisUpdate > 0) && opponent) {
        const source = discardDrawsThisUpdate > 0 ? "discard" as const : "deck" as const;
        queuedOpponentWallDrawFlightsRef.current.push({
          ownerPlayerId: opponent.id,
          eventId: `${opponent.id}-${source}-${state.deck.length}-${nextCount}`,
          source,
          tile: source === "discard" ? previousDiscardTopTile : null,
        });
        setOpponentTurnTransitionActive(true);
        if (!tileFlight && !onlineTimeoutDiscardFlightRef.current) {
          const started = startNextQueuedOpponentDiscardFlight();
          if (!started) setOpponentTurnTransitionActive(false);
        }
      }
      return;
    }

    let remainingWallDraws = wallDrawsThisUpdate;

    const newOpponentDiscards: QueuedOpponentDiscardFlight[] = [];
    for (let index = previousCount; index < nextCount; index += 1) {
      const owner = state.discardOwners[index];
      const discardedTile = state.discardPile[index];
      const animateWallDraw = !!owner && owner.playerIndex !== 0 && remainingWallDraws-- > 0;
      if (discardedTile && suppressNextOpponentDiscardFlightTileIdRef.current === discardedTile.id) {
        suppressNextOpponentDiscardFlightTileIdRef.current = null;
        continue;
      }
      if (!owner || owner.playerIndex === 0 || !discardedTile) continue;
      newOpponentDiscards.push({
        tile: discardedTile,
        ownerPlayerId: owner.playerId,
        discardCount: index + 1,
        animateWallDraw,
      });
    }


if (newOpponentDiscards.length === 0) return;

setOpponentTurnTransitionActive(true);

pendingOpponentMeldTargetRef.current = state.players;

queuedOpponentDiscardFlightsRef.current.push(
  ...newOpponentDiscards,
);

if (!tileFlight && !onlineTimeoutDiscardFlightRef.current) {
  const started =
    startNextQueuedOpponentDiscardFlight();

  if (!started) {
    setOpponentTurnTransitionActive(false);
  }
}
  }, [startNextQueuedOpponentDiscardFlight, state.currentPlayerIndex, state.deck.length, state.discardOwners, state.discardPile, state.players, tileFlight]);
  useEffect(() => () => {
    if (discardAdvanceTimerRef.current) clearTimeout(discardAdvanceTimerRef.current);
    if (timeoutDrawFallbackTimerRef.current) clearTimeout(timeoutDrawFallbackTimerRef.current);
    if (botPresentationTimerRef.current) clearTimeout(botPresentationTimerRef.current);
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
      awaitingDiscardRemovalTileIdRef.current = tileId;
      setHiddenRackTileIds([tileId]);
      lockKonkanSetOnTable(tileId, target.playerId, target.meldId);
      setSelectedTileId(null);
      return true;
    }
    if (!canSpendTileOnMeld(state, 0, tileId, target.playerId, target.meldId)) return false;

    awaitingDiscardRemovalTileIdRef.current = tileId;
    setHiddenRackTileIds([tileId]);
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
    pendingOpponentMeldTargetRef.current = null;
    if (botPresentationTimerRef.current) clearTimeout(botPresentationTimerRef.current);
    botPresentationTimerRef.current = null;
    setPresentedPlayers(state.players);
    onlineTimeoutDiscardFlightRef.current = null;
    eliminatedTurnFlightRef.current = null;
    queuedOpponentDiscardFlightsRef.current = [];
    timeoutTurnKeyRef.current = null;
    setTileFlight(null);
    setHiddenRackTileIds([]);
    setHideDeckTopTile(false);
    setHideDiscardTopTile(false);
    setDiscardPresentationFallback(null);
    setDrawFlightTileId(null);
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
    setDiscardDragPoint(null);
    setTurnTimedOut(false);
    setOpponentTurnTransitionActive(false);
  }, [lifecycleResumeToken, setDrawFlightTileId, setHiddenRackTileIds, setHideDeckTopTile, setHideDiscardTopTile, setTileFlight]);

  const turnTimerVisible = onlineGameplayReady && (state.phase === "playing" || showFinishRevealPopup);
  const turnTimerResetKey = `${currentRound}-${state.currentPlayerIndex}-${state.phase}`;

useEffect(() => {
  if (
    isOnline ||
    !isAppActive ||
    state.phase !== "playing" ||
    turnPresentationBlocked
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
  turnPresentationBlocked,
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
      const previewPlayerIndex = side === "top" ? 2 : side === "left" ? 3 : 1;
      const player = preview ? state.players[previewPlayerIndex] ?? null : playerForSeat(side);
      return {
        side,
        id: player?.id ?? member?.userId ?? `waiting-${side}`,
        name: player?.name ?? member?.displayName ?? "",
        count: onlineGameplayReady ? (player ? stableOpponentTileCounts[player.id] ?? player.hand.length : 0) : 0,
        active: onlineGameplayReady && !turnPresentationBlocked && currentPlayer?.id === player?.id,
        timerResetKey: turnTimerResetKey,
        dealResetKey: dealLifecycleKey,
      };
    }),
    [currentPlayer?.id, dealLifecycleKey, onlineGameplayReady, onlineRoom?.members, playerForSeat, preview, relativeSeatMap, stableOpponentTileCounts, state.players, turnPresentationBlocked, turnTimerResetKey],
  );
  const seatOrderedPlayers = useMemo(() => {
    if (!relativeSeatMap) return [state.players[0], state.players[2], state.players[3], state.players[1]];
    return ["bottom", "top", "left", "right"].map((seat) => playerForSeat(seat as RelativeSeat) ?? state.players[0]);
  }, [playerForSeat, relativeSeatMap, state.players]);
  const presentedSeatOrderedPlayers = useMemo(() =>
    seatOrderedPlayers.map((player) =>
      presentedTablePlayers.find((entry) => entry.id === player.id) ?? player,
    ),
  [presentedTablePlayers, seatOrderedPlayers]);
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
  const handleMeldOffsetChange = useStableEvent(moveTableMeld);
  const handleDrawDeck = useStableEvent(() => startDrawFlight("deck"));
  const handleDrawDiscard = useStableEvent(() => startDrawFlight("discard"));
  const handleViewDiscards = useStableEvent(() => setShowDiscardHistory(true));
  const handleDiscardDroppedOnRackStable = useStableEvent(handleDiscardDroppedOnRack);
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
  visible={shouldShowWaitingPlayers}
  memberCount={onlineRoom?.memberCount ?? 0}
  entryFee={onlineRoom?.entryFee ?? 0}
  currency={onlineRoom?.currency ?? "fun"}
  members={onlineRoom?.members ?? []}
  countdownEndsAt={onlineRoom?.countdownEndsAt ?? null}
  canCancel={
    !countdownInProgress &&
    !initialStartTransitionPending &&
    (!party || party.leaderId === currentUserId)
  }
  loading={leavingWaitingRoom}
  onCancel={handleCancelWaiting}
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

    <MemoizedOkeyOpponentSeat
      key={`${dealLifecycleKey}-top`}
      {...opponentSeats[0]}
      playerId={opponentSeats[0]?.id}
      side="top"
      dealOrder={2}
      dealOrigin={dealOrigin}
      onMeasured={handleTopOpponentMeasured}
      onPress={
        opponentSeats[0]?.name
          ? () => openOpponentProfile(opponentSeats[0]?.id ?? "", "top")
          : undefined
      }
    />

    <MemoizedOkeyOpponentSeat
      key={`${dealLifecycleKey}-left`}
      {...opponentSeats[1]}
      playerId={opponentSeats[1]?.id}
      side="left"
      dealOrder={3}
      dealOrigin={dealOrigin}
      onMeasured={handleLeftOpponentMeasured}
      onPress={
        opponentSeats[1]?.name
          ? () => openOpponentProfile(opponentSeats[1]?.id ?? "", "left")
          : undefined
      }
    />

    <MemoizedOkeyOpponentSeat
      key={`${dealLifecycleKey}-right`}
      {...opponentSeats[2]}
      playerId={opponentSeats[2]?.id}
      side="right"
      dealOrder={1}
      dealOrigin={dealOrigin}
      onMeasured={handleRightOpponentMeasured}
      onPress={
        opponentSeats[2]?.name
          ? () => openOpponentProfile(opponentSeats[2]?.id ?? "", "right")
          : undefined
      }
    />

    <MemoizedOkeyTableMeldAreas
      players={presentedSeatOrderedPlayers}
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
              <View pointerEvents="auto" style={styles.previewMeldContent}>
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
<OkeyScoreDetailsPopup
  visible={shouldShowScorePopup}
  onClose={showRoundResultPopup ? undefined : () => setShowScoreDetails(false)}
  scoreDetails={displayCurrentRoundScoreDetails}
  round={currentRoundResult?.round ?? currentRound}
  playerNamesById={playerNamesById}
  maxRounds={maxRounds}
  roundResults={displayRoundResults}
  matchScores={teamScores}
  countdownRemaining={roundResultCountdownRemaining}
  isTileCycleLimit={
    showRoundResultPopup &&
    currentRoundResult?.endReason === "tile-cycle-limit"
  }
/>

<OkeyMatchResultPopup
  visible={showMatchResultPopup}
  winnerTeamId={displayMatchWinnerTeamId}
  matchScores={teamScores}
  rewards={matchSettlementRewards}
  rewardsLoading={matchSettlementLoading}
  onNewMatch={() => {
    router.replace("/okey");
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
          targetScore={
  humanPlayer.opened
    ? humanPlayer.scoreOpened
    : requiredOpenScore
}
          canOpen={canOpenActiveMelds}
          konkan={humanPlayer.konkan}
          onOpen={() => {
            if (!canOpenActiveMelds) return;
            if (humanPlayer.konkan) {
              if (orderedKonkanRunTileIds) declareKonkan(orderedKonkanRunTileIds);
            } else {
              openMelds(activeOpenMelds, activeOpenScore);
            }
            setPreviewMelds([]);
            setSelectedTileId(null);
          }}
        />
        <MemoizedOkeyPlayerRack
          key={`${dealLifecycleKey}-rack`}
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

turnTimerActive={
  turnTimerVisible &&
  state.currentPlayerIndex === 0 &&
  !turnPresentationBlocked
}          turnTimerResetKey={turnTimerResetKey}
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
        roomId={onlineMatchId ?? ""}
        currentUserId={currentUserId}
        enabled={!!onlineMatchId && !!currentUserId && onlineRoom?.status !== "waiting"}
        transport={okeyChatTransport}
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
    setShowLeaveConfirm(true);
  }}
/>
<OkeyLeaveMatchConfirmPopup
  visible={showLeaveConfirm}
  mode={okeyMatchMode}
  loading={isLeavingMatch}
  onCancel={() => setShowLeaveConfirm(false)}
  onConfirm={() => {
    void handleConfirmLeaveMatch();
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

