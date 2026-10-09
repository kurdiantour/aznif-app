import { act, fireEvent, render } from "@testing-library/react-native";
import { ReturnToGamePopup } from "@/components/multiplayer/ReturnToGamePopup";
import { MultiplayerResumeOverlay } from "@/components/multiplayer/MultiplayerResumeOverlay";

const mockRouter = { replace: jest.fn() };
const mockFindActive = jest.fn();
const mockValidate = jest.fn();
const mockReturnToMatch = jest.fn();
const mockReject = jest.fn();
const mockWatch = jest.fn();
const match = { game: "domino", matchId: "room", route: "/domino/game", params: { room_id: "room", mode: "1v1", playMode: "aznif" } };

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/auth-state", () => ({ useAuthState: () => ({ userId: "human", authReady: true }) }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/(tabs)/play" }));
jest.mock("@/domino/multiplayer/domino-resume-adapter", () => ({
  dominoResumeAdapter: {
    game: "domino", isGameRoute: (path: string) => path === "/domino/game",
    findActive: (...args: unknown[]) => mockFindActive(...args),
    validate: (...args: unknown[]) => mockValidate(...args),
    watch: (...args: unknown[]) => mockWatch(...args),
    returnToMatch: (...args: unknown[]) => mockReturnToMatch(...args),
    reject: (...args: unknown[]) => mockReject(...args),
  },
}));

beforeEach(() => {
  mockFindActive.mockResolvedValue(match);
  mockValidate.mockResolvedValue(true);
  mockReturnToMatch.mockResolvedValue(true);
  mockReject.mockResolvedValue(undefined);
  mockWatch.mockReturnValue(jest.fn());
});

async function show() {
  const ui = render(<MultiplayerResumeOverlay />);
  await act(async () => { await Promise.resolve(); });
  return ui;
}

test("Realtime invalidation dismisses a finished match without polling", async () => {
  const interval = jest.spyOn(global, "setInterval");
  const ui = await show();
  expect(ui.UNSAFE_getByType(ReturnToGamePopup)).toBeTruthy();
  expect(interval).not.toHaveBeenCalled();
  const invalidated = mockWatch.mock.calls[0][1] as () => void;
  mockValidate.mockResolvedValue(false);
  await act(async () => { invalidated(); });
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
  interval.mockRestore();
});

test("Return waits for server reclaim before entering the same match", async () => {
  const ui = await show();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-return")); });
  expect(mockReturnToMatch).toHaveBeenCalledWith(match, "human");
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/domino/game", params: match.params });
});

test("a finished match returns to the lobby when Return is pressed", async () => {
  mockReturnToMatch.mockResolvedValue(false);
  const ui = await show();
  await act(async () => { fireEvent.press(ui.getByTestId("return-to-game-return")); });
  expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/play");
  expect(ui.UNSAFE_queryByType(ReturnToGamePopup)).toBeNull();
});
