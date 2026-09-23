import { renderHook } from "@testing-library/react-native";
import { getOpenableRackLayout } from "@/okey/engine/okey-rack-layout";
import { useOkeyOptimisticRackPresentation } from "@/okey/presentation/useOkeyTileFlightCoordinator";
import type { OkeyTile } from "@/okey/types/okey";
import { createEmptySlots } from "../rack-layout";
import { useOkeyRackSnapshot } from "../useOkeyRackSnapshot";

jest.mock("@/okey/engine/okey-rack-layout", () => ({
  ...jest.requireActual("@/okey/engine/okey-rack-layout"),
  getOpenableRackLayout: jest.fn(jest.requireActual("@/okey/engine/okey-rack-layout").getOpenableRackLayout),
}));

const tiles: OkeyTile[] = [4, 5, 6].map((value) => ({ id: `t${value}`, color: "blue", value, copy: 1 }));
const okeyTile: OkeyTile = { id: "okey", color: "yellow", value: 13, copy: 1 };
function input() {
  const slots = createEmptySlots();
  slots.bottom.splice(0, 3, ...tiles.map((tile) => tile.id));
  return { slots, tileById: new Map(tiles.map((tile) => [tile.id, tile])), staged: new Set<string>(), okeyTile };
}

test("equivalent layout, tile objects and callbacks neither recompute nor republish", () => {
  const publish = jest.fn();
  const props = { ...input(), publish };
  const ui = renderHook((p: typeof props) => useOkeyRackSnapshot(p.slots, p.tileById, p.staged, p.okeyTile, p.publish), { initialProps: props });
  expect(getOpenableRackLayout).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0].score).toBe(15);
  const replacement = jest.fn();
  ui.rerender({ ...input(), tileById: new Map(tiles.map((tile) => [tile.id, { ...tile }])), okeyTile: { ...okeyTile }, publish: replacement });
  expect(getOpenableRackLayout).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
});

test("staging and changed tile metadata update the snapshot even when score stays zero", () => {
  const publish = jest.fn();
  const props = input();
  const ui = renderHook((p: typeof props) => useOkeyRackSnapshot(p.slots, p.tileById, p.staged, p.okeyTile, publish), { initialProps: props });
  const staged = new Set([tiles[1].id]);
  ui.rerender({ ...props, staged });
  expect(publish.mock.calls[1][0]).toMatchObject({ score: 0, contiguousGroups: [[tiles[0]], [tiles[2]]] });
  const changed = { ...tiles[0], jokerOrigin: "stolen" as const };
  ui.rerender({ ...props, staged, tileById: new Map([[changed.id, changed], ...tiles.slice(1).map((tile) => [tile.id, tile] as const)]) });
  expect(getOpenableRackLayout).toHaveBeenCalledTimes(3);
  expect(publish).toHaveBeenCalledTimes(3);
  expect(publish.mock.calls[2][0].contiguousGroups[0][0].jokerOrigin).toBe("stolen");
});

test("group order changes are published even with equal score; irrelevant okey changes are not", () => {
  const publish = jest.fn();
  const props = input();
  const ui = renderHook((p: typeof props) => useOkeyRackSnapshot(p.slots, p.tileById, p.staged, p.okeyTile, publish), { initialProps: props });
  const slots = createEmptySlots();
  slots.bottom.splice(0, 3, ...tiles.map((tile) => tile.id).reverse());
  ui.rerender({ ...props, slots });
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish.mock.calls[1][0].score).toBe(15);
  ui.rerender({ ...props, slots, okeyTile: { ...okeyTile, value: 12 } });
  expect(getOpenableRackLayout).toHaveBeenCalledTimes(3);
  expect(publish).toHaveBeenCalledTimes(2);
});

test("optimistic hand keeps its reference until inputs change and uses authoritative membership on confirmation", () => {
  const optimisticTile: OkeyTile = { ...tiles[0], id: "drawn" };
  const clear = jest.fn();
  const props = { hand: tiles, optimisticTile };
  const ui = renderHook((p: typeof props) => useOkeyOptimisticRackPresentation(p.hand, p.optimisticTile, clear), { initialProps: props });
  const first = ui.result.current;
  ui.rerender({ ...props });
  expect(ui.result.current).toBe(first);
  const confirmed = [...tiles, optimisticTile];
  ui.rerender({ hand: confirmed, optimisticTile });
  expect(ui.result.current).toBe(confirmed);
  expect(clear).toHaveBeenCalledTimes(1);
});
