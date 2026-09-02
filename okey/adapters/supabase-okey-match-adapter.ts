import { supabase } from "@/lib/supabase";
import type { OkeyActionEvent } from "@/okey/server/okey-action-events";

import type {
  OkeyEliminatedTurnClaim,
  OkeyNextRoundClaim,
  OkeyBotTurnClaim,
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
        this.actionEventListeners.size === 0 &&
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
        this.invalidationListeners.size === 0 && this.statusListeners.size === 0
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
    return this.runAuthoritativeMutation(
      () => ({
        action: "start-next-round",
        expectedVersion: claim.expectedVersion,
        expectedRound: claim.expectedRound,
      }),
      { refreshOnError: false, throwParsedError: true },
    );
  }

  async processBotTurn(
    claim: OkeyBotTurnClaim,
  ): Promise<void> {
    const { data, error } = await supabase.functions.invoke("process_bot_turns", {
      body: {
        mode: "okey",
        match_id: this.matchId,
        expected_version: claim.expectedVersion,
        expected_actor_id: claim.expectedActorId,
      },
    });
    if (error) {
      const errorBody = await this.readFunctionErrorBody(error);
      console.warn("Okey bot turn request failed", {
        matchId: this.matchId,
        claim,
        error: errorBody ?? error,
      });
      throw errorBody ?? error;
    }
    if (data?.ok === false || typeof data?.error === "string") {
      console.warn("Okey bot turn execution failed", {
        matchId: this.matchId,
        claim,
        response: data,
      });
      throw data;
    }
    if (data?.processed === false) {
      console.warn("Okey bot turn was not processed", {
        matchId: this.matchId,
        claim,
        reason: data.reason ?? "unknown",
      });
    }
    return data;
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

    if (
      this.snapshot &&
      snapshot.currentRound !== this.snapshot.currentRound
    ) {
      this.triggerReset();
    }

    this.snapshot = snapshot;

    for (
      const listener of
      this.listeners
    ) {
      listener(snapshot);
    }

    this.ensureTerminalSettlementRefresh();
  }

  private ensureTerminalSettlementRefresh(): void {
    if (
      this.closed ||
      !this.snapshot?.matchFinished ||
      this.snapshot.settlement ||
      this.terminalSettlementRefreshPromise
    ) {
      return;
    }

    this.terminalSettlementRefreshPromise = (async () => {
      let retryDelayMs = 50;

      while (
        !this.closed &&
        this.snapshot?.matchFinished &&
        !this.snapshot.settlement
      ) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, retryDelayMs),
        );

        try {
          await this.refresh();
        } catch {}

        retryDelayMs = Math.min(retryDelayMs * 2, 2_000);
      }
    })().finally(() => {
      this.terminalSettlementRefreshPromise = null;
      this.ensureTerminalSettlementRefresh();
    });
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

  private mergePublicProjection(
    publicProjection: OkeyMatchServerProjection,
  ): OkeyMatchServerProjection | null {
    if (!this.snapshot) return null;

    const privateHands = new Map(
      this.snapshot.players.flatMap((player) =>
        Array.isArray(player.hand)
          ? [[player.id, player.hand] as const]
          : [],
      ),
    );

    return {
      ...publicProjection,
      players: publicProjection.players.map((player) => {
        const hand = privateHands.get(player.id);
        return hand ? { ...player, hand } : player;
      }),
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

          const merged = this.mergePublicProjection(projection);
          if (!merged) {
            this.refreshRealtimeGap(message.version);
            return;
          }

          this.publishActionEvents(
            Array.isArray(message.actionEvents) ? message.actionEvents : [],
          );
          this.publish(merged);
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

    if (!this.channel) {
      return;
    }

    void supabase.removeChannel(
      this.channel,
    );

    this.channel = null;
  }
}
