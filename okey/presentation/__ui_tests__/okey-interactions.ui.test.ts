import { expect, test } from "@jest/globals";
import { createOkeyMeldPresentationFrames, isOkeyTurnPresentationBlocked } from "../okey-game-presentation";
import {
  createOpponentDiscardFlight,
  findClosestMeldDropTarget,
  isPointInsideRect,
  toLocalScreenRect,
} from "../okey-table-interactions";
import {
  createEmptySlots,
  getPreviewSlotsForDrag,
  moveTileIntoSlot,
  moveTilesIntoSlot,
} from "../../rack/rack-layout";

test("screen coordinates and opponent discard animation targets are stable", () => {
  const screen = { x: 10, y: 20, width: 400, height: 800 };
  expect(toLocalScreenRect({ x: 30, y: 70, width: 20, height: 30 }, screen)).toEqual({ x: 20, y: 50, width: 20, height: 30 });
  const flight = createOpponentDiscardFlight(
    { tile: { id: "tile", color: "red", value: 4, copy: 1 }, ownerPlayerId: "p2", discardCount: 3 },
    { x: 100, y: 100, width: 60, height: 60 },
    { x: 200, y: 220, width: 20, height: 30 },
    screen,
  );
  expect(flight?.id).toBe("opponent-discard-tile-3");
  expect(flight?.from).toEqual({ x: 110, y: 95, width: 20, height: 30 });
  expect(flight?.to).toEqual({ x: 190, y: 200, width: 20, height: 30 });
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

test("rack drag preview moves a tile or a complete meld without duplication", () => {
  const slots = createEmptySlots();
  slots.bottom[0] = "a";
  slots.bottom[1] = "b";
  slots.bottom[2] = "c";
  const moved = moveTileIntoSlot(slots, "a", "top", 4);
  expect(moved?.slots.top[4]).toBe("a");
  expect(moved?.slots.bottom.filter(Boolean)).toEqual(["b", "c"]);

  const group = moveTilesIntoSlot(slots, ["a", "b", "c"], "top", 3);
  expect(group?.slots.top.slice(3, 6)).toEqual(["a", "b", "c"]);
  const preview = getPreviewSlotsForDrag(group!.slots, slots, ["a", "b", "c"]);
  expect(preview.bottom.slice(0, 3)).toEqual(["a", "b", "c"]);
  expect(preview.top.slice(3, 6)).toEqual([null, null, null]);
});

test("turn timer stays blocked until the active tile flight lands", () => {
  expect(isOkeyTurnPresentationBlocked({
    opponentTransitionActive: false,
    hasUnpresentedOpponentDiscard: false,
    hasTileFlight: true,
  })).toBe(true);

  expect(isOkeyTurnPresentationBlocked({
    opponentTransitionActive: false,
    hasUnpresentedOpponentDiscard: false,
    hasTileFlight: false,
  })).toBe(false);

  expect(isOkeyTurnPresentationBlocked({
    opponentTransitionActive: false,
    hasUnpresentedOpponentDiscard: false,
    hasTileFlight: false,
    hasPendingHumanHandRemoval: true,
  })).toBe(true);
});
test("bot meld presentation reveals spent tiles one action at a time", () => {
  const tile = (id: string, value: number) => ({ id, color: "red", value, copy: 1 });
  const baseMeld = {
    id: "meld",
    kind: "run",
    tiles: [tile("a", 1), tile("b", 2), tile("c", 3)],
    score: 6,
  };
  const player = (melds: unknown[]) => ({
    id: "bot",
    name: "Bot",
    kind: "bot",
    teamId: "teamB",
    hand: [],
    melds,
    opened: true,
    scoreOpened: 0,
    konkan: false,
    eliminated: false,
  });

  const frames = createOkeyMeldPresentationFrames(
    [player([baseMeld]) as never],
    [player([{ ...baseMeld, tiles: [...baseMeld.tiles, tile("d", 4), tile("e", 5)], score: 15 }]) as never],
  );

  expect(frames).toHaveLength(2);
  expect(frames[0][0].melds[0].tiles.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
  expect(frames[1][0].melds[0].tiles.map((entry) => entry.id)).toEqual(["a", "b", "c", "d", "e"]);
});
