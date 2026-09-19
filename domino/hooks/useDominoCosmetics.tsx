import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDominoSetAssets, type DominoSetAssets, type DominoSetId, DEFAULT_DOMINO_SET_ID } from "@/constants/catalog/domino-sets";
import { getMyShopState } from "@/lib/shop";

type DominoCosmeticsContextValue = {
  activeSetId: DominoSetId;
  setAssets: DominoSetAssets;
  isReady: boolean;
};

const DEFAULT_CONTEXT_VALUE: DominoCosmeticsContextValue = {
  activeSetId: DEFAULT_DOMINO_SET_ID,
  setAssets: getDominoSetAssets(DEFAULT_DOMINO_SET_ID),
  isReady: false,
};

const DominoCosmeticsContext = createContext<DominoCosmeticsContextValue>(DEFAULT_CONTEXT_VALUE);

export function DominoCosmeticsProvider({ children }: { children: ReactNode }) {
  const [activeSetId, setActiveSetId] = useState<DominoSetId>(DEFAULT_DOMINO_SET_ID);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    getMyShopState().then((state) => {
      if (!active) return;
      const equippedId = state.equippedByCategory["domino-skins"] as DominoSetId | undefined;
      if (equippedId) {
        setActiveSetId(equippedId);
      }
      setIsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setAssets = getDominoSetAssets(activeSetId);

  return (
    <DominoCosmeticsContext.Provider value={{ activeSetId, setAssets, isReady }}>
      {children}
    </DominoCosmeticsContext.Provider>
  );
}

export function useDominoCosmetics() {
  return useContext(DominoCosmeticsContext);
}
