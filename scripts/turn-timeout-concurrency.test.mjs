import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const oneVsOneCommitContractSource = readFileSync(
  "domino/modes/one-vs-one/server/domino-one-vs-one-commit-contract.ts",
  "utf8",
);

const timeoutConflictSource = readFileSync(
  "domino/modes/one-vs-one/server/domino-one-vs-one-timeout-conflict.ts",
  "utf8",
);

const passSource = readFileSync(
  "supabase/functions/submit_one_vs_one/pass.ts",
  "utf8",
);

const twoVsTwoPassSource = readFileSync(
  "supabase/functions/submit_two_vs_two/pass.ts",
  "utf8",
);

const twoVsTwoHookSource = readFileSync(
  "domino/modes/two-vs-two/controllers/use-domino-two-vs-two-controller.ts",
  "utf8",
);

const twoVsTwoCommitContractSource = readFileSync(
  "domino/modes/two-vs-two/server/domino-two-vs-two-commit-contract.ts",
  "utf8",
);

const twoVsTwoTimeoutControllerSource = readFileSync(
  "domino/modes/two-vs-two/controllers/domino-two-vs-two-timeout-controller.ts",
  "utf8",
);

const apiSource = readFileSync(
  "domino/modes/two-vs-two/adapters/domino-two-vs-two-supabase-api.ts",
  "utf8",
);

const timeoutControllerSource = readFileSync(
  "domino/modes/one-vs-one/controllers/use-domino-one-vs-one-timeout-controller.ts",
  "utf8",
);

const dominoTurnTimerSource = readFileSync(
  "domino/shared/timing/domino-turn-timer.ts",
  "utf8",
);

const dominoPlayerSeatSource = readFileSync(
  "components/game/PlayerSeat.tsx",
  "utf8",
);

const dominoGameScreenSource = readFileSync(
  "app/domino/game.tsx",
  "utf8",
);

const oneVsOneEngineSource = readFileSync(
  "domino/modes/one-vs-one/engine/domino-one-vs-one-engine.ts",
  "utf8",
);

const aiPracticeControllerSource = readFileSync(
  "domino/modes/ai-practice/controllers/use-domino-ai-practice-controller.ts",
  "utf8",
);

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
  assert.match(passSource, /buildOneVsOnePassCommit/);
  assert.match(
    oneVsOneCommitContractSource,
    /p_expected_version: args\.expectedVersion/,
  );
  assert.match(passSource, /reconcileDominoOneVsOneCommit/);
  assert.match(
    timeoutConflictSource,
    /Number\(latestRoom\.version\) > args\.expectedVersion/,
  );
  assert.match(timeoutConflictSource, /"already_processed"/);
  assert.match(timeoutConflictSource, /"stale_timeout"/);
  assert.match(passSource, /serverNow:/);
  assert.match(passSource, /retryAfterMs\:/);
  assert.match(timeoutControllerSource, /serverClockOffsetMsRef/);
  assert.match(timeoutControllerSource, /passRetryRef/);
  assert.match(timeoutControllerSource, /clearPassRetry\(\)/);
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
    responses.filter((response) => response.code === "already_processed")
      .length,
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

  assert.match(twoVsTwoPassSource, /expectedVersion: room\.version/);
  assert.match(
    twoVsTwoCommitContractSource,
    /p_expected_version: args\.expectedVersion/,
  );
  assert.match(
    twoVsTwoPassSource,
    /Number\(latestRoom\.version\) > expectedVersion/,
  );
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

  assert.equal(
    responses.filter(({ code }) => code === "processed").length,
    1,
  );

  assert.equal(
    responses.filter(({ code }) => code === "already_processed").length,
    3,
  );

  assert.equal(atomicRoom.processedCount(), 1);
});

test("Domino human turn duration has one 25-second contract across every mode and UI", () => {
  assert.match(
    dominoTurnTimerSource,
    /DOMINO_HUMAN_TURN_DURATION_SECONDS = 25/,
  );

  assert.match(
    dominoTurnTimerSource,
    /DOMINO_HUMAN_TURN_DURATION_SECONDS \* 1_000/,
  );

  assert.match(passSource, /DOMINO_HUMAN_TURN_DURATION_MS/);
  assert.match(twoVsTwoPassSource, /DOMINO_HUMAN_TURN_DURATION_MS/);
  assert.match(oneVsOneEngineSource, /DOMINO_HUMAN_TURN_DURATION_MS/);
  assert.match(timeoutControllerSource, /projectDominoTurnSecondsLeft/);
  assert.match(
    twoVsTwoTimeoutControllerSource,
    /projectDominoTurnSecondsLeft/,
  );
  assert.match(
    aiPracticeControllerSource,
    /PLAYER_TURN_DURATION_SECONDS/,
  );
  assert.match(
    dominoPlayerSeatSource,
    /DOMINO_HUMAN_TURN_DURATION_SECONDS/,
  );
  assert.match(
    dominoGameScreenSource,
    /humanPlayer\.timeLeft \/ PLAYER_TURN_DURATION_SECONDS/,
  );

  assert.doesNotMatch(dominoGameScreenSource, /humanTurnTimerText/);
  assert.doesNotMatch(passSource, /TURN_DURATION_MS = 20_000/);
  assert.doesNotMatch(twoVsTwoPassSource, /TURN_DURATION_MS = 20_000/);
});