import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGame } from "../engine.ts";
import { executeDamaLifecycle } from "../../supabase/functions/_shared/dama-lifecycle.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20261010211132_dama_authoritative_economy_lifecycle.sql", import.meta.url), "utf8");
const rewardsMigration = readFileSync(new URL("../../supabase/migrations/20261011000200_dama_fun_match_rewards.sql", import.meta.url), "utf8");
const waitingMigration = readFileSync(new URL("../../supabase/migrations/20261011000100_dama_waiting_countdown.sql", import.meta.url), "utf8");
const leaveTimeoutMigration = readFileSync(new URL("../../supabase/migrations/20261014000100_dama_manual_leave_forfeit.sql", import.meta.url), "utf8");
const timeoutContinuationMigration = readFileSync(new URL("../../supabase/migrations/20261015000600_dama_timeout_keeps_match_active.sql", import.meta.url), "utf8");
const action = readFileSync(new URL("../../supabase/functions/dama_action/index.ts", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../../supabase/functions/dama_lifecycle/index.ts", import.meta.url), "utf8");
const matchEdge = readFileSync(new URL("../../supabase/functions/dama_match/index.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../multiplayer/DamaOnlineGameScreen.tsx", import.meta.url), "utf8");
const multiplayerHook = readFileSync(new URL("../useDamaMultiplayer.ts", import.meta.url), "utf8");
const resume = readFileSync(new URL("../multiplayer/dama-resume-adapter.ts", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../../app/(tabs)/play.tsx", import.meta.url), "utf8");
const gameRoute = readFileSync(new URL("../../app/dama/game.tsx", import.meta.url), "utf8");

test("Dama lobby exposes only online matchmaking on the main Dama card", () => {
  assert.match(lobby, /pathname:\s*"\/dama\/game",\s*params:\s*\{\s*mode:\s*"online"\s*\}/);
  assert.doesNotMatch(lobby, /Practice vs Bot|secondaryActionLabel/);
  assert.match(gameRoute, /return <DamaOnlineGameScreen \/>;/);
  assert.doesNotMatch(gameRoute, /DamaLocalGameScreen|mode.*practice/);
  assert.match(multiplayerHook, /supabase\.functions\.invoke\("dama_match", \{ body: \{\} \}\)/);
  assert.match(ui, /WaitingPlayersPopup visible=\{waiting\}/);
});

test("leaving a waiting Dama match does not request a snapshot after membership is revoked", () => {
  const leave = multiplayerHook.match(/const cancelOrLeave = useCallback\([\s\S]*?\n  \}, \[matchId\]\);/)?.[0];
  assert.ok(leave, "cancelOrLeave callback exists");
  assert.match(leave, /action: "leave"/);
  assert.doesNotMatch(leave, /await refresh\(\)/);
  assert.match(ui, /await online\.cancelOrLeave\(\); router\.replace\("\/\(tabs\)\/play"\)/);
});

test("Dama charges each seat 500 Coin and pays exactly the winner 1000 with idempotent ledger keys", () => {
  assert.match(migration, /entry_fee integer NOT NULL DEFAULT 500 CHECK \(entry_fee = 500\)/);
  assert.match(migration, /total_entry integer NOT NULL DEFAULT 1000 CHECK \(total_entry = 1000\)/);
  assert.match(migration, /commission integer NOT NULL DEFAULT 0 CHECK \(commission = 0\)/);
  assert.match(migration, /coin=coin-500/);
  assert.match(migration, /coin=coin\+1000/);
  assert.match(migration, /dama:.*:entry:/);
  assert.match(migration, /dama:.*:prize:/);
  assert.match(migration, /IF v_economy\.settled_at IS NOT NULL THEN RETURN v_economy\.settlement/);
  assert.match(migration, /'type','no_winner'.*'payout',0/s);
  assert.match(migration, /insufficient_entry_balance/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.dama_cancel_and_refund/);
  assert.match(migration, /dama:.*:refund:/);
  assert.match(migration, /dama_match_not_refundable/);
  assert.match(matchEdge, /lifecycle_start_failed/);
});

test("Dama settlement mirrors Domino Fun rewards, clamps points, and skips rewards for no-winner results", () => {
  assert.match(rewardsMigration, /PRIMARY KEY \(match_id,user_id\)/);
  assert.match(rewardsMigration, /v_points:=35/);
  assert.match(rewardsMigration, /v_gems:=10/);
  assert.match(rewardsMigration, /v_points:=-15/);
  assert.match(rewardsMigration, /GREATEST\(0,COALESCE\(points,0\)\+v_points\)/);
  assert.match(rewardsMigration, /IF v_economy\.settled_at IS NOT NULL THEN RETURN v_economy\.settlement/);
  assert.match(rewardsMigration, /'type','no_winner'[\s\S]*?'pointDelta',0,'gemDelta',0/);
  assert.match(ui, /winnerGemDelta \?\? 10/);
  assert.match(ui, /winnerPointDelta \?\? 35/);
  assert.match(ui, /loserPointDelta \?\? -15/);
});

test("Dama timeout takeover keeps the match active and can be restored", () => {
  assert.match(migration, /consecutive_timeout_strikes integer NOT NULL DEFAULT 0/);
  assert.match(migration, /consecutive_timeout_strikes\+1>=2/);
  assert.match(migration, /v_match\.version<>p_expected_version/);
  assert.match(timeoutContinuationMigration, /IF p_action = 'timeout-move' THEN/);
  assert.match(timeoutContinuationMigration, /ELSE 'active'/);
  assert.doesNotMatch(timeoutContinuationMigration, /both-bot-takeover|v_bots\s*=\s*2/);
  assert.match(leaveTimeoutMigration, /CREATE OR REPLACE FUNCTION public\.dama_restore_control/);
  assert.match(action, /action !== "move"/);
  assert.match(readFileSync(new URL("../../supabase/functions/_shared/dama-lifecycle.ts", import.meta.url), "utf8"), /resolveTurnTimeout\(state, now\)/);
  assert.match(lifecycle, /executeDamaLifecycle/);
  assert.doesNotMatch(ui, /myPlayer\?\.botTakeover[\s\S]*?router\.replace\("\/\(tabs\)\/play"\)/);
  assert.match(ui, /timeoutLobbyRedirectedMatch\.current = online\.snapshot\.id;[\s\S]*?router\.replace\("\/\(tabs\)\/play"\)/);
  assert.doesNotMatch(ui, /restoreControlButton|action: "restore", match_id: online\.matchId/);
  assert.match(resume, /Always call the server on resume[\s\S]*body: \{ action: "restore", match_id: match\.matchId \}/);
  assert.match(waitingMigration, /GRANT USAGE ON SCHEMA multiplayer_private TO service_role/);
  assert.doesNotMatch(ui, /75_000/);
});

test("Dama manual leave forfeits permanently while timeout takeover remains restorable", () => {
  const restore = leaveTimeoutMigration.match(/CREATE OR REPLACE FUNCTION public\.dama_restore_control[\s\S]*?\$\$;/)?.[0];
  const leave = leaveTimeoutMigration.match(/CREATE OR REPLACE FUNCTION public\.dama_leave_match[\s\S]*?\$\$;/)?.[0];
  assert.ok(restore);
  assert.ok(leave);
  assert.match(restore, /AND bot_takeover AND NOT manual_left/);
  assert.match(restore, /dama_timeout_takeover_not_restorable/);
  assert.match(restore, /'restore-control'/);
  assert.match(leave, /manual_left = true, connected = false, left_at = clock_timestamp\(\)/);
  assert.match(leave, /'manual-leave'/);
  assert.doesNotMatch(leave, /'timeout-move'/);
  assert.match(leave, /dama_settle_match\(p_match_id\)/);
});

test("online Dama reuses the common result popup and shows the fixed stake while waiting", () => {
  assert.match(ui, /import GameOverPopup from "@\/domino\/components\/GameOverPopup"/);
  assert.match(ui, /entryFee=\{500\}/);
  assert.doesNotMatch(ui, /Finding a Dama opponent/);
  assert.match(ui, /online\.snapshot\?\.settlement/);
  assert.match(ui, /AsyncStorage\.getItem\(key\)/);
  assert.match(ui, /onClose=\{\(\) => \{ dismissResult\(\); router\.replace\("\/\(tabs\)\/play"\); \}\}/);
  assert.match(resume, /body: \{ action: "restore", match_id: match\.matchId \}/);
  assert.match(resume, /body: \{ action: "leave", match_id: match\.matchId \}/);
});

test("server lifecycle commits one due timeout with no client request and schedules the next version", async () => {
  const initial = createGame(0);
  const next = { ...initial, ply: 1, turn: "black" as const, turnStartedAtMs: 15_000, turnDeadlineAtMs: 30_000,
    timeoutStrikes: { cream: 1 } };
  const players = [
    { user_id: "cream-user", piece_color: "cream", bot_takeover: false, consecutive_timeout_strikes: 0 },
    { user_id: "black-user", piece_color: "black", bot_takeover: false, consecutive_timeout_strikes: 0 },
  ];
  const calls: any[] = [];
  const service = {
    from(table: string) {
      const query: any = { select() { return this; }, eq() { return this; }, is() { return this; },
        maybeSingle: async () => ({ data: { id: "match-1", status: "active", version: 7, state: initial, current_turn_user_id: "cream-user" }, error: null }),
        single: async () => ({ data: null, error: null }) };
      if (table === "dama_match_players") query.is = async () => ({ data: players.map((player) => ({ ...player })), error: null });
      return query;
    },
    async rpc(name: string, payload: any) {
      calls.push({ name, payload });
      return { data: { id: "match-1", status: "active", version: 8, state: next, current_turn_user_id: "black-user" }, error: null };
    },
  };
  const originalFetch = globalThis.fetch;
  const originalDeno = (globalThis as any).Deno;
  let scheduled: any = null;
  (globalThis as any).Deno = { env: { get: (key: string) => key === "AZNIF_GAME_LIFECYCLE_URL" ? "https://scheduler.test" : key === "AZNIF_LIFECYCLE_SECRET" ? "secret" : undefined } };
  globalThis.fetch = async (_url, init) => { scheduled = JSON.parse(String(init?.body)); return new Response("{}", { status: 200 }); };
  try {
    const result = await executeDamaLifecycle({ service, matchId: "match-1", expectedVersion: 7, nowMs: 15_000 });
    assert.equal(result.executed, true);
    assert.equal(result.reason, "timeout_executed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.p_action, "timeout-move");
    assert.equal(calls[0].payload.p_expected_version, 7);
    assert.equal(scheduled.gameType, "dama");
    assert.equal(scheduled.expectedVersion, 8);
    assert.equal(Date.parse(scheduled.runAt), 30_000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete (globalThis as any).Deno;
    else (globalThis as any).Deno = originalDeno;
  }
});
