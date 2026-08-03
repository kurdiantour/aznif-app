import { supabase } from "@/lib/supabase";
import type { OnlineOkeyMatchAdapter } from "@/okey/adapters/okey-match-adapter";
import type { OkeyAuthoritativeCommand, OkeyServerProjection } from "@/okey/server/okey-authoritative";
import { leaveOkeyRoom, reconnectOkeyRoom } from "@/okey/multiplayer/okey-room-api";

function createCommandId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export class SupabaseOkeyMatchAdapter implements OnlineOkeyMatchAdapter {
  readonly kind = "online" as const;
  private snapshot: OkeyServerProjection | null = null;
  private readonly listeners = new Set<(snapshot: OkeyServerProjection) => void>();
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly matchId: string) {}

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: OkeyServerProjection) => void) {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    if (!this.channel) this.openRealtimeChannel();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.closeRealtimeChannel();
    };
  }

  async dispatch(command: OkeyAuthoritativeCommand) {
    const expectedVersion = this.snapshot?.version;
    if (expectedVersion === undefined) await this.refresh();
    const commandId = createCommandId();
    const { data, error } = await supabase.functions.invoke("okey_match", {
      body: {
        action: "command",
        matchId: this.matchId,
        commandId,
        expectedVersion: this.snapshot?.version,
        command,
      },
    });
    if (error) {
      await this.refresh();
      throw error;
    }
    this.publish(data?.projection as OkeyServerProjection);
  }

  async reconnect() {
    await reconnectOkeyRoom(this.matchId);
    this.openRealtimeChannel();
    await this.refresh();
  }

  async leave() {
    await leaveOkeyRoom(this.matchId);
    this.closeRealtimeChannel();
    this.snapshot = null;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const { data, error } = await supabase.functions.invoke("okey_match", {
        body: { action: "snapshot", matchId: this.matchId },
      });
      if (error) throw error;
      this.publish(data?.projection as OkeyServerProjection);
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private publish(snapshot: OkeyServerProjection | null | undefined) {
    if (!snapshot || (this.snapshot && snapshot.version < this.snapshot.version)) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private openRealtimeChannel() {
    if (this.channel) return;
    this.channel = supabase
      .channel(`okey-match:${this.matchId}`)
      .on("broadcast", { event: "invalidate" }, () => void this.refresh())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void this.refresh();
      });
  }

  private closeRealtimeChannel() {
    if (!this.channel) return;
    void supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
