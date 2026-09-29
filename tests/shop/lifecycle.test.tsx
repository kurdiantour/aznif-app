import { act, renderHook } from "@testing-library/react-native";
import { getAuthState, publishAuthState } from "@/lib/auth-state";
import type { Session } from "@supabase/supabase-js";
import { useShopState } from "@/hooks/useShopState";
import { createShopState } from "@/lib/shop-state";
import type { ShopSnapshot } from "@/lib/shop-types";

const mockGet = jest.fn();
let mockChanged: () => void;
const mockUnsubscribe = jest.fn();
jest.mock("@/lib/shop", () => ({
  getCachedShopState: () => null,
  getMyShopState: () => mockGet(),
  subscribeShopChanges: (callback: () => void) => { mockChanged = callback; return mockUnsubscribe; },
}));


const data: ShopSnapshot = {
  server_now: "2026-09-20T00:00:00Z", next_change_at: "2026-09-20T00:00:01Z", equipped: { tables: "promo" },
  items: [
    { id: "default", category: "tables", title: "Default", description: "", asset_key: "table-classic", price_gem: 0,
      sort_order: 1, active: true, enabled: true, is_default: true, owned: false, access_kind: "default", sale_available: true,
      available_from: null, available_until: null, free_from: null, free_until: null },
    { id: "promo", category: "tables", title: "Promo", description: "", asset_key: "table-midnight", price_gem: 35,
      sort_order: 2, active: true, enabled: true, is_default: false, owned: false, access_kind: "temporary", sale_available: true,
      available_from: null, available_until: null, free_from: "2026-09-19T00:00:00Z", free_until: "2026-09-20T00:00:01Z" },
  ],
};
beforeEach(() => { jest.useFakeTimers(); publishAuthState({ access_token: "alice", user: { id: "alice" } } as Session, true, true); mockGet.mockReset(); mockUnsubscribe.mockClear(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

test("promotion expires while offline; failed refresh never restores expired equipment", async () => {
  mockGet.mockResolvedValueOnce(createShopState(data, performance.now())).mockRejectedValue(new Error("offline"));
  const { result, unmount } = renderHook(() => useShopState());
  await settle();
  expect(result.current.state?.equippedByCategory.tables).toBe("promo");
  await act(async () => { jest.advanceTimersByTime(1002); });
  expect(result.current.state?.equippedByCategory.tables).toBe("default");
  expect(result.current.error).toBe("offline");
  unmount();
  expect(mockUnsubscribe).toHaveBeenCalled();
});

test("auth switch discards prior user's equipment and rejects an old in-flight response", async () => {
  let resolveOld!: (value: ReturnType<typeof createShopState>) => void;
  mockGet.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  const fresh = { ...data, equipped: { tables: "default" } };
  mockGet.mockResolvedValue(createShopState(fresh, performance.now()));
  const { result } = renderHook(() => useShopState());
  await settle();
  await act(async () => { publishAuthState({ access_token: "bob", user: { id: "bob" } } as Session, true, true); });
  await act(async () => { resolveOld(createShopState(data, performance.now())); });
  expect(result.current.state?.equippedByCategory.tables).toBe("default");
});

test("purchase notification and foreground both refresh shared state", async () => {
  mockGet.mockResolvedValue(createShopState(data, performance.now()));
  renderHook(() => useShopState());
  await settle();
  const initial = mockGet.mock.calls.length;
  await act(async () => { mockChanged(); });
  act(() => publishAuthState(getAuthState().session, false, false));
  await act(async () => { publishAuthState(getAuthState().session, true, true); });
  expect(mockGet.mock.calls.length).toBe(initial + 2);
});

test("disabled personal hook performs no reads or subscriptions for multiplayer", async () => {
  renderHook(() => useShopState(false));
  await settle();
  expect(mockGet).not.toHaveBeenCalled();
});


test("shop has no periodic polling when no promotion boundary is pending", async () => {
  const interval = jest.spyOn(global, "setInterval");
  const permanent = { ...data, next_change_at: null, equipped: { tables: "default" }, items: [data.items[0]] };
  mockGet.mockResolvedValue(createShopState(permanent, performance.now()));
  const ui = renderHook(() => useShopState());
  await settle();
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(interval).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(180000); });
  expect(mockGet).toHaveBeenCalledTimes(1);
  ui.unmount();
});


test("resume expires a promotion from the retained snapshot even if the refresh fails", async () => {
  mockGet.mockResolvedValueOnce(createShopState(data, performance.now())).mockRejectedValue(new Error("offline"));
  const ui = renderHook(() => useShopState());
  await settle();
  const original = getAuthState().session;
  const generation = getAuthState().generation;
  act(() => publishAuthState(original, false, false));
  await act(async () => { jest.advanceTimersByTime(5000); });
  act(() => publishAuthState(original, true, true));
  await settle();
  expect(getAuthState().generation).toBe(generation);
  expect(ui.result.current.state?.equippedByCategory.tables).toBe("default");
  expect(ui.result.current.error).toBe("offline");
  ui.unmount();
});
