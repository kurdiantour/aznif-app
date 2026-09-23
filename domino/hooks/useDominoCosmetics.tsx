import {
  DEFAULT_DOMINO_SET_ID,
  getDominoSetAssets,
  type DominoSetAssets,
  type DominoSetId,
} from "@/constants/catalog/domino-sets";
import React, {
  createContext,
  useContext,
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
    isReady: true,
  });

export function DominoCosmeticsProvider({
  children,
}: {
  children: ReactNode;
  roomId?: string;
  mode?: DominoMode;
}) {
  const activeSetId = DEFAULT_DOMINO_SET_ID;

  return (
    <DominoCosmeticsContext.Provider
      value={{
        activeSetId,
        setAssets: getDominoSetAssets(activeSetId),
        isReady: true,
      }}
    >
      {children}
    </DominoCosmeticsContext.Provider>
  );
}

export function useDominoCosmetics() {
  return useContext(DominoCosmeticsContext);
}