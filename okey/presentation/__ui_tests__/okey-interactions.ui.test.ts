import { expect, test } from "@jest/globals";
import {
  advanceLocalOkeyTurnSequence,
  createOkeyMeldPresentationFrames,
  getOkeyTurnIdentity,
  getOrCreateLocalOkeyTurnDeadline,
  isOkeyTurnPresentationBlocked,
} from "../okey-game-presentation";
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
  syncSlotsWithTiles,
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

test("drawn tile uses the first empty rack slot without shifting existing tiles", () => {
  const slots = createEmptySlots();
  slots.bottom[0] = "a";
  slots.bottom[2] = "b";
  slots.top[0] = "c";

  const tile = (id: string) => ({ id, color: "red" as const, value: 1, copy: 1 as const });
  const synced = syncSlotsWithTiles(
    slots,
    [tile("a"), tile("b"), tile("c"), tile("draw")],
    "draw",
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
    "next-draw",
  );

  expect(nextRowSynced.top).toEqual(topIds);
  expect(nextRowSynced.bottom.slice(0, 2)).toEqual(["bottom-existing", "next-draw"]);
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
test("Human -> opponents -> Human again creates a fresh Preview deadline and one warning per Human turn", () => {
  let sequence = { marker: null as string | null, sequence: 0 };
  let deadline: { turnIdentity: string; deadlineMs: number } | null = null;
  let warnedTurnIdentity: string | null = null;
  const warnings: string[] = [];
  const consumeWarning = (turnIdentity: string) => {
    if (warnedTurnIdentity === turnIdentity) return;
    warnedTurnIdentity = turnIdentity;
    warnings.push(turnIdentity);
  };

  sequence = advanceLocalOkeyTurnSequence(sequence, "1-0-human");
  const firstHumanTurn = getOkeyTurnIdentity({
    round: 1,
    playerIndex: 0,
    playerId: "human",
    localSequence: sequence.sequence,
  });
  deadline = getOrCreateLocalOkeyTurnDeadline(deadline, firstHumanTurn, 1_000, 30_000);
  expect(deadline.deadlineMs).toBe(31_000);
  consumeWarning(firstHumanTurn);
  consumeWarning(firstHumanTurn);

  const afterDraw = advanceLocalOkeyTurnSequence(sequence, "1-0-human");
  expect(afterDraw).toBe(sequence);
  expect(getOrCreateLocalOkeyTurnDeadline(deadline, firstHumanTurn, 2_000, 30_000)).toBe(deadline);

  sequence = advanceLocalOkeyTurnSequence(sequence, "1-1-opponent-1");
  sequence = advanceLocalOkeyTurnSequence(sequence, "1-2-opponent-2");
  sequence = advanceLocalOkeyTurnSequence(sequence, "1-3-opponent-3");
  sequence = advanceLocalOkeyTurnSequence(sequence, "1-0-human");
  const secondHumanTurn = getOkeyTurnIdentity({
    round: 1,
    playerIndex: 0,
    playerId: "human",
    localSequence: sequence.sequence,
  });
  deadline = getOrCreateLocalOkeyTurnDeadline(deadline, secondHumanTurn, 40_000, 30_000);
  expect(secondHumanTurn).not.toBe(firstHumanTurn);
  expect(deadline.deadlineMs).toBe(70_000);
  consumeWarning(secondHumanTurn);
  consumeWarning(secondHumanTurn);

  expect(warnings).toEqual([firstHumanTurn, secondHumanTurn]);
});

test("Online turn identity changes only when the authoritative deadline changes", () => {
  const first = getOkeyTurnIdentity({
    round: 1,
    playerIndex: 0,
    playerId: "human",
    onlineDeadlineAt: "2026-08-22T10:00:30.000Z",
  });
  const afterDraw = getOkeyTurnIdentity({
    round: 1,
    playerIndex: 0,
    playerId: "human",
    onlineDeadlineAt: "2026-08-22T10:00:30.000Z",
  });
  const nextTurn = getOkeyTurnIdentity({
    round: 1,
    playerIndex: 0,
    playerId: "human",
    onlineDeadlineAt: "2026-08-22T10:02:30.000Z",
  });

  expect(afterDraw).toBe(first);
  expect(nextTurn).not.toBe(first);
});
