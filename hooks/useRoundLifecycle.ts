import type { RoundPhase, RoundResult, TeamId } from '@/types/game';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NEXT_ROUND_COUNTDOWN_SECONDS,
  BLOCKED_RESULT_REVEAL_MS,
  ROUND_RESULT_REVEAL_MS,
} from './gameShared';
import { clearRoundPhaseTimers, scheduleRoundCountdown } from './roundPhaseTimers';

export function useRoundLifecycle({
  roundWinnerPlayerId,
  winningTeamId,
  buildRoundResult,
  startNextRound,
}: {
  roundWinnerPlayerId: string | null;
  winningTeamId: TeamId | null;
  buildRoundResult: (winnerId: string) => RoundResult | null;
  startNextRound: () => void | Promise<void>;
}) {
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduledRoundKeyRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState(
    NEXT_ROUND_COUNTDOWN_SECONDS,
  );

  const resetRoundPresentation = useCallback(() => {
    clearRoundPhaseTimers(phaseTimerRef, countdownIntervalRef);
    scheduledRoundKeyRef.current = null;
    setRoundResult(null);
    setNextRoundCountdown(NEXT_ROUND_COUNTDOWN_SECONDS);
    setPhase('playing');
  }, []);

  useEffect(() => resetRoundPresentation, [resetRoundPresentation]);

  useEffect(() => {
    if (!roundWinnerPlayerId) {
      resetRoundPresentation();
      return;
    }

    const scheduleKey = `${roundWinnerPlayerId}:${winningTeamId ?? 'next'}`;
    if (scheduledRoundKeyRef.current === scheduleKey) return;

    const result = buildRoundResult(roundWinnerPlayerId);
    if (!result) return;

    clearRoundPhaseTimers(phaseTimerRef, countdownIntervalRef);
    scheduledRoundKeyRef.current = scheduleKey;
    setRoundResult(result);
    setPhase('round_result_reveal');

    if (winningTeamId) {
      phaseTimerRef.current = setTimeout(() => {
        setPhase('playing');
      }, result.endReason === 'blocked' ? BLOCKED_RESULT_REVEAL_MS : ROUND_RESULT_REVEAL_MS);
      return;
    }

    scheduleRoundCountdown({
      phaseTimerRef,
      countdownIntervalRef,
      revealMs:
        result.endReason === 'blocked'
          ? BLOCKED_RESULT_REVEAL_MS
          : ROUND_RESULT_REVEAL_MS,
      countdownSeconds: NEXT_ROUND_COUNTDOWN_SECONDS,
      setCountdown: setNextRoundCountdown,
      onCountdownStart: () => setPhase('next_round_countdown'),
      onCountdownComplete: () => {
        setPhase('dealing');
        void Promise.resolve(startNextRound()).finally(resetRoundPresentation);
      },
    });
  }, [
    buildRoundResult,
    resetRoundPresentation,
    roundWinnerPlayerId,
    startNextRound,
    winningTeamId,
  ]);

  return { phase, roundResult, nextRoundCountdown, resetRoundPresentation };
}
