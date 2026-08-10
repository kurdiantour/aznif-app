import type { ReactNode } from "react";
import { View } from "react-native";

import { getOkeyMeldAccessibilityLabel } from "@/okey/accessibility/okey-accessibility";
import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";

import { OkeyTileBack, OkeyTileFace } from "./OkeyTileFace";

export const TABLE_MELD_TILE_WIDTH = 18;
export const TABLE_MELD_TILE_HEIGHT = 24;
export const FOUR_TILE_SET_REVEAL = 12;

type TileLayout = {
  stacked: boolean;
  left: number;
  zIndex: number;
};

type Props = {
  meld: OkeyMeld;
  okeyTile: OkeyTile;
  tileWidth?: number;
  tileHeight?: number;
  stackReveal?: number;
  
  renderTile?: (
    tile: OkeyTile,
    tileIndex: number,
    layout: TileLayout,
  ) => ReactNode;
};

export function getOkeyMeldWidth(
  meld: OkeyMeld,
  tileWidth: number,
  stackReveal: number,
) {
  return meld.kind === "set" && meld.tiles.length === 4
    ? tileWidth + stackReveal * (meld.tiles.length - 1)
    : tileWidth * meld.tiles.length;
}

export function chunkOkeyMeldRows(
  melds: OkeyMeld[],
  maxMelds = melds.length,
) {
  const visibleMelds = melds.slice(0, maxMelds);

  return Array.from(
    {
      length: Math.ceil(visibleMelds.length / 2),
    },
    (_, rowIndex) =>
      visibleMelds.slice(
        rowIndex * 2,
        rowIndex * 2 + 2,
      ),
  );
}

export function OkeyMeldView({
  meld,
  okeyTile,
  tileWidth = TABLE_MELD_TILE_WIDTH,
  tileHeight = TABLE_MELD_TILE_HEIGHT,
  stackReveal = FOUR_TILE_SET_REVEAL,
  renderTile,
}: Props) {
  const stacked =
    meld.kind === "set" && meld.tiles.length === 4;

  const meldWidth = getOkeyMeldWidth(
    meld,
    tileWidth,
    stackReveal,
  );

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={getOkeyMeldAccessibilityLabel(
        meld,
        okeyTile,
      )}
      style={{
        position: "relative",
        width: meldWidth,
        height: tileHeight,
      }}
    >
      {meld.tiles.map((tile, tileIndex) => {
        const layout: TileLayout = {
          stacked,
          left: stacked
            ? tileIndex * stackReveal
            : tileIndex * tileWidth,
          zIndex: stacked
            ? meld.tiles.length - tileIndex
            : 1,
        };

        return (
          <View
            key={tile.id}
            style={{
              position: "absolute",
              left: layout.left,
              bottom: 0,
              width: tileWidth,
              height: tileHeight,
              zIndex: layout.zIndex,
              elevation: layout.zIndex,
            }}
          >
            {renderTile ? (
              renderTile(tile, tileIndex, layout)
            ) : tile.id === meld.lockedTileId ? (
              <OkeyTileBack
                small
                width={tileWidth}
                height={tileHeight}
              />
            ) : (
              <OkeyTileFace
                tile={tile}
                compact
                width={tileWidth}
                height={tileHeight}
                isWildcard={isOkeyWildcard(
                  tile,
                  okeyTile,
                )}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}