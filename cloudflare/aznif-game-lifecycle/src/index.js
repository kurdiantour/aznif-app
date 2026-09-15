const JOB_KEY = "lifecycle_job";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function parseLifecycleJob(value) {
  if (!value || typeof value !== "object") return null;
  const { gameType, matchId, expectedVersion, runAt } = value;
  if (typeof gameType !== "string" || !/^[a-z][a-z0-9-]*$/.test(gameType)) return null;
  if (typeof matchId !== "string" || !matchId) return null;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return null;
  if (typeof runAt !== "string" || !Number.isFinite(Date.parse(runAt))) return null;
  return { gameType, matchId, expectedVersion, runAt };
}

function lifecycleRequest(env, lifecycleJob) {
  switch (lifecycleJob.gameType) {
    case "okey":
      return {
        url: `${env.SUPABASE_URL}/functions/v1/process_bot_turns`,
        body: {
          mode: "okey",
          match_id: lifecycleJob.matchId,
          expected_version: lifecycleJob.expectedVersion,
          run_at: lifecycleJob.runAt,
        },
      };
    default:
      throw new Error(`unsupported_game_type:${lifecycleJob.gameType}`);
  }
}

export class AznifGameAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
    const lifecycleJob = parseLifecycleJob(await request.json().catch(() => null));
    if (!lifecycleJob) return json({ error: "invalid_lifecycle_job" }, 400);
    const current = await this.state.storage.get(JOB_KEY);
    if (current && current.expectedVersion > lifecycleJob.expectedVersion) {
      return json({ scheduled: false, reason: "newer_version_already_scheduled" });
    }
    await this.state.storage.put(JOB_KEY, lifecycleJob);
    await this.state.storage.setAlarm(Date.parse(lifecycleJob.runAt));
    return json({ scheduled: true });
  }

  async alarm() {
    const lifecycleJob = await this.state.storage.get(JOB_KEY);
    if (!lifecycleJob) return;
    const target = lifecycleRequest(this.env, lifecycleJob);
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aznif-lifecycle-key": this.env.AZNIF_LIFECYCLE_SECRET,
      },
      body: JSON.stringify(target.body),
    });
    if (!response.ok) {
      throw new Error(`game_lifecycle_alarm_failed:${response.status}:${await response.text()}`);
    }
    const latest = await this.state.storage.get(JOB_KEY);
    if (
      latest?.gameType === lifecycleJob.gameType &&
      latest?.expectedVersion === lifecycleJob.expectedVersion
    ) {
      await this.state.storage.delete(JOB_KEY);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (request.headers.get("authorization") !== `Bearer ${env.AZNIF_LIFECYCLE_SECRET}`) {
      return json({ error: "unauthorized" }, 401);
    }
    const lifecycleJob = parseLifecycleJob(await request.json().catch(() => null));
    if (!lifecycleJob) return json({ error: "invalid_lifecycle_job" }, 400);
    const durableId = `${lifecycleJob.gameType}:${lifecycleJob.matchId}`;
    const stub = env.GAME_MATCH_ALARMS.get(env.GAME_MATCH_ALARMS.idFromName(durableId));
    return stub.fetch("https://alarm.internal/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lifecycleJob),
    });
  },
};
