import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import TableBackground from '@/components/game/TableBackground';
import LeaveMatchConfirmPopup from '@/components/multiplayer/LeaveMatchConfirmPopup';
import MatchMenuDrawer from '@/components/multiplayer/MatchMenuDrawer';
import MultiplayerGameChat from '@/components/multiplayer/MultiplayerGameChat';
import WaitingPlayersPopup, { type WaitingPlayerMember } from '@/components/multiplayer/WaitingPlayersPopup';
import GameOverPopup from '@/domino/components/GameOverPopup';
import { useGameSystemGestureProtection } from '@/hooks/useGameSystemGestureProtection';
import { useMatchMenu } from '@/hooks/useMatchMenu';
import { hasReadySession, useAuthState } from '@/lib/auth-state';
import { useProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { DamaPlayerSeat } from '@/dama/components/DamaPlayerSeat';
import { DamaTable } from '@/dama/components/DamaTable';
import { getBoardSize } from '@/dama/board-layout';
import { useDamaWaitingRoom } from '@/dama/multiplayer/useDamaWaitingRoom';
import { useDamaGameController } from '@/dama/useDamaGameController';

const DAMA_TABLE_BACKGROUND = require('@/assets/cosmetics/dama/classic/table.webp');

type Access = 'checking' | 'ready' | 'offline' | 'signin';

function describeMatchmakingError(message: string) {
  if (message.includes('insufficient_entry_balance')) {
    return 'بۆ یاری دامە ٥٠٠ سکە پێویستە';
  }
  if (message.includes('authentication_required')) {
    return 'تکایە بچۆ ژوورەوە و دووبارە هەوڵ بدەوە';
  }
  return message || 'پەیوەندی بە یاری دامەوە پچڕا؛ دووبارە هەوڵ دەدرێتەوە';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '';
}

function DamaActiveGameScene({
  roomId,
  currentUserId,
  onExit,
}: {
  roomId: string;
  currentUserId: string;
  onExit: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const sideSeatWidth = Math.min(150, width * 0.16);
  const landscapeBoardSize = getBoardSize(
    width - sideSeatWidth * 2,
    height,
  ).width;
  const playerSeatGap = 12;
  const leftSeatOffset = Math.max(
    0,
    (width - landscapeBoardSize) / 2 - sideSeatWidth,
  );
  const rightSeatOffset = Math.min(
    width - sideSeatWidth,
    (width + landscapeBoardSize) / 2,
  );
  const {
    phase,
    gameState,
    myPlayer,
    opponent,
    myColor,
    opponentColor,
    isMyTurn,
    turnRemainingMs,
    selectedPieceId,
    legalTargets,
    winner,
    handleSquarePress,
    handleSquareDrag,
    handleLeave,
  } = useDamaGameController({
    roomId,
    currentUserId,
    onFinish: onExit,
  });

  const capturedByMe = 16 - gameState.pieces.filter((p) => p.color === opponentColor).length;
  const capturedByOpponent = 16 - gameState.pieces.filter((p) => p.color === myColor).length;

  const topPlayerView = {
    id: opponent?.userId ?? 'opponent',
    username: opponent?.username ?? '',
    pieceColor: opponentColor,
    capturedCount: capturedByOpponent,
    isCurrentTurn: !isMyTurn,
  };

  const bottomPlayerView = {
    id: currentUserId,
    username: myPlayer?.username ?? '',
    pieceColor: myColor,
    capturedCount: capturedByMe,
    isCurrentTurn: isMyTurn,
  };

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showGameOverPopup, setShowGameOverPopup] = useState(false);
  const {
    showMatchMenu,
    matchMenuTranslateX,
    openMatchMenu,
    closeMatchMenu,
  } = useMatchMenu();

  const onConfirmExit = async () => {
    setLeaving(true);
    try {
      await handleLeave();
      setConfirmLeave(false);
    } catch (error) {
      console.warn('Unable to leave Dama match', error);
      Alert.alert(
        'دەرچوون لە یاری',
        getErrorMessage(error) || 'نەتوانرا لە یارییەکە دەربچیت؛ تکایە دووبارە هەوڵ بدەوە.',
      );
    } finally {
      setLeaving(false);
    }
  };

  useEffect(() => {
    if (phase === 'round_result') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowGameOverPopup(true);
    }
  }, [phase]);

  const menuPlayers = [myPlayer, opponent].flatMap((player) =>
    player
      ? [{
          id: player.userId,
          name: player.username,
          kind: 'human',
          avatarId: player.avatarId,
          avatarUrl: player.avatarUrl,
        }]
      : [],
  );
  const board = (
    <DamaTable
      viewportWidth={isLandscape ? width - sideSeatWidth * 2 : width}
      viewportHeight={isLandscape ? height : height * 0.72}
      pieces={gameState.pieces}
      selectedId={selectedPieceId}
      targets={legalTargets}
      flipped={myColor === 'black'}
      onSquarePress={handleSquarePress}
      onSquareDrag={handleSquareDrag}
    />
  );

  return (
    <TableBackground imageSource={DAMA_TABLE_BACKGROUND} contentPadding={false}>
      <View style={styles.scene}>
      <View style={styles.topRightActions}>
        <Pressable
          accessibilityLabel="Match settings"
          style={styles.topRightActionButton}
          onPress={openMatchMenu}
        >
          <Ionicons name="settings-outline" size={22} color="#f8f3df" />
        </Pressable>
      </View>

      <LeaveMatchConfirmPopup
        visible={confirmLeave}
        loading={leaving}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => { void onConfirmExit(); }}
      />

      <MatchMenuDrawer
        visible={showMatchMenu}
        players={menuPlayers}
        humanPlayer={myPlayer ? { id: myPlayer.userId } : null}
        activePlayerId={currentUserId}
        translateX={matchMenuTranslateX}
        onClose={closeMatchMenu}
        onLeavePress={() => {
          closeMatchMenu();
          setConfirmLeave(true);
        }}
      />

      <View style={styles.gameArea}>
        {isLandscape ? (
          <>
            <View style={styles.boardContainer}>{board}</View>
            <View
              style={[
                styles.sideSeatContainer,
                {
                  left: leftSeatOffset,
                  width: sideSeatWidth,
                  paddingRight: playerSeatGap,
                },
              ]}
            >
              <DamaPlayerSeat
                player={bottomPlayerView}
                capturedPieceColor={opponentColor}
                width={sideSeatWidth - playerSeatGap}
                avatarSize={56}
                turnRemainingMs={isMyTurn ? turnRemainingMs : 0}
              />
            </View>
            <View
              style={[
                styles.sideSeatContainer,
                {
                  left: rightSeatOffset,
                  width: sideSeatWidth,
                  paddingLeft: playerSeatGap,
                },
              ]}
            >
              <DamaPlayerSeat
                player={topPlayerView}
                capturedPieceColor={myColor}
                width={sideSeatWidth - playerSeatGap}
                avatarSize={56}
                turnRemainingMs={!isMyTurn ? turnRemainingMs : 0}
              />
            </View>
          </>
        ) : (
          <>
            <View style={styles.topSeatContainer}>
              <DamaPlayerSeat
                player={topPlayerView}
                capturedPieceColor={myColor}
                width={130}
                avatarSize={46}
                turnRemainingMs={!isMyTurn ? turnRemainingMs : 0}
              />
            </View>
            <View style={styles.boardContainer}>{board}</View>
            <View style={styles.bottomSeatContainer}>
              <DamaPlayerSeat
                player={bottomPlayerView}
                capturedPieceColor={opponentColor}
                width={130}
                avatarSize={46}
                turnRemainingMs={isMyTurn ? turnRemainingMs : 0}
              />
            </View>
          </>
        )}
      </View>

      <MultiplayerGameChat
        gameType="dame"
        matchId={roomId}
        currentUserId={currentUserId}
        playerIdBySeat={{
          bottom: myPlayer?.userId,
          top: opponent?.userId,
        }}
        enabled
      />

      {/* End of Match Result Popup */}
      <GameOverPopup
        visible={showGameOverPopup}
        didWin={winner?.id === currentUserId}
        isPracticeMode={false}
        reward={null}
        teamAName={myPlayer?.username || ''}
        teamBName={opponent?.username || ''}
        onClose={() => {
          setShowGameOverPopup(false);
          onExit();
        }}
        onPlayAgain={() => {
          setShowGameOverPopup(false);
          onExit();
        }}
      />
      </View>
    </TableBackground>
  );
}

export default function DamaGameScreen() {
  useGameSystemGestureProtection();
  const params = useLocalSearchParams<{ roomId?: string | string[] }>();
  const auth = useAuthState();
  const { profile: localProfile } = useProfile();
  const [access, setAccess] = useState<Access>('checking');
  const [retry, setRetry] = useState(0);
  const initialRoomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const waitingRoom = useDamaWaitingRoom({
    enabled: access === 'ready',
    roomId: initialRoomId,
  });
  const matchmaking = waitingRoom.status;
  const matchmakingError = waitingRoom.error
    ? describeMatchmakingError(waitingRoom.error)
    : null;
  const [ownWaitingAvatar, setOwnWaitingAvatar] = useState<{
    userId: string;
    username?: string;
    avatarId?: WaitingPlayerMember['avatarId'];
    avatarUrl?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasReadySession(auth)) {
      void Promise.resolve().then(() => {
        if (!cancelled) setAccess(auth.authReady ? 'signin' : 'checking');
      });
      return () => { cancelled = true; };
    }
    void Promise.resolve().then(() => { if (!cancelled) setAccess('checking'); });
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!cancelled) { timedOut = true; setAccess('offline'); }
    }, 8000);

    void supabase.auth.getUser().then(({ data, error }) => {
      clearTimeout(timeout);
      if (cancelled || timedOut) return;
      const valid = !error && data.user?.id === auth.userId && hasReadySession();
      setAccess(valid ? 'ready' : 'offline');
    }).catch(() => {
      clearTimeout(timeout);
      if (!cancelled && !timedOut) setAccess('offline');
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [auth, retry]);

  useEffect(() => {
    if (access !== 'ready' || !auth.userId) return;
    let active = true;

    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_id, avatar_url')
        .eq('id', auth.userId!)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.warn('Unable to load local Dama waiting avatar', error);
        return;
      }
      if (data) {
        setOwnWaitingAvatar({
          userId: auth.userId!,
          username: data.username,
          avatarId: data.avatar_id,
          avatarUrl: data.avatar_url ?? undefined,
        });
      }
    })();

    return () => { active = false; };
  }, [access, auth.userId]);

  const handleExitToPlay = () => {
    router.replace('/(tabs)/play');
  };

  if (access === 'ready' && waitingRoom.gameplayReady && waitingRoom.currentRoomId && auth.userId) {
    return (
      <DamaActiveGameScene
        roomId={waitingRoom.currentRoomId}
        currentUserId={auth.userId}
        onExit={handleExitToPlay}
      />
    );
  }

  const ownProfile = auth.userId && localProfile?.id === auth.userId
    ? localProfile
    : auth.userId && ownWaitingAvatar?.userId === auth.userId
      ? ownWaitingAvatar
      : null;
  const waitingMembers: WaitingPlayerMember[] = (matchmaking?.players ?? []).map((player) => {
    const isOwnPlayer = player.userId === auth.userId;
    return {
      playerIndex: player.playerIndex,
      username: isOwnPlayer ? ownProfile?.username ?? player.username : player.username,
      avatarId: isOwnPlayer ? ownProfile?.avatarId ?? player.avatarId : player.avatarId,
      avatarUrl: isOwnPlayer ? ownProfile?.avatarUrl ?? player.avatarUrl : player.avatarUrl,
    };
  });
  if (
    matchmaking?.status === 'searching' &&
    auth.userId &&
    !matchmaking.players?.some((player) => player.userId === auth.userId)
  ) {
    waitingMembers.push({
      playerIndex: 0,
      username: ownProfile?.username,
      avatarId: ownProfile?.avatarId,
      avatarUrl: ownProfile?.avatarUrl,
    });
  }
  const showWaitingPopup =
    waitingRoom.isWaiting &&
    !matchmakingError;

  return (
    <View style={styles.scene}>
      {!showWaitingPopup && (access !== 'ready' || matchmakingError) && <View style={styles.overlay}>
        <Text style={styles.title}>
          {access === 'checking'
            ? 'Checking session…'
            : access === 'signin'
            ? 'Sign in to play Dama'
            : access === 'offline'
            ? 'Connect to the internet to play'
            : matchmakingError
            ? 'Unable to enter Dama matchmaking'
            : ''}
        </Text>
        {matchmakingError ? <Text style={styles.error}>{matchmakingError}</Text> : null}
        {access === 'offline' && (
          <Pressable style={styles.button} onPress={() => setRetry((value) => value + 1)}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        )}
        {access === 'signin' && (
          <Pressable style={styles.button} onPress={() => router.replace('/login')}>
            <Text style={styles.buttonText}>Sign in</Text>
          </Pressable>
        )}
        {access === 'ready' && matchmakingError && (
          <Pressable style={styles.button} onPress={handleExitToPlay}>
            <Text style={styles.buttonText}>Back to games</Text>
          </Pressable>
        )}
      </View>}

      {showWaitingPopup && (
        <WaitingPlayersPopup
          visible
          entryFee={matchmaking?.entryFee ?? 500}
          currency="fun"
          players={waitingMembers}
          playerCount={2}
          countdownEndsAt={matchmaking?.countdownEndsAt ?? null}
          canCancel={waitingRoom.canCancel}
          loading={waitingRoom.cancelling}
          onCancel={() => { void waitingRoom.handleCancel(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: '#0c0c20', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff3db', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  error: { color: '#ffb4b4', fontSize: 13, textAlign: 'center', marginTop: 12 },
  button: { marginTop: 22, backgroundColor: '#8a4dac', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 17 },

  gameArea: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  sideSeatContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  topRightActions: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 900,
    elevation: 900,
  },
  topRightActionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,243,223,0.22)',
  },
  topSeatContainer: {
    paddingTop: 40,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  boardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSeatContainer: {
    paddingBottom: 35,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
