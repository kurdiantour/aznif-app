import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, } from "react-native";

import GameChatDrawer, { type GameChatTransport } from "@/components/game/GameChatDrawer";
import type { GameChatMessage } from "@/lib/gameChat";
import { useGameParty } from "@/lib/gameInvitesProvider";
import WaitingPlayersPopup from "@/okey/components/WaitingPlayersPopup";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import PlayerProfilePopup from "@/components/game/PlayerProfilePopup";
import TableBackground from "@/components/game/TableBackground";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { supabase } from "@/lib/supabase";
import { MemoizedOkeyCenterPiles } from "@/okey/components/OkeyCenterPiles";
import { OkeyDiscardHistoryPopup } from "@/okey/components/OkeyDiscardHistoryPopup";
import { OkeyFinalTileCelebration } from "@/okey/components/OkeyFinalTileCelebration";
import { mapOkeySettlementToPopupRewards, OkeyMatchResultPopup } from "@/okey/components/OkeyMatchResultPopup";
import OkeyLeaveMatchConfirmPopup, { type OkeyMatchMode } from "@/okey/components/OkeyLeaveMatchConfirmPopup";
import { chunkOkeyMeldRows, OkeyMeldView } from "@/okey/components/OkeyMeldView";
import { MemoizedOkeyOpponentSeat } from "@/okey/components/OkeyOpponentSeat";
import { MemoizedOkeyPlayerRack } from "@/okey/components/OkeyPlayerRack";
import { OkeyScoreDetailsPopup } from "@/okey/components/OkeyScoreDetailsPopup";
import { MemoizedOkeyTableMeldAreas } from "@/okey/components/OkeyTableMeldAreas";
import { styles } from "@/okey/components/okeyStyles";
import { getOkeyOpenAction, getOkeyRackDiscardAction, getRoundResultScoreDetails, resolveTableMeldAction } from "@/okey/engine/okey-engine";
import { getOrderedKonkanRunCandidates } from "@/okey/engine/okey-rack-layout";
import { useOkeyFeedback, useOkeyGameFeedback } from "@/okey/hooks/useOkeyFeedback";
import { useOkeyGame } from "@/okey/hooks/useOkeyGame";
import { selectOkeyTurnView } from "@/okey/selectors/okey-turn-view";
import { useOkeyOpponentTileFlightCoordinator, useOkeyTileFlightCompletion, useOkeyTileFlightCoordinator, useOkeyTimeoutTileFlightCoordinator } from "@/okey/hooks/useOkeyTileFlightCoordinator";
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
import { OkeyTileFlightOverlay } from "@/okey/presentation/OkeyTileFlightOverlay";
import {
  type MeldDropRect,
  type MeldOffset,
  type ScreenRect,
  type TileFlight,
} from "@/okey/presentation/okey-game-presentation";
import {
  findClosestMeldDropTarget,
  isPointInsideRect,
  toLocalScreenRect,
} from "@/okey/presentation/okey-table-interactions";
import type {
  OkeyMeld,
  OkeyTeamId,
  OkeyTile,
} from "@/okey/types/okey";import type { Player } from "@/domino/types/domino-game";


const EMPTY_OKEY_TILES: OkeyTile[] = [];
const PLAYER_PREVIEW_MELD_TILE_WIDTH = 22;
const PLAYER_PREVIEW_MELD_TILE_HEIGHT = 29;

type RelativeSeat = "bottom" | "right" | "top" | "left";

function getRelativeSeatMap(localPlayerIndex: number): Record<RelativeSeat, number> {
  const local = ((localPlayerIndex % 4) + 4) % 4;
  return {
    bottom: local,
    right: (local + 1) % 4,
    top: (local + 2) % 4,
    left: (local + 3) % 4,
  };
}

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
  const { party } = useGameParty();
  const params = useLocalSearchParams<{
  matchId?: string | string[];
  mode?: string | string[];
}>();

const onlineMatchId =
  getRouteParam(params.matchId);

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

useEffect(() => {
  if (
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
}, [currentUserId, onlineMatchId, party, router]);
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
  showFinishRevealPopup,
  currentRoundResult,
  matchFinished,
  matchWinnerTeamId,
  showMatchResultPopup,
  roundResultCountdownRemaining,
  draw,
  discard,
  commitOpenIntent,
  declareKonkan,
  spendTileOnTableMeld,
  lockKonkanSetOnTable,
  turnTimeLeft,
  isAppActive,
  lifecycleResumeToken,
  onlineProjection,
  onlineAdapter,
  leaveOnlineMatch,
} = onlineController;

const takeoverExitStartedRef = useRef(false);
const previousViewerControlRef = useRef<{
  matchId: string;
  playerId: string;
  controlled: boolean;
} | null>(null);
const pendingTakeoverTimeoutEventIdRef = useRef<string | null>(null);
const lastPresentationResumeTokenRef = useRef(lifecycleResumeToken);

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

// Do not expose the hook's local initial value while the authoritative match loads.
const onlineGameplayReady =
  onlineRoom?.status === "playing" &&
  onlineProjection !== null &&
  state.phase === "playing";

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
  ? `playing-${onlineMatchId}-${currentRound}`
  : "waiting";
const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
const [rackSetScore, setRackSetScore] = useState(0);
const [openableRackMelds, setOpenableRackMelds] = useState<{
  melds: OkeyMeld[];
  score: number;
  contiguousGroups: OkeyTile[][];
}>({ melds: [], score: 0, contiguousGroups: [] });
const turnView = useMemo(
  () => selectOkeyTurnView(onlineProjection),
  [onlineProjection],
);
  const [previewMelds, setPreviewMelds] = useState<OkeyMeld[]>([]);
  const [tableMeldOffsets, setTableMeldOffsets] = useState<Record<string, MeldOffset>>({});
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [showDiscardHistory, setShowDiscardHistory] = useState(false);
  const [showFinalTileCelebration, setShowFinalTileCelebration] = useState(false);
  const [turnWarningToastVisible, setTurnWarningToastVisible] = useState(false);
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
  const [discardDropPlacement, setDiscardDropPlacement] = useState<{ tileId: string; point: { x: number; y: number }; nonce: number } | null>(null);
  const [isDiscardDragActive, setIsDiscardDragActive] = useState(false);
  const [hoveredMeldTarget, setHoveredMeldTarget] = useState<{ playerId: string; meldId: string } | null>(null);
  const [discardDragPoint, setDiscardDragPoint] = useState<{ x: number; y: number } | null>(null);
  const screenRef = useRef<View | null>(null);
  const screenRectRef = useRef<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const deckTopRectRef = useRef<ScreenRect | null>(null);
  const discardTopRectRef = useRef<ScreenRect | null>(null);
  const opponentSeatRectsRef = useRef<Record<string, ScreenRect>>({});
  const rackRectRef = useRef<ScreenRect | null>(null);
  const rackTileRectsRef = useRef<Record<string, ScreenRect>>({});
  const drawLandingRectRef = useRef<ScreenRect | null>(null);
  const timeoutWarningTurnRef = useRef<string | null>(null);
  const lastPresentationRoundRef = useRef(currentRound);
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
  const roundScoreDetails = useMemo(() => getRoundResultScoreDetails(state), [state]);


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
  });


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
  matchFinished && !onlineProjection?.settlement;
const shouldShowScorePopup =
  showScoreDetails ||
  showRoundResultPopup;
  const previewTileIds = useMemo(() => previewMelds.flatMap((meld) => meld.tiles.map((tile) => tile.id)), [previewMelds]);
  useEffect(() => {
    if (humanPlayer.opened && previewMelds.length > 0) setPreviewMelds([]);
  }, [humanPlayer.opened, previewMelds.length]);
  const toLocalRect = useCallback(
    (rect: ScreenRect) => toLocalScreenRect(rect, screenRectRef.current),
    [],
  );
  const measureScreen = () => {
    screenRef.current?.measureInWindow((x, y, width, height) => {
      screenRectRef.current = { x, y, width, height };
    });
  };
  const {
    startNextQueuedPresentation,
    retryQueuedOpponentFlight,
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


  const isHumanTurn =
    turnView.phase === "playing" &&
    turnView.playerId === humanPlayer.id;

  useEffect(() => {
    setTurnWarningToastVisible(false);
  }, [currentRound, turnView.deadlineAt, turnView.durationSeconds, turnView.playerId]);

  useEffect(() => {
    if (
      !onlineGameplayReady ||
      !isAppActive ||
      !isHumanTurn ||
      !turnView.playerId ||
      !turnView.deadlineAt ||
      turnTimeLeft <= 0 ||
      turnTimeLeft > 5
    ) {
      return;
    }

    const warningKey = `${turnView.playerId}:${turnView.deadlineAt}`;
    if (timeoutWarningTurnRef.current === warningKey) return;

    timeoutWarningTurnRef.current = warningKey;
    setTurnWarningToastVisible(true);
    emitFeedback("timeout-warning", `timeout-warning:${warningKey}`);
  }, [
    emitFeedback,
    isAppActive,
    isHumanTurn,
    onlineGameplayReady,
    turnTimeLeft,
    turnView.deadlineAt,
    turnView.playerId,
  ]);

  const canDraw = isHumanTurn && !humanPlayer.eliminated && !state.hasDrawnThisTurn;
  const canDrawDiscard = canDraw && !topDiscardIsBlocked;
  const canDiscard = isHumanTurn && state.hasDrawnThisTurn && !!selectedTile;
  const canDiscardTile = isHumanTurn && state.hasDrawnThisTurn;
  const previewScore = previewMelds.reduce((total, meld) => total + meld.score, 0);
  // Manual staging and rack-layout detection are separate sources of intent.
  // Merge them once here; every authoritative opening command must consume
  // this canonical intent so the score, animation and committed tiles agree.
  const openIntent = useMemo(() => ({
    melds: [...previewMelds, ...openableRackMelds.melds],
    score: previewScore + openableRackMelds.score,
  }), [openableRackMelds.melds, openableRackMelds.score, previewMelds, previewScore]);
  const openAction = useMemo(
    () => getOkeyOpenAction(
      state,
      0,
      openIntent.melds,
      getOrderedKonkanRunCandidates(openableRackMelds.contiguousGroups),
    ),
    [openIntent.melds, openableRackMelds.contiguousGroups, state],
  );
  const remainingMeldSlots = openAction.remainingSlots;

  // Release the landing fallback only after authoritative state confirms the same
  // tile. This covers delayed online confirmation without touching game logic.
  useEffect(() => {
    releaseAuthoritativeDiscardHold(topDiscard?.id ?? null);
  }, [releaseAuthoritativeDiscardHold, topDiscard?.id]);
  const startDrawFlight = (source: "deck" | "discard") => {
    if (!canDraw) return;
    draw(source);

    // The authoritative command must not wait for an existing presentation.
    // Phase 4 owns queue unification, so skip only this optional flight when
    // another one is active.
    if (tileFlight) return;
    const drawnTile = source === "deck" ? state.deck[0] ?? null : topDiscard;
    const sourceRect = source === "deck" ? deckTopRectRef.current : discardTopRectRef.current;
    const targetRect = drawLandingRectRef.current;
    if (!drawnTile || !sourceRect || !targetRect) return;

    setTileFlight({
      id: `draw-${drawnTile.id}-${Date.now()}`,
      tile: source === "deck" ? null : drawnTile,
      face: source === "deck" ? "back" : "front",
      from: toLocalRect(sourceRect),
      to: toLocalRect(targetRect),
    });
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
    if (!canDraw || !topDiscard) return false;
    if (!isPointInsideRack(point)) return false;

    const tileId = topDiscard.id;
    draw("discard");
    if (tileFlight) return true;
   setHideDiscardTopTile(false);
    setDiscardDropPlacement({ tileId, point, nonce: Date.now() });
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
    if (!canDiscardTile) return false;

    const discardAction = getOkeyRackDiscardAction(
      state,
      0,
      openIntent.melds,
      tileId,
    );
    awaitingDiscardRemovalTileIdRef.current = tileId;
    setSelectedTileId(null);
    setHiddenRackTileIds([tileId]);
    setHideDiscardTopTile(false);
    if (discardAction.type === "open-and-discard") {
      commitOpenIntent(discardAction.melds, discardAction.score, discardAction.tileId);
    } else {
      discard(discardAction.tileId);
    }
    return true;
  };

  const dropTileFromRack = (tileId: string, point: { x: number; y: number }) => {
    if (isPointInsideDiscardPile(point)) {
      return commitDiscardFromRack(tileId);
    }

    return dropTileOnTableMeld(tileId, point);
  };

  const startDiscardFlight = (tileId: string) => {
    if (!canDiscardTile) return;

    const tile = humanPlayer.hand.find((entry) => entry.id === tileId);
    const sourceRect = rackTileRectsRef.current[tileId];
    const targetRect = discardTopRectRef.current;

    if (!commitDiscardFromRack(tileId)) return;
    if (tileFlight || !tile || !sourceRect || !targetRect) return;

    setDiscardPresentationFallback(topDiscard);
    setHideDiscardTopTile(true);
    setTileFlight({
      id: `discard-${tileId}-${Date.now()}`,
      tile,
      face: "front",
      from: toLocalRect(sourceRect),
      to: toLocalRect(targetRect),
    });
  };


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
  });
  useEffect(() => {
    if (!onlineMatchId || !onlineProjection || takeoverExitStartedRef.current) return;

    const viewer = onlineProjection.players.find((player) => Array.isArray(player.hand));
    if (!viewer) return;

    const controlled = viewer.controlledByBot === true || viewer.kind === "bot";
    const previous = previousViewerControlRef.current;
    previousViewerControlRef.current = {
      matchId: onlineMatchId,
      playerId: viewer.id,
      controlled,
    };

    if (!controlled) {
      pendingTakeoverTimeoutEventIdRef.current = null;
      return;
    }

    const timeoutEvent = onlineProjection.lastTimeoutDiscardEvent;
    const isFreshTakeover =
      previous?.matchId === onlineMatchId &&
      previous.playerId === viewer.id &&
      previous.controlled === false;
    if (
      pendingTakeoverTimeoutEventIdRef.current === null &&
      isFreshTakeover &&
      timeoutEvent?.playerId === viewer.id
    ) {
      const eventId = timeoutEvent.id;
      if (activePresentationRef.current.completedTimeoutEventId === eventId) {
        takeoverExitStartedRef.current = true;
        router.replace("/okey");
        return;
      }
      if (activePresentationRef.current.onlineTimeout?.eventId === eventId) {
        pendingTakeoverTimeoutEventIdRef.current = eventId;
        return;
      }
      // No valid event presentation was started (for example, missing geometry).
      // Preserve the existing immediate exit instead of trapping the viewer.
      takeoverExitStartedRef.current = true;
      router.replace("/okey");
      return;
    }

    const pendingEventId = pendingTakeoverTimeoutEventIdRef.current;
    if (pendingEventId) {
      if (activePresentationRef.current.completedTimeoutEventId === pendingEventId) {
        pendingTakeoverTimeoutEventIdRef.current = null;
        takeoverExitStartedRef.current = true;
        router.replace("/okey");
      } else if (activePresentationRef.current.onlineTimeout?.eventId !== pendingEventId) {
        // Presentation became unavailable before completion; never leave the
        // already-taken-over viewer stuck on the table.
        pendingTakeoverTimeoutEventIdRef.current = null;
        takeoverExitStartedRef.current = true;
        router.replace("/okey");
      }
      return;
    }

    // An already-taken-over initial snapshot has no local transition to present.
    takeoverExitStartedRef.current = true;
    router.replace("/okey");
  }, [onlineMatchId, onlineProjection, router, tileFlight]);


  useEffect(() => {
    const tileId = awaitingDiscardRemovalTileIdRef.current;
    if (!tileId || humanPlayer.hand.some((tile) => tile.id === tileId)) return;

    awaitingDiscardRemovalTileIdRef.current = null;
    setHiddenRackTileIds((current) => current.filter((entry) => entry !== tileId));
  }, [humanPlayer.hand, setHiddenRackTileIds]);

  const measureHumanMeldDropZone = () => {
    humanMeldDropZoneRef.current?.measureInWindow((x, y, width, height) => {
      humanMeldDropZone.current = { x, y, width, height };
    });
  };
  const isInsideHumanMeldDropZone = (point: { x: number; y: number }) => {
    const table = screenRectRef.current;
    if (table.width <= 0 || table.height <= 0) return false;

    // Group drops may land anywhere on the table surface. Existing rack,
    // draw/discard, and active popup flows retain priority over this route.
    if (
      showScoreDetails ||
      showRoundResultPopup ||
      showMatchResultPopup ||
      showDiscardHistory ||
      showFinalTileCelebration ||
      isDiscardDragActive
    ) {
      return false;
    }

    const forbiddenRects = [
      rackRectRef.current,
      deckTopRectRef.current,
      discardTopRectRef.current,
    ];
    if (forbiddenRects.some((rect) => rect && isPointInsideRect(point, rect))) {
      return false;
    }
    return isPointInsideRect(point, table);
  };  const registerMeldDropRect = (playerId: string, meldId: string, rect: { x: number; y: number; width: number; height: number }) => {
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
      (rect) => resolveTableMeldAction(state, 0, tileId, rect.playerId, rect.meldId) !== null,
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
    const target = hoveredMeldTargetRef.current;
    if (!target) return false;

    const action = resolveTableMeldAction(
      state,
      0,
      tileId,
      target.playerId,
      target.meldId,
    );
    if (!action) return false;

    if (action.type === "lock-konkan") {
      awaitingDiscardRemovalTileIdRef.current = tileId;
      setHiddenRackTileIds([tileId]);
      lockKonkanSetOnTable(action.tileId, action.targetPlayerId, action.targetMeldId);
      setSelectedTileId(null);
      return true;
    }

    awaitingDiscardRemovalTileIdRef.current = tileId;
    setHiddenRackTileIds([tileId]);
    spendTileOnTableMeld(action.tileId, action.targetPlayerId, action.targetMeldId);
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
    setPreviewMelds(nextMelds);
    setSelectedTileId(null);
    return true;
  };
  useEffect(() => {
    if (lastPresentationResumeTokenRef.current === lifecycleResumeToken) return;
    lastPresentationResumeTokenRef.current = lifecycleResumeToken;
    resetPresentationRuntime(
      state.players,
      state.discardPile[state.discardPile.length - 1] ?? null,
    );
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
    setDiscardDragPoint(null);
  }, [
    lifecycleResumeToken,
    resetPresentationRuntime,
    state.discardPile,
    state.players,
  ]);

  const turnTimerVisible = onlineGameplayReady && (state.phase === "playing" || showFinishRevealPopup);

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
        name: player?.name ?? member?.displayName ?? "",
        count: onlineGameplayReady ? (player ? stableOpponentTileCounts[player.id] ?? player.hand.length : 0) : 0,
        active: onlineGameplayReady && turnView.playerId === player?.id,
        turnTimeLeft,
        turnDurationSeconds: turnView.durationSeconds,
        dealResetKey: dealLifecycleKey,
      };
    }),
    [dealLifecycleKey, onlineGameplayReady, onlineRoom?.members, playerForSeat, relativeSeatMap, stableOpponentTileCounts, state.players, turnTimeLeft, turnView.durationSeconds, turnView.playerId],
  );
  const seatOrderedPlayers = useMemo(() => {
    if (!relativeSeatMap) return [state.players[0], state.players[2], state.players[3], state.players[1]];
    return ["bottom", "top", "left", "right"].map((seat) => playerForSeat(seat as RelativeSeat) ?? state.players[0]);
  }, [playerForSeat, relativeSeatMap, state.players]);
  const presentedSeatOrderedPlayers = useMemo(
    () =>
      seatOrderedPlayers.map((player) => {
        // The local player's melds must reflect authoritative state immediately.
        // Presentation caching is only needed for opponent draw/discard animation.
        if (player.id === humanPlayer.id) return player;
        return presentedTablePlayers.find((entry) => entry.id === player.id) ?? player;
      }),
    [humanPlayer.id, presentedTablePlayers, seatOrderedPlayers],
  );
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
      isActive: turnView.playerId === player.id,
      timeLeft:
        turnView.playerId === player.id
          ? Math.max(0, Math.ceil(turnTimeLeft))
          : 0,
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
    if (humanPlayer.opened) {
      const accepted =
        isHumanTurn &&
        isInsideHumanMeldDropZone(point) &&
        remainingMeldSlots > 0;

      if (!accepted) {
        emitFeedback("invalid", `meld-drop:${meld.id}:${Date.now()}`);
        return false;
      }

      // Once the player has already opened, a dragged meld is a continuation
      // of their table play, not a second opening flow. Commit it directly
      // through the authoritative server path while keeping the Open button
      // available for the normal/manual workflow.
      commitOpenIntent([meld], meld.score);
      setSelectedTileId(null);
      emitFeedback("rack-move", `meld-drop:${meld.id}:${Date.now()}`);
      return true;
    }

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
  const handleExternalDropPlaced = useStableEvent((tileId: string, _targetIndex: number) => {
    setSelectedTileId(tileId);
    setDiscardDropPlacement(null);
    setDiscardDragPoint(null);
  });
  const handleRackMeasured = useStableEvent((rect: ScreenRect) => {
    rackRectRef.current = rect;
  });
  const handleDrawLandingRectChange = useStableEvent((rect: ScreenRect | null) => {
    drawLandingRectRef.current = rect;
  });
  const handleRackTileMeasured = useStableEvent((tileId: string, rect: ScreenRect) => {
    rackTileRectsRef.current[tileId] = rect;
  });
  const handleMoveRackTile = useStableEvent((tileId: string, targetIndex: number) => {
    setSelectedTileId(tileId);
    emitFeedback("rack-move", `rack-move:${tileId}:${targetIndex}:${Date.now()}`);
  });
  const skipEnterAnimationTileIds = useMemo(
    () => discardDropPlacement ? [discardDropPlacement.tileId] : [],
    [discardDropPlacement],
  );
  useEffect(() => {
    if (lastPresentationRoundRef.current === currentRound) return;
    lastPresentationRoundRef.current = currentRound;

    // A new round is a hard presentation boundary. No animation, cached tile,
    // meld, popup, measurement target, or pending visual action from the
    // previous round may survive into the new authoritative round.
    timeoutWarningTurnRef.current = null;
    hoveredMeldTargetRef.current = null;
    meldDropRectsRef.current = [];

    resetPresentationRuntime(
      state.players,
      state.discardPile[state.discardPile.length - 1] ?? null,
    );

    setPreviewMelds([]);
    setTableMeldOffsets({});
    setSelectedTileId(null);
    setRackSetScore(0);
    setOpenableRackMelds({ melds: [], score: 0, contiguousGroups: [] });
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
    setDiscardDragPoint(null);

    setShowScoreDetails(false);
    setShowDiscardHistory(false);
    setShowFinalTileCelebration(false);
    setTurnWarningToastVisible(false);
    setProfilePlayer(null);

  }, [
    currentRound,
    resetPresentationRuntime,
    state.discardPile,
    state.players,
  ]);

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
  <View style={finishRevealStyles.topRightActions}>
    <Pressable style={finishRevealStyles.topRightActionButton} onPress={openMatchMenu}>
      <Ionicons name="menu-outline" size={22} color="#f8f3df" />
    </Pressable>
    <Pressable style={finishRevealStyles.topRightActionButton} onPress={() => setShowGameChat(true)}>
      <Ionicons name="chatbubble-ellipses-outline" size={22} color="#f8f3df" />
    </Pressable>
  </View>
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
                deckCount={state.deck.length}
                topDiscard={presentedTopDiscard}
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
        <View style={styles.playerSetScoreWrap} pointerEvents="box-none">
          {openAction.allowed ? (
            <Pressable
              style={styles.openSetsButton}
              onPress={() => {
                if (openAction.mode === "declare-konkan") {
                  declareKonkan(openAction.orderedRunTileIds);
                } else if (openAction.mode === "open-melds") {
                  commitOpenIntent(openAction.melds, openAction.score);
                }
                setSelectedTileId(null);
              }}
            >
              <Text style={styles.openSetsButtonText}>
                {humanPlayer.konkan ? "کۆنکان" : humanPlayer.opened ? "دانانی دەستە" : "ڕاخستن"}
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
                  {previewMelds.length > 0 ? openIntent.score : rackSetScore}
                </Text>
              </View>
            )}
          </View>
        </View>
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
         externalDropPlacement={discardDropPlacement}
          externalHoverPoint={discardDragPoint}
          eliminated={!!humanPlayer.eliminated}
          onExternalDropPlaced={handleExternalDropPlaced}

          turnTimerActive={
            turnTimerVisible &&
            turnView.playerId === humanPlayer.id
          }
          turnWarningToastVisible={turnWarningToastVisible}
          turnTimeLeft={turnTimeLeft}
          turnDurationSeconds={turnView.durationSeconds}
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
  activePlayerId={turnView.playerId}
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

