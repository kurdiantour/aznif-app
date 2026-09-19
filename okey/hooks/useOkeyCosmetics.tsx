import { useShopState } from "@/hooks/useShopState";
import { getDefaultItem, getEquippedItem } from "@/lib/shop-state";
import { supabase } from "@/lib/supabase";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_TABLE_ID,
  getOkeySetAssets,
  isTableId,
  type OkeySetAssets,
  type TableId,
} from "@/constants/catalog/okey-sets";
import { getPreloadedTableId } from "@/lib/game/gameLaunchPreload";

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

export function OkeyCosmeticsProvider({
  children,
  tableId,
  roomId,
}: {
  children: ReactNode;
  tableId?: TableId;
  roomId?: string;
}) {
  const personal = useShopState(!roomId && !tableId);
  const personalKey = getEquippedItem(personal.state, "tables")?.asset_key;
  const defaultKey = getDefaultItem(personal.state, "tables")?.asset_key;
  const localKey = personalKey && isTableId(personalKey) ? personalKey
    : defaultKey && isTableId(defaultKey) ? defaultKey : DEFAULT_TABLE_ID;
  const activeTableId = tableId ?? (roomId ? getPreloadedTableId() : localKey);
  const setAssets = getOkeySetAssets(activeTableId);
  const [playerTables, setPlayerTables] = useState<Record<string, TableId>>({});

  useEffect(() => {
    if (!roomId) return;
    let active = true;

    supabase.rpc("get_multiplayer_room_cosmetics", {
      p_room_id: roomId,
      p_mode: "2v2", // Okey is always 2v2 under the hood in the DB schema for now
    }).then(({ data, error }) => {
      if (!active || error) return;
      if (data && typeof data === "object" && data.playerTables) {
        setPlayerTables(data.playerTables as Record<string, TableId>);
      }
    });

    return () => {
      active = false;
    };
  }, [roomId]);

  const getPlayerAssets = (playerId?: string) => {
    if (!playerId) return getOkeySetAssets(DEFAULT_TABLE_ID);
    const pTableId = playerTables[playerId];
    return pTableId && isTableId(pTableId) ? getOkeySetAssets(pTableId) : getOkeySetAssets(DEFAULT_TABLE_ID);
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
      getPlayerAssets: () => getOkeySetAssets(overrideTableId),
      isReady: true,
    };
  }

  return context;
}
