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

function projection(version: number, currentRound = 1) {
  return {
    version,
    currentRound,
    phase: "playing",
    turnDeadlineAt: null,
    players: [],
    settlement: null,
  } as any;
}

function setSnapshot(
  adapter: SupabaseOkeyMatchAdapter,
  version: number,
  currentRound = 1,
) {
  (adapter as unknown as { snapshot: unknown }).snapshot =
    projection(version, currentRound);
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

  const first = adapter.dispatch({ type: "draw", source: "deck" } as any);
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
    adapter.dispatch({ type: "draw", source: "deck" } as any),
  ).rejects.toThrow("version_conflict");

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockInvoke.mock.calls.map((call) => (call[1] as any).body.action)).toEqual([
    "command",
    "snapshot",
  ]);
});

test("queued client commands serialize properly in the command queue", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-3");
  setSnapshot(adapter, 7);
  const humanResponse = deferred<any>();

  mockInvoke
    .mockImplementationOnce(() => humanResponse.promise)
    .mockResolvedValueOnce({
      data: { projection: projection(9) },
      error: null,
    });

  const firstCommand = adapter.dispatch({ type: "draw", source: "deck" } as any);
  const secondCommand = adapter.dispatch({ type: "discard", tileId: "tile-2" } as any);

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockInvoke).toHaveBeenCalledTimes(1);

  humanResponse.resolve({
    data: { projection: projection(8) },
    error: null,
  });

  await firstCommand;
  await secondCommand;

  expect(mockInvoke).toHaveBeenCalledTimes(2);
  expect(mockInvoke.mock.calls.map((call) => (call[1] as any).body.action)).toEqual([
    "command",
    "command",
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

test("contiguous Realtime applies projection and events without fetching when local hand is unaffected", () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-realtime");
  const tile = { id: "local-tile", color: "red", value: 7, copy: 1 };
  (adapter as any).snapshot = {
    ...projection(10),
    settlement: { type: "winner" },
    players: [
      { id: "local", handCount: 1, hand: [tile] },
      { id: "remote", handCount: 14 },
    ],
  };
  const publicProjection = {
    ...projection(11),
    players: [
      { id: "local", handCount: 1 },
      { id: "remote", handCount: 13 },
    ],
  };
  delete (publicProjection as any).settlement;
  const event = {
    matchId: "match-realtime",
    version: 11,
    sequence: 1,
    type: "draw",
    actorPlayerId: "remote",
    payload: { source: "discard" },
  } as any;
  const snapshots: any[] = [];
  const events: any[] = [];
  adapter.subscribeActionEvents((next) => events.push(next));
  adapter.subscribeInvalidation((next) => snapshots.push(next));

  mockRealtimeHandler!({
    payload: {
      matchId: "match-realtime",
      commandId: "command-11",
      version: 11,
      publicProjection,
      actionEvents: [event],
    },
  });

  expect(mockInvoke).not.toHaveBeenCalled();
  expect(adapter.getSnapshot()).toMatchObject({
    version: 11,
    settlement: { type: "winner" },
    players: [
      { id: "local", handCount: 1, hand: [tile] },
      { id: "remote", handCount: 13 },
    ],
  });
  expect(snapshots).toHaveLength(1);
  expect(events).toEqual([event]);

  mockRealtimeHandler!({
    payload: {
      matchId: "match-realtime",
      commandId: "duplicate",
      version: 11,
      publicProjection,
      actionEvents: [{ ...event, sequence: 2 }],
    },
  });
  expect(snapshots).toHaveLength(1);
  expect(events).toEqual([event]);

  mockRealtimeHandler!({
    payload: {
      matchId: "match-realtime",
      commandId: "malformed-next",
      version: 12,
      actionEvents: [{ ...event, version: 12, sequence: 3 }],
    },
  });
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(adapter.getSnapshot()?.version).toBe(11);
});

test("Realtime with round change fetches fresh snapshot and does not preserve old round hand", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-round-change");
  adapter.subscribeInvalidation(() => {});
  const oldTile = { id: "old-tile", color: "blue", value: 3, copy: 1 };
  (adapter as any).snapshot = {
    ...projection(10, 1),
    players: [
      { id: "local", handCount: 1, hand: [oldTile] },
      { id: "remote", handCount: 14 },
    ],
  };

  const newRoundTile = { id: "new-tile", color: "black", value: 10, copy: 1 };
  const freshSnapshot = {
    ...projection(11, 2),
    players: [
      { id: "local", handCount: 14, hand: [newRoundTile] },
      { id: "remote", handCount: 14 },
    ],
  };

  mockInvoke.mockResolvedValueOnce({
    data: { projection: freshSnapshot, actionEvents: [] },
    error: null,
  });

  const nextPublicProjection = {
    ...projection(11, 2),
    players: [
      { id: "local", handCount: 14 },
      { id: "remote", handCount: 14 },
    ],
  };

  mockRealtimeHandler!({
    payload: {
      matchId: "match-round-change",
      commandId: "cmd-next-round",
      version: 11,
      publicProjection: nextPublicProjection,
      actionEvents: [],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(adapter.getSnapshot()?.players[0].hand).toEqual([newRoundTile]);
});

test("Realtime with local handCount mismatch fetches fresh snapshot", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-hand-mismatch");
  adapter.subscribeInvalidation(() => {});
  const localTile = { id: "t1", color: "red", value: 5, copy: 1 };
  (adapter as any).snapshot = {
    ...projection(10),
    players: [
      { id: "local", handCount: 1, hand: [localTile] },
      { id: "remote", handCount: 14 },
    ],
  };

  const freshSnapshot = {
    ...projection(11),
    players: [
      { id: "local", handCount: 2, hand: [localTile, { id: "t2", color: "red", value: 6, copy: 1 }] },
      { id: "remote", handCount: 14 },
    ],
  };

  mockInvoke.mockResolvedValueOnce({
    data: { projection: freshSnapshot, actionEvents: [] },
    error: null,
  });

  mockRealtimeHandler!({
    payload: {
      matchId: "match-hand-mismatch",
      commandId: "cmd-draw",
      version: 11,
      publicProjection: {
        ...projection(11),
        players: [
          { id: "local", handCount: 2 },
          { id: "remote", handCount: 14 },
        ],
      },
      actionEvents: [],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(adapter.getSnapshot()?.players[0].handCount).toBe(2);
});

test("Realtime with server-originated action on local player fetches fresh snapshot", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-timeout-local");
  adapter.subscribeInvalidation(() => {});
  const localTile = { id: "t1", color: "yellow", value: 1, copy: 1 };
  (adapter as any).snapshot = {
    ...projection(10),
    players: [
      { id: "local", handCount: 14, hand: [localTile] },
      { id: "remote", handCount: 14 },
    ],
  };

  const freshSnapshot = {
    ...projection(11),
    players: [
      { id: "local", handCount: 14, hand: [{ id: "t2", color: "yellow", value: 2, copy: 1 }] },
      { id: "remote", handCount: 14 },
    ],
  };

  mockInvoke.mockResolvedValueOnce({
    data: { projection: freshSnapshot, actionEvents: [] },
    error: null,
  });

  mockRealtimeHandler!({
    payload: {
      matchId: "match-timeout-local",
      commandId: "cmd-timeout",
      version: 11,
      publicProjection: {
        ...projection(11),
        players: [
          { id: "local", handCount: 14 },
          { id: "remote", handCount: 14 },
        ],
      },
      actionEvents: [
        {
          matchId: "match-timeout-local",
          version: 11,
          sequence: 0,
          type: "discard",
          actorPlayerId: "local",
          payload: { tileId: "t1", reason: "timeout" },
        },
      ],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(adapter.getSnapshot()?.players[0].hand).toEqual([{ id: "t2", color: "yellow", value: 2, copy: 1 }]);
});

test("Realtime version gap fetches one recovery snapshot", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-gap");
  adapter.subscribeInvalidation(() => {});
  setSnapshot(adapter, 3);
  const recovered = {
    ...projection(5),
    players: [{ id: "local", handCount: 1, hand: [{ id: "fresh" }] }],
  };
  const snapshots: any[] = [];
  adapter.subscribeInvalidation((next) => snapshots.push(next));
  mockInvoke.mockResolvedValueOnce({
    data: { projection: recovered, actionEvents: [] },
    error: null,
  });

  mockRealtimeHandler!({
    payload: {
      matchId: "match-gap",
      commandId: "command-5",
      version: 5,
      publicProjection: projection(5),
      actionEvents: [],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect((mockInvoke.mock.calls[0]?.[1] as any).body.action).toBe("snapshot");
  expect(snapshots).toEqual([recovered]);
  expect(adapter.getSnapshot()?.version).toBe(5);
});


test("snapshot refresh backfills missed action events after the last delivered version", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-backfill");
  setSnapshot(adapter, 3);
  (adapter as any).actionEventVersion = 3;
  const delivered: any[] = [];
  const unsubscribe = adapter.subscribeActionEvents((event) => delivered.push(event));

  mockInvoke.mockResolvedValueOnce({
    data: {
      projection: projection(9),
      actionEvents: [
        { matchId: "match-backfill", version: 4, sequence: 0, type: "draw", actorPlayerId: "bot-1", payload: { source: "deck" } },
        { matchId: "match-backfill", version: 5, sequence: 0, type: "discard", actorPlayerId: "bot-1", payload: { tileId: "red-10-1" } },
        { matchId: "match-backfill", version: 6, sequence: 0, type: "draw", actorPlayerId: "bot-2", payload: { source: "deck" } },
        { matchId: "match-backfill", version: 7, sequence: 0, type: "discard", actorPlayerId: "bot-2", payload: { tileId: "blue-11-1" } },
        { matchId: "match-backfill", version: 8, sequence: 0, type: "draw", actorPlayerId: "bot-3", payload: { source: "deck" } },
        { matchId: "match-backfill", version: 9, sequence: 0, type: "discard", actorPlayerId: "bot-3", payload: { tileId: "red-11-1" } },
      ],
    },
    error: null,
  });

  await adapter.refresh();

  expect((mockInvoke.mock.calls[0]?.[1] as any).body).toMatchObject({
    action: "snapshot",
    matchId: "match-backfill",
    afterVersion: 3,
  });
  expect(delivered.map((event) => [event.version, event.type])).toEqual([
    [4, "draw"],
    [5, "discard"],
    [6, "draw"],
    [7, "discard"],
    [8, "draw"],
    [9, "discard"],
  ]);
  expect((adapter as any).actionEventVersion).toBe(9);
  expect(adapter.getSnapshot()?.version).toBe(9);
  unsubscribe();
});

