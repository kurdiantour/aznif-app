import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { ProfileProvider, useProfile } from "@/lib/profile";
const mockLoad = jest.fn();
const mockUpdate = jest.fn();
const mockWallet = jest.fn();
const mockCurrentUser = jest.fn();
let mockAuth: (event: string, session: Session | null) => void;
const session = (id: string, token = id) => ({ access_token: token, user: { id, email: id + "@test.com" } }) as Session;
const row = (id: string, username = id) => ({ id, username, player_id: id, avatar_id: "avatar-1", avatar_url: null, created_at: "", updated_at: "" });
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: true, supabase: {
  auth: {
    getSession: async () => ({ data: { session: session("alice") }, error: null }),
    onAuthStateChange: (listener: typeof mockAuth) => { mockAuth = listener; return { data: { subscription: { unsubscribe: jest.fn() } } }; },
    startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  },
  from: () => ({ select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: () => mockWallet(id) }) }) }),
} }));
jest.mock("@/lib/supabaseAuth", () => ({
  getCurrentUser: () => mockCurrentUser(),
  getOrCreateProfile: (scope: unknown) => mockLoad(scope),
  updateMyProfile: (input: unknown, scope: unknown) => mockUpdate(input, scope),
}));
const wrapper = ({ children }: { children: ReactNode }) => <ProfileProvider>{children}</ProfileProvider>;
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  mockLoad.mockImplementation(async (scope) => row(scope.user.id));
  mockUpdate.mockImplementation(async (input, scope) => row(scope.user.id, input.username));
  mockWallet.mockResolvedValue({ data: { coin: 10, gem: 20 }, error: null });
});

afterEach(() => { jest.useRealTimers(); });

test("pins helper identity and never independently resolves the current user", async () => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  expect(mockLoad.mock.calls[0][0].user.id).toBe("alice");
  expect(mockWallet).toHaveBeenCalledWith("alice");
  expect(mockCurrentUser).not.toHaveBeenCalled();
  ui.unmount();
});

test.each(["logout", "switch", "token"])("rejects late refresh after %s and hides old generation immediately", async (kind) => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  let finish!: (value: unknown) => void;
  mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<unknown>;
  act(() => { pending = ui.result.current.refreshProfile(); });
  await settle();
  mockLoad.mockImplementation(() => new Promise(() => {}));
  act(() => mockAuth(kind === "logout" ? "SIGNED_OUT" : "SIGNED_IN", kind === "logout" ? null : session(kind === "switch" ? "bob" : "alice", "new-token")));
  expect(ui.result.current.profile).toBeNull();
  await act(async () => { finish(row("alice", "stale")); await pending; });
  expect(ui.result.current.profile).toBeNull();
  expect(mockWallet.mock.calls).toHaveLength(1);
  ui.unmount();
});

test("late update rejects after account switch without overwriting Bob", async () => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  let finish!: (value: unknown) => void;
  mockUpdate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<unknown>;
  act(() => { pending = ui.result.current.updateProfile({ displayName: "edited" }).catch(error => error); });
  await act(async () => mockAuth("SIGNED_IN", session("bob")));
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("bob"));
  await act(async () => { finish(row("alice", "edited")); });
  expect(await pending).toBeInstanceOf(Error);
  expect(ui.result.current.profile?.id).toBe("bob");
  ui.unmount();
});

test("successful edit supersedes an older refresh and refresh calls dedupe", async () => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  let finish!: (value: unknown) => void;
  mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<unknown>;
  act(() => {
    pending = ui.result.current.refreshProfile();
    expect(ui.result.current.refreshProfile()).toBe(pending);
  });
  await settle();
  await act(async () => { await ui.result.current.updateProfile({ displayName: "edited" }); });
  await act(async () => { finish(row("alice", "old")); await pending; });
  expect(ui.result.current.profile?.displayName).toBe("edited");
  ui.unmount();
});


test("late refresh failure cannot clear the next account profile", async () => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  let fail!: (error: Error) => void;
  mockLoad.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  let pending!: Promise<unknown>;
  act(() => { pending = ui.result.current.refreshProfile(); });
  await settle();
  await act(async () => mockAuth("SIGNED_IN", session("bob")));
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("bob"));
  await act(async () => { fail(new Error("old offline failure")); await pending; });
  expect(ui.result.current.profile?.id).toBe("bob");
  expect(ui.result.current.loading).toBe(false);
  ui.unmount();
});

test("unmount prevents a pending refresh from returning a usable profile", async () => {
  const ui = renderHook(useProfile, { wrapper });
  await waitFor(() => expect(ui.result.current.profile?.id).toBe("alice"));
  let finish!: (value: unknown) => void;
  mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<unknown>;
  act(() => { pending = ui.result.current.refreshProfile(); });
  await settle();
  ui.unmount();
  finish(row("alice"));
  await expect(pending).resolves.toBeNull();
});
