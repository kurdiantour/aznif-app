import { act, render, within } from "@testing-library/react-native";
import { Animated } from "react-native";
import { OkeyOpponentSeat } from "../OkeyOpponentSeat";
import { OkeyTileBack } from "../OkeyTileFace";

jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  const React = jest.requireActual("react");
  return Object.defineProperty(Object.create(native), 'Pressable', {
    value: React.forwardRef(function MockPressable(props: object, ref: unknown) {
      React.useImperativeHandle(ref, () => ({
        measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(100, 100, 140, 40),
      }));
      return React.createElement(native.View, props);
    }),
  });
});

jest.mock("../../layout/OkeyResponsiveLayoutProvider", () => ({
  useOkeyResponsiveLayout: () => ({ seats: { top: {}, left: {}, right: {} } }),
}));
jest.mock("../../hooks/useOkeyCosmetics", () => ({
  useOkeyCosmetics: () => ({ getPlayerAssets: () => ({ opponentRack: 1 }) }),
}));
jest.mock("../OkeyTileFace", () => ({ OkeyTileBack: () => null }));
jest.mock("../OkeyTurnTimerBar", () => ({ OkeyTurnTimerBar: () => null }));

const props = {
  name: "Opponent", count: 14, active: false, side: "top" as const,
  turnTimeLeftMilliseconds: 0, turnDeadlineAt: null,
  serverClockOffsetMs: 0, turnDurationSeconds: null,
};
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([[0, 0], [1, 1], [3, 3], [5, 5], [6, 6], [7, 7], [14, 7], [15, 7]])("rack renders count=%i without needing deal geometry (including Preview)", (count, displayed) => {
  const ui = render(<OkeyOpponentSeat {...props} count={count} dealResetKey="preview" />);
  expect(within(ui.getByTestId("opponent-rack-top")).UNSAFE_queryAllByType(OkeyTileBack)).toHaveLength(displayed);
  expect(ui.queryByTestId("opponent-deal-top")).toBeNull();
});

test("deal is a separate overlay, survives its own rerender, and cannot hide the rack", () => {
  const stop = jest.fn();
  let complete: ((result: { finished: boolean }) => void) | undefined;
  jest.spyOn(Animated, "parallel").mockImplementation(() => ({
    start: callback => { complete = callback; }, stop, reset: jest.fn(),
  }));
  const ui = render(<OkeyOpponentSeat {...props} dealResetKey="round-1" dealOrigin={{ x: 0, y: 0 }} />);
  act(() => { jest.advanceTimersByTime(20); });
  expect(ui.getByTestId("opponent-deal-top")).toBeTruthy();
  expect(stop).not.toHaveBeenCalled();
  expect(within(ui.getByTestId("opponent-rack-top")).UNSAFE_queryAllByType(OkeyTileBack)).toHaveLength(7);
  act(() => { complete?.({ finished: true }); });
  expect(ui.queryByTestId("opponent-deal-top")).toBeNull();
  expect(within(ui.getByTestId("opponent-rack-top")).UNSAFE_queryAllByType(OkeyTileBack)).toHaveLength(7);
});

test("count changes during a deal update the rack even when the animation is interrupted", () => {
  jest.spyOn(Animated, "parallel").mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  const ui = render(<OkeyOpponentSeat {...props} dealResetKey="round-1" dealOrigin={{ x: 0, y: 0 }} />);
  act(() => { jest.advanceTimersByTime(20); });
  ui.rerender(<OkeyOpponentSeat {...props} count={3} dealResetKey="round-1" dealOrigin={{ x: 0, y: 0 }} />);
  expect(within(ui.getByTestId("opponent-rack-top")).UNSAFE_queryAllByType(OkeyTileBack)).toHaveLength(3);
  expect(ui.queryByTestId("opponent-deal-top")).toBeNull();
});