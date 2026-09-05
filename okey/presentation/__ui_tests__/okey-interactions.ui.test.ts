import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  findClosestMeldDropTarget,
  getOkeyRunEndForDrop,
  isPointInsideRect,
  toLocalScreenRect,
} from "../okey-table-interactions";
import {
  createEmptySlots,
  moveTileIntoSlot,
  moveTilesIntoSlot,
  syncSlotsWithTiles,
} from "../../rack/rack-layout";

test("screen coordinates targets are stable", () => {
  const screen = { x: 10, y: 20, width: 400, height: 800 };
  expect(toLocalScreenRect({ x: 30, y: 70, width: 20, height: 30 }, screen)).toEqual({ x: 20, y: 50, width: 20, height: 30 });
});

test("meld drop selects only a nearby legal target", () => {
  const rects = [
    { playerId: "a", meldId: "blocked", x: 0, y: 0, width: 50, height: 50 },
    { playerId: "b", meldId: "legal", x: 80, y: 0, width: 50, height: 50 },
  ];
  expect(isPointInsideRect({ x: 25, y: 25 }, rects[0])).toBe(true);
  expect(findClosestMeldDropTarget(rects, { x: 55, y: 25 }, (rect) => rect.meldId === "legal", 40)?.meldId).toBe("legal");
  expect(findClosestMeldDropTarget(rects, { x: 300, y: 300 }, () => true, 40)).toBeNull();
});

test("an ambiguous Joker drop uses the side where the tile was released", () => {
  const rect = { x: 100, y: 50, width: 80, height: 30 };
  const options = [{ runEnd: "start" as const }, { runEnd: "end" as const }];

  expect(getOkeyRunEndForDrop(options, { x: 105, y: 60 }, rect)).toBe("start");
  expect(getOkeyRunEndForDrop(options, { x: 175, y: 60 }, rect)).toBe("end");
});

test("rack drag moves a tile or a complete meld without duplication", () => {
  const slots = createEmptySlots();
  slots.bottom[0] = "a";
  slots.bottom[1] = "b";
  slots.bottom[2] = "c";
  const moved = moveTileIntoSlot(slots, "a", "top", 4);
  expect(moved?.slots.top[4]).toBe("a");
  expect(moved?.slots.bottom.filter(Boolean)).toEqual(["b", "c"]);

  const group = moveTilesIntoSlot(slots, ["a", "b", "c"], "top", 3);
  expect(group?.slots.top.slice(3, 6)).toEqual(["a", "b", "c"]);
});

test("drawn tile uses the first empty rack slot without shifting existing tiles", () => {
  const slots = createEmptySlots();
  slots.bottom[0] = "a";
  slots.bottom[2] = "b";
  slots.top[0] = "c";

  const tile = (id: string) => ({ id, color: "red" as const, value: 1, copy: 1 as const });
  const synced = syncSlotsWithTiles(
    slots,
    [tile("a"), tile("b"), tile("c"), tile("draw")],
  );

  expect(synced.bottom.slice(0, 3)).toEqual(["a", null, "b"]);
  expect(synced.top.slice(0, 2)).toEqual(["c", "draw"]);

  const fullFirstRow = createEmptySlots();
  const topIds = fullFirstRow.top.map((_, index) => `top-${index}`);
  topIds.forEach((id, index) => {
    fullFirstRow.top[index] = id;
  });
  fullFirstRow.bottom[0] = "bottom-existing";

  const nextRowSynced = syncSlotsWithTiles(
    fullFirstRow,
    [...topIds.map(tile), tile("bottom-existing"), tile("next-draw")],
  );

  expect(nextRowSynced.top).toEqual(topIds);
  expect(nextRowSynced.bottom.slice(0, 2)).toEqual(["bottom-existing", "next-draw"]);
});



test("rapid double tap discards the same rack tile without waiting for a selection render", () => {
  const interactions = readFileSync("okey/presentation/useOkeyTableActions.ts", "utf8");

  expect(interactions).toContain("const lastTapRef = useRef");
  expect(interactions).toMatch(
    /previousTap\?\.tileId === tileId[\s\S]*?tappedAt - previousTap\.tappedAt <= 350[\s\S]*?discardTile\(tileId\)/,
  );
});

test("an ambiguous Joker spend submits the endpoint selected by its drop position", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");

  expect(scene).toMatch(
    /getOkeyRunEndForDrop\(action\.runEndOptions, point, target\)/,
  );
  expect(scene).toMatch(
    /submitTableMeldAction\(action, runEnd\)/,
  );
  expect(scene).toMatch(
    /spendTileOnTableMeld\([\s\S]*?action\.targetMeldId,[\s\S]*?runEnd/,
  );
  expect(scene).not.toContain("onJokerEndpointSelected={handleJokerEndpointSelected}");
});

test("a finished online room keeps its authoritative match until route exit", () => {
  const scene = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");

  expect(scene).toContain(
    'onlineRoom?.status === "playing" || onlineRoom?.status === "finished"',
  );
});
