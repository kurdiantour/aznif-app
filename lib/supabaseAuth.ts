import type { User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { supabase } from "./supabase";

export type Profile = {
  id: string;
  email: string | null;
  player_id: string;
  username: string;
  avatar_id: string;
  level?: number;
  points?: number;
  games_played?: number;
  games_won?: number;
  games_lost?: number;
  is_admin?: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicProfile = Pick<
  Profile,
  "username" | "avatar_id" | "player_id"
>;

const PROFILE_SELECT =
  "id, email, player_id, username, avatar_id, level, points, games_played, games_won, games_lost, is_admin, created_at, updated_at";
const PROFILE_CREATE_RETRIES = 3;

function defaultUsernameForUser(userId: string, attempt: number) {
  const baseName = "user_" + userId.slice(0, 8);

  return attempt === 0 ? baseName : `${baseName}_${attempt + 1}`;
}

function generatePlayerId() {
  return "DV-" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: Linking.createURL("/auth-callback") },
  });
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();

    if (sessionData.session?.user) {
      return sessionData.session.user;
    }

    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch (error) {
    console.warn("[supabase] getCurrentUser failed", error);
    return null;
  }
}

export async function getOrCreateProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const existing = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    return existing.data;
  }

  for (let attempt = 0; attempt < PROFILE_CREATE_RETRIES; attempt += 1) {
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? null,
        player_id: generatePlayerId(),
        username: defaultUsernameForUser(user.id, attempt),
        avatar_id: "avatar-1",
      })
      .select(PROFILE_SELECT)
      .single<Profile>();

    if (!error) {
      return data;
    }

    const isCollision =
      error.code === "23505" ||
      error.message.toLowerCase().includes("duplicate");

    if (!isCollision) {
      throw error;
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (error) {
    throw error;
  }

  return data;
}

export async function updateMyProfile(input: {
  username?: string;
  avatar_id?: string;
}): Promise<Profile> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("User is not authenticated");
  }

  const payload: Partial<Pick<Profile, "username" | "avatar_id">> = {};

  if (typeof input.username === "string") {
    payload.username = input.username.trim();
  }

  if (typeof input.avatar_id === "string") {
    payload.avatar_id = input.avatar_id;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", user.id)
    .select(PROFILE_SELECT)
    .single<Profile>();

  if (error) throw error;

  return data;
}

export async function getPublicProfile(
  userId: string,
): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, avatar_id, player_id")
    .eq("id", userId)
    .maybeSingle<PublicProfile>();

  if (error) throw error;

  return data;
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: Linking.createURL("/auth-callback", {
      queryParams: { flow: "recovery" },
    }),
  });
}

export async function resendVerificationEmail(email: string) {
  return supabase.auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: Linking.createURL("/auth-callback") },
  });
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

