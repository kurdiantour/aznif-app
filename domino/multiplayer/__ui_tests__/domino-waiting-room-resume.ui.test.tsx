import { renderHook } from "@testing-library/react-native";
import { useDominoWaitingRoom } from "../useDominoWaitingRoom";

jest.mock("@/lib/game/gameLaunchPreload", () => ({ prepareMultiplayerGameLaunch: jest.fn() }));
jest.mock("@/lib/gameInvitesProvider", () => ({ useGameParty: () => ({ party: null }) }));
jest.mock("@/lib/profile", () => ({ useProfile: () => ({ profile: null }) }));
jest.mock("@/lib/auth-state", () => ({ useAuthState: () => ({ userId: "player", authReady: true }) }));
jest.mock("@/lib/progression", () => ({ calculateLevelFromPoints: () => 1 }));
jest.mock("@/lib/supabase", () => {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: { status: "active", state: { status: "started" } }, error: null }),
    on: () => chain, subscribe: () => chain,
  };
  return { supabase: { from: () => chain, rpc: jest.fn(() => Promise.resolve({ data: { started: false }, error: null })), channel: () => chain, removeChannel: jest.fn(() => Promise.resolve()) } };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));

test("resume route skips waiting popup on its first render", () => {
  const { result } = renderHook(() => useDominoWaitingRoom({
    roomId: "existing-room", mode: "1v1", initialStatus: "matched", resumeExisting: true,
  }));
  expect(result.current.isWaiting).toBe(false);
  expect(result.current.gameplayReady).toBe(true);
});

test("normal matched matchmaking route still shows waiting popup", () => {
  const { result } = renderHook(() => useDominoWaitingRoom({
    roomId: "new-room", mode: "1v1", initialStatus: "matched",
  }));
  expect(result.current.isWaiting).toBe(true);
  expect(result.current.gameplayReady).toBe(false);
});
