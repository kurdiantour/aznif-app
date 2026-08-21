import { useEffect } from 'react';

export function useAiPracticeTurnLifecycle(input: {
  timeLeft: number;
  terminal: boolean;
  pausedForDraw: boolean;
  durationSeconds: number;
  setTimeLeft: (update: (previous: number) => number) => void;
  onExpired: () => void;
}) {
  useEffect(() => {
    if (input.terminal || input.pausedForDraw) return;
    const timer = setTimeout(() => {
      input.setTimeLeft((previous) => {
        if (previous <= 1) {
          input.onExpired();
          return input.durationSeconds;
        }
        return previous - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    input.timeLeft,
    input.terminal,
    input.pausedForDraw,
    input.durationSeconds,
    input.setTimeLeft,
    input.onExpired,
  ]);
}
