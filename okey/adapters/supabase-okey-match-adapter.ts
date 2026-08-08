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

  /*
   * جلوگیری از ارسال چند resolve-timeout
   * همزمان از همین دستگاه.
   */
  private resolveTimeoutPromise:
    | Promise<void>
    | null = null;

  /*
   * Timer محلی فقط نقش Alarm دارد.
   *
   * این Timer state بازی را تغییر نمی‌دهد.
   * وقتی deadline واقعی سرور برسد،
   * فقط از Edge Function می‌خواهد
   * Timeout authoritative را resolve کند.
   */
  private timeoutTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  /*
   * deadlineای که در حال حاضر برای آن
   * Timer ساخته‌ایم.
   */
  private scheduledDeadline:
    | string
    | null = null;

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

      /*
       * اگر Snapshot قبل از subscribe
       * دریافت شده باشد، مطمئن می‌شویم
       * Timer آن هم فعال است.
       */
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
    /*
     * قبل از ارسال Command باید
     * حتماً Snapshot معتبر داشته باشیم.
     */
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

      /*
       * FunctionsHttpError پاسخ واقعی
       * Edge Function را داخل context دارد.
       */
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

      /*
       * deadline گذشته است.
       *
       * Command قدیمی دیگر نباید اجرا شود.
       * از سرور می‌خواهیم timeout را
       * authoritative حل کند.
       */
      if (
        errorBody?.error ===
        "turn_deadline_expired"
      ) {
        await this.resolveTimeout();
        return;
      }

      /*
       * در خطاهای دیگر Snapshot را تازه
       * می‌کنیم، سپس خطا را به UI می‌دهیم.
       */
      await this.refresh();

      throw error;
    }

    this.publish(
      data?.projection as
        | OkeyMatchServerProjection
        | null
        | undefined,
    );
  }

  /*
   * وقتی deadline نوبت تمام می‌شود،
   * از سرور می‌خواهیم حرکت Timeout
   * authoritative را اجرا کند.
   *
   * خود موبایل هیچ Tile یا state بازی را
   * به صورت محلی تغییر نمی‌دهد.
   */
  async resolveTimeout(): Promise<void> {
    /*
     * اگر همین موبایل در حال resolve کردن
     * Timeout است، درخواست دوم نفرست.
     */
    if (this.resolveTimeoutPromise) {
      return this.resolveTimeoutPromise;
    }

    this.resolveTimeoutPromise =
      (async () => {
        /*
         * ابتدا مطمئن شو Snapshot داریم.
         */
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
          /*
           * ممکن است دستگاه دیگری یا Worker
           * چند میلی‌ثانیه زودتر همین timeout
           * را resolve کرده باشد.
           *
           * این حالت Connection Error نیست.
           * فقط Snapshot جدید را دریافت می‌کنیم.
           */
          try {
            await this.refresh();
          } catch {
            /*
             * refresh بعدی از Realtime یا
             * reconnect دوباره تلاش خواهد کرد.
             */
          }

          return;
        }

        /*
         * اگر همین درخواست موفق شد،
         * Projection جدید را منتشر کن.
         */
        this.publish(
          data?.projection as
            | OkeyMatchServerProjection
            | null
            | undefined,
        );
      })().finally(() => {
        this.resolveTimeoutPromise =
          null;
      });

    return this.resolveTimeoutPromise;
  }

  /*
   * Timer قبلی deadline را پاک می‌کند.
   */
  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(
        this.timeoutTimer,
      );

      this.timeoutTimer = null;
    }

    this.scheduledDeadline = null;
  }

  /*
   * برای turnDeadlineAt واقعی که از سرور
   * آمده یک Alarm محلی می‌سازیم.
   *
   * مهم:
   * این Alarm خودش Draw/Discard نمی‌کند.
   * فقط resolve-timeout را به سرور می‌فرستد.
   */
  private scheduleTimeout(
    snapshot:
      OkeyMatchServerProjection,
  ): void {
    const deadline =
      snapshot.turnDeadlineAt;

    /*
     * وقتی بازی در حالت playing نیست
     * یا deadline نداریم، Timer لازم نیست.
     */
    if (
      snapshot.phase !== "playing" ||
      !deadline
    ) {
      this.clearTimeoutTimer();
      return;
    }

    /*
     * برای همین deadline قبلاً Timer داریم.
     * دوباره Timer نساز.
     */
    if (
      this.timeoutTimer &&
      this.scheduledDeadline ===
        deadline
    ) {
      return;
    }

    /*
     * نوبت یا deadline عوض شده.
     * Timer قبلی دیگر معتبر نیست.
     */
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

    /*
     * 150ms مهلت کوچک می‌دهیم تا
     * درخواست دقیقاً قبل از deadline
     * به سرور نرسد.
     */
    const delay =
      Math.max(
        0,
        deadlineMs -
          Date.now() +
          150,
      );

    this.timeoutTimer =
      setTimeout(() => {
        /*
         * Timer فعلی تمام شد.
         *
         * Snapshot بعدی deadline جدید
         * را دوباره schedule خواهد کرد.
         */
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

        this.publish(
          data?.projection as
            | OkeyMatchServerProjection
            | null
            | undefined,
        );
      })().finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
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

    /*
     * Projection قدیمی اجازه ندارد
     * Snapshot جدیدتر را overwrite کند.
     */
    if (
      this.snapshot &&
      snapshot.version <
        this.snapshot.version
    ) {
      return;
    }

    this.snapshot = snapshot;

    /*
     * مهم‌ترین بخش اصلاح Timer:
     *
     * هر Snapshot authoritative
     * turnDeadlineAt واقعی سرور را دارد.
     *
     * برای همان deadline Alarm می‌سازیم.
     */
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
          /*
           * سرور فقط invalidate می‌فرستد.
           * Snapshot authoritative را
           * دوباره از Edge Function می‌گیریم.
           */
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
    /*
     * وقتی دیگر Listener نداریم،
     * Alarm محلی این Adapter هم متوقف شود.
     */
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