import { createAuthoritativeOkeyMatch, projectOkeyMatchPublicState } from "@/okey/server/okey-authoritative";
import { projectOkeyServerState } from "../okey-server-projection";

test("two-player server projection keeps mode and real seat count in the client state", () => {
  const match = createAuthoritativeOkeyMatch([
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ], 0);
  const projection = projectOkeyMatchPublicState(match, 0, null);
  const state = projectOkeyServerState(projection, "bob");
  expect(state.mode).toBe("1v1");
  expect(state.players).toHaveLength(2);
  expect(state.players[0].id).toBe("bob");
  expect(state.currentPlayerIndex).toBe(1);
});
