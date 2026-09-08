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

export async function leaveAllActiveOkeyMemberships(): Promise<void> {
  const memberships = await getActiveOkeyMemberships();

  for (const membership of memberships) {
    await leaveMembership(membership);
  }
}