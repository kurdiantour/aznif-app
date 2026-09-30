import type { Session } from "@supabase/supabase-js";
import { publishAuthState } from "@/lib/auth-state";
import { getPendingGameInvites, sendGameInvite, respondGameInvite, cancelGameInvite } from "@/lib/gameInvites";
import { getMyGameParty, cancelMyGameParty } from "@/lib/gameParty";
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
const signIn = (id: string) => publishAuthState({ access_token: id, user: { id } } as Session, true, true);
const operations = [
  ["list invites", () => getPendingGameInvites()],
  ["send invite", () => sendGameInvite("friend")],
  ["respond invite", () => respondGameInvite("invite", true)],
  ["cancel invite", () => cancelGameInvite("invite")],
  ["read party", () => getMyGameParty()],
  ["cancel party", () => cancelMyGameParty()],
] as const;
beforeEach(() => { mockRpc.mockReset(); publishAuthState(null, false, true); });
afterEach(() => publishAuthState(null, false, false));
test.each(operations)("%s does not send without ready auth", async (_name, execute) => {
  await expect(execute()).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each(operations)("%s rejects an old account response", async (_name, execute) => {
  signIn("alice");
  let finish!: (value: unknown) => void;
  mockRpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = execute();
  signIn("bob");
  finish({ data: null, error: null });
  await expect(pending).rejects.toThrow("Session changed");
});
