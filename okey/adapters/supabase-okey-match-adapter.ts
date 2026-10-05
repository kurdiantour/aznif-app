import { supabase } from "@/lib/supabase";
import { isEliminatedOkeyPlayer } from "@/okey/engine/okeyengine-eliminated";
import type { OkeyActionEvent } from "@/okey/server/okey-action-events";

import type {
    OkeyCommittedTransition,
    OnlineOkeyMatchAdapter,
} from "@/okey/adapters/okey-match-adapter";

import type {
    OkeyAuthoritativeCommand,
    OkeyMatchServerProjection,
    OkeyMatchSettlement,
} from "@/okey/server/okey-authoritative";

import {
    leaveOkeyRoom,
    reconnectOkeyRoom,
} from "@/okey/multiplayer/okey-room-api";

export type { OkeyCommittedTransition };

const MAX_DELIVERED_ACTION_EVENT_KEYS = 512;

function createCommandId(): string {
  if (
    typeof globalThis.crypto?.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const value = Math.floor(
        Math.random() * 16,
      );

      return (
        character === "x"
          ? value
          : (value & 0x3) | 0x8
      ).toString(16);
    },
  );
}

class OkeyAuthoritativeCommandNotAppliedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OkeyAuthoritativeCommandNotAppliedError";
  }
}

export class SupabaseOkeyMatchAdapter implements OnlineOkeyMatchAdapter {
  readonly kind = "online" as const;

  private snapshot:
    | OkeyMatchServerProjection
    | null = null;

  private readonly listeners =
    new Set<
      (
        snapshot:
          OkeyMatchServerProjection,
      ) => void
    >();

  private readonly actionEventListeners =
    new Set<(event: OkeyActionEvent) => void>();

  private readonly committedTransitionListeners =
    new Set<(transition: OkeyCommittedTransition) => void>();

  private readonly resetListeners = new Set<() => void>();

  private readonly invalidationListeners =
    new Set<(snapshot: OkeyMatchServerProjection) => void>();

  private readonly statusListeners = new Set<(status: string, error?: unknown) => void>();

  private actionEventVersion: number | null = null;
  private readonly deliveredActionEventKeys = new Set<string>();

  private channel:
    | ReturnType<
        typeof supabase.channel
      >
    | null = null;

  private refreshPromise:
    | Promise<void>
    | null = null;

  private realtimeRefreshPromise:
    | Promise<void>
    | null = null;

  private terminalSettlementRefreshPromise:
    | Promise<void>
    | null = null;

  private terminalSettlementRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalSettlementRefreshAttempts = 0;

  private pendingRealtimeVersion:
    | number
    | null = null;

  private authoritativeCommandTail:
    Promise<void> = Promise.resolve();

  private authoritativeCommandsPending = 0;

  private serverClockOffsetMs = 0;

  private closed = false;

  constructor(
    private readonly matchId: string,
  ) {}

  getServerClockOffsetMs(): number {
    return this.serverClockOffsetMs;
  }

  getSnapshot():
    | OkeyMatchServerProjection
    | null
  {
    return this.snapshot;
  }

  subscribe(
    listener: (snapshot: OkeyMatchServerProjection) => void,
  ): () => void {
    this.listeners.add(listener);

    if (this.snapshot) {
      listener(this.snapshot);
    }

    if (!this.channel) {
      this.openRealtimeChannel();
    }

    return () => {
      this.listeners.delete(listener);

      if (
        this.listeners.size === 0 &&
        this.actionEventListeners.size === 0 &&
        this.committedTransitionListeners.size === 0 &&
        this.invalidationListeners.size === 0 &&
        this.statusListeners.size === 0
      ) {
        this.closeRealtimeChannel();
      }
    };
  }

  subscribeActionEvents(listener: (event: OkeyActionEvent) => void): () => void {
    this.actionEventListeners.add(listener);
    if (!this.channel) this.openRealtimeChannel();
    return () => {
      this.actionEventListeners.delete(listener);
      if (
        this.listeners.size === 0 && this.actionEventListeners.size === 0 &&
        this.committedTransitionListeners.size === 0 &&
        this.invalidationListeners.size === 0 && this.statusListeners.size === 0
      ) {
        this.closeRealtimeChannel();
      }
    };
  }

  subscribeCommittedTransitions(
    listener: (transition: OkeyCommittedTransition) => void,
  ): () => void {
    this.committedTransitionListeners.add(listener);
    if (!this.channel) this.openRealtimeChannel();
    return () => {
      this.committedTransitionListeners.delete(listener);
      if (
        this.listeners.size === 0 &&
        this.actionEventListeners.size === 0 &&
        this.committedTransitionListeners.size === 0 &&
        this.invalidationListeners.size === 0 &&
        this.statusListeners.size === 0
      ) {
        this.closeRealtimeChannel();
      }
    };
  }

  subscribeInvalidation(
    listener: (snapshot: OkeyMatchServerProjection) => void,
  ): () => void {
    this.invalidationListeners.add(listener);
    if (!this.channel) this.openRealtimeChannel();
    return () => {
      this.invalidationListeners.delete(listener);
      if (
        this.listeners.size === 0 && this.actionEventListeners.size === 0 &&
        this.committedTransitionListeners.size === 0 &&
        this.invalidationListeners.size === 0 && this.statusListeners.size === 0
      ) this.closeRealtimeChannel();
    };
  }

  subscribeStatus(listener: (status: string, error?: unknown) => void): () => void {
    this.statusListeners.add(listener);
    if (!this.channel) this.openRealtimeChannel();
    return () => {
      this.statusListeners.delete(listener);
      if (
        this.listeners.size === 0 && this.actionEventListeners.size === 0 &&
        this.committedTransitionListeners.size === 0 &&
        this.invalidationListeners.size === 0 && this.statusListeners.size === 0
      ) this.closeRealtimeChannel();
    };
  }

  subscribeReset(listener: () => void): () => void {
    this.resetListeners.add(listener);
    return () => {
      this.resetListeners.delete(listener);
    };
  }

  private triggerReset(): void {
    for (const listener of this.resetListeners) {
      listener();
    }
  }

  private enqueueAuthoritativeCommand(
    operation: () => Promise<void>,
  ): Promise<void> {
    this.authoritativeCommandsPending += 1;
    const run =
      this.authoritativeCommandTail.then(
        operation,
      ).finally(() => {
        this.authoritativeCommandsPending -= 1;
        if (
          this.authoritativeCommandsPending === 0 &&
          this.pendingRealtimeVersion !== null
        ) {
          const pendingVersion = this.pendingRealtimeVersion;
          if ((this.snapshot?.version ?? -1) >= pendingVersion) {
            this.pendingRealtimeVersion = null;
          } else {
            this.refreshRealtimeGap(pendingVersion);
          }
        }
      });

    this.authoritativeCommandTail =
      run.catch(() => {});

    return run;
  }

  private async readFunctionErrorBody(
    error: unknown,
  ): Promise<{
    ok?: boolean;
    processed?: boolean;
    reason?: string;
    code?: string;
    error?: string;
    message?: string;
    serverNow?: string;
    expiresAt?: string;
  } | null> {
    try {
      if (
        error &&
        typeof error === "object" &&
        "context" in error &&
        error.context &&
        typeof error.context === "object" &&
        "json" in error.context &&
        typeof error.context.json === "function"
      ) {
        return await error.context.json();
      }
    } catch {
      return null;
    }

    return null;
  }

  private isAuthoritativeSyncResult(
    errorBody: {
      code?: string;
      error?: string;
    } | null,
  ): boolean {
    return (
      errorBody?.error === "version_conflict" ||
      errorBody?.error === "already_processed" ||
      errorBody?.error === "already_started" ||
      errorBody?.code === "already_processed"
    );
  }

  private async syncAfterConflict(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      try {
        await this.refresh();
      } catch {
        // Realtime remains subscribed and can deliver the latest projection.
      }
    }
  }

  private async requireSnapshotVersion(): Promise<number> {
    if (this.snapshot?.version === undefined) {
      await this.refresh();
    }
    if (this.snapshot?.version === undefined) {
      throw new Error("okey_snapshot_unavailable");
    }
    return this.snapshot.version;
  }

  private runAuthoritativeMutation(
    createBody: () => Promise<Record<string, unknown>> | Record<string, unknown>,
    options: {
      refreshOnError?: boolean;
      throwParsedError?: boolean;
      syncOnError?: (body: { code?: string; error?: string } | null) => boolean;
      notAppliedOnError?: (body: { code?: string; error?: string } | null) => boolean;
    } = {},
  ): Promise<void> {
    const commandId = createCommandId();
    return this.enqueueAuthoritativeCommand(async () => {
      const { data, error } = await supabase.functions.invoke("okey_match", {
        body: {
          ...await createBody(),
          matchId: this.matchId,
          commandId,
        },
      });

      if (error) {
        const errorBody = await this.readFunctionErrorBody(error);
        if (options.notAppliedOnError?.(errorBody)) {
          await this.syncAfterConflict();
          throw new OkeyAuthoritativeCommandNotAppliedError(
            errorBody?.error ?? errorBody?.code ?? "okey_command_not_applied",
          );
        }
        const shouldSync = options.syncOnError
          ? options.syncOnError(errorBody)
          : this.isAuthoritativeSyncResult(errorBody);
        if (shouldSync) {
          await this.syncAfterConflict();
          return;
        }
        if (options.refreshOnError !== false) {
          await this.refresh();
        }
        throw options.throwParsedError ? errorBody ?? error : error;
      }

      this.publishResponse(data);
    });
  }

  async dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void> {
    return this.runAuthoritativeMutation(
      async () => ({
        action: "command",
        expectedVersion: await this.requireSnapshotVersion(),
        command,
      }),
      {
        notAppliedOnError: (body) =>
          body?.error === "version_conflict" ||
          body?.error === "turn_deadline_expired",
        syncOnError: (body) =>
          this.isAuthoritativeSyncResult(body),
      },
    );
  }

  private syncServerClock(serverNow: unknown): void {
    if (typeof serverNow !== "string") return;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return;
    this.serverClockOffsetMs = serverNowMs - Date.now();
  }

  async reconnect(): Promise<void> {
    this.triggerReset();

    await reconnectOkeyRoom(
      this.matchId,
    );

    this.openRealtimeChannel();

    await this.refresh();
  }

  async leave(): Promise<void> {
    await this.runAuthoritativeMutation(
      async () => ({
        action: "manual-leave",
        expectedVersion: await this.requireSnapshotVersion(),
      }),
      {
        refreshOnError: false,
        throwParsedError: true,
        notAppliedOnError: (body) =>
          body?.error === "version_conflict" ||
          body?.error === "manual_leave_retry_fetch_failed" ||
          body?.error === "manual_leave_retry_exhausted",
      },
    );

    await leaveOkeyRoom(
      this.matchId,
    );

    this.closeRealtimeChannel();
    this.snapshot = null;
  }
  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise =
      (async () => {
        const { data, error } =
          await supabase.functions.invoke(
            "okey_match",
            {
              body: {
                matchId: this.matchId,
                action: "snapshot",
                afterVersion: this.actionEventVersion,
              },
            },
          );

        if (error) {
          const errorBody =
            await this.readFunctionErrorBody(
              error,
            );

          this.syncServerClock(
            errorBody?.serverNow,
          );

          throw errorBody || error;
        }

        this.publishResponse(data);
      })().finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private async refreshAfterRealtimeInvalidation(
    version: number,
  ): Promise<void> {
    this.pendingRealtimeVersion = Math.max(
      this.pendingRealtimeVersion ?? -1,
      version,
    );

    if (this.realtimeRefreshPromise) {
      return this.realtimeRefreshPromise;
    }

    this.realtimeRefreshPromise =
      (async () => {
        while (
          this.pendingRealtimeVersion !== null
        ) {
          const targetVersion =
            this.pendingRealtimeVersion;

          this.pendingRealtimeVersion = null;

          try {
            await this.refresh();
          } catch {
            // Keep subscription active and retry on future events.
          }

          const snapshotVersion = this.snapshot?.version ?? -1;
          if (snapshotVersion >= targetVersion) {
            if (
              this.pendingRealtimeVersion === null ||
              this.pendingRealtimeVersion <= snapshotVersion
            ) {
              this.pendingRealtimeVersion = null;
              break;
            }
            continue;
          }

          // The snapshot has not reached the requested version yet.
          // Do not spin; a future Realtime event/reconnect will retry.
          if (this.pendingRealtimeVersion === null) {
            break;
          }
        }
      })().finally(() => {
        this.realtimeRefreshPromise = null;
      });

    return this.realtimeRefreshPromise;
  }

  private publish(
    projection: OkeyMatchServerProjection,
  ): void {
    const previousSnapshot = this.snapshot;
    this.snapshot = projection;

    if (
      projection.matchFinished &&
      !("settlement" in projection && projection.settlement)
    ) {
      this.scheduleTerminalSettlementRefresh();
    }

    if (previousSnapshot !== projection) {
      for (const listener of this.listeners) {
        listener(projection);
      }
    }
  }

  private publishCommittedTransition(
    previousProjection: OkeyMatchServerProjection | null,
    projection: OkeyMatchServerProjection,
    actionEvents: OkeyActionEvent[],
  ): void {
    const transition: OkeyCommittedTransition = {
      version: projection.version,
      previousProjection,
      projection,
      actionEvents,
    };
    for (const listener of this.committedTransitionListeners) {
      listener(transition);
    }
  }

  private publishResponse(
    response: unknown,
  ): void {
    if (
      !response ||
      typeof response !== "object"
    ) {
      return;
    }

    const payload = response as {
      projection?: OkeyMatchServerProjection;
      actionEvents?: OkeyActionEvent[];
      settlement?: OkeyMatchSettlement | null;
      serverNow?: string;
    };

    this.syncServerClock(payload.serverNow);

    const actionEvents = payload.actionEvents && Array.isArray(payload.actionEvents)
      ? payload.actionEvents
      : [];

    if (actionEvents.length > 0) {
      this.publishActionEvents(actionEvents);
    }

    if (payload.projection) {
      const projection = Object.prototype.hasOwnProperty.call(payload, "settlement")
        ? { ...payload.projection, settlement: payload.settlement ?? null }
        : payload.projection;
      const previousProjection = this.snapshot;
      this.publish(projection);
      if (this.actionEventVersion === null && typeof projection.version === "number") {
        this.actionEventVersion = projection.version;
      }
      this.publishCommittedTransition(previousProjection, projection, actionEvents);
    }
  }

  private scheduleTerminalSettlementRefresh(): void {
    if (
      this.closed ||
      this.snapshot?.settlement ||
      this.terminalSettlementRefreshPromise ||
      this.terminalSettlementRetryTimer
    ) return;

    const retry = () => {
      if (this.closed || this.snapshot?.settlement) return;
      this.terminalSettlementRetryTimer = setTimeout(() => {
        this.terminalSettlementRetryTimer = null;
        this.scheduleTerminalSettlementRefresh();
      }, Math.min(5_000, 500 * 2 ** Math.min(this.terminalSettlementRefreshAttempts, 4)));
    };

    this.terminalSettlementRefreshPromise = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.closed || this.snapshot?.settlement) return;
      try {
        await this.refresh();
      } catch {
        // A finished match has no watchdog. Keep recovering settlement until
        // this client receives its own persisted reward projection.
      }
    })().finally(() => {
      this.terminalSettlementRefreshPromise = null;
      if (this.snapshot?.settlement) {
        this.terminalSettlementRefreshAttempts = 0;
      } else {
        this.terminalSettlementRefreshAttempts += 1;
        retry();
      }
    });
  }

  private publishActionEvents(events: OkeyActionEvent[]): void {
    for (const event of events) {
      const key = `${event.version}:${event.sequence}:${event.type}:${event.actorPlayerId}`;
      if (this.deliveredActionEventKeys.has(key)) continue;
      this.deliveredActionEventKeys.add(key);
      if (this.deliveredActionEventKeys.size > MAX_DELIVERED_ACTION_EVENT_KEYS) {
        const oldestKey = this.deliveredActionEventKeys.values().next().value;
        if (oldestKey !== undefined) {
          this.deliveredActionEventKeys.delete(oldestKey);
        }
      }
      this.actionEventVersion = Math.max(this.actionEventVersion ?? 0, event.version);
      for (const listener of this.actionEventListeners) listener(event);
    }
  }

  private mergePublicProjection(
    publicProjection: OkeyMatchServerProjection,
    actionEvents: OkeyActionEvent[] = [],
  ): OkeyMatchServerProjection | null {
    if (!this.snapshot) return null;

    if (publicProjection.currentRound !== this.snapshot.currentRound) {
      return null;
    }

    const localPlayer = this.snapshot.players.find((player) =>
      Array.isArray(player.hand),
    );

    if (localPlayer && Array.isArray(localPlayer.hand)) {
      const nextLocalPlayer = publicProjection.players.find(
        (player) => player.id === localPlayer.id,
      );

      if (!nextLocalPlayer) return null;

      if (nextLocalPlayer.handCount !== localPlayer.hand.length) {
        return null;
      }

      if (actionEvents.some((event) => event.actorPlayerId === localPlayer.id)) {
        return null;
      }

      if (
        Boolean(nextLocalPlayer.controlledByBot) !== Boolean(localPlayer.controlledByBot) ||
        isEliminatedOkeyPlayer(nextLocalPlayer) !== isEliminatedOkeyPlayer(localPlayer)
      ) {
        return null;
      }

      return {
        ...publicProjection,
        players: publicProjection.players.map((player) => {
          if (player.id === localPlayer.id) {
            return { ...player, hand: localPlayer.hand };
          }
          return player;
        }),
        settlement: 'settlement' in publicProjection
          ? publicProjection.settlement ?? null
          : this.snapshot.settlement ?? null,
      };
    }

    return {
      ...publicProjection,
      settlement: 'settlement' in publicProjection
        ? publicProjection.settlement ?? null
        : this.snapshot.settlement ?? null,
    };
  }

  private notifyRealtimeSnapshot(snapshot: OkeyMatchServerProjection): void {
    for (const listener of this.invalidationListeners) listener(snapshot);
  }

  private refreshRealtimeGap(version: number): void {
    void this.refreshAfterRealtimeInvalidation(version)
      .then(() => {
        if (this.snapshot && this.snapshot.version >= version) {
          this.notifyRealtimeSnapshot(this.snapshot);
        }
      })
      .catch(() => {});
  }

  private openRealtimeChannel(): void {
    this.closed = false;

    if (this.channel) {
      return;
    }

    this.channel = supabase
      .channel(
        `okey-match:${this.matchId}`,
      )
      .on(
        "broadcast",
        {
          event: "state_update",
        },
        ({ payload }) => {
          if (
            !payload ||
            typeof payload !== "object"
          ) {
            return;
          }

          const message = payload as {
            matchId?: string;
            commandId?: string;
            version?: number;
            publicProjection?: OkeyMatchServerProjection;
            actionEvents?: OkeyActionEvent[];
          };

          if (
            message.matchId !== this.matchId ||
            typeof message.version !== "number"
          ) {
            return;
          }

          const currentVersion = this.snapshot?.version;
          if (currentVersion !== undefined && message.version <= currentVersion) {
            return;
          }

          const isVersionGap =
            currentVersion === undefined || message.version > currentVersion + 1;
          const projection = message.publicProjection;
          const hasUsableProjection =
            projection !== null &&
            typeof projection === 'object' &&
            projection.version === message.version &&
            Array.isArray(projection.players);

          if (isVersionGap) {
            this.triggerReset();
            if (this.authoritativeCommandsPending > 0) {
              this.pendingRealtimeVersion = Math.max(
                this.pendingRealtimeVersion ?? -1,
                message.version,
              );
              return;
            }
            this.refreshRealtimeGap(message.version);
            return;
          }

          if (!hasUsableProjection) return;

          const incomingEvents = Array.isArray(message.actionEvents)
            ? message.actionEvents
            : [];
          const merged = this.mergePublicProjection(projection, incomingEvents);
          if (!merged) {
            this.refreshRealtimeGap(message.version);
            return;
          }

          const previousProjection = this.snapshot;
          this.publishActionEvents(incomingEvents);
          this.publish(merged);
          this.publishCommittedTransition(previousProjection, merged, incomingEvents);
          this.notifyRealtimeSnapshot(merged);
        },
      )
      .subscribe((status, error) => {
        for (const listener of this.statusListeners) listener(status, error);
        if (status === "SUBSCRIBED" && this.invalidationListeners.size === 0) {
          void this.refresh().catch(() => {});
        }
      });
  }

  private closeRealtimeChannel(): void {
    this.closed = true;
    this.pendingRealtimeVersion = null;
    if (this.terminalSettlementRetryTimer) {
      clearTimeout(this.terminalSettlementRetryTimer);
      this.terminalSettlementRetryTimer = null;
    }

    if (!this.channel) {
      return;
    }

    void supabase.removeChannel(
      this.channel,
    );

    this.channel = null;
  }
}
