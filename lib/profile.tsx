import type { Profile, ProfileUpdate } from '@/types/profile';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { getCurrentUser, getOrCreateProfile, updateMyProfile } from './supabaseAuth';

type DbProfile = {
  id: string;
  username: string;
  avatar_id: string;
  level?: number;
  points?: number;
  created_at: string;
  updated_at: string;
};

function mapDbProfile(profile: DbProfile, email?: string): Profile {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.username,
    avatarId: profile.avatar_id as unknown as Profile['avatarId'],
    avatarUrl: undefined,
    email,
    bio: undefined,
    status: 'active',
    level: profile.level ?? 1,
    points: profile.points ?? 0,
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

  return mapDbProfile(dbProfile, user.email ?? undefined);
}

export type LeaderboardProfile = Pick<
  Profile,
  'id' | 'displayName' | 'avatarId' | 'level' | 'points'
>;

export async function getLeaderboardProfiles(
  limit = 50,
): Promise<LeaderboardProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_id, level, points')
    .order('points', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map((profile: any) => ({
    id: profile.id,
    displayName: profile.username,
    avatarId: profile.avatar_id as Profile['avatarId'],
    level: profile.level ?? 1,
    points: Number(profile.points ?? 0),
  }));
}

export async function getProfileById(id: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_id, level, points, created_at, updated_at')
    .eq('id', id)
    .maybeSingle<DbProfile>();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Profile not found for id ' + id);
  }

  return mapDbProfile(data);
}

export async function updateCurrentProfile(
  changes: ProfileUpdate,
): Promise<Profile> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error('User is not authenticated');
  }

  const payload: { username?: string; avatar_id?: string } = {};

  if (typeof changes.displayName === 'string') {
    const trimmedName = changes.displayName.trim();

    if (trimmedName) {
      payload.username = trimmedName;
    }
  }

  if (typeof changes.avatarId === 'string') {
    payload.avatar_id = changes.avatarId;
  }

  if (!payload.username && !payload.avatar_id) {
    const current = await getCurrentProfile();

    if (!current) {
      throw new Error('Unable to refresh profile.');
    }

    return current;
  }

  const dbProfile = await updateMyProfile(payload);

  return mapDbProfile(dbProfile, user.email ?? undefined);
}

type ProfileContextValue = {
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<Profile | null>;
  updateProfile: (changes: ProfileUpdate) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        setLoading(true);

        const nextProfile = await getCurrentProfile();

        if (isMounted) {
          setProfile(nextProfile);
        }
      } catch (error) {
        console.warn('[ProfileProvider] Failed to load profile:', error);

        if (isMounted) {
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

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

      loadProfile();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    const nextProfile = await getCurrentProfile();

    setProfile(nextProfile);

    return nextProfile;
  }

  async function updateProfile(changes: ProfileUpdate) {
    const nextProfile = await updateCurrentProfile(changes);

    setProfile(nextProfile);

    return nextProfile;
  }

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
    throw new Error('useProfile must be used within ProfileProvider');
  }

  return context;
}