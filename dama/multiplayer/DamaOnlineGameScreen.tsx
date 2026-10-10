import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import LeaveMatchConfirmPopup from "@/components/multiplayer/LeaveMatchConfirmPopup";
import MatchMenuDrawer from "@/components/multiplayer/MatchMenuDrawer";
import MultiplayerGameChat from "@/components/multiplayer/MultiplayerGameChat";
import WaitingPlayersPopup from "@/components/multiplayer/WaitingPlayersPopup";
import { DamaPlayerSeat } from "@/dama/components/DamaPlayerSeat";
import { DamaTable } from "@/dama/components/DamaTable";
import { getLegalMoves, getTurnRemainingMs, isTurnExpired, projectMove, type GameState, type Move, type Side, type Square, type Step } from "@/dama/engine";
import { useDamaMultiplayer } from "@/dama/useDamaMultiplayer";
import { useMatchMenu } from "@/hooks/useMatchMenu";
import { useGameSystemGestureProtection } from "@/hooks/useGameSystemGestureProtection";
import { hasReadySession, useAuthState } from "@/lib/auth-state";
import { useProfile } from "@/lib/profile";
import type { AvatarId } from "@/types/avatar";

const sameSquare = (a: Square, b: Square) => a.row === b.row && a.column === b.column;
const sameStep = (a: Step, b: Step) => sameSquare(a.to, b.to) && a.capturedId === b.capturedId;

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
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [actionError, setActionError] = useState("");
  const botBusy = useRef(false);
  const restoringControl = useRef(false);
  const leavingMatch = useRef(false);
  const { showMatchMenu, matchMenuTranslateX, openMatchMenu, closeMatchMenu } = useMatchMenu();
  const game = online.snapshot?.state ?? null;
  const userId = auth.userId ?? "";
  const myPlayer = online.players.find((player) => player.userId === userId);
  const opponent = online.players.find((player) => player.userId !== userId);
  const humanColor: Side = myPlayer?.pieceColor ?? "cream";
  const legalMoves = useMemo(() => game ? getLegalMoves(game) : [], [game]);
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
    void run(() => online.sendMove(move));
  }, [online.sendMove, run]);

  const onSquarePress = useCallback((square: Square) => {
    if (!game || online.snapshot?.status !== "active" || online.busy || game.turn !== humanColor ||
        online.snapshot?.current_turn_user_id !== userId || game.result) return;
    if (isTurnExpired(game, Date.now())) { void run(online.submitTimeout); return; }
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
  }, [candidates, game, humanColor, legalMoves, online.busy, online.snapshot, online.submitTimeout, prefix, run, selectedId, submitCompletedMove, userId]);

  const onSquareDrag = useCallback((from: Square, to: Square) => {
    if (!game || online.snapshot?.status !== "active" || game.turn !== humanColor || online.snapshot.current_turn_user_id !== userId) return;
    const active = projected?.pieces.find((piece) => piece.id === selectedId);
    if (active && sameSquare(active, from)) { onSquarePress(to); return; }
    if (prefix.length) return;
    const piece = game.pieces.find((candidate) => candidate.color === humanColor && sameSquare(candidate, from));
    const move = piece && legalMoves.find((candidate) => candidate.pieceId === piece.id && sameSquare(candidate.steps[0].to, to));
    if (!piece || !move) return;
    if (move.steps.length === 1) submitCompletedMove(move);
    else { setSelectedId(piece.id); setPrefix(move.steps.slice(0, 1)); }
  }, [game, humanColor, legalMoves, onSquarePress, online.snapshot, prefix.length, projected, selectedId, submitCompletedMove, userId]);

  useEffect(() => {
    if (!game || game.result || !game.turnDeadlineAtMs || online.snapshot?.status !== "active") return;
    const timer = setTimeout(() => { void run(online.submitTimeout); }, Math.max(0, game.turnDeadlineAtMs - Date.now() + 40));
    const display = setInterval(() => setClockNow(Date.now()), 200);
    return () => { clearTimeout(timer); clearInterval(display); };
  }, [game, online.snapshot?.status, online.submitTimeout, run]);

  useEffect(() => {
    if (!myPlayer?.botTakeover || leavingMatch.current || restoringControl.current || online.snapshot?.status !== "active") return;
    restoringControl.current = true;
    void online.restoreControl().catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error));
      restoringControl.current = false;
    });
  }, [myPlayer?.botTakeover, online.restoreControl, online.snapshot?.status]);

  useEffect(() => {
    const player = online.players.find((candidate) => candidate.userId === online.snapshot?.current_turn_user_id);
    if (!game || online.snapshot?.status !== "active" || !player || online.busy || botBusy.current) return;
    const disconnected = Date.now() - Date.parse(player.lastSeenAt) >= 75_000;
    if (!player.botTakeover && (player.userId === userId || !disconnected)) return;
    botBusy.current = true;
    const action = player.botTakeover ? online.submitBot() : online.claimBotTakeover();
    void action.catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error));
      void online.refresh().catch(() => undefined);
    }).finally(() => { botBusy.current = false; });
  }, [game, online.players, online.snapshot?.current_turn_user_id, online.snapshot?.status, online.busy, online.submitBot, online.claimBotTakeover, online.refresh, userId]);

  const playerViews = useMemo(() => online.players.map((player) => ({
    id: player.userId,
    name: player.username,
    kind: "human",
    teamId: player.pieceColor === "cream" ? "teamA" : "teamB",
    points: 0,
    avatarId: player.avatarId as AvatarId | undefined,
    avatarUrl: player.avatarUrl,
  })), [online.players]);
  const humanName = myPlayer?.username ?? profile?.username ?? "You";
  const opponentName = opponent?.username ?? "Opponent";
  const myCaptured = game ? 16 - game.pieces.filter((piece) => piece.color !== humanColor).length : 0;
  const opponentCaptured = game ? 16 - game.pieces.filter((piece) => piece.color === humanColor).length : 0;
  const waiting = online.snapshot?.status === "waiting" || online.matchmakingStatus === "searching" && !game;
  const seats = online.players.map((player) => ({ playerIndex: player.playerIndex, username: player.username, avatarId: player.avatarId as AvatarId | undefined, avatarUrl: player.avatarUrl }));
  const remaining = game ? getTurnRemainingMs(game, clockNow) : 0;

  return <View style={styles.scene}>
    <DamaTable viewportWidth={width} viewportHeight={height} pieces={projected?.pieces ?? []} selectedId={selectedId} targets={targets} onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} />
    {game && width > height && <>
      <View pointerEvents="none" style={[styles.seatLayer, { left: Math.max(8, width * 0.03), width: Math.min(150, width * 0.16) }]}>
        <DamaPlayerSeat player={{ id: userId, username: humanName, avatarId: myPlayer?.avatarId as AvatarId | undefined, avatarUrl: myPlayer?.avatarUrl, pieceColor: humanColor, capturedCount: myCaptured, isCurrentTurn: game.turn === humanColor && !game.result }} capturedPieceColor={humanColor === "cream" ? "black" : "cream"} width={Math.min(150, width * 0.16)} avatarSize={54} turnRemainingMs={game.turn === humanColor ? remaining : 0} />
      </View>
      <View pointerEvents="none" style={[styles.seatLayer, { right: Math.max(8, width * 0.03), width: Math.min(150, width * 0.16) }]}>
        <DamaPlayerSeat player={{ id: opponent?.userId ?? "opponent", username: opponentName, avatarId: opponent?.avatarId as AvatarId | undefined, avatarUrl: opponent?.avatarUrl, pieceColor: humanColor === "cream" ? "black" : "cream", capturedCount: opponentCaptured, isCurrentTurn: game.turn !== humanColor && !game.result }} capturedPieceColor={humanColor} width={Math.min(150, width * 0.16)} avatarSize={54} turnRemainingMs={game.turn !== humanColor ? remaining : 0} />
      </View>
    </>}
    {game && width <= height && <View pointerEvents="none" style={styles.score}><Text style={styles.bannerText}>{humanName}: {myCaptured}  ·  {opponentName}: {opponentCaptured}</Text></View>}
    {game && !game.result && <View pointerEvents="none" style={styles.turn}><Text style={styles.bannerText}>{online.snapshot?.current_turn_user_id === userId ? "Your turn" : `${opponentName}'s turn`}</Text></View>}
    <Pressable style={styles.menuButton} onPress={openMatchMenu}><Ionicons name="menu-outline" size={22} color="#f8f3df" /></Pressable>
    {game && online.snapshot?.status === "active" && <MatchMenuDrawer visible={showMatchMenu} loadHumanProfiles={false} players={playerViews} humanPlayer={playerViews.find((player) => player.id === userId)} activePlayerId={online.snapshot.current_turn_user_id} translateX={matchMenuTranslateX} onClose={closeMatchMenu} onLeavePress={() => { closeMatchMenu(); setLeaveConfirm(true); }} />}
    <LeaveMatchConfirmPopup visible={leaveConfirm} onCancel={() => setLeaveConfirm(false)} onConfirm={() => { leavingMatch.current = true; setLeaveConfirm(false); void run(async () => { await online.cancelOrLeave(); router.replace("/(tabs)/play"); }); }} />
    {!!online.matchId && online.snapshot?.status === "active" && <MultiplayerGameChat gameType="dame" mode="1v1" matchId={online.matchId} currentUserId={userId} playerIdBySeat={{ bottom: userId, top: opponent?.userId }} enabled />}
    <WaitingPlayersPopup visible={waiting} entryFee={0} currency="fun" playerCount={2} members={seats} statusMessage={online.error ? "Could not connect to matchmaking" : "Finding a Dama opponent…"} loading={online.busy} canCancel={!!online.matchId} onCancel={() => { leavingMatch.current = true; void run(async () => { await online.cancelOrLeave(); router.replace("/(tabs)/play"); }); }} />
    {!!actionError && <View style={styles.error}><Text style={styles.errorText}>{actionError}</Text></View>}
    {online.matchmakingStatus === "error" && <View style={styles.center}><Text style={styles.title}>Could not join matchmaking</Text><Text style={styles.errorText}>{online.error}</Text><Pressable style={styles.button} onPress={() => router.replace("/dama/game?mode=online")}><Text style={styles.buttonText}>Retry</Text></Pressable></View>}
    {game?.result && <View style={styles.center}><Text style={styles.title}>{game.result.winner === null ? "Draw" : game.result.winner === humanColor ? "You win!" : "You lose"}</Text><Text style={styles.errorText}>Match finished · {game.result.reason}</Text><Pressable style={styles.button} onPress={() => router.replace("/(tabs)/play")}><Text style={styles.buttonText}>Continue</Text></Pressable></View>}
    {!hasReadySession(auth) && auth.authReady && <View style={styles.center}><Text style={styles.title}>Sign in to play online</Text><Pressable style={styles.button} onPress={() => router.replace("/login")}><Text style={styles.buttonText}>Sign in</Text></Pressable></View>}
    {online.matchmakingStatus === "searching" && !online.snapshot && <View pointerEvents="none" style={styles.connecting}><ActivityIndicator color="#f8d774" /></View>}
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
});
