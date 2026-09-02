import { act, render } from "@testing-library/react-native";
import { useMultiplayerMatch } from "@/lib/multiplayer/match/use-multiplayer-match";
import type { MultiplayerLifecycle, MultiplayerMatchAdapter } from "@/lib/multiplayer/match/contracts";

type Snapshot = { lifecycle: MultiplayerLifecycle; result: string };

const finishedRound = (matchFinished = false): Snapshot => ({
  lifecycle: {
    status: matchFinished ? "finished" : "waiting",
    version: 7,
    roundId: "1",
    completedRoundId: "7:1",
    turnPlayerId: null,
    turnDeadlineAt: null,
    nextRoundEligibleAt: new Date(0).toISOString(),
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
  const startNextRound = jest.fn(async () => undefined);
  const adapter: MultiplayerMatchAdapter<Snapshot> = {
    load: async () => snapshot,
    subscribe: () => () => undefined,
    startNextRound,
    leave: async () => undefined,
  };
  return { adapter, startNextRound };
}

function renderMatch(adapter: MultiplayerMatchAdapter<Snapshot>) {
  let current: ReturnType<typeof useMultiplayerMatch<Snapshot, string, string>> | null = null;
  const options = {
    roomId: "match-1",
    adapter,
    selectLifecycle: (snapshot: Snapshot) => snapshot.lifecycle,
    buildRoundResult: (snapshot: Snapshot) => snapshot.result,
    buildFinalResult: (snapshot: Snapshot) => snapshot.result,
    roundResultDurationMs: 5_000,
    roundSyncIntervalMs: 60_000,
  };
  function Harness() {
    current = useMultiplayerMatch(options);
    return null;
  }
  render(<Harness />);
  return () => current!;
}

test("round start waits for final-tile completion and score-popup completion", async () => {
  jest.useFakeTimers();
  const { adapter, startNextRound } = createAdapter(finishedRound());
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(match().showRoundResultPopup).toBe(false);
  expect(startNextRound).not.toHaveBeenCalled();

  act(() => match().completeFinalPresentation());
  expect(match().showRoundResultPopup).toBe(true);
  expect(startNextRound).not.toHaveBeenCalled();

  expect(match().roundResultCountdownRemaining).toBe(5);
  act(() => jest.advanceTimersByTime(1_000));
  expect(match().roundResultCountdownRemaining).toBe(4);
  act(() => jest.advanceTimersByTime(1_000));
  expect(match().roundResultCountdownRemaining).toBe(3);
  act(() => jest.advanceTimersByTime(1_000));
  expect(match().roundResultCountdownRemaining).toBe(2);
  act(() => jest.advanceTimersByTime(1_000));
  expect(match().roundResultCountdownRemaining).toBe(1);
  expect(startNextRound).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(startNextRound).toHaveBeenCalledTimes(1);
  expect(startNextRound).toHaveBeenCalledWith("7:1");
  expect(match().lifecycle?.roundFinished).toBe(true);
  jest.useRealTimers();
});

test("finished match waits for final-tile completion and never starts another round", async () => {
  jest.useFakeTimers();
  const { adapter, startNextRound } = createAdapter(finishedRound(true));
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(match().showFinalMatchPopup).toBe(false);
  act(() => match().completeFinalPresentation());
  expect(match().showFinalMatchPopup).toBe(true);
  expect(startNextRound).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test("completed final presentation remains latched while next-round snapshot is pending", async () => {
  jest.useFakeTimers();
  const startNextRound = jest.fn(() => new Promise<Snapshot>(() => undefined));
  const adapter: MultiplayerMatchAdapter<Snapshot> = {
    load: async () => finishedRound(),
    subscribe: () => () => undefined,
    startNextRound,
    leave: async () => undefined,
  };
  const match = renderMatch(adapter);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  act(() => match().completeFinalPresentation());
  expect(match().finalPresentationComplete).toBe(true);
  expect(match().showRoundResultPopup).toBe(true);

  act(() => jest.advanceTimersByTime(5_000));
  expect(startNextRound).toHaveBeenCalledTimes(1);
  expect(match().lifecycle?.roundFinished).toBe(true);
  expect(match().showRoundResultPopup).toBe(false);
  expect(match().finalPresentationComplete).toBe(true);
  jest.useRealTimers();
});

test("snapshot version bumps in finished match do not invalidate completed final popup", async () => {
  jest.useFakeTimers();
  let listener: ((snapshot: Snapshot) => void) | null = null;
  const initialSnapshot = finishedRound(true);
  const adapter: MultiplayerMatchAdapter<Snapshot> = {
    load: async () => initialSnapshot,
subscribe: (observer) => {
  listener = (snapshot) => observer.onInvalidated(snapshot);
  return () => { listener = null; };
},
    startNextRound: jest.fn(async () => undefined),
    leave: async () => undefined,
  };
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
    listener?.(updatedSnapshot);
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
  const adapter: MultiplayerMatchAdapter<Snapshot> = {
    load: async () => initialSnapshot,
    subscribe: () => () => undefined,
    startNextRound: jest.fn(async () => undefined),
    leave: async () => undefined,
  };
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