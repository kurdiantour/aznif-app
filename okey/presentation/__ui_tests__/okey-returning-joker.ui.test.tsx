import { act, renderHook } from "@testing-library/react-native";

import type { OkeyTile } from "@/okey/types/okey";
import { useOkeyReturningJokerPresentation } from "../OkeyReturningJokerPresentation";

const joker: OkeyTile = { id: "joker", color: "red", value: 5, copy: 1, jokerOrigin: "stolen" };
const rect = { x: 10, y: 20, width: 30, height: 40 };
const setup = (tiles: OkeyTile[] = []) => renderHook(
  (props: { tiles: OkeyTile[]; resetKey: string }) => useOkeyReturningJokerPresentation(props.tiles, props.resetKey),
  { initialProps: { tiles, resetKey: "round-1" } },
);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("existing stolen jokers and normal draws do not animate; a new returned joker does", () => {
  const ui = setup([joker]);
  expect(ui.result.current.arrivals).toEqual([]);
  ui.rerender({ tiles: [], resetKey: "round-1" });
  ui.rerender({ tiles: [{ ...joker, id: "natural", jokerOrigin: "natural" }], resetKey: "round-1" });
  expect(ui.result.current.arrivals).toEqual([]);
  ui.rerender({ tiles: [joker], resetKey: "round-1" });
  expect(ui.result.current.arrivals).toEqual([{ tile: joker, rect: null }]);
  act(() => ui.result.current.onTileMeasured(joker.id, rect));
  expect(ui.result.current.arrivals[0].rect).toEqual(rect);
  act(() => ui.result.current.dismiss(joker.id));
  expect(ui.result.current.arrivals).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
});

test("hand updates do not cancel arrival expiry and multiple arrivals expire independently", () => {
  const ui = setup();
  ui.rerender({ tiles: [joker], resetKey: "round-1" });
  act(() => jest.advanceTimersByTime(400));
  const second = { ...joker, id: "second" };
  ui.rerender({ tiles: [second, { ...joker }], resetKey: "round-1" });
  act(() => jest.advanceTimersByTime(500));
  expect(ui.result.current.arrivals.map(({ tile }) => tile.id)).toEqual(["second"]);
  act(() => jest.advanceTimersByTime(400));
  expect(ui.result.current.arrivals).toEqual([]);
});

test("leaving the hand, round reset and unmount clean up arrivals and timers", () => {
  const ui = setup();
  ui.rerender({ tiles: [joker], resetKey: "round-1" });
  ui.rerender({ tiles: [], resetKey: "round-1" });
  expect(ui.result.current.arrivals).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  ui.rerender({ tiles: [joker], resetKey: "round-1" });
  ui.rerender({ tiles: [joker], resetKey: "round-2" });
  expect(ui.result.current.arrivals).toEqual([]);
  expect(jest.getTimerCount()).toBe(0);
  ui.rerender({ tiles: [], resetKey: "round-2" });
  ui.rerender({ tiles: [joker], resetKey: "round-2" });
  ui.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
