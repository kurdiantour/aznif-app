import type { ScreenRect, TileFlight } from "@/okey/presentation/okey-game-presentation";
import type { OkeyGameState, OkeyTile } from "@/okey/types/okey";
import { expect, test } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useOkeyOpponentTileFlightCoordinator } from "../useOkeyTileFlightCoordinator";

function dummyState(): OkeyGameState {
  return {
    players: [
      { id: "human", name: "Me", kind: "human", teamId: "teamA", hand: [], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false, konkanEntryReason: null, pendingKonkanFromDiscard: false, eliminated: false },
      { id: "opponent", name: "Opponent", kind: "bot", teamId: "teamB", hand: [], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false, konkanEntryReason: null, pendingKonkanFromDiscard: false, eliminated: false },
    ],
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: 1,
    dealerIndex: 0,
    deck: [],
    discardPile: [{ id: "tile-d1", color: "red", value: 5, copy: 1 }],
    discardOwners: [{ playerId: "opponent", playerIndex: 1 }],
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    indicatorTile: { id: "ind", color: "blue", value: 1, copy: 1 },
    okeyTile: { id: "okey", color: "blue", value: 2, copy: 1 },
    phase: "playing",
    winnerId: null,
    endReason: null,
    turnMessage: { code: "draw-tile", playerName: "Opponent" },
    hasDrawnThisTurn: false,
  };
}

function dummyProjection(version: number, discardPile: OkeyTile[] = []) {
  return {
    version,
    currentRound: 1,
    phase: "playing",
    players: [
      { id: "human", name: "Me", kind: "human", teamId: "teamA", hand: [], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false, konkanEntryReason: null, pendingKonkanFromDiscard: false, eliminated: false },
      { id: "opponent", name: "Opponent", kind: "bot", teamId: "teamB", hand: [], opened: false, melds: [], scoreOpened: 0, firstOpenScore: null, konkan: false, konkanEntryReason: null, pendingKonkanFromDiscard: false, eliminated: false },
    ],
    deckCount: 20,
    discardPile,
    discardOwners: discardPile.map(() => ({ playerId: "opponent", playerIndex: 1 })),
    stagingMelds: [],
    teamFirstOpenScores: { teamA: null, teamB: null },
    currentPlayerIndex: 1,
    dealerIndex: 0,
    indicatorTile: { id: "ind", color: "blue", value: 1, copy: 1 },
    okeyTile: { id: "okey", color: "blue", value: 2, copy: 1 },
    hasDrawnThisTurn: false,
    turnMessage: { code: "draw-tile", playerName: "Opponent" },
    konkanDiscardPickCounts: {},
    mustFinishAfterSecondKonkanDiscardPickPlayerId: null,
    reshuffleCount: 0,
    roundResults: [],
    matchScores: { teamA: 0, teamB: 0 },
    maxRounds: 3,
    matchFinished: false,
    matchWinnerTeamId: null,
    turnDeadlineAt: null,
    turnDurationSeconds: 15,
  } as any;
}

test("FIFO opponent queue: actions execute sequentially in FIFO order without skipping or reordering", () => {
  let transitionListener: (transition: any) => void = () => { throw new Error("Transition listener was not registered"); };
  const mockAdapter = {
    subscribeCommittedTransitions: (cb: any) => {
      transitionListener = cb;
      return () => undefined;
    },
  } as any;

  const launchedFlights: TileFlight[] = [];

  function CoordinatorHarness() {
    const [currentFlight, setCurrentFlight] = useState<TileFlight | null>(null);
    const [state, setState] = useState(dummyState);
    const [projectionVersion, setProjectionVersion] = useState<number>(2);

    const deckRectRef = useRef<ScreenRect | null>({ x: 50, y: 50, width: 40, height: 60 });
    const discardRectRef = useRef<ScreenRect | null>({ x: 150, y: 50, width: 40, height: 60 });
    const opponentSeatRectsRef = useRef<Record<string, ScreenRect>>({
      opponent: { x: 250, y: 50, width: 80, height: 60 },
    });
    const rackRectRef = useRef<ScreenRect | null>({ x: 50, y: 300, width: 300, height: 80 });
    const activePresentationRef = useRef<any>({
      onlineTimeout: null,
      completedTimeoutEventId: null,
      resetOpponent: null,
      resetTimeout: null,
    });

    const coordinator = useOkeyOpponentTileFlightCoordinator({
      state,
      adapter: mockAdapter,
      projectionVersion,
      tileFlight: currentFlight,
      deckTopRectRef: deckRectRef,
      discardTopRectRef: discardRectRef,
      opponentSeatRectsRef,
      rackRectRef,
      activePresentationRef,
      setPresentedPlayers: (players) => {
        setState((prev) => ({
          ...prev,
          players,
        }));
      },
      launchTileFlight: ({ flight }) => {
        launchedFlights.push(flight);
        setCurrentFlight(flight);
      },
      toLocalRect: (r) => r,
    });

    return (
      <View>
        <Text testID="has-queued">{coordinator.hasQueuedPresentation ? "yes" : "no"}</Text>
        <Text testID="flight-id">{currentFlight?.id ?? "none"}</Text>
        <Pressable
          testID="complete-flight"
          onPress={() => {
            const completed = currentFlight;
            setCurrentFlight(null);
            coordinator.completeOpponentPresentationFlight(completed);
            coordinator.startNextQueuedPresentation();
          }}
        />
      </View>
    );
  }

  const { getByTestId } = render(<CoordinatorHarness />);

  // Initially empty
  expect(getByTestId("has-queued").props.children).toBe("no");
  expect(getByTestId("flight-id").props.children).toBe("none");

  // A committed transition arrives containing both a Draw event and a Discard event
  const discardTile: OkeyTile = { id: "tile-d2", color: "yellow", value: 7, copy: 1 };
  const proj = dummyProjection(2, [discardTile]);

  act(() => {
    transitionListener?.({
      version: 2,
      projection: proj,
      actionEvents: [
        {
          eventId: "draw-1",
          type: "draw",
          actorPlayerId: "opponent",
          version: 2,
          sequence: 1,
          payload: { source: "deck" },
        },
        {
          eventId: "discard-2",
          type: "discard",
          actorPlayerId: "opponent",
          version: 2,
          sequence: 2,
          payload: { tileId: "tile-d2", tile: discardTile },
        },
      ],
    });
  });

  // 1. First event (Draw) was launched
  expect(launchedFlights.length).toBe(1);
  expect(launchedFlights[0].id).toContain("opponent-draw");
  expect(getByTestId("flight-id").props.children).toContain("opponent-draw");

  // 2. Second event (Discard) is held in queue while Draw flight is playing
  expect(getByTestId("has-queued").props.children).toBe("yes");

  // 3. Draw flight completes -> automatically triggers next event (Discard)
  act(() => {
    fireEvent.press(getByTestId("complete-flight"));
  });

  // 4. Second event (Discard) is now launched
  expect(launchedFlights.length).toBe(2);
  expect(launchedFlights[1].id).toContain("opponent-discard");
  expect(getByTestId("flight-id").props.children).toContain("opponent-discard");
  expect(getByTestId("has-queued").props.children).toBe("no");

  // 5. Complete Discard flight
  act(() => {
    fireEvent.press(getByTestId("complete-flight"));
  });

  expect(getByTestId("flight-id").props.children).toBe("none");
  expect(getByTestId("has-queued").props.children).toBe("no");
});

