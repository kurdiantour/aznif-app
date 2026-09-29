import type { Profile, ProfileUpdate } from "@/types/profile";
import { AppState, Platform } from "react-native";
import { getAuthState, publishAuthState, useAuthState, hasReadySession } from "./auth-state";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { calculateLevelFromPoints } from "./progression";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  getOrCreateProfile,
  updateMyProfile,
  type ProfileRequestScope,
} from "./supabaseAuth";

type DbProfile = {
  id: string;
  player_id: string;
  username: string;
  avatar_id: string;
  avatar_url: string | null;
  points?: number;
  games_played?: number;
  games_won?: number;
  games_lost?: number;
  is_admin?: boolean;
  created_at: string;
  updated_at: string;
};

export type HumanPlayerProfile = Pick<
  Profile,
  "id" | "playerId" | "displayName" | "avatarId" | "avatarUrl"
>;

const PROFILE_SELECT =
  "id, player_id, username, avatar_id, avatar_url, points, games_played, games_won, games_lost, is_admin, created_at, updated_at";

const HUMAN_PROFILE_SELECT =
  "id, player_id, username, avatar_id, avatar_url";

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
    displayName: profile.username,
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

function mapHumanPlayerProfile(
  profile: Pick<
    DbProfile,
    "id" | "player_id" | "username" | "avatar_id" | "avatar_url"
  >,
): HumanPlayerProfile {
  return {
    id: profile.id,
    playerId: profile.player_id,
    displayName: profile.username,
    avatarId: profile.avatar_id as Profile["avatarId"],
    avatarUrl: profile.avatar_url ?? undefined,
  };
}

export async function getHumanPlayerProfile(
  userId: string,
): Promise<HumanPlayerProfile | null> {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(HUMAN_PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle<Pick<
      DbProfile,
      "id" | "player_id" | "username" | "avatar_id" | "avatar_url"
    >>();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return mapHumanPlayerProfile(data);
}

export async function getHumanPlayerProfiles(
  userIds: string[],
): Promise<Map<string, HumanPlayerProfile>> {
  const uniqueIds = Array.from(
    new Set(userIds.filter((userId) => typeof userId === "string" && userId)),
  );

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(HUMAN_PROFILE_SELECT)
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map(
    (data ?? []).map((profile) => {
      const mapped = mapHumanPlayerProfile(
        profile as Pick<
          DbProfile,
          "id" | "player_id" | "username" | "avatar_id" | "avatar_url"
        >,
      );

      return [mapped.id, mapped] as const;
    }),
  );
}

function captureProfileScope(): ProfileRequestScope {
  const auth = getAuthState();
  if (!hasReadySession(auth) || !auth.session) throw new Error("User is not authenticated");
  return {
    user: auth.session.user,
    assertCurrent: () => {
      const current = getAuthState();
      if (current.generation !== auth.generation || current.userId !== auth.userId) {
        throw new Error("Session changed during profile request.");
      }
    },
  };
}

export async function getCurrentProfile(scope?: ProfileRequestScope): Promise<Profile | null> {
  if (!scope && !hasReadySession()) return null;
  const request = scope ?? captureProfileScope();
  request.assertCurrent();
  const user = request.user;
  const dbProfile = await getOrCreateProfile(request);
  request.assertCurrent();

  if (!dbProfile) {
    return null;
  }

  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("coin, gem")
    .eq("user_id", user.id)
    .maybeSingle();

  request.assertCurrent();
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
  "id" | "displayName" | "avatarId" | "avatarUrl" | "coin" | "points"
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
  scope?: ProfileRequestScope,
): Promise<Profile> {
  const request = scope ?? captureProfileScope();
  request.assertCurrent();
  const user = request.user;

  const payload: {
    username?: string;
    avatar_id?: string;
    avatar_url?: string | null;
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

  if (changes.avatarUrl !== undefined) {
    payload.avatar_url = changes.avatarUrl;
  }

  if (
    !payload.username &&
    payload.avatar_id === undefined &&
    payload.avatar_url === undefined
  ) {
    const current = await getCurrentProfile(request);

    if (!current) {
      throw new Error("Unable to refresh profile.");
    }

    return current;
  }

  const dbProfile = await updateMyProfile(payload, request);
  request.assertCurrent();

  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("coin, gem")
    .eq("user_id", user.id)
    .maybeSingle();

  request.assertCurrent();
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
  session: Session | null;
  authLoading: boolean;
  authError: Error | null;
  refreshProfile: () => Promise<Profile | null>;
  updateProfile: (changes: ProfileUpdate) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  const [stored, setStored] = useState<{ generation: number; profile: Profile | null } | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<{ generation: number; promise: Promise<Profile | null> } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authError, setAuthError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let active = AppState.currentState === "active";
    publishAuthState(null, false, active);
    if (!isSupabaseConfigured) return;
    const accept = (next: Session | null) => {
      publishAuthState(next, true, active);
      setSession(next);
      setAuthError(null);
      setAuthLoading(false);
    };
    async function restore() {
      const request = ++revision;
      publishAuthState(getAuthState().session, false, active);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (mounted && request === revision) accept(data.session);
      } catch (cause) {
        if (mounted && request === revision) {
          publishAuthState(null, false, active);
          setAuthError(cause instanceof Error ? cause : new Error("Unable to restore auth session."));
          setAuthLoading(false);
        }
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      revision++;
      accept(next);
    });
    const autoRefresh = () => {
      if (Platform.OS !== "web") {
        if (active) void supabase.auth.startAutoRefresh();
        else void supabase.auth.stopAutoRefresh();
      }
    };
    void restore();
    autoRefresh();
    const app = AppState.addEventListener("change", (next) => {
      if (active === (next === "active")) return;
      active = next === "active";
      publishAuthState(getAuthState().session, false, active);
      autoRefresh();
      if (active) void restore();
    });
    return () => {
      mounted = false;
      revision++;
      publishAuthState(null, false, false);
      app.remove();
      subscription.unsubscribe();
      if (Platform.OS !== "web") void supabase.auth.stopAutoRefresh();
    };
  }, []);

  const isCurrent = useCallback((generation: number, request: number) =>
    mounted.current && getAuthState().generation === generation && sequence.current === request, []);

  const refreshProfile = useCallback((): Promise<Profile | null> => {
    if (!mounted.current || !hasReadySession() || getAuthState().generation !== auth.generation) return Promise.resolve(null);
    if (inFlight.current?.generation === auth.generation) return inFlight.current.promise;
    const scope = captureProfileScope();
    const request = ++sequence.current;
    setPending(auth.generation);
    const promise = Promise.resolve().then(async () => {
      try {
        scope.assertCurrent();
        const next = await withTimeout(getCurrentProfile(scope), PROFILE_LOAD_TIMEOUT_MS);
        if (!isCurrent(auth.generation, request)) return null;
        setStored({ generation: auth.generation, profile: next });
        return next;
      } catch (error) {
        if (isCurrent(auth.generation, request)) {
          console.warn("[ProfileProvider] Failed to load profile:", error);
          setStored(previous => previous?.generation === auth.generation ? previous : { generation: auth.generation, profile: null });
        }
        return null;
      } finally {
        if (isCurrent(auth.generation, request)) setPending(null);
        if (inFlight.current?.promise === promise) inFlight.current = null;
      }
    });
    inFlight.current = { generation: auth.generation, promise };
    return promise;
  }, [auth.generation, isCurrent]);

  const ready = hasReadySession(auth);
  useEffect(() => {
    mounted.current = true;
    if (ready) void Promise.resolve().then(refreshProfile);
    return () => {
      mounted.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      inFlight.current = null;
    };
  }, [ready, refreshProfile]);

  const updateProfile = useCallback(async (changes: ProfileUpdate) => {
    if (!mounted.current || getAuthState().generation !== auth.generation) throw new Error("Session changed during profile request.");
    const scope = captureProfileScope();
    // A write supersedes reads already in flight.
    const request = ++sequence.current;
    inFlight.current = null;
    try {
      const next = await updateCurrentProfile(changes, scope);
      if (!isCurrent(auth.generation, request)) throw new Error("Profile request was superseded.");
      setStored({ generation: auth.generation, profile: next });
      return next;
    } finally {
      if (isCurrent(auth.generation, request)) setPending(null);
    }
  }, [auth.generation, isCurrent]);

  const profile = stored?.generation === auth.generation && stored.profile?.id === auth.userId ? stored.profile : null;
  const loading = !!auth.userId && (pending === auth.generation || stored?.generation !== auth.generation);

  return (
    <ProfileContext.Provider
      value={{
        profile,
        loading,
        session,
        authLoading,
        authError,
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