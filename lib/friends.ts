import type { AvatarId } from "@/constants/avatars";
import { supabase } from "./supabase";
import { getCurrentUser } from "./supabaseAuth";

export type FriendProfile = {
  id: string;
  name: string;
  playerId: string;
  avatarId: AvatarId;
};

export type Friend = FriendProfile & {
  friendshipId: string;
};

export type FriendRequest = FriendProfile & {
  friendshipId: string;
  createdAt: string;
};

export type FriendSearchResult = FriendProfile & {
  friendshipStatus: "pending" | "accepted" | "rejected" | null;
  friendshipDirection: "incoming" | "outgoing" | null;
};

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at: string;
  responded_at?: string | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  player_id: string | null;
  avatar_id: string | null;
};

function mapProfile(row: any): FriendProfile {
  return {
    id: row.friend_id ?? row.requester_id ?? row.id,
    name: row.username ?? "Unknown Player",
    playerId: row.player_id ?? "unknown",
    avatarId: (row.avatar_id ?? "avatar-1") as AvatarId,
  };
}

async function getAuthenticatedUserId() {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

async function getProfilesById(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  if (uniqueIds.length === 0) {
    return new Map<string, ProfileRow>();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, player_id, avatar_id")
    .in("id", uniqueIds);

  if (error) throw error;

  return new Map(
    (data ?? []).map((profile: ProfileRow) => [profile.id, profile]),
  );
}

function fallbackProfile(userId: string): FriendProfile {
  return {
    id: userId,
    name: `Player ${userId.slice(0, 8)}`,
    playerId: "Unavailable",
    avatarId: "avatar-1" as AvatarId,
  };
}

function profileToFriendProfile(
  profile: ProfileRow | undefined,
  userId: string,
): FriendProfile {
  const fallback = fallbackProfile(userId);

  return {
    id: profile?.id ?? fallback.id,
    name: profile?.username ?? fallback.name,
    playerId: profile?.player_id ?? fallback.playerId,
    avatarId: (profile?.avatar_id ?? fallback.avatarId) as AvatarId,
  };
}

export async function getFriends(): Promise<Friend[]> {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from("friendships")
    .select(
      "id, requester_id, addressee_id, status, created_at, updated_at, responded_at",
    )
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq("status", "accepted")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as FriendshipRow[];

  const friendIds = rows.map((row) =>
    row.requester_id === userId ? row.addressee_id : row.requester_id,
  );

  const profilesById = await getProfilesById(friendIds);

  return rows.map((row) => {
    const friendId =
      row.requester_id === userId ? row.addressee_id : row.requester_id;
    const profile = profileToFriendProfile(
      profilesById.get(friendId),
      friendId,
    );

    return {
      ...profile,
      friendshipId: row.id,
    };
  });
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from("friendships")
    .select(
      "id, requester_id, addressee_id, status, created_at, updated_at, responded_at",
    )
    .eq("addressee_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as FriendshipRow[];

  if (rows.length === 0) {
    return [];
  }

  const requesterIds = rows.map((row) => row.requester_id);
  const profilesById = await getProfilesById(requesterIds);

  return rows.map((row) => {
    const profile = profileToFriendProfile(
      profilesById.get(row.requester_id),
      row.requester_id,
    );

    return {
      ...profile,
      friendshipId: row.id,
      createdAt: row.created_at,
    };
  });
}

export async function searchFriendCandidates(
  query: string,
): Promise<FriendSearchResult[]> {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const { data, error } = await supabase.rpc("search_friend_candidates", {
    p_query: trimmed,
    p_limit: 10,
  });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ...mapProfile(row),
    friendshipStatus: row.friendship_status,
    friendshipDirection: row.friendship_direction,
  }));
}

export async function sendFriendRequest(addresseeId: string) {
  const { data, error } = await supabase.rpc("send_friend_request", {
    p_addressee: addresseeId,
  });

  if (error) throw error;

  return data;
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
) {
  const { data, error } = await supabase.rpc("respond_friend_request", {
    p_friendship_id: friendshipId,
    p_accept: accept,
  });

  if (error) {
    throw new Error(error.message || "Unable to update friend request.");
  }

  return data;
}
