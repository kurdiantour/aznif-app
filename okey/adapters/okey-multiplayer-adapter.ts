import type {
  MultiplayerMatchAdapter,
  MultiplayerSubscription,
} from "@/lib/multiplayer/match";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import { SupabaseOkeyMatchAdapter } from "./supabase-okey-match-adapter";

/** Game-independent match lifecycle bridge around Okey's command transport. */
export class OkeyMultiplayerAdapter
  implements MultiplayerMatchAdapter<OkeyMatchServerProjection>
{
  constructor(readonly commands: SupabaseOkeyMatchAdapter) {}

  private requireSnapshot(): OkeyMatchServerProjection {
    const snapshot = this.commands.getSnapshot();
    if (!snapshot) throw new Error("okey_snapshot_unavailable");
    return snapshot;
  }

  async load(): Promise<OkeyMatchServerProjection> {
    await this.commands.refresh();
    return this.requireSnapshot();
  }

  async resume(): Promise<OkeyMatchServerProjection> {
    await this.commands.reconnect();
    return this.requireSnapshot();
  }

  subscribe(observer: MultiplayerSubscription<OkeyMatchServerProjection>): () => void {
    const unsubscribeInvalidation = this.commands.subscribeInvalidation(
      (snapshot) => observer.onInvalidated(snapshot),
    );
    const unsubscribeStatus = this.commands.subscribeStatus(
      (status, error) => observer.onStatus(status, error),
    );
    return () => {
      unsubscribeInvalidation();
      unsubscribeStatus();
    };
  }

  leave() {
    return this.commands.leave();
  }
}
