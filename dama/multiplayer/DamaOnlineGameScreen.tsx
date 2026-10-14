import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import LeaveMatchConfirmPopup from "@/components/multiplayer/LeaveMatchConfirmPopup";
import MatchMenuDrawer from "@/components/multiplayer/MatchMenuDrawer";
import MultiplayerGameChat from "@/components/multiplayer/MultiplayerGameChat";
import WaitingPlayersPopup from "@/components/multiplayer/WaitingPlayersPopup";
import GameOverPopup from "@/domino/components/GameOverPopup";
import { DamaPlayerSeat } from "@/dama/components/DamaPlayerSeat";
import { DamaTable } from "@/dama/components/DamaTable";
import type { BotStepAnimation } from "@/dama/components/DamaBoard";
import { getBotPlaybackFrame } from "@/dama/bot-presentation";
import { getBoardSize } from "@/dama/board-layout";
import { applyMove, createGame, getLegalMoves, getTurnRemainingMs, isTurnExpired, projectMove, type GameState, type Move, type Side, type Square, type Step } from "@/dama/engine";
import { useDamaMultiplayer } from "@/dama/useDamaMultiplayer";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { useGameSystemGestureProtection } from "@/hooks/useGameSystemGestureProtection";
import { hasReadySession, useAuthState } from "@/lib/auth-state";
import { useProfile } from "@/lib/profile";
import { AVATAR_IDS, DEFAULT_AVATAR, type AvatarId } from "@/types/avatar";
import { supabase } from "@/lib/supabase";

const sameSquare = (a: Square, b: Square) => a.row === b.row && a.column === b.column;
const sameStep = (a: Step, b: Step) => sameSquare(a.to, b.to) && a.capturedId === b.capturedId;
const getSeatAvatarId = (avatarId: string | undefined, isBot: boolean): AvatarId => {
  if (avatarId && AVATAR_IDS.includes(avatarId as AvatarId) && (isBot || avatarId !== "bot-avatar")) {
    return avatarId as AvatarId;
  }
  return isBot ? "bot-avatar" : DEFAULT_AVATAR;
};

type BotPlayback = { key: string; source: GameState; move: Move; completedSteps: number };
type PendingBotMoveLookup = { matchId: string; version: number; source: GameState };
type LocalHumanMove = { matchId: string; baseVersion: number; state: GameState };

function isBotMove(value: unknown): value is Move {
  if (!value || typeof value !== "object") return false;
  const move = value as Partial<Move>;
  return typeof move.pieceId === "string" && Array.isArray(move.steps) && move.steps.length > 0 &&
    move.steps.every((step) => !!step && Number.isInteger(step.to?.row) && Number.isInteger(step.to?.column));
}

export default function DamaOnlineGameScreen() {
  useGameSystemGestureProtection();
  const auth = useAuthState();
  const { profile } = useProfile();
  const params = useLocalSearchParams<{ match_id?: string | string[] }>();
  const initialMatchId = Array.isArray(params.match_id) ? params.match_id[0] : params.match_id;
  const online = useDamaMultiplayer(hasReadySession(auth), initialMatchId);
  const { width, height } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prefix, setPrefix] = useState<Step[]>([]);
  const [clockNow, setClockNow] = useState(Date.now());
  const [matchmakingClock, setMatchmakingClock] = useState<{ matchId: string; startedAtMs: number } | null>(null);
  const [botPlayback, setBotPlayback] = useState<BotPlayback | null>(null);
  const [pendingBotMoveLookup, setPendingBotMoveLookup] = useState<PendingBotMoveLookup | null>(null);
  const [localHumanMove, setLocalHumanMove] = useState<LocalHumanMove | null>(null);
  const localHumanMoveBusy = useRef(false);
  const pregameState = useMemo(() => createGame(0), []);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [actionError, setActionError] = useState("");
  const leavingMatch = useRef(false);
  const timeoutLobbyRedirectedMatch = useRef<string | null>(null);
  const { showMatchMenu, matchMenuTranslateX, openMatchMenu, closeMatchMenu } = useMatchMenu();
  const incomingGame = online.snapshot?.state;
  const game = incomingGame && Array.isArray(incomingGame.pieces) ? incomingGame : null;
  const previousGameRef = useRef<{ matchId: string; version: number; state: GameState } | null>(null);
  const botPlaybackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownActive = online.snapshot?.status === "waiting" && !!online.snapshot.countdown_ends_at && online.players.length === 2;
  useEffect(() => {
    const snapshot = online.snapshot;
    if (!snapshot?.matchmaking_started_at) return;
    setMatchmakingClock((current) => current?.matchId === snapshot.id
      ? current
      : { matchId: snapshot.id, startedAtMs: Date.now() });
  }, [online.snapshot?.id, online.snapshot?.matchmaking_started_at]);
  const userId = auth.userId ?? "";
  const myPlayer = userId ? online.players.find((player) => !player.isBot && player.userId === userId) : undefined;
  const opponent = myPlayer ? online.players.find((player) => player.id !== myPlayer.id) : undefined;
  const matchmakingRemaining = online.snapshot?.status === "waiting"
    ? matchmakingClock?.matchId === online.snapshot.id
      ? Math.max(0, 20 - Math.floor((clockNow - matchmakingClock.startedAtMs) / 1000))
      : online.snapshot.countdown_ends_at
        ? Math.min(20, Math.max(0, Math.ceil((Date.parse(online.snapshot.countdown_ends_at) - clockNow) / 1000)))
        : online.snapshot.matchmaking_started_at
          ? 20
          : null
    : null;
  const humanColor: Side = myPlayer?.pieceColor ?? "cream";

  useEffect(() => {
    if (!myPlayer?.botTakeover || online.snapshot?.status !== "active") {
      timeoutLobbyRedirectedMatch.current = null;
      return;
    }
    if (timeoutLobbyRedirectedMatch.current === online.snapshot.id) return;
    timeoutLobbyRedirectedMatch.current = online.snapshot.id;
    // A timeout takeover is temporary: keep the server match alive and return
    // to the lobby, where the shared resume popup can restore control or let
    // the player explicitly leave and forfeit.
    router.replace("/(tabs)/play");
  }, [myPlayer?.botTakeover, online.snapshot?.id, online.snapshot?.status]);

  useEffect(() => () => {
    if (botPlaybackTimer.current) clearTimeout(botPlaybackTimer.current);
  }, []);

  useLayoutEffect(() => {
    const snapshot = online.snapshot;
    if (!snapshot || !game) return;
    const previous = previousGameRef.current;
    previousGameRef.current = { matchId: snapshot.id, version: Number(snapshot.version), state: game };
    if (!previous || previous.matchId !== snapshot.id || Number(snapshot.version) !== previous.version + 1 ||
        !["active", "finished"].includes(snapshot.status)) return;
    const botWasToMove = online.players.some((player) => player.pieceColor === previous.state.turn &&
      (player.isBot || player.botProfileId || player.botTakeover));
    if (!botWasToMove) return;
    setPendingBotMoveLookup({ matchId: snapshot.id, version: Number(snapshot.version), source: previous.state });
  }, [game, online.players, online.snapshot?.id, online.snapshot?.status, online.snapshot?.version]);

  useEffect(() => {
    if (!pendingBotMoveLookup) return;
    let cancelled = false;
    const { matchId, version, source } = pendingBotMoveLookup;
    void supabase.from("dama_match_moves").select("action,payload")
      .eq("match_id", matchId).eq("version", version).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.action === "bot-move" && isBotMove(data.payload?.move)) {
          if (botPlaybackTimer.current) clearTimeout(botPlaybackTimer.current);
          setBotPlayback({ key: `${matchId}:${version}`, source, move: data.payload.move, completedSteps: 0 });
        }
        setPendingBotMoveLookup((current) => current?.matchId === matchId && current.version === version ? null : current);
      }, () => {
        setPendingBotMoveLookup((current) => current?.matchId === matchId && current.version === version ? null : current);
      });
    return () => { cancelled = true; };
  }, [pendingBotMoveLookup]);

  const advanceBotPlayback = useCallback((key: string, completedSteps: number, stepCount: number) => {
    if (botPlaybackTimer.current) clearTimeout(botPlaybackTimer.current);
    const delay = stepCount > 1 && completedSteps + 1 < stepCount ? 380 : 0;
    botPlaybackTimer.current = setTimeout(() => {
      setBotPlayback((current) => {
        if (!current || current.key !== key || current.completedSteps !== completedSteps) return current;
        return completedSteps + 1 >= stepCount ? null : { ...current, completedSteps: completedSteps + 1 };
      });
      botPlaybackTimer.current = null;
    }, delay);
  }, []);

  const botPlaybackFrame = useMemo(() => botPlayback
    ? getBotPlaybackFrame(botPlayback.source, botPlayback.move, botPlayback.completedSteps)
    : null, [botPlayback]);
  const botStep = useMemo<BotStepAnimation | null>(() => {
    const moving = botPlaybackFrame?.moving;
    if (!moving || !botPlayback) return null;
    return {
      key: `${botPlayback.key}:${botPlayback.completedSteps}`,
      piece: moving.piece,
      from: moving.from,
      to: moving.to,
      onComplete: () => advanceBotPlayback(botPlayback.key, botPlayback.completedSteps, botPlayback.move.steps.length),
    };
  }, [advanceBotPlayback, botPlayback, botPlaybackFrame]);
  const optimisticHumanState = localHumanMove && online.snapshot?.id === localHumanMove.matchId &&
    Number(online.snapshot.version) <= localHumanMove.baseVersion ? localHumanMove.state : null;
  const displayGame = botPlaybackFrame?.state ?? pendingBotMoveLookup?.source ?? optimisticHumanState ?? game;

  useEffect(() => {
    if (!localHumanMove || online.snapshot?.id !== localHumanMove.matchId) return;
    if (Number(online.snapshot.version) > localHumanMove.baseVersion || online.snapshot.status !== "active") {
      localHumanMoveBusy.current = false;
      setLocalHumanMove(null);
    }
  }, [localHumanMove, online.snapshot?.id, online.snapshot?.status, online.snapshot?.version]);

  const legalMoves = useMemo(() => game ? getLegalMoves(game) : [], [game]);
  const forcedCaptureMoves = useMemo(() => legalMoves.filter((move) => move.steps[0]?.capturedId), [legalMoves]);
  const canHumanMove = !!game && online.snapshot?.status === "active" && game.turn === humanColor &&
    online.snapshot.current_turn_user_id === userId && !myPlayer?.botTakeover && !botPlayback &&
    !pendingBotMoveLookup && !localHumanMove && !online.busy;
  const forcedMovePieceIds = useMemo(() => canHumanMove
    ? [...new Set(forcedCaptureMoves.map((move) => move.pieceId))]
    : [], [canHumanMove, forcedCaptureMoves]);
  const capturePieceIds = useMemo(() => canHumanMove
    ? [...new Set(forcedCaptureMoves.map((move) => move.steps[0]?.capturedId).filter((id): id is string => !!id))]
    : [], [canHumanMove, forcedCaptureMoves]);
  const candidates = useMemo(() => legalMoves.filter((move) => move.pieceId === selectedId &&
    prefix.every((step, index) => sameStep(step, move.steps[index]))), [legalMoves, prefix, selectedId]);
  const targets = useMemo(() => candidates.map((move) => move.steps[prefix.length]?.to)
    .filter((square): square is Square => !!square)
    .filter((square, index, all) => all.findIndex((other) => sameSquare(square, other)) === index), [candidates, prefix.length]);
  const projected = prefix.length && candidates.length && game ? projectMove(game, candidates[0], prefix.length) : game;
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setActionError("");
    try { await action(); setSelectedId(null); setPrefix([]); }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); void online.refresh().catch(() => undefined); }
  }, [online.refresh]);

  const submitCompletedMove = useCallback((move: Move) => {
    if (!game || !online.snapshot || localHumanMoveBusy.current) return;
    let predicted: GameState;
    try {
      predicted = applyMove(game, move, Date.now());
    } catch {
      return;
    }
    localHumanMoveBusy.current = true;
    setLocalHumanMove({ matchId: online.snapshot.id, baseVersion: Number(online.snapshot.version), state: predicted });
    void run(async () => {
      try {
        await online.sendMove(move);
      } catch (error) {
        localHumanMoveBusy.current = false;
        setLocalHumanMove(null);
        throw error;
      }
    });
  }, [game, online.sendMove, online.snapshot, run]);

  const onSquarePress = useCallback((square: Square) => {
    if (!game || botPlayback || pendingBotMoveLookup || localHumanMove || myPlayer?.botTakeover || online.snapshot?.status !== "active" || online.busy || game.turn !== humanColor ||
        online.snapshot?.current_turn_user_id !== userId || game.result) return;
    if (isTurnExpired(game, Date.now())) return;
    const matching = candidates.filter((move) => sameSquare(move.steps[prefix.length]?.to ?? { row: -1, column: -1 }, square));
    if (selectedId && matching.length) {
      const move = matching[0];
      const nextPrefix = move.steps.slice(0, prefix.length + 1);
      if (nextPrefix.length === move.steps.length) submitCompletedMove(move);
      else setPrefix(nextPrefix);
      return;
    }
    if (prefix.length) return;
    const piece = game.pieces.find((candidate) => sameSquare(candidate, square) && candidate.color === humanColor);
    setSelectedId(piece && legalMoves.some((move) => move.pieceId === piece.id) ? piece.id : null);
  }, [botPlayback, candidates, game, humanColor, legalMoves, localHumanMove, myPlayer?.botTakeover, online.busy, online.snapshot, pendingBotMoveLookup, prefix, selectedId, submitCompletedMove, userId]);

  const onSquareDrag = useCallback((from: Square, to: Square) => {
    if (!game || botPlayback || pendingBotMoveLookup || localHumanMove || myPlayer?.botTakeover || online.snapshot?.status !== "active" || game.turn !== humanColor || online.snapshot.current_turn_user_id !== userId) return;
    const active = projected?.pieces.find((piece) => piece.id === selectedId);
    if (active && sameSquare(active, from)) { onSquarePress(to); return; }
    if (prefix.length) return;
    const piece = game.pieces.find((candidate) => candidate.color === humanColor && sameSquare(candidate, from));
    const move = piece && legalMoves.find((candidate) => candidate.pieceId === piece.id && sameSquare(candidate.steps[0].to, to));
    if (!piece || !move) return;
    if (move.steps.length === 1) submitCompletedMove(move);
    else { setSelectedId(piece.id); setPrefix(move.steps.slice(0, 1)); }
  }, [botPlayback, game, humanColor, legalMoves, localHumanMove, myPlayer?.botTakeover, onSquarePress, online.snapshot, pendingBotMoveLookup, prefix.length, projected, selectedId, submitCompletedMove, userId]);

  useEffect(() => {
    if (countdownActive || online.snapshot?.matchmaking_deadline_at) {
      const display = setInterval(() => setClockNow(Date.now()), 200);
      return () => clearInterval(display);
    }
    if (!game || game.result || !game.turnDeadlineAtMs || online.snapshot?.status !== "active") return;
    const display = setInterval(() => setClockNow(Date.now()), 200);
    return () => { clearInterval(display); };
  }, [countdownActive, game, online.snapshot?.matchmaking_deadline_at, online.snapshot?.status]);

  const pregameDeadline = online.snapshot?.countdown_ends_at;
  const pregameExpired = online.snapshot?.status === "waiting" && !!pregameDeadline && Date.parse(pregameDeadline) <= clockNow;
  useEffect(() => {
    if (!pregameExpired) return;
    void online.refresh().catch(() => undefined);
    const reconcile = setInterval(() => { void online.refresh().catch(() => undefined); }, 1_000);
    return () => clearInterval(reconcile);
  }, [online.refresh, pregameExpired]);

  const [resultDismissed, setResultDismissed] = useState(false);
  const [resultPreferenceMatchId, setResultPreferenceMatchId] = useState<string | null>(null);
  const resultPopupMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (online.snapshot?.status !== "finished" || !online.snapshot.id || !userId) return;
    const matchId = online.snapshot.id;
    if (resultPopupMatchRef.current === matchId) return;
    resultPopupMatchRef.current = matchId;
    let live = true;
    const key = `dama-result-popup:${userId}:${matchId}`;
    void AsyncStorage.getItem(key).then((seen) => {
      if (live) {
        setResultDismissed(seen === "seen");
        setResultPreferenceMatchId(matchId);
      }
    }).catch(() => {
      if (live) setResultPreferenceMatchId(matchId);
    });
    return () => { live = false; };
  }, [online.snapshot?.id, online.snapshot?.status, userId]);
  const dismissResult = useCallback(() => {
    setResultDismissed(true);
    resultPopupMatchRef.current = online.snapshot?.id ?? resultPopupMatchRef.current;
    if (online.snapshot?.id && userId) void AsyncStorage.setItem(`dama-result-popup:${userId}:${online.snapshot.id}`, "seen").catch(() => undefined);
  }, [online.snapshot?.id, userId]);

  const playerViews = useMemo(() => online.players.map((player) => ({
    id: player.userId ?? player.botProfileId ?? player.id,
    name: player.username,
    kind: player.isBot ? "bot" : "human",
    teamId: player.pieceColor === "cream" ? "teamA" : "teamB",
    points: 0,
    avatarId: player.isBot ? undefined : getSeatAvatarId(player.avatarId, false),
    avatarUrl: player.avatarUrl,
  })), [online.players]);
  const humanName = myPlayer?.username ?? profile?.username ?? "You";
  const opponentName = opponent?.username ?? "بەرامبەر";
  const myCaptured = displayGame ? 16 - displayGame.pieces.filter((piece) => piece.color !== humanColor).length : 0;
  const opponentCaptured = displayGame ? 16 - displayGame.pieces.filter((piece) => piece.color === humanColor).length : 0;
  const waiting = online.snapshot?.status === "waiting";
  const restoringExistingMatch = Boolean(initialMatchId) && (!game || online.players.length < 2);
  const seats = online.players.map((player) => ({ playerIndex: player.playerIndex, username: player.username, isBot: !!player.isBot, avatarId: player.isBot ? undefined : getSeatAvatarId(player.avatarId, false), avatarUrl: player.avatarUrl }));
  const remaining = displayGame ? getTurnRemainingMs(displayGame, clockNow) : 0;
  const displayedPieces = displayGame?.pieces ?? (countdownActive ? pregameState.pieces : []);
  const seatWidth = Math.min(150, width * 0.16);
  const seatSideInset = Math.max(8, (width - getBoardSize(width, height).width) / 2 - seatWidth - 28);

  return <View style={styles.scene}>
    <DamaTable viewportWidth={width} viewportHeight={height} pieces={botPlaybackFrame?.state.pieces ?? pendingBotMoveLookup?.source.pieces ?? optimisticHumanState?.pieces ?? projected?.pieces ?? displayedPieces} selectedId={pendingBotMoveLookup || localHumanMove ? null : selectedId} forcedMovePieceIds={forcedMovePieceIds} capturePieceIds={capturePieceIds} targets={pendingBotMoveLookup || localHumanMove ? [] : targets} onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} perspective={humanColor} botStep={botStep} />
    {(game || countdownActive) && width > height && <>
      <View pointerEvents="none" style={[styles.seatLayer, { left: seatSideInset, width: seatWidth }]}>
        <DamaPlayerSeat player={{ id: opponent?.id ?? "opponent", username: opponentName, isBot: !!opponent?.isBot, avatarId: opponent && !opponent.isBot ? getSeatAvatarId(opponent.avatarId, false) : undefined, avatarUrl: opponent?.avatarUrl, pieceColor: humanColor === "cream" ? "black" : "cream", capturedCount: displayGame ? opponentCaptured : 0, isCurrentTurn: !!displayGame && displayGame.turn !== humanColor && !displayGame.result, connected: opponent?.connected, botTakeover: opponent?.botTakeover }} capturedPieceColor={humanColor} width={seatWidth} avatarSize={54} turnRemainingMs={displayGame && displayGame.turn !== humanColor ? remaining : 0} />
      </View>
      <View pointerEvents="none" style={[styles.seatLayer, { right: seatSideInset, width: seatWidth }]}>
        <DamaPlayerSeat player={{ id: userId, username: humanName, isBot: false, avatarId: getSeatAvatarId(profile?.avatarId ?? myPlayer?.avatarId, false), avatarUrl: profile?.avatarUrl ?? myPlayer?.avatarUrl, pieceColor: humanColor, capturedCount: displayGame ? myCaptured : 0, isCurrentTurn: !!displayGame && displayGame.turn === humanColor && !displayGame.result, connected: myPlayer?.connected, botTakeover: myPlayer?.botTakeover }} capturedPieceColor={humanColor === "cream" ? "black" : "cream"} width={seatWidth} avatarSize={54} turnRemainingMs={displayGame && displayGame.turn === humanColor ? remaining : 0} />
      </View>
    </>}
    {game && width <= height && <View pointerEvents="none" style={styles.score}><Text style={styles.bannerText}>{humanName}: {myCaptured}  ·  {opponentName}: {opponentCaptured}</Text></View>}
    <Pressable style={styles.menuButton} onPress={openMatchMenu}><Ionicons name="menu-outline" size={22} color="#f8f3df" /></Pressable>
    {game && online.snapshot?.status === "active" && <MatchMenuDrawer visible={showMatchMenu} loadHumanProfiles={false} botLabel="فێرخواز" players={playerViews} humanPlayer={playerViews.find((player) => player.id === userId)} activePlayerId={online.snapshot.current_turn_user_id} translateX={matchMenuTranslateX} onClose={closeMatchMenu} onLeavePress={() => { closeMatchMenu(); setLeaveConfirm(true); }} />}
    <LeaveMatchConfirmPopup visible={leaveConfirm} onCancel={() => setLeaveConfirm(false)} onConfirm={() => { leavingMatch.current = true; setLeaveConfirm(false); void run(async () => { await online.cancelOrLeave(); router.replace("/(tabs)/play"); }); }} />
    {!!online.matchId && online.snapshot?.status === "active" && <MultiplayerGameChat gameType="dame" mode="1v1" matchId={online.matchId} currentUserId={userId} playerIdBySeat={{ bottom: userId, top: opponent?.userId ?? undefined }} enabled />}
    <WaitingPlayersPopup visible={waiting} entryFee={500} currency="fun" playerCount={2} members={seats} countdownSeconds={matchmakingRemaining} statusMessage={online.error ? (online.error.includes("insufficient_entry_balance") ? "بۆ یاری‌کردن ٥٠٠ کۆینت پێویستە" : "پەیوەندی بە گەڕانی یارییەوە نەکرا") : undefined} loading={online.busy} canCancel={!!online.matchId && online.players.length < 2} onCancel={() => { leavingMatch.current = true; void run(async () => { await online.cancelOrLeave(); router.replace("/(tabs)/play"); }); }} />
    {!!actionError && <View style={styles.error}><Text style={styles.errorText}>{actionError}</Text></View>}
    {!!online.error && !waiting && online.matchmakingStatus !== "error" && <View style={styles.error}><Text style={styles.errorText}>{online.error}</Text></View>}
    {online.matchmakingStatus === "error" && <View style={styles.center}><Text style={styles.title}>نەتوانرا بچیتە ناو گەڕانی یاری</Text><Text style={styles.errorText}>{online.error}</Text><Pressable style={styles.button} onPress={() => router.replace("/dama/game?mode=online")}><Text style={styles.buttonText}>دووبارە هەوڵبدە</Text></Pressable></View>}
    {game?.result && !botPlayback && <GameOverPopup visible={resultPreferenceMatchId === online.snapshot?.id && !resultDismissed && online.snapshot?.status === "finished"}
      didWin={game.result.winner !== null && game.result.winner === humanColor && !myPlayer?.botTakeover}
      isDraw={game.result.winner === null && game.result.reason !== "both-bot-takeover"}
      drawLabel="یەکسانی"
      teamAName={online.players.find((player) => player.pieceColor === "cream")?.username ?? "کریم"}
      teamBName={online.players.find((player) => player.pieceColor === "black")?.username ?? "ڕەش"}
      teamScores={{ teamA: 16 - game.pieces.filter((piece) => piece.color === "black").length, teamB: 16 - game.pieces.filter((piece) => piece.color === "cream").length }}
      winningTeamId={game.result.winner === null ? null : game.result.winner === "cream" ? "teamA" : "teamB"}
      finishReason={game.result.reason}
      reward={online.snapshot?.settlement ? {
        coin: Number(online.snapshot.settlement.type === "winner"
          ? (myPlayer?.botTakeover ? -500 : online.snapshot.winner_user_id === userId ? online.snapshot.settlement.netCoinDelta ?? 500 : -500)
          : online.snapshot.settlement.netCoinDelta ?? 0),
        gem: Number(online.snapshot.settlement.type === "winner"
          ? (myPlayer?.botTakeover ? online.snapshot.settlement.takeoverGemDelta ?? 0 : online.snapshot.winner_user_id === userId ? online.snapshot.settlement.winnerGemDelta ?? 10 : online.snapshot.settlement.loserGemDelta ?? 0)
          : online.snapshot.settlement.gemDelta ?? 0),
        points: Number(online.snapshot.settlement.type === "winner"
          ? (myPlayer?.botTakeover ? online.snapshot.settlement.takeoverPointDelta ?? -25 : online.snapshot.winner_user_id === userId ? online.snapshot.settlement.winnerPointDelta ?? 35 : online.snapshot.settlement.loserPointDelta ?? -15)
          : online.snapshot.settlement.pointDelta ?? 0),
        currency: "fun",
      } : null}
      onClose={() => { dismissResult(); router.replace("/(tabs)/play"); }}
      onPlayAgain={() => { dismissResult(); router.replace("/(tabs)/play"); }} />}
    {!hasReadySession(auth) && auth.authReady && <View style={styles.center}><Text style={styles.title}>بچۆ ژوورەوە بۆ یاریی ئۆنلاین</Text><Pressable style={styles.button} onPress={() => router.replace("/login")}><Text style={styles.buttonText}>چوونەژوورەوە</Text></Pressable></View>}
    {online.matchmakingStatus === "searching" && !online.snapshot && <View pointerEvents="none" style={styles.connecting}><ActivityIndicator color="#f8d774" /></View>}
    {restoringExistingMatch && <View style={styles.restoreOverlay}>
      {online.error
        ? <Text style={styles.errorText}>{online.error}</Text>
        : <ActivityIndicator size="large" color="#f8d774" />}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: "#0c0c20", overflow: "hidden" },
  menuButton: { position: "absolute", top: 18, right: 18, zIndex: 900, elevation: 900, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  seatLayer: { position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  score: { position: "absolute", top: 8, alignSelf: "center", padding: 7, backgroundColor: "rgba(15,8,24,0.78)", borderRadius: 12 },
  turn: { position: "absolute", top: 45, alignSelf: "center", padding: 7, backgroundColor: "rgba(15,8,24,0.78)", borderRadius: 12 },
  bannerText: { color: "#ffe1a0", fontWeight: "700" },
  center: { ...StyleSheet.absoluteFill, zIndex: 1300, backgroundColor: "rgba(8,4,16,0.82)", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#fff3db", fontSize: 23, fontWeight: "800", textAlign: "center" },
  error: { position: "absolute", bottom: 15, alignSelf: "center", zIndex: 1000 },
  errorText: { color: "#fca5a5", textAlign: "center", marginTop: 10 },
  button: { marginTop: 20, backgroundColor: "#8a4dac", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "white", fontWeight: "700", fontSize: 16 },
  connecting: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  restoreOverlay: { ...StyleSheet.absoluteFill, zIndex: 2000, elevation: 2000, backgroundColor: "#050b22", alignItems: "center", justifyContent: "center" },
});
