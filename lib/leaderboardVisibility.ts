import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getCurrentUser } from "./supabaseAuth";

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

  await AsyncStorage.setItem(
    decisionKey(user.id),
    "1",
  );
}

export async function markPendingLeaderboardConsent() {
  const user = await getCurrentUser();

  if (!user) {
    return;
  }

  const hasDecision =
    (await AsyncStorage.getItem(
      decisionKey(user.id),
    )) === "1";

  if (hasDecision || (await getCurrentLeaderboardVisibility())) {
    await consumePendingLeaderboardConsent();
    return;
  }

  await AsyncStorage.setItem(pendingConsentKey(user.id), "1");
}

export async function consumePendingLeaderboardConsent() {
  const user = await getCurrentUser();

  if (user) {
    await AsyncStorage.removeItem(pendingConsentKey(user.id));
  }

  await AsyncStorage.removeItem(PENDING_LEADERBOARD_CONSENT_KEY);
}

export async function hasPendingLeaderboardConsent() {
  const user = await getCurrentUser();

  if (!user) {
    return false;
  }

  const hasPending =
    (await AsyncStorage.getItem(pendingConsentKey(user.id))) === "1" ||
    (await AsyncStorage.getItem(PENDING_LEADERBOARD_CONSENT_KEY)) === "1";

  if (!hasPending) {
    return false;
  }

  const hasDecision =
    (await AsyncStorage.getItem(
      decisionKey(user.id),
    )) === "1";

  if (hasDecision || (await getCurrentLeaderboardVisibility())) {
    await consumePendingLeaderboardConsent();
    return false;
  }

  return true;
}
