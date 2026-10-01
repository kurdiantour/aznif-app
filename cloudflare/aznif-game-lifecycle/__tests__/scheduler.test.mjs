import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  AznifGameAlarm,
  parseLifecycleJob,
} from "../src/index.js";

const lifecycleJob = {
  gameType: "okey",
  matchId: "match-7",
  expectedVersion: 12,
  runAt: "2026-09-13T12:00:00.000Z",
};

test("public lifecycle alarm contract requires all four fields", () => {
  assert.deepEqual(parseLifecycleJob(lifecycleJob), lifecycleJob);
  for (const key of Object.keys(lifecycleJob)) {
    const invalid = { ...lifecycleJob };
    delete invalid[key];
    assert.equal(parseLifecycleJob(invalid), null);
  }
});

test("Durable Object identity is gameType:matchId", async () => {
  let durableName = null;
  let forwarded = null;
  const response = await worker.fetch(new Request("https://scheduler.test", {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(lifecycleJob),
  }), {
    AZNIF_LIFECYCLE_SECRET: "secret",
    GAME_MATCH_ALARMS: {
      idFromName(name) { durableName = name; return name; },
      get() { return { fetch(_url, init) { forwarded = JSON.parse(init.body); return new Response("ok"); } }; },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(durableName, "okey:match-7");
  assert.deepEqual(forwarded, lifecycleJob);
});

test("Okey alarm calls one version-bound authoritative transition", async () => {
  const records = new Map([["lifecycle_job", lifecycleJob]]);
  const storage = {
    get: async (key) => records.get(key),
    delete: async (key) => records.delete(key),
  };
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      ok: true,
      mode: "okey-lifecycle",
      result: {
        ok: true,
        executed: false,
        version: 12,
        nextRunAt: null,
        reason: "match_finished",
      },
    }), { headers: { "content-type": "application/json" } });
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
    run_at: lifecycleJob.runAt,
  });
  assert.equal(records.has("lifecycle_job"), false);
});


test("Okey alarm re-arms itself from authoritative continuation result", async () => {
  const records = new Map([["lifecycle_job", lifecycleJob]]);
  const alarms = [];
  const storage = {
    get: async (key) => records.get(key),
    put: async (key, value) => records.set(key, value),
    delete: async (key) => records.delete(key),
    setAlarm: async (value) => alarms.push(value),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    mode: "okey-lifecycle",
    result: {
      ok: true,
      executed: true,
      version: 13,
      nextRunAt: "2026-09-13T12:00:01.000Z",
      reason: "bot_executed",
    },
  }), { headers: { "content-type": "application/json" } });
  try {
    await new AznifGameAlarm({ storage }, {
      SUPABASE_URL: "https://project.supabase.co",
      AZNIF_LIFECYCLE_SECRET: "secret",
    }).alarm();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(records.get("lifecycle_job"), {
    gameType: "okey",
    matchId: "match-7",
    expectedVersion: 13,
    runAt: "2026-09-13T12:00:01.000Z",
  });
  assert.deepEqual(alarms, [Date.parse("2026-09-13T12:00:01.000Z")]);
});


test("Okey alarm throws on authoritative logical failure so Durable Object can retry", async () => {
  const records = new Map([["lifecycle_job", lifecycleJob]]);
  const storage = {
    get: async (key) => records.get(key),
    put: async (key, value) => records.set(key, value),
    delete: async (key) => records.delete(key),
    setAlarm: async () => {},
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    mode: "okey-lifecycle",
    result: {
      ok: false,
      executed: false,
      version: null,
      reason: "fetch_failed",
    },
  }), { headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      () => new AznifGameAlarm({ storage }, {
        SUPABASE_URL: "https://project.supabase.co",
        AZNIF_LIFECYCLE_SECRET: "secret",
      }).alarm(),
      /game_lifecycle_result_failed:fetch_failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(records.get("lifecycle_job"), lifecycleJob);
});

test("older alarm result cannot overwrite a newer human-scheduled lifecycle job", async () => {
  const newerJob = {
    gameType: "okey",
    matchId: "match-7",
    expectedVersion: 14,
    runAt: "2026-09-13T12:00:05.000Z",
  };
  const records = new Map([["lifecycle_job", lifecycleJob]]);
  const alarms = [];
  let reads = 0;
  const storage = {
    get: async (key) => {
      reads += 1;
      if (key === "lifecycle_job" && reads >= 2) {
        records.set("lifecycle_job", newerJob);
      }
      return records.get(key);
    },
    put: async (key, value) => records.set(key, value),
    delete: async (key) => records.delete(key),
    setAlarm: async (value) => alarms.push(value),
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    mode: "okey-lifecycle",
    result: {
      ok: true,
      executed: true,
      version: 13,
      nextRunAt: "2026-09-13T12:00:01.000Z",
      reason: "bot_executed",
    },
  }), { headers: { "content-type": "application/json" } });
  try {
    await new AznifGameAlarm({ storage }, {
      SUPABASE_URL: "https://project.supabase.co",
      AZNIF_LIFECYCLE_SECRET: "secret",
    }).alarm();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(records.get("lifecycle_job"), newerJob);
  assert.deepEqual(alarms, []);
});
