import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handSeatToBot } from "../../engine/okey-bot-policy.ts";
import { createAuthoritativeOkeyMatch } from "../okey-authoritative.ts";
import { getOkeyBotTurnClaim } from "../../../supabase/functions/_shared/okey-bot-handoff.ts";

const players = [
  { id: "player-0", name: "Player 0" },
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
] as const;

test("authoritative Bot handoff claims exactly the committed version and current actor", () => {
  const match = createAuthoritativeOkeyMatch(players, 0);
  const currentPlayerIndex = match.roundState.currentPlayerIndex;
  const botState = {
    ...match,
    roundState: handSeatToBot(match.roundState, currentPlayerIndex, "normal"),
  };

  assert.deepEqual(getOkeyBotTurnClaim(botState, 17), {
    expectedVersion: 17,
    expectedActorId: botState.roundState.players[currentPlayerIndex].id,
  });
  assert.equal(getOkeyBotTurnClaim(match, 17), null);
});

test("external and Bot commits use one-step exact claims while maintenance stays settlement-only", () => {
  const matchGateway = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const worker = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
  const maintenance = readFileSync("supabase/functions/okey_maintenance/index.ts", "utf8");
  const handoff = readFileSync("supabase/functions/_shared/okey-bot-handoff.ts", "utf8");

  assert.doesNotMatch(matchGateway, /handOffOkeyBotTurn/);
  assert.doesNotMatch(worker, /handOffBotTurn:[\s\S]*handOffOkeyBotTurn/);
  assert.match(worker, /\.is\("membership_released_at", null\)/);
  assert.match(maintenance, /\.eq\("status", "finished"\)/);
  assert.match(maintenance, /\.is\("settlement_at", null\)/);
  assert.doesNotMatch(maintenance, /reconcileAuthoritativeServerTurns|\.eq\("status", "playing"\)/);
  assert.match(handoff, /expected_version: claim\.expectedVersion/);
  assert.match(handoff, /expected_actor_id: claim\.expectedActorId/);
  assert.doesNotMatch(handoff, /while\s*\(|setInterval|setTimeout/);
});
