import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";
import {
  applyMove,
  createGame,
  getLegalMoves,
  getTurnRemainingMs,
  type GameState,
  type Move,
  type Side,
  type Square,
} from "./engine";
import {
  commitDamaMove,
  getDamaWaitingStatus,
  handleDamaTurnTimeout,
  leaveDamaMatch,
  reclaimDamaSeat,
  type DamaRoomPlayerSummary,
} from "./dama-adapter";

export type DamaGamePhase =
  | "initializing"
  | "playing"
  | "round_result"
  | "forfeit"
  | "error";

export type UseDamaGameControllerOptions = {
  roomId: string;
  currentUserId: string;
  initialPlayers?: DamaRoomPlayerSummary[];
  onFinish?: () => void;
};

export function useDamaGameController({
  roomId,
  currentUserId,
  initialPlayers = [],
  onFinish,
}: UseDamaGameControllerOptions) {
  const [phase, setPhase] = useState<DamaGamePhase>("initializing");
  const [gameState, setGameState] = useState<GameState>(() => createGame());
  const [players, setPlayers] = useState<DamaRoomPlayerSummary[]>(initialPlayers);
  const [version, setVersion] = useState<number>(1);
  const [turnRemainingMs, setTurnRemainingMs] = useState<number>(15_000);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [winner, setWinner] = useState<{ id?: string; color?: Side; reason?: string } | null>(null);

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const versionRef = useRef(version);
  versionRef.current = version;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const myPlayer = players.find((p) => p.userId === currentUserId);
  const myColor: Side = myPlayer?.color ?? "cream";
  const opponent = players.find((p) => p.userId !== currentUserId);
  const opponentColor: Side = myColor === "cream" ? "black" : "cream";
  const isMyTurn = phase === "playing" && gameState.turn === myColor;

  // 1. Initial State Fetch from DB
  const refreshRoomState = useCallback(async () => {
    try {
      const { data: room, error: roomError } = await supabase
        .from("dama_rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (roomError || !room) return;

      const { data: playerRows } = await supabase
        .from("dama_players")
        .select("user_id, player_index, color, connected, bot_takeover")
        .eq("room_id", roomId);

      if (playerRows && playerRows.length) {
        const userIds = playerRows.map((r: any) => r.user_id);
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id, username, avatar_id, avatar_url")
          .in("id", userIds);

        const profileMap = new Map((profileRows ?? []).map((p: any) => [p.id, p]));

        const summaries: DamaRoomPlayerSummary[] = playerRows.map((row: any) => {
          const profile = profileMap.get(row.user_id);
          return {
            userId: row.user_id,
            playerIndex: row.player_index,
            color: row.color,
            username: profile?.username || (row.user_id === currentUserId ? "تۆ" : "حریف"),
            avatarId: profile?.avatar_id,
            avatarUrl: profile?.avatar_url,
            connected: row.connected,
            botTakeover: row.bot_takeover,
          };
        });
        setPlayers(summaries);

        // If I was in bot takeover or disconnected, automatically reclaim my seat!
        const mySeat = playerRows.find((r: any) => r.user_id === currentUserId);
        if (mySeat && (mySeat.bot_takeover || !mySeat.connected)) {
          void reclaimDamaSeat(roomId);
        }
      }

      setVersion(room.version);
      if (room.state && Object.keys(room.state).length > 0) {
        setGameState(room.state as GameState);
      }

      if (room.status === "finished") {
        setPhase("round_result");
        setWinner({
          id: room.winner_user_id,
          reason: room.finish_reason,
        });
      } else if (room.status === "active") {
        setPhase("playing");
      }
    } catch (err) {
      console.warn("Failed to refresh dama room state", err);
    }
  }, [roomId, currentUserId]);

  // 2. Realtime Subscriptions for Room, Players and Moves
  useEffect(() => {
    void refreshRoomState();

    const channel = supabase
      .channel(`dama-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dama_rooms", filter: `id=eq.${roomId}` },
        (payload: any) => {
          const updated = payload.new;
          if (!updated) return;

          setVersion(updated.version);
          if (updated.state && Object.keys(updated.state).length > 0) {
            setGameState(updated.state as GameState);
          }

          if (updated.status === "finished") {
            setPhase("round_result");
            setWinner({
              id: updated.winner_user_id,
              reason: updated.finish_reason,
            });
          } else if (updated.status === "active") {
            setPhase("playing");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dama_players", filter: `room_id=eq.${roomId}` },
        () => {
          void refreshRoomState();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, refreshRoomState]);

  // 3. Heartbeat / AppState Reconnection (mirrors Domino)
  useEffect(() => {
    const handleAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === "active") {
        void refreshRoomState();
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    const interval = setInterval(() => {
      void getDamaWaitingStatus(roomId);
    }, 10_000);

    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [roomId, refreshRoomState]);

  // 4. Live Turn Countdown & Automatic Timeout Handling
  useEffect(() => {
    if (phase !== "playing") return;

    const timer = setInterval(() => {
      const remaining = getTurnRemainingMs(gameStateRef.current);
      setTurnRemainingMs(remaining);

      // If turn expired and it's my turn (or bot takeover), trigger timeout RPC
      if (remaining <= 0 && isMyTurn) {
        const currentMoves = getLegalMoves(gameStateRef.current);
        const autoMove = currentMoves[0];
        if (autoMove) {
          try {
            const next = applyMove(gameStateRef.current, autoMove);
            void handleDamaTurnTimeout(
              roomId,
              versionRef.current,
              autoMove,
              next,
              next.result,
            );
          } catch {
            // Stale or handled
          }
        }
      }
    }, 250);

    return () => clearInterval(timer);
  }, [phase, isMyTurn, roomId]);

  // 5. Square Touch & Move Handler
  const handleSquarePress = useCallback(
    (square: Square) => {
      if (!isMyTurn) return;

      const pieceOnSquare = gameState.pieces.find(
        (p) => p.row === square.row && p.column === square.column,
      );

      // Select own piece
      if (pieceOnSquare && pieceOnSquare.color === myColor) {
        setSelectedPieceId(pieceOnSquare.id);
        const legal = getLegalMoves(gameState).filter((m) => m.pieceId === pieceOnSquare.id);
        const targets = legal.map((m) => m.steps[m.steps.length - 1].to);
        setLegalTargets(targets);
        return;
      }

      // If a piece was already selected, check if square is a valid target
      if (selectedPieceId) {
        const legalMove = getLegalMoves(gameState).find(
          (m) =>
            m.pieceId === selectedPieceId &&
            m.steps[m.steps.length - 1].to.row === square.row &&
            m.steps[m.steps.length - 1].to.column === square.column,
        );

        if (legalMove) {
          try {
            const next = applyMove(gameState, legalMove);
            setSelectedPieceId(null);
            setLegalTargets([]);

            // Optimistic update
            setGameState(next);
            void commitDamaMove(
              roomId,
              versionRef.current,
              legalMove,
              next,
              next.result,
            );
          } catch (err) {
            console.warn("Invalid move committed", err);
          }
        } else {
          setSelectedPieceId(null);
          setLegalTargets([]);
        }
      }
    },
    [gameState, isMyTurn, myColor, selectedPieceId, roomId],
  );

  const handleSquareDrag = useCallback(
    (from: Square, to: Square) => {
      if (!isMyTurn) return;

      const legalMove = getLegalMoves(gameState).find(
        (m) =>
          m.from.row === from.row &&
          m.from.column === from.column &&
          m.steps[m.steps.length - 1].to.row === to.row &&
          m.steps[m.steps.length - 1].to.column === to.column,
      );

      if (legalMove) {
        try {
          const next = applyMove(gameState, legalMove);
          setSelectedPieceId(null);
          setLegalTargets([]);
          setGameState(next);
          void commitDamaMove(
            roomId,
            versionRef.current,
            legalMove,
            next,
            next.result,
          );
        } catch (err) {
          console.warn("Drag move error", err);
        }
      }
    },
    [gameState, isMyTurn, roomId],
  );

  const handleLeave = useCallback(async () => {
    await leaveDamaMatch(roomId);
    onFinish?.();
  }, [roomId, onFinish]);

  return {
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
    refreshRoomState,
  };
}
