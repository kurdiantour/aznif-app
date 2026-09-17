import React, {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import {
  DEFAULT_TABLE_ID,
  getOkeySetAssets,
  type OkeySetAssets,
  type TableId,
} from "@/constants/catalog/tables";
import { getPreloadedTableId } from "@/lib/game/gameLaunchPreload";

type OkeyCosmeticsContextValue = {
  activeTableId: TableId;
  setAssets: OkeySetAssets;
  isReady: boolean;
};

const DEFAULT_CONTEXT_VALUE: OkeyCosmeticsContextValue = {
  activeTableId: DEFAULT_TABLE_ID,
  setAssets: getOkeySetAssets(DEFAULT_TABLE_ID),
  isReady: true,
};

const OkeyCosmeticsContext = createContext<OkeyCosmeticsContextValue>(
  DEFAULT_CONTEXT_VALUE,
);

export function OkeyCosmeticsProvider({
  children,
  tableId,
}: {
  children: ReactNode;
  tableId?: TableId;
}) {
  const activeTableId = tableId ?? getPreloadedTableId();
  const setAssets = getOkeySetAssets(activeTableId);

  return (
    <OkeyCosmeticsContext.Provider
      value={{
        activeTableId,
        setAssets,
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
      isReady: true,
    };
  }

  return context;
}
