import { expect, jest, test } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Animated } from "react-native";
import { OkeyTurnTimerBar } from "../OkeyTurnTimerBar";

test("turn timer renders with accessibility role and remaining time when active and visible", () => {
  const deadline = new Date(Date.now() + 10_000).toISOString();
  const { getByRole } = render(
    <OkeyTurnTimerBar
      active={true}
      visible={true}
      deadlineAt={deadline}
      serverClockOffsetMs={0}
      remainingMilliseconds={9_500}
      durationSeconds={15}
      phase="draw"
    />,
  );

  const timer = getByRole("timer");
  expect(timer).toBeTruthy();
  expect(timer.props.accessibilityLabel).toContain("10 چرکە");
});

test("inactive timer is hidden from accessibility", () => {
  const { queryByRole } = render(
    <OkeyTurnTimerBar
      active={false}
      visible={true}
      deadlineAt={null}
      serverClockOffsetMs={0}
      remainingMilliseconds={0}
      durationSeconds={15}
      phase="throw"
    />,
  );

  expect(queryByRole("timer")).toBeNull();
});

test("timing animation is initiated with serverClockOffsetMs-adjusted deadline", () => {
  const timingSpy = jest.spyOn(Animated, "timing");
  const now = 1_000_000;
  jest.spyOn(Date, "now").mockReturnValue(now);

  // Server clock is +1000ms relative to client, deadline is at now + 8000ms
  // Expected timeLeft = 8000 - 1000 = 7000ms
  const serverOffset = 1_000;
  const deadline = new Date(now + 8_000).toISOString();

  render(
    <OkeyTurnTimerBar
      active={true}
      visible={true}
      deadlineAt={deadline}
      serverClockOffsetMs={serverOffset}
      remainingMilliseconds={7_000}
      durationSeconds={10}
      phase="draw"
    />,
  );

  const timerCall = timingSpy.mock.calls.find(
    (call) => (call[1] as any)?.duration === 7_000,
  );
  expect(timerCall).toBeDefined();
  timingSpy.mockRestore();
});

test("phase change from draw to throw triggers transition animation", () => {
  const timingSpy = jest.spyOn(Animated, "timing");

  const { rerender } = render(
    <OkeyTurnTimerBar
      active={true}
      visible={true}
      deadlineAt={new Date(Date.now() + 10_000).toISOString()}
      serverClockOffsetMs={0}
      remainingMilliseconds={10_000}
      durationSeconds={15}
      phase="draw"
    />,
  );

  timingSpy.mockClear();

  rerender(
    <OkeyTurnTimerBar
      active={true}
      visible={true}
      deadlineAt={new Date(Date.now() + 10_000).toISOString()}
      serverClockOffsetMs={0}
      remainingMilliseconds={10_000}
      durationSeconds={15}
      phase="throw"
    />,
  );

  const phaseTransitionCall = timingSpy.mock.calls.find(
    (call) => (call[1] as any)?.duration === 220 && (call[1] as any)?.toValue === 0,
  );
  expect(phaseTransitionCall).toBeDefined();
  timingSpy.mockRestore();
});
