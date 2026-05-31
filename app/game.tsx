import BoardArea from '@/components/game/BoardArea';
import DrawPilePrompt from '@/components/game/DrawPilePrompt';
import GameOverPopup from '@/components/game/GameOverPopup';
import PlayerHand from '@/components/game/PlayerHand';
import PlayerSeat from '@/components/game/PlayerSeat';
import ScorePopup from '@/components/game/ScorePopup';
import TableBackground from '@/components/game/TableBackground';
import WinnerPopup from '@/components/game/WinnerPopup';
import { useGame } from '@/hooks/useGame';
import { useOneVsOneGame } from '@/hooks/useOneVsOneGame';
import { useTwoVsTwoGame } from '@/hooks/useTwoVsTwoGame';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { DominoTileData, KozelBranch } from '@/types/game';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
    
  const { refreshProfile } = useProfile();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showWinnerPopup, setShowWinnerPopup] = useState(false);
  const [showScorePopup, setShowScorePopup] = useState(false);
  const [showGameOverPopup, setShowGameOverPopup] = useState(false);
  const [selectedTile, setSelectedTile] = useState<DominoTileData | null>(null);
  const [selectableBranches, setSelectableBranches] = useState<KozelBranch[]>([]);

  const gameInitializedRef = useRef(false);
  const rewardSettlementRequestedRef = useRef(false);
  const boardAreaRef = useRef<any>(null);

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
    if ((game as any).loading) return;
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
          gameMode === '1v1'
            ? roomData.state?.status === 'started' || !!roomData.state?.handCounts
            : roomData.state?.status === 'started' || !!roomData.state?.handCounts;

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
  }, [isPracticeMode, (game as any).loading, roomId, gameMode]);

  const topPlayer = game.players.find((p) => p.seat === 'top');
  const leftPlayer = game.players.find((p) => p.seat === 'left');
  const rightPlayer = game.players.find((p) => p.seat === 'right');

  const humanPlayer = isPracticeMode
    ? game.players.find((p) => p.kind === 'human')
    : game.players.find((p) => p.id === currentUserId);

  const winnerPlayer = game.players.find((p) => p.id === game.roundWinnerPlayerId);

  const isMyTurn = !!humanPlayer && game.currentTurnPlayerId === humanPlayer.id;

  const playableTileIds =
    isMyTurn && !game.canDrawTile
      ? game.myHand
          .filter((tile) => game.availableBranchesForTile(tile).length > 0)
          .map((tile) => tile.id)
      : [];

  useEffect(() => {
    setShowWinnerPopup(!!game.roundWinnerPlayerId);
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

  const handlePreviewTile = (tile: DominoTileData) => {
    if (!isMyTurn) return;

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

  const handleLeaveGame = async () => {
    try {
      if (!isPracticeMode && roomId) {
        if (gameMode === '1v1') {
          await supabase.rpc('cancel_one_vs_one_room', {
            p_room_id: roomId,
          });
        } else {
          await supabase.rpc('leave_two_vs_two_room', {
            p_room_id: roomId,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to leave game', error);
    }

    router.replace('/');
  };

  const scoreTeamAName = getTeamName(game.players, 'teamA', 'Team A');
  const scoreTeamBName = getTeamName(game.players, 'teamB', 'Team B');

  const didWinMatch = humanPlayer?.teamId
    ? game.winningTeamId === humanPlayer.teamId
    : game.winningTeamId === 'teamA';

  if (!isPracticeMode && (game as any).loading) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.statusText}>Loading game...</Text>
      </View>
    );
  }

  if (!isPracticeMode && (game as any).error) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.statusText}>Unable to load game</Text>
        <Text style={styles.errorText}>{(game as any).error}</Text>
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
                ref={boardAreaRef}
              />
            </View>

            <View style={styles.sideArea} />
          </View>

          <Pressable style={styles.miniScoreBoard} onPress={() => setShowScorePopup(true)}>
            <View style={styles.miniScoreItem}>
              <Text style={styles.miniScoreLabel}>{game.mode === '1v1' ? 'YOU' : 'TEAM A'}</Text>
              <Text style={styles.miniScoreValue}>{game.teamScores?.teamA ?? 0}</Text>
            </View>

            <View style={styles.miniScoreDivider} />

            <View style={styles.miniScoreItem}>
              <Text style={styles.miniScoreLabel}>TEAM B</Text>
              <Text style={styles.miniScoreValue}>{game.teamScores?.teamB ?? 0}</Text>
            </View>
          </Pressable>

          <Pressable style={styles.leaveButton} onPress={handleLeaveGame}>
            <Text style={styles.leaveButtonText}>Leave</Text>
          </Pressable>

          <DrawPilePrompt
            visible={game.canDrawTile}
            boneyardCount={game.boneyardCount}
            onDraw={handleDrawTile}
            onPass={game.passTurn}
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

          <WinnerPopup visible={showWinnerPopup} winnerName={winnerPlayer?.name} />

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
            visible={showGameOverPopup}
            didWin={didWinMatch}
            reward={game.matchReward}
            onClose={() => setShowGameOverPopup(false)}
            onViewScore={() => {
              setShowGameOverPopup(false);
              setShowScorePopup(true);
            }}
          />
        </TableBackground>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#03110b',
    overflow: 'hidden',
  },

  centerScreen: {
    flex: 1,
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
    fontWeight: '900',
    textAlign: 'center',
  },

  errorText: {
    marginTop: 8,
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },

  stage: {
    flex: 1,
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
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  miniScoreValue: {
    marginTop: 1,
    color: '#facc15',
    fontSize: 14,
    fontWeight: '900',
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
    fontWeight: '900',
  },

  bottomArea: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    zIndex: 50,
  },
});
