import { MatchCosmeticsGate } from "@/lib/multiplayer/cosmetics/MatchCosmeticsGate";
import React from "react";
import { act, render, renderHook } from "@testing-library/react-native";
import { AppState, Text, type AppStateStatus } from "react-native";
import { OkeyCosmeticsProvider, useOkeyCosmetics } from "@/okey/hooks/useOkeyCosmetics";
import { DominoCosmeticsProvider, useDominoCosmetics } from "@/domino/hooks/useDominoCosmetics";
import type { MultiplayerCosmeticsResolution } from "@/lib/multiplayer/cosmetics/types";

const originalAppState = AppState.currentState;
const mockOkey = jest.fn();
const mockDomino = jest.fn();
const mockRemove = jest.fn();
const mockCallbacks: (() => void)[] = [];
let mockShopChanged: () => void;
const mockShopUnsubscribe = jest.fn();
jest.mock("@/lib/shop", () => ({ subscribeShopChanges: (cb: () => void) => { mockShopChanged = cb; return mockShopUnsubscribe; } }));
jest.mock("@/hooks/useShopState", () => ({ useShopState: () => ({ loading: false, state: {
  equippedByCategory: { tables: "royal" }, snapshot: { items: [{ id: "royal", asset_key: "table-royal" }] },
} }) }));
jest.mock("@/constants/catalog/okey-sets", () => ({
  DEFAULT_TABLE_ID: "table-classic", isTableId: (key: string) => key.startsWith("table-"),
  getOkeySetAssets: (key: string) => ({ table: key, playerRack: key, opponentRack: key, tiles: { back: key, red_1: key } }),
}));
jest.mock("@/constants/catalog/domino-sets", () => ({
  DEFAULT_DOMINO_SET_ID: "domino-classic", isDominoSetId: (key: string) => key.startsWith("domino-"),
  getDominoSetAssets: (key: string) => ({ table: key }),
}));
jest.mock("@/okey/multiplayer/cosmetics/okeyCosmeticsResolver", () => ({ OkeyCosmeticsResolver: class { resolveMatchCosmetics = mockOkey; } }));
jest.mock("@/domino/multiplayer/cosmetics/dominoCosmeticsResolver", () => ({ DominoCosmeticsResolver: class { resolveMatchCosmetics = mockDomino; } }));
jest.mock("@/lib/supabase", () => ({ supabase: {
  channel: () => {
    const channel = { on: (_type: string, _filter: unknown, cb: () => void) => { mockCallbacks.push(cb); return channel; }, subscribe: () => channel };
    return channel;
  }, removeChannel: (...args: unknown[]) => mockRemove(...args),
} }));
const resolution = (key: string): MultiplayerCosmeticsResolution => ({ locked: true, sharedSetAssetKey: key, playerSetAssetKeys: { alice: key } });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => {
  jest.useFakeTimers(); mockOkey.mockReset(); mockDomino.mockReset(); mockRemove.mockClear(); mockShopUnsubscribe.mockClear(); mockCallbacks.length = 0;
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
});
afterEach(() => { AppState.currentState = originalAppState; jest.useRealTimers(); jest.restoreAllMocks(); });

test("personal Okey racks use the equipped set, including explicit preview overrides", async () => {
  const { result } = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) => <OkeyCosmeticsProvider>{children}</OkeyCosmeticsProvider> });
  expect(result.current.getPlayerAssets("seat-0")).toEqual(result.current.setAssets);
  expect(result.current.activeTableId).toBe("table-royal");
  const override = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) => <OkeyCosmeticsProvider tableId="table-midnight">{children}</OkeyCosmeticsProvider> });
  expect(override.result.current.getPlayerAssets("seat-0")).toEqual(override.result.current.setAssets);
  expect(override.result.current.activeTableId).toBe("table-midnight");
  await settle();
});

test("Okey waiting refreshes remote changes, foreground and Shop notifications and cleans up", async () => {
  let foreground: (status: AppStateStatus) => void = () => {};
  const removeApp = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => { foreground = cb; return { remove: removeApp }; });
  mockOkey.mockResolvedValue(resolution("table-royal"));
  const { result, unmount } = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) => <OkeyCosmeticsProvider roomId="room">{children}</OkeyCosmeticsProvider> });
  await settle();
  mockOkey.mockResolvedValue(resolution("table-classic"));
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(result.current.activeTableId).toBe("table-classic");
  await act(async () => { mockShopChanged(); foreground("active"); });
  expect(mockOkey).toHaveBeenCalledTimes(4);
  unmount();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(mockOkey).toHaveBeenCalledTimes(4);
  expect(removeApp).toHaveBeenCalledTimes(1);
  expect(mockShopUnsubscribe).toHaveBeenCalledTimes(1);
});

test("Okey discards a delayed waiting response after a newer match response", async () => {
  let resolveOld!: (value: MultiplayerCosmeticsResolution) => void;
  mockOkey.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(resolution("table-royal"));
  const { result } = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) => <OkeyCosmeticsProvider roomId="room">{children}</OkeyCosmeticsProvider> });
  await act(async () => { mockCallbacks[0](); });
  await act(async () => { resolveOld(resolution("table-classic")); });
  expect(result.current.activeTableId).toBe("table-royal");
  expect(result.current.getPlayerAssets("alice")).toEqual(result.current.setAssets);
});

for (const game of ["Okey", "1v1", "2v2"] as const) {
  const premium = game === "Okey" ? "table-royal" : "domino-emerald-ivory";
  const classic = game === "Okey" ? "table-classic" : "domino-classic";
  const setup = () => {
    const mock = game === "Okey" ? mockOkey : mockDomino;
    let foreground: (status: AppStateStatus) => void = () => {};
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => { foreground = cb; return { remove }; });
    let roomId = "first-room";
    const wrapper = ({ children }: { children: React.ReactNode }) => game === "Okey"
      ? <OkeyCosmeticsProvider roomId={roomId} requireSnapshot>{children}</OkeyCosmeticsProvider>
      : <DominoCosmeticsProvider roomId={roomId} mode={game}>{children}</DominoCosmeticsProvider>;
    const useSelected = game === "Okey" ? useOkeyCosmetics : useDominoCosmetics;
    const useValue = () => { const value = useSelected(); return { isReady: value.isReady, setAssets: value.setAssets }; };
    return { mock, remove, foreground: () => foreground("active"), wrapper, useValue, changeRoom: () => { roomId = "second-room"; } };
  };
  test(`${game}: errors and live responses do not make Game ready; retry accepts only a locked snapshot`, async () => {
    const setupResult = setup();
    setupResult.mock.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...resolution(classic), locked: false }).mockResolvedValue(resolution(premium));
    const { result, unmount } = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    await settle();
    expect(result.current.isReady).toBe(false);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(result.current.isReady).toBe(false);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(result.current.isReady).toBe(true);
    expect(result.current.setAssets.table).toBe(premium);
    setupResult.mock.mockResolvedValue(null);
    await act(async () => { setupResult.foreground(); });
    expect(result.current.isReady).toBe(true);
    expect(result.current.setAssets.table).toBe(premium);
    setupResult.mock.mockResolvedValue(resolution(classic));
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(result.current.setAssets.table).toBe(premium);
    unmount();
    const calls = setupResult.mock.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(30000); });
    expect(setupResult.mock).toHaveBeenCalledTimes(calls);
    expect(setupResult.remove).toHaveBeenCalledTimes(1);
  });
  test(`${game}: a slow snapshot is accepted without polling starvation or overlapping requests`, async () => {
    const setupResult = setup();
    let finish!: (value: MultiplayerCosmeticsResolution) => void;
    setupResult.mock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    await act(async () => { jest.advanceTimersByTime(10000); setupResult.foreground(); });
    expect(setupResult.mock).toHaveBeenCalledTimes(1);
    await act(async () => { finish(resolution(premium)); });
    expect(result.current.isReady).toBe(true);
    expect(result.current.setAssets.table).toBe(premium);
  });
  test(`${game}: changing rooms clears readiness and late responses cannot leak across matches`, async () => {
    const setupResult = setup();
    let finish!: (value: MultiplayerCosmeticsResolution) => void;
    setupResult.mock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(null);
    const { result, rerender } = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    setupResult.changeRoom(); rerender(undefined);
    await act(async () => { finish(resolution(premium)); });
    expect(result.current.isReady).toBe(false);
    setupResult.mock.mockResolvedValue(resolution(classic));
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(result.current.setAssets.table).toBe(classic);
  });
  test(`${game}: a timed-out response cannot overwrite the retried snapshot`, async () => {
    const setupResult = setup();
    let late!: (value: MultiplayerCosmeticsResolution) => void;
    setupResult.mock.mockReturnValueOnce(new Promise(resolve => { late = resolve; })).mockResolvedValue(resolution(premium));
    const { result } = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.isReady).toBe(false);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(result.current.setAssets.table).toBe(premium);
    await act(async () => { late(resolution(classic)); });
    expect(result.current.setAssets.table).toBe(premium);
  });
  test(`${game}: a remounted Game reconnects to the same authoritative snapshot`, async () => {
    const setupResult = setup();
    setupResult.mock.mockResolvedValue(resolution(premium));
    const first = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    await settle(); first.unmount();
    setupResult.mock.mockResolvedValueOnce(null).mockResolvedValue(resolution(premium));
    const second = renderHook(setupResult.useValue, { wrapper: setupResult.wrapper });
    await settle(); expect(second.result.current.isReady).toBe(false);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(second.result.current.setAssets.table).toBe(premium);
  });
}

test("locked Okey uses the shared Table/Tiles but each player's own Rack", async () => {
  mockOkey.mockResolvedValue({ locked: true, sharedSetAssetKey: "table-royal", playerSetAssetKeys: { alice: "table-midnight", bob: "table-royal" } });
  const { result } = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) => <OkeyCosmeticsProvider roomId="room" requireSnapshot>{children}</OkeyCosmeticsProvider> });
  await settle();
  expect(result.current.setAssets.table).toBe("table-royal");
  expect(result.current.getPlayerAssets("alice").playerRack).toBe("table-midnight");
  expect(result.current.getPlayerAssets("bob").opponentRack).toBe("table-royal");
});

test("Game content stays unmounted until authoritative cosmetics are ready", () => {
  const view = render(<MatchCosmeticsGate ready={false}><Text>game content</Text></MatchCosmeticsGate>);
  expect(view.queryByText("game content")).toBeNull();
  expect(view.getByLabelText("Loading match cosmetics")).toBeTruthy();
  view.rerender(<MatchCosmeticsGate ready><Text>game content</Text></MatchCosmeticsGate>);
  expect(view.getByText("game content")).toBeTruthy();
});


test("Waiting uses the DB shared set for Table and Tiles while racks stay personal without a poll", async () => {
  const own = { userId: "alice", playerIndex: 0, displayName: "Alice" };
  const opponent = { userId: "bob", playerIndex: 2, displayName: "Bob" };
  let waitingRoom = { matchId: "waiting-room", members: [own, opponent] } as any;
  mockOkey.mockResolvedValue({ locked: false, sharedSetAssetKey: "table-midnight",
    playerSetAssetKeys: { alice: "table-royal", bob: "table-zagros" } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <OkeyCosmeticsProvider waitingRoom={waitingRoom} currentUserId="alice">{children}</OkeyCosmeticsProvider>;
  const ui = renderHook(() => useOkeyCosmetics(), { wrapper });
  expect(ui.result.current.activeTableId).toBe("table-royal");
  await settle();
  expect(ui.result.current.getPlayerAssets("bob").opponentRack).toBe("table-zagros");
  expect(ui.result.current.getPlayerAssets("alice").playerRack).toBe("table-royal");
  expect(ui.result.current.getPlayerAssets(undefined).opponentRack).toBe("table-classic");
  expect(ui.result.current.activeTableId).toBe("table-midnight");
  expect(ui.result.current.setAssets.tiles.back).toBe("table-midnight");
  expect(ui.result.current.setAssets.tiles.red_1).toBe("table-midnight");
  const requests = mockOkey.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(mockOkey).toHaveBeenCalledTimes(requests);
  mockOkey.mockResolvedValue({ locked: false, sharedSetAssetKey: "table-royal", playerSetAssetKeys: { alice: "table-royal" } });
  waitingRoom = { ...waitingRoom, members: [own] };
  ui.rerender(undefined);
  expect(ui.result.current.getPlayerAssets("bob").opponentRack).toBe("table-classic");
  await settle();
  expect(ui.result.current.getPlayerAssets("bob").opponentRack).toBe("table-classic");
  expect(ui.result.current.activeTableId).toBe("table-royal");
  expect(ui.result.current.setAssets.tiles.back).toBe("table-royal");
  ui.unmount();
});


test("all Waiting clients consume the same DB winner and update on join", async () => {
  let waitingRoom = { matchId: "shared-room", members: [
    { userId: "alice", playerIndex: 0 }, { userId: "bob", playerIndex: 1 },
  ] } as any;
  mockOkey.mockResolvedValue({ sharedSetAssetKey: "table-zagros",
    playerSetAssetKeys: { alice: "table-royal", bob: "table-zagros" } });
  const alice = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) =>
    <OkeyCosmeticsProvider waitingRoom={waitingRoom} currentUserId="alice">{children}</OkeyCosmeticsProvider> });
  const bob = renderHook(() => useOkeyCosmetics(), { wrapper: ({ children }) =>
    <OkeyCosmeticsProvider waitingRoom={waitingRoom} currentUserId="bob">{children}</OkeyCosmeticsProvider> });
  await settle();
  for (const client of [alice, bob]) {
    expect(client.result.current.setAssets.table).toBe("table-zagros");
    expect(client.result.current.setAssets.tiles.back).toBe("table-zagros");
  }
  mockOkey.mockResolvedValue({ sharedSetAssetKey: "table-midnight",
    playerSetAssetKeys: { alice: "table-royal", bob: "table-zagros", charlie: "table-midnight" } });
  waitingRoom = { ...waitingRoom, members: [...waitingRoom.members, { userId: "charlie", playerIndex: 2 }] };
  alice.rerender(undefined); bob.rerender(undefined);
  await settle();
  for (const client of [alice, bob]) {
    expect(client.result.current.setAssets.table).toBe("table-midnight");
    expect(client.result.current.setAssets.tiles.red_1).toBe("table-midnight");
    expect(client.result.current.getPlayerAssets("charlie").opponentRack).toBe("table-midnight");
  }
  expect(alice.result.current.getPlayerAssets("alice").playerRack).toBe("table-royal");
  expect(alice.result.current.getPlayerAssets("bob").opponentRack).toBe("table-zagros");
  alice.unmount(); bob.unmount();
});
