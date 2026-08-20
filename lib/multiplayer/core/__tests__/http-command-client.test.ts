import assert from "node:assert/strict";
import test from "node:test";

import {
  createMultiplayerCommandClient,
  MultiplayerRequestError,
} from "../http-command-client.ts";

test("command client preserves authenticated JSON request contract", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const submit = createMultiplayerCommandClient({
    getAccessToken: async () => "token",
    getBaseUrl: () => "https://example.test/",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.deepEqual(await submit("command", { room_id: "room" }), { ok: true });
  assert.equal(capturedUrl, "https://example.test/functions/v1/command");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer token");
  assert.equal(capturedInit?.body, JSON.stringify({ room_id: "room" }));
});

test("network failures remain ambiguous while server rejections are authoritative", async () => {
  const networkSubmit = createMultiplayerCommandClient({
    getAccessToken: async () => "token",
    getBaseUrl: () => "https://example.test",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  await assert.rejects(networkSubmit("command", {}), (error: unknown) =>
    error instanceof MultiplayerRequestError && error.ambiguous && error.status === null,
  );

  const rejectedSubmit = createMultiplayerCommandClient({
    getAccessToken: async () => "token",
    getBaseUrl: () => "https://example.test",
    expectedErrorCodes: new Set(["stale_timeout"]),
    fetchImpl: async () => new Response(
      JSON.stringify({ error: "stale", code: "stale_timeout" }),
      { status: 409 },
    ),
  });
  await assert.rejects(rejectedSubmit("command", {}), (error: unknown) =>
    error instanceof MultiplayerRequestError &&
      !error.ambiguous &&
      error.status === 409 &&
      error.code === "stale_timeout",
  );
});
