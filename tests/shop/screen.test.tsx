import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Image } from "react-native";
import ShopScreen from "@/app/(tabs)/shop";

const mockPurchase = jest.fn();
const mockRefresh = jest.fn();
let mockLoadError: string | null = null;
const mockItem = { id: "table-royal", category: "tables", owned: false, is_default: false, access_kind: null, price_gem: 520, sale_available: true, images: { shopPreview: 1 } };
jest.mock("@/lib/shop", () => ({ purchaseOrEquipShopItem: (...args: unknown[]) => mockPurchase(...args) }));
jest.mock("@/lib/wallet-context", () => ({ useWallet: () => ({ refreshWallet: jest.fn() }) }));
jest.mock("@/lib/platformFeatures", () => ({ ENABLE_SHOP_FEATURES: true }));
jest.mock("@/hooks/useShopState", () => ({ useShopState: () => ({ state: null, error: mockLoadError, refresh: mockRefresh }) }));
jest.mock("@/constants/catalog/cosmetics", () => ({ getShopDisplayItems: () => mockLoadError ? [] : [mockItem] }));
jest.mock("@/constants/shop", () => ({ SHOP_CATEGORIES: [{ id: "tables", label: "Tables" }] }));
jest.mock("@/components/shop/InsufficientGemsPopup", () => ({ ShopPopupContext: require("react").createContext({
  showInsufficientGems: jest.fn(), showPurchaseConfirmation: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-router", () => ({ Redirect: () => null }));
jest.mock("react-native-screens", () => ({ FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children }));
beforeEach(() => {
  mockLoadError = null; mockPurchase.mockReset(); mockRefresh.mockReset();
  jest.spyOn(Image, "resolveAssetSource").mockReturnValue({ width: 100, height: 100, scale: 1, uri: "test" });
});
afterEach(() => jest.restoreAllMocks());

test("Shop load errors show an alert and an explicit retry action", () => {
  mockLoadError = "private backend detail";
  const screen = render(<ShopScreen />);
  expect(screen.getByRole("alert").props.children).toBeTruthy();
  expect(screen.queryByText(mockLoadError)).toBeNull();
  fireEvent.press(screen.getByRole("button"));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
for (const status of ["price_changed", "unavailable"]) {
  test(`Shop displays ${status} to the user`, async () => {
    mockPurchase.mockResolvedValue({ status });
    const screen = render(<ShopScreen />);
    fireEvent.press(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert").props.children).toBeTruthy());
    expect(mockPurchase).toHaveBeenCalledWith("table-royal", 520);
    expect(mockRefresh).toHaveBeenCalled();
  });
}
test("Shop displays purchase failures", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockPurchase.mockRejectedValue(new Error("offline"));
  const screen = render(<ShopScreen />);
  fireEvent.press(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("alert").props.children).toBeTruthy());
});
