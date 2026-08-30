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
  internalLock?: boolean;

  renderTile?: (
    tile: OkeyTile,
    tileIndex: number,
    layout: TileLayout,
  ) => ReactNode;
};

export function getOkeyMeldWidth(
  meld: OkeyMeld,
  tileWidth: number,
  stackReveal = FOUR_TILE_SET_REVEAL,
  tileHeight = tileWidth * (TABLE_MELD_TILE_HEIGHT / TABLE_MELD_TILE_WIDTH),
  internalLock = false,
) {
  const lockedTileIndex = meld.tiles.findIndex((tile) => tile.id === meld.lockedTileId);
  if (lockedTileIndex === 0 || lockedTileIndex === meld.tiles.length - 1) {
    const exposedHorizontalWidth = internalLock
      ? tileHeight - tileWidth / 2
      : tileHeight / 2;
    return tileWidth * (meld.tiles.length - 1) + exposedHorizontalWidth;
  }
  if (meld.kind === "set" && meld.tiles.length === 4) {
    return tileWidth + stackReveal * (meld.tiles.length - 1);
  }

  return tileWidth * meld.tiles.length;
}

export function getOkeyMeldTileLayout(
  meld: OkeyMeld,
  tileIndex: number,
  tileWidth: number,
  stackReveal = FOUR_TILE_SET_REVEAL,
  tileHeight = tileWidth * (TABLE_MELD_TILE_HEIGHT / TABLE_MELD_TILE_WIDTH),
  internalLock = false,
): TileLayout {
  const lockedTileIndex = meld.tiles.findIndex((tile) => tile.id === meld.lockedTileId);
  const overlapsLockedTile = lockedTileIndex === 0 || lockedTileIndex === meld.tiles.length - 1;
  const fourTileSet = meld.kind === "set" && meld.tiles.length === 4;
  if (fourTileSet && !overlapsLockedTile) {
    return { stacked: true, left: tileIndex * stackReveal, zIndex: meld.tiles.length - tileIndex };
  }
  if (overlapsLockedTile) {
    const lockedOverlap = internalLock ? tileWidth / 2 : tileHeight / 2;
    const leadingOffset = tileHeight - lockedOverlap;
    const rotationInset = (tileHeight - tileWidth) / 2;
    const lockedAtStart = lockedTileIndex === 0;
    const locked = tileIndex === lockedTileIndex;

    return {
      stacked: locked || Math.abs(tileIndex - lockedTileIndex) === 1,
      left: locked
        ? lockedAtStart
          ? rotationInset
          : tileIndex * tileWidth - lockedOverlap + rotationInset
        : lockedAtStart
          ? leadingOffset + (tileIndex - 1) * tileWidth
          : tileIndex * tileWidth,
      zIndex: locked ? meld.tiles.length + 1 : 1,
    };
  }

  return {
    stacked: false,
    left: tileIndex * tileWidth,
    zIndex: 1,
  };
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
  internalLock = false,
}: Props) {
  const meldWidth = getOkeyMeldWidth(
    meld,
    tileWidth,
    stackReveal,
    tileHeight,
    internalLock,
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
        const isWildcard = isOkeyWildcard(tile, okeyTile);
        const layout = getOkeyMeldTileLayout(meld, tileIndex, tileWidth, stackReveal, tileHeight, internalLock);

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
            {isWildcard ? (
              <OkeyTileBack
                width={tileWidth}
                height={tileHeight}
                unstyled
              />
            ) : renderTile ? (
              renderTile(tile, tileIndex, layout)
            ) : tile.id === meld.lockedTileId ? (
              <View style={{ transform: [{ rotate: "90deg" }] }}>
                <OkeyTileFace
                  tile={tile}
                  compact
                  width={tileWidth}
                  height={tileHeight}
                  isWildcard={isWildcard}
                />
              </View>
            ) : (
              <OkeyTileFace
                tile={tile}
                compact
                width={tileWidth}
                height={tileHeight}
                isWildcard={isWildcard}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}