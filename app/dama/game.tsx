import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MultiplayerGameChat from '@/components/multiplayer/MultiplayerGameChat';
import MatchMenuDrawer from '@/components/multiplayer/MatchMenuDrawer';
import LeaveMatchConfirmPopup from '@/components/multiplayer/LeaveMatchConfirmPopup';
import { useMatchMenu } from '@/hooks/useMatchMenu';
import { useProfile } from '@/lib/profile';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getBoardSize } from '@/dama/board-layout';
import { chooseBotMove } from '@/dama/bot';
import { getBotPlaybackFrame } from '@/dama/bot-presentation';
import { DamaPlayerSeat } from '@/dama/components/DamaPlayerSeat';
import type { BotStepAnimation } from '@/dama/components/DamaBoard';
import { DamaTable } from '@/dama/components/DamaTable';
import { applyMove, createGame, getLegalMoves, getTurnRemainingMs, isTurnExpired, projectMove, resolveTurnTimeout, type GameState, type Move, type Square, type Step } from '@/dama/engine';
import { useGameSystemGestureProtection } from '@/hooks/useGameSystemGestureProtection';
import { hasReadySession, useAuthState } from '@/lib/auth-state';
import { supabase } from '@/lib/supabase';

type Access = 'checking' | 'ready' | 'offline' | 'signin';
type BotPlayback = { source: GameState; move: Move; completedSteps: number; moving: boolean };
const sameSquare = (a: Square, b: Square) => a.row === b.row && a.column === b.column;
const sameStep = (a: Step, b: Step) => sameSquare(a.to, b.to) && a.capturedId === b.capturedId;

export default function DamaGameScreen() {
  useGameSystemGestureProtection();
  const auth = useAuthState();
  const { profile } = useProfile();
  const [access, setAccess] = useState<Access>('checking');
  const [retry, setRetry] = useState(0);
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<Step[]>([]);
  const [botPlayback, setBotPlayback] = useState<BotPlayback | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const { showMatchMenu, matchMenuTranslateX, openMatchMenu, closeMatchMenu } = useMatchMenu();
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    let cancelled = false;
    if (!hasReadySession(auth)) {
      void Promise.resolve().then(() => {
        if (!cancelled) { setAccess(auth.authReady ? 'signin' : 'checking'); setGame(null); setBotPlayback(null); }
      });
      return () => { cancelled = true; };
    }
    void Promise.resolve().then(() => { if (!cancelled) setAccess('checking'); });
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!cancelled) { timedOut = true; setAccess('offline'); setGame(null); setBotPlayback(null); }
    }, 8000);
    // getUser contacts Supabase Auth and checks the live session and connection.
    void supabase.auth.getUser().then(({ data, error }) => {
      clearTimeout(timeout);
      if (cancelled || timedOut) return;
      const valid = !error && data.user?.id === auth.userId && hasReadySession();
      setAccess(valid ? 'ready' : 'offline');
      if (!valid) { setGame(null); setBotPlayback(null); }
      else setGame((current) => current ?? createGame());
    }).catch(() => {
      clearTimeout(timeout);
      if (!cancelled && !timedOut) { setAccess('offline'); setGame(null); setBotPlayback(null); }
    });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [auth, retry]);

  const legalMoves = useMemo(() => game ? getLegalMoves(game) : [], [game]);
  const candidates = useMemo(() => legalMoves.filter((move) => move.pieceId === selectedId &&
    prefix.every((step, index) => sameStep(step, move.steps[index]))), [legalMoves, selectedId, prefix]);
  const activeBotPlayback = botPlayback?.source === game ? botPlayback : null;
  const botFrame = activeBotPlayback && game
    ? getBotPlaybackFrame(game, activeBotPlayback.move, activeBotPlayback.completedSteps) : null;
  const projected = botFrame
    ? botFrame.state
    : prefix.length && game && candidates.length ? projectMove(game, candidates[0], prefix.length) : game;
  const onBotStepComplete = useCallback(() => {
    setBotPlayback((current) => current?.moving
      ? { ...current, completedSteps: current.completedSteps + 1, moving: false }
      : current);
  }, []);
  const botStep: BotStepAnimation | null = activeBotPlayback?.moving && botFrame?.moving
    ? {
        key: `${game?.ply}-${activeBotPlayback.completedSteps}`,
        ...botFrame.moving,
        onComplete: onBotStepComplete,
      }
    : null;
  const targets = useMemo(() => candidates
    .map((move) => move.steps[prefix.length]?.to)
    .filter((square): square is Square => !!square)
    .filter((square, index, all) => all.findIndex((other) => sameSquare(square, other)) === index), [candidates, prefix.length]);

  const onSquarePress = useCallback((square: Square) => {
    if (!game || access !== 'ready' || game.turn !== 'cream' || game.result) return;
    const now = Date.now();
    if (isTurnExpired(game, now)) {
      setGame(resolveTurnTimeout(game, now));
      setSelectedId(null);
      setPrefix([]);
      return;
    }
    const matching = candidates.filter((move) => sameSquare(move.steps[prefix.length]?.to ?? { row: -1, column: -1 }, square));
    if (selectedId && matching.length) {
      const nextPrefix = matching[0].steps.slice(0, prefix.length + 1);
      if (nextPrefix.length === matching[0].steps.length) {
        setGame(applyMove(game, matching[0], now));
        setSelectedId(null);
        setPrefix([]);
      } else setPrefix(nextPrefix);
      return;
    }
    if (prefix.length) return;
    const piece = game.pieces.find((candidate) => sameSquare(candidate, square) && candidate.color === 'cream');
    setSelectedId(piece && legalMoves.some((move) => move.pieceId === piece.id) ? piece.id : null);
  }, [game, access, candidates, prefix, selectedId, legalMoves]);

  const onSquareDrag = useCallback((from: Square, to: Square) => {
    if (!game || access !== 'ready' || game.turn !== 'cream' || game.result) return;
    const now = Date.now();
    if (isTurnExpired(game, now)) {
      setGame(resolveTurnTimeout(game, now));
      setSelectedId(null);
      setPrefix([]);
      return;
    }
    const active = projected?.pieces.find((piece) => piece.id === selectedId);
    if (active && sameSquare(active, from)) { onSquarePress(to); return; }
    if (prefix.length) return;
    const piece = game.pieces.find((candidate) => candidate.color === 'cream' && sameSquare(candidate, from));
    if (!piece) return;
    const move = legalMoves.find((candidate) => candidate.pieceId === piece.id && sameSquare(candidate.steps[0].to, to));
    if (!move) return;
    if (move.steps.length === 1) {
      setGame(applyMove(game, move, now));
      setSelectedId(null);
      setPrefix([]);
    } else {
      setSelectedId(piece.id);
      setPrefix(move.steps.slice(0, 1));
    }
  }, [game, access, projected, selectedId, onSquarePress, prefix.length, legalMoves]);

  useEffect(() => {
    if (!game || access !== 'ready' || game.result || game.turnDeadlineAtMs == null) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setGame((current) => current === game ? resolveTurnTimeout(current, now) : current);
      setBotPlayback(null);
      setSelectedId(null);
      setPrefix([]);
    }, Math.max(0, game.turnDeadlineAtMs - Date.now() + 10));
    const display = setInterval(() => setClockNow(Date.now()), 100);
    return () => { clearTimeout(timer); clearInterval(display); };
  }, [game, access]);

  useEffect(() => {
    if (!game || access !== 'ready' || game.turn !== 'black' || game.result || botPlayback) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      if (isTurnExpired(game, now)) {
        setGame((current) => current === game ? resolveTurnTimeout(current, now) : current);
        return;
      }
      const move = chooseBotMove(game);
      if (move) setBotPlayback({ source: game, move, completedSteps: 0, moving: true });
    }, 450);
    return () => clearTimeout(timer);
  }, [game, access, botPlayback]);

  useEffect(() => {
    if (!activeBotPlayback || activeBotPlayback.moving) return;
    const pause = setTimeout(() => {
      if (activeBotPlayback.completedSteps < activeBotPlayback.move.steps.length) {
        setBotPlayback((current) => current === activeBotPlayback ? { ...current, moving: true } : current);
        return;
      }
      const now = Date.now();
      setGame((current) => current === activeBotPlayback.source
        ? isTurnExpired(current, now)
          ? resolveTurnTimeout(current, now)
          : applyMove(current, activeBotPlayback.move, now)
        : current);
      setBotPlayback(null);
    }, 110);
    return () => clearTimeout(pause);
  }, [activeBotPlayback]);

  const boardWidth = getBoardSize(width, height).width;
  const sideSpace = Math.max(0, (width - boardWidth) / 2);
  const seatWidth = Math.min(150, Math.max(0, sideSpace - 16));
  const avatarSize = Math.max(0, Math.min(64, height * 0.15, seatWidth * 0.42));
  const humanName = auth.session?.user.email?.split('@')[0] || 'You';
  const capturedByHuman = 16 - (game?.pieces.filter((piece) => piece.color === 'black').length ?? 16);
  const capturedByBot = 16 - (game?.pieces.filter((piece) => piece.color === 'cream').length ?? 16);
  const turnRemainingMs = game ? getTurnRemainingMs(game, clockNow) : 0;
  const humanAvatar = profile?.id === auth.userId
    ? { avatarId: profile.avatarId, avatarUrl: profile.avatarUrl }
    : {};
  const humanPlayer = { id: auth.userId ?? 'local-human', name: humanName, teamId: 'teamA', kind: 'human', ...humanAvatar };
  const botPlayer = { id: 'bot', name: 'Bot', teamId: 'teamB', kind: 'bot' };

  return (
    <View style={styles.scene}>
      <DamaTable viewportWidth={width} viewportHeight={height} pieces={projected?.pieces ?? []}
        selectedId={selectedId} targets={targets} onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} botStep={botStep} />
      {game && width > height && (
        <>
          <View pointerEvents="none" style={[styles.seatLayer, { left: sideSpace / 2 - seatWidth / 2, width: seatWidth }]}>
            <DamaPlayerSeat player={{ id: auth.userId ?? 'human', username: humanName, ...humanAvatar, pieceColor: 'cream', capturedCount: capturedByHuman, isCurrentTurn: game.turn === 'cream' && !game.result }} capturedPieceColor="black" width={seatWidth} avatarSize={avatarSize} turnRemainingMs={game.turn === 'cream' ? turnRemainingMs : 0} />
          </View>
          <View pointerEvents="none" style={[styles.seatLayer, { left: width - sideSpace / 2 - seatWidth / 2, width: seatWidth }]}>
            <DamaPlayerSeat player={{ id: 'bot', username: 'Bot', pieceColor: 'black', capturedCount: capturedByBot, isCurrentTurn: game.turn === 'black' && !game.result }} capturedPieceColor="cream" width={seatWidth} avatarSize={avatarSize} turnRemainingMs={game.turn === 'black' ? turnRemainingMs : 0} />
          </View>
        </>
      )}
      {game && width <= height && <View pointerEvents="none" style={styles.portraitScore}><Text style={styles.bannerText}>{humanName}: {capturedByHuman}  ·  Bot: {capturedByBot}</Text></View>}
      {game && !game.result && (game.turn === 'black' || prefix.length > 0) && <View pointerEvents="none" style={[styles.turnBanner, width <= height && styles.portraitTurn]}><Text style={styles.bannerText}>{game.turn === 'black' ? 'Bot is thinking…' : 'Continue capturing'}</Text></View>}
      {access === 'ready' && game && <>
        <MultiplayerGameChat gameType="dame" matchId="dame-local" currentUserId={humanPlayer.id}
          playerIdBySeat={{ bottom: humanPlayer.id, right: botPlayer.id }} enabled />
        <Pressable style={styles.menuButton} onPress={openMatchMenu} accessibilityLabel="Game settings">
          <Ionicons name="menu-outline" size={22} color="#f8f3df" />
        </Pressable>
        <MatchMenuDrawer visible={showMatchMenu} loadHumanProfiles={false}
          players={[humanPlayer, botPlayer]} humanPlayer={humanPlayer}
          activePlayerId={game.turn === 'cream' ? humanPlayer.id : botPlayer.id}
          translateX={matchMenuTranslateX} onClose={closeMatchMenu}
          onLeavePress={() => { closeMatchMenu(); setShowLeaveConfirm(true); }} />
        <LeaveMatchConfirmPopup visible={showLeaveConfirm}
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={() => { setShowLeaveConfirm(false); router.replace('/(tabs)/play'); }} />
      </>}
      {(access !== 'ready' || game?.result) && <View style={styles.overlay}>
        <Text style={styles.title}>{game?.result ? game.result.winner === 'cream' ? 'You win!' : game.result.winner === 'black' ? 'Bot wins' : 'Draw' : access === 'checking' ? 'Checking session…' : access === 'signin' ? 'Sign in to play Dama' : 'Connect to the internet to play'}</Text>
        {game?.result && <Text style={styles.detail}>{game.result.reason === 'one-vs-one' ? 'One piece against one piece' : game.result.reason === 'no-moves' ? 'No legal moves remain' : game.result.reason === 'repetition' ? 'Position repeated three times' : game.result.reason === 'quiet-limit' ? 'No capture or promotion for 80 turns' : 'All opposing pieces captured'}</Text>}
        {(access === 'offline' || game?.result) && <Pressable style={styles.button} onPress={() => { if (game?.result) { setGame(createGame()); setSelectedId(null); setPrefix([]); setBotPlayback(null); } else setRetry((value) => value + 1); }}><Text style={styles.buttonText}>{game?.result ? 'Play again' : 'Retry'}</Text></Pressable>}
        {access === 'signin' && <Pressable style={styles.button} onPress={() => router.replace('/login')}><Text style={styles.buttonText}>Sign in</Text></Pressable>}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: '#0c0c20', overflow: 'hidden' },
  menuButton: { position: 'absolute', top: 18, right: 18, zIndex: 900, elevation: 900, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(248,243,223,0.22)' },
  seatLayer: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  turnBanner: { position: 'absolute', top: 12, alignSelf: 'center', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: 'rgba(15,8,24,0.78)' },
  portraitScore: { position: 'absolute', top: 8, alignSelf: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 5, backgroundColor: 'rgba(15,8,24,0.78)' },
  portraitTurn: { top: 43 },
  bannerText: { color: '#ffe1a0', fontWeight: '700' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(8,4,16,0.84)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff3db', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  detail: { color: '#e4d1ed', fontSize: 16, marginTop: 8, textAlign: 'center' },
  button: { marginTop: 22, backgroundColor: '#8a4dac', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 17 },
});
