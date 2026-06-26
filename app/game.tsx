import BoardArea from "@/components/game/BoardArea";
import DrawPilePrompt from "@/components/game/DrawPilePrompt";
import GameOverPopup from "@/components/game/GameOverPopup";
import PlayerHand from "@/components/game/PlayerHand";
import PlayerSeat from "@/components/game/PlayerSeat";
import RoundResultReveal from "@/components/game/RoundResultReveal";
import ScorePopup from "@/components/game/ScorePopup";
import TableBackground from "@/components/game/TableBackground";
import LeaveMatchConfirmPopup from "@/components/game/LeaveMatchConfirmPopup";
import MatchMenuDrawer from "@/components/game/MatchMenuDrawer";
import { useDevTwoVsTwoBotGame } from "@/hooks/useDevTwoVsTwoBotGame";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { useGame } from "@/hooks/useGame";
import { useOneVsOneGame } from "@/hooks/useOneVsOneGame";
import { useRoundPresentation } from "@/hooks/useRoundPresentation";
import { useTwoVsTwoGame } from "@/hooks/useTwoVsTwoGame";
import { awardAiPracticeWin } from "@/lib/aiPracticeRewards";
import { ENABLE_DEV_2V2_BOT_TEST } from "@/lib/dev/devBotPlayers";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { DominoTileData, KozelBranch, TeamId } from "@/types/game";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  const { room_id, mode, practice, dev_bot_2v2 } = useLocalSearchParams();
  const router = useRouter();

  const roomId = String(room_id ?? "");

  const rawMode = Array.isArray(mode) ? mode[0] : mode;

  const gameMode: "1v1" | "2v2" = rawMode === "2v2" ? "2v2" : "1v1";

  const isPracticeMode = practice === "true";
  const isDevBotTwoVsTwo = ENABLE_DEV_2V2_BOT_TEST && dev_bot_2v2 === "true";
  const isLocalGame = isPracticeMode || isDevBotTwoVsTwo;

  const practiceGame = useGame(gameMode, true);
  const devBotTwoVsTwoGame = useDevTwoVsTwoBotGame();

  const oneVsOneGame = useOneVsOneGame(
    !isLocalGame && gameMode === "1v1" ? roomId : undefined,
  );

  const twoVsTwoGame = useTwoVsTwoGame(
    !isLocalGame && gameMode === "2v2" ? roomId : undefined,
  );

  const game = isPracticeMode
    ? practiceGame
    : isDevBotTwoVsTwo
      ? devBotTwoVsTwoGame
      : gameMode === "1v1"
        ? oneVsOneGame
        : twoVsTwoGame;

  const gameLoading = !isLocalGame && (game as any).loading;
  const gameError = !isLocalGame ? (game as any).error : null;

  const { refreshProfile } = useProfile();

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
  const [passCountdown, setPassCountdown] = useState(15);
  const [isPassingTurn, setIsPassingTurn] = useState(false);
  const [sideSeatHeight, setSideSeatHeight] = useState(0);
  const [dealOrigin, setDealOrigin] = useState<{ x: number; y: number } | null>(null);
  const [dealToken, setDealToken] = useState(0);

  const gameInitializedRef = useRef(false);
  const practiceRewardSettlementRequestedRef = useRef(false);
  const practiceMatchIdRef = useRef(roomId || `${Date.now()}-${Math.random()}`);
  const boardAreaRef = useRef<any>(null);
  const previousHandSignatureRef = useRef<string | null>(null);
  const passRequestedRef = useRef(false);
  const passTurnRef = useRef(game.passTurn);
  passTurnRef.current = game.passTurn;
  const localCurrentUserId =
    !isLocalGame && gameMode === "1v1"
      ? ((game as any).currentUserId ?? null)
      : currentUserId;

  useEffect(() => {
    gameInitializedRef.current = false;
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
    if (isLocalGame) return;
    if (gameLoading) return;
    if (gameInitializedRef.current) return;
    if (!roomId) return;

    const initializeGame = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from(gameMode === "1v1" ? "one_vs_one_rooms" : "two_vs_two_rooms")
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

        const { error } =
          gameMode === "1v1"
            ? await supabase.rpc("start_one_vs_one_game", {
                p_room_id: roomId,
              })
            : await supabase.rpc("start_two_vs_two_game", {
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
  const isTurnRingVisible = !game.roundWinnerPlayerId && !game.winningTeamId;

  const humanPlayer = isLocalGame
    ? game.players.find((p) => p.kind === "human")
    : game.players.find((p) => p.id === localCurrentUserId);

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

  const isMyTurn =
    !isLocalGame && gameMode === "1v1"
      ? !!localCurrentUserId && game.currentTurnPlayerId === localCurrentUserId
      : !!humanPlayer && game.currentTurnPlayerId === humanPlayer.id;
  const debugMyPlayerIndex = (game as any).myPlayerIndex ?? null;
  const debugOpponentPlayerIndex = (game as any).opponentPlayerIndex ?? null;

  useEffect(() => {
    if (isLocalGame || gameLoading) return;

    console.log("[1v1 game screen turn]", {
      roomId,
      frontendCurrentUserId: localCurrentUserId,
      gameCurrentTurnPlayerId: game.currentTurnPlayerId,
      humanPlayerId: humanPlayer?.id ?? null,
      isMyTurn,
      myPlayerIndex: debugMyPlayerIndex,
      opponentPlayerIndex: debugOpponentPlayerIndex,
      myHandIds: game.myHand.map((tile) => tile.id),
      activePlayerIds: game.players
        .filter((player) => player.isActive)
        .map((player) => player.id),
      players: game.players.map((player) => ({
        id: player.id,
        seat: player.seat,
        isActive: player.isActive,
        tileCount: player.tileCount,
      })),
    });
  }, [
    isLocalGame,
    gameLoading,
    roomId,
    localCurrentUserId,
    game.currentTurnPlayerId,
    humanPlayer?.id,
    isMyTurn,
    debugMyPlayerIndex,
    debugOpponentPlayerIndex,
    game.myHand,
    game.players,
  ]);

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
    !game.canDrawTile &&
    playableTileIds.length === 0;

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
      setPassCountdown(15);
      setIsPassingTurn(false);
      passRequestedRef.current = false;
      return;
    }

    setPassCountdown(15);
    const interval = setInterval(() => {
      setPassCountdown((previous) => {
        if (previous <= 1) {
          clearInterval(interval);
          void handlePassTurn();
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [game.currentTurnPlayerId, shouldShowPassPrompt, handlePassTurn]);

  useEffect(() => {
    if (!isMyTurn) {
      setSelectedTile(null);
      setSelectableBranches([]);
    }
  }, [isMyTurn]);

  useEffect(() => {
    if (!selectedTile) return;

    const stillInHand = game.myHand.some((tile) => tile.id === selectedTile.id);

    if (!stillInHand) {
      setSelectedTile(null);
      setSelectableBranches([]);
    }
  }, [game.myHand, selectedTile]);

  const clearSelection = () => {
    setSelectedTile(null);
    setSelectableBranches([]);
  };

  const isTileInMyHand = (tile: DominoTileData) => {
    return game.myHand.some((handTile) => handTile.id === tile.id);
  };

  const handlePreviewTile = (tile: DominoTileData) => {
    if (!isMyTurn) return;
    if (!isTileInMyHand(tile)) return;

    const branches = game.availableBranchesForTile(tile);

    if (!branches.length) {
      clearSelection();
      return;
    }

    setSelectedTile(tile);
    setSelectableBranches(branches);
  };

  const handleDropTile = async (
    tile: DominoTileData,
    dropPoint: { x: number; y: number },
  ) => {
    if (!isMyTurn) return;
    if (!isTileInMyHand(tile)) return;

    const branches = game.availableBranchesForTile(tile);

    if (!branches.length) {
      clearSelection();
      return;
    }

    const branch = await boardAreaRef.current?.findDropBranch?.(
      tile,
      branches,
      dropPoint,
    );

    if (!branch || !branches.includes(branch)) {
      clearSelection();
      return;
    }

    // Remove the translucent placement preview before the board receives the
    // confirmed move. Otherwise the confirmed tile and its preview overlap
    // briefly while the multiplayer request resolves.
    clearSelection();

    try {
      const played = await game.playTile(tile, branch);

      if (!played) {
        setSelectedTile(tile);
        setSelectableBranches(branches);
      }
    } catch (err) {
      console.warn("play tile failed", err);
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

    try {
      const played = await game.playTile(tileToPlay, branch);

      if (!played && isTileInMyHand(tileToPlay)) {
        setSelectedTile(tileToPlay);
        setSelectableBranches(branches);
      }
    } catch (err) {
      console.warn("play tile failed", err);
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
          await supabase.rpc("leave_one_vs_one_match", {
            p_room_id: roomId,
          });
        } else {
          await supabase.rpc("leave_two_vs_two_match", {
            p_room_id: roomId,
          });
        }
      }

      setShowLeaveConfirm(false);
      router.replace("/(tabs)/lobby");
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

  const didWinMatch = humanPlayer?.teamId
    ? game.winningTeamId === humanPlayer.teamId
    : game.winningTeamId === "teamA";

  const practiceWinReward = useMemo(
    () =>
      isPracticeMode && didWinMatch && game.winningTeamId
        ? { tier: "close" as const, gold: 0, points: 1 }
        : null,
    [didWinMatch, game.winningTeamId, isPracticeMode],
  );

  useEffect(() => {
    console.log("[AI practice reward] reward effect evaluated", {
      isPracticeMode,
      winningTeamId: game.winningTeamId,
      didWinMatch,
      humanPlayerId: humanPlayer?.id ?? null,
      humanTeamId: humanPlayer?.teamId ?? null,
      showGameOverPopup,
      hasPracticeWinReward: !!practiceWinReward,
      alreadyRequested: practiceRewardSettlementRequestedRef.current,
      practiceMatchId: practiceMatchIdRef.current,
    });

    if (!practiceWinReward) return;
    if (!showGameOverPopup) return;
    if (practiceRewardSettlementRequestedRef.current) return;

    practiceRewardSettlementRequestedRef.current = true;

    const persistPracticeReward = async () => {
      try {
        console.log("[AI practice reward] before awardAiPracticeWin call", {
          practiceMatchId: practiceMatchIdRef.current,
          rewardPoints: practiceWinReward.points,
          winningTeamId: game.winningTeamId,
          humanTeamId: humanPlayer?.teamId ?? null,
        });

        const claim = await awardAiPracticeWin(practiceMatchIdRef.current);

        console.log("[AI practice reward] after awardAiPracticeWin call", {
          claim,
        });

        const refreshedProfile = await refreshProfile();

        console.log("[AI practice reward] after refreshProfile", {
          profileId: refreshedProfile?.id ?? null,
          profilePoints: refreshedProfile?.points ?? null,
        });
      } catch (error) {
        practiceRewardSettlementRequestedRef.current = false;
        console.warn("Unable to persist AI practice win reward", error);
      }
    };

    void persistPracticeReward();
  }, [
    didWinMatch,
    game.winningTeamId,
    humanPlayer?.id,
    humanPlayer?.teamId,
    isPracticeMode,
    practiceWinReward,
    showGameOverPopup,
    refreshProfile,
  ]);

  const shouldRenderPlayedBoardTiles =
    (game as any).phase === "playing" || isFinalTileAnimationRunning;
  const isRoundResultReveal = (game as any).phase === "round_result_reveal";
  const shouldShowRoundResultReveal =
    isRoundResultReveal && !isFinalTileAnimationRunning;
  const shouldShowNextRoundCountdown =
    (game as any).phase === "next_round_countdown" &&
    !isFinalTileAnimationRunning;


  if (gameLoading) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.statusText}>یاری بار دەکرێت...</Text>
      </View>
    );
  }

  if (gameError) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.statusText}>نەتوانرا یارییەکە باربکرێت</Text>
        <Text style={styles.errorText}>{gameError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.stage}>
        <TableBackground>
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
                  />
                </View>
              </View>
            </View>
          )}

          <View style={styles.middleRow}>
            <View style={styles.boardAreaWrap}>
              <BoardArea
                board={game.board}
                players={game.players}
                lastScoringEvent={game.lastScoringEvent}
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
              />
            </View>
          </View>

          <RoundResultReveal
            visible={shouldShowRoundResultReveal}
            roundResult={(game as any).roundResult}
            players={game.players}
            topPlayer={topPlayer}
            leftPlayer={leftPlayer}
            rightPlayer={rightPlayer}
            humanPlayer={humanPlayer}
          />

          {/* Next round countdown */}
          {shouldShowNextRoundCountdown && (
            <View style={styles.countdownOverlay} pointerEvents="none">
              <Text style={styles.countdownLabel}>
                دەوری نوێ دەست پێدەکات لە
              </Text>
              <Text style={styles.countdownNumber}>
                {(game as any).nextRoundCountdown ?? 3}
              </Text>
            </View>
          )}

          <View style={styles.bottomHudRow}>
            <Pressable
              style={styles.miniScoreBoard}
              onPress={() => setShowScorePopup(true)}
            >
              <View style={styles.miniScoreItem}>
                <Text numberOfLines={1} style={styles.miniScoreLabel}>
                  {miniScoreTeamAName}
                </Text>
                <Text style={styles.miniScoreValue}>
                  {game.teamScores?.teamA ?? 0}
                </Text>
              </View>

              <View style={styles.miniScoreDivider} />

              <View style={styles.miniScoreItem}>
                <Text numberOfLines={1} style={styles.miniScoreLabel}>
                  {miniScoreTeamBName}
                </Text>
                <Text style={styles.miniScoreValue}>
                  {game.teamScores?.teamB ?? 0}
                </Text>
              </View>
            </Pressable>

            {!showMatchMenu ? (
              <Pressable
                accessibilityLabel="Open match settings"
                style={styles.matchMenuButton}
                onPress={openMatchMenu}
              >
                <Ionicons name="settings-outline" size={22} color="#f8f3df" />
              </Pressable>
            ) : null}
          </View>

          <DrawPilePrompt
            visible={game.canDrawTile || shouldShowPassPrompt}
            gameMode={gameMode}
            boneyardCount={game.boneyardCount}
            onDraw={handleDrawTile}
            onPass={shouldShowPassPrompt ? handlePassTurn : undefined}
            passCountdown={shouldShowPassPrompt ? passCountdown : undefined}
            passing={isPassingTurn}
          />

          <View style={styles.bottomArea}>
            <PlayerHand
              tiles={game.myHand}
              onPlayTile={handleDropTile}
              onSelectTile={handlePreviewTile}
              disabled={!isMyTurn || game.canDrawTile}
              selectedTileId={selectedTile?.id ?? null}
              playableTileIds={playableTileIds}
              dealOrigin={dealOrigin}
              dealToken={dealToken}
              dealOrder={gameMode === "1v1" ? 1 : 0}
              dealPlayerCount={gameMode === "1v1" ? 2 : 4}
            />
          </View>

          {/* WinnerPopup removed — replaced by round result overlay driven by game.phase */}

          <ScorePopup
            visible={showScorePopup}
            onClose={() => setShowScorePopup(false)}
            teamAScore={game.teamScores?.teamA ?? 0}
            teamBScore={game.teamScores?.teamB ?? 0}
            winnerTeamId={game.winningTeamId}
            matchReward={game.matchReward}
            teamAName={scoreTeamAName}
            teamBName={scoreTeamBName}
          />

<GameOverPopup
  visible={showGameOverPopup && !isFinalTileAnimationRunning}
  didWin={didWinMatch}
  reward={practiceWinReward ?? game.matchReward}
  teamScores={{
    teamA: game.teamScores?.teamA ?? 0,
    teamB: game.teamScores?.teamB ?? 0,
  }}
  onClose={() => {
    setShowGameOverPopup(false);
    router.replace("/(tabs)/lobby");
  }}
  onPlayAgain={() => {
    if (isPracticeMode) {
      router.replace("/play-ai");
      return;
    }

    router.replace("/(tabs)/lobby");
  }}
/>

<MatchMenuDrawer
  visible={showMatchMenu}
  players={game.players}
  humanPlayer={humanPlayer}
  currentTurnPlayerId={game.currentTurnPlayerId}
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
  onCancel={() => setShowLeaveConfirm(false)}
  onConfirm={handleConfirmLeaveGame}
/>


        </TableBackground>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    // Extend only the playable board behind the hand; bottomArea keeps its
    // normal layout position and PlayerHand does not move.
    marginBottom: -32,
  },


  miniScoreBoard: {
    minWidth: 142,
    maxWidth: 178,
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    zIndex: 80,
    borderWidth: 1,
    borderColor: "rgba(248, 243, 223, 0.22)",
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

  miniScoreItem: {
    minWidth: 46,
    maxWidth: 78,
    alignItems: "center",
    justifyContent: "center",
  },

  miniScoreLabel: {
    color: "#f8f3df",
    fontSize: 9,
    fontFamily: "RobotoMedium",
    letterSpacing: 0,
    maxWidth: "100%",
  },

  miniScoreValue: {
    marginTop: 1,
    color: "#facc15",
    fontSize: 10,
    fontFamily: "RobotoMedium",
  },

  miniScoreDivider: {
    width: 1,
    height: 22,
    marginHorizontal: 10,
    backgroundColor: "rgba(250, 204, 21, 0.35)",
  },

  matchMenuButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248, 243, 223, 0.22)",
  },


  bottomArea: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    // The board intentionally extends beneath this area; keep the hand above it.
    zIndex: 30,
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
