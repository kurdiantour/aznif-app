import { fireEvent, render, waitFor } from "@testing-library/react-native";

import OkeyScreen from "@/app/okey";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockMatchmake = jest.fn();
let mockCurrency: "fun" | "aznif" = "fun";

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => ({ currency: mockCurrency }),
}));
jest.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("@/components/lobby/LobbyHeader", () => ({ LobbyHeader: () => null }));
jest.mock("@/components/lobby/BottomNav", () => ({
  BottomNav: ({ active }: { active: string }) => {
    const { Text } = require("react-native");
    return <Text testID="active-section">{active}</Text>;
  },
}));
jest.mock("@/lib/auth-state", () => ({ useAuthState: () => ({ userId: "human" }) }));
jest.mock("@/lib/wallet-context", () => ({ useWallet: () => ({ coinBalance: 5000, aznifBalance: 50 }) }));
jest.mock("@/lib/shop", () => ({ getCachedShopState: () => ({}), getMyShopState: jest.fn() }));
jest.mock("@/okey/multiplayer/okey-room-api", () => ({ matchmakeOkeyRoom: (...args: unknown[]) => mockMatchmake(...args) }));

beforeEach(() => { mockPush.mockClear(); mockReplace.mockClear(); mockMatchmake.mockReset(); });

test.each([
  ["fun", "home", "Okey 1v1", "1v1:starter", "1v1"],
  ["fun", "home", "Okey 2v2", "starter", "2v2"],
  ["aznif", "aznif", "Okey 1v1", "1v1:aznif-low", "1v1"],
  ["aznif", "aznif", "Okey 2v2", "aznif-low", "2v2"],
] as const)("%s Okey %s starts %s matchmaking with %s", async (currency, activeSection, card, tableId, mode) => {
  mockCurrency = currency;
  mockMatchmake.mockResolvedValue({ matchId: "match", tableId, mode });
  const ui = render(<OkeyScreen />);
  expect(ui.getByTestId("active-section")).toHaveTextContent(activeSection);
  fireEvent.press(ui.getByLabelText(card));
  await waitFor(() => expect(mockMatchmake).toHaveBeenCalledWith(tableId));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/okey/game",
    params: { mode: currency, table: tableId, tableId, matchId: "match", matchMode: mode },
  }));
  expect(mockPush).not.toHaveBeenCalled();
});

test.each(["Okey 1v1", "Okey 2v2"])("loading stays inside the selected %s card until the room is ready", async (card) => {
  mockCurrency = "fun";
  let resolveRoom!: (room: { matchId: string; tableId: string; mode: string }) => void;
  mockMatchmake.mockReturnValue(new Promise((resolve) => { resolveRoom = resolve; }));
  const ui = render(<OkeyScreen />);
  fireEvent.press(ui.getByLabelText(card));
  expect(ui.getByTestId(`okey-card-loading-${card}`)).toBeTruthy();
  expect(ui.queryByTestId(`okey-card-loading-${card === "Okey 1v1" ? "Okey 2v2" : "Okey 1v1"}`)).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
  const mode = card === "Okey 1v1" ? "1v1" : "2v2";
  resolveRoom({ matchId: "match", tableId: mode === "1v1" ? "1v1:starter" : "starter", mode });
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
});

test("failed matchmaking clears card loading and allows another attempt", async () => {
  mockCurrency = "aznif";
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockMatchmake.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ matchId: "match", tableId: "1v1:aznif-low", mode: "1v1" });
  const ui = render(<OkeyScreen />);
  fireEvent.press(ui.getByLabelText("Okey 1v1"));
  await waitFor(() => expect(ui.queryByTestId("okey-card-loading-Okey 1v1")).toBeNull());
  expect(mockReplace).not.toHaveBeenCalled();
  fireEvent.press(ui.getByLabelText("Okey 1v1"));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  expect(mockMatchmake).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
