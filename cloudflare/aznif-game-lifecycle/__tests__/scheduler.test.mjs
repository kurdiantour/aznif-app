import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  AznifGameAlarm,
  parseWakeup,
} from "../src/index.js";

const wakeup = {
  gameType: "okey",
  matchId: "match-7",
  expectedVersion: 12,
  runAt: "2026-09-13T12:00:00.000Z",
};

test("public wake-up contract requires all four fields", () => {
  assert.deepEqual(parseWakeup(wakeup), wakeup);
  for (const key of Object.keys(wakeup)) {
    const invalid = { ...wakeup };
    delete invalid[key];
    assert.equal(parseWakeup(invalid), null);
  }
});

test("Durable Object identity is gameType:matchId", async () => {
  let durableName = null;
  let forwarded = null;
  const response = await worker.fetch(new Request("https://scheduler.test", {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(wakeup),
  }), {
    AZNIF_LIFECYCLE_SECRET: "secret",
    GAME_MATCH_ALARMS: {
      idFromName(name) { durableName = name; return name; },
      get() { return { fetch(_url, init) { forwarded = JSON.parse(init.body); return new Response("ok"); } }; },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(durableName, "okey:match-7");
  assert.deepEqual(forwarded, wakeup);
});

test("Okey alarm calls one version-bound authoritative transition", async () => {
  const records = new Map([["wakeup", wakeup]]);
  const storage = {
    get: async (key) => records.get(key),
    delete: async (key) => records.delete(key),
  };
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response("ok");
  };
  try {
    await new AznifGameAlarm({ storage }, {
      SUPABASE_URL: "https://project.supabase.co",
      AZNIF_LIFECYCLE_SECRET: "secret",
    }).alarm();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request.url, "https://project.supabase.co/functions/v1/process_bot_turns");
  assert.equal(request.init.headers["x-aznif-lifecycle-key"], "secret");
  assert.deepEqual(request.body, {
    mode: "okey",
    match_id: "match-7",
    expected_version: 12,
    run_at: wakeup.runAt,
  });
  assert.equal(records.has("wakeup"), false);
});
