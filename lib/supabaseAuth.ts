import { AVATAR_IDS } from "@/types/avatar.ts";
import type { Provider, Session, User } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type Profile = {
  id: string;
  email: string | null;
  player_id: string;
  username: string;
  avatar_id: string;
  avatar_url: string | null;
  points?: number;
  games_played?: number;
  games_won?: number;
  games_lost?: number;
  is_admin?: boolean;
  is_finance_admin?: boolean;
  created_at: string;
  updated_at: string;
};

const PROFILE_SELECT =
  "id, email, player_id, username, avatar_id, avatar_url, points, games_played, games_won, games_lost, is_admin, is_finance_admin, created_at, updated_at";
const PROFILE_CREATE_RETRIES = 3;
const APP_SCHEME = "dominoapp";
const AUTH_CALLBACK_URL = `${APP_SCHEME}://auth-callback`;

function authRedirectUrl(flow: "email" | "oauth" | "recovery" = "email") {
  return `${AUTH_CALLBACK_URL}?flow=${encodeURIComponent(flow)}`;
}

function authCallbackParams(url: string) {
  const query = url.split("?")[1]?.split("#")[0] ?? "";
  const fragment = url.split("#")[1] ?? "";

  return new URLSearchParams(`${query}&${fragment}`);
}

let oauthCodeExchange:
  | {
      code: string;
      promise: Promise<Session>;
    }
  | null = null;

export async function completeAuthFromUrl(url: string) {
  const params = authCallbackParams(url);
  const code = params.get("code");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const errorCode = params.get("error_code") ?? params.get("error");
  const errorDescription = params.get("error_description");

  if (errorCode || errorDescription) {
    throw new Error(errorDescription ?? errorCode ?? "Authentication failed.");
  }

if (code) {
  if (oauthCodeExchange?.code === code) {
    return oauthCodeExchange.promise;
  }

  const exchangePromise = (async () => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    if (!session?.user) {
      throw new Error("Authentication completed without a saved session.");
    }

    return session;
  })();

  oauthCodeExchange = {
    code,
    promise: exchangePromise,
  };

  try {
    return await exchangePromise;
  } catch (error) {
    if (oauthCodeExchange?.code === code) {
      oauthCodeExchange = null;
    }

    throw error;
  }
} else if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  } else {
    throw new Error("OAuth sign-in did not return a session code.");
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;

  if (!session?.user) {
    throw new Error("OAuth sign-in completed without a saved session.");
  }

  return session;
}

function defaultUsernameForUser(userId: string, attempt: number) {
  const baseName = "user_" + userId.slice(0, 8);

  return attempt === 0 ? baseName : `${baseName}_${attempt + 1}`;
}

function usernameForUser(user: User, fullName: string | null, attempt: number) {
  if (!fullName) {
    return defaultUsernameForUser(user.id, attempt);
  }

  const normalized = fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  const baseName = normalized || defaultUsernameForUser(user.id, 0);

  return attempt === 0
    ? baseName
    : `${baseName}_${user.id.slice(0, 4)}_${attempt + 1}`;
}

const DEFAULT_PROFILE_AVATAR_IDS = AVATAR_IDS.filter(
  (avatarId) => avatarId !== "bot-avatar",
);

function randomDefaultAvatarId() {
  const index = Math.floor(Math.random() * DEFAULT_PROFILE_AVATAR_IDS.length);

  return DEFAULT_PROFILE_AVATAR_IDS[index] ?? "avatar-1";
}

function generatePlayerId() {
  return "DV-" + Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}

function oauthProfileFromUser(user: User) {
  const metadata = user.user_metadata ?? {};
  const name =
    typeof metadata.name === "string" && metadata.name.trim()
      ? metadata.name.trim()
      : null;
  const avatarUrl =
    typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()
      ? metadata.avatar_url.trim()
      : typeof metadata.picture === "string" && metadata.picture.trim()
        ? metadata.picture.trim()
        : null;

  return { name, avatarUrl };
}

export async function signUpWithEmail(email: string, password: string, username: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectUrl("email"),
      data: { username: username.trim() },
    },
  });
}

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

async function signInWithSocialProvider(provider: Provider, queryParams?: Record<string, string>) {
  const redirectTo = authRedirectUrl("oauth");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(queryParams ? { queryParams } : {}),
    },
  });

  if (error) return { data, error };

  if (!data.url) {
    return { data, error: new Error(`${provider} sign-in did not return an authorization URL.`) };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === "cancel" || result.type === "dismiss") {
    return { data, error: new Error(`${provider} sign-in was cancelled.`) };
  }

  if (result.type !== "success" || !result.url) {
    return { data, error: new Error(`${provider} sign-in did not return to the app.`) };
  }

  try {
    await completeAuthFromUrl(result.url);
  } catch (error) {
    return {
      data,
      error: error instanceof Error
        ? error
        : new Error(`${provider} sign-in session could not be created.`),
    };
  }

  return { data, error: null };
}

export async function signInWithGoogle() {
  return signInWithSocialProvider("google", {
    access_type: "offline",
    prompt: "select_account",
  });
}

export async function signInWithApple() {
  if (Platform.OS !== "ios") {
    throw new Error("Native Sign in with Apple is available only on iOS.");
  }

  const AppleAuthentication = await import("expo-apple-authentication");
  if (!(await AppleAuthentication.isAvailableAsync())) {
    throw new Error("Sign in with Apple is not available on this device.");
  }

  const rawNonce = Array.from(Crypto.getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );
  const credential = await AppleAuthentication.signInAsync({
    nonce: hashedNonce,
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error("Apple sign-in did not return an identity token.");
  }

  const result = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (result.error) return result;

  const givenName = credential.fullName?.givenName?.trim();
  const middleName = credential.fullName?.middleName?.trim();
  const familyName = credential.fullName?.familyName?.trim();
  const fullName = [givenName, middleName, familyName].filter(Boolean).join(" ");
  if (fullName) {
    const { error } = await supabase.auth.updateUser({
      data: {
        name: fullName,
        full_name: fullName,
        ...(givenName ? { given_name: givenName } : {}),
        ...(familyName ? { family_name: familyName } : {}),
      },
    });
    if (error) throw error;
  }

  return result;
}

export async function signInWithFacebook() {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return signInWithSocialProvider("facebook");
  }

  try {
    // Load the native SDK only when the Facebook action is invoked on mobile.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AccessToken, AuthenticationToken, LoginManager, Settings } = require("react-native-fbsdk-next") as typeof import("react-native-fbsdk-next");
    Settings.initializeSDK();

    if (Platform.OS === "ios") {
      const login = await LoginManager.logInWithPermissions(
        ["public_profile", "email"],
        "limited",
      );

      if (login.isCancelled) {
        return { data: null, error: new Error("Facebook sign-in was cancelled.") };
      }

      const credential = await AuthenticationToken.getAuthenticationTokenIOS();
      const idToken = credential?.authenticationToken;

      if (!idToken) {
        return {
          data: null,
          error: new Error("Facebook Limited Login did not return an ID token."),
        };
      }

      return supabase.auth.signInWithIdToken({
        provider: "facebook",
        token: idToken,
      });
    }

    const login = await LoginManager.logInWithPermissions(["public_profile", "email"]);
    if (login.isCancelled) {
      return { data: null, error: new Error("Facebook sign-in was cancelled.") };
    }

    const credential = await AccessToken.getCurrentAccessToken();
    const accessToken = credential?.accessToken;

    if (!accessToken) {
      return {
        data: null,
        error: new Error("Facebook Login did not return an access token."),
      };
    }

    return supabase.auth.signInWithIdToken({
      provider: "facebook",
      token: accessToken,
    });
  } catch (error) {
    console.warn("[auth] Native Facebook sign-in failed", error);
    return {
      data: null,
      error: error instanceof Error
        ? error
        : new Error("Native Facebook sign-in failed."),
    };
  }
}
export async function signOut(scope: "global" | "local" = "global") {
  // Complete device detachment before revoking this session.
  const { unregisterPushDevice } = await import("./notifications/devices");
  try { await unregisterPushDevice(); } catch (error) {
    console.warn("Unable to detach push installation before logout", error);
  }
  return supabase.auth.signOut({ scope });
}

export async function getCurrentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  return data.session?.user ?? null;
}

export type ProfileRequestScope = { user: User; assertCurrent: () => void };

export async function getOrCreateProfile(scope?: ProfileRequestScope): Promise<Profile | null> {
  const user = scope ? scope.user : await getCurrentUser();
  scope?.assertCurrent();
  if (!user) return null;

  const existing = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<Profile>();

  scope?.assertCurrent();
  if (existing.error) {
    throw existing.error;
  }

  if (existing.data) {
    return existing.data;
  }

  const oauthProfile = oauthProfileFromUser(user);

  for (let attempt = 0; attempt < PROFILE_CREATE_RETRIES; attempt += 1) {
    scope?.assertCurrent();
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? null,
        player_id: generatePlayerId(),
        username: usernameForUser(user, oauthProfile.name, attempt),
        avatar_id: randomDefaultAvatarId(),
        avatar_url: oauthProfile.avatarUrl,
      })
      .select(PROFILE_SELECT)
      .single<Profile>();

    scope?.assertCurrent();
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

  scope?.assertCurrent();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<Profile>();

  scope?.assertCurrent();
  if (error) {
    throw error;
  }

  return data;
}

export async function updateMyProfile(input: {
  username?: string;
  avatar_id?: string;
  avatar_url?: string | null;
}, scope?: ProfileRequestScope): Promise<Profile> {
  const user = scope ? scope.user : await getCurrentUser();
  scope?.assertCurrent();

  if (!user) {
    throw new Error("User is not authenticated");
  }

  const payload: Partial<Pick<Profile, "username" | "avatar_id" | "avatar_url">> = {};

  if (typeof input.username === "string") {
    payload.username = input.username.trim();
  }

  if (typeof input.avatar_id === "string") {
    payload.avatar_id = input.avatar_id;
    payload.avatar_url = null;
  }

  if (input.avatar_url === null || typeof input.avatar_url === "string") {
    payload.avatar_url = input.avatar_url;
  }

  scope?.assertCurrent();
  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", user.id)
    .select(PROFILE_SELECT)
    .single<Profile>();

  scope?.assertCurrent();
  if (error) throw error;

  return data;
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: authRedirectUrl("recovery"),
  });
}

export async function resendVerificationEmail(email: string) {
  return supabase.auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: authRedirectUrl("email") },
  });
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

