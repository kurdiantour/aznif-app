import assert from "node:assert/strict";
import test from "node:test";

import { discardTile, drawTile } from "../../engine/okey-engine.ts";
import type { OkeyGameState } from "../../types/okey.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
} from "../okey-authoritative.ts";
import type { OkeyAuthoritativeMatchState } from "../okey-authoritative.ts";
import { selectOkeyBotIntent } from "../okey-bot-executor.ts";

const identities = [
  { id: "p1", name: "P1", controlledByBot: false },
  { id: "p2", name: "P2", controlledByBot: false },
  { id: "p3", name: "P3", controlledByBot: false },
  { id: "p4", name: "P4", controlledByBot: false },
] as const;

test("Bot discard advances by rule without an animation eligibility boundary", () => {
  const base = createAuthoritativeOkeyMatch(identities, 0);
  const actorIndex = base.roundState.currentPlayerIndex;
  const actor = base.roundState.players[actorIndex];
  const preparedRound = {
    ...base.roundState,
    players: base.roundState.players.map((player, index) => ({
      ...player,
      controlledByBot: index === actorIndex,
    })),
  };
  const drawn = drawTile(preparedRound, "deck");
  const intent = selectOkeyBotIntent({
    state: drawn,
    expectedActorId: actor.id,
    step: "discard",
    now: Date.parse("2026-09-06T12:00:00.000Z"),
  });
  assert.ok(intent);
  assert.notEqual(intent.roundState.currentPlayerIndex, actorIndex);
  assert.equal(intent.roundState.pendingBotTurnAdvancePlayerId, null);
  assert.equal(intent.roundState.pendingBotTurnAdvanceAt, null);
});
test("three consecutive Bot transitions reach the Human official deadline without display waits", () => {
  const base = createAuthoritativeOkeyMatch(identities, 0);
  const humanIndex = (base.roundState.currentPlayerIndex + 3) % base.roundState.players.length;
  let round: OkeyGameState = {
    ...base.roundState,
    players: base.roundState.players.map((player, index) => ({
      ...player,
      controlledByBot: index !== humanIndex,
    })),
  };
  let match: OkeyAuthoritativeMatchState = { ...base, roundState: round };
  let now = Date.parse("2026-09-06T13:00:00.000Z");
  let botTurns = 0;

  while (round.players[round.currentPlayerIndex].controlledByBot) {
    botTurns += 1;
    if (!round.hasDrawnThisTurn) round = drawTile(round, "deck");
    const actor = round.players[round.currentPlayerIndex];
    round = discardTile(round, actor.hand[0].id);
    match = { ...match, roundState: round };
    if (round.players[round.currentPlayerIndex].controlledByBot) {
      assert.equal(getNextOkeyMatchTurnDeadline(match, now), null);
    }
  }

  assert.equal(botTurns, 3);
  assert.equal(round.currentPlayerIndex, humanIndex);
  assert.ok(getNextOkeyMatchTurnDeadline(match, now));
});

test("Edge handoffs target the durable alarm scheduler", async () => {
  const { readFile } = await import("node:fs/promises");
  const matchEdge = await readFile("supabase/functions/okey_match/index.ts", "utf8");
  const worker = await readFile("supabase/functions/process_bot_turns/index.ts", "utf8");
  const scheduler = await readFile("cloudflare/aznif-game-lifecycle/src/index.js", "utf8");
  assert.match(matchEdge, /gameType: "okey"/);
  assert.match(matchEdge, /runAt: wakeup\.runAt/);
  assert.match(worker, /gameType: "okey"/);
  assert.match(worker, /runAt: wakeup\.runAt/);
  assert.match(scheduler, /storage\.setAlarm\(Date\.parse\(wakeup\.runAt\)\)/);
  assert.doesNotMatch(scheduler, /setTimeout|sleep\(/);
});
