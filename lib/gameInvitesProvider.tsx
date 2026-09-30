import { GameInvitePopup } from "@/components/friends/GameInvitePopup";
import { cancelMyGameParty, getMyGameParty, type GameParty } from "./gameParty";
import { getAuthState, hasReadySession, subscribeAuthState, useAuthState } from "./auth-state";
import { usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { getPendingGameInvites, respondGameInvite, type GameInvite } from "./gameInvites";
import { supabase } from "./supabase";
import { getCachedShopState, getMyShopState } from "./shop";

type GamePartyContextValue = {
  party: GameParty | null;
  refreshParty: () => Promise<GameParty | null>;
  cancelParty: () => Promise<void>;
  cancellingParty: boolean;
  partyError: string | null;
};
const GamePartyContext = createContext<GamePartyContextValue | null>(null);
type Snapshot = { generation: number; party: GameParty | null; invites: GameInvite[]; live: boolean; revision: number; navigable: boolean };
type Operation = { generation: number; kind: "respond" | "cancel"; busy: boolean; error: string | null };

export function GameInvitesProvider({ children }: PropsWithChildren) {
  const auth = useAuthState();
  const ready = hasReadySession(auth);
  const pathname = usePathname();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const epoch = useRef(0);
  const pending = useRef<{ generation: number; promise: Promise<GameParty | null> } | null>(null);
  const mutation = useRef<object | null>(null);
  const dirty = useRef(false);
  const live = useRef(false);
  const handled = useRef(new Map<string, number>());
  const current = useCallback(() => mounted.current && getAuthState().generation === auth.generation, [auth.generation]);
  const party = snapshot?.generation === auth.generation ? snapshot.party : null;
  const invites = snapshot?.generation === auth.generation && ready ? snapshot.invites : [];
  const ownOperation = operation?.generation === auth.generation ? operation : null;

  // One shared queue: events during a read schedule a trailing read, never a parallel one.
  const refresh = useCallback((invalidate = false, fromEvent = invalidate): Promise<GameParty | null> => {
    if (!current() || !hasReadySession()) return Promise.resolve(null);
    if (invalidate) { revision.current++; dirty.current = true; live.current = live.current || fromEvent; }
    if (mutation.current) { dirty.current = true; return Promise.resolve(null); }
    if (pending.current?.generation === auth.generation) return pending.current.promise;
    const requestEpoch = epoch.current;
    const valid = () => current() && epoch.current === requestEpoch;
    const promise = Promise.resolve().then(async () => {
      let result: GameParty | null = null;
      do {
        if (!valid() || !hasReadySession() || mutation.current) return null;
        dirty.current = false;
        const request = revision.current;
        const eventDriven = live.current;
        live.current = false;
        try {
          // Wait for both reads, even if one fails, so a trailing refresh cannot overlap it.
          const [invitesResult, partyResult] = await Promise.allSettled([getPendingGameInvites(), getMyGameParty()]);
          if (!valid() || !hasReadySession()) return null;
          if (request !== revision.current) continue;
          let nextParty = partyResult.status === "fulfilled" ? partyResult.value : undefined;
          if (invitesResult.status === "rejected") console.warn("Unable to load game invites", invitesResult.reason);
          if (partyResult.status === "rejected") console.warn("Unable to load party", partyResult.reason);
          if (nextParty?.currentGame === "okey" && nextParty.flowStatus === "matchmaking" && !getCachedShopState(auth.userId)) {
            try { await getMyShopState(); }
            catch (error) {
              if (valid()) console.warn("Unable to preload party cosmetics", error);
              nextParty = undefined;
            }
          }
          if (!valid() || !hasReadySession()) return null;
          if (request !== revision.current) continue;
          result = nextParty && nextParty.members.some(member => member.userId === auth.userId) ? nextParty : null;
          const nextInvites = invitesResult.status === "fulfilled"
            ? invitesResult.value.filter(invite => invite.recipientId === auth.userId && invite.status === "pending" && Date.parse(invite.expiresAt) > Date.now())
            : undefined;
          const nextSnapshotParty = result;
          setSnapshot(previous => ({
            generation: auth.generation,
            party: nextParty !== undefined ? nextSnapshotParty : previous?.generation === auth.generation ? previous.party : null,
            invites: nextInvites ?? (previous?.generation === auth.generation ? previous.invites : []),
            live: eventDriven,
            revision: request,
            navigable: nextParty !== undefined,
          }));
        } catch (error) {
          if (!valid()) return null;
          console.warn("Unable to refresh game invites/party", error);
        }
      } while (dirty.current && valid());
      return result;
    }).finally(() => { if (pending.current?.promise === promise) pending.current = null; });
    pending.current = { generation: auth.generation, promise };
    return promise;
  }, [auth.generation, auth.userId, current]);
  const refreshParty = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    mounted.current = true;
    let observed = getAuthState();
    const unsubscribe = subscribeAuthState(() => {
      const next = getAuthState();
      if (next.userId !== observed.userId) handled.current.clear();
      if (next.generation !== observed.generation || !hasReadySession(next)) {
        epoch.current++;
        revision.current++;
        pending.current = null;
        dirty.current = false;
        live.current = false;
        if (next.generation !== observed.generation) mutation.current = null;
      }
      observed = next;
    });
    const invalidateOnUnmount = () => {
      mounted.current = false;
      epoch.current++;
      revision.current++;
      pending.current = null;
      unsubscribe();
    };
    return invalidateOnUnmount;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void refresh();
    const channel = supabase.channel(`game-invites:${auth.userId}:${auth.generation}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_invites", filter: `recipient_id=eq.${auth.userId}` }, () => {
        if (active && current()) void refresh(true);
      }).on("postgres_changes", { event: "*", schema: "public", table: "game_invites", filter: `sender_id=eq.${auth.userId}` }, () => {
        if (active && current()) void refresh(true);
      }).subscribe((status: string) => {
        if (status === "SUBSCRIBED" && active && current()) void refresh(true, false);
      });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [ready, auth.userId, auth.generation, current, refresh]);

  useEffect(() => {
    if (!ready || !party?.id) return;
    let active = true;
    const channel = supabase.channel(`domino-party:${party.id}:${auth.userId}:${auth.generation}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "domino_parties", filter: `id=eq.${party.id}` }, () => {
        if (active && current()) void refresh(true);
      }).subscribe((status: string) => {
        if (status === "SUBSCRIBED" && active && current()) void refresh(true, false);
      });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [ready, party?.id, auth.userId, auth.generation, current, refresh]);

  useEffect(() => {
    if (!ready || !hasReadySession() || !current() || mutation.current || dirty.current || !snapshot?.navigable || snapshot.revision !== revision.current || !party || !party.members.some(member => member.userId === auth.userId) || party.leaderId === auth.userId) return;
    if (party.flowStatus !== "matchmaking" || !party.currentRoomId || !party.currentCurrency || !Number.isFinite(party.currentEntryFee) || party.currentEntryFee === null || party.currentEntryFee < 0) return;
    if (!Number.isSafeInteger(party.commandVersion) || party.commandVersion < 0) return;
    const age = Date.now() - Date.parse(party.updatedAt);
    if (!Number.isFinite(age) || age < 0 || (!snapshot?.live && age > 30_000)) return;
    if ((handled.current.get(party.id) ?? -1) >= party.commandVersion) return;
    if (party.currentGame === "okey") {
      if (!party.currentTableId || pathname.startsWith("/okey/game")) return;
      handled.current.set(party.id, party.commandVersion);
      router.replace({ pathname: "/okey/game", params: { mode: party.currentCurrency, table: party.currentTableId, tableId: party.currentTableId, matchId: party.currentRoomId } });
    } else if (party.currentGame === "domino") {
      if (!party.currentMode || pathname.startsWith("/domino/matchmaking") || pathname.startsWith("/domino/game")) return;
      handled.current.set(party.id, party.commandVersion);
      router.replace({ pathname: "/domino/matchmaking", params: { mode: party.currentMode, matchmaking_status: "searching", room_id: party.currentRoomId, matchType: "squad", playMode: party.currentCurrency, entryFee: String(party.currentEntryFee) } });
    }
  }, [ready, current, party, auth.userId, snapshot?.live, snapshot?.revision, snapshot?.navigable, pathname, router]);

  const runMutation = useCallback(async (kind: Operation["kind"], action: () => Promise<unknown>, inviteId?: string) => {
    if (!current() || !hasReadySession() || mutation.current) return;
    const token = {};
    mutation.current = token;
    revision.current++;
    setOperation({ generation: auth.generation, kind, busy: true, error: null });
    try {
      await action();
      if (!current()) return;
      setSnapshot(previous => previous?.generation === auth.generation ? { ...previous, party: kind === "cancel" ? null : previous.party, invites: kind === "respond" ? previous.invites.filter(item => item.id !== inviteId) : previous.invites } : previous);
    } catch (cause) {
      if (current()) setOperation({ generation: auth.generation, kind, busy: false, error: cause instanceof Error ? cause.message : "Unable to update party." });
    } finally {
      if (mutation.current === token) mutation.current = null;
      if (current()) {
        setOperation(previous => previous?.generation === auth.generation ? { ...previous, busy: false } : previous);
        void refresh(true);
      }
    }
  }, [auth.generation, current, refresh]);
  const cancelParty = useCallback(() => runMutation("cancel", cancelMyGameParty), [runMutation]);
  const invite = invites[0] ?? null;
  const respond = (accept: boolean) => {
    if (!invite || Date.parse(invite.expiresAt) <= Date.now()) return;
    void runMutation("respond", () => respondGameInvite(invite.id, accept), invite.id);
  };
  const expire = useCallback(() => {
    if (!current() || !invite) return;
    setSnapshot(previous => previous?.generation === auth.generation ? { ...previous, invites: previous.invites.filter(item => item.id !== invite.id) } : previous);
    void refresh(true);
  }, [auth.generation, current, invite, refresh]);

  return <GamePartyContext.Provider value={{ party, refreshParty, cancelParty, cancellingParty: ownOperation?.kind === "cancel" && ownOperation.busy, partyError: ownOperation?.kind === "cancel" ? ownOperation.error : null }}>
    {children}
    <GameInvitePopup key={`${auth.generation}:${invite?.id ?? "none"}`} invite={invite} busy={ownOperation?.busy ?? false} error={ownOperation?.kind === "respond" ? ownOperation.error : null} onAccept={() => respond(true)} onDecline={() => respond(false)} onExpire={expire} />
  </GamePartyContext.Provider>;
}
export function useGameParty() {
  const context = useContext(GamePartyContext);
  if (!context) throw new Error("useGameParty must be used within GameInvitesProvider");
  return context;
}
