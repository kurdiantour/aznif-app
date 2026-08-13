import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type {
  AuthChangeEvent,
  Session,
  User,
} from "@supabase/supabase-js";
import type { ReactNode } from "react";

type AuthStateListener = (
  event: AuthChangeEvent,
  session: Session | null
) => void;

const mockGetSession = jest.fn<
  () => Promise<{
    data: { session: Session | null };
    error: null;
  }>
>();

const mockGetCurrentUser = jest.fn<() => Promise<User | null>>();

const mockGetOrCreateProfile = jest.fn<() => Promise<never>>();

let mockAuthStateListener: AuthStateListener | null = null;

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (listener: AuthStateListener) => {
        mockAuthStateListener = listener;

        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      },
    },
  },
}));

jest.mock("@/lib/supabaseAuth", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  getOrCreateProfile: () => mockGetOrCreateProfile(),
  updateMyProfile: jest.fn(),
}));

jest.mock("@/lib/progression", () => ({
  calculateLevelFromPoints: jest.fn(() => 1),
}));

import * as profileModule from "@/lib/profile";

const user: User = {
  id: "user-1",
  aud: "authenticated",
  email: "user@example.com",
  created_at: "2026-08-13T00:00:00.000Z",
  app_metadata: {},
  user_metadata: {},
};

const session: Session = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  token_type: "bearer",
  user,
};

const refreshedSession: Session = {
  ...session,
  access_token: "access-2",
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <profileModule.ProfileProvider>
      {children}
    </profileModule.ProfileProvider>
  );
}

describe("ProfileProvider auth lifecycle", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    mockAuthStateListener = null;
    mockGetSession.mockReset();
    mockGetCurrentUser.mockReset();
    mockGetOrCreateProfile.mockReset();

    mockGetCurrentUser.mockResolvedValue(user);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("restores a persisted session on a fresh app mount", async () => {
    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    mockGetOrCreateProfile.mockRejectedValue(
      new Error("offline profile request")
    );

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });

    expect(result.current.session).toEqual(session);
  });

  it("keeps the session when profile loading fails offline", async () => {
    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    mockGetOrCreateProfile.mockRejectedValue(
      new Error("network unavailable")
    );

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toEqual(session);
    expect(result.current.profile).toBeNull();
  });

  it("keeps the session after the profile timeout", async () => {
    jest.useFakeTimers();

    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    mockGetOrCreateProfile.mockReturnValue(
      new Promise<never>(() => undefined)
    );

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
    });

    expect(result.current.session).toEqual(session);
    expect(result.current.profile).toBeNull();
  });

  it("accepts a refreshed token without resetting profile auth", async () => {
    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    mockGetOrCreateProfile.mockRejectedValue(
      new Error("profile unavailable")
    );

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });

    act(() => {
      mockAuthStateListener?.("TOKEN_REFRESHED", refreshedSession);
    });

    expect(result.current.session?.access_token).toBe("access-2");
  });

  it("becomes anonymous only after a real signed-out event", async () => {
    mockGetSession.mockResolvedValue({
      data: { session },
      error: null,
    });

    mockGetOrCreateProfile.mockRejectedValue(
      new Error("profile unavailable")
    );

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });

    act(() => {
      mockAuthStateListener?.("SIGNED_OUT", null);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it("reports a storage/auth restore error instead of anonymous success", async () => {
    const restoreError = new Error("storage read failed");

    mockGetSession.mockRejectedValue(restoreError);

    const { result } = renderHook(
      () => profileModule.useProfile(),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.authLoading).toBe(false);
    });

    expect(result.current.authError).toBe(restoreError);
    expect(result.current.session).toBeNull();
  });
});