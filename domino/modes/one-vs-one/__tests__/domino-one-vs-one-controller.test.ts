import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyBoard } from "@/domino/core/engine/kozel-engine";
import { DominoOneVsOneSnapshotController } from "../controllers/domino-one-vs-one-controller.ts";

const doubleSix = { id: "6-6", left: 6, right: 6, imageKey: "6-6" };

test("controller owns optimistic projection and confirms it only on a newer snapshot", () => {
  const controller = new DominoOneVsOneSnapshotController();
  assert.equal(controller.apply({ version: 4, state: { board: createEmptyBoard(), myHand: [doubleSix] } }), true);

  const pending = controller.beginOptimisticMove({
    roomId: "room-1",
    baseVersion: 4,
    board: createEmptyBoard(),
    tile: doubleSix,
    branch: "right",
    spinnerValue: null,
    isOpeningRound: true,
    requestId: "command-1",
  });
  assert.equal(pending.visualBoard.centerTile?.id, "6-6");

  controller.apply({ version: 4, state: { board: pending.visualBoard } });
  assert.equal(controller.getPendingMove()?.requestId, "command-1");

  controller.apply({ version: 5, state: { board: pending.visualBoard } });
  assert.equal(controller.getPendingMove(), null);
});

test("controller rejects stale snapshots", () => {
  const controller = new DominoOneVsOneSnapshotController();
  assert.equal(controller.apply({ version: 3, state: { marker: "new" } }), true);
  assert.equal(controller.apply({ version: 2, state: { marker: "old" } }), false);
  assert.equal(controller.getSnapshot().marker, "new");
});

test("controller can roll back one matching optimistic request", () => {
  const controller = new DominoOneVsOneSnapshotController();
  const pending = controller.beginOptimisticMove({
    roomId: "room-1",
    baseVersion: 1,
    board: createEmptyBoard(),
    tile: doubleSix,
    branch: "right",
    spinnerValue: null,
    isOpeningRound: true,
    requestId: "command-2",
  });
  controller.clearPendingMove("another-command");
  assert.equal(controller.getPendingMove()?.requestId, pending.requestId);
  controller.clearPendingMove(pending.requestId);
  assert.equal(controller.getPendingMove(), null);
});
