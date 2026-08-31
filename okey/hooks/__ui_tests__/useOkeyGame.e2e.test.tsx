import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { Pressable, Text, View } from "react-native";

import { useOkeyMultiplayerGame } from "../useOkeyMultiplayerGame";

function OnlineOnlyFallbackHarness() {
  const game = useOkeyMultiplayerGame();
  const player = game.state.players[0];
  return (
    <View>
      <Text testID="phase">{game.state.phase}</Text>
      <Text testID="turn">{game.state.currentPlayerIndex}</Text>
      <Text testID="hand-count">{player.hand.length}</Text>
      <Text testID="drawn">{String(game.state.hasDrawnThisTurn)}</Text>
      <Text testID="discard-count">{game.state.discardPile.length}</Text>
      <Pressable testID="draw-deck" onPress={() => game.draw("deck")} />
      <Pressable testID="discard" onPress={() => game.discard(game.state.players[0].hand[0]?.id ?? "missing")} />
    </View>
  );
}

test("online-only fallback ignores local authoritative commands", async () => {
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  const view = render(<OnlineOnlyFallbackHarness />);

  await waitFor(() => expect(view.getByTestId("hand-count").props.children).toBe(15));
  expect(view.getByTestId("turn").props.children).toBe(0);

  fireEvent.press(view.getByTestId("discard"));
  expect(view.getByTestId("hand-count").props.children).toBe(15);
  expect(view.getByTestId("discard-count").props.children).toBe(0);
  random.mockRestore();
});

test("dealer cannot draw before making the opening discard", async () => {
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  const view = render(<OnlineOnlyFallbackHarness />);
  await waitFor(() => expect(view.getByTestId("hand-count").props.children).toBe(15));

  fireEvent.press(view.getByTestId("draw-deck"));
  expect(view.getByTestId("hand-count").props.children).toBe(15);
  expect(view.getByTestId("turn").props.children).toBe(0);
  expect(view.getByTestId("drawn").props.children).toBe("true");
  random.mockRestore();
});
