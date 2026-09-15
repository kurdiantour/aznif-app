import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text, View } from "react-native";

let committedTransitionCb: ((transition: any) => void) | null = null;
let snapshotCb: ((snapshot: any) => void) | null = null;
let currentAdapterSnapshot: any = null;

const mockAdapter = {
  subscribe: jest.fn((cb: any) => {
    snapshotCb = cb;
    if (currentAdapterSnapshot) cb(currentAdapterSnapshot);
    return () => {
      snapshotCb = null;
    };
  }),
  subscribeCommittedTransitions: jest.fn((cb: any) => {
    committedTransitionCb = cb;
    return () => {
      committedTransitionCb = null;
    };
  }),
  getSnapshot: jest.fn(() => currentAdapterSnapshot),
  refresh: jest.fn(async () => currentAdapterSnapshot),
  dispatch: jest.fn(async () => true),
  reconnect: jest.fn(async () => undefined),
  destroy: jest.fn(),
  getServerClockOffsetMs: jest.fn(() => 0),
};

jest.mock("@/okey/adapters/supabase-okey-match-adapter", () => ({
  SupabaseOkeyMatchAdapter: jest.fn().mockImplementation(() => mockAdapter),
}));

import { useOkeyMultiplayerGame } from "../useOkeyMultiplayerGame";

function createMockProjection(options: {
  version: number;
  currentRound: number;
  phase: "playing" | "finished";
  winnerId?: string | null;
  hand?: any[];
}) {
  return {
    version: options.version,
    currentRound: options.currentRound,
    phase: options.phase,
    winnerId: options.winnerId ?? null,
    winnerTeamId: null,
    endReason: options.phase === "finished" ? "normal-meld-completion" : null,
    deckCount: 20,
    discardPile: [],
    discardOwners: [],
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: 0,
    dealerIndex: 0,
    indicatorTile: { id: "ind", color: "red", value: 1, copy: 1 },
    okeyTile: { id: "okey", color: "red", value: 2, copy: 1 },
    hasDrawnThisTurn: false,
    turnMessage: "",
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    roundResults: [
      {
        round: 1,
        winnerId: options.winnerId ?? null,
        winnerTeamId: null,
        endReason: "normal-meld-completion",
        teamAScore: 0,
        teamBScore: 100,
      },
    ],
    matchScores: { teamA: 0, teamB: 100 },
    maxRounds: 3,
    matchFinished: false,
    matchWinnerTeamId: null,
    players: [
      {
        id: "p1",
        name: "Player 1",
        teamId: "teamA",
        score: 0,
        eliminated: false,
        hand: options.hand ?? [{ id: "tile-round-1", color: "blue", value: 5, copy: 1 }],
        firstOpenScore: null,
        pendingKonkanFromDiscard: false,
        melds: [],
        avatarUrl: null,
        isBot: false,
      },
      {
        id: "p2",
        name: "Player 2",
        teamId: "teamB",
        score: 100,
        eliminated: false,
        hand: [],
        firstOpenScore: null,
        pendingKonkanFromDiscard: false,
        melds: [],
        avatarUrl: null,
        isBot: true,
      },
    ],
    turnDeadlineAt: null,
    turnDurationSeconds: 15,
  } as any;
}

function EndRoundHarness({ matchId, userId }: { matchId: string; userId: string }) {
  const game = useOkeyMultiplayerGame(matchId, userId);
  return (
    <View>
      <Text testID="stage">{game.endRoundPresentationStage}</Text>
      <Text testID="current-round">{game.currentRound}</Text>
      <Text testID="popup-visible">{game.showRoundResultPopup ? "visible" : "hidden"}</Text>
      <Text testID="hand-count">{game.state.players[0]?.hand?.length ?? 0}</Text>
      <Text testID="phase">{game.state.phase}</Text>
      <Pressable testID="btn-final-tile" onPress={() => game.beginFinalTilePresentation()} />
      <Pressable testID="btn-complete-final" onPress={() => game.completeFinalPresentation()} />
    </View>
  );
}

test("End round sequence: Final action -> Final Discard presentation completes -> Final Tile -> Score Popup -> release buffered next-round projection -> new hand", async () => {
  jest.useFakeTimers();

  const round1Playing = createMockProjection({
    version: 1,
    currentRound: 1,
    phase: "playing",
    hand: [{ id: "tile-round-1", color: "blue", value: 5, copy: 1 }],
  });
  currentAdapterSnapshot = round1Playing;

  const { getByTestId } = render(<EndRoundHarness matchId="test-match-1" userId="p1" />);
  await act(async () => {
    await Promise.resolve();
  });

  // 1. Initial active round state
  expect(getByTestId("stage").props.children).toBe("idle");
  expect(getByTestId("current-round").props.children).toBe(1);
  expect(getByTestId("popup-visible").props.children).toBe("hidden");
  expect(getByTestId("phase").props.children).toBe("playing");
  expect(getByTestId("hand-count").props.children).toBe(1);

  // 2. Final action arrives (committed transition ending the round)
  const round1Finished = createMockProjection({
    version: 2,
    currentRound: 1,
    phase: "finished",
    winnerId: "p2",
    hand: [{ id: "tile-round-1", color: "blue", value: 5, copy: 1 }],
  });
  act(() => {
    committedTransitionCb?.({
      version: 2,
      projection: round1Finished,
      actionEvents: [],
    });
  });

  // Presentation enters "draining" (waiting for flights/discards to land)
  expect(getByTestId("stage").props.children).toBe("draining");
  expect(getByTestId("popup-visible").props.children).toBe("hidden");
  expect(getByTestId("current-round").props.children).toBe(1);

  // 3. Final discard presentation completes -> begin final tile celebration
  act(() => {
    fireEvent.press(getByTestId("btn-final-tile"));
  });
  expect(getByTestId("stage").props.children).toBe("final-tile");
  expect(getByTestId("popup-visible").props.children).toBe("hidden");

  // 4. Final tile celebration completes -> enter score presentation stage
  act(() => {
    fireEvent.press(getByTestId("btn-complete-final"));
  });
  expect(getByTestId("stage").props.children).toBe("score");
  expect(getByTestId("popup-visible").props.children).toBe("visible");

  // 5. Server advances match to Round 2 in background while score popup is displayed
  const round2Playing = createMockProjection({
    version: 3,
    currentRound: 2,
    phase: "playing",
    hand: [
      { id: "tile-round-2-a", color: "red", value: 1, copy: 1 },
      { id: "tile-round-2-b", color: "red", value: 2, copy: 1 },
    ],
  });
  act(() => {
    snapshotCb?.(round2Playing);
  });

  // Client remains buffered on Round 1 score presentation!
  expect(getByTestId("stage").props.children).toBe("score");
  expect(getByTestId("popup-visible").props.children).toBe("visible");
  expect(getByTestId("current-round").props.children).toBe(1);

  // 6. Score presentation timer completes (3000ms) -> release buffer
  act(() => {
    jest.advanceTimersByTime(3_000);
  });

  // Presentation returns to idle, popup closes, Round 2 hand becomes visible
  expect(getByTestId("stage").props.children).toBe("idle");
  expect(getByTestId("popup-visible").props.children).toBe("hidden");
  expect(getByTestId("current-round").props.children).toBe(2);
  expect(getByTestId("phase").props.children).toBe("playing");
  expect(getByTestId("hand-count").props.children).toBe(2);

  jest.useRealTimers();
});
