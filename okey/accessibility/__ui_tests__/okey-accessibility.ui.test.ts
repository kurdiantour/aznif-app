import { expect, test } from "@jest/globals";
import { getOkeyMeldAccessibilityLabel, getOkeyTileAccessibilityLabel } from "../okey-accessibility";
import type { OkeyMeld, OkeyTile } from "../../types/okey";

const tile = (id: string, color: OkeyTile["color"], value: number): OkeyTile => ({ id, color, value, copy: 1 });

test("tile labels announce color, value, selection and joker state in Sorani", () => {
  expect(getOkeyTileAccessibilityLabel(tile("red-6", "red", 6))).toBe("بەردی 6ی سوور");
  expect(getOkeyTileAccessibilityLabel(tile("blue-9", "blue", 9), { selected: true })).toContain("هەڵبژێردراو");
  expect(getOkeyTileAccessibilityLabel(tile("black-13", "black", 13), { isWildcard: true })).toContain("جۆکەر");
  expect(getOkeyTileAccessibilityLabel({ ...tile("fake", "yellow", 1), isFakeJoker: true })).toBe("جۆکەری دەستکرد");
});

test("meld labels expose kind, tile count and locked tile", () => {
  const meld: OkeyMeld = {
    id: "set",
    ownerId: "player",
    kind: "set",
    score: 24,
    lockedTileId: "black-6",
    tiles: [tile("red-6", "red", 6), tile("blue-6", "blue", 6), tile("black-6", "black", 6), tile("yellow-6", "yellow", 6)],
  };
  const label = getOkeyMeldAccessibilityLabel(meld, tile("okey", "red", 13));
  expect(label).toContain("دەستەی 4 بەردی");
  expect(label).toContain("بەردی 6ی ڕەش، داخراو");
});
