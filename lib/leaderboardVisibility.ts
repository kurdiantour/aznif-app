import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getCurrentUser } from "./supabaseAuth";

export const PENDING_LEADERBOARD_CONSENT_KEY =
  "domino_pending_leaderboard_consent";

function isMissingLeaderboardVisibleColumn(error: unknown) {
  const nextError = error as { code?: string; message?: string } | null;
  const message = nextError?.message?.toLowerCase() ?? "";

  return (
    nextError?.code === "42703" ||
    nextError?.code === "PGRST204" ||
    message.includes("leaderboard_visible")
  );
}

export async function getCurrentLeaderboardVisibility(): Promise<boolean> {
  const user = await getCurrentUser();

  if (!user) {
    return true;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("leaderboard_visible")
    .eq("id", user.id)
    .maybeSingle<{ leaderboard_visible?: boolean }>();

  if (error) {
    if (isMissingLeaderboardVisibleColumn(error)) {
      return false;
    }

    throw error;
  }

  return data?.leaderboard_visible ?? false;
}

export async function setCurrentLeaderboardVisibility(value: boolean) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("User is not authenticated");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ leaderboard_visible: value })
    .eq("id", user.id);

  if (error) {
    if (isMissingLeaderboardVisibleColumn(error)) {
      return;
    }

    throw error;
  }
}

export async function markPendingLeaderboardConsent() {
  await AsyncStorage.setItem(PENDING_LEADERBOARD_CONSENT_KEY, "1");
}

export async function consumePendingLeaderboardConsent() {
  await AsyncStorage.removeItem(PENDING_LEADERBOARD_CONSENT_KEY);
}

export async function hasPendingLeaderboardConsent() {
  return (await AsyncStorage.getItem(PENDING_LEADERBOARD_CONSENT_KEY)) === "1";
}
