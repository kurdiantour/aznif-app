import type { Profile, ProfileUpdate } from "@/types/profile";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { calculateLevelFromPoints } from "./progression";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  getCurrentUser,
  getOrCreateProfile,
  updateMyProfile,
} from "./supabaseAuth";

type DbProfile = {
  id: string;
  player_id: string;
  username: string;
  full_name: string | null;
  avatar_id: string;
  avatar_url: string | null;
  level?: number;
  points?: number;
  games_played?: number;
  games_won?: number;
  games_lost?: number;
  is_admin?: boolean;
  created_at: string;
  updated_at: string;
};

const PROFILE_SELECT =
  "id, player_id, username, full_name, avatar_id, avatar_url, level, points, games_played, games_won, games_lost, is_admin, created_at, updated_at";
const PROFILE_LOAD_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Profile load timed out."));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

function mapDbProfile(
  profile: DbProfile,
  email?: string,
  coin = 0,
  gems = 0,
): Profile {
  const points = Number(profile.points ?? 0);

  return {
    id: profile.id,
    playerId: profile.player_id,
    username: profile.username,
    displayName: profile.full_name || profile.username,
    avatarId: profile.avatar_id as unknown as Profile["avatarId"],
    avatarUrl: profile.avatar_url ?? undefined,
    email,
    bio: undefined,
    status: "active",
    level: calculateLevelFromPoints(points),
    coin,
    points,
    gems,
    gamesPlayed: Number(profile.games_played ?? 0),
    gamesWon: Number(profile.games_won ?? 0),
    gamesLost: Number(profile.games_lost ?? 0),
    isAdmin: Boolean(profile.is_admin),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const dbProfile = await getOrCreateProfile();

  if (!dbProfile) {
    return null;
  }

  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("coin, gem")
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError) throw walletError;

  return mapDbProfile(
    dbProfile,
    user.email ?? undefined,
    Number(wallet?.coin ?? 0),
    Number(wallet?.gem ?? 0),
  );
}

export type LeaderboardProfile = Pick<
  Profile,
  "id" | "displayName" | "avatarId" | "avatarUrl" | "level" | "coin" | "points"
> & {
  rank: number;
  aznif: number;
  gem: number;
};

export async function getLeaderboardProfiles(
  limit = 50,
): Promise<LeaderboardProfile[]> {
  const { data, error } = await supabase.rpc("get_leaderboard", {
    p_limit: limit,
  });

  if (error) {
    throw error;
  }

  return (data ?? []).map((profile: any) => {
    const points = Number(profile.points ?? 0);

    return {
      id: profile.user_id,
      displayName: profile.display_name,
      avatarId: profile.avatar_id as Profile["avatarId"],
      avatarUrl: profile.avatar_url ?? undefined,
      level: calculateLevelFromPoints(points),
      coin: Number(profile.coin ?? 0),
      points,
      rank: Number(profile.rank ?? 0),
      aznif: Number(profile.aznif ?? profile.mc ?? 0),
      gem: Number(profile.gem ?? 0),
    };
  });
}

export async function getCurrentLeaderboardRank(
  userId?: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("get_my_leaderboard_rank");

  if (!error && typeof data === "number") {
    return data;
  }

  if (!userId) {
    if (error) {
      console.warn("[profile] get_my_leaderboard_rank failed:", error);
    }

    return null;
  }

  const leaderboard = await getLeaderboardProfiles(100);
  const currentPlayer = leaderboard.find((player) => player.id === userId);

  return currentPlayer?.rank ?? null;
}

export async function getProfileById(id: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", id)
    .maybeSingle<DbProfile>();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Profile not found for id " + id);
  }

  return mapDbProfile(data);
}

export async function updateCurrentProfile(
  changes: ProfileUpdate,
): Promise<Profile> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("User is not authenticated");
  }

  const payload: {
    username?: string;
    avatar_id?: string;
  } = {};

  if (typeof changes.displayName === "string") {
    const trimmedName = changes.displayName.trim();

    if (trimmedName) {
      payload.username = trimmedName;
    }
  }

  if (typeof changes.avatarId === "string") {
    payload.avatar_id = changes.avatarId;
  }

  if (!payload.username && !payload.avatar_id) {
    const current = await getCurrentProfile();

    if (!current) {
      throw new Error("Unable to refresh profile.");
    }

    return current;
  }

  const dbProfile = await updateMyProfile(payload);

  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("coin, gem")
    .eq("user_id", user.id)
    .maybeSingle();

  if (walletError) throw walletError;

  return mapDbProfile(
    dbProfile,
    user.email ?? undefined,
    Number(wallet?.coin ?? 0),
    Number(wallet?.gem ?? 0),
  );
}

type ProfileContextValue = {
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<Profile | null>;
  updateProfile: (changes: ProfileUpdate) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let profileLoadTimer: ReturnType<typeof setTimeout> | null = null;

    if (!isSupabaseConfigured) {
      setProfile(null);
      setLoading(false);
      return;
    }

    async function loadProfile() {
      try {
        setLoading(true);

        const nextProfile = await withTimeout(
          getCurrentProfile(),
          PROFILE_LOAD_TIMEOUT_MS,
        );

        if (isMounted) {
          setProfile(nextProfile);
        }
      } catch (error) {
        console.warn("[ProfileProvider] Failed to load profile:", error);

        if (isMounted) {
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    function scheduleProfileLoad() {
      if (profileLoadTimer) {
        clearTimeout(profileLoadTimer);
      }

      profileLoadTimer = setTimeout(() => {
        profileLoadTimer = null;
        void loadProfile();
      }, 0);
    }

    void loadProfile();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      if (!session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      scheduleProfileLoad();
    });

    return () => {
      isMounted = false;
      if (profileLoadTimer) {
        clearTimeout(profileLoadTimer);
      }
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const nextProfile = await getCurrentProfile();

    setProfile(nextProfile);

    return nextProfile;
  }, []);

  const updateProfile = useCallback(async (changes: ProfileUpdate) => {
    const nextProfile = await updateCurrentProfile(changes);

    setProfile(nextProfile);

    return nextProfile;
  }, []);

  return (
    <ProfileContext.Provider
      value={{
        profile,
        loading,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error("useProfile must be used within ProfileProvider");
  }

  return context;
}
