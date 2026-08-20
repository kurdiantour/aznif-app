import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("1v1 hook delegates persistence, realtime and commands to its game adapter", () => {
  const source = readFileSync("domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts", "utf8");
  for (const forbidden of [
    "@/lib/supabase",
    ".from(",
    ".rpc(",
    ".channel(",
    "submit_one_vs_one",
    "process_bot_turns",
  ]) {
    assert.equal(source.includes(forbidden), false, `hook leaked infrastructure: ${forbidden}`);
  }

  for (const controller of [
    "useDominoOneVsOneConnectionController",
    "useDominoOneVsOneBotController",
    "useDominoOneVsOneTimeoutController",
    "useDominoOneVsOneRoundSync",
  ]) {
    assert.equal(source.includes(controller), true, `missing controller delegation: ${controller}`);
  }

  for (const orchestrationLeak of [
    "setInterval", "setTimeout", "AppState", ".subscribe(", "processBotTurn",
    "RealtimeReconnectPolicy", "turn_timer_not_expired",
  ]) {
    assert.equal(source.includes(orchestrationLeak), false, `hook leaked orchestration: ${orchestrationLeak}`);
  }
});

test("legacy multiplayer API has no Domino 1v1 endpoint exports", () => {
  const source = readFileSync("lib/multiplayer/multiplayerApi.ts", "utf8");
  assert.doesNotMatch(source, /submitOneVsOne/);
  assert.doesNotMatch(source, /submit_one_vs_one/);
  assert.match(source, /submitTwoVsTwoMove/);
  assert.match(source, /submitTwoVsTwoPass/);
});
test("1v1 screen and preload contain no direct persistence endpoint", () => {
  const screen = readFileSync("app/domino/game.tsx", "utf8");
  assert.doesNotMatch(screen, /one_vs_one_(rooms|players|moves)/);
  assert.doesNotMatch(screen, /(start|leave)_one_vs_one/);

  const preload = readFileSync("lib/game/gameLaunchPreload.ts", "utf8");
  assert.doesNotMatch(preload, /one_vs_one_(rooms|players|moves)/);
  assert.doesNotMatch(preload, /(start|get)_one_vs_one/);
  assert.match(preload, /SupabaseDominoOneVsOneAdapter\(roomId\)\.prepareLaunch\(\)/);
});
test("timeout takeover is strike-driven and has no heartbeat or worker watchdog", () => {
  const hook = readFileSync("domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts", "utf8");
  const botController = readFileSync("domino/modes/one-vs-one/controllers/use-domino-one-vs-one-bot-controller.ts", "utf8");
  const connectionController = readFileSync("domino/modes/one-vs-one/controllers/use-domino-one-vs-one-connection-controller.ts", "utf8");
  assert.doesNotMatch(hook + botController + connectionController, /heartbeat/i);
  assert.doesNotMatch(hook + botController + connectionController, /takeoverWatchdog/);
  assert.equal((botController.match(/processBotTurn\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(hook, /processBotTurn\(\)/);
  assert.match(connectionController, /Date\.now\(\) - lastActivityRef\.current < 12_000/);
  assert.match(connectionController, /refreshPlayers\(false\)/);

  const migration = readFileSync(
    "supabase/migrations/20260819000100_domino_timeout_takeover.sql",
    "utf8",
  );
  assert.match(migration, /consecutive_timeout_strikes = consecutive_timeout_strikes \+ 1/);
  assert.match(migration, /IF COALESCE\(v_next_strikes, 0\) >= 2 THEN/);
  assert.match(migration, /apply_one_vs_one_timeout_strike_takeover/);
  assert.match(migration, /Heartbeat \/ presence \/ reconnect \/ disconnect are intentionally NOT defined here/);
});
test("Domino module owns 1v1 while legacy paths remain compatibility-only", () => {
  const hook = readFileSync("domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts", "utf8");
  assert.doesNotMatch(hook, /@\/lib\/domino\/one-vs-one|@\/hooks\/useOneVsOneGame/);

  assert.equal(existsSync("hooks/useOneVsOneGame.ts"), false);
  assert.equal(existsSync("lib/domino/one-vs-one"), false);

  const legacyEngine = readFileSync("lib/game/kozel-engine.ts", "utf8").trim();
  assert.equal(legacyEngine, 'export * from "@/domino/core/engine/kozel-engine";');

  assert.equal(existsSync("domino/modes/two-vs-two"), true);
  const twoVsTwo = readFileSync("domino/modes/two-vs-two/presentation/use-two-vs-two-game.ts", "utf8");
  assert.match(twoVsTwo, /@\/domino\/core\/engine\/kozel-engine/);
  assert.match(twoVsTwo, /mode: '2v2'/);

  const screen = readFileSync("app/domino/game.tsx", "utf8");
  assert.match(screen, /@\/domino\/modes\/one-vs-one\/presentation\/use-one-vs-one-game/);
  const edgeHandler = readFileSync("supabase/functions/submit_one_vs_one/index.ts", "utf8");
  assert.match(edgeHandler, /domino\/modes\/one-vs-one/);
});