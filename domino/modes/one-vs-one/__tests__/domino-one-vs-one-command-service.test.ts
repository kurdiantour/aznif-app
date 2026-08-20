import assert from "node:assert/strict";
import test from "node:test";

import { DominoOneVsOneCommandService } from "../server/domino-one-vs-one-command-service.ts";

function request(body: unknown, method = "POST") {
  return new Request("https://example.test/functions/v1/submit_one_vs_one", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function service(calls: string[]) {
  const handler = (name: string) => async () => {
    calls.push(name);
    return Response.json({ handler: name });
  };
  return new DominoOneVsOneCommandService({
    move: handler("move"),
    draw: handler("draw"),
    pass: handler("pass"),
  });
}

test("service routes every stable 1v1 action exactly once", async () => {
  for (const action of ["move", "draw", "pass"] as const) {
    const calls: string[] = [];
    const response = await service(calls).handle(request({ action, room_id: "room-1" }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [action]);
    assert.deepEqual(await response.json(), { handler: action });
  }
});

test("service preserves method and invalid-action responses", async () => {
  const calls: string[] = [];
  const instance = service(calls);
  assert.equal((await instance.handle(request(null, "GET"))).status, 405);
  const invalid = await instance.handle(request({ action: "unknown" }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid action" });
  assert.deepEqual(calls, []);
});

test("service preserves malformed-json response", async () => {
  const calls: string[] = [];
  const malformed = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  const response = await service(calls).handle(malformed);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Missing action" });
  assert.deepEqual(calls, []);
});
