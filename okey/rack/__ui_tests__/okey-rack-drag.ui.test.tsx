import { act, renderHook } from "@testing-library/react-native";
import { PanResponder, type PanResponderCallbacks } from "react-native";
import { useOkeyRackDrag } from "../useOkeyRackDrag";
import * as layout from "../rack-layout";
import type { OkeyTile } from "@/okey/types/okey";

const tiles: OkeyTile[] = [4, 5, 6].map((value) => ({ id: `t${value}`, color: "blue", value, copy: 1 }));
const point = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });
const gesture = (dx = 0) => ({ x0: 20, y0: 100, dx, dy: 0, moveX: 20 + dx, moveY: 100 });
let handlers: PanResponderCallbacks;
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PanResponder, "create").mockImplementation((config) => {
    handlers = config;
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
function setup() {
  const onDropTile = jest.fn(() => true);
  const onDropMeldGroup = jest.fn(() => true);
  const onTileDragPointChange = jest.fn();
  const ui = renderHook(() => useOkeyRackDrag({
    tiles, okeyTile: { id: "joker", color: "yellow", value: 13, copy: 1 },
    stagedTileIdSet: new Set(), rackInteractionLocked: false,
    rackTileWidth: 40, rackTileHeight: 60, rackTileStride: 42,
    viewportOriginRef: { current: { x: 0, y: 0, width: 650, height: 140 } },
    rowLayoutsRef: { current: { top: { x: 0, y: 0, width: 650, height: 60 }, bottom: { x: 0, y: 70, width: 650, height: 60 } } },
    onSelectTile: jest.fn(), onDropTile, onDropMeldGroup, onTileDragPointChange,
  }));
  ui.result.current.getTilePanHandlers("t4");
  act(() => handlers.onPanResponderGrant!(point(20, 100) as never, gesture() as never));
  return { ...ui, onDropTile, onDropMeldGroup, onTileDragPointChange };
}
function move(x: number, y = 100) {
  act(() => handlers.onPanResponderMove!(point(x, y) as never, gesture(x - 20) as never));
}
function release(x: number, y = 100) {
  act(() => handlers.onPanResponderRelease!(point(x, y) as never, gesture(x - 20) as never));
}
test("internal hover stays local and release uses its final slot", () => {
  const ui = setup();
  move(62);
  act(() => jest.advanceTimersByTime(200));
  expect(ui.result.current.draggingMeld).toBeNull();
  expect(ui.result.current.committedRackSlots.bottom[0]).toBe("t4");
  expect(ui.onTileDragPointChange).not.toHaveBeenCalled();
  release(104, 30);
  expect(ui.result.current.committedRackSlots.top[2]).toBe("t4");
  expect(ui.onDropTile).not.toHaveBeenCalled();
  expect(ui.onDropMeldGroup).not.toHaveBeenCalled();
});
test("release outside the rack ignores the last internal preview and refreshes hover", () => {
  const ui = setup();
  move(62);
  release(800, 300);
  expect(ui.result.current.committedRackSlots.bottom[0]).toBe("t4");
  expect(ui.onDropTile).toHaveBeenCalledWith("t4", { x: 800, y: 300 });
  expect(ui.onTileDragPointChange.mock.calls[0]).toEqual(["t4", { x: 800, y: 300 }]);
});
test("unchanged target does not rebuild placement", () => {
  setup();
  const place = jest.spyOn(layout, "moveTileIntoSlot");
  move(62); move(63); move(64);
  expect(place).toHaveBeenCalledTimes(1);
});
test("holding before movement still supports group drag", () => {
  const ui = setup();
  act(() => jest.advanceTimersByTime(160));
  expect(ui.result.current.draggingMeld?.tileIds).toEqual(["t4", "t5", "t6"]);
  move(104);
  release(800, 300);
  expect(ui.onDropMeldGroup).toHaveBeenCalledTimes(1);
  expect(ui.onDropTile).not.toHaveBeenCalled();
});
test("unmount clears the pending long press", () => {
  const ui = setup();
  const findMeld = jest.spyOn(layout, "getBestMeldIncludingSlot");
  ui.unmount();
  act(() => jest.advanceTimersByTime(200));
  expect(findMeld).not.toHaveBeenCalled();
});
test("accessibility reorder updates local slots", () => {
  const ui = setup();
  act(() => handlers.onPanResponderTerminate!(point(20, 100) as never, gesture() as never));
  act(() => ui.result.current.moveRackTile("t4", 2));
  expect(ui.result.current.committedRackSlots.bottom.slice(0, 3)).toEqual(["t5", "t6", "t4"]);
  expect(ui.onDropTile).not.toHaveBeenCalled();
});
