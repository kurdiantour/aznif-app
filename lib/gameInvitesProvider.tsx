import { GameInvitePopup } from "@/components/friends/GameInvitePopup";
import { useProfile } from "@/lib/profile";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, type PropsWithChildren } from "react";
import { getPendingGameInvites, respondGameInvite, type GameInvite } from "./gameInvites";
import { supabase } from "./supabase";

export function GameInvitesProvider({ children }: PropsWithChildren) {
  const { profile } = useProfile();
  const router = useRouter();
  const [invites, setInvites] = useState<GameInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.id) return setInvites([]);
    try { setInvites(await getPendingGameInvites()); }
    catch (reason) { console.warn("Unable to load game invites", reason); }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    void refresh();
    const channel = supabase
      .channel(`game-invites:${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_invites" }, (payload: any) => {
        const row = payload.new;
        if (row?.sender_id === profile.id && row.status === "accepted" && row.room_id) {
          router.replace({ pathname: "/domino/matchmaking", params: { mode: "1v1", matchmaking_status: "matched", room_id: row.room_id, matchType: "duo" } });
        }
        void refresh();
      })
      .subscribe();
    const fallback = setInterval(() => void refresh(), 10_000);
    return () => { clearInterval(fallback); void supabase.removeChannel(channel); };
  }, [profile?.id, refresh, router]);

  const respond = async (accept: boolean) => {
    const invite = invites[0];
    if (!invite) return;
    setBusy(true); setError(null);
    try {
      const result = await respondGameInvite(invite.id, accept);
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      if (accept && result.room_id) {
        router.replace({ pathname: "/domino/matchmaking", params: { mode: "1v1", matchmaking_status: "matched", room_id: result.room_id, matchType: "duo" } });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "نەتوانرا بانگهێشتەکە وەڵام بدرێتەوە.");
      void refresh();
    } finally { setBusy(false); }
  };

  return <>{children}<GameInvitePopup invite={invites[0] ?? null} busy={busy} error={error} onAccept={() => void respond(true)} onDecline={() => void respond(false)} /></>;
}
