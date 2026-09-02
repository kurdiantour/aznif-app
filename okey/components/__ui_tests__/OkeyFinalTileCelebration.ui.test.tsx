import { act, render } from "@testing-library/react-native";
import { Animated } from "react-native";

jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({
    pause: jest.fn(),
    play: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    volume: 0,
  }),
}));

import {
  OKEY_FINAL_TILE_ANIMATION_MS,
  OKEY_FINAL_TILE_HOLD_MS,
  OKEY_FINAL_TILE_PRESENTATION_MS,
  OkeyFinalTileCelebration,
} from "../OkeyFinalTileCelebration";

test("final tile completes after two seconds of animation and three seconds of hold without waiting for the native callback", () => {
  jest.useFakeTimers();
  let finishReveal: ((result: { finished: boolean }) => void) | null = null;
  const timing = jest.spyOn(Animated, "timing").mockImplementation(((_value, config) => ({
    start: (callback?: (result: { finished: boolean }) => void) => {
      if (config.duration === OKEY_FINAL_TILE_ANIMATION_MS && callback) {
        finishReveal = callback;
      }
    },
    stop: jest.fn(),
    reset: jest.fn(),
  })) as typeof Animated.timing);
  jest.spyOn(Animated, "loop").mockImplementation((() => ({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  })) as typeof Animated.loop);

  const onComplete = jest.fn();
  render(
    <OkeyFinalTileCelebration
      tile={null}
      okeyTile={{ id: "okey", color: "red", number: 1, isFake: false } as never}
      sourceRect={null}
      onComplete={onComplete}
    />,
  );

  expect(OKEY_FINAL_TILE_ANIMATION_MS).toBe(2_000);
  expect(OKEY_FINAL_TILE_HOLD_MS).toBe(3_000);
  expect(OKEY_FINAL_TILE_PRESENTATION_MS).toBe(5_000);
  expect(timing.mock.calls.some(([, config]) => config.duration === 2_000)).toBe(true);
  expect(onComplete).not.toHaveBeenCalled();

  act(() => jest.advanceTimersByTime(4_999));
  expect(onComplete).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onComplete).toHaveBeenCalledTimes(1);

  act(() => finishReveal?.({ finished: true }));
  act(() => jest.advanceTimersByTime(3_000));
  expect(onComplete).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
