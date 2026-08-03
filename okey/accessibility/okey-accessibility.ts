import type { OkeyMeld, OkeyTile } from "../types/okey";

const COLOR_NAMES: Record<OkeyTile["color"], string> = {
  red: "سوور",
  blue: "شین",
  black: "ڕەش",
  yellow: "زەرد",
};

export function getOkeyTileAccessibilityLabel(
  tile: OkeyTile,
  options: { isWildcard?: boolean; selected?: boolean; locked?: boolean } = {},
) {
  const identity = tile.isFakeJoker
    ? "جۆکەری دەستکرد"
    : options.isWildcard
      ? `جۆکەر، ${tile.value}ی ${COLOR_NAMES[tile.color]}`
      : `بەردی ${tile.value}ی ${COLOR_NAMES[tile.color]}`;
  return [
    identity,
    options.locked ? "داخراو" : null,
    options.selected ? "هەڵبژێردراو" : null,
  ].filter(Boolean).join("، ");
}

export function getOkeyMeldAccessibilityLabel(meld: OkeyMeld, okeyTile: OkeyTile) {
  const kind = meld.kind === "run" ? "ڕیز" : "دەستە";
  const tiles = meld.tiles.map((tile) => getOkeyTileAccessibilityLabel(tile, {
    isWildcard: tile.id === okeyTile.id || (!tile.isFakeJoker && tile.color === okeyTile.color && tile.value === okeyTile.value),
    locked: tile.id === meld.lockedTileId,
  })).join("، ");
  return `${kind}ی ${meld.tiles.length} بەردی، ${tiles}`;
}

export const OKEY_ACCESSIBILITY = {
  tileHint: "دوو جار لێبدە بۆ هەڵبژاردن. لە کردارەکانی دەستڕاگەیشتن بۆ گواستنەوە بەکاربهێنە.",
  drawDeckLabel: (count: number) => `کۆگای بەرد، ${count} بەرد ماوە`,
  drawDeckHint: "دوو جار لێبدە بۆ وەرگرتنی بەردێک لە کۆگا.",
  discardLabel: (tile: OkeyTile, count: number, isWildcard: boolean) =>
    `بەردە فڕێدراوەکان، ${count} بەرد، سەرەوە ${getOkeyTileAccessibilityLabel(tile, { isWildcard })}`,
  discardHint: "کردارەکانی دەستڕاگەیشتن بۆ وەرگرتنی بەرد یان بینینی مێژوو بەکاربهێنە.",
} as const;
