import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";

const mockNativeModuleLoad = jest.fn();
const mockInitializeSDK = jest.fn();
const mockLogin = jest.fn<(...args: unknown[]) => Promise<{ isCancelled: boolean }>>();
const mockCredential = jest.fn<() => Promise<{ authenticationToken: string } | null>>();
const mockIdTokenSignIn = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: null }>>();
const mockOAuthSignIn = jest.fn<(...args: unknown[]) => Promise<{ data: { url: string | null }; error: null }>>();
const mockOpenAuthSession = jest.fn<(...args: unknown[]) => Promise<{ type: "cancel" }>>();

jest.mock("react-native-fbsdk-next", () => {
  mockNativeModuleLoad();
  return {
  Settings: { initializeSDK: () => mockInitializeSDK() },
  LoginManager: { logInWithPermissions: (...args: unknown[]) => mockLogin(...args) },
  AuthenticationToken: { getAuthenticationTokenIOS: () => mockCredential() },
  };
});

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: unknown[]) => mockIdTokenSignIn(...args),
      signInWithOAuth: (...args: unknown[]) => mockOAuthSignIn(...args),
    },
  },
}));

// Jest must register the native module mocks before loading the auth module.
// eslint-disable-next-line import/first
import { signInWithFacebook } from "@/lib/supabaseAuth";

describe("Facebook sign-in platform routing", () => {
  it("does not load the native SDK while importing auth helpers", () => {
    expect(mockNativeModuleLoad).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mockInitializeSDK.mockReset();
    mockLogin.mockReset();
    mockCredential.mockReset();
    mockIdTokenSignIn.mockReset();
    mockOAuthSignIn.mockReset();
    mockOpenAuthSession.mockReset();
  });

  it("passes the iOS Limited Login ID token to Supabase Auth", async () => {
    const previousOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    try {
      mockLogin.mockResolvedValue({ isCancelled: false });
      mockCredential.mockResolvedValue({ authenticationToken: "facebook-oidc-token" });
      mockIdTokenSignIn.mockResolvedValue({ data: { session: {} }, error: null });

      const result = await signInWithFacebook();

      expect(result.error).toBeNull();
      expect(mockInitializeSDK).toHaveBeenCalledTimes(1);
      expect(mockLogin).toHaveBeenCalledWith(["public_profile", "email"], "limited");
      expect(mockIdTokenSignIn).toHaveBeenCalledWith({
        provider: "facebook",
        token: "facebook-oidc-token",
      });
      expect(result.error).toBeNull();
      expect(mockOAuthSignIn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: previousOS });
    }
  });

  it("keeps Android on the existing OAuth path", async () => {
    const previousOS = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    try {
      mockOAuthSignIn.mockResolvedValue({ data: { url: "https://example.com/oauth" }, error: null });
      mockOpenAuthSession.mockResolvedValue({ type: "cancel" });

      await signInWithFacebook();

      expect(mockOAuthSignIn).toHaveBeenCalledWith({
        provider: "facebook",
        options: {
          redirectTo: "dominoapp://auth-callback?flow=oauth",
          skipBrowserRedirect: true,
        },
      });
      expect(mockLogin).not.toHaveBeenCalled();
      expect(mockIdTokenSignIn).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: previousOS });
    }
  });
});