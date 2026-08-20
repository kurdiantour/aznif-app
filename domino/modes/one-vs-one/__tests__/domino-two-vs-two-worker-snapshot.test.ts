import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const EXPECTED_TWO_VS_TWO_PLAY_BRANCH =
  "37bb709ed03ed4364cee429261e3aa64e549d7a10b68463beefe8cf6d710d645";

test("2v2 bot play branch stays byte-semantically unchanged", () => {
  const source = readFileSync("supabase/functions/process_bot_turns/index.ts", "utf8");
  const actionIndex = source.indexOf('      action = "bot_play_tile";');
  const branchStart = source.lastIndexOf('        const currentPlayer = players[playerIndex];', actionIndex);
  const branchEnd = source.lastIndexOf('\n        }', actionIndex) + '\n        }'.length;
  assert.ok(actionIndex > 0 && branchStart > 0 && branchEnd > branchStart, "2v2 play branch not found");
  const normalized = source.slice(branchStart, branchEnd).replace(/\s+/g, " ").trim();
  const fingerprint = createHash("sha256").update(normalized).digest("hex");
  assert.equal(fingerprint, EXPECTED_TWO_VS_TWO_PLAY_BRANCH);
});
