import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  chooseBotDiscardTile,
  createSeededOkeyBotRandom,
  getOkeyBotProfile,
  handSeatToBot,
  isOkeyBotControlled,
  playBotTurn,
  prepareBotTurn,
} from "../okey-bot-engine.ts";
import { createInitialOkeyGame } from "../okey-engine.ts";

test("difficulty profiles are ordered and remove the old long artificial delay", () => {
  const easy = getOkeyBotProfile("easy");
  const normal = getOkeyBotProfile("normal");
  const hard = getOkeyBotProfile("hard");

  assert.ok(easy.thinkDelayMs > normal.thinkDelayMs);
  assert.ok(normal.thinkDelayMs > hard.thinkDelayMs);
  assert.ok(easy.thinkDelayMs <= 1_000);
  assert.ok(easy.candidateWindow > hard.candidateWindow);
});

test("seeded bot decisions are reproducible", () => {
  const state = createInitialOkeyGame(1, createSeededOkeyBotRandom(17));
  const first = prepareBotTurn(state, { difficulty: "easy", random: createSeededOkeyBotRandom(91) });
  const second = prepareBotTurn(state, { difficulty: "easy", random: createSeededOkeyBotRandom(91) });

  assert.deepEqual(first.decision, second.decision);
  assert.deepEqual(first.state, second.state);
});

test("takeover assigns a stable independent Bot identity without changing seat ownership or hand", () => {
  const state = createInitialOkeyGame(1, createSeededOkeyBotRandom(4));
  const identity = state.players[0].id;
  const humanName = state.players[0].name;
  const handIds = state.players[0].hand.map((tile) => tile.id);
  const controlled = handSeatToBot(state, 0, "hard");
  const repeated = handSeatToBot(controlled, 0, "hard");

  assert.equal(isOkeyBotControlled(controlled.players[0]), true);
  assert.equal(controlled.players[0].kind, "bot");
  assert.equal(controlled.players[0].id, identity);
  assert.notEqual(controlled.players[0].name, humanName);
  assert.equal(controlled.players[0].name, `Bot ${controlled.players[0].botNumber}`);
  assert.ok((controlled.players[0].botNumber ?? 0) >= 300);
  assert.equal(repeated.players[0].name, controlled.players[0].name);
  assert.equal(repeated.players[0].botNumber, controlled.players[0].botNumber);
  assert.deepEqual(controlled.players[0].hand.map((tile) => tile.id), handIds);
});

test("bot evaluation stays bounded on complex hands", () => {
  const startedAt = performance.now();
  for (let seed = 1; seed <= 100; seed += 1) {
    const state = createInitialOkeyGame(seed % 4, createSeededOkeyBotRandom(seed));
    const playerIndex = state.currentPlayerIndex;
    state.players[playerIndex] = { ...state.players[playerIndex], kind: "bot", botDifficulty: "hard" };
    chooseBotDiscardTile({ ...state, hasDrawnThisTurn: true }, { difficulty: "hard" });
  }
  assert.ok(performance.now() - startedAt < 10_000);
});

test("bot turns always progress and do not enter a move loop", () => {
  let state = createInitialOkeyGame(0, createSeededOkeyBotRandom(2026));
  state = {
    ...state,
    players: state.players.map((player) => ({ ...player, kind: "bot" as const, botDifficulty: "hard" as const })),
  };

  for (let turn = 0; turn < 300 && state.phase === "playing"; turn += 1) {
    const before = JSON.stringify(state);
    const next = playBotTurn(state, { difficulty: "hard" });
    assert.notEqual(JSON.stringify(next), before);
    state = next;
  }
});
