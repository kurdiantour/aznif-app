import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type TimerRef = MutableRefObject<ReturnType<typeof setTimeout> | null>;
type IntervalRef = MutableRefObject<ReturnType<typeof setInterval> | null>;

export function clearRoundPhaseTimers(
  phaseTimerRef: TimerRef,
  countdownIntervalRef: IntervalRef,
) {
  if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
  if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
  phaseTimerRef.current = null;
  countdownIntervalRef.current = null;
}

export function scheduleRoundCountdown({
  phaseTimerRef,
  countdownIntervalRef,
  revealMs,
  countdownSeconds,
  setCountdown,
  onCountdownStart,
  onCountdownComplete,
}: {
  phaseTimerRef: TimerRef;
  countdownIntervalRef: IntervalRef;
  revealMs: number;
  countdownSeconds: number;
  setCountdown: Dispatch<SetStateAction<number>>;
  onCountdownStart: () => void;
  onCountdownComplete: () => void;
}) {
  clearRoundPhaseTimers(phaseTimerRef, countdownIntervalRef);

  phaseTimerRef.current = setTimeout(() => {
    phaseTimerRef.current = null;
    onCountdownStart();
    setCountdown(countdownSeconds);

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          onCountdownComplete();
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }, revealMs);
}
