import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import {
  getActiveOkeyMemberships,
  leaveOkeyRoom,
  type OkeyActiveMembership,
} from "@/okey/multiplayer/okey-room-api";

async function leaveMembership(membership: OkeyActiveMembership): Promise<void> {
  if (membership.status === "waiting") {
    await leaveOkeyRoom(membership.matchId);
    return;
  }

  const adapter = new SupabaseOkeyMatchAdapter(membership.matchId);
  await adapter.refresh();
  await adapter.leave();
}

export async function releaseTakenOverOkeyMemberships(): Promise<void> {
  const memberships = await getActiveOkeyMemberships();

  for (const membership of memberships) {
    if (membership.status !== "playing") continue;

    const adapter = new SupabaseOkeyMatchAdapter(membership.matchId);
    await adapter.refresh();
    const projection = adapter.getSnapshot();
    const viewer = projection?.players[membership.playerIndex];

    if (viewer?.controlledByBot === true || viewer?.kind === "bot") {
      // A timeout takeover has already ended Human control. It is not a
      // manual leave, so this cleanup must not submit a manual-leave command.
      continue;
    }
  }
}

export async function leaveAllActiveOkeyMemberships(): Promise<void> {
  const memberships = await getActiveOkeyMemberships();

  for (const membership of memberships) {
    await leaveMembership(membership);
  }
}