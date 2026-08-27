import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockInvoke = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { SupabaseOkeyMatchAdapter } from "../supabase-okey-match-adapter";
import { useOkeyMultiplayerBotController } from "../../controllers/okey-multiplayer-bot-controller";

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


test("Bot worker claims include the observed version and actor", async () => {
  const adapter = new SupabaseOkeyMatchAdapter("match-bot-1");

  mockInvoke.mockResolvedValueOnce({
    data: { ok: true, processed: false, reason: "stale_bot_turn" },
    error: null,
  });

  await expect(
    adapter.processBotTurn({
      expectedVersion: 12,
      expectedActorId: "bot-2",
    }),
  ).resolves.toEqual({
    ok: true,
    processed: false,
    reason: "stale_bot_turn",
  });

  expect(mockInvoke).toHaveBeenCalledWith(
    "process_bot_turns",
    {
      body: {
        mode: "okey",
        match_id: "match-bot-1",
        expected_version: 12,
        expected_actor_id: "bot-2",
      },
    },
  );
});

test("a new Bot turn starts while the previous turn request is still completing", async () => {
  const firstTurn = deferred<any>();
  const processBotTurn = jest
    .fn<(...args: any[]) => Promise<any>>()
    .mockImplementationOnce(() => firstTurn.promise)
    .mockResolvedValueOnce({ ok: true, processed: true });
  const adapter = { processBotTurn } as any;
  const makeBotProjection = (version: number, id: string) => ({
    version,
    phase: "playing",
    matchFinished: false,
    currentPlayerIndex: 0,
    players: [{ id, controlledByBot: true }],
  });

  const { rerender, unmount } = renderHook<
    void,
    { currentProjection: ReturnType<typeof makeBotProjection> }
  >(
    ({ currentProjection }) =>
      useOkeyMultiplayerBotController({
        matchId: "match-bot-2",
        projection: currentProjection as any,
        adapter,
      }),
    {
      initialProps: {
        currentProjection: makeBotProjection(20, "bot-20"),
      },
    },
  );

  await waitFor(() => expect(processBotTurn).toHaveBeenCalledTimes(1));

  rerender({
    currentProjection: makeBotProjection(21, "bot-21"),
  });

  await waitFor(() => expect(processBotTurn).toHaveBeenCalledTimes(2));
  expect(processBotTurn.mock.calls).toEqual([
    [{ expectedVersion: 20, expectedActorId: "bot-20" }],
    [{ expectedVersion: 21, expectedActorId: "bot-21" }],
  ]);

  await act(async () => {
    firstTurn.resolve({ ok: true, processed: true });
    await firstTurn.promise;
  });
  unmount();
});

