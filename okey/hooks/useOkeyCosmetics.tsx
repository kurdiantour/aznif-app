import type { OkeyRoomSnapshot } from "@/okey/multiplayer/okey-room-api";
import { useLockedMatchCosmetics } from "@/lib/multiplayer/cosmetics/useLockedMatchCosmetics";
import {
  DEFAULT_TABLE_ID,
  getOkeySetAssets,
  isTableId,
  type OkeySetAssets,
  type TableId,
} from "@/constants/catalog/okey-sets";
import { useShopState } from "@/hooks/useShopState";
import { getEquippedItem } from "@/lib/shop-state";
import {
  subscribeShopChanges,
} from "@/lib/shop";
import { AppState } from "react-native";
import { supabase } from "@/lib/supabase";
import { OkeyCosmeticsResolver } from "@/okey/multiplayer/cosmetics/okeyCosmeticsResolver";
import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type OkeyCosmeticsContextValue = {
  activeTableId: TableId;
  setAssets: OkeySetAssets;
  getPlayerAssets: (playerId?: string) => OkeySetAssets;
  isReady: boolean;
};

const DEFAULT_CONTEXT_VALUE: OkeyCosmeticsContextValue = {
  activeTableId: DEFAULT_TABLE_ID,
  setAssets: getOkeySetAssets(DEFAULT_TABLE_ID),
  getPlayerAssets: () => getOkeySetAssets(DEFAULT_TABLE_ID),
  isReady: true,
};

const OkeyCosmeticsContext = createContext<OkeyCosmeticsContextValue>(
  DEFAULT_CONTEXT_VALUE,
);

type ProviderProps = {
  children: ReactNode;
  tableId?: TableId;
  roomId?: string;
  requireSnapshot?: boolean;
  waitingRoom?: OkeyRoomSnapshot;
  currentUserId?: string | null;
};

export function OkeyCosmeticsProvider(props: ProviderProps) {
  return props.requireSnapshot && props.roomId ? (
    <LockedOkeyCosmeticsProvider roomId={props.roomId}>
      {props.children}
    </LockedOkeyCosmeticsProvider>
  ) : (
    <LiveOkeyCosmeticsProvider {...props} />
  );
}

function LockedOkeyCosmeticsProvider({
  children,
  roomId,
}: {
  children: ReactNode;
  roomId: string;
}) {
  const resolve = useCallback(
    () => new OkeyCosmeticsResolver().resolveMatchCosmetics(roomId),
    [roomId],
  );

  const snapshot = useLockedMatchCosmetics(
    `okey:${roomId}`,
    resolve,
  );

  const activeTableId =
    snapshot && isTableId(snapshot.sharedSetAssetKey)
      ? snapshot.sharedSetAssetKey
      : DEFAULT_TABLE_ID;

  return (
    <OkeyCosmeticsContext.Provider
      value={{
        activeTableId,
        setAssets: getOkeySetAssets(activeTableId),
        getPlayerAssets: (playerId) => {
          const key = playerId
            ? snapshot?.playerSetAssetKeys[playerId]
            : undefined;

          return getOkeySetAssets(
            key && isTableId(key)
              ? key
              : DEFAULT_TABLE_ID,
          );
        },
        isReady: snapshot !== null,
      }}
    >
      {children}
    </OkeyCosmeticsContext.Provider>
  );
}

function LiveOkeyCosmeticsProvider({
  children,
  tableId,
  roomId,
  waitingRoom,
  currentUserId,
}: {
  children: ReactNode;
  tableId?: TableId;
  roomId?: string;
  waitingRoom?: OkeyRoomSnapshot;
  currentUserId?: string | null;
}) {
  const personal = useShopState(!roomId && !tableId);
  const personalKey = getEquippedItem(personal.state, "tables")?.asset_key;
  const localKey = personalKey && isTableId(personalKey)
    ? personalKey
    : DEFAULT_TABLE_ID;

  const [liveSharedTableId, setLiveSharedTableId] =
    useState<TableId>(DEFAULT_TABLE_ID);

  const [playerResolution, setPlayerResolution] = useState<{
    roomId: string; tables: Record<string, TableId>; sharedTableId: TableId;
  } | null>(null);
  const resolutionRoomId = roomId ?? waitingRoom?.matchId;
  // Membership updates already arrive through the room lifecycle; no Waiting poll.
  const rosterKey = waitingRoom?.members.map(member => `${member.playerIndex}:${member.userId}`).sort().join("|");

  useEffect(() => {
    if (!resolutionRoomId) {
      setLiveSharedTableId(DEFAULT_TABLE_ID);
      setPlayerResolution(null);
      return;
    }

    let active = true;
    let generation = 0;

    const resolver = new OkeyCosmeticsResolver();

    const fetchResolution = async () => {
      const request = ++generation;

      const resolution =
        await resolver.resolveMatchCosmetics(resolutionRoomId);

      if (
        !active ||
        request !== generation ||
        !resolution
      ) {
        return;
      }

      setLiveSharedTableId(
        isTableId(resolution.sharedSetAssetKey)
          ? resolution.sharedSetAssetKey
          : DEFAULT_TABLE_ID,
      );

      const nextPlayerTables: Record<string, TableId> = {};

      for (
        const [playerId, assetKey] of Object.entries(
          resolution.playerSetAssetKeys,
        )
      ) {
        nextPlayerTables[playerId] =
          isTableId(assetKey)
            ? assetKey
            : DEFAULT_TABLE_ID;
      }

      setPlayerResolution({
        roomId: resolutionRoomId,
        tables: nextPlayerTables,
        sharedTableId: isTableId(resolution.sharedSetAssetKey)
          ? resolution.sharedSetAssetKey : DEFAULT_TABLE_ID,
      });
    };

    void fetchResolution();

    const poll = roomId ? setInterval(() => {
      if (AppState.currentState === "active") {
        void fetchResolution();
      }
    }, 5_000) : undefined;

    const unsubscribeShop = subscribeShopChanges(() => {
      void fetchResolution();
    });

    const app = AppState.addEventListener(
      "change",
      (status) => {
        if (status === "active") {
          void fetchResolution();
        }
      },
    );

    const realtimeChannel = roomId ? supabase
      .channel(`okey-room:${roomId}`)
      .on(
        "broadcast",
        { event: "invalidate" },
        () => {
          if (active) {
            void fetchResolution();
          }
        },
      )
      .subscribe() : null;

    return () => {
      active = false;
      generation += 1;

      clearInterval(poll);
      unsubscribeShop();
      app.remove();

      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
    };
  }, [roomId, resolutionRoomId, rosterKey]);

  const waitingSharedTableId = waitingRoom && playerResolution?.roomId === waitingRoom.matchId
    ? playerResolution.sharedTableId
    : localKey;
  const activeTableId =
    tableId ??
    (roomId ? liveSharedTableId : waitingSharedTableId);

  const setAssets = getOkeySetAssets(activeTableId);

  const getPlayerAssets = (playerId?: string) => {
    if (!roomId && !waitingRoom) return setAssets;
    if (waitingRoom && playerId === currentUserId) return getOkeySetAssets(localKey);
    if (waitingRoom && !waitingRoom.members.some(member => member.userId === playerId)) {
      return getOkeySetAssets(DEFAULT_TABLE_ID);
    }

    if (!playerId) {
      return getOkeySetAssets(DEFAULT_TABLE_ID);
    }

    const playerTableId = playerResolution && playerResolution.roomId === resolutionRoomId
      ? playerResolution.tables[playerId]
      : undefined;

    return getOkeySetAssets(
      playerTableId && isTableId(playerTableId)
        ? playerTableId
        : DEFAULT_TABLE_ID,
    );
  };

  return (
    <OkeyCosmeticsContext.Provider
      value={{
        activeTableId,
        setAssets,
        getPlayerAssets,
        isReady: true,
      }}
    >
      {children}
    </OkeyCosmeticsContext.Provider>
  );
}

export function useOkeyCosmetics(
  overrideTableId?: TableId,
): OkeyCosmeticsContextValue {
  const context = useContext(OkeyCosmeticsContext);

  if (overrideTableId) {
    return {
      activeTableId: overrideTableId,
      setAssets: getOkeySetAssets(overrideTableId),
      getPlayerAssets: () =>
        getOkeySetAssets(overrideTableId),
      isReady: true,
    };
  }

  return context;
}