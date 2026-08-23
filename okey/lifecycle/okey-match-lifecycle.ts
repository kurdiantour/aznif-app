import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import { resolveTimeoutTurn } from "@/okey/engine/okey-timeout";
import { ROUND_RESULT_COUNTDOWN_SECONDS, settleFinishedRound, type OkeyMatchState } from "@/okey/match/okey-match-state";

export const OKEY_TURN_DEADLINE_MS =
  OKEY_RULESET_V1.match.turnDurationSeconds * 1000;
export const OKEY_FINISH_REVEAL_MS = 5_350;

export type OkeyResumeResult = { match: OkeyMatchState; turnExpired: boolean };

/** Reconciles one suspended phase without simulating a chain of turns. */
export function reconcileOkeyMatchAfterInterruption(match: OkeyMatchState, elapsedMs: number): OkeyResumeResult {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (match.showFinishRevealPopup) {
    if (safeElapsedMs < OKEY_FINISH_REVEAL_MS) return { match, turnExpired: false };
    const resultElapsedSeconds = Math.floor((safeElapsedMs - OKEY_FINISH_REVEAL_MS) / 1000);
    return { match: { ...match, showFinishRevealPopup: false, showRoundResultPopup: true, roundResultCountdownRemaining: Math.max(0, ROUND_RESULT_COUNTDOWN_SECONDS - resultElapsedSeconds) }, turnExpired: false };
  }
  if (match.showRoundResultPopup && match.roundResultCountdownRemaining !== null) {
    return { match: { ...match, roundResultCountdownRemaining: Math.max(0, match.roundResultCountdownRemaining - Math.floor(safeElapsedMs / 1000)) }, turnExpired: false };
  }
  if (match.matchFinished || match.roundState.phase !== "playing" || safeElapsedMs < OKEY_TURN_DEADLINE_MS) return { match, turnExpired: false };
  const roundState = resolveTimeoutTurn(match.roundState, match.roundState.currentPlayerIndex);
  if (roundState === match.roundState) return { match, turnExpired: false };
  return { match: settleFinishedRound({ ...match, roundState }), turnExpired: true };
}

