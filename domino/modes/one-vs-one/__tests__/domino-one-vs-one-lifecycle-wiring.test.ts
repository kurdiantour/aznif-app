import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const action of ["move", "draw", "pass"] as const) {
  test(`${action} delegates post-commit work to the 1v1 lifecycle`, () => {
    const source = readFileSync(
      `supabase/functions/submit_one_vs_one/${action}.ts`,
      "utf8",
    );
    assert.match(
      source,
      new RegExp(`runDominoOneVsOnePostCommitLifecycle\\(\\{ client: svc, action: "${action}"`),
    );
    assert.doesNotMatch(source, /svc\.rpc\(["']process_one_vs_one_turn_strikes/);
    assert.doesNotMatch(source, /svc\.rpc\(["']resolve_one_vs_one_round_leave_forfeits/);
  });
}
