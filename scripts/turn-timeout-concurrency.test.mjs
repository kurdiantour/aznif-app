import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const passSource = readFileSync(
  "supabase/functions/submit_one_vs_one/pass.ts",
  "utf8",
);
const twoVsTwoPassSource = readFileSync(
  "supabase/functions/submit_two_vs_two/pass.ts",
  "utf8",
);
const twoVsTwoHookSource = readFileSync("hooks/useTwoVsTwoGame.ts", "utf8");
const okeyMatchSource = readFileSync(
  "supabase/functions/okey_match/index.ts",
  "utf8",
);
const okeyAdapterSource = readFileSync(
  "okey/adapters/supabase-okey-match-adapter.ts",
  "utf8",
);
const apiSource = readFileSync(
  "lib/multiplayer/multiplayerApi.ts",
  "utf8",
);
const hookSource = readFileSync("hooks/useOneVsOneGame.ts", "utf8");

const EXPECTED_CODES = new Set([
  "turn_timer_not_expired",
  "stale_timeout",
  "already_processed",
]);

function createAtomicTimeoutRoom() {
  let room = {
    version: 41,
    turnStartedAt: "2026-08-12T10:00:00.000Z",
    currentTurnPlayerId: "player-a",
    processed: 0,
  };

  return {
    snapshot: () => ({ ...room }),
    claim: async (claim) => {
      await Promise.resolve();
      if (claim.expectedVersion !== room.version) {
        return {
          code:
            claim.expectedVersion < room.version
              ? "already_processed"
              : "stale_timeout",
        };
      }
      if (
        claim.expectedTurnStartedAt !== room.turnStartedAt ||
        claim.expectedTurnPlayerId !== room.currentTurnPlayerId
      ) {
        return { code: "stale_timeout" };
      }

      room = {
        ...room,
        version: room.version + 1,
        turnStartedAt: "2026-08-12T10:00:20.000Z",
        currentTurnPlayerId: "player-b",
        processed: room.processed + 1,
      };
      return { code: "processed" };
    },
    processedCount: () => room.processed,
  };
}

test("timeout protocol exposes stable expected codes without warning them", () => {
  for (const code of EXPECTED_CODES) {
    assert.match(passSource, new RegExp(`"${code}"`));
    assert.match(apiSource, new RegExp(`"${code}"`));
  }
  assert.match(passSource, /expected_version: expectedVersionRaw/);
  assert.match(passSource, /p_expected_version: room\.version/);
  assert.match(passSource, /Number\(latestRoom\.version\) > expectedVersion/);
  assert.match(passSource, /serverNow:/);
  assert.match(passSource, /retryAfterMs:/);
  assert.match(hookSource, /serverClockOffsetMsRef/);
  assert.match(hookSource, /timeoutRetryRef/);
  assert.match(hookSource, /clearTimeoutRetry\(\)/);
});

test("simultaneous timeout claims commit once and become already_processed", async () => {
  const atomicRoom = createAtomicTimeoutRoom();
  const snapshot = atomicRoom.snapshot();
  const claim = {
    expectedVersion: snapshot.version,
    expectedTurnStartedAt: snapshot.turnStartedAt,
    expectedTurnPlayerId: snapshot.currentTurnPlayerId,
  };

  const responses = await Promise.all(
    Array.from({ length: 8 }, () => atomicRoom.claim(claim)),
  );

  assert.equal(
    responses.filter((response) => response.code === "processed").length,
    1,
  );
  assert.equal(
    responses.filter((response) => response.code === "already_processed").length,
    7,
  );
  assert.equal(atomicRoom.processedCount(), 1);
});

test("a mismatched turn identity is stale_timeout", async () => {
  const atomicRoom = createAtomicTimeoutRoom();
  const snapshot = atomicRoom.snapshot();
  const response = await atomicRoom.claim({
    expectedVersion: snapshot.version,
    expectedTurnStartedAt: snapshot.turnStartedAt,
    expectedTurnPlayerId: "different-player",
  });
  assert.equal(response.code, "stale_timeout");
  assert.equal(atomicRoom.processedCount(), 0);
});
test("Domino 2v2 exposes the atomic timeout protocol for four clients", async () => {
  for (const code of EXPECTED_CODES) {
    assert.match(twoVsTwoPassSource, new RegExp(`"${code}"`));
  }
  assert.match(twoVsTwoPassSource, /p_expected_version: room\.version/);
  assert.match(twoVsTwoPassSource, /Number\(latestRoom\.version\) > expectedVersion/);
  assert.match(twoVsTwoHookSource, /serverClockOffsetMsRef/);
  assert.match(twoVsTwoHookSource, /timeoutRetryRef/);

  const atomicRoom = createAtomicTimeoutRoom();
  const snapshot = atomicRoom.snapshot();
  const claim = {
    expectedVersion: snapshot.version,
    expectedTurnStartedAt: snapshot.turnStartedAt,
    expectedTurnPlayerId: snapshot.currentTurnPlayerId,
  };
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => atomicRoom.claim(claim)),
  );
  assert.equal(responses.filter(({ code }) => code === "processed").length, 1);
  assert.equal(responses.filter(({ code }) => code === "already_processed").length, 3);
  assert.equal(atomicRoom.processedCount(), 1);
});

test("Okey timeout uses server deadline and atomic expectedVersion", () => {
  for (const code of EXPECTED_CODES) {
    assert.match(okeyMatchSource, new RegExp(`"${code}"`));
  }
  assert.match(okeyMatchSource, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(okeyMatchSource, /serverNow: new Date\(\)\.toISOString\(\)/);
  assert.match(okeyMatchSource, /retryAfterMs: Math\.max/);
  assert.match(okeyAdapterSource, /serverClockOffsetMs/);
  assert.match(okeyAdapterSource, /deadlineMs -\s*\(Date\.now\(\) \+ this\.serverClockOffsetMs\)/);
  assert.doesNotMatch(okeyAdapterSource, /deadlineMs -\s*Date\.now\(\) \+\s*150/);
});
