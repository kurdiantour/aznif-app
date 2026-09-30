import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isOkeyBotControlled } from "../../engine/okey-bot-engine.ts";
import {
  applyAuthoritativeManualLeave,
  applyAuthoritativeOkeyCommand,
  applyAuthoritativeOkeyMatchCommand,
  createAuthoritativeOkeyMatch,
  OkeyCommandError,
  resolveAuthoritativeMatchDeadline,
} from "../okey-authoritative.ts";
import {
  evaluateOkeyServerLifecycle,
} from "../okey-turn-engine.ts";

const matchPlayers = [
  { id: "player-0", name: "Player 0" },
  { id: "player-1", name: "Player 1" },
  { id: "player-2", name: "Player 2" },
  { id: "player-3", name: "Player 3" },
] as const;

const expiredDeadline = "2026-08-02T00:00:00.000Z";
const afterDeadline = Date.parse("2026-08-02T00:01:00.000Z");

function forcePlayerTurn(
  match: ReturnType<typeof createAuthoritativeOkeyMatch>,
  playerIndex: number,
) {
  return {
    ...match,
    roundState: {
      ...match.roundState,
      currentPlayerIndex: playerIndex,
      hasDrawnThisTurn: false,
    },
  };
}

test("1. Human timeout -> Bot takeover -> Client exit structure", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  const playerId = matchPlayers[playerIndex].id;

  // First timeout (streak 1)
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  assert.equal(match.timeoutCountsByPlayerId[playerId], 1);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), false);

  // Second timeout (streak 2 -> Takeover)
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  assert.equal(match.timeoutCountsByPlayerId[playerId], 2);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), true);
  assert.equal(match.roundState.players[playerIndex].controlledByBot, true);
  assert.equal(match.roundState.players[playerIndex].kind, "bot");

  // Verify Scene code checks localPlayerTakenOver and exits immediately to lobby, and disables interactions
  const sceneSource = readFileSync("okey/scenes/OkeyGameTableScene.tsx", "utf8");
  assert.match(sceneSource, /const localPlayerTakenOver\s*=\s*!isPreview\s*&&\s*\(humanPlayer\?\.controlledByBot === true/);
  assert.match(sceneSource, /router\.replace\(exitRoute\)/);
  assert.match(sceneSource, /isHumanTurn\s*=\s*!localPlayerTakenOver\s*&&\s*turnView\.phase === "playing"/);
  assert.match(sceneSource, /turnTimerVisible\s*=\s*!localPlayerTakenOver/);
  assert.match(sceneSource, /pointerEvents=\{localPlayerTakenOver \? "none" : "auto"\}/);
});

test("2. take-back-seat command parsing in okey_match edge function", () => {
  const edgeSource = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  assert.match(edgeSource, /case "take-back-seat":\s*return\s*{\s*type:\s*"take-back-seat",?\s*};/);
});

test("3. Successful seat reclaim via take-back-seat command", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  const playerId = matchPlayers[playerIndex].id;

  // Cause bot takeover via 2 draw timeouts
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  assert.equal(isOkeyBotControlled(match.roundState.players[playerIndex]), true);
  assert.equal(match.timeoutCountsByPlayerId[playerId], 2);

  // Reclaim seat
  const reclaimed = applyAuthoritativeOkeyMatchCommand(
    match,
    playerIndex,
    { type: "take-back-seat" },
  );

  // Seat is human again, controlledByBot is false, streak is reset to 0
  assert.equal(isOkeyBotControlled(reclaimed.roundState.players[playerIndex]), false);
  assert.equal(reclaimed.roundState.players[playerIndex].controlledByBot, false);
  assert.equal(reclaimed.roundState.players[playerIndex].kind, "human");
  assert.equal(reclaimed.timeoutCountsByPlayerId[playerId], 0);

  // Attempting to reclaim an already human seat is rejected
  assert.throws(
    () => applyAuthoritativeOkeyMatchCommand(reclaimed, playerIndex, { type: "take-back-seat" }),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );

  // Attempting to reclaim a seat after manual leave is rejected
  let manualLeftMatch = createAuthoritativeOkeyMatch(matchPlayers, 0);
  manualLeftMatch = applyAuthoritativeManualLeave(manualLeftMatch, playerIndex);
  assert.throws(
    () => applyAuthoritativeOkeyMatchCommand(manualLeftMatch, playerIndex, { type: "take-back-seat" }),
    (error) => error instanceof OkeyCommandError && error.code === "command_rejected",
  );
});

test("4. Return to Game navigation directly to /okey/game?matchId=<id>&mode=<mode>", () => {
  const overlaySource = readFileSync("okey/multiplayer/OkeyReturnToGameOverlay.tsx", "utf8");
  assert.match(overlaySource, /type:\s*"take-back-seat"/);
  assert.match(overlaySource, /pathname:\s*"\/okey\/game"/);
  assert.match(overlaySource, /matchId:\s*currentMatchId/);
  assert.match(overlaySource, /mode/);
  assert.doesNotMatch(overlaySource, /\/okey\/fun\?matchId=/);
});

test("5. No Bot action executed for seat after reclaim", () => {
  let match = createAuthoritativeOkeyMatch(matchPlayers, 0);
  const playerIndex = 1;
  const playerId = matchPlayers[playerIndex].id;

  // Takeover seat
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  match = resolveAuthoritativeMatchDeadline(forcePlayerTurn(match, playerIndex), expiredDeadline, afterDeadline);
  match = forcePlayerTurn(match, playerIndex);

  // While bot-controlled, server lifecycle evaluates to bot-turn
  const botDecision = evaluateOkeyServerLifecycle({
    version: 5,
    turn_deadline_at: null,
    state: match,
  }, afterDeadline);
  assert.equal(botDecision.type, "bot-turn");
  assert.equal((botDecision as any).expectedActorId, playerId);

  // Reclaim seat
  const reclaimed = applyAuthoritativeOkeyMatchCommand(
    match,
    playerIndex,
    { type: "take-back-seat" },
  );

  // After reclaim, server lifecycle is idle (waiting for human action) with deadline, NOT bot-turn
  const humanDecision = evaluateOkeyServerLifecycle({
    version: 6,
    turn_deadline_at: new Date(afterDeadline + 15000).toISOString(),
    state: reclaimed,
  }, afterDeadline);
  assert.notEqual(humanDecision.type, "bot-turn");
  assert.equal(humanDecision.type, "idle");
  assert.equal((humanDecision as any).reason, "waiting_for_human_action");
});

test("6. OkeyReturnToGameOverlay re-evaluates active memberships on route change", () => {
  const overlaySource = readFileSync("okey/multiplayer/OkeyReturnToGameOverlay.tsx", "utf8");
  assert.match(overlaySource, /import\s*\{[^}]*usePathname[^}]*\}\s*from\s*"expo-router"/);
  assert.match(overlaySource, /const\s+pathname\s*=\s*usePathname\(\)/);
  assert.match(overlaySource, /pathname\s*===\s*"\/okey\/game"/);
  assert.match(overlaySource, /void\s+checkMemberships\(\)/);
});
