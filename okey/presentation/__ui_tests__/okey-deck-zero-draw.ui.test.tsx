import { act, renderHook } from "@testing-library/react-native";
import { jest, test, expect } from "@jest/globals";

import { useOkeyPlayerTileFlightCommands } from "../useOkeyTableActions";

test("deck-zero projection submits a deck Draw without requiring a client tile placeholder", () => {
  const draw = jest.fn(async () => true);
  const setter = jest.fn();
  const input = {
    state: { deck: [], discardPile: [], players: [] },
    humanPlayer: { id: "human", hand: [], opened: false },
    topDiscard: null,
    canDraw: true,
    canDiscardTile: false,
    droppedMelds: [],
    tileFlight: null,
    deckTopRectRef: { current: null },
    discardTopRectRef: { current: null },
    drawLandingRectRef: { current: null },
    rackTileRectsRef: { current: {} },
    pendingDrawRef: { current: null },
    awaitingDiscardRemovalTileIdRef: { current: null },
    isPointInsideRack: () => false,
    isPointInsideDiscardPile: () => false,
    toLocalRect: (rect: unknown) => rect,
    draw,
    discard: jest.fn(async () => true),
    commitOpenIntent: jest.fn(async () => true),
    selectOpenAction: jest.fn(),
    dropTileOnTableMeld: jest.fn(),
    emitInvalid: jest.fn(),
    launchTileFlight: jest.fn(),
    setTileFlight: setter,
    setHiddenRackTileIds: setter,
    setHideDeckTopTile: setter,
    setHideDiscardTopTile: setter,
    setDiscardPresentationFallback: setter,
    setPresentedTopDiscard: setter,
    holdDiscardUntilAuthoritative: jest.fn(),
    releaseAuthoritativeDiscardHold: jest.fn(),
    setOptimisticRackTile: setter,
    setDiscardDropPlacement: setter,
    setSelectedTileId: setter,
    setLocalDragCommittedMeldSignatures: setter,
  } as any;
  const { result } = renderHook(() => useOkeyPlayerTileFlightCommands(input));

  act(() => {
    result.current.startDrawFlight("deck");
  });

  expect(draw).toHaveBeenCalledWith("deck");
});