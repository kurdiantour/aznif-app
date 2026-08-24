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

test("Domino command APIs are mode-owned and absent from generic Multiplayer", () => {
  assert.equal(existsSync("lib/multiplayer/multiplayerApi.ts"), false);
  const twoVsTwoApi = readFileSync(
    "domino/modes/two-vs-two/adapters/domino-two-vs-two-supabase-api.ts",
    "utf8",
  );
  assert.match(twoVsTwoApi, /submitDominoTwoVsTwoMove/);
  assert.match(twoVsTwoApi, /submitDominoTwoVsTwoPass/);
  assert.doesNotMatch(twoVsTwoApi, /submitOneVsOne|submit_one_vs_one/);
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
  const timeoutController = readFileSync("domino/modes/one-vs-one/controllers/use-domino-one-vs-one-timeout-controller.ts", "utf8");
  assert.doesNotMatch(hook + botController + connectionController, /heartbeat/i);
  assert.doesNotMatch(hook + botController + connectionController, /takeoverWatchdog/);
  assert.equal((botController.match(/processBotTurn\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(hook, /processBotTurn\(\)/);
  assert.match(connectionController, /now - lastActivityRef\.current >= 12_000/);
  assert.match(connectionController, /refreshPlayers\(false\)/);
  assert.match(timeoutController, /if \(args\.rawState\) acceptSnapshot\(args\.rawState\)/);

  const migration = readFileSync(
    "supabase/migrations/20260819000100_domino_timeout_takeover.sql",
    "utf8",
  );
  assert.match(migration, /consecutive_timeout_strikes = consecutive_timeout_strikes \+ 1/);
  assert.match(migration, /IF COALESCE\(v_acting_strikes, 0\) >= 2 THEN/);
  assert.match(migration, /apply_one_vs_one_timeout_strike_takeover/);
  assert.match(migration, /Heartbeat \/ presence \/ reconnect \/ disconnect are intentionally NOT defined here/);
});

test("1v1 roster sync is realtime-driven with an independent stale watchdog", () => {
  const connectionController = readFileSync(
    "domino/modes/one-vs-one/controllers/use-domino-one-vs-one-connection-controller.ts",
    "utf8",
  );
  const adapter = readFileSync(
    "domino/modes/one-vs-one/adapters/supabase-domino-one-vs-one-adapter.ts",
    "utf8",
  );

  assert.doesNotMatch(connectionController, /reconcileTakeoverRoster/);
  assert.doesNotMatch(connectionController, /takeoverRosterInFlightRef/);
  assert.doesNotMatch(connectionController, /, 2_000\)/);
  assert.match(adapter, /table: "one_vs_one_players"/);
  assert.match(adapter, /observer\.onRosterInvalidated\(\)/);
  assert.match(
    connectionController,
    /onRosterInvalidated:[\s\S]*?lastRosterActivityRef\.current = Date\.now\(\);[\s\S]*?refreshPlayers\(\)/,
  );
  assert.match(
    connectionController,
    /const rosterIsStale = now - lastRosterActivityRef\.current >= 12_000/,
  );
  assert.match(
    connectionController,
    /snapshotIsStale[\s\S]*?Promise\.all\(\[refreshSnapshot\(\), refreshPlayers\(false\)\]\)[\s\S]*?: refreshPlayers\(false\)/,
  );
});

test("1v1 presentation preserves the authoritative Qapat end reason", () => {
  const presentation = readFileSync(
    "domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts",
    "utf8",
  );
  assert.match(
    presentation,
    /buildRoundResult\(\{[\s\S]*?endReason: rawState\?\.roundEndReason \?\? undefined/,
  );
});

test("Domino module owns canonical core paths and legacy shims are removed", () => {
  const hook = readFileSync("domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts", "utf8");
  assert.doesNotMatch(hook, /@\/lib\/domino\/one-vs-one|@\/hooks\/useOneVsOneGame/);

  assert.equal(existsSync("hooks/useOneVsOneGame.ts"), false);
  assert.equal(existsSync("lib/domino/one-vs-one"), false);

  for (const legacyPath of [
    "lib/game/bot-ai.ts",
    "lib/game/king-rules.ts",
    "lib/game/kozel-engine.ts",
    "lib/game/match-rules.ts",
    "lib/game/turn-order.ts",
    "lib/domino/deal.ts",
    "lib/domino/shuffle.ts",
  ]) assert.equal(existsSync(legacyPath), false, legacyPath);

  assert.equal(existsSync("domino/modes/two-vs-two"), true);
  const twoVsTwo = readFileSync("domino/modes/two-vs-two/controllers/use-domino-two-vs-two-controller.ts", "utf8");
  assert.match(twoVsTwo, /@\/domino\/core\/engine\/kozel-engine/);
  assert.match(twoVsTwo, /mode: '2v2'/);

  const screen = readFileSync("app/domino/game.tsx", "utf8");
  assert.match(screen, /@\/domino\/modes\/one-vs-one\/presentation\/use-one-vs-one-game/);
  const edgeHandler = readFileSync("supabase/functions/submit_one_vs_one/index.ts", "utf8");
  assert.match(edgeHandler, /domino\/modes\/one-vs-one/);
});

