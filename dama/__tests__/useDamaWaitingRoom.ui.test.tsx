import { act, renderHook } from "@testing-library/react-native";
import { useDamaWaitingRoom } from "@/dama/multiplayer/useDamaWaitingRoom";

const mockRouter = { replace: jest.fn() };
const mockCancel = jest.fn();
const mockGetStatus = jest.fn();
const mockJoin = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/dama/dama-adapter", () => ({
  cancelDamaMatchmaking: (...args: unknown[]) => mockCancel(...args),
  getDamaWaitingStatus: (...args: unknown[]) => mockGetStatus(...args),
  joinDamaMatchmaking: (...args: unknown[]) => mockJoin(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test("resumes the requested room without starting a new matchmaking request", async () => {
  mockGetStatus.mockResolvedValue({ status: "active", roomId: "resume-room" });

  const { result, unmount } = renderHook(() =>
    useDamaWaitingRoom({ enabled: true, roomId: "resume-room" }),
  );
  await act(async () => { await Promise.resolve(); });

  expect(mockGetStatus).toHaveBeenCalledWith("resume-room");
  expect(mockJoin).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({
    currentRoomId: "resume-room",
    gameplayReady: true,
    isWaiting: false,
  });
  unmount();
});

test("shows a waiting room and transitions into its active match", async () => {
  jest.useFakeTimers();
  mockJoin
    .mockResolvedValueOnce({ status: "searching", entryFee: 500 })
    .mockResolvedValueOnce({
      status: "waiting",
      roomId: "new-room",
      entryFee: 500,
      countdownEndsAt: "2026-10-10T20:00:00Z",
    });
  mockGetStatus.mockResolvedValue({ status: "active", roomId: "new-room" });

  const { result, unmount } = renderHook(() =>
    useDamaWaitingRoom({ enabled: true }),
  );
  try {
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toMatchObject({ isWaiting: true, canCancel: true });

    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(result.current).toMatchObject({
      currentRoomId: "new-room",
      isWaiting: true,
      canCancel: false,
    });

    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(mockGetStatus).toHaveBeenCalledWith("new-room");
    expect(result.current).toMatchObject({
      currentRoomId: "new-room",
      gameplayReady: true,
      isWaiting: false,
    });
  } finally {
    unmount();
    jest.useRealTimers();
  }
});
