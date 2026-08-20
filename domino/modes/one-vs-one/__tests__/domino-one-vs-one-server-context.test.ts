import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticateDominoOneVsOneRequest,
  projectDominoOneVsOnePrivateState,
} from "../server/domino-one-vs-one-server-context.ts";

test("auth preserves missing and invalid token responses", async () => {
  const client = { auth: { getUser: async () => ({ data: null, error: new Error("bad") }) } };
  const missing = await authenticateDominoOneVsOneRequest(new Request("https://game.test"), client);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(await missing.response.json(), { error: "Unauthorized" });

  const invalid = await authenticateDominoOneVsOneRequest(
    new Request("https://game.test", { headers: { authorization: "Bearer bad" } }), client,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.deepEqual(await invalid.response.json(), { error: "Invalid auth token" });
});

test("auth returns the authenticated user", async () => {
  const user = { id: "player-1" };
  const client = { auth: { getUser: async (token: string) => ({ data: { user }, error: null, token }) } };
  const result = await authenticateDominoOneVsOneRequest(
    new Request("https://game.test", { headers: { authorization: "Bearer valid" } }), client,
  );
  assert.deepEqual(result, { ok: true, user });
});

test("private projection keeps response-shape options explicit", () => {
  const state = { roundWinnerPlayerId: "p1" };
  const hands = [[{ id: "1-1" }], [{ id: "2-2" }]];
  assert.deepEqual(projectDominoOneVsOnePrivateState({ state, hands, playerIndex: 0 }), {
    ...state, myHand: hands[0],
  });
  assert.deepEqual(projectDominoOneVsOnePrivateState({
    state, hands, playerIndex: 1, userId: "p2", revealFinalHands: true,
  }), { ...state, myHand: hands[1], myHandOwnerId: "p2", revealedFinalHands: hands });
});
