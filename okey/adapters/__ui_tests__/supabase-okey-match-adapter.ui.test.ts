import { beforeEach, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<(...args: any[]) => Promise<any>>();
let mockRealtimeHandler: ((message: any) => void) | null = null;
const mockRealtimeChannel: any = {};
mockRealtimeChannel.on = jest.fn((...args: any[]) => {
  mockRealtimeHandler = args[2];
  return mockRealtimeChannel;
});
mockRealtimeChannel.subscribe = jest.fn(() => mockRealtimeChannel);

jest.mock("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    channel: jest.fn(() => mockRealtimeChannel),
    removeChannel: jest.fn(),
  },
}));

import { SupabaseOkeyMatchAdapter } from "../supabase-okey-match-adapter";

function projection(version: number) {
  return {
    version,
    phase: "playing",
    turnDeadlineAt: null,
    players: [],
    settlement: null,
  } as any;
}

function setSnapshot(
  adapter: SupabaseOkeyMatchAdapter,
  version: number,
) {
  (adapter as unknown as { snapshot: unknown }).snapshot =
    projection(version);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockRealtimeHandler = null;
  mockRealtimeChannel.on.mockClear();
  mockRealtimeChannel.subscribe.mockClear();
});

test("authoritative commands are sent one at a time and the queued command uses the latest version", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-1");
  setSnapshot(adapter, 1);
  const firstResponse = deferred<any>();

  mockInvoke
    .mockImplementationOnce(() => firstResponse.promise)
    .mockResolvedValueOnce({
      data: { projection: projection(3) },
      error: null,
    });

  const first = adapter.dispatch({ type: "draw-deck" } as any);
  const second = adapter.dispatch({ type: "discard", tileId: "tile-1" } as any);

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockInvoke).toHaveBeenCalledTimes(1);

  firstResponse.resolve({
    data: { projection: projection(2) },
    error: null,
  });

  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockInvoke.mock.calls[1]?.[1]).toMatchObject({
    body: {
      action: "command",
      expectedVersion: 2,
    },
  });

  await second;
});

test("version conflict performs one snapshot sync and rejects without retrying the stale command", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-2");
  setSnapshot(adapter, 4);

  mockInvoke
    .mockResolvedValueOnce({
      data: null,
      error: {
        context: {
          json: async () => ({ error: "version_conflict" }),
        },
      },
    })
    .mockResolvedValueOnce({
      data: { projection: projection(5) },
      error: null,
    });

  await expect(
    adapter.dispatch({ type: "draw-deck" } as any),
  ).rejects.toThrow("version_conflict");

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockInvoke.mock.calls.map((call) => (call[1] as any).body.action)).toEqual([
    "command",
    "snapshot",
  ]);
});

test("next-round claim carries exact version and round and refreshes an already-started conflict", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-next-round");
  setSnapshot(adapter, 14);

  mockInvoke
    .mockResolvedValueOnce({
      data: null,
      error: {
        context: {
          json: async () => ({ error: "already_started", code: "already_processed" }),
        },
      },
    })
    .mockResolvedValueOnce({
      data: { projection: projection(15) },
      error: null,
    });

  await expect(adapter.startNextRound({
    expectedVersion: 14,
    expectedRound: 2,
  })).resolves.toBeUndefined();

  expect(mockInvoke.mock.calls[0]?.[1]).toMatchObject({
    body: {
      action: "start-next-round",
      expectedVersion: 14,
      expectedRound: 2,
    },
  });
  expect(mockInvoke.mock.calls.map((call) => (call[1] as any).body.action)).toEqual([
    "start-next-round",
    "snapshot",
  ]);
  expect(adapter.getSnapshot()?.version).toBe(15);
});

test("eliminated-turn claim carries the exact actor and version", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-eliminated");
  setSnapshot(adapter, 21);

  mockInvoke.mockResolvedValueOnce({
    data: { projection: projection(22) },
    error: null,
  });

  await adapter.playEliminatedTurn({
    expectedVersion: 21,
    expectedActorId: "burned-player",
  });

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke.mock.calls[0]?.[1]).toMatchObject({
    body: {
      action: "play-eliminated",
      expectedVersion: 21,
      expectedActorId: "burned-player",
    },
  });
  expect(adapter.getSnapshot()?.version).toBe(22);
});

test("a queued timeout for an older version syncs instead of racing the completed human command", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-3");
  setSnapshot(adapter, 7);
  const humanResponse = deferred<any>();

  mockInvoke
    .mockImplementationOnce(() => humanResponse.promise)
    .mockResolvedValueOnce({
      data: { projection: projection(8) },
      error: null,
    });

  const humanCommand = adapter.dispatch({ type: "discard", tileId: "tile-2" } as any);
  const timeout = adapter.resolveTimeout({
    expectedVersion: 7,
    expectedTurnDeadlineAt: "2026-08-23T13:20:00.000Z",
    expectedTurnPlayerId: "player-1",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockInvoke).toHaveBeenCalledTimes(1);

  humanResponse.resolve({
    data: { projection: projection(8) },
    error: null,
  });

  await humanCommand;
  await timeout;

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockInvoke.mock.calls.map((call) => (call[1] as any).body.action)).toEqual([
    "command",
    "resolve-timeout",
  ]);
});

test("Realtime invalidation fetches a full authoritative snapshot", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-4");
  setSnapshot(adapter, 1);

  mockInvoke.mockResolvedValueOnce({
    data: { projection: projection(2) },
    error: null,
  });

  await (adapter as any).refreshAfterRealtimeInvalidation(2);

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(adapter.getSnapshot()?.version).toBe(2);
});

test("terminal projection refreshes until the viewer settlement is available", async () => {
  jest.useFakeTimers();
  const adapter = new SupabaseOkeyMatchAdapter("match-terminal-settlement");
  const terminalProjection = {
    ...projection(12),
    phase: "finished",
    matchFinished: true,
  };
  const settlement = {
    type: "winner",
    currency: "fun",
    playerReward: {
      pointDelta: 40,
      gemDelta: 2,
    },
  };

  mockInvoke.mockResolvedValueOnce({
    data: {
      projection: terminalProjection,
      settlement,
    },
    error: null,
  });

  (adapter as any).publish(terminalProjection);

  expect(adapter.getSnapshot()?.settlement).toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(50);

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(adapter.getSnapshot()?.settlement).toEqual(settlement);
  jest.useRealTimers();
});

test("Realtime invalidations preserve the highest pending version during refresh", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-5");
  setSnapshot(adapter, 1);
  const firstSnapshot = deferred<any>();

  mockInvoke
    .mockImplementationOnce(() => firstSnapshot.promise)
    .mockResolvedValueOnce({
      data: { projection: projection(3) },
      error: null,
    });

  const first = (adapter as any).refreshAfterRealtimeInvalidation(2);
  await Promise.resolve();
  const second = (adapter as any).refreshAfterRealtimeInvalidation(3);

  firstSnapshot.resolve({
    data: { projection: projection(2) },
    error: null,
  });

  await Promise.all([first, second]);

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(
    mockInvoke.mock.calls.map((call) => (call[1] as any).body.action),
  ).toEqual(["snapshot", "snapshot"]);
  expect(adapter.getSnapshot()?.version).toBe(3);
});

test('contiguous Realtime applies projection and events without fetching', () => {
  const adapter = new SupabaseOkeyMatchAdapter('match-realtime');
  const tile = { id: 'local-tile', color: 'red', value: 7, copy: 1 };
  (adapter as any).snapshot = {
    ...projection(10),
    settlement: { type: 'winner' },
    players: [
      { id: 'local', handCount: 1, hand: [tile] },
      { id: 'remote', handCount: 14 },
    ],
  };
  const publicProjection = {
    ...projection(11),
    players: [
      { id: 'local', handCount: 2 },
      { id: 'remote', handCount: 13 },
    ],
  };
  delete (publicProjection as any).settlement;
  const event = {
    matchId: 'match-realtime', version: 11, sequence: 1,
    type: 'draw', actorPlayerId: 'remote', payload: { source: 'discard' },
  } as any;
  const snapshots: any[] = [];
  const events: any[] = [];
  adapter.subscribeActionEvents((next) => events.push(next));
  adapter.subscribeInvalidation((next) => snapshots.push(next));

  mockRealtimeHandler!({ payload: {
    matchId: 'match-realtime', commandId: 'command-11', version: 11,
    publicProjection, actionEvents: [event],
  } });

  expect(mockInvoke).not.toHaveBeenCalled();
  expect(adapter.getSnapshot()).toMatchObject({
    version: 11,
    settlement: { type: 'winner' },
    players: [
      { id: 'local', handCount: 2, hand: [tile] },
      { id: 'remote', handCount: 13 },
    ],
  });
  expect(snapshots).toHaveLength(1);
  expect(events).toEqual([event]);

  mockRealtimeHandler!({ payload: {
    matchId: 'match-realtime', commandId: 'duplicate', version: 11,
    publicProjection, actionEvents: [{ ...event, sequence: 2 }],
  } });
  expect(snapshots).toHaveLength(1);
  expect(events).toEqual([event]);

  mockRealtimeHandler!({ payload: {
    matchId: 'match-realtime', commandId: 'malformed-next', version: 12,
    actionEvents: [{ ...event, version: 12, sequence: 3 }],
  } });
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(adapter.getSnapshot()?.version).toBe(11);
});

test('Realtime version gap fetches one recovery snapshot', async () => {
  const adapter = new SupabaseOkeyMatchAdapter('match-gap');
  setSnapshot(adapter, 3);
  const recovered = {
    ...projection(5),
    players: [{ id: 'local', handCount: 1, hand: [{ id: 'fresh' }] }],
  };
  const snapshots: any[] = [];
  adapter.subscribeInvalidation((next) => snapshots.push(next));
  mockInvoke.mockResolvedValueOnce({
    data: { projection: recovered, actionEvents: [] },
    error: null,
  });

  mockRealtimeHandler!({ payload: {
    matchId: 'match-gap', commandId: 'command-5', version: 5,
    publicProjection: projection(5), actionEvents: [],
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe('snapshot');
  expect(snapshots).toEqual([recovered]);
  expect(adapter.getSnapshot()?.version).toBe(5);
});
