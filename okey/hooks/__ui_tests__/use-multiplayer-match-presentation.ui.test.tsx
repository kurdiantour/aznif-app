import { act, render } from "@testing-library/react-native";
import { useMultiplayerMatch } from "@/lib/multiplayer/match/use-multiplayer-match";
import type { MultiplayerLifecycle, MultiplayerMatchAdapter } from "@/lib/multiplayer/match/contracts";

import { OKEY_ROUND_END_PRESENTATION_BUDGET } from "@/okey/presentation/okey-presentation-budget";

type Snapshot = { lifecycle: MultiplayerLifecycle; result: string };

const finishedRound = (matchFinished = false): Snapshot => ({
  lifecycle: {
    status: matchFinished ? "finished" : "waiting",
    version: 7,
    roundId: "1",
    completedRoundId: "7:1",
    turnPlayerId: null,
    turnDeadlineAt: null,
    nextRoundEligibleAt: new Date(Date.now() + OKEY_ROUND_END_PRESENTATION_BUDGET.TOTAL_LIFECYCLE_DELAY_MS).toISOString(),
    roundFinished: true,
    matchFinished,
  },
  result: "round-1",
});

const playingRound: Snapshot = {
  lifecycle: {
    status: "playing",
    version: 8,
    roundId: "2",
    completedRoundId: null,
    turnPlayerId: "player-1",
    turnDeadlineAt: null,
    nextRoundEligibleAt: null,
    roundFinished: false,
    matchFinished: false,
  },
  result: "round-2",
};

function createAdapter(snapshot: Snapshot) {
  let listener: ((snapshot: Snapshot) => void) | null = null;
  const adapter: MultiplayerMatchAdapter<Snapshot> = {
    load: async () => snapshot,
    subscribe: (observer) => {
      listener = (next) => observer.onInvalidated(next);
      return () => { listener = null; };
    },
    leave: async () => undefined,
  };
  return { adapter, emitSnapshot: (next: Snapshot) => listener?.(next) };
}

function renderMatch(adapter: MultiplayerMatchAdapter<Snapshot>) {
  let current: ReturnType<typeof useMultiplayerMatch<Snapshot, string, string>> | null = null;
  const options = {
    roomId: "match-1",
    adapter,
    selectLifecycle: (snapshot: Snapshot) => snapshot.lifecycle,
    buildRoundResult: (snapshot: Snapshot) => snapshot.result,
    buildFinalResult: (snapshot: Snapshot) => snapshot.result,
    roundSyncIntervalMs: 60_000,
  };
  function Harness() {
    current = useMultiplayerMatch(options);
    return null;
  }
  render(<Harness />);
  return () => current!;
}

test("round result presentation displays score popup visually without numeric countdown and client never calls startNextRound", async () => {
  jest.useFakeTimers();
  const { adapter, emitSnapshot } = createAdapter(finishedRound());
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(match().showRoundResultPopup).toBe(false);

  act(() => match().completeFinalPresentation());
  expect(match().showRoundResultPopup).toBe(true);
  // Okey does not use a 5-second countdown timer; numeric countdown is null
  expect(match().roundResultCountdownRemaining).toBe(null);

  // Time passes (3 to 8 seconds window) - popup remains visible and unchanged
  act(() => jest.advanceTimersByTime(3_000));
  expect(match().showRoundResultPopup).toBe(true);
  expect(match().roundResultCountdownRemaining).toBe(null);

  act(() => jest.advanceTimersByTime(2_000));
  expect(match().showRoundResultPopup).toBe(true);
  expect(match().lifecycle?.roundFinished).toBe(true);

  // Server independently broadcasts new round snapshot (Server-owned round transition)
  act(() => {
    emitSnapshot(playingRound);
  });

  expect(match().lifecycle?.roundFinished).toBe(false);
  expect(match().lifecycle?.version).toBe(8);
  expect(match().phase).toBe("playing");
  expect(match().showRoundResultPopup).toBe(false);

  jest.useRealTimers();
});

test("finished match waits for final presentation completion and never starts another round", async () => {
  jest.useFakeTimers();
  const { adapter } = createAdapter(finishedRound(true));
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(match().showFinalMatchPopup).toBe(false);
  act(() => match().completeFinalPresentation());
  expect(match().showFinalMatchPopup).toBe(true);
  jest.useRealTimers();
});

test("snapshot version bumps in finished match do not invalidate completed final popup", async () => {
  jest.useFakeTimers();
  const initialSnapshot = finishedRound(true);
  const { adapter, emitSnapshot } = createAdapter(initialSnapshot);
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(match().phase).toBe("match_finished");
  expect(match().showFinalMatchPopup).toBe(false);

  act(() => match().completeFinalPresentation());
  expect(match().showFinalMatchPopup).toBe(true);

  // Settlement arrives or snapshot version increments from 7 to 8
  const updatedSnapshot: Snapshot = {
    lifecycle: {
      ...initialSnapshot.lifecycle,
      version: 8,
      completedRoundId: "8:1",
    },
    result: "round-1-with-settlement",
  };

  act(() => {
    emitSnapshot(updatedSnapshot);
  });

  // Popup MUST remain visible and latched
  expect(match().showFinalMatchPopup).toBe(true);
  expect(match().finalPresentationComplete).toBe(true);
  jest.useRealTimers();
});

test("terminal match safety timeout automatically completes final presentation if animation hangs", async () => {
  jest.useFakeTimers();
  let current: ReturnType<typeof useMultiplayerMatch<Snapshot, string, string>> | null = null;
  const initialSnapshot = finishedRound(true);
  const { adapter } = createAdapter(initialSnapshot);
  const options = {
    roomId: "match-1",
    adapter,
    selectLifecycle: (snapshot: Snapshot) => snapshot.lifecycle,
    buildRoundResult: (snapshot: Snapshot) => snapshot.result,
    buildFinalResult: (snapshot: Snapshot) => snapshot.result,
    terminalPresentationTimeoutMs: 2_000,
  };
  function Harness() {
    current = useMultiplayerMatch(options);
    return null;
  }
  render(<Harness />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(current!.showFinalMatchPopup).toBe(false);

  // Advance past safety timeout
  act(() => {
    jest.advanceTimersByTime(2_000);
  });

  expect(current!.showFinalMatchPopup).toBe(true);
  expect(current!.finalPresentationComplete).toBe(true);
  jest.useRealTimers();
});