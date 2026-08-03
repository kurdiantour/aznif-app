import { expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";


import { OkeyCenterPiles } from "../OkeyCenterPiles";
import type { OkeyTile } from "../../types/okey";

const tile = (id: string, value: number): OkeyTile => ({ id, color: "blue", value, copy: 1 });

test("deck press dispatches Draw only while drawing is allowed", () => {
  const onDrawDeck = jest.fn();
  const props = {
    deckCount: 42,
    topDiscard: tile("discard", 7),
    indicatorTile: tile("indicator", 12),
    okeyTile: tile("okey", 13),
    onDrawDeck,
    onDrawDiscard: jest.fn(),
  };
  const enabled = render(<OkeyCenterPiles {...props} canDraw />);
  fireEvent.press(enabled.getByTestId("okey-draw-deck"));
  expect(onDrawDeck).toHaveBeenCalledTimes(1);

  enabled.rerender(<OkeyCenterPiles {...props} canDraw={false} />);
  fireEvent.press(enabled.getByTestId("okey-draw-deck"));
  expect(onDrawDeck).toHaveBeenCalledTimes(1);
});

test("discard tap opens history without taking a forbidden discard", () => {
  const onViewDiscards = jest.fn();
  const onDrawDiscard = jest.fn();
  const view = render(
    <OkeyCenterPiles
      deckCount={20}
      topDiscard={tile("discard", 9)}
      canDraw
      canDrawDiscard={false}
      indicatorTile={tile("indicator", 12)}
      okeyTile={tile("okey", 13)}
      onDrawDeck={jest.fn()}
      onDrawDiscard={onDrawDiscard}
      onViewDiscards={onViewDiscards}
    />,
  );
  const discardGestureView = view.getByTestId("okey-top-discard");
  fireEvent(discardGestureView, "responderRelease", {}, { dx: 0, dy: 0, moveX: 0, moveY: 0 });
  expect(onViewDiscards).toHaveBeenCalledTimes(1);
  expect(onDrawDiscard).not.toHaveBeenCalled();
});
