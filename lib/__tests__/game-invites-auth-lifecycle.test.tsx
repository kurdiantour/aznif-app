import { act, renderHook } from "@testing-library/react-native";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { getAuthState, publishAuthState } from "@/lib/auth-state";
import { GameInvitesProvider, useGameParty } from "@/lib/gameInvitesProvider";
import type { GameParty } from "@/lib/gameParty";
const mockInvites = jest.fn();
const mockParty = jest.fn();
const mockRespond = jest.fn();
const mockCancel = jest.fn();
const mockShop = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
const mockRemove = jest.fn();
let mockPopup: { invite: { id: string } | null; busy: boolean; error: string | null; onAccept: () => void; onDecline: () => void; onExpire: () => void };
const mockChannels: { name: string; event: () => void; status: (value: string) => void; events: { filter: string; callback: () => void }[] }[] = [];
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/(tabs)/play" }));
jest.mock("@/components/friends/GameInvitePopup", () => ({ GameInvitePopup: (props: typeof mockPopup) => { mockPopup = props; return null; } }));
jest.mock("@/lib/gameInvites", () => ({ getPendingGameInvites: () => mockInvites(), respondGameInvite: (...args: unknown[]) => mockRespond(...args) }));
jest.mock("@/lib/gameParty", () => ({ getMyGameParty: () => mockParty(), cancelMyGameParty: () => mockCancel() }));
jest.mock("@/lib/shop", () => ({ getCachedShopState: () => null, getMyShopState: () => mockShop() }));
jest.mock("@/lib/supabase", () => ({ supabase: {
  channel: (name: string) => {
    const item = { name, event: () => {}, status: (_value: string) => {}, events: [] as { filter: string; callback: () => void }[] };
    mockChannels.push(item);
    const channel = { on: (_type: string, _filter: { filter: string }, callback: () => void) => { item.events.push({ filter: _filter.filter, callback }); item.event = callback; return channel; }, subscribe: (callback: (value: string) => void) => { item.status = callback; return channel; } };
    return channel;
  }, removeChannel: (...args: unknown[]) => mockRemove(...args),
} }));
const session = (id: string, token = id) => ({ access_token: token, user: { id } }) as Session;
const party = (id = "alice", version = 1): GameParty => ({ id: "party", leaderId: "leader", flowStatus: "matchmaking", currentGame: "domino", currentRoomId: "room", currentMode: "2v2", currentCurrency: "fun", currentEntryFee: 10, currentTableId: null, commandVersion: version, updatedAt: new Date().toISOString(), members: [{ userId: id, role: "member", name: id }] });
const invite = (id = "alice") => ({ id: "invite-" + id, recipientId: id, status: "pending", expiresAt: new Date(Date.now() + 60000).toISOString() });
const wrapper = ({ children }: { children: ReactNode }) => <GameInvitesProvider>{children}</GameInvitesProvider>;
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => {
  jest.clearAllMocks(); mockChannels.length = 0;
  mockInvites.mockReset().mockResolvedValue([]);
  mockParty.mockReset().mockResolvedValue(null);
  mockRespond.mockReset().mockResolvedValue({});
  mockCancel.mockReset().mockResolvedValue({});
  mockShop.mockReset().mockResolvedValue({});
  publishAuthState(session("alice"), true, true);
});
afterEach(() => { publishAuthState(null, false, false); });

test("does not subscribe or read before ready auth", async () => {
  publishAuthState(null, false, true);
  const ui = renderHook(useGameParty, { wrapper });
  await settle();
  expect(mockParty).not.toHaveBeenCalled(); expect(mockChannels).toHaveLength(0);
  ui.unmount();
});
test("logout immediately hides state and discards late navigation and callbacks", async () => {
  let finish!: (value: GameParty) => void;
  mockParty.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  mockInvites.mockResolvedValue([invite()]);
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  const oldChannel = mockChannels[0];
  act(() => publishAuthState(null, true, true));
  expect(ui.result.current.party).toBeNull(); expect(mockPopup.invite).toBeNull();
  await act(async () => { finish(party()); oldChannel.event(); oldChannel.status("SUBSCRIBED"); });
  expect(mockParty).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled(); expect(mockRemove).toHaveBeenCalled();
  ui.unmount();
});
test("old account cannot navigate after the Shop preload completes", async () => {
  let finish!: () => void;
  mockParty.mockResolvedValue({ ...party(), currentGame: "okey", currentTableId: "table" });
  mockShop.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  mockParty.mockResolvedValue(null);
  act(() => publishAuthState(session("bob"), true, true)); await settle();
  await act(async () => finish());
  expect(ui.result.current.party).toBeNull(); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
test("multiple events during a read cause one trailing read and never navigate from the superseded result", async () => {
  let finish!: (value: GameParty) => void;
  mockParty.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...party(), flowStatus: "idle" });
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  act(() => { mockChannels[0].event(); mockChannels[0].event(); mockChannels[0].event(); });
  expect(mockParty).toHaveBeenCalledTimes(1);
  await act(async () => finish(party()));
  expect(mockParty).toHaveBeenCalledTimes(2); expect(ui.result.current.party?.flowStatus).toBe("idle"); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
test("navigation happens once per command across token refresh and ignores older commands", async () => {
  mockParty.mockResolvedValue(party());
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  expect(mockReplace).toHaveBeenCalledTimes(1);
  act(() => publishAuthState(session("alice", "new-token"), true, true)); await settle();
  expect(mockReplace).toHaveBeenCalledTimes(1);
  mockParty.mockResolvedValue(party("alice", 0));
  await act(async () => { await ui.result.current.refreshParty(); });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  mockParty.mockResolvedValue(party("alice", 2));
  await act(async () => { await ui.result.current.refreshParty(); });
  expect(mockReplace).toHaveBeenCalledTimes(2);
  ui.unmount();
});
test("non-members and stale reconnect snapshots cannot navigate", async () => {
  mockParty.mockResolvedValue(party("someone-else"));
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  expect(ui.result.current.party).toBeNull();
  mockParty.mockResolvedValue({ ...party(), updatedAt: new Date(Date.now() - 120000).toISOString() });
  await act(async () => mockChannels[0].status("SUBSCRIBED"));
  expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
test.each(["respond", "cancel"])("late %s cannot alter the new account or refresh it", async kind => {
  mockInvites.mockResolvedValue([invite()]);
  mockParty.mockResolvedValue({ ...party(), flowStatus: "idle" });
  let finish!: () => void;
  (kind === "respond" ? mockRespond : mockCancel).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  act(() => { if (kind === "respond") mockPopup.onAccept(); else void ui.result.current.cancelParty(); });
  mockInvites.mockResolvedValue([invite("bob")]); mockParty.mockResolvedValue({ ...party("bob"), flowStatus: "idle" });
  act(() => publishAuthState(session("bob"), true, true)); await settle();
  const reads = mockParty.mock.calls.length;
  await act(async () => finish());
  expect(mockPopup.invite?.id).toBe("invite-bob"); expect(mockPopup.busy).toBe(false); expect(ui.result.current.cancellingParty).toBe(false);
  expect(mockParty).toHaveBeenCalledTimes(reads); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
test("resume does not accept a pre-background response or change generation", async () => {
  let finish!: (value: GameParty) => void;
  mockParty.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...party(), flowStatus: "idle" });
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  const auth = getAuthState();
  act(() => publishAuthState(auth.session, false, false));
  act(() => publishAuthState(auth.session, true, true)); await settle();
  await act(async () => finish(party()));
  expect(getAuthState().generation).toBe(auth.generation); expect(ui.result.current.party?.flowStatus).toBe("idle"); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});


test("an invite read failure does not hide a valid party", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockInvites.mockRejectedValue(new Error("invite offline"));
  mockParty.mockResolvedValue({ ...party(), flowStatus: "idle" });
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  expect(ui.result.current.party?.id).toBe("party");
  ui.unmount(); warn.mockRestore();
});
test("a party read failure does not hide incoming invitations", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockParty.mockRejectedValue(new Error("party offline"));
  mockInvites.mockResolvedValue([invite()]);
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  expect(mockPopup.invite?.id).toBe("invite-alice"); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount(); warn.mockRestore();
});
test("double accept sends once and an old expiry callback cannot remove Bob's invitation", async () => {
  mockInvites.mockResolvedValue([invite()]);
  let finish!: () => void;
  mockRespond.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  const expire = mockPopup.onExpire;
  act(() => { mockPopup.onAccept(); mockPopup.onAccept(); });
  expect(mockRespond).toHaveBeenCalledTimes(1);
  mockInvites.mockResolvedValue([invite("bob")]);
  act(() => publishAuthState(session("bob"), true, true)); await settle();
  await act(async () => { expire(); finish(); });
  expect(mockPopup.invite?.id).toBe("invite-bob");
  ui.unmount();
});
test("late cancel failure cannot set an error in a new account", async () => {
  let fail!: (error: Error) => void;
  mockCancel.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  mockParty.mockResolvedValue({ ...party(), flowStatus: "idle" });
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  act(() => { void ui.result.current.cancelParty(); });
  mockParty.mockResolvedValue(null);
  act(() => publishAuthState(session("bob"), true, true)); await settle();
  await act(async () => fail(new Error("old failure")));
  expect(ui.result.current.partyError).toBeNull(); expect(ui.result.current.cancellingParty).toBe(false);
  ui.unmount();
});
test("unmount closes channels and prevents pending navigation", async () => {
  let finish!: (value: GameParty) => void;
  mockParty.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  const channel = mockChannels[0]; ui.unmount();
  await act(async () => { finish(party()); channel.event(); });
  expect(mockReplace).not.toHaveBeenCalled(); expect(mockRemove).toHaveBeenCalled(); expect(mockParty).toHaveBeenCalledTimes(1);
});


test("sender-side invite updates refresh the leader's newly formed party", async () => {
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  const channel = mockChannels[0];
  expect(channel.events.map(event => event.filter)).toEqual(["recipient_id=eq.alice", "sender_id=eq.alice"]);
  mockParty.mockResolvedValue({ ...party(), leaderId: "alice", flowStatus: "idle" });
  await act(async () => channel.events[1].callback());
  expect(ui.result.current.party?.leaderId).toBe("alice");
  expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
test("successful cancellation invalidates a read started before it", async () => {
  mockParty.mockResolvedValue({ ...party(), flowStatus: "idle" });
  const ui = renderHook(useGameParty, { wrapper }); await settle();
  let finish!: (value: GameParty) => void;
  mockParty.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(null);
  act(() => { void ui.result.current.refreshParty(); }); await settle();
  await act(async () => { await ui.result.current.cancelParty(); });
  expect(ui.result.current.party).toBeNull();
  await act(async () => finish(party()));
  expect(ui.result.current.party).toBeNull(); expect(mockReplace).not.toHaveBeenCalled();
  ui.unmount();
});
