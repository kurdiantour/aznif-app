import BoardArea from "@/components/game/BoardArea";
import DrawPilePrompt from "@/components/game/DrawPilePrompt";
import GameOverPopup from "@/components/game/GameOverPopup";
import MultiplayerGameChat from "@/components/game/MultiplayerGameChat";
import PlayerHand from "@/components/game/PlayerHand";
import DominoTileFlightOverlay from "@/components/game/DominoTileFlightOverlay";
import PlayerSeat from "@/components/game/PlayerSeat";
import PlayerProfilePopup from "@/components/game/PlayerProfilePopup";
import RoundResultReveal from "@/components/game/RoundResultReveal";
import ScorePopup from "@/components/game/ScorePopup";
import TableBackground from "@/components/game/TableBackground";
import { getPreloadedTableId } from "@/lib/game/gameLaunchPreload";
import LeaveMatchConfirmPopup from "@/components/game/LeaveMatchConfirmPopup";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import MiniScoreBoard from "@/components/game/MiniScoreBoard";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { PLAYER_TURN_DURATION_SECONDS } from "@/domino/shared/game-shared";
import { useGameSounds } from "@/domino/shared/presentation/use-domino-game-sounds";
import { useDominoTileFlightCoordinator } from "@/domino/shared/presentation/use-domino-tile-flight-coordinator";
import type { DominoFlightRect } from "@/domino/shared/presentation/domino-tile-flight";
import { useOneVsOneGame } from "@/domino/modes/one-vs-one/presentation/use-one-vs-one-game";
import { useRoundPresentation } from "@/domino/shared/presentation/use-round-presentation";
import { useTwoVsTwoGame } from "@/domino/modes/two-vs-two";
import { useLocalTwoVsTwoPreviewGame } from "@/domino/modes/two-vs-two/presentation/use-local-2v2-preview";
import { awardAiPracticeWin, useAiPracticeGame } from "@/domino/modes/ai-practice";
import { calculateMoveScore } from "@/domino/core/engine/kozel-engine";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { DominoTileData, KozelBranch, Player, ScoringEvent, TeamId } from "@/domino/types/domino-game";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

function getTeamName(
  players: any[],
  teamId: "teamA" | "teamB",
  fallback: string,
) {
  const names = players
    .filter((player) => player.teamId === teamId)
    .map((player) => player.name)
    .filter(Boolean);

  return names.length ? names.join(" & ") : fallback;
}

export default function GameScreen() {
  useKeepAwake();

  const { room_id, mode, practice, preview } = useLocalSearchParams();
  const router = useRouter();

  const roomId = String(room_id ?? "");

  const rawMode = Array.isArray(mode) ? mode[0] : mode;

  const gameMode: "1v1" | "2v2" = rawMode === "2v2" ? "2v2" : "1v1";

  const isPracticeMode = practice === "true";
  const isTwoVsTwoPreview = __DEV__ && preview === "true";
  const isLocalGame = isPracticeMode || isTwoVsTwoPreview;

  const practiceGame = useAiPracticeGame();
  const previewGame = useLocalTwoVsTwoPreviewGame(isTwoVsTwoPreview);

  const oneVsOneGame = useOneVsOneGame(
    !isLocalGame && gameMode === "1v1" ? roomId : undefined,
  );

  const twoVsTwoGame = useTwoVsTwoGame(
    !isLocalGame && gameMode === "2v2" ? roomId : undefined,
  );

  const game = isTwoVsTwoPreview
    ? previewGame
    : isPracticeMode
    ? practiceGame
    : gameMode === "1v1"
      ? oneVsOneGame
      : twoVsTwoGame;

  useGameSounds({
    board: game.board,
    boneyardCount: game.boneyardCount,
    lastPassedPlayerId: (game as any).lastPassedPlayerId ?? null,
    currentTurnPlayerId: game.currentTurnPlayerId,
  });

  // Keep the authoritative board for all game logic, scoring, turns, and
  // round lifecycle. Only the rendered board uses the pending local move so
  // the player sees their tile immediately while the backend confirms it.
  const displayBoard =
    (game as any).pendingMove?.visualBoard ?? game.board;

  const gameLoading = !isLocalGame && (game as any).loading;
  const gameError = !isLocalGame ? (game as any).error : null;

  const { profile, loading: profileLoading, refreshProfile } = useProfile();

  const {
  showMatchMenu,
  matchMenuTranslateX,
  openMatchMenu,
  closeMatchMenu,
} = useMatchMenu();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeavingMatch, setIsLeavingMatch] = useState(false);
  const [selectedTile, setSelectedTile] = useState<DominoTileData | null>(null);
  const [selectableBranches, setSelectableBranches] = useState<KozelBranch[]>(
    [],
  );
  const [passCountdown, setPassCountdown] = useState(10);
  const [isPassingTurn, setIsPassingTurn] = useState(false);
  const [sideSeatHeight, setSideSeatHeight] = useState(0);
  const [dealOrigin, setDealOrigin] = useState<{ x: number; y: number } | null>(null);
  const [dealToken, setDealToken] = useState(0);
  const [profilePlayer, setProfilePlayer] = useState<Player | null>(null);
  const [blockedIntroComplete, setBlockedIntroComplete] = useState(false);

  const gameInitializedRef = useRef(false);
  const takeoverExitStartedRef = useRef(false);
  const practiceRewardSettlementRequestedRef = useRef(false);
  const [initialPracticeMatchId] = useState(() =>
    roomId || `${Date.now()}-${Math.random()}`,
  );
  const practiceMatchIdRef = useRef(initialPracticeMatchId);
  const boardAreaRef = useRef<any>(null);
  const screenRef = useRef<View | null>(null);
  const screenOriginRef = useRef({ x: 0, y: 0 });
  const selectedTileSourceRef = useRef<DominoFlightRect | null>(null);
  const seatFlightOriginsRef = useRef<Record<string, DominoFlightRect>>({});
  const previousBoardTileCountRef = useRef<number | null>(null);
  const previousTurnPlayerIdRef = useRef<string | null>(null);
  const animatedMoveKeyRef = useRef<string | null>(null);
  const tileFlight = useDominoTileFlightCoordinator();
  const toScreenRect = (rect: DominoFlightRect): DominoFlightRect => ({ ...rect, x: rect.x - screenOriginRef.current.x, y: rect.y - screenOriginRef.current.y });
  const previousHandSignatureRef = useRef<string | null>(null);
  const passRequestedRef = useRef(false);
  const passTurnRef = useRef(game.passTurn);
  useEffect(() => {
  passTurnRef.current = game.passTurn;
}, [game.passTurn]);

useEffect(() => {
  const subscription = BackHandler.addEventListener(
    "hardwareBackPress",
    () => {
      setShowLeaveConfirm(true);
      return true;
    }
  );

  return () => subscription.remove();
}, []);

  const localCurrentUserId =
    !isLocalGame && gameMode === "1v1"
      ? ((game as any).currentUserId ?? null)
      : currentUserId;
  const localPlayerTakenOver =
    !isLocalGame && (game as any).localPlayerTakenOver === true;

  useEffect(() => {
    if (!localPlayerTakenOver || takeoverExitStartedRef.current) return;
    takeoverExitStartedRef.current = true;
    router.replace("/(tabs)/play");
  }, [localPlayerTakenOver, router]);
  useEffect(() => {
    gameInitializedRef.current = false;
    takeoverExitStartedRef.current = false;
    practiceRewardSettlementRequestedRef.current = false;
    practiceMatchIdRef.current = roomId || `${Date.now()}-${Math.random()}`;
  }, [roomId, gameMode, isLocalGame]);

  useEffect(() => {
    let mounted = true;

    const loadCurrentUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) setCurrentUserId(data.user?.id ?? null);
      } catch {
        if (mounted) setCurrentUserId(null);
      }
    };

    void loadCurrentUser();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isLocalGame || gameMode === "1v1") return;
    if (gameLoading) return;
    if (gameInitializedRef.current) return;
    if (!roomId) return;

    const initializeGame = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from("two_vs_two_rooms")
          .select("status, state")
          .eq("id", roomId)
          .maybeSingle();

        if (roomError) {
          console.warn("Failed to fetch room data", roomError);
          return;
        }

        if (!roomData) return;

        const hasStarted =
          roomData.state?.status === "started" || !!roomData.state?.handCounts;

        if (hasStarted) return;
        if (roomData.status !== "waiting" && roomData.status !== "active")
          return;

        gameInitializedRef.current = true;

        const { error } = await supabase.rpc("start_two_vs_two_game", {
          p_room_id: roomId,
        });

        if (error) {
          console.warn("Failed to start game (may already be started)", error);
        }
      } catch (err) {
        console.warn("Error initializing game", err);
      }
    };

    void initializeGame();
  }, [isLocalGame, gameLoading, roomId, gameMode]);

  useEffect(() => {
    if (gameLoading || !game.myHand.length) return;

    const handSignature = game.myHand.map((tile) => tile.id).join("|");
    const previousSignature = previousHandSignatureRef.current;
    const previousIds = new Set(previousSignature?.split("|").filter(Boolean) ?? []);
    const sharedTiles = game.myHand.filter((tile) => previousIds.has(tile.id)).length;
    const isNewRoundHand =
      previousSignature === null ||
      (game.myHand.length >= 7 && sharedTiles <= Math.floor(game.myHand.length * 0.35));

    previousHandSignatureRef.current = handSignature;
    if (!isNewRoundHand) return;

    const captureDealOrigin = async () => {
      const origin = await boardAreaRef.current?.getDealOrigin?.();
      if (origin) setDealOrigin(origin);
      setDealToken((token) => token + 1);
    };
    void captureDealOrigin();
  }, [gameLoading, game.myHand]);

  const topPlayer = game.players.find((p) => p.seat === "top");
  const leftPlayer = game.players.find((p) => p.seat === "left");
  const rightPlayer = game.players.find((p) => p.seat === "right");

  useLayoutEffect(() => {
    const boardTileCount = (game.board.centerTile ? 1 : 0) +
      (["left", "right", "up", "down"] as const).reduce((total, branch) => total + game.board.branches[branch].tiles.length, 0);
    const previousCount = previousBoardTileCountRef.current;
    const previousTurnPlayerId = previousTurnPlayerIdRef.current;
    previousBoardTileCountRef.current = boardTileCount;
    previousTurnPlayerIdRef.current = game.currentTurnPlayerId ?? null;
    if (previousCount === null || boardTileCount !== previousCount + 1 || !game.lastPlayedTile) return;
    const moverId = (game as any).rawState?.lastMovePlayerId ?? previousTurnPlayerId;
    const localUserId = (game as any).currentUserId ?? currentUserId;
    if (!moverId || moverId === localUserId) return;
    const source = seatFlightOriginsRef.current[moverId];
    if (!source) return;
    const version = (game as any).rawState?.version ?? (game as any).rawState?.roomVersion ?? boardTileCount;
    const moveKey = `${version}:${moverId}:${game.lastPlayedTile.id}`;
    if (animatedMoveKeyRef.current === moveKey) return;
    animatedMoveKeyRef.current = moveKey;
    const tileId = game.lastPlayedTile.id;
    tileFlight.hideBoardTile(tileId);
    requestAnimationFrame(() => {
      void boardAreaRef.current?.getTileRect?.(tileId).then((target: DominoFlightRect | null) => {
        if (animatedMoveKeyRef.current !== moveKey) return;
        if (!target) {
          tileFlight.revealBoardTile(tileId);
          return;
        }
        tileFlight.begin({ id: moveKey, tile: game.lastPlayedTile!, from: toScreenRect(source), to: toScreenRect(target) }, false);
      });
    });
  }, [game, currentUserId, tileFlight]);
  const isTurnRingVisible = !game.roundWinnerPlayerId && !game.winningTeamId;

  const humanPlayer = isLocalGame
    ? game.players.find((p) => p.kind === "human")
    : game.players.find((p) => p.id === localCurrentUserId);
  const humanTurnProgressWidth = humanPlayer?.isActive
    ? 450 * Math.max(0, Math.min(1, humanPlayer.timeLeft / PLAYER_TURN_DURATION_SECONDS))
    : 450;

  const {
    finalTileAnimationTileId,
    isWinningTileConfirmationVisible: isFinalTileAnimationRunning,
    handleWinningTileAnimationComplete: handleFinalTileAnimationComplete,
    showScorePopup,
    setShowScorePopup,
    showGameOverPopup,
    setShowGameOverPopup,
  } = useRoundPresentation({
    players: game.players,
    roundWinnerPlayerId: game.roundWinnerPlayerId,
    lastPlayedTile: game.lastPlayedTile,
    winningTeamId: game.winningTeamId,
  });
  const gamePhase = (game as any).phase;
  const roundResult = (game as any).roundResult;
  const isRoundResultReveal = gamePhase === "round_result_reveal";
  const isBlockedResult = roundResult?.endReason === "blocked";
  const endOfHandScoringEvent: ScoringEvent | null =
    game.roundWinnerPlayerId
      ? (game as any).endOfHandScoringEvent ?? null
      : null;
  const isHandRevealVisible =
    isRoundResultReveal &&
    !isFinalTileAnimationRunning &&
    (!isBlockedResult || blockedIntroComplete);
  const shouldShowEndOfHandScore =
    !!game.roundWinnerPlayerId &&
    !!endOfHandScoringEvent &&
    isHandRevealVisible;

  const isMyTurn =
    !isLocalGame && gameMode === "1v1"
      ? !!localCurrentUserId && game.currentTurnPlayerId === localCurrentUserId
      : !!humanPlayer && game.currentTurnPlayerId === humanPlayer.id;

  const playableTileIds =
    isMyTurn && !game.canDrawTile
      ? game.myHand
          .filter((tile) => game.availableBranchesForTile(tile).length > 0)
          .map((tile) => tile.id)
      : [];
  const shouldShowPassPrompt =
    isMyTurn &&
    (game as any).phase === "playing" &&
    !game.roundWinnerPlayerId &&
    !game.winningTeamId &&
    !!game.board?.centerTile &&
    !game.canDrawTile &&
    playableTileIds.length === 0;
  const shouldShowHumanTurnProgress =
    !!humanPlayer &&
    isTurnRingVisible &&
    (game as any).phase === "playing";
  const shouldShowHumanTurnProgressFill =
    shouldShowHumanTurnProgress && !shouldShowPassPrompt;

  const handlePassTurn = useCallback(async () => {
    if (!shouldShowPassPrompt || passRequestedRef.current) return;

    passRequestedRef.current = true;
    setIsPassingTurn(true);

    try {
      const passed = await passTurnRef.current();

      if (!passed) {
        passRequestedRef.current = false;
        setIsPassingTurn(false);
      }
    } catch (err) {
      console.warn("pass turn failed", err);
      passRequestedRef.current = false;
      setIsPassingTurn(false);
    }
  }, [shouldShowPassPrompt]);

 useEffect(() => {
  if (!shouldShowPassPrompt) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPassCountdown(10);
    setIsPassingTurn(false);
    passRequestedRef.current = false;
    return;
  }

  setPassCountdown(10);

  const interval = setInterval(() => {
    setPassCountdown((previous) => Math.max(0, previous - 1));
  }, 1000);

  return () => clearInterval(interval);
}, [game.currentTurnPlayerId, shouldShowPassPrompt]);

useEffect(() => {
  if (shouldShowPassPrompt && passCountdown === 0) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handlePassTurn();
  }
}, [passCountdown, shouldShowPassPrompt, handlePassTurn]);

  useEffect(() => {
    if (!isMyTurn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTile(null);
      setSelectableBranches([]);
    }
  }, [isMyTurn]);

  useEffect(() => {
    if (!selectedTile) return;

    const stillInHand = game.myHand.some((tile) => tile.id === selectedTile.id);

    if (!stillInHand) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTile(null);
      setSelectableBranches([]);
    }
  }, [game.myHand, selectedTile]);

  const clearSelection = () => {
    setSelectedTile(null);
    setSelectableBranches([]);
  };

  useEffect(() => {
    const hiddenTileId = tileFlight.hiddenHandTileId;
    if (hiddenTileId && !game.myHand.some((tile) => tile.id === hiddenTileId)) tileFlight.releaseHandTile(hiddenTileId);
  }, [game.myHand, tileFlight]);

  const isTileInMyHand = (tile: DominoTileData) => {
    return game.myHand.some((handTile) => handTile.id === tile.id);
  };

  const handlePreviewTile = (tile: DominoTileData, sourceRect?: DominoFlightRect) => {
    if (!isMyTurn) return;
    if (!isTileInMyHand(tile)) return;

    const branches = game.availableBranchesForTile(tile);

    if (!branches.length) {
      clearSelection();
      return;
    }

    selectedTileSourceRef.current = sourceRect ?? null;
    setSelectedTile(tile);
    setSelectableBranches(branches);
  };

  const handleDropTile = async (
    tile: DominoTileData,
    dropPoint: { x: number; y: number },
    sourceRect?: DominoFlightRect,
  ) => {
    if (!isMyTurn) return;
    if (!isTileInMyHand(tile)) return;

    const branches = game.availableBranchesForTile(tile);

    if (!branches.length) {
      clearSelection();
      return;
    }

    tileFlight.hideHumanTile(tile.id);

    const branch = await boardAreaRef.current?.findDropBranch?.(
      tile,
      branches,
      dropPoint,
    );

    if (!branch || !branches.includes(branch)) {
      tileFlight.rollbackHumanTile(tile.id);
      clearSelection();
      return;
    }

    // Remove the translucent placement preview before the board receives the
    // confirmed move. Otherwise the confirmed tile and its preview overlap
    // briefly while the multiplayer request resolves.
    clearSelection();

    void boardAreaRef.current?.getPreviewRect?.(tile, branch).then((target: DominoFlightRect | null) => {
      if (!sourceRect || !target) return tileFlight.rollbackHumanTile(tile.id);
      tileFlight.begin({ id: `human:${tile.id}:${Date.now()}`, tile, from: toScreenRect(sourceRect), to: toScreenRect(target) }, true);
    });

    try {
      const played = await game.playTile(tile, branch);

      if (!played) {
        tileFlight.rollbackHumanTile(tile.id);
        setSelectedTile(tile);
        setSelectableBranches(branches);
      }
    } catch (err) {
      console.warn("play tile failed", err);
      tileFlight.rollbackHumanTile(tile.id);
      if (isTileInMyHand(tile)) {
        setSelectedTile(tile);
        setSelectableBranches(branches);
      }
    }
  };

  const handleSelectBranch = async (branch: KozelBranch) => {
    if (!isMyTurn || !selectedTile) return;
    if (!isTileInMyHand(selectedTile)) {
      clearSelection();
      return;
    }

    const branches = game.availableBranchesForTile(selectedTile);

    if (!branches.includes(branch)) {
      clearSelection();
      return;
    }

    const tileToPlay = selectedTile;
    clearSelection();
    const sourceRect = selectedTileSourceRef.current;
    tileFlight.hideHumanTile(tileToPlay.id);
    void boardAreaRef.current?.getPreviewRect?.(tileToPlay, branch).then((target: DominoFlightRect | null) => {
      if (!sourceRect || !target) return tileFlight.rollbackHumanTile(tileToPlay.id);
      tileFlight.begin({ id: `human:${tileToPlay.id}:${Date.now()}`, tile: tileToPlay, from: toScreenRect(sourceRect), to: toScreenRect(target) }, true);
    });

    try {
      const played = await game.playTile(tileToPlay, branch);

      if (!played && isTileInMyHand(tileToPlay)) {
        tileFlight.rollbackHumanTile(tileToPlay.id);
        setSelectedTile(tileToPlay);
        setSelectableBranches(branches);
      }
    } catch (err) {
      console.warn("play tile failed", err);
      tileFlight.rollbackHumanTile(tileToPlay.id);
      if (isTileInMyHand(tileToPlay)) {
        setSelectedTile(tileToPlay);
        setSelectableBranches(branches);
      }
    }
  };

  const handleDrawTile = async () => {
    try {
      await boardAreaRef.current?.animateDraw?.();
    } catch {
      // Ignore animation errors.
    }

    const drew = await game.drawTile();

    if (drew) clearSelection();
  };

  const handleConfirmLeaveGame = async () => {
    if (isLeavingMatch) return;

    setIsLeavingMatch(true);

    try {
      if (!isLocalGame && roomId) {
        if (gameMode === "1v1") {
          await oneVsOneGame.leaveMatch();
        } else {
          await supabase.rpc("leave_two_vs_two_match", {
            p_room_id: roomId,
          });
        }
      }

      setShowLeaveConfirm(false);
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("Failed to leave game", error);
      setIsLeavingMatch(false);
    }
  };

  const scoreTeamAName = getTeamName(game.players, "teamA", "Team A");
  const scoreTeamBName = getTeamName(game.players, "teamB", "Team B");
  const primaryScoreTeamId: TeamId =
    game.mode === "1v1" ? humanPlayer?.teamId ?? "teamA" : "teamA";
  const secondaryScoreTeamId: TeamId =
    primaryScoreTeamId === "teamA" ? "teamB" : "teamA";
  const scoreNameByTeam: Record<TeamId, string> = {
    teamA: scoreTeamAName,
    teamB: scoreTeamBName,
  };

  const miniScoreTeamAName =
    game.mode === "1v1" ? scoreNameByTeam[primaryScoreTeamId] : "Team A";
  const miniScoreTeamBName =
    game.mode === "1v1" ? scoreNameByTeam[secondaryScoreTeamId] : "Team B";
  const scoreByTeam: Record<TeamId, number> = {
    teamA: game.teamScores?.teamA ?? 0,
    teamB: game.teamScores?.teamB ?? 0,
  };
  const rawState = (game as any).rawState;
  const isEndOfHandScorePending =
    game.mode === "1v1" &&
    !!rawState &&
    rawState?.endOfHandScoreApplied !== true;
  const hasAppliedEndOfHandScore =
    !!endOfHandScoringEvent &&
    !isEndOfHandScorePending;
  const shouldHideAppliedEndOfHandScore =
    hasAppliedEndOfHandScore && !shouldShowEndOfHandScore;
  const shouldAddPendingEndOfHandScore =
    shouldShowEndOfHandScore && !!endOfHandScoringEvent && isEndOfHandScorePending;
  const visibleScoreByTeam: Record<TeamId, number> = shouldAddPendingEndOfHandScore
    ? {
        ...scoreByTeam,
        [endOfHandScoringEvent.teamId]:
          scoreByTeam[endOfHandScoringEvent.teamId] + endOfHandScoringEvent.points,
      }
    : shouldHideAppliedEndOfHandScore
      ? {
          ...scoreByTeam,
          [endOfHandScoringEvent.teamId]: Math.max(
            0,
            scoreByTeam[endOfHandScoringEvent.teamId] -
              endOfHandScoringEvent.points,
          ),
        }
    : scoreByTeam;
  const miniScoreTeamAScore = visibleScoreByTeam[primaryScoreTeamId];
  const miniScoreTeamBScore = visibleScoreByTeam[secondaryScoreTeamId];

  const didWinMatch = humanPlayer?.teamId
    ? game.winningTeamId === humanPlayer.teamId
    : game.winningTeamId === "teamA";

  const onlineSettlement = rawState?.settlement;
  const onlineMatchResultReward =
    !isPracticeMode && onlineSettlement?.type === "winner"
      ? {
          coin: didWinMatch
            ? Number(onlineSettlement.payoutPerWinner ?? 0) -
              Number(onlineSettlement.entryFeePerPlayer ?? 0)
            : -Number(onlineSettlement.entryFeePerPlayer ?? 0),
          gem:
            onlineSettlement.currency === "fun" && didWinMatch ? 10 : 0,
          points:
            onlineSettlement.currency === "fun"
              ? didWinMatch
                ? 35
                : -15
              : 0,
          currency: onlineSettlement.currency === "aznif" ? "aznif" as const : "fun" as const,
        }
      : null;

  const practiceWinReward = useMemo(
    () =>
      profile && isPracticeMode && didWinMatch && game.winningTeamId
        ? { coin: 0, gem: 0, points: 1 }
        : null,
    [didWinMatch, game.winningTeamId, isPracticeMode, profile],
  );

useEffect(() => {
  if (!practiceWinReward) return;
  if (!showGameOverPopup) return;
  if (practiceRewardSettlementRequestedRef.current) return;

  practiceRewardSettlementRequestedRef.current = true;

  const persistPracticeReward = async () => {
    try {
      await awardAiPracticeWin(practiceMatchIdRef.current);
      await refreshProfile();
    } catch (error) {
      practiceRewardSettlementRequestedRef.current = false;
      console.warn("Unable to persist AI practice win reward", error);
    }
  };

  void persistPracticeReward();
}, [
  practiceWinReward,
  showGameOverPopup,
  refreshProfile,
]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlockedIntroComplete(false);
    if (!isRoundResultReveal || !isBlockedResult) return;
    const timer = setTimeout(() => setBlockedIntroComplete(true), 5_000);
    return () => clearTimeout(timer);
  }, [isBlockedResult, isRoundResultReveal, roundResult?.winnerId]);

  const shouldRenderPlayedBoardTiles =
    gamePhase === "playing" ||
    isFinalTileAnimationRunning ||
    (isRoundResultReveal && isBlockedResult && !blockedIntroComplete);

  const shouldShowRoundResultReveal = isHandRevealVisible;
  const shouldShowNextRoundCountdown =
    gamePhase === "next_round_countdown" &&
    !isFinalTileAnimationRunning;
  const lastTilePoints = game.roundWinnerPlayerId
    ? calculateMoveScore(game.board)
    : 0;
  const roundWinner = game.players.find(
    (player) => player.id === game.roundWinnerPlayerId,
  );
  const boardScoringEvent: ScoringEvent | null = !game.roundWinnerPlayerId
    ? game.lastScoringEvent
    : lastTilePoints > 0 && roundWinner?.tileCount === 0
        ? {
            playerId: roundWinner.id,
            teamId: roundWinner.teamId,
            points: lastTilePoints,
            openEndsTotal: lastTilePoints,
          }
        : null;


  if (gameLoading) {
    return (
      <TableBackground tableId={!isLocalGame ? getPreloadedTableId() : undefined}>
        <View style={styles.loadingOverlay}>
        <Text style={styles.statusText}>{"\u06cc\u0627\u0631\u06cc \u0628\u0627\u0631 \u062f\u06d5\u06a9\u0631\u06ce\u062a..."}</Text>
        </View>
      </TableBackground>
    );
  }

  if (!isLocalGame && !profileLoading && !profile) {
    return <Redirect href="/login" />;
  }

  if (gameError) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.statusText}>{"\u0646\u06d5\u062a\u0648\u0627\u0646\u0631\u0627 \u06cc\u0627\u0631\u06cc\u06cc\u06d5\u06a9\u06d5 \u0628\u0627\u0631\u0628\u06a9\u0631\u06ce\u062a"}</Text>
        <Text style={styles.errorText}>{gameError}</Text>
      </View>
    );
  }

  return (
    <View ref={screenRef} onLayout={() => screenRef.current?.measureInWindow((x, y) => { screenOriginRef.current = { x, y }; })} style={styles.screen}>
      {tileFlight.flight && <DominoTileFlightOverlay flight={tileFlight.flight} onDone={tileFlight.finish} />}
      {isTwoVsTwoPreview && (
        <View pointerEvents="box-none" style={styles.previewDevOverlay}>
          <View style={styles.previewDevPanel}>
            <Text style={styles.previewDevTitle}>Domino 2v2 Preview</Text>
            <Text style={styles.previewDevText}>You + 3 local bots</Text>
            <Pressable onPress={previewGame.restartGame} style={styles.previewRestartButton}>
              <Text style={styles.previewRestartText}>Restart Game</Text>
            </Pressable>
          </View>
        </View>
      )}
      <View style={styles.stage}>
        <TableBackground tableId={!isLocalGame ? getPreloadedTableId() : undefined}>
          {topPlayer && (
            <View style={styles.topOpponentArea}>
              <View style={styles.avatarSlot}>
                <PlayerSeat
                  player={{ ...topPlayer, isActive: isTurnRingVisible && topPlayer.isActive }}
                  remainingTiles={topPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === topPlayer.id}
                  dealOrigin={dealOrigin}
                  dealToken={dealToken}
                  dealOrder={gameMode === "1v1" ? 0 : 2}
                  dealPlayerCount={gameMode === "1v1" ? 2 : 4}
                  onPress={topPlayer.kind === "human" ? () => setProfilePlayer(topPlayer) : undefined}
                  onFlightOriginChange={(rect) => { seatFlightOriginsRef.current[topPlayer.id] = rect; }}
                />
              </View>
            </View>
          )}

          {leftPlayer && (
            <View
              style={[
                styles.leftOpponentArea,
                { transform: [{ translateY: -sideSeatHeight / 2 }] },
              ]}
            >
              <View style={styles.leftOpponentRotation}>
                <View
                  style={styles.avatarSlot}
                  onLayout={(event) =>
                    setSideSeatHeight(event.nativeEvent.layout.height)
                  }
                >
                  <PlayerSeat
                    player={{ ...leftPlayer, isActive: isTurnRingVisible && leftPlayer.isActive }}
                  remainingTiles={leftPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === leftPlayer.id}
                  dealOrigin={dealOrigin}
                  dealToken={dealToken}
                  dealOrder={1}
                  dealPlayerCount={4}
                  dealRotation={-90}
                  onPress={leftPlayer.kind === "human" ? () => setProfilePlayer(leftPlayer) : undefined}
                  onFlightOriginChange={(rect) => { seatFlightOriginsRef.current[leftPlayer.id] = rect; }}
                  />
                </View>
              </View>
            </View>
          )}

          {rightPlayer && (
            <View
              style={[
                styles.rightOpponentArea,
                { transform: [{ translateY: -sideSeatHeight / 2 }] },
              ]}
            >
              <View style={styles.rightOpponentRotation}>
                <View
                  style={styles.avatarSlot}
                  onLayout={(event) =>
                    setSideSeatHeight(event.nativeEvent.layout.height)
                  }
                >
                  <PlayerSeat
                    player={{ ...rightPlayer, isActive: isTurnRingVisible && rightPlayer.isActive }}
                  remainingTiles={rightPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === rightPlayer.id}
                  dealOrigin={dealOrigin}
                  dealToken={dealToken}
                  dealOrder={3}
                  dealPlayerCount={4}
                  dealRotation={90}
                  onPress={rightPlayer.kind === "human" ? () => setProfilePlayer(rightPlayer) : undefined}
                  onFlightOriginChange={(rect) => { seatFlightOriginsRef.current[rightPlayer.id] = rect; }}
                  />
                </View>
              </View>
            </View>
          )}

          <View style={styles.middleRow}>
            <View style={styles.boardAreaWrap}>
              <BoardArea
                board={displayBoard}
                players={game.players}
                lastScoringEvent={boardScoringEvent}
                lastPlayedTile={game.lastPlayedTile}
                roundWinnerPlayerId={game.roundWinnerPlayerId}
                selectedTile={selectedTile}
                selectableBranches={selectableBranches}
                onSelectBranch={handleSelectBranch}
                boneyardCount={game.boneyardCount}
                shouldRenderPlayedBoardTiles={shouldRenderPlayedBoardTiles}
                finalTileAnimationTileId={finalTileAnimationTileId}
                onFinalTileAnimationComplete={handleFinalTileAnimationComplete}
                ref={boardAreaRef}
                hiddenTileId={tileFlight.hiddenBoardTileId}
              />
            </View>
          </View>

          <RoundResultReveal
            visible={shouldShowRoundResultReveal}
            roundResult={roundResult}
            players={game.players}
            topPlayer={topPlayer}
            leftPlayer={leftPlayer}
            rightPlayer={rightPlayer}
            humanPlayer={humanPlayer}
            qapatPlayerId={game.leaderPlayerId}
          />

          {isRoundResultReveal && isBlockedResult && !blockedIntroComplete && (
            <View style={styles.qapatIntroOverlay} pointerEvents="none">
              <Text style={styles.qapatIntroText}>{"\u0642\u06d5\u067e\u0627\u062a!"}</Text>
            </View>
          )}

          <PlayerProfilePopup
            player={profilePlayer}
            onDismiss={() => setProfilePlayer(null)}
          />

          {/* Next round countdown */}
          {shouldShowNextRoundCountdown && (
            <View style={styles.countdownOverlay} pointerEvents="none">
              <Text style={styles.countdownLabel}>
                {"\u062f\u06d5\u0648\u0631\u06cc \u0646\u0648\u06ce \u062f\u06d5\u0633\u062a \u067e\u06ce\u062f\u06d5\u06a9\u0627\u062a \u0644\u06d5"}
              </Text>
              <Text style={styles.countdownNumber}>
                {(game as any).nextRoundCountdown ?? 3}
              </Text>
            </View>
          )}

          <View style={styles.topRightActions}>
            <Pressable
              accessibilityLabel="Open game settings"
              style={styles.topRightActionButton}
              onPress={openMatchMenu}
            >
              <Ionicons name="menu-outline" size={22} color="#f8f3df" />
            </Pressable>
          </View>

          <View style={styles.bottomHudRow}>
            <MiniScoreBoard
              teamAName={miniScoreTeamAName}
              teamAScore={miniScoreTeamAScore}
              teamBName={miniScoreTeamBName}
              teamBScore={miniScoreTeamBScore}
              onPress={() => setShowScorePopup(true)}
            />
          </View>

          <DrawPilePrompt
            visible={game.canDrawTile || shouldShowPassPrompt}
            gameMode={gameMode}
            boneyardCount={game.boneyardCount}
            onDraw={handleDrawTile}
            onPass={shouldShowPassPrompt ? handlePassTurn : undefined}
            passCountdown={shouldShowPassPrompt ? passCountdown : undefined}
            drawCountdown={
              gameMode === "1v1" && game.canDrawTile
                ? (game as any).drawTimeLeft
                : undefined
            }
            passing={isPassingTurn}
          />

          <View style={styles.bottomArea}>
            <PlayerHand
              tiles={game.myHand}
              scale={1.1}
              onPlayTile={handleDropTile}
              onSelectTile={handlePreviewTile}
              disabled={!isMyTurn || game.canDrawTile}
              selectedTileId={selectedTile?.id ?? null}
              playableTileIds={playableTileIds}
              dealOrigin={dealOrigin}
              dealToken={dealToken}
              dealOrder={gameMode === "1v1" ? 1 : 0}
              dealPlayerCount={gameMode === "1v1" ? 2 : 4}
              hiddenTileId={tileFlight.hiddenHandTileId}
            />

            {shouldShowHumanTurnProgress && (
              <View style={styles.humanTurnProgressTrack}>
                {shouldShowHumanTurnProgressFill && (
                  <View
                    style={[
                      styles.humanTurnProgressFill,
                      { width: humanTurnProgressWidth },
                    ]}
                  />
                )}
              </View>
            )}
          </View>
          {/* WinnerPopup removed - replaced by round result overlay driven by game.phase */}

          <ScorePopup
            visible={showScorePopup}
            onClose={() => setShowScorePopup(false)}
            teamAScore={visibleScoreByTeam.teamA}
            teamBScore={visibleScoreByTeam.teamB}
            winnerTeamId={game.winningTeamId}
            matchReward={onlineMatchResultReward}
            teamAName={scoreTeamAName}
            teamBName={scoreTeamBName}
          />

<GameOverPopup
  visible={
    showGameOverPopup &&
    !isFinalTileAnimationRunning &&
    !isRoundResultReveal &&
    !shouldShowRoundResultReveal
  }
  didWin={didWinMatch}
  isPracticeMode={isPracticeMode}
  reward={practiceWinReward ?? onlineMatchResultReward}
  finishReason={(game as any).rawState?.finishReason ?? null}
  teamScores={{
    teamA: game.teamScores?.teamA ?? 0,
    teamB: game.teamScores?.teamB ?? 0,
  }}
  teamAName={scoreTeamAName}
  teamBName={scoreTeamBName}
  winningTeamId={game.winningTeamId}
  onClose={() => {
    setShowGameOverPopup(false);
    router.replace("/(tabs)/play");
  }}
  onPlayAgain={() => {
    if (isPracticeMode) {
      router.replace("/domino/play-ai");
      return;
    }

    router.replace("/(tabs)/play");
  }}
/>


<MultiplayerGameChat
  gameType="domino"
  matchId={roomId}
  mode={gameMode}
  currentUserId={profile?.id ?? localCurrentUserId}
  playerIdBySeat={{
    bottom: humanPlayer?.id,
    top: topPlayer?.id,
    left: leftPlayer?.id,
    right: rightPlayer?.id,
  }}
  enabled={!isLocalGame && !!roomId}
/><MatchMenuDrawer
  visible={showMatchMenu}
  players={game.players}
  humanPlayer={humanPlayer}
  translateX={matchMenuTranslateX}
  onClose={closeMatchMenu}
  onLeavePress={() => {
    closeMatchMenu();
    setShowLeaveConfirm(true);
  }}
/>

<LeaveMatchConfirmPopup
  visible={showLeaveConfirm}
  loading={isLeavingMatch}
  isLocalGame={isLocalGame}
  onCancel={() => setShowLeaveConfirm(false)}
  onConfirm={handleConfirmLeaveGame}
/>


        </TableBackground>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewDevOverlay: { ...StyleSheet.absoluteFill, alignItems: "flex-end", paddingTop: 44, paddingRight: 10, zIndex: 1000, elevation: 1000 },
  previewDevPanel: { width: 160, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", backgroundColor: "rgba(0,0,0,0.55)" },
  previewDevTitle: { color: "#fff", fontSize: 12, fontWeight: "700" },
  previewDevText: { marginTop: 4, color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "600" },
  previewRestartButton: { marginTop: 8, alignItems: "center", paddingVertical: 7, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.16)" },
  previewRestartText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  screen: {
    flex: 1,
    direction: "ltr",
    width: "100%",
    height: "100%",
    backgroundColor: "#03110b",
    overflow: "hidden",
  },

  centerScreen: {
    flex: 1,
    direction: "ltr",
    width: "100%",
    height: "100%",
    backgroundColor: "#03110b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  loadingOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  statusText: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  errorText: {
    marginTop: 8,
    color: "#fca5a5",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  stage: {
    flex: 1,
    direction: "ltr",
    width: "100%",
    height: "100%",
    backgroundColor: "#03110b",
    overflow: "hidden",
  },

  topOpponentArea: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },

  leftOpponentArea: {
    position: "absolute",
    left: -28,
    top: "50%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  leftOpponentRotation: {
    transform: [{ rotate: "-90deg" }],
  },

  rightOpponentArea: {
    position: "absolute",
    right: -28,
    top: "50%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  rightOpponentRotation: {
    transform: [{ rotate: "90deg" }],
  },

  avatarSlot: {
    minWidth: 138,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  middleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    zIndex: 20,
    width: "100%",
    paddingHorizontal: 0,
  },


  boardAreaWrap: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    marginBottom: -32,
  },

  bottomHudRow: {
    position: "absolute",
    right: 22,
    bottom: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 80,
  },

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
    borderColor: "rgba(248, 243, 223, 0.22)",
  },
  chatUnreadBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "#f8f3df",
  },

  chatUnreadText: {
    color: "#ffffff",
    fontSize: 9,
    lineHeight: 11,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },


  bottomArea: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    // The board intentionally extends beneath this area; keep the hand above it.
    zIndex: 30,
  },
  humanTurnProgressTrack: {
    width: 450,
    maxWidth: "92%",
    height: 3,
    marginTop: -1,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  humanTurnProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#facc15",
  },
  countdownOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 300,
  },
  qapatIntroOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 290,
  },
  qapatIntroText: {
    color: "#facc15",
    fontSize: 64,
    fontFamily: "SpedaBold",
    textAlign: "center",
    textShadowColor: "rgba(250, 204, 21, 0.9)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 16,
  },
  countdownLabel: {
    color: "#f8f3df",
    fontSize: 14,
    fontFamily: "SpedaBold",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  countdownNumber: {
    color: "#facc15",
    fontSize: 56,
    fontFamily: "RobotoMedium",
  },
});
