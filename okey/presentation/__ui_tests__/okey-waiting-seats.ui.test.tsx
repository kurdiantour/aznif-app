import { renderHook } from "@testing-library/react-native";
import { createInitialOkeyGame } from "@/okey/engine/okey-engine";
import { useOkeyTableViewModel } from "../useOkeyTablePresentation";
import type { OkeyRoomSnapshot } from "@/okey/multiplayer/okey-room-api";

const members = [0, 1, 2, 3].map(playerIndex => ({
  userId: `00000000-0000-0000-0000-00000000000${playerIndex}`,
  displayName: `Player ${playerIndex}`, playerIndex,
  teamId: "teamA" as const, avatarUrl: null, connected: true,
}));
const state = createInitialOkeyGame();
const room = { matchId: "room", status: "waiting", members } as OkeyRoomSnapshot;
const input = (local: number, waitingRoom: OkeyRoomSnapshot | null = room): Parameters<typeof useOkeyTableViewModel>[0] => ({
  state, currentUserId: members[local].userId, onlineProjection: null, waitingRoom,
  presentedTablePlayers: state.players, stableOpponentTileCounts: {}, onlineGameplayReady: false,
  turnPlayerIndex: null, turnPlayerId: null, turnPhase: null, turnDeadlineAt: null,
  turnDurationSeconds: null, turnTimeLeftMilliseconds: 0, serverClockOffsetMs: 0,
  currentRoundResult: null, roundResults: [], matchScores: { teamA: 0, teamB: 0 },
  matchWinnerTeamId: null, showMatchResultPopup: false, matchFinished: false,
});

test.each([0, 1, 2, 3])("Waiting uses real membership indices relative to local seat %i without a game projection", local => {
  const shuffled = { ...room, members: [...members].reverse() };
  const { result } = renderHook(() => useOkeyTableViewModel(input(local, shuffled)));
  for (const [side, offset] of [["top", 2], ["left", 3], ["right", 1]] as const) {
    const index = (local + offset) % 4;
    expect(result.current.opponentSeats.find(seat => seat.side === side)).toMatchObject({
      id: members[index].userId, name: members[index].displayName, playerIndex: index,
      count: 0, active: false,
    });
  }
});

test("leave clears only that seat and rejoin uses the new real user id", () => {
  const ui = renderHook(({ waitingRoom }: { waitingRoom: OkeyRoomSnapshot }) => useOkeyTableViewModel(input(0, waitingRoom)), {
    initialProps: { waitingRoom: room },
  });
  const top = () => ui.result.current.opponentSeats.find(seat => seat.side === "top")!;
  ui.rerender({ waitingRoom: { ...room, members: members.filter(member => member.playerIndex !== 2) } });
  expect(top()).toMatchObject({ id: undefined, name: "", playerIndex: 2 });
  const replacement = { ...members[2], userId: "new-real-user", displayName: "New player" };
  ui.rerender({ waitingRoom: { ...room, members: [members[0], members[1], replacement, members[3]] } });
  expect(top()).toMatchObject({ id: "new-real-user", name: "New player", playerIndex: 2 });
});

test("cleared room has empty seats, never synthetic cosmetics identities", () => {
  const ui = renderHook(({ waitingRoom }: { waitingRoom: OkeyRoomSnapshot | null }) =>
    useOkeyTableViewModel(input(0, waitingRoom)), { initialProps: { waitingRoom: room as OkeyRoomSnapshot | null } });
  ui.rerender({ waitingRoom: null });
  expect(ui.result.current.opponentSeats.every(seat => seat.id === undefined && seat.name === "")).toBe(true);
});
