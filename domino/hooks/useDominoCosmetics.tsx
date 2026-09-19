import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDominoSetAssets, isDominoSetId, type DominoSetAssets, type DominoSetId, DEFAULT_DOMINO_SET_ID } from "@/constants/catalog/domino-sets";
import { useShopState } from "@/hooks/useShopState";
import { getDefaultItem, getEquippedItem } from "@/lib/shop-state";
import { supabase } from "@/lib/supabase";

type DominoCosmeticsContextValue = {
  activeSetId: DominoSetId;
  setAssets: DominoSetAssets;
  isReady: boolean;
};
const DominoCosmeticsContext = createContext<DominoCosmeticsContextValue>({
  activeSetId: DEFAULT_DOMINO_SET_ID,
  setAssets: getDominoSetAssets(DEFAULT_DOMINO_SET_ID),
  isReady: false,
});

export function DominoCosmeticsProvider({ children, roomId }: { children: ReactNode; roomId?: string }) {
  const personal = useShopState(!roomId);
  const [roomSetId, setRoomSetId] = useState<DominoSetId>(DEFAULT_DOMINO_SET_ID);
  const [roomReady, setRoomReady] = useState(false);

  // Preserve the existing multiplayer path: a raw personal equip read on mount.
  // No room selection, opponent cosmetics or multiplayer RPC is changed here.
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    void supabase.from("user_equipped_shop_items").select("category, item_id").then(({ data }) => {
      if (!active) return;
      const id = data?.find((row) => row.category === "domino-skins")?.item_id;
      if (id && isDominoSetId(id)) setRoomSetId(id);
      setRoomReady(true);
    });
    return () => { active = false; };
  }, [roomId]);

  const personalKey = getEquippedItem(personal.state, "domino-skins")?.asset_key;
  const defaultKey = getDefaultItem(personal.state, "domino-skins")?.asset_key;
  const localKey = personalKey && isDominoSetId(personalKey) ? personalKey
    : defaultKey && isDominoSetId(defaultKey) ? defaultKey : DEFAULT_DOMINO_SET_ID;
  const activeSetId = roomId ? roomSetId : localKey;
  return (
    <DominoCosmeticsContext.Provider value={{
      activeSetId,
      setAssets: getDominoSetAssets(activeSetId),
      isReady: roomId ? roomReady : !personal.loading,
    }}>
      {children}
    </DominoCosmeticsContext.Provider>
  );
}

export function useDominoCosmetics() {
  return useContext(DominoCosmeticsContext);
}
