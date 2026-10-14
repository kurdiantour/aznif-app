import { render } from "@testing-library/react-native";

import GameOverPopup from "@/domino/components/GameOverPopup";

jest.mock("expo-blur", () => ({ BlurView: "View" }));

test("shared final popup distinguishes a Dama draw and shows the settled net Coin delta", () => {
  const screen = render(<GameOverPopup visible didWin={false} isDraw
    reward={{ coin: -500, gem: 0, points: 0, currency: "fun" }}
    onClose={() => undefined} onPlayAgain={() => undefined} />);

  expect(screen.getByText("Draw")).toBeTruthy();
  // Both seats paid the 500 Coin entry fee; the no-winner settlement pays
  // nothing back, so this player's settled net delta remains -500.
  expect(screen.getByText(/٥٠٠/)).toBeTruthy();
  expect(screen.getByText("Coin")).toBeTruthy();
});
