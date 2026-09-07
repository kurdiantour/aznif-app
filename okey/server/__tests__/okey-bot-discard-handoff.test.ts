import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOkeyServerLifecycle } from "../../../lib/multiplayer/okey/okey-turn-engine.ts";
import { completeDeferredBotTurnAdvance, discardTile, drawTile } from "../../engine/okey-engine.ts";
import type { OkeyGameState } from "../../types/okey.ts";
import {
  createAuthoritativeOkeyMatch,
  getNextOkeyMatchTurnDeadline,
} from "../okey-authoritative.ts";
import type { OkeyAuthoritativeMatchState } from "../okey-authoritative.ts";

const identities = [
  { id: "p1", name: "P1", controlledByBot: false },
  { id: "p2", name: "P2", controlledByBot: false },
  { id: "p3", name: "P3", controlledByBot: false },
  { id: "p4", name: "P4", controlledByBot: false },
] as const;

test("Bot discard persists an eligibility boundary before advancing to the Human turn", () => {
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
  const eligibleAt = "2026-09-06T12:00:00.600Z";
  const discarded = discardTile(
    preparedRound,
    preparedRound.players[actorIndex].hand[0].id,
    { deferTurnAdvanceUntil: eligibleAt },
  );
  const pendingMatch = { ...base, roundState: discarded };

  assert.equal(discarded.currentPlayerIndex, actorIndex);
  assert.equal(discarded.pendingBotTurnAdvancePlayerId, actor.id);
  assert.equal(discarded.pendingBotTurnAdvanceAt, eligibleAt);
  assert.equal(getNextOkeyMatchTurnDeadline(pendingMatch, Date.parse(eligibleAt) - 1), null);

  const waiting = evaluateOkeyServerLifecycle({
    state: pendingMatch,
    version: 7,
    turn_deadline_at: null,
  }, Date.parse(eligibleAt) - 1);
  assert.equal(waiting.type, "bot-turn");
  if (waiting.type === "bot-turn") {
    assert.equal(waiting.step, "advance");
    assert.equal(waiting.ready, false);
    assert.equal(waiting.notBefore, eligibleAt);
  }

  const beforeBoundary = completeDeferredBotTurnAdvance(
    discarded,
    actor.id,
    Date.parse(eligibleAt) - 1,
  );
  assert.equal(beforeBoundary, discarded);

  const advanced = completeDeferredBotTurnAdvance(
    discarded,
    actor.id,
    Date.parse(eligibleAt),
  );
  assert.notEqual(advanced.currentPlayerIndex, actorIndex);
  assert.equal(advanced.pendingBotTurnAdvanceAt, null);
  assert.equal(advanced.pendingBotTurnAdvancePlayerId, null);

  const deadline = getNextOkeyMatchTurnDeadline(
    { ...pendingMatch, roundState: advanced },
    Date.parse(eligibleAt),
  );
  assert.equal(deadline, "2026-09-06T12:00:15.600Z");
});
test("three consecutive Bots cannot start the Human deadline before the final deferred advance", () => {
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
    const eligibleAt = new Date(now + 600).toISOString();
    round = discardTile(round, actor.hand[0].id, {
      deferTurnAdvanceUntil: eligibleAt,
    });
    match = { ...match, roundState: round };

    assert.equal(round.players[round.currentPlayerIndex].id, actor.id);
    assert.equal(getNextOkeyMatchTurnDeadline(match, now), null);

    now += 600;
    round = completeDeferredBotTurnAdvance(round, actor.id, now);
    match = { ...match, roundState: round };
    if (round.players[round.currentPlayerIndex].controlledByBot) {
      assert.equal(getNextOkeyMatchTurnDeadline(match, now), null);
    }
  }

  assert.equal(botTurns, 3);
  assert.equal(round.currentPlayerIndex, humanIndex);
  assert.ok(getNextOkeyMatchTurnDeadline(match, now));
});

test("Edge handoffs propagate the persisted Bot advance eligibility", async () => {
  const { readFile } = await import("node:fs/promises");
  const matchEdge = await readFile("supabase/functions/okey_match/index.ts", "utf8");
  const worker = await readFile("supabase/functions/process_bot_turns/index.ts", "utf8");
  assert.match(matchEdge, /pendingBotTurnAdvanceAt[\s\S]*handOffOkeyServerLifecycle|handOffOkeyServerLifecycle[\s\S]*pendingBotTurnAdvanceAt/);
  assert.match(worker, /eligibleAt: result\.state\.roundState\?\.pendingBotTurnAdvanceAt/);
});