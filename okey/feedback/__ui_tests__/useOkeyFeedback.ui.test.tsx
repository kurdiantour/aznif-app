import { expect, jest, test } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { AppState, Pressable, Text } from "react-native";

const mockAudioPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
};
const mockImpactAsync = jest.fn(() => Promise.resolve());
const mockNotificationAsync = jest.fn(() => Promise.resolve());

jest.mock("expo-audio", () => ({
  useAudioPlayer: () => mockAudioPlayer,
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Error: "error", Success: "success", Warning: "warning" },
  impactAsync: mockImpactAsync,
  notificationAsync: mockNotificationAsync,
}));
import { saveOkeyFeedbackPreferences } from "../okey-feedback-preferences";
import { useOkeyFeedback } from "../../hooks/useOkeyFeedback";

function Harness() {
  const { emitFeedback } = useOkeyFeedback();
  return (
    <>
      <Pressable testID="same" onPress={() => emitFeedback("rack-select", "select:1")} />
      <Pressable testID="next" onPress={() => emitFeedback("invalid", "invalid:1")} />
      <Text>feedback</Text>
    </>
  );
}

test("feedback plays once, stops in background and cleans audio and listener on unmount", async () => {
  await saveOkeyFeedbackPreferences({ soundEnabled: true, hapticsEnabled: true });
  jest.spyOn(AppState, "currentState", "get").mockReturnValue("active");
  let appStateListener: ((state: "active" | "background") => void) | null = null;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_type, listener) => {
    appStateListener = listener as typeof appStateListener;
    return { remove };
  }) as typeof AppState.addEventListener);

  const view = render(<Harness />);
  fireEvent.press(view.getByTestId("same"));
  fireEvent.press(view.getByTestId("same"));
  await act(async () => { await Promise.resolve(); });
  expect(mockAudioPlayer.play).toHaveBeenCalledTimes(1);

  act(() => appStateListener?.("background"));
  fireEvent.press(view.getByTestId("next"));
  await act(async () => { await Promise.resolve(); });
  expect(mockNotificationAsync).not.toHaveBeenCalled();

  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mockAudioPlayer.pause).toHaveBeenCalled();
});
