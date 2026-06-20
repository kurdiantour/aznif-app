import BoardArea from '@/components/game/BoardArea';
import DominoTile from '@/components/game/DominoTile';
import DrawPilePrompt from '@/components/game/DrawPilePrompt';
import GameOverPopup from '@/components/game/GameOverPopup';
import PlayerHand from '@/components/game/PlayerHand';
import PlayerSeat from '@/components/game/PlayerSeat';
import ScorePopup from '@/components/game/ScorePopup';
import TableBackground from '@/components/game/TableBackground';
import { useGame } from '@/hooks/useGame';
import { useOneVsOneGame } from '@/hooks/useOneVsOneGame';
import { useTwoVsTwoGame } from '@/hooks/useTwoVsTwoGame';
import { awardAiPracticeWin } from '@/lib/aiPracticeRewards';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { DominoTileData, KozelBranch } from '@/types/game';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const HUMAN_BRANCH_PRIORITY: KozelBranch[] = ['right', 'left', 'up', 'down'];

function pickHumanBranch(branches: KozelBranch[]) {
  return HUMAN_BRANCH_PRIORITY.find((branch) => branches.includes(branch)) ?? branches[0];
}

function getTeamName(players: any[], teamId: 'teamA' | 'teamB', fallback: string) {
  const names = players
    .filter((player) => player.teamId === teamId)
    .map((player) => player.name)
    .filter(Boolean);

  return names.length ? names.join(' & ') : fallback;
}

export default function GameScreen() {
  const { room_id, mode, practice } = useLocalSearchParams();
  const router = useRouter();

  const roomId = String(room_id ?? '');

  const rawMode = Array.isArray(mode) ? mode[0] : mode;

  const gameMode: '1v1' | '2v2' =
    rawMode === '2v2' ? '2v2' : '1v1';

  const isPracticeMode = practice === 'true';

  const practiceGame = useGame(gameMode, true);

  const oneVsOneGame = useOneVsOneGame(
    !isPracticeMode && gameMode === '1v1'
      ? roomId
      : undefined,
  );

  const twoVsTwoGame = useTwoVsTwoGame(
    !isPracticeMode && gameMode === '2v2'
      ? roomId
      : undefined,
  );

  const game = isPracticeMode
    ? practiceGame
    : gameMode === '1v1'
      ? oneVsOneGame
      : twoVsTwoGame;

  const gameLoading = !isPracticeMode && (game as any).loading;
  const gameError = !isPracticeMode ? (game as any).error : null;
    
  const { refreshProfile } = useProfile();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showScorePopup, setShowScorePopup] = useState(false);
  const [showGameOverPopup, setShowGameOverPopup] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeavingMatch, setIsLeavingMatch] = useState(false);
  const [selectedTile, setSelectedTile] = useState<DominoTileData | null>(null);
  const [selectableBranches, setSelectableBranches] = useState<KozelBranch[]>([]);
  const [finalTileAnimationTileId, setFinalTileAnimationTileId] = useState<string | null>(null);
  const [isFinalTileAnimationRunning, setIsFinalTileAnimationRunning] = useState(false);
  const [passCountdown, setPassCountdown] = useState(15);
  const [isPassingTurn, setIsPassingTurn] = useState(false);

  const gameInitializedRef = useRef(false);
  const rewardSettlementRequestedRef = useRef(false);
  const practiceRewardSettlementRequestedRef = useRef(false);
  const practiceMatchIdRef = useRef(roomId || `${Date.now()}-${Math.random()}`);
  const animatedFinalTileKeyRef = useRef<string | null>(null);
  const boardAreaRef = useRef<any>(null);
  const passRequestedRef = useRef(false);
  const passTurnRef = useRef(game.passTurn);
  passTurnRef.current = game.passTurn;
  const localCurrentUserId =
    !isPracticeMode && gameMode === '1v1'
      ? ((game as any).currentUserId ?? null)
      : currentUserId;

  useEffect(() => {
    gameInitializedRef.current = false;
    rewardSettlementRequestedRef.current = false;
    practiceRewardSettlementRequestedRef.current = false;
    practiceMatchIdRef.current = roomId || `${Date.now()}-${Math.random()}`;
    animatedFinalTileKeyRef.current = null;
    setFinalTileAnimationTileId(null);
    setIsFinalTileAnimationRunning(false);
  }, [roomId, gameMode, isPracticeMode]);

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
    if (isPracticeMode) return;
    if (gameLoading) return;
    if (gameInitializedRef.current) return;
    if (!roomId) return;

    const initializeGame = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from(gameMode === '1v1' ? 'one_vs_one_rooms' : 'two_vs_two_rooms')
          .select('status, state')
          .eq('id', roomId)
          .maybeSingle();

        if (roomError) {
          console.warn('Failed to fetch room data', roomError);
          return;
        }

        if (!roomData) return;

        const hasStarted =
          roomData.state?.status === 'started' || !!roomData.state?.handCounts;

        if (hasStarted) return;
        if (roomData.status !== 'waiting' && roomData.status !== 'active') return;

        gameInitializedRef.current = true;

        const { error } =
          gameMode === '1v1'
            ? await supabase.rpc('start_one_vs_one_game', {
                p_room_id: roomId,
              })
            : await supabase.rpc('start_two_vs_two_game', {
                p_room_id: roomId,
              });

        if (error) {
          console.warn('Failed to start game (may already be started)', error);
        }
      } catch (err) {
        console.warn('Error initializing game', err);
      }
    };

    void initializeGame();
  }, [isPracticeMode, gameLoading, roomId, gameMode]);

  const topPlayer = game.players.find((p) => p.seat === 'top');
  const leftPlayer = game.players.find((p) => p.seat === 'left');
  const rightPlayer = game.players.find((p) => p.seat === 'right');

  const humanPlayer = isPracticeMode
    ? game.players.find((p) => p.kind === 'human')
    : game.players.find((p) => p.id === localCurrentUserId);

  const isMyTurn =
    !isPracticeMode && gameMode === '1v1'
      ? !!localCurrentUserId && game.currentTurnPlayerId === localCurrentUserId
      : !!humanPlayer && game.currentTurnPlayerId === humanPlayer.id;
  const debugMyPlayerIndex = (game as any).myPlayerIndex ?? null;
  const debugOpponentPlayerIndex = (game as any).opponentPlayerIndex ?? null;

  useEffect(() => {
    if (isPracticeMode || gameLoading) return;

    console.log('[1v1 game screen turn]', {
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
    isPracticeMode,
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
    (game as any).phase === 'playing' &&
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
      console.warn('pass turn failed', err);
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
    // Winner popup removed; UI uses new round result overlay driven by game.phase
  }, [game.roundWinnerPlayerId]);

  useEffect(() => {
    if (isPracticeMode) return;
    if (!roomId) return;
    if (!game.winningTeamId) return;
    if (rewardSettlementRequestedRef.current) return;

    rewardSettlementRequestedRef.current = true;

    const settleRewards = async () => {
      try {
        await supabase.rpc('settle_match_rewards', {
          p_mode: gameMode,
          p_room_id: roomId,
        });

        await refreshProfile();
      } catch (error) {
        console.warn('Unable to settle match rewards', error);
      }
    };

    void settleRewards();
  }, [isPracticeMode, roomId, game.winningTeamId, gameMode, refreshProfile]);

  useEffect(() => {
    if (game.winningTeamId) {
      setShowScorePopup(false);
      setShowGameOverPopup(true);
    }
  }, [game.winningTeamId]);

  useEffect(() => {
    const winnerId = game.roundWinnerPlayerId;
    const lastPlayedTile = game.lastPlayedTile;

    if (!winnerId || !lastPlayedTile) return;

    const roundWinner = game.players.find((player) => player.id === winnerId);

    if (!roundWinner || roundWinner.tileCount !== 0) return;

    const animationKey = `${winnerId}:${lastPlayedTile.id}`;

    if (animatedFinalTileKeyRef.current === animationKey) return;

    animatedFinalTileKeyRef.current = animationKey;
    setFinalTileAnimationTileId(lastPlayedTile.id);
    setIsFinalTileAnimationRunning(true);
  }, [game.roundWinnerPlayerId, game.lastPlayedTile, game.players]);

  const handleFinalTileAnimationComplete = useCallback(() => {
    setIsFinalTileAnimationRunning(false);
    setFinalTileAnimationTileId(null);
  }, []);

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

  const handleDropTile = async (tile: DominoTileData) => {
    if (!isMyTurn) return;
    if (!isTileInMyHand(tile)) return;

    const branches = game.availableBranchesForTile(tile);

    if (!branches.length) {
      clearSelection();
      return;
    }

    const branch = pickHumanBranch(branches);

    try {
      const played = await game.playTile(tile, branch);

      if (played) {
        clearSelection();
      } else {
        setSelectedTile(tile);
        setSelectableBranches(branches);
      }
    } catch (err) {
      console.warn('play tile failed', err);
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

    try {
      const played = await game.playTile(selectedTile, branch);

      if (played) clearSelection();
    } catch (err) {
      console.warn('play tile failed', err);
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
      if (!isPracticeMode && roomId) {
        if (gameMode === '1v1') {
          await supabase.rpc('leave_one_vs_one_match', {
            p_room_id: roomId,
          });
        } else {
          await supabase.rpc('leave_two_vs_two_match', {
            p_room_id: roomId,
          });
        }
      }

      setShowLeaveConfirm(false);
      router.replace('/(tabs)/lobby');
    } catch (error) {
      console.warn('Failed to leave game', error);
      setIsLeavingMatch(false);
    }
  };

  const scoreTeamAName = getTeamName(game.players, 'teamA', 'Team A');
  const scoreTeamBName = getTeamName(game.players, 'teamB', 'Team B');

  const didWinMatch = humanPlayer?.teamId
    ? game.winningTeamId === humanPlayer.teamId
    : game.winningTeamId === 'teamA';

  const practiceWinReward = useMemo(
    () =>
      isPracticeMode && didWinMatch && game.winningTeamId
        ? { tier: 'close' as const, gold: 0, points: 1 }
        : null,
    [didWinMatch, game.winningTeamId, isPracticeMode],
  );

  useEffect(() => {
    console.log('[AI practice reward] reward effect evaluated', {
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
        console.log('[AI practice reward] before awardAiPracticeWin call', {
          practiceMatchId: practiceMatchIdRef.current,
          rewardPoints: practiceWinReward.points,
          winningTeamId: game.winningTeamId,
          humanTeamId: humanPlayer?.teamId ?? null,
        });

        const claim = await awardAiPracticeWin(practiceMatchIdRef.current);

        console.log('[AI practice reward] after awardAiPracticeWin call', {
          claim,
        });

        const refreshedProfile = await refreshProfile();

        console.log('[AI practice reward] after refreshProfile', {
          profileId: refreshedProfile?.id ?? null,
          profilePoints: refreshedProfile?.points ?? null,
        });
      } catch (error) {
        practiceRewardSettlementRequestedRef.current = false;
        console.warn('Unable to persist AI practice win reward', error);
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
    (game as any).phase === 'playing' || isFinalTileAnimationRunning;
  const isRoundResultReveal = (game as any).phase === 'round_result_reveal';
  const shouldShowRoundResultReveal = isRoundResultReveal && !isFinalTileAnimationRunning;
  const shouldShowNextRoundCountdown =
    (game as any).phase === 'next_round_countdown' && !isFinalTileAnimationRunning;

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
                  player={topPlayer}
                  remainingTiles={topPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === topPlayer.id}
                />
              </View>
            </View>
          )}

          {leftPlayer && (
            <View style={styles.leftOpponentArea}>
              <View style={styles.avatarSlot}>
                <PlayerSeat
                  player={leftPlayer}
                  remainingTiles={leftPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === leftPlayer.id}
                />
              </View>
            </View>
          )}

          {rightPlayer && (
            <View style={styles.rightOpponentArea}>
              <View style={styles.avatarSlot}>
                <PlayerSeat
                  player={rightPlayer}
                  remainingTiles={rightPlayer.tileCount}
                  showPass={game.lastPassedPlayerId === rightPlayer.id}
                />
              </View>
            </View>
          )}

          <View style={styles.middleRow}>
            <View style={styles.sideArea} />

            <View style={styles.boardAreaWrap}>
              <BoardArea
                board={game.board}
                lastScoringEvent={game.lastScoringEvent}
                roundWinnerPlayerId={game.roundWinnerPlayerId}
                selectableBranches={selectableBranches}
                onSelectBranch={handleSelectBranch}
                boneyardCount={game.boneyardCount}
                shouldRenderPlayedBoardTiles={shouldRenderPlayedBoardTiles}
                finalTileAnimationTileId={finalTileAnimationTileId}
                onFinalTileAnimationComplete={handleFinalTileAnimationComplete}
                ref={boardAreaRef}
              />
            </View>

            <View style={styles.sideArea} />
          </View>

          {/* Round result reveal */}
          {shouldShowRoundResultReveal && (game as any).roundResult && (
            <View style={styles.resultOverlay} pointerEvents="none">
              <View style={styles.resultCenter}>
                <Text style={styles.resultWinnerText}>
                  {(() => {
                    const winnerId = (game as any).roundResult?.winnerId;
                    const winner = game.players.find((p) => p.id === winnerId);
                    return winner ? `${winner.name} بردیەوە` : 'کۆتایی هاتنی دەور';
                  })()}
                </Text>
                <Text style={styles.resultPointsText}>+{(game as any).roundResult?.awardedPoints ?? 0}</Text>
              </View>

              {/* Top player tiles */}
              {topPlayer && (
                <View style={[styles.revealTilesTop]}>
                  <View style={styles.revealTilesRow}>
                    {((game as any).roundResult?.remainingTilesByPlayer?.[topPlayer.id] ?? []).map((t: any) => (
                      <DominoTile key={t.id} tile={t} width={28} height={54} />
                    ))}
                  </View>
                  <Text style={styles.revealPipsText}>
                    {((game as any).roundResult?.remainingPipsByPlayer?.[topPlayer.id] ?? 0)} pips
                  </Text>
                </View>
              )}

              {/* Left player tiles */}
              {leftPlayer && (
                <View style={[styles.revealTilesLeft]}>
                  {((game as any).roundResult?.remainingTilesByPlayer?.[leftPlayer.id] ?? []).map((t: any) => (
                    <DominoTile key={t.id} tile={t} width={24} height={46} rotation={90} />
                  ))}
                  <Text style={styles.revealPipsText}>
                    {((game as any).roundResult?.remainingPipsByPlayer?.[leftPlayer.id] ?? 0)} pips
                  </Text>
                </View>
              )}

              {/* Right player tiles */}
              {rightPlayer && (
                <View style={[styles.revealTilesRight]}>
                  {((game as any).roundResult?.remainingTilesByPlayer?.[rightPlayer.id] ?? []).map((t: any) => (
                    <DominoTile key={t.id} tile={t} width={24} height={46} rotation={270} />
                  ))}
                  <Text style={styles.revealPipsText}>
                    {((game as any).roundResult?.remainingPipsByPlayer?.[rightPlayer.id] ?? 0)} pips
                  </Text>
                </View>
              )}

              {/* Bottom/human player tiles */}
              {humanPlayer && (
                <View style={[styles.revealTilesBottom]}>
                  <Text style={styles.revealPipsText}>
                    {((game as any).roundResult?.remainingPipsByPlayer?.[humanPlayer.id] ?? 0)} pips
                  </Text>
                  <View style={styles.revealTilesRow}>
                    {((game as any).roundResult?.remainingTilesByPlayer?.[humanPlayer.id] ?? []).map((t: any) => (
                      <DominoTile key={t.id} tile={t} width={28} height={54} />
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Next round countdown */}
          {shouldShowNextRoundCountdown && (
            <View style={styles.countdownOverlay} pointerEvents="none">
              <Text style={styles.countdownLabel}>دەوری نوێ دەست پێدەکات لە</Text>
              <Text style={styles.countdownNumber}>{(game as any).nextRoundCountdown ?? 3}</Text>
            </View>
          )}

          <Pressable style={styles.miniScoreBoard} onPress={() => setShowScorePopup(true)}>
            <View style={styles.miniScoreItem}>
              <Text style={styles.miniScoreLabel}>{game.mode === '1v1' ? 'تۆ' : 'تیمی A'}</Text>
              <Text style={styles.miniScoreValue}>{game.teamScores?.teamA ?? 0}</Text>
            </View>

            <View style={styles.miniScoreDivider} />

            <View style={styles.miniScoreItem}>
              <Text style={styles.miniScoreLabel}>تیمی B</Text>
              <Text style={styles.miniScoreValue}>{game.teamScores?.teamB ?? 0}</Text>
            </View>
          </Pressable>

          <Pressable style={styles.leaveButton} onPress={() => setShowLeaveConfirm(true)}>
            <Text style={styles.leaveButtonText}>دەرچوون</Text>
          </Pressable>

          <DrawPilePrompt
            visible={game.canDrawTile || shouldShowPassPrompt}
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
  onClose={() => {
    setShowGameOverPopup(false);
    router.replace('/(tabs)/lobby');
  }}
  onPlayAgain={() => {
    if (isPracticeMode) {
      router.replace('/play-ai');
      return;
    }

    router.replace('/(tabs)/lobby');
  }}
/>

          <Modal transparent visible={showLeaveConfirm} animationType="fade">
            <View style={styles.leaveModalBackdrop}>
              <View style={styles.leaveModal}>
                <Text style={styles.leaveModalTitle}>لە یارییەکە دەچیتە دەرەوە؟</Text>
                <Text style={styles.leaveModalBody}>
                  If you leave now, a bot will continue playing for you. If you do not return before the current round ends, the match will be counted as a loss.
                </Text>

                <View style={styles.leaveModalActions}>
                  <Pressable
                    style={styles.leaveCancelButton}
                    onPress={() => setShowLeaveConfirm(false)}
                    disabled={isLeavingMatch}
                  >
                    <Text style={styles.leaveCancelText}>پاشگەزبوونەوە</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.leaveConfirmButton, isLeavingMatch && styles.leaveButtonDisabled]}
                    onPress={handleConfirmLeaveGame}
                    disabled={isLeavingMatch}
                  >
                    {isLeavingMatch ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.leaveConfirmText}>دەرچوون لە یاری</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        </TableBackground>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    direction: 'ltr',
    width: '100%',
    height: '100%',
    backgroundColor: '#03110b',
    overflow: 'hidden',
  },

  centerScreen: {
    flex: 1,
    direction: 'ltr',
    width: '100%',
    height: '100%',
    backgroundColor: '#03110b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  statusText: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  errorText: {
    marginTop: 8,
    color: '#fca5a5',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  stage: {
    flex: 1,
    direction: 'ltr',
    width: '100%',
    height: '100%',
    backgroundColor: '#03110b',
    overflow: 'hidden',
  },

  topOpponentArea: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },

  leftOpponentArea: {
    position: 'absolute',
    left: -28,
    top: '42%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    transform: [{ rotate: '-90deg' }],
  },

  rightOpponentArea: {
    position: 'absolute',
    right: -28,
    top: '42%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    transform: [{ rotate: '90deg' }],
  },

  avatarSlot: {
    minWidth: 138,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  middleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    zIndex: 20,
    width: '100%',
    paddingHorizontal: 6,
  },

  sideArea: {
    width: 60,
    flexShrink: 0,
  },

  boardAreaWrap: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    transform: [{ translateY: 10 }],
  },

  miniScoreBoard: {
    position: 'absolute',
    right: 34,
    bottom: 32,
    minWidth: 142,
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 40, 29, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.7)',
    zIndex: 80,
  },

  miniScoreItem: {
    minWidth: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },

  miniScoreLabel: {
    color: '#f8f3df',
    fontSize: 9,
    fontFamily: 'SpedaBold',
    letterSpacing: 0.4,
  },

  miniScoreValue: {
    marginTop: 1,
    color: '#facc15',
    fontSize: 14,
    fontFamily: 'SpedaBold',
  },

  miniScoreDivider: {
    width: 1,
    height: 22,
    marginHorizontal: 10,
    backgroundColor: 'rgba(250, 204, 21, 0.35)',
  },

  leaveButton: {
    position: 'absolute',
    top: 42,
    left: 18,
    minWidth: 82,
    height: 36,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 999,
  },

  leaveButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },

  leaveModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  leaveModal: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 8,
    padding: 20,
    backgroundColor: '#082016',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.45)',
  },

  leaveModalTitle: {
    color: '#f8f3df',
    fontSize: 18,
    fontFamily: 'SpedaBold',
    textAlign: 'center',
  },

  leaveModalBody: {
    marginTop: 12,
    color: '#d7e2d2',
    fontSize: 13,
    fontFamily: 'SpedaBold',
    lineHeight: 19,
    textAlign: 'center',
  },

  leaveModalActions: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },

  leaveCancelButton: {
    minWidth: 112,
    height: 38,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },

  leaveConfirmButton: {
    minWidth: 128,
    height: 38,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dc2626',
  },

  leaveButtonDisabled: {
    opacity: 0.65,
  },

  leaveCancelText: {
    color: '#f8f3df',
    fontSize: 13,
    fontFamily: 'SpedaBold',
  },

  leaveConfirmText: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'SpedaBold',
  },

  bottomArea: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    zIndex: 50,
  },
  resultOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  resultCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,17,11,0.8)',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.6)',
    marginBottom: 8,
  },
  resultWinnerText: {
    color: '#f8f3df',
    fontSize: 16,
    fontFamily: 'SpedaBold',
  },
  resultPointsText: {
    color: '#facc15',
    fontSize: 26,
    fontFamily: 'SpedaBold',
    marginTop: 6,
  },
  revealTilesTop: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    flexDirection: 'column',
    gap: 6,
    zIndex: 210,
    alignItems: 'center',
  },
  revealTilesBottom: {
    position: 'absolute',
    bottom: 86,
    alignSelf: 'center',
    flexDirection: 'column',
    gap: 6,
    zIndex: 210,
    alignItems: 'center',
  },
  revealTilesRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealPipsText: {
    color: '#f8f3df',
    fontSize: 12,
    fontFamily: 'SpedaBold',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  revealTilesLeft: {
    position: 'absolute',
    left: 8,
    top: '45%',
    flexDirection: 'column',
    gap: 6,
    zIndex: 210,
    alignItems: 'center',
  },
  revealTilesRight: {
    position: 'absolute',
    right: 8,
    top: '45%',
    flexDirection: 'column',
    gap: 6,
    zIndex: 210,
    alignItems: 'center',
  },
  countdownOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
  },
  countdownLabel: {
    color: '#f8f3df',
    fontSize: 14,
    fontFamily: 'SpedaBold',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  countdownNumber: {
    color: '#facc15',
    fontSize: 56,
    fontFamily: 'SpedaBold',
  },
});
