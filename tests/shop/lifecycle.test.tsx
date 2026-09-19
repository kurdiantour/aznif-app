import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { useShopState } from "@/hooks/useShopState";
import { createShopState } from "@/lib/shop-state";
import type { ShopSnapshot } from "@/lib/shop-types";

const mockGet = jest.fn();
let mockChanged: () => void;
let mockAuth: (event: string, session: { user: { id: string } } | null) => void;
const mockUnsubscribe = jest.fn();
jest.mock("@/lib/shop", () => ({
  getMyShopState: () => mockGet(),
  subscribeShopChanges: (callback: () => void) => { mockChanged = callback; return mockUnsubscribe; },
}));
jest.mock("@/lib/supabase", () => ({ supabase: { auth: {
  onAuthStateChange: (callback: typeof mockAuth) => { mockAuth = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; },
} } }));

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
beforeEach(() => { jest.useFakeTimers(); mockGet.mockReset(); mockUnsubscribe.mockClear(); });
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
  await act(async () => { mockAuth("SIGNED_IN", { user: { id: "new-user" } }); });
  await act(async () => { resolveOld(createShopState(data, performance.now())); });
  expect(result.current.state?.equippedByCategory.tables).toBe("default");
});

test("purchase notification and foreground both refresh shared state", async () => {
  let onChange: (status: string) => void = () => {};
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    onChange = callback as typeof onChange; return { remove: jest.fn() };
  });
  mockGet.mockResolvedValue(createShopState(data, performance.now()));
  renderHook(() => useShopState());
  await settle();
  const initial = mockGet.mock.calls.length;
  await act(async () => { mockChanged(); });
  await act(async () => { onChange("active"); });
  expect(mockGet.mock.calls.length).toBe(initial + 2);
});

test("disabled personal hook performs no reads or subscriptions for multiplayer", async () => {
  renderHook(() => useShopState(false));
  await settle();
  expect(mockGet).not.toHaveBeenCalled();
});
