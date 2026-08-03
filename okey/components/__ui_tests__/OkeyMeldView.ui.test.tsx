import { expect, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";

import {
  FOUR_TILE_SET_REVEAL,
  OkeyMeldView,
  chunkOkeyMeldRows,
  getOkeyMeldWidth,
} from "../OkeyMeldView";
import type { OkeyMeld, OkeyTile } from "../../types/okey";

function tile(id: string, color: OkeyTile["color"], value = 6): OkeyTile {
  return { id, color, value, copy: 1 };
}

const okeyTile = tile("okey", "red", 13);

test("a four-tile set is rendered as a compact physical stack", () => {
  const meld: OkeyMeld = {
    id: "set-6",
    ownerId: "player",
    kind: "set",
    score: 24,
    tiles: [tile("red-6", "red"), tile("blue-6", "blue"), tile("black-6", "black"), tile("yellow-6", "yellow")],
  };
  const layouts: { stacked: boolean; left: number; zIndex: number }[] = [];

  const view = render(
    <OkeyMeldView
      meld={meld}
      okeyTile={okeyTile}
      renderTile={(entry, index, layout) => {
        layouts[index] = layout;
        return <Text testID={`meld-tile-${entry.id}`}>{entry.id}</Text>;
      }}
    />,
  );

  for (const entry of meld.tiles) expect(view.getByTestId(`meld-tile-${entry.id}`)).toBeTruthy();
  expect(layouts).toEqual([
    { stacked: true, left: 0, zIndex: 4 },
    { stacked: true, left: FOUR_TILE_SET_REVEAL, zIndex: 3 },
    { stacked: true, left: FOUR_TILE_SET_REVEAL * 2, zIndex: 2 },
    { stacked: true, left: FOUR_TILE_SET_REVEAL * 3, zIndex: 1 },
  ]);
  expect(getOkeyMeldWidth(meld, 18, FOUR_TILE_SET_REVEAL)).toBe(27);
});

test("runs stay fully separated and table meld rows remain stable", () => {
  const run = (id: string): OkeyMeld => ({
    id,
    ownerId: "player",
    kind: "run",
    score: 18,
    tiles: [tile(`${id}-1`, "blue", 5), tile(`${id}-2`, "blue", 6), tile(`${id}-3`, "blue", 7)],
  });
  const melds = [run("a"), run("b"), run("c"), run("d"), run("e")];
  expect(getOkeyMeldWidth(melds[0], 18, FOUR_TILE_SET_REVEAL)).toBe(54);
  expect(chunkOkeyMeldRows(melds)).toEqual([[melds[0], melds[1]], [melds[2], melds[3]], [melds[4]]]);
  expect(chunkOkeyMeldRows(melds, 3)).toEqual([[melds[0], melds[1]], [melds[2]]]);
});
