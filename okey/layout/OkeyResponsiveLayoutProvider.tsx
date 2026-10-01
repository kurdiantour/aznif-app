import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CENTER_PILES_TOP_PCT,
  RACK_ASPECT_RATIO,
} from "./uiPositions";

export type OkeySafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type OkeyViewport = {
  width: number;
  height: number;
  insets?: Partial<OkeySafeAreaInsets>;
};

export type OkeyLayoutClass =
  | "compact"
  | "regular"
  | "tablet";

export type OkeyMeldPosition =
  | "top"
  | "left"
  | "right"
  | "bottom";

export type OkeySeatPosition =
  | "top"
  | "left"
  | "right";

export type OkeyResponsiveLayout = {
  layoutClass: OkeyLayoutClass;
  usableWidth: number;
  usableHeight: number;
  screen: ViewStyle;
  topActions: ViewStyle;
  scoreBoard: ViewStyle;
  seats: Record<OkeySeatPosition, ViewStyle>;
  meldAreas: Record<OkeyMeldPosition, ViewStyle>;
  centerPiles: ViewStyle;
  rackWrap: ViewStyle;
  playerRack: ViewStyle;
  playerSetScoreWrap: ViewStyle;
};

const DEFAULT_VIEWPORT = {
  width: 844,
  height: 390,
};

const clamp = (
  value: number,
  minimum: number,
  maximum: number,
) => Math.min(maximum, Math.max(minimum, value));

export function createOkeyResponsiveLayout({
  width,
  height,
  insets = {},
}: OkeyViewport): OkeyResponsiveLayout {
  const safe = {
    top: Math.max(0, insets.top ?? 0),
    right: Math.max(0, insets.right ?? 0),
    bottom: Math.max(0, insets.bottom ?? 0),
    left: Math.max(0, insets.left ?? 0),
  };

  const usableWidth = Math.max(
    320,
    width - safe.left - safe.right,
  );

  const usableHeight = Math.max(
    240,
    height - safe.top - safe.bottom,
  );

  const layoutClass: OkeyLayoutClass =
    usableWidth >= 1000 || usableHeight >= 600
      ? "tablet"
      : usableWidth < 700 || usableHeight < 350
      ? "compact"
      : "regular";

  const edge =
    layoutClass === "compact"
      ? 8
      : layoutClass === "tablet"
      ? 20
      : 12;

  const sideSeatInset =
    layoutClass === "compact"
      ? -34
      : layoutClass === "tablet"
      ? 4
      : -20;

  const widthRatio =
    layoutClass === "compact"
      ? 0.9
      : layoutClass === "tablet"
      ? 0.78
      : 0.84;

  const maxRackWidth =
    layoutClass === "compact"
      ? 560
      : layoutClass === "tablet"
      ? 820
      : 595;

  /*
   * Rack sizing is constrained by both viewport width and height.
   * This prevents short/wide phones from producing an oversized rack
   * while keeping the same visual proportions on taller devices.
   */
  const rackWidthFromScreen =
    usableWidth * widthRatio;

  const maxRackHeight =
    layoutClass === "compact"
      ? usableHeight * 0.52
      : layoutClass === "tablet"
      ? usableHeight * 0.48
      : usableHeight * 0.5;

  const rackWidthFromHeight =
    maxRackHeight * RACK_ASPECT_RATIO;

  const rackWidth = Math.min(
    rackWidthFromScreen,
    rackWidthFromHeight,
    maxRackWidth,
  );

  const rackHeight = Math.round(
    rackWidth / RACK_ASPECT_RATIO,
  );

  /*
   * The player rack is anchored directly to the bottom
   * of the game surface on every device.
   */
  const rackBottom = 8;

  const centerPilesTop = clamp(
    usableHeight * CENTER_PILES_TOP_PCT,
    92,
    250,
  );

  return {
    layoutClass,
    usableWidth,
    usableHeight,

    /*
     * Do not push the entire game table upward using
     * the bottom safe-area inset.
     *
     * Individual UI elements that require safe-area protection
     * can handle it independently.
     */
    screen: {
      paddingLeft: safe.left + edge,
      paddingRight: safe.right + edge,
      paddingTop: safe.top + edge,
      paddingBottom: 0,
    },

    topActions: {
      top: safe.top + edge,
      right: safe.right + edge,
    },

    scoreBoard: {
      top: safe.top + edge,
      left: safe.left + edge,
    },

    seats: {
      top: {
        top: edge,
        alignSelf: "center",
      },

      left: {
        left: sideSeatInset,
        top: "42%",
      },

      right: {
        right: sideSeatInset,
        top: "42%",
      },
    },

    meldAreas: {
      top: {
        position: "absolute",
        left: 100,
        top: 70,
        width: clamp(
          usableWidth / 2 - 70 - edge,
          80,
          150,
        ),
        minHeight: 54,
      },

      left: {
        position: "absolute",
        left: 100,
        bottom: 130,
        width: clamp(
          usableWidth / 2 - 70 - edge,
          80,
          150,
        ),
        minHeight: 54,
      },

      right: {
        position: "absolute",
        right: 100,
        top: 70,
        width: clamp(
          usableWidth / 2 - 70 - edge,
          80,
          150,
        ),
        minHeight: 54,
      },

      bottom: {
        position: "absolute",
        right: 100,
        bottom: 130,
        width: clamp(
          usableWidth / 2 - edge * 2,
          80,
          150,
        ),
        minHeight: 54,
      },
    },

    centerPiles: {
      top: centerPilesTop,
      height: clamp(
        usableHeight * 0.31,
        104,
        180,
      ),
      gap: clamp(
        usableWidth * 0.065,
        30,
        76,
      ),
    },

    rackWrap: {
      bottom: rackBottom,
      height: rackHeight,
    },

    playerRack: {
      width: rackWidth,
      height: rackHeight,
    },

    playerSetScoreWrap: {
      right: safe.right + edge,
      bottom:
        rackBottom +
        clamp(rackHeight * 0.08, 4, 10),
    },
  };
}

const DEFAULT_OKEY_RESPONSIVE_LAYOUT =
  createOkeyResponsiveLayout(DEFAULT_VIEWPORT);

const OkeyResponsiveLayoutContext =
  createContext(
    DEFAULT_OKEY_RESPONSIVE_LAYOUT,
  );

export function OkeyResponsiveLayoutProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const layout = useMemo(
    () =>
      createOkeyResponsiveLayout({
        width,
        height,
        insets,
      }),
    [
      width,
      height,
      insets.top,
      insets.right,
      insets.bottom,
      insets.left,
    ],
  );

  return (
    <OkeyResponsiveLayoutContext.Provider value={layout}>
      {children}
    </OkeyResponsiveLayoutContext.Provider>
  );
}

export function useOkeyResponsiveLayout() {
  return useContext(OkeyResponsiveLayoutContext);
}