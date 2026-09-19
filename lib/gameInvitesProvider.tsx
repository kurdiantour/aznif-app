import { GameInvitePopup } from "@/components/friends/GameInvitePopup";
import {
  cancelMyGameParty,
  getMyDominoParty,
  type DominoParty,
} from "@/lib/dominoParty";
import { useProfile } from "@/lib/profile";
import { usePathname, useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";

import {
  getPendingGameInvites,
  respondGameInvite,
  type GameInvite,
} from "./gameInvites";
import { supabase } from "./supabase";

type GamePartyContextValue = {
  party: DominoParty | null;
  refreshParty: () => Promise<DominoParty | null>;
  cancelParty: () => Promise<void>;
  cancellingParty: boolean;
  partyError: string | null;
};

const GamePartyContext = createContext<GamePartyContextValue | null>(null);

export function GameInvitesProvider({ children }: PropsWithChildren) {
  const { profile } = useProfile();
  const pathname = usePathname();
  const router = useRouter();

  const [invites, setInvites] = useState<GameInvite[]>([]);
  const [party, setParty] = useState<DominoParty | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cancellingParty, setCancellingParty] = useState(false);
  const [partyError, setPartyError] = useState<string | null>(null);

  const refreshInvites = useCallback(async () => {
    if (!profile?.id) {
      setInvites([]);
      return;
    }

    try {
      setInvites(await getPendingGameInvites());
    } catch (reason) {
      console.warn("Unable to load game invites", reason);
    }
  }, [profile?.id]);

  const refreshParty = useCallback(async () => {
    if (!profile?.id) {
      setParty(null);
      return null;
    }

    try {
      const nextParty = await getMyDominoParty();
      setParty(nextParty);
      return nextParty;
    } catch (reason) {
      console.warn("Unable to load Domino party", reason);
      return null;
    }
  }, [profile?.id]);

  const followPartyFlow = useCallback(
    (nextParty: DominoParty | null) => {
      if (!profile?.id || !nextParty || nextParty.leaderId === profile.id) {
        return;
      }

      if (
        nextParty.flowStatus !== "matchmaking" ||
        !nextParty.currentRoomId ||
        !nextParty.currentCurrency ||
        nextParty.currentEntryFee == null
      ) {
        return;
      }

      if (nextParty.currentGame === "okey") {
        if (
          !nextParty.currentTableId ||
          pathname.startsWith("/okey/game")
        ) {
          return;
        }

        router.replace({
          pathname: "/okey/game",
          params: {
            mode: nextParty.currentCurrency,
            table: nextParty.currentTableId,
            tableId: nextParty.currentTableId,
            matchId: nextParty.currentRoomId,
          },
        });

        return;
      }

      if (
        !nextParty.currentMode ||
        pathname.startsWith("/domino/matchmaking") ||
        pathname.startsWith("/domino/game")
      ) {
        return;
      }

      router.replace({
        pathname: "/domino/matchmaking",
        params: {
          mode: nextParty.currentMode,
          matchmaking_status: "searching",
          room_id: nextParty.currentRoomId,
          matchType: "squad",
          playMode: nextParty.currentCurrency,
          entryFee: String(nextParty.currentEntryFee),
        },
      });
    },
    [pathname, profile?.id, router],
  );

  useEffect(() => {
    if (!profile?.id) return;

    void refreshInvites();

    void refreshParty().then((nextParty) => {
      if (
        nextParty &&
        Date.now() - Date.parse(nextParty.updatedAt) <= 30_000
      ) {
        followPartyFlow(nextParty);
      }
    });

    const channel = supabase
      .channel(`game-invites:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_invites",
        },
        () => {
          void refreshInvites();
          void refreshParty().then(followPartyFlow);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    followPartyFlow,
    profile?.id,
    refreshInvites,
    refreshParty,
  ]);

  useEffect(() => {
    if (!profile?.id || !party?.id) return;

    const channel = supabase
      .channel(`domino-party:${party.id}:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "domino_parties",
          filter: `id=eq.${party.id}`,
        },
        () => {
          void refreshParty().then(followPartyFlow);
        },
      )
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;

        void refreshParty().then((nextParty) => {
          if (
            nextParty &&
            Date.now() - Date.parse(nextParty.updatedAt) <= 30_000
          ) {
            followPartyFlow(nextParty);
          }
        });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    followPartyFlow,
    party?.id,
    profile?.id,
    refreshParty,
  ]);

  const cancelParty = useCallback(async () => {
    if (cancellingParty) return;

    setCancellingParty(true);
    setPartyError(null);

    try {
      await cancelMyGameParty();

      setParty(null);

      await Promise.all([
        refreshParty(),
        refreshInvites(),
      ]);
    } catch (reason) {
      setPartyError(
        reason instanceof Error
          ? reason.message
          : "نەتوانرا پارتی هەڵبوەشێندرێتەوە.",
      );

      await refreshParty();
    } finally {
      setCancellingParty(false);
    }
  }, [
    cancellingParty,
    refreshInvites,
    refreshParty,
  ]);

  const respond = async (accept: boolean) => {
    const invite = invites[0];

    if (!invite) return;

    setBusy(true);
    setError(null);

    try {
      await respondGameInvite(invite.id, accept);

      setInvites((current) =>
        current.filter((item) => item.id !== invite.id),
      );

      await refreshParty();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to respond to the game invite.",
      );

      void refreshInvites();
    } finally {
      setBusy(false);
    }
  };

  const expireCurrentInvite = useCallback(() => {
    const invite = invites[0];

    if (!invite) return;

    setInvites((current) =>
      current.filter((item) => item.id !== invite.id),
    );

    setError(null);

    void refreshInvites();
  }, [invites, refreshInvites]);

  return (
    <GamePartyContext.Provider
      value={{
        party,
        refreshParty,
        cancelParty,
        cancellingParty,
        partyError,
      }}
    >
      {children}

      <GameInvitePopup
        invite={invites[0] ?? null}
        busy={busy}
        error={error}
        onAccept={() => void respond(true)}
        onDecline={() => void respond(false)}
        onExpire={expireCurrentInvite}
      />
    </GamePartyContext.Provider>
  );
}

export function useGameParty() {
  const context = useContext(GamePartyContext);

  if (!context) {
    throw new Error(
      "useGameParty must be used within GameInvitesProvider",
    );
  }

  return context;
}