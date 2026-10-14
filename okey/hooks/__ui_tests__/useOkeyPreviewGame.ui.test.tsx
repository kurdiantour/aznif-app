import { act, renderHook } from "@testing-library/react-native";
import { useOkeyPreviewGame } from "../useOkeyPreviewGame";
import { createSeededOkeyBotRandom } from "@/okey/engine/okey-bot-engine";
import type { OkeyCommittedTransition } from "@/okey/adapters/okey-match-adapter";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-21T00:00:00Z"));
  jest.spyOn(Math, "random").mockImplementation(createSeededOkeyBotRandom(42));
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("preview starts with layout melds for every seat without duplicating live tiles", () => {
  const { result } = renderHook(() => useOkeyPreviewGame());
  const players = result.current.state.players;
  const allTileIds = [
    ...result.current.state.players.flatMap((entry) => entry.hand.map((tile) => tile.id)),
    ...result.current.state.players.flatMap((entry) =>
      entry.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
    ),
    ...result.current.state.deck.map((tile) => tile.id),
  ];

  expect(players).toHaveLength(4);
  players.forEach((player) => {
    expect(player.melds).toHaveLength(4);
    expect(player.opened).toBe(true);
    player.melds.forEach((meld) => {
      expect(meld.tiles).toHaveLength(3);
      if (meld.kind === "run") {
        expect(new Set(meld.tiles.map((tile) => tile.color)).size).toBe(1);
        expect(
          [...meld.tiles].map((tile) => tile.value).sort((left, right) => left - right),
        ).toEqual([
          Math.min(...meld.tiles.map((tile) => tile.value)),
          Math.min(...meld.tiles.map((tile) => tile.value)) + 1,
          Math.min(...meld.tiles.map((tile) => tile.value)) + 2,
        ]);
      } else {
        expect(new Set(meld.tiles.map((tile) => tile.value)).size).toBe(1);
        expect(new Set(meld.tiles.map((tile) => tile.color)).size).toBe(3);
      }
    });
  });
  expect(new Set(allTileIds).size).toBe(allTileIds.length);
});

test("three bots draw and discard in distinct commits through the production presentation stream", async () => {
  const { result, unmount } = renderHook(() => useOkeyPreviewGame());
  const transitions: OkeyCommittedTransition[] = [];
  result.current.onlineAdapter.subscribeCommittedTransitions((value) => transitions.push(value));
  await act(async () => {
    expect(await result.current.discard(result.current.state.players[0].hand[0].id)).toBe(true);
  });
  const actors = new Set<string>();
  for (let seat = 0; seat < 3; seat += 1) {
    const index = result.current.state.currentPlayerIndex;
    expect(index).not.toBe(0);
    const player = result.current.state.players[index];
    actors.add(player.id);
    const deadline = result.current.onlineProjection.turnDeadlineAt;
    const handCount = player.hand.length;
    act(() => jest.advanceTimersByTime(1500));
    expect(result.current.state.currentPlayerIndex).toBe(index);
    expect(result.current.state.hasDrawnThisTurn).toBe(true);
    expect(result.current.state.players[index].hand).toHaveLength(handCount + 1);
    expect(result.current.onlineProjection.turnDeadlineAt).toBe(deadline);
    expect(transitions.at(-1)?.actionEvents[0]).toMatchObject({
      type: "draw", actorPlayerId: player.id, payload: { source: "deck" },
    });
    act(() => jest.advanceTimersByTime(1500));
    expect(result.current.state.currentPlayerIndex).not.toBe(index);
    expect(result.current.state.players[index].hand).toHaveLength(handCount);
    expect(transitions.at(-1)?.actionEvents[0]).toMatchObject({
      type: "discard", actorPlayerId: player.id,
    });
    expect(result.current.turnTimeLeftMilliseconds).toBe(30000);
  }
  expect(actors.size).toBe(3);
  expect(result.current.state.currentPlayerIndex).toBe(0);
  expect(result.current.state.hasDrawnThisTurn).toBe(false);
  expect(transitions.flatMap((value) => value.actionEvents.map((event) => event.type)))
    .toEqual(["draw", "discard", "draw", "discard", "draw", "discard"]);
  unmount();
  act(() => jest.advanceTimersByTime(0));
  expect(jest.getTimerCount()).toBe(0);
});

test("countdown is real, human draw preserves deadline, and invalid actions do not commit", async () => {
  const { result } = renderHook(() => useOkeyPreviewGame());
  const initialVersion = result.current.onlineProjection.version;
  await act(async () => {
    expect(await result.current.draw("deck")).toBe(false); // Dealer already has the extra tile.
    expect(await result.current.discard("missing")).toBe(false);
  });
  expect(result.current.onlineProjection.version).toBe(initialVersion);
  act(() => jest.advanceTimersByTime(2000));
  expect(result.current.turnTimeLeftMilliseconds).toBe(28000);
  await act(async () => {
    await result.current.discard(result.current.state.players[0].hand[0].id);
  });
  await act(async () => {
    expect(await result.current.draw("deck")).toBe(false); // Cannot act for a bot.
  });
  for (let step = 0; step < 6; step += 1) act(() => jest.advanceTimersByTime(1500));
  const deadline = result.current.onlineProjection.turnDeadlineAt;
  act(() => jest.advanceTimersByTime(1000));
  await act(async () => { expect(await result.current.draw("deck")).toBe(true); });
  expect(result.current.onlineProjection.turnDeadlineAt).toBe(deadline);
  expect(result.current.turnTimeLeftMilliseconds).toBe(29000);
});

test("human timeout advances play and exposes the production timeout presentation event", () => {
  const { result } = renderHook(() => useOkeyPreviewGame());
  act(() => jest.advanceTimersByTime(30000));
  expect(result.current.state.currentPlayerIndex).not.toBe(0);
  expect(result.current.onlineProjection.lastTimeoutDiscardEvent).toMatchObject({
    playerId: "seat-0", source: "rack",
  });
  expect(result.current.turnTimeLeftMilliseconds).toBe(30000);
});

test("disabled preview has no timers and cannot mutate the game", async () => {
  const { result, rerender, unmount } = renderHook<ReturnType<typeof useOkeyPreviewGame>, { enabled: boolean }>(
    ({ enabled }) => useOkeyPreviewGame(enabled),
    { initialProps: { enabled: false } },
  );
  const initial = result.current.state;
  await act(async () => {
    expect(await result.current.discard(initial.players[0].hand[0].id)).toBe(false);
  });
  act(() => jest.advanceTimersByTime(0));
  expect(jest.getTimerCount()).toBe(0);
  rerender({ enabled: true });
  await act(async () => {
    expect(await result.current.discard(initial.players[0].hand[0].id)).toBe(true);
  });
  rerender({ enabled: false });
  const paused = result.current.state;
  act(() => jest.advanceTimersByTime(60000));
  expect(result.current.state).toBe(paused);
  act(() => jest.advanceTimersByTime(0));
  expect(jest.getTimerCount()).toBe(0);
  unmount();
});
test("timeout before drawing commits draw first, then discards after a visible pause", async () => {
  const { result } = renderHook(() => useOkeyPreviewGame());
  await act(async () => { await result.current.discard(result.current.state.players[0].hand[0].id); });
  for (let step = 0; step < 6; step += 1) act(() => jest.advanceTimersByTime(1500));
  expect(result.current.state.currentPlayerIndex).toBe(0);
  const handCount = result.current.state.players[0].hand.length;
  act(() => jest.advanceTimersByTime(30000));
  expect(result.current.state.currentPlayerIndex).toBe(0);
  expect(result.current.state.hasDrawnThisTurn).toBe(true);
  expect(result.current.state.players[0].hand).toHaveLength(handCount + 1);
  act(() => jest.advanceTimersByTime(750));
  expect(result.current.state.currentPlayerIndex).not.toBe(0);
  expect(result.current.state.players[0].hand).toHaveLength(handCount);
});

test("the sandbox keeps cycling and redeals after the engine reaches its tile-cycle limit", () => {
  const { result } = renderHook(() => useOkeyPreviewGame());
  for (let step = 0; step < 350 && result.current.lifecycleResumeToken === 0; step += 1) {
    const state = result.current.state;
    const delay = state.phase !== "playing" || state.currentPlayerIndex !== 0
      ? 1500
      : Math.max(750, result.current.turnTimeLeftMilliseconds);
    act(() => jest.advanceTimersByTime(delay));
  }
  expect(result.current.lifecycleResumeToken).toBeGreaterThan(0);
  expect(result.current.state.phase).toBe("playing");
  expect(result.current.state.currentPlayerIndex).toBe(0);
  expect(result.current.turnTimeLeftMilliseconds).toBe(30000);
  expect(result.current.showRoundResultPopup).toBe(false);
});