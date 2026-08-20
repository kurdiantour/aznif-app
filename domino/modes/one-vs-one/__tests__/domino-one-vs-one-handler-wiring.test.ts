import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handlers = [
  ["move", "buildOneVsOneMoveCommit"],
  ["draw", "buildOneVsOneDrawCommit"],
  ["pass", "buildOneVsOnePassCommit"],
] as const;

for (const [action, builder] of handlers) {
  test(`${action} handler delegates one typed payload to the commit core`, () => {
    const source = readFileSync(
      `supabase/functions/submit_one_vs_one/${action}.ts`,
      "utf8",
    );
    assert.doesNotMatch(source, /@ts-nocheck/);
    assert.match(source, new RegExp(`commitMultiplayerAction\\(svc, ${builder}\\(`));
    assert.equal(source.match(new RegExp(`${builder}\\(`, "g"))?.length, 1);
    assert.doesNotMatch(
      source,
      /commitMultiplayerAction\(svc,\s*["']commit_multiplayer_action["']/,
    );
  });
}
