import React from "react";
import { act, renderHook } from "@testing-library/react-native";
import { getCachedShopState, getMyShopState, purchaseOrEquipShopItem } from "@/lib/shop";
import { OkeyCosmeticsProvider, useOkeyCosmetics } from "@/okey/hooks/useOkeyCosmetics";

const mockRpc = jest.fn();
let mockUser = "alice";
const mockAuthListeners: ((event: string, session: any) => void)[] = [];
jest.mock("@/lib/supabase", () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: mockUser } } } }),
    onAuthStateChange: (cb: any) => {
      mockAuthListeners.push(cb);
      return { data: { subscription: { unsubscribe: () => {
        const index = mockAuthListeners.indexOf(cb);
        if (index >= 0) mockAuthListeners.splice(index, 1);
      } } } };
    },
  },
} }));
jest.mock("@/okey/multiplayer/cosmetics/okeyCosmeticsResolver", () => ({ OkeyCosmeticsResolver: class {} }));
jest.mock("@/constants/catalog/okey-sets", () => ({
  DEFAULT_TABLE_ID: "table-classic",
  isTableId: (key: string) => ["table-classic", "table-zagros"].includes(key),
  getOkeySetAssets: (key: string) => ({ table: key, playerRack: key, opponentRack: key }),
}));
const snapshot = (key = "table-zagros") => ({
  server_now: new Date().toISOString(), next_change_at: null,
  equipped: { tables: key },
  items: ["table-classic", "table-zagros"].map(asset_key => ({
    id: asset_key, asset_key, category: "tables", owned: true,
    is_default: asset_key === "table-classic", access_kind: "owned",
    available_until: null, free_until: null, free_from: null, available_from: null,
  })),
});
function changeUser(user: string) {
  mockUser = user;
  [...mockAuthListeners].forEach(cb => cb("SIGNED_IN", { user: { id: user } }));
}
beforeEach(() => {
  mockRpc.mockReset();
  changeUser(`user-${Math.random()}`);
});
const wrapper = ({ children }: { children: React.ReactNode }) => <OkeyCosmeticsProvider>{children}</OkeyCosmeticsProvider>;

test("Waiting renders Zagros on its very first render while the fresh DB read is pending", async () => {
  mockRpc.mockResolvedValueOnce({ data: snapshot(), error: null });
  await getMyShopState();
  mockRpc.mockReturnValue(new Promise(() => {}));
  const seen: string[] = [];
  const ui = renderHook(() => {
    const value = useOkeyCosmetics();
    seen.push(value.activeTableId);
    return value;
  }, { wrapper });
  expect(seen[0]).toBe("table-zagros");
  expect(ui.result.current.setAssets.table).toBe("table-zagros");
  expect(ui.result.current.isReady).toBe(true);
  await act(async () => {
    [...mockAuthListeners].forEach(cb => cb("INITIAL_SESSION", { user: { id: mockUser } }));
  });
  expect(seen).not.toContain("table-classic");
  ui.unmount();
});

test("new authoritative equipment replaces the cached presentation", async () => {
  mockRpc.mockResolvedValueOnce({ data: snapshot(), error: null });
  await getMyShopState();
  mockRpc.mockResolvedValue({ data: snapshot("table-classic"), error: null });
  const ui = renderHook(() => useOkeyCosmetics(), { wrapper });
  expect(ui.result.current.activeTableId).toBe("table-zagros");
  await act(async () => { await Promise.resolve(); });
  expect(ui.result.current.activeTableId).toBe("table-classic");
  ui.unmount();
});

test("account switch and a late response cannot expose another user's cached equipment", async () => {
  mockRpc.mockResolvedValueOnce({ data: snapshot(), error: null });
  await getMyShopState();
  let finish!: (value: any) => void;
  mockRpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = getMyShopState();
  await Promise.resolve();
  changeUser("bob");
  expect(getCachedShopState()).toBeNull();
  finish({ data: snapshot(), error: null });
  await pending;
  expect(getCachedShopState()).toBeNull();
});

test("successful equip refreshes the DB-backed cache before returning", async () => {
  mockRpc.mockResolvedValueOnce({ data: snapshot("table-classic"), error: null });
  await getMyShopState();
  mockRpc.mockResolvedValueOnce({ data: { status: "equipped", item_id: "table-zagros" }, error: null });
  mockRpc.mockResolvedValueOnce({ data: snapshot(), error: null });
  await purchaseOrEquipShopItem("table-zagros");
  expect(getCachedShopState()?.equippedByCategory.tables).toBe("table-zagros");
});

test("expired temporary access is never restored by the synchronous cache", async () => {
  const data = snapshot();
  Object.assign(data.items[1], { owned: false, access_kind: "temporary", free_until: new Date(Date.now() - 1000).toISOString() });
  mockRpc.mockResolvedValueOnce({ data, error: null });
  await getMyShopState();
  expect(getCachedShopState()?.equippedByCategory.tables).toBe("table-classic");
});
