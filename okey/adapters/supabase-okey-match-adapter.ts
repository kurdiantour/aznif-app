import { supabase } from "@/lib/supabase";
import type { OkeyActionEvent } from "@/okey/server/okey-action-events";

import type {
  OkeyBotTurnClaim,
  OkeyBotTurnResult,
  OkeyEliminatedTurnClaim,
  OkeyNextRoundClaim,
  OnlineOkeyMatchAdapter,
} from "@/okey/adapters/okey-match-adapter";

import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";

import {
  leaveOkeyRoom,
  reconnectOkeyRoom,
} from "@/okey/multiplayer/okey-room-api";

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

export type OkeyTurnTimeoutClaim = {
  expectedVersion: number;
  expectedTurnDeadlineAt: string;
  expectedTurnPlayerId: string;
};

export class SupabaseOkeyMatchAdapter
  implements OnlineOkeyMatchAdapter
{
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

  async getCurrentUserId() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user?.id ?? null;
  }

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
    listener: (
      snapshot:
        OkeyMatchServerProjection,
    ) => void,
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
        this.actionEventListeners.size === 0
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
      if (this.listeners.size === 0 && this.actionEventListeners.size === 0) {
        this.closeRealtimeChannel();
      }
    };
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
            void this.refreshAfterRealtimeInvalidation(pendingVersion).catch(() => {});
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
    code?: string;
    error?: string;
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
      // Realtime remains subscribed and can deliver the latest projection.
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
        throw error;
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

  async processBotTurn(
    claim: OkeyBotTurnClaim,
  ): Promise<OkeyBotTurnResult> {
    const { data, error } = await supabase.functions.invoke(
      "process_bot_turns",
      {
        body: {
          mode: "okey",
          match_id: this.matchId,
          expected_version: claim.expectedVersion,
          expected_actor_id: claim.expectedActorId,
        },
      },
    );

    if (error) {
      throw error;
    }

    return data as OkeyBotTurnResult;
  }

  async playEliminatedTurn(
    claim: OkeyEliminatedTurnClaim,
  ): Promise<void> {
    return this.runAuthoritativeMutation(() => ({
      action: "play-eliminated",
      expectedVersion: claim.expectedVersion,
      expectedActorId: claim.expectedActorId,
    }));
  }

  async startNextRound(
    claim: OkeyNextRoundClaim,
  ): Promise<void> {
    return this.runAuthoritativeMutation(() => ({
      action: "start-next-round",
      expectedVersion: claim.expectedVersion,
      expectedRound: claim.expectedRound,
    }));
  }

  async resolveTimeout(
    claim: OkeyTurnTimeoutClaim,
  ): Promise<any> {
    const commandId = createCommandId();

    return this.enqueueAuthoritativeCommand(
      async () => {
        const { data, error } =
          await supabase.functions.invoke(
            "okey_match",
            {
              body: {
                action: "resolve-timeout",
                matchId: this.matchId,
                commandId,
                expectedVersion: claim.expectedVersion,
                expectedTurnDeadlineAt: claim.expectedTurnDeadlineAt,
                expectedTurnPlayerId: claim.expectedTurnPlayerId,
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
        return data;
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
      { refreshOnError: false },
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
                action: "snapshot",
                matchId: this.matchId,
                afterVersion: this.actionEventVersion,
              },
            },
          );

        if (error) {
          throw error;
        }

        this.publishResponse(data);
      })().finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  private refreshAfterRealtimeInvalidation(
    version: number,
  ): Promise<void> {
    this.pendingRealtimeVersion = Math.max(
      this.pendingRealtimeVersion ?? -1,
      version,
    );

    if (this.realtimeRefreshPromise) {
      return this.realtimeRefreshPromise;
    }

    this.realtimeRefreshPromise = (async () => {
      let retryDelayMs = 50;

      while (
        !this.closed &&
        this.pendingRealtimeVersion !== null
      ) {
        const targetVersion =
          this.pendingRealtimeVersion;
        this.pendingRealtimeVersion = null;

        if (
          (this.snapshot?.version ?? -1) >=
          targetVersion
        ) {
          retryDelayMs = 50;
          continue;
        }

        try {
          await this.refresh();
        } catch {
          this.pendingRealtimeVersion = Math.max(
            this.pendingRealtimeVersion ?? -1,
            targetVersion,
          );
          await new Promise<void>((resolve) =>
            setTimeout(resolve, retryDelayMs),
          );
          retryDelayMs = Math.min(
            retryDelayMs * 2,
            1_000,
          );
          continue;
        }

        if (
          (this.snapshot?.version ?? -1) <
          targetVersion
        ) {
          this.pendingRealtimeVersion = Math.max(
            this.pendingRealtimeVersion ?? -1,
            targetVersion,
          );
          await new Promise<void>((resolve) =>
            setTimeout(resolve, retryDelayMs),
          );
          retryDelayMs = Math.min(
            retryDelayMs * 2,
            1_000,
          );
        } else {
          retryDelayMs = 50;
        }
      }
    })().finally(() => {
      this.realtimeRefreshPromise = null;
    });

    return this.realtimeRefreshPromise;
  }

  private publishResponse(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const response = data as {
      projection?: OkeyMatchServerProjection | null;
      settlement?: OkeyMatchServerProjection["settlement"];
      serverNow?: string;
      actionEvents?: OkeyActionEvent[];
    };

    this.syncServerClock(response.serverNow);

    if (!response.projection) {
      return;
    }

    const initialProjection = this.snapshot === null;
    if (!initialProjection) {
      this.publishActionEvents(response.actionEvents ?? []);
    }
    this.publish({
      ...response.projection,
      settlement: "settlement" in response
        ? response.settlement ?? null
        : this.snapshot?.settlement ?? null,
    });
    if (initialProjection && this.actionEventVersion === null) {
      this.actionEventVersion = response.projection.version;
    }
  }
  private publish(
    snapshot:
      | OkeyMatchServerProjection
      | null
      | undefined,
  ): void {
    if (this.closed || !snapshot) {
      return;
    }


    if (
      this.snapshot &&
      snapshot.version <
        this.snapshot.version
    ) {
      return;
    }

    this.snapshot = snapshot;

    for (
      const listener of
      this.listeners
    ) {
      listener(snapshot);
    }
  }

  private publishActionEvents(events: OkeyActionEvent[]): void {
    const ordered = [...events].sort(
      (left, right) => left.version - right.version || left.sequence - right.sequence,
    );
    for (const event of ordered) {
      if (event.matchId !== this.matchId) continue;
      const key = `${event.version}:${event.sequence}`;
      if (this.deliveredActionEventKeys.has(key)) continue;
      this.deliveredActionEventKeys.add(key);
      this.actionEventVersion = Math.max(this.actionEventVersion ?? 0, event.version);
      for (const listener of this.actionEventListeners) listener(event);
    }
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
            version?: number;
            actionEvents?: OkeyActionEvent[];
          };

          if (
            message.matchId !== this.matchId ||
            typeof message.version !== "number"
          ) {
            return;
          }

          const isSettlementInvalidation =
            this.snapshot !== null &&
            message.version === this.snapshot.version &&
            this.snapshot.matchFinished &&
            !this.snapshot.settlement;

          if (
            this.snapshot &&
            message.version <= this.snapshot.version &&
            !isSettlementInvalidation
          ) {
            return;
          }

          if (isSettlementInvalidation) {
            void this.refresh().catch(() => {});
            return;
          }

          const hasEventGap =
            this.actionEventVersion !== null &&
            message.version > this.actionEventVersion + 1;
          if (!hasEventGap) {
            this.publishActionEvents(message.actionEvents ?? []);
          }
          if (this.authoritativeCommandsPending > 0) {
            this.pendingRealtimeVersion = Math.max(
              this.pendingRealtimeVersion ?? -1,
              message.version,
            );
            return;
          }
          void this.refreshAfterRealtimeInvalidation(
            message.version,
          ).catch(() => {});
        },
      )
      .subscribe((status) => {
        if (
          status === "SUBSCRIBED"
        ) {
          void this.refresh().catch(() => {});
        }
      });
  }

  private closeRealtimeChannel(): void {
    this.closed = true;
    this.pendingRealtimeVersion = null;

    if (!this.channel) {
      return;
    }

    void supabase.removeChannel(
      this.channel,
    );

    this.channel = null;
  }
}


