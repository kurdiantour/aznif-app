import { supabase } from "@/lib/supabase";

import type { OnlineOkeyMatchAdapter } from "@/okey/adapters/okey-match-adapter";

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

  private channel:
    | ReturnType<
        typeof supabase.channel
      >
    | null = null;

  private refreshPromise:
    | Promise<void>
    | null = null;

  private resolveTimeoutPromise:
    | Promise<void>
    | null = null;

  private timeoutTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  private scheduledDeadline:
    | string
    | null = null;

  private serverClockOffsetMs = 0;

  constructor(
    private readonly matchId: string,
  ) {}

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
      this.scheduleTimeout(
        this.snapshot,
      );
    }

    if (!this.channel) {
      this.openRealtimeChannel();
    }

    return () => {
      this.listeners.delete(listener);

      if (
        this.listeners.size === 0
      ) {
        this.closeRealtimeChannel();
      }
    };
  }

  async dispatch(
    command:
      OkeyAuthoritativeCommand,
  ): Promise<void> {

    if (
      this.snapshot?.version ===
      undefined
    ) {
      await this.refresh();
    }

    const expectedVersion =
      this.snapshot?.version;

    if (
      expectedVersion === undefined
    ) {
      throw new Error(
        "okey_snapshot_unavailable",
      );
    }

    const commandId =
      createCommandId();

    const { data, error } =
      await supabase.functions.invoke(
        "okey_match",
        {
          body: {
            action: "command",
            matchId: this.matchId,
            commandId,
            expectedVersion,
            command,
          },
        },
      );

    if (error) {
      let errorBody:
        | { error?: string }
        | null = null;

      try {
        if (
          "context" in error &&
          error.context
        ) {
          errorBody =
            await error.context.json();
        }
      } catch {
        errorBody = null;
      }

      if (
        errorBody?.error ===
        "turn_deadline_expired"
      ) {
        await this.resolveTimeout();
        return;
      }

      await this.refresh();

      throw error;
    }

    this.publishResponse(data);
  }

  async resolveTimeout(): Promise<void> {
    if (this.resolveTimeoutPromise) {
      return this.resolveTimeoutPromise;
    }

    this.resolveTimeoutPromise =
      (async () => {

        if (
          this.snapshot?.version ===
          undefined
        ) {
          await this.refresh();
        }

        const expectedVersion =
          this.snapshot?.version;

        if (
          expectedVersion ===
          undefined
        ) {
          return;
        }

        const commandId =
          createCommandId();

        const { data, error } =
          await supabase.functions.invoke(
            "okey_match",
            {
              body: {
                action:
                  "resolve-timeout",

                matchId:
                  this.matchId,

                commandId,

                expectedVersion,
              },
            },
          );

        if (error) {
          let errorBody: {
            code?: string;
            error?: string;
            serverNow?: string;
            expiresAt?: string;
          } | null = null;

          try {
            if ("context" in error && error.context) {
              errorBody = await error.context.json();
            }
          } catch {
            errorBody = null;
          }

          this.syncServerClock(errorBody?.serverNow);

          if (
            errorBody?.code === "turn_timer_not_expired" &&
            typeof errorBody.expiresAt === "string" &&
            this.snapshot
          ) {
            this.scheduleTimeout({
              ...this.snapshot,
              turnDeadlineAt: errorBody.expiresAt,
            });
            return;
          }

          try {
            await this.refresh();
          } catch {

          }

          return;
        }


        this.publishResponse(data);
      })().finally(() => {
        this.resolveTimeoutPromise =
          null;
      });

    return this.resolveTimeoutPromise;
  }


  private syncServerClock(serverNow: unknown): void {
    if (typeof serverNow !== "string") return;
    const serverNowMs = Date.parse(serverNow);
    if (!Number.isFinite(serverNowMs)) return;
    this.serverClockOffsetMs = serverNowMs - Date.now();
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(
        this.timeoutTimer,
      );

      this.timeoutTimer = null;
    }

    this.scheduledDeadline = null;
  }


  private scheduleTimeout(
    snapshot:
      OkeyMatchServerProjection,
  ): void {
    const deadline =
      snapshot.turnDeadlineAt;

    if (
      snapshot.phase !== "playing" ||
      !deadline
    ) {
      this.clearTimeoutTimer();
      return;
    }

    if (
      this.timeoutTimer &&
      this.scheduledDeadline ===
        deadline
    ) {
      return;
    }

    this.clearTimeoutTimer();

    const deadlineMs =
      Date.parse(deadline);

    if (
      !Number.isFinite(
        deadlineMs,
      )
    ) {
      return;
    }

    this.scheduledDeadline =
      deadline;

    const delay =
      Math.max(
        0,
        deadlineMs -
          (Date.now() + this.serverClockOffsetMs),
      );

    this.timeoutTimer =
      setTimeout(() => {
        this.timeoutTimer = null;
        this.scheduledDeadline =
          null;

        void this.resolveTimeout();
      }, delay);
  }

  async reconnect(): Promise<void> {
    await reconnectOkeyRoom(
      this.matchId,
    );

    this.openRealtimeChannel();

    await this.refresh();
  }

  async leave(): Promise<void> {
    if (
      this.snapshot?.version ===
      undefined
    ) {
      await this.refresh();
    }

    const expectedVersion =
      this.snapshot?.version;

    if (expectedVersion === undefined) {
      throw new Error(
        "okey_snapshot_unavailable",
      );
    }

    const { error } =
      await supabase.functions.invoke(
        "okey_match",
        {
          body: {
            action: "manual-leave",
            matchId: this.matchId,
            commandId: createCommandId(),
            expectedVersion,
          },
        },
      );

    if (error) {
      throw error;
    }

    await leaveOkeyRoom(
      this.matchId,
    );

    this.closeRealtimeChannel();

    this.clearTimeoutTimer();

    this.snapshot = null;

    this.resolveTimeoutPromise =
      null;
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

  private publishResponse(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const response = data as {
      projection?: OkeyMatchServerProjection | null;
      settlement?: OkeyMatchServerProjection["settlement"];
      serverNow?: string;
    };

    this.syncServerClock(response.serverNow);

    if (!response.projection) {
      return;
    }

    this.publish({
      ...response.projection,
      settlement: "settlement" in response
        ? response.settlement ?? null
        : this.snapshot?.settlement ?? null,
    });
  }
  private publish(
    snapshot:
      | OkeyMatchServerProjection
      | null
      | undefined,
  ): void {
    if (!snapshot) {
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
    this.scheduleTimeout(
      snapshot,
    );

    for (
      const listener of
      this.listeners
    ) {
      listener(snapshot);
    }
  }

  private openRealtimeChannel(): void {
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
          event: "invalidate",
        },
        () => {

          void this.refresh();
        },
      )
      .subscribe((status) => {
        if (
          status === "SUBSCRIBED"
        ) {
          void this.refresh();
        }
      });
  }

  private closeRealtimeChannel(): void {
    this.clearTimeoutTimer();

    if (!this.channel) {
      return;
    }

    void supabase.removeChannel(
      this.channel,
    );

    this.channel = null;
  }
}