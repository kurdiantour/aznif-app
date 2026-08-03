import { supabase } from "@/lib/supabase";

export type OkeyRoomMember = {
  userId: string;
  playerIndex: number;
  teamId: "teamA" | "teamB";
  displayName: string;
  avatarUrl: string | null;
  connected: boolean;
};

export type OkeyRoomSnapshot = {
  matchId: string;
  roomCode: string;
  tableId: string;
  status: "waiting" | "playing" | "finished" | "cancelled";
  version: number;
  memberCount: number;
  connectedCount: number;
  confirmedCount: number;
  countdownEndsAt: string | null;
  shouldStart: boolean;
  members: OkeyRoomMember[];
};

async function roomAction(body: Record<string, unknown>): Promise<OkeyRoomSnapshot> {
  const { data, error } = await supabase.functions.invoke("okey_room", { body });
  if (error) throw error;
  if (!data?.room) throw new Error("okey_room_response_invalid");
  return data.room as OkeyRoomSnapshot;
}

export const matchmakeOkeyRoom = (tableId: string) => roomAction({ action: "matchmake", tableId });
export const getOkeyRoomStatus = (matchId: string) => roomAction({ action: "status", matchId });
export const reconnectOkeyRoom = (matchId: string) => roomAction({ action: "reconnect", matchId });
export const leaveOkeyRoom = (matchId: string) => roomAction({ action: "leave", matchId });

export function subscribeOkeyRoom(
  matchId: string,
  listener: (room: OkeyRoomSnapshot) => void,
) {
  let active = true;
  let refreshInFlight: Promise<void> | null = null;
  const refresh = () => {
    if (!active || refreshInFlight) return refreshInFlight;
    refreshInFlight = getOkeyRoomStatus(matchId)
      .then((room) => {
        if (active) listener(room);
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };
  const channel = supabase
    .channel(`okey-room:${matchId}`)
    .on("broadcast", { event: "invalidate" }, () => void refresh())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void refresh();
    });

  const heartbeat = setInterval(() => void refresh(), 1_500);

  return () => {
    active = false;
    clearInterval(heartbeat);
    void supabase.removeChannel(channel);
  };
}

