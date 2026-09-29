import { act, renderHook } from "@testing-library/react-native";
import type { Session } from "@supabase/supabase-js";
import { getAuthState, publishAuthState } from "@/lib/auth-state";
import { useUserResource } from "@/hooks/useUserResource";

const session = (id: string, token = id) => ({ access_token: token, user: { id } }) as Session;
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => { jest.useFakeTimers(); jest.spyOn(global, "setInterval"); jest.spyOn(global, "clearInterval"); publishAuthState(null, false, true); });
afterEach(() => { publishAuthState(null, false, false); jest.restoreAllMocks(); jest.useRealTimers(); });

test("does not load until auth is ready and authenticated", async () => {
  const load = jest.fn().mockResolvedValue("alice");
  const ui = renderHook(() => useUserResource(load, true, 60000));
  await settle();
  act(() => publishAuthState(null, true, true));
  await settle();
  expect(load).not.toHaveBeenCalled();
  expect(setInterval).not.toHaveBeenCalled();
  act(() => publishAuthState(session("alice"), true, true));
  await settle();
  expect(ui.result.current.data).toBe("alice");
  ui.unmount();
});

test.each(["logout", "account", "token"])("ignores late success after %s", async (change) => {
  let resolve!: (value: string) => void;
  const load = jest.fn().mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValue("new");
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(() => useUserResource(load));
  await settle();
  act(() => publishAuthState(change === "logout" ? null : session(change === "account" ? "bob" : "alice", "new-token"), true, true));
  await settle();
  await act(async () => resolve("old"));
  expect(ui.result.current.data).toBe(change === "logout" ? null : "new");
  expect(ui.result.current.error).toBeNull();
  ui.unmount();
});

test("clears polling in background and without session, resumes with one refresh", async () => {
  const load = jest.fn().mockResolvedValue("ok");
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(() => useUserResource(load, true, 60000));
  await settle();
  expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
  const timer = (setInterval as jest.Mock).mock.results[0].value;
  act(() => publishAuthState(getAuthState().session, false, false));
  expect(clearInterval).toHaveBeenCalledWith(timer);
  await act(async () => jest.advanceTimersByTime(180000));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => publishAuthState(getAuthState().session, true, true));
  await settle();
  expect(load).toHaveBeenCalledTimes(2);
  act(() => publishAuthState(null, true, true));
  expect(clearInterval).toHaveBeenCalledWith((setInterval as jest.Mock).mock.results[1].value);
  ui.unmount();
});

test("coalesces concurrent refreshes and ignores responses after unmount", async () => {
  let resolve!: (value: string) => void;
  const load = jest.fn(() => new Promise<string>(done => { resolve = done; }));
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(() => useUserResource(load));
  await settle();
  const first = ui.result.current.refresh();
  const second = ui.result.current.refresh();
  expect(first).toBe(second);
  expect(load).toHaveBeenCalledTimes(1);
  ui.unmount();
  resolve("old");
  await expect(first).resolves.toBeNull();
});

test("a mutation result wins over an older read", async () => {
  let resolve!: (value: string) => void;
  const load = jest.fn(() => new Promise<string>(done => { resolve = done; }));
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(() => useUserResource(load));
  await settle();
  act(() => ui.result.current.accept("claimed"));
  await act(async () => resolve("unclaimed"));
  expect(ui.result.current.data).toBe("claimed");
  ui.unmount();
});


test("late failure from another account does not replace the current error or loading state", async () => {
  let reject!: (reason: Error) => void;
  const load = jest.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue("bob");
  publishAuthState(session("alice"), true, true);
  const ui = renderHook(() => useUserResource(load));
  await settle();
  act(() => publishAuthState(session("bob"), true, true));
  await settle();
  await act(async () => reject(new Error("old failure")));
  expect(ui.result.current.data).toBe("bob");
  expect(ui.result.current.error).toBeNull();
  expect(ui.result.current.loading).toBe(false);
  ui.unmount();
});

test("token expiry stops polling without sending an anonymous request", async () => {
  const load = jest.fn().mockResolvedValue("ok");
  publishAuthState({ ...session("alice"), expires_at: Date.now() / 1000 + 5 }, true, true);
  const ui = renderHook(() => useUserResource(load, true, 60000));
  await settle();
  const timer = (setInterval as jest.Mock).mock.results[0].value;
  await act(async () => jest.advanceTimersByTime(60000));
  expect(clearInterval).toHaveBeenCalledWith(timer);
  expect(load).toHaveBeenCalledTimes(1);
  expect(ui.result.current.data).toBeNull();
  ui.unmount();
});


test("readiness and app activity preserve generation, including an equivalent restored session", () => {
  const original = { ...session("alice"), refresh_token: "refresh-1", expires_at: Date.now() / 1000 + 3600 };
  publishAuthState(original, true, true);
  const generation = getAuthState().generation;
  publishAuthState(original, false, false);
  expect(getAuthState().generation).toBe(generation);
  publishAuthState({ ...original, user: { ...original.user } }, false, true);
  expect(getAuthState().generation).toBe(generation);
  publishAuthState({ ...original }, true, true);
  expect(getAuthState().generation).toBe(generation);
  publishAuthState({ ...original, refresh_token: "refresh-2" }, true, true);
  expect(getAuthState().generation).toBe(generation + 1);
  publishAuthState(null, true, true);
  expect(getAuthState().generation).toBe(generation + 2);
  publishAuthState(original, true, true);
  expect(getAuthState().generation).toBe(generation + 3);
});

test("resume refresh wins over a pending pre-background read without changing generation", async () => {
  let resolve!: (value: string) => void;
  const load = jest.fn().mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValue("fresh");
  const original = session("alice");
  publishAuthState(original, true, true);
  const generation = getAuthState().generation;
  const ui = renderHook(() => useUserResource(load));
  await settle();
  act(() => publishAuthState(original, false, false));
  act(() => publishAuthState({ ...original }, true, true));
  await settle();
  await act(async () => resolve("old"));
  expect(getAuthState().generation).toBe(generation);
  expect(load).toHaveBeenCalledTimes(2);
  expect(ui.result.current.data).toBe("fresh");
  ui.unmount();
});
