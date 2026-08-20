import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260820115805_domino_one_vs_one_timeout_terminal_round.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/20260820115805_domino_one_vs_one_timeout_terminal_round.rollback.sql",
  "utf8",
);
const strikePolicy = readFileSync(
  "supabase/migrations/20260819000100_domino_timeout_takeover.sql",
  "utf8",
);

function functionBody(name: string) {
  const match = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`),
  );
  assert.ok(match, `missing SQL function ${name}`);
  return match[0];
}

test("second timeout records one atomic idempotent terminal event", () => {
  const apply = functionBody("apply_one_vs_one_timeout_strike_takeover");
  assert.match(strikePolicy, /IF COALESCE\(v_next_strikes, 0\) >= 2 THEN/);
  assert.match(apply, /FROM public\.one_vs_one_rooms[\s\S]*FOR UPDATE/);
  assert.match(apply, /UPDATE public\.one_vs_one_players[\s\S]*AND bot_takeover = false/);
  assert.match(apply, /IF FOUND THEN[\s\S]*IF NOT EXISTS/);
  assert.match(apply, /takeover_event\.action = 'timeout_takeover'/);
  assert.match(apply, /'timeout_takeover'[\s\S]*'timeout_strikes', 2/);
});

test("Manual Leave and timeout use the same shared terminal-round resolver", () => {
  const gameResolver = functionBody("resolve_one_vs_one_terminal_round");
  const sharedResolver = functionBody("resolve_multiplayer_terminal_round");
  const legacyAdapter = functionBody("resolve_one_vs_one_round_leave_forfeits");
  const trigger = functionBody("finalize_one_vs_one_takeover_after_round");

  assert.match(
    gameResolver,
    /move\.action IN \('manual_leave_takeover', 'timeout_takeover'\)/,
  );
  assert.match(sharedResolver, /p_game = 'domino' AND p_mode = '1v1'/);
  assert.match(sharedResolver, /resolve_one_vs_one_terminal_round\(p_room_id\)/);
  assert.match(legacyAdapter, /resolve_multiplayer_terminal_round\('domino', '1v1', p_room_id\)/);
  assert.match(trigger, /resolve_multiplayer_terminal_round\('domino', '1v1', NEW\.id\)/);
});

test("Manual Leave keeps its production terminal and settlement contract", () => {
  const resolver = functionBody("resolve_one_vs_one_terminal_round");
  assert.match(resolver, /v_takeover_action = 'manual_leave_takeover'/);
  assert.match(resolver, /v_forfeit_reason := 'player_left'/);
  assert.match(resolver, /v_finish_reason := 'opponent_left'/);
  assert.match(resolver, /v_terminal_move_action := 'round_end_leave_forfeit'/);
  const manualBranch = resolver.match(/IF v_takeover_action = 'manual_leave_takeover' THEN([\s\S]*?)ELSE/)?.[1] ?? "";
  assert.doesNotMatch(manualBranch, /takeover_action/);
  assert.match(resolver, /public\.domino_settle_match\('1v1', p_room_id\)/);
  assert.match(resolver, /'onlineMatchResultReward', v_settlement/);
});

test("timeout takeover finishes only after the current round with distinct reason", () => {
  const resolver = functionBody("resolve_one_vs_one_terminal_round");
  assert.match(resolver, /v_room\.state ->> 'roundWinnerPlayerId'/);
  assert.match(resolver, /v_forfeit_reason := 'consecutive_timeouts'/);
  assert.match(resolver, /v_finish_reason := 'opponent_timeout_takeover'/);
  assert.match(resolver, /v_terminal_move_action := 'round_end_timeout_forfeit'/);
  assert.match(resolver, /'winningTeamId', v_winning_team/);
  assert.match(resolver, /SET status = 'finished'/);
});

test("presence and unsupported game modes cannot create terminal effects", () => {
  const resolver = functionBody("resolve_one_vs_one_terminal_round");
  assert.doesNotMatch(migration, /heartbeat|last_seen_at|takeover_watchdog/i);
  assert.doesNotMatch(resolver, /connected_at|disconnected_at|last_seen_at/i);
  assert.match(
    resolver,
    /move\.action IN \('manual_leave_takeover', 'timeout_takeover'\)/,
  );
  assert.match(migration, /unsupported_terminal_round_scope/);
  assert.doesNotMatch(migration, /two_vs_two_(rooms|players|moves)/);
  assert.doesNotMatch(migration, /okey_/i);
  assert.equal((migration.match(/SET search_path = ''/g) ?? []).length, 5);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_multiplayer_terminal_round/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_multiplayer_terminal_round[\s\S]*TO service_role/);
});

test("migration has an executable rollback to the exact legacy policy", () => {
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.apply_one_vs_one_timeout_strike_takeover/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.resolve_one_vs_one_round_leave_forfeits/);
  assert.match(rollback, /ml\.action = 'manual_leave_takeover'/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.resolve_multiplayer_terminal_round/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.resolve_one_vs_one_terminal_round/);
  assert.doesNotMatch(rollback, /move\.action IN \('manual_leave_takeover', 'timeout_takeover'\)/);
});