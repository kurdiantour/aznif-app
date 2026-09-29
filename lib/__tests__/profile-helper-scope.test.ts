import type { User } from "@supabase/supabase-js";
import { getOrCreateProfile, updateMyProfile } from "@/lib/supabaseAuth";
const mockRead = jest.fn();
const mockInsert = jest.fn();
const mockWrite = jest.fn();
const mockEq = jest.fn();
const mockSession = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: {
  auth: { getSession: () => mockSession() },
  from: () => ({
    select: () => ({ eq: (...args: unknown[]) => { mockEq(...args); return { maybeSingle: () => mockRead() }; } }),
    insert: (...args: unknown[]) => { mockInsert(...args); return { select: () => ({ single: () => mockWrite() }) }; },
    update: () => ({ eq: (...args: unknown[]) => { mockEq(...args); return { select: () => ({ single: () => mockWrite() }) }; } }),
  }),
} }));
beforeEach(() => jest.clearAllMocks());
test("a missing profile is not created after the captured session becomes stale", async () => {
  let finish!: (value: unknown) => void;
  let valid = true;
  mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = getOrCreateProfile({ user: { id: "alice" } as User, assertCurrent: () => { if (!valid) throw new Error("stale"); } });
  valid = false;
  finish({ data: null, error: null });
  await expect(pending).rejects.toThrow("stale");
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockSession).not.toHaveBeenCalled();
});
test("profile updates target the captured user and reject late results", async () => {
  let finish!: (value: unknown) => void;
  let valid = true;
  mockWrite.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = updateMyProfile({ username: "new" }, { user: { id: "alice" } as User, assertCurrent: () => { if (!valid) throw new Error("stale"); } });
  expect(mockEq).toHaveBeenCalledWith("id", "alice");
  valid = false;
  finish({ data: { id: "alice" }, error: null });
  await expect(pending).rejects.toThrow("stale");
  expect(mockSession).not.toHaveBeenCalled();
});
