import { expect, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Image } from "expo-image";
import { Text } from "react-native";

import {
  FOUR_TILE_SET_REVEAL,
  OkeyMeldView,
  chunkOkeyMeldRows,
  getOkeyMeldTileLayout,
  getOkeyMeldWidth,
} from "../OkeyMeldView";
import {
  OkeyPlayerMeldArea,
  hasInternalOkeyMeldLock,
} from "../OkeyTableMeldAreas";
import { createInitialOkeyGame } from "../../engine/okey-engine";
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
  expect(getOkeyMeldWidth(meld, 18, FOUR_TILE_SET_REVEAL)).toBe(54);
});

test("a Konkan spend lock keeps its face and half-overlaps the run endpoint", () => {
  const startLocked: OkeyMeld = {
    id: "start-locked",
    ownerId: "player",
    kind: "run",
    score: 22,
    locked: true,
    lockedTileId: "spent-4",
    tiles: [
      tile("spent-4", "yellow", 4),
      tile("run-5", "yellow", 5),
      tile("run-6", "yellow", 6),
      tile("run-7", "yellow", 7),
    ],
  };
  const endLocked: OkeyMeld = {
    ...startLocked,
    id: "end-locked",
    lockedTileId: "spent-8",
    tiles: [
      tile("run-5", "yellow", 5),
      tile("run-6", "yellow", 6),
      tile("run-7", "yellow", 7),
      tile("spent-8", "yellow", 8),
    ],
  };

  const startLockedSet: OkeyMeld = { ...startLocked, id: "start-locked-set", kind: "set" };
  const neighbor: OkeyMeld = {
    ...startLocked,
    id: "neighbor",
    locked: false,
    lockedTileId: undefined,
  };

  expect(hasInternalOkeyMeldLock([endLocked, neighbor])).toBe(true);
  expect(hasInternalOkeyMeldLock([neighbor, startLocked])).toBe(true);
  expect(hasInternalOkeyMeldLock([startLocked, neighbor])).toBe(false);
  expect(hasInternalOkeyMeldLock([neighbor, endLocked])).toBe(false);

  expect(getOkeyMeldWidth(startLocked, 18, FOUR_TILE_SET_REVEAL, 24)).toBe(66);
  expect(getOkeyMeldWidth(startLockedSet, 18, FOUR_TILE_SET_REVEAL, 24)).toBe(66);
  expect(startLocked.tiles.map((_, index) =>
    getOkeyMeldTileLayout(startLocked, index, 18, FOUR_TILE_SET_REVEAL, 24).left
  )).toEqual([3, 12, 30, 48]);
  expect(endLocked.tiles.map((_, index) =>
    getOkeyMeldTileLayout(endLocked, index, 18, FOUR_TILE_SET_REVEAL, 24).left
  )).toEqual([0, 18, 36, 45]);
  expect(getOkeyMeldWidth(startLocked, 18, FOUR_TILE_SET_REVEAL, 24, true)).toBe(69);
  expect(startLocked.tiles.map((_, index) =>
    getOkeyMeldTileLayout(startLocked, index, 18, FOUR_TILE_SET_REVEAL, 24, true).left
  )).toEqual([3, 15, 33, 51]);
  expect(endLocked.tiles.map((_, index) =>
    getOkeyMeldTileLayout(endLocked, index, 18, FOUR_TILE_SET_REVEAL, 24, true).left
  )).toEqual([0, 18, 36, 48]);

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

test("an eliminated player's committed meld area has a glass lock overlay", () => {
  const state = createInitialOkeyGame(0);
  const meld: OkeyMeld = {
    id: "frozen-meld",
    ownerId: state.players[0].id,
    kind: "run",
    score: 18,
    tiles: [
      tile("frozen-5", "blue", 5),
      tile("frozen-6", "blue", 6),
      tile("frozen-7", "blue", 7),
    ],
  };
  const player = {
    ...state.players[0],
    opened: true,
    eliminated: true,
    melds: [meld],
    scoreOpened: 18,
  };

  const view = render(
    <OkeyPlayerMeldArea
      player={player}
      allPlayers={[player]}
      okeyTile={state.okeyTile}
      position="bottom"
    />,
  );

  expect(
    view.getByTestId("okey-eliminated-meld-overlay-" + player.id),
  ).toBeTruthy();
});

test("a real joker in a meld is always face-down while a fake joker stays face-up", () => {
  const realJoker = tile("real-joker", okeyTile.color, okeyTile.value);
  const fakeJoker: OkeyTile = {
    ...tile("fake-joker", "black", 0),
    isFakeJoker: true,
  };
  const regularTile = tile("regular", "blue", 6);
  const meld: OkeyMeld = {
    id: "joker-meld",
    ownerId: "player",
    kind: "run",
    score: 19,
    tiles: [regularTile, realJoker, fakeJoker],
  };

  const view = render(
    <OkeyMeldView
      meld={meld}
      okeyTile={okeyTile}
      renderTile={(entry) => (
        <Text testID={`custom-tile-${entry.id}`}>{entry.id}</Text>
      )}
    />,
  );

  expect(view.queryByTestId("custom-tile-real-joker")).toBeNull();
  expect(view.getByTestId("custom-tile-fake-joker")).toBeTruthy();
  expect(view.getByTestId("custom-tile-regular")).toBeTruthy();
  expect(view.UNSAFE_getAllByType(Image)).toHaveLength(1);
});
