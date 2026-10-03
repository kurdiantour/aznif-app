import { act, fireEvent, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { ReturnToGamePopup } from "@/components/game/ReturnToGamePopup";
import { OkeyReturnToGameOverlay } from "../OkeyReturnToGameOverlay";

const mockProfile = { id: "human" };
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockMemberships = jest.fn();
const mockRefresh = jest.fn();
const mockDispatch = jest.fn();
const mockLeave = jest.fn();
const mockSnapshot = jest.fn();
const mockSubscribe = jest.fn((_listener: (snapshot: unknown) => void) => jest.fn());

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/profile", () => ({ useProfile: () => ({ profile: mockProfile }) }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/(tabs)/play" }));
jest.mock("../okey-room-api", () => ({ getActiveOkeyMemberships: () => mockMemberships() }));
jest.mock("@/okey/adapters/supabase-okey-match-adapter", () => ({
  SupabaseOkeyMatchAdapter: jest.fn().mockImplementation(() => ({
    refresh: () => mockRefresh(), getSnapshot: () => mockSnapshot(),
    subscribe: (listener: (snapshot: unknown) => void) => mockSubscribe(listener),
    dispatch: (command: unknown) => mockDispatch(command), leave: () => mockLeave(),
  })),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockMemberships.mockResolvedValue([{ matchId: "match", status: "playing" }]);
  mockRefresh.mockResolvedValue(undefined);
  mockDispatch.mockResolvedValue(undefined);
  mockLeave.mockResolvedValue(undefined);
  mockSnapshot.mockReturnValue({ matchFinished: false, players: [{ id: "human", controlledByBot: true }] });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

async function showOverlay() {
  const ui = render(<OkeyReturnToGameOverlay />);
  await act(async () => { jest.advanceTimersByTime(0); });
  return ui;
}

test("shared popup delegates actions and blocks both buttons while loading", () => {
  const onReturn = jest.fn();
  const onReject = jest.fn();
  const ui = render(<ReturnToGamePopup loading={false} onReturn={onReturn} onReject={onReject} />);
  fireEvent.press(ui.getByTestId("return-to-game-return"));
  fireEvent.press(ui.getByTestId("return-to-game-reject"));
  expect(onReturn).toHaveBeenCalledTimes(1);
  expect(onReject).toHaveBeenCalledTimes(1);
  ui.rerender(<ReturnToGamePopup loading onReturn={onReturn} onReject={onReject} />);
  fireEvent.press(ui.getByTestId("return-to-game-return"));
  fireEvent.press(ui.getByTestId("return-to-game-reject"));
  expect(onReturn).toHaveBeenCalledTimes(1);
  expect(onReject).toHaveBeenCalledTimes(1);
});

test("return for takeover player triggers take-back-seat and navigates", async () => {
  const ui = await showOverlay();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-return")); });
  expect(mockRefresh).toHaveBeenCalledTimes(3);
  expect(mockDispatch).toHaveBeenCalledWith({ type: "take-back-seat" });
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/okey/game", params: { matchId: "match", mode: "fun" } });
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
});

test("return for non-takeover active player navigates directly without take-back-seat", async () => {
  mockSnapshot.mockReturnValue({ matchFinished: false, players: [{ id: "human", controlledByBot: false }] });
  const ui = await showOverlay();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-return")); });
  expect(mockRefresh).toHaveBeenCalledTimes(3);
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/okey/game", params: { matchId: "match", mode: "fun" } });
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
});

test("reject leaves the match, excludes it from subsequent checks and returns to the lobby", async () => {
  const ui = await showOverlay();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-reject")); });
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/play");
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
});

test.each([
  { matchFinished: true, players: [{ id: "human", controlledByBot: true }] },
  { matchFinished: true, players: [{ id: "human", controlledByBot: false }] },
  null,
])("finished or missing match snapshot does not display the popup: %j", async (snapshot) => {
  mockSnapshot.mockReturnValue(snapshot);
  const ui = await showOverlay();
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
});

test("failed return keeps the popup available without navigating", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDispatch.mockRejectedValueOnce(new Error("rejected"));
  const ui = await showOverlay();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-return")); });
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(ui.UNSAFE_getByType(ReturnToGamePopup).props.loading).toBe(false);
});

test("foreground rechecks membership and unmount removes the listener", async () => {
  const remove = jest.fn();
  let listener: (state: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    listener = callback;
    return { remove };
  });
  const ui = await showOverlay();
  await act(async () => { listener("background"); });
  expect(mockMemberships).toHaveBeenCalledTimes(1);
  await act(async () => { listener("active"); });
  expect(mockMemberships).toHaveBeenCalledTimes(2);
  ui.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
