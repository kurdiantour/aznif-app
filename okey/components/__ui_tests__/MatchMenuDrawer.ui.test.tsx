import { act, render } from "@testing-library/react-native";
import { Animated } from "react-native";
import MatchMenuDrawer from "@/components/multiplayer/MatchMenuDrawer";

const mockProfiles = jest.fn();
const mockAvatar = jest.fn((_props: unknown) => null);
jest.mock("@/lib/profile", () => ({
  getHumanPlayerProfiles: (...args: unknown[]) => mockProfiles(...args),
}));
jest.mock("@/components/player/PlayerAvatar", () => ({ PlayerAvatar: (props: unknown) => mockAvatar(props) }));
jest.mock("@/lib/progression", () => ({ getRankTitleFromPoints: () => "Rank" }));

const props = {
  visible: true,
  players: [
    { id: "seat-0", name: "You", kind: "human", teamId: "teamA" },
    { id: "seat-1", name: "Bot 1", kind: "bot", teamId: "teamB" },
  ],
  translateX: new Animated.Value(0),
  onClose: jest.fn(), onLeavePress: jest.fn(),
};
beforeEach(() => { mockProfiles.mockResolvedValue(new Map()); });

test("Preview shows local players without requesting human profiles, including after reopening", () => {
  const ui = render(<MatchMenuDrawer {...props} loadHumanProfiles={false} />);
  expect(ui.getByText("You")).toBeTruthy();
  expect(ui.getByText("Bot 1")).toBeTruthy();
  ui.rerender(<MatchMenuDrawer {...props} visible={false} loadHumanProfiles={false} />);
  ui.rerender(<MatchMenuDrawer {...props} loadHumanProfiles={false} />);
  expect(mockProfiles).not.toHaveBeenCalled();
});

test("online drawer still loads real human profiles by default", async () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  render(<MatchMenuDrawer {...props} players={[{ ...props.players[0], id }, props.players[1]]} />);
  await act(async () => {});
  expect(mockProfiles).toHaveBeenCalledTimes(1);
  expect(mockProfiles).toHaveBeenCalledWith([id]);
});

test("local human avatar uses the supplied player avatar without loading profiles", () => {
  render(<MatchMenuDrawer {...props} loadHumanProfiles={false}
    players={[{ ...props.players[0], avatarId: "avatar-3", avatarUrl: "https://example.test/avatar.webp" }, props.players[1]]} />);
  expect(mockAvatar).toHaveBeenCalledWith(expect.objectContaining({
    avatarId: "avatar-3", avatarUrl: "https://example.test/avatar.webp",
  }));
  expect(mockProfiles).not.toHaveBeenCalled();
});

test("local human uses the shared avatar fallback while the profile is loading", () => {
  mockAvatar.mockClear();
  render(<MatchMenuDrawer {...props} loadHumanProfiles={false} />);
  expect(mockAvatar).toHaveBeenCalledWith(expect.objectContaining({ size: 34 }));
  expect(mockProfiles).not.toHaveBeenCalled();
});

