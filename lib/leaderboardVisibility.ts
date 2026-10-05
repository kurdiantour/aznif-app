import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAuthState } from "./auth-state";
import { supabase } from "./supabase";

export const PENDING_LEADERBOARD_CONSENT_KEY =
  "domino_pending_leaderboard_consent";

const LEADERBOARD_CONSENT_DECISION_KEY_PREFIX =
  "domino_leaderboard_consent_decision";

function pendingConsentKey(userId: string) {
  return `${PENDING_LEADERBOARD_CONSENT_KEY}:${userId}`;
}

function decisionKey(userId: string) {
  return `${LEADERBOARD_CONSENT_DECISION_KEY_PREFIX}:${userId}`;
}

export async function claimNewAccountLeaderboardConsent() {
  const { data, error } = await supabase.rpc(
    "claim_new_account_leaderboard_consent",
  );

  if (error) throw error;
  if (data !== true) return false;

  await markPendingLeaderboardConsent();
  return true;
}

function isMissingLeaderboardVisibleColumn(error: unknown) {
  const nextError = error as {
    code?: string;
    message?: string;
  } | null;

  const message =
    nextError?.message?.toLowerCase() ?? "";

  return (
    nextError?.code === "42703" ||
    nextError?.code === "PGRST204" ||
    message.includes("leaderboard_visible")
  );
}

export async function getCurrentLeaderboardVisibility(): Promise<boolean> {
  const userId = getAuthState().userId;

  if (!userId) {
    return true;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("leaderboard_visible")
    .eq("id", userId)
    .maybeSingle<{
      leaderboard_visible?: boolean;
    }>();

  if (error) {
    if (isMissingLeaderboardVisibleColumn(error)) {
      return false;
    }

    throw error;
  }

  return data?.leaderboard_visible ?? false;
}

export async function setCurrentLeaderboardVisibility(
  value: boolean,
) {
  const userId = getAuthState().userId;

  if (!userId) {
    throw new Error("User is not authenticated");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      leaderboard_visible: value,
    })
    .eq("id", userId);

  if (error) {
    if (isMissingLeaderboardVisibleColumn(error)) {
      return;
    }

    throw error;
  }

  await AsyncStorage.setItem(
    decisionKey(userId),
    "1",
  );
}

export async function markPendingLeaderboardConsent() {
  const userId = getAuthState().userId;

  if (!userId) {
    return;
  }

  const hasDecision =
    (await AsyncStorage.getItem(
      decisionKey(userId),
    )) === "1";

  if (
    hasDecision ||
    (await getCurrentLeaderboardVisibility())
  ) {
    await consumePendingLeaderboardConsent();
    return;
  }

  await AsyncStorage.setItem(
    pendingConsentKey(userId),
    "1",
  );
}

export async function consumePendingLeaderboardConsent() {
  const userId = getAuthState().userId;

  if (userId) {
    await AsyncStorage.removeItem(
      pendingConsentKey(userId),
    );
  }

  await AsyncStorage.removeItem(
    PENDING_LEADERBOARD_CONSENT_KEY,
  );
}

export async function hasPendingLeaderboardConsent() {
  const userId = getAuthState().userId;

  if (!userId) {
    return false;
  }

  const hasPending =
    (await AsyncStorage.getItem(
      pendingConsentKey(userId),
    )) === "1" ||
    (await AsyncStorage.getItem(
      PENDING_LEADERBOARD_CONSENT_KEY,
    )) === "1";

  if (!hasPending) {
    return false;
  }

  const hasDecision =
    (await AsyncStorage.getItem(
      decisionKey(userId),
    )) === "1";

  if (
    hasDecision ||
    (await getCurrentLeaderboardVisibility())
  ) {
    await consumePendingLeaderboardConsent();
    return false;
  }

  return true;
}