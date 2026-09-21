import {
  DEFAULT_DOMINO_SET_ID,
  getDominoSetAssets,
  isDominoSetId,
  type DominoSetAssets,
  type DominoSetId,
} from "@/constants/catalog/domino-sets";
import { useShopState } from "@/hooks/useShopState";
import { getDefaultItem, getEquippedItem } from "@/lib/shop-state";
import { useLockedMatchCosmetics } from "@/lib/multiplayer/cosmetics/useLockedMatchCosmetics";
import { DominoCosmeticsResolver } from "../multiplayer/cosmetics/dominoCosmeticsResolver";
import React, {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";

type DominoMode = "1v1" | "2v2";

type DominoCosmeticsContextValue = {
  activeSetId: DominoSetId;
  setAssets: DominoSetAssets;
  isReady: boolean;
};

const DominoCosmeticsContext =
  createContext<DominoCosmeticsContextValue>({
    activeSetId: DEFAULT_DOMINO_SET_ID,
    setAssets: getDominoSetAssets(DEFAULT_DOMINO_SET_ID),
    isReady: false,
  });

export function DominoCosmeticsProvider({
  children,
  roomId,
  mode = "1v1",
}: {
  children: ReactNode;
  roomId?: string;
  mode?: DominoMode;
}) {
  const personal = useShopState(!roomId);
  const resolve = useCallback(
    () => new DominoCosmeticsResolver(mode).resolveMatchCosmetics(roomId ?? ""),
    [mode, roomId],
  );
  const snapshot = useLockedMatchCosmetics(roomId ? `domino:${mode}:${roomId}` : undefined, resolve);
  const roomSetId = snapshot && isDominoSetId(snapshot.sharedSetAssetKey)
    ? snapshot.sharedSetAssetKey : DEFAULT_DOMINO_SET_ID;

  const personalKey =
    getEquippedItem(
      personal.state,
      "domino-skins",
    )?.asset_key;
  const defaultKey =
    getDefaultItem(
      personal.state,
      "domino-skins",
    )?.asset_key;

  const localKey =
    personalKey && isDominoSetId(personalKey)
      ? personalKey
      : defaultKey && isDominoSetId(defaultKey)
        ? defaultKey
        : DEFAULT_DOMINO_SET_ID;

  const activeSetId = roomId ? roomSetId : localKey;

  return (
    <DominoCosmeticsContext.Provider
      value={{
        activeSetId,
        setAssets: getDominoSetAssets(activeSetId),
        isReady: roomId ? snapshot !== null : !personal.loading,
      }}
    >
      {children}
    </DominoCosmeticsContext.Provider>
  );
}

export function useDominoCosmetics() {
  return useContext(DominoCosmeticsContext);
}
