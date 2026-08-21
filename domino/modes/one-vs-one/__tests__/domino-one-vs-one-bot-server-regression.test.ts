import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { describeDominoOneVsOneServerError } from "../server/domino-one-vs-one-server-error.ts";

test("terminal resolver expands the player row instead of casting a composite to uuid", () => {
  const migration = readFileSync(
    "supabase/migrations/20260820190000_fix_one_vs_one_terminal_resolver_player_row.sql",
    "utf8",
  );
  assert.match(migration, /SELECT player\.\*\s+INTO v_taken_over_player/);
  assert.doesNotMatch(migration, /SELECT player\s+INTO v_taken_over_player/);
});

test("plain Supabase errors retain their real diagnostic fields", () => {
  assert.deepEqual(
    describeDominoOneVsOneServerError({
      code: "22P02",
      message: "invalid input syntax for type uuid",
      details: "player composite received",
      hint: "select player.*",
    }),
    {
      code: "22P02",
      message: "invalid input syntax for type uuid",
      details: "player composite received",
      hint: "select player.*",
    },
  );
});
test("second timeout takes over the acting player without waiting for the next human turn", () => {
  const migration = readFileSync(
    "supabase/migrations/20260821131135_fix_one_vs_one_timeout_takeover_actor.sql",
    "utf8",
  );
  const functionBody = migration.match(
    /CREATE OR REPLACE FUNCTION public\.process_one_vs_one_turn_strikes\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";

  assert.match(
    functionBody,
    /RETURNING consecutive_timeout_strikes\s+INTO v_acting_strikes/,
  );
  assert.match(
    functionBody,
    /IF COALESCE\(v_acting_strikes, 0\) >= 2 THEN[\s\S]*?apply_one_vs_one_timeout_strike_takeover\([\s\S]*?p_acting_user_id/,
  );
  assert.doesNotMatch(
    functionBody,
    /WHERE room_id = p_room_id[\s\S]*?user_id = p_next_user_id/,
  );
});