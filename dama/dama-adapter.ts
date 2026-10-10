import { supabase } from "@/lib/supabase";
import type { AvatarId } from "@/types/avatar";
import type { Move, Side } from "./engine";

export type DamaRoomPlayerSummary = {
  userId: string;
  playerIndex: number;
  color: Side;
  username: string;
  avatarId?: AvatarId;
  avatarUrl?: string;
  connected: boolean;
  botTakeover: boolean;
};

export type DamaWaitingStatus = {
  status: "none" | "searching" | "waiting" | "active" | "finished" | "cancelled";
  roomId?: string;
  entryFee?: number;
  prizePool?: number;
  countdownEndsAt?: string | null;
  currentTurnColor?: Side;
  currentTurnPlayerId?: string;
  turnDeadlineAt?: string | null;
  version?: number;
  players?: DamaRoomPlayerSummary[];
  started?: boolean;
};

export async function joinDamaMatchmaking(): Promise<DamaWaitingStatus> {
  const { data, error } = await supabase.rpc("dama_matchmake");
  if (error) throw error;
  return data as DamaWaitingStatus;
}

export async function getDamaWaitingStatus(roomId?: string): Promise<DamaWaitingStatus> {
  const { data, error } = await supabase.rpc("dama_waiting_room_status", {
    p_room_id: roomId ?? null,
  });
  if (error) throw error;
  return data as DamaWaitingStatus;
}

export async function cancelDamaMatchmaking(): Promise<void> {
  const { error } = await supabase.rpc("dama_cancel_matchmaking");
  if (error) throw error;
}

export async function startDamaGame(roomId: string): Promise<void> {
  const { error } = await supabase.rpc("dama_start_game", { p_room_id: roomId });
  if (error) throw error;
}

export async function commitDamaMove(
  roomId: string,
  expectedVersion: number,
  move: Move,
  nextState: unknown,
  result?: unknown,
): Promise<{ accepted: boolean; version?: number; finished?: boolean; winner_id?: string; reason?: string }> {
  const { data, error } = await supabase.rpc("dama_commit_move", {
    p_room_id: roomId,
    p_expected_version: expectedVersion,
    p_move: move,
    p_next_state: nextState,
    p_result: result ?? null,
  });
  if (error) throw error;
  return data;
}

export async function handleDamaTurnTimeout(
  roomId: string,
  expectedVersion: number,
  autoMove: Move,
  nextState: unknown,
  result?: unknown,
): Promise<{ accepted: boolean; version?: number; finished?: boolean; takeover?: boolean }> {
  const { data, error } = await supabase.rpc("dama_handle_turn_timeout", {
    p_room_id: roomId,
    p_expected_version: expectedVersion,
    p_auto_move: autoMove,
    p_next_state: nextState,
    p_result: result ?? null,
  });
  if (error) throw error;
  return data;
}

export async function leaveDamaMatch(roomId: string): Promise<{ success: boolean; winner_id?: string }> {
  const { data, error } = await supabase.rpc("dama_leave_match", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data;
}

export async function reclaimDamaSeat(roomId: string): Promise<{ success: boolean; color?: Side }> {
  const { data, error } = await supabase.rpc("dama_reclaim_seat", {
    p_room_id: roomId,
  });
  if (error) throw error;
  return data;
}
