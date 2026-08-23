import { expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { OkeyMeldView } from "../../components/OkeyMeldView";
import { OkeyTileFace } from "../../components/OkeyTileFace";
import { OkeyTurnTimerBar } from "../../components/OkeyTurnTimerBar";
import { OkeyMatchResultPopup } from "../../components/OkeyMatchResultPopup";
import { OkeyCenterPiles } from "../../components/OkeyCenterPiles";
import type { OkeyMeld, OkeyTile } from "../../types/okey";

const tile = (id: string, color: OkeyTile["color"], value: number): OkeyTile => ({ id, color, value, copy: 1 });

test("interactive rack tile exposes label, state and keyboard-style move actions", () => {
  const select = jest.fn();
  const previous = jest.fn();
  const next = jest.fn();
  const view = render(
    <OkeyTileFace
      tile={tile("red-6", "red", 6)}
      selected
      onPress={select}
      onAccessibilityMovePrevious={previous}
      onAccessibilityMoveNext={next}
    />,
  );
  const control = view.getByRole("button");
  expect(control.props.accessibilityLabel).toContain("بەردی 6ی سوور");
  expect(control.props.accessibilityState).toEqual({ selected: true, disabled: false });
  expect(control.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(["activate", "decrement", "increment"]);

  fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
  fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
  fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  expect(select).toHaveBeenCalledTimes(1);
  expect(previous).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledTimes(1);
});

test("table meld is exposed as one meaningful summary", () => {
  const meld: OkeyMeld = {
    id: "run",
    ownerId: "player",
    kind: "run",
    score: 18,
    tiles: [tile("b5", "blue", 5), tile("b6", "blue", 6), tile("b7", "blue", 7)],
  };
  const view = render(<OkeyMeldView meld={meld} okeyTile={tile("okey", "red", 13)} />);
  expect(view.getByRole("summary").props.accessibilityLabel).toContain("ڕیزی 3 بەردی");
});

test("active timer and match result are announced with semantic roles", () => {
  const timer = render(<OkeyTurnTimerBar active durationMs={25_000} />);
  expect(timer.getByRole("timer").props.accessibilityLabel).toBe("کاتی نۆبەت، 25 چرکە");

  const result = render(
    <OkeyMatchResultPopup
      visible
      winnerTeamId="teamA"
      matchScores={{ teamA: 10, teamB: 20 }}
      onNewMatch={jest.fn()}
    />,
  );
  expect(result.getByRole("alert").props.accessibilityLiveRegion).toBe("assertive");
  expect(result.UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
  expect(result.getByRole("button").props.accessibilityLabel).toBe("دەرچوون");
});
test("discard exposes separate accessible actions for taking a tile and viewing history", () => {
  const take = jest.fn();
  const history = jest.fn();
  const view = render(
    <OkeyCenterPiles
      deckCount={30}
      topDiscard={tile("discard", "yellow", 8)}
      discardCount={4}
      canDraw
      canDrawDiscard
      indicatorTile={tile("indicator", "blue", 12)}
      okeyTile={tile("okey", "blue", 13)}
      onDrawDeck={jest.fn()}
      onDrawDiscard={take}
      onViewDiscards={history}
    />,
  );
  const discard = view.getByTestId("okey-top-discard");
  expect(discard.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(["activate", "viewHistory"]);
  fireEvent(discard, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
  fireEvent(discard, "accessibilityAction", { nativeEvent: { actionName: "viewHistory" } });
  expect(take).toHaveBeenCalledTimes(1);
  expect(history).toHaveBeenCalledTimes(1);
});