import assert from "node:assert/strict";
import test from "node:test";
import {
  getLegalMoves,
} from "../engine.ts";
import {
  createDamaRoom,
  resolveDamaRoomMove,
  resolveDamaTurnTimeout,
} from "../authoritative.ts";

test("Full 2-player multiplayer Dama match lifecycle and settlement simulation", () => {
  const playerCream = "user-cream-111";
  const playerBlack = "user-black-222";
  const roomId = "test-dama-room-e2e";
  const now = 1_000_000;

  // 1. Waiting Room created for 2 players
  const room = createDamaRoom(
    roomId,
    { cream: playerCream, black: playerBlack },
    now,
  );
  assert.equal(room.roomId, roomId);
  assert.equal(room.match.game.turn, "cream");
  assert.equal(room.players.cream?.connected, true);
  assert.equal(room.players.black?.connected, true);
  assert.equal(room.match.version, 0);

  // 2. First move by Cream player
  const creamMoves = getLegalMoves(room.match.game);
  assert.ok(creamMoves.length > 0, "Cream should have legal opening moves");
  const firstMove = creamMoves[0];

  const moveOutcome1 = resolveDamaRoomMove(
    room,
    {
      matchId: room.match.matchId,
      actorPlayerId: playerCream,
      playerColor: "cream",
      expectedVersion: 0,
      expectedTurnId: room.match.turnId,
      move: firstMove,
    },
    now + 2_000,
  );

  assert.equal(moveOutcome1.accepted, true);
  if (!moveOutcome1.accepted) throw new Error("Move 1 rejected");
  assert.equal(moveOutcome1.state.match.version, 1);
  assert.equal(moveOutcome1.state.match.game.turn, "black");

  // 3. Black attempts to move out of turn or with stale version -> Must reject
  const invalidMove = resolveDamaRoomMove(
    moveOutcome1.state,
    {
      matchId: room.match.matchId,
      actorPlayerId: playerCream, // Cream trying to move again
      playerColor: "cream",
      expectedVersion: 1,
      expectedTurnId: moveOutcome1.state.match.turnId,
      move: firstMove,
    },
    now + 3_000,
  );
  assert.equal(invalidMove.accepted, false);
  assert.equal(invalidMove.reason, "wrong_turn");

  // 4. Black player legal reply
  const blackMoves = getLegalMoves(moveOutcome1.state.match.game);
  assert.ok(blackMoves.length > 0, "Black should have legal reply moves");
  const blackMove = blackMoves[0];

  const moveOutcome2 = resolveDamaRoomMove(
    moveOutcome1.state,
    {
      matchId: room.match.matchId,
      actorPlayerId: playerBlack,
      playerColor: "black",
      expectedVersion: 1,
      expectedTurnId: moveOutcome1.state.match.turnId,
      move: blackMove,
    },
    now + 5_000,
  );

  assert.equal(moveOutcome2.accepted, true);
  if (!moveOutcome2.accepted) throw new Error("Move 2 rejected");
  assert.equal(moveOutcome2.state.match.version, 2);
  assert.equal(moveOutcome2.state.match.game.turn, "cream");

  // 5. Timeout resolution on Cream turn
  const afterTimeout = resolveDamaTurnTimeout(
    moveOutcome2.state.match,
    now + 5_000 + 16_000,
  );
  assert.equal(afterTimeout.version, 3);
  assert.equal(afterTimeout.game.turn, "black");
});
