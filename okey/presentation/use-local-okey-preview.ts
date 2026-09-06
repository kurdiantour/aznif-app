import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chooseBotDrawSource, prepareBotTurn } from "@/okey/engine/okey-bot-engine";
import {
  canLockKonkanSet,
  createInitialOkeyGame,
  declareKonkanOpen,
  discardTile,
  drawTile,
  getMatchWinnerTeamId,
  getRoundResultScoreDetails,
  getRoundResultTeamScores,
  lockKonkanSet,
  openPlayerMelds,
  spendTileOnMeld,
} from "@/okey/engine/okey-engine";
import type { OkeyRoundResult } from "@/okey/hooks/useOkeyMultiplayerGame";
import type { OkeyMatchServerProjection } from "@/okey/server/okey-authoritative";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type { OkeyDrawSource, OkeyGameState, OkeyMeld, OkeyTeamId } from "@/okey/types/okey";

export const LOCAL_OKEY_PREVIEW_PLAYER_ID = "preview-you";

const PREVIEW_PLAYERS = [
  { id: LOCAL_OKEY_PREVIEW_PLAYER_ID, name: "You", kind: "human" as const },
  { id: "preview-bot-1", name: "Local Bot 1", kind: "bot" as const },
  { id: "preview-bot-2", name: "Local Bot 2", kind: "bot" as const },
  { id: "preview-bot-3", name: "Local Bot 3", kind: "bot" as const },
];

function createPreviewRound(dealerIndex = 0): OkeyGameState {
  const state = createInitialOkeyGame(dealerIndex);
  return {
    ...state,
    players: state.players.map((player, index) => ({
      ...player,
      ...PREVIEW_PLAYERS[index],
      controlledByBot: index > 0,
      botDifficulty: index > 0 ? "normal" as const : undefined,
      botNumber: index > 0 ? index : undefined,
    })),
    turnMessage: {
      code: state.hasDrawnThisTurn ? "discard-tile" : "draw-tile",
      playerName: PREVIEW_PLAYERS[state.currentPlayerIndex]?.name ?? "You",
    },
  };
}

export function useLocalOkeyPreviewGame() {
  const [state, setState] = useState<OkeyGameState>(() => createPreviewRound());
  const [currentRound, setCurrentRound] = useState(1);
  const [matchScores, setMatchScores] = useState<Record<OkeyTeamId, number>>({ teamA: 0, teamB: 0 });
  const [roundResults, setRoundResults] = useState<OkeyRoundResult[]>([]);
  const [finalPresentationComplete, setFinalPresentationComplete] = useState(false);
  const [showRoundResultPopup, setShowRoundResultPopup] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);
  const [matchWinnerTeamId, setMatchWinnerTeamId] = useState<OkeyTeamId | null>(null);
  const [turnTimeLeft, setTurnTimeLeft] = useState(30);
  const [version, setVersion] = useState(0);
  const settledRoundRef = useRef(0);

  const commit = useCallback((transition: (current: OkeyGameState) => OkeyGameState) => {
    setState((current) => {
      const next = transition(current);
      if (next !== current) setVersion((currentVersion) => currentVersion + 1);
      return next;
    });
    return Promise.resolve(true);
  }, []);

  const draw = useCallback((source: OkeyDrawSource) => commit((current) => drawTile(current, source)), [commit]);
  const discard = useCallback((tileId: string) => commit((current) => discardTile(current, tileId)), [commit]);
  const commitOpenIntent = useCallback(
    (melds: OkeyMeld[], _score: number, tileId?: string) => commit((current) => {
      const opened = openPlayerMelds(current, current.currentPlayerIndex, melds, _score);
      return tileId ? discardTile(opened, tileId) : opened;
    }),
    [commit],
  );
  const declareKonkan = useCallback(
    (orderedRunTileIds: string[]) => commit((current) =>
      declareKonkanOpen(current, current.currentPlayerIndex, orderedRunTileIds)),
    [commit],
  );
  const spendTileOnTableMeld = useCallback(
    (tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") => commit((current) => {
      return spendTileOnMeld(current, current.currentPlayerIndex, tileId, targetPlayerId, targetMeldId, runEnd);
    }),
    [commit],
  );
  const lockKonkanSetOnTable = useCallback(
    (tileId: string, targetPlayerId: string, targetMeldId: string, runEnd?: "start" | "end") => commit((current) => {
      if (!canLockKonkanSet(current, current.currentPlayerIndex, tileId, targetPlayerId, targetMeldId)) return current;
      return lockKonkanSet(current, current.currentPlayerIndex, tileId, targetPlayerId, targetMeldId, runEnd);
    }),
    [commit],
  );

  useEffect(() => {
    if (state.phase !== "playing" || state.currentPlayerIndex === 0) return;
    const timer = setTimeout(() => {
      setState((current) => {
        if (current.phase !== "playing" || current.currentPlayerIndex === 0) return current;
        const next = current.hasDrawnThisTurn
          ? (() => {
              const prepared = prepareBotTurn(current, { difficulty: "normal" });
              return prepared.discardTileId ? discardTile(prepared.state, prepared.discardTileId) : prepared.state;
            })()
          : drawTile(current, chooseBotDrawSource(current, { difficulty: "normal" }));
        if (next !== current) setVersion((currentVersion) => currentVersion + 1);
        return next;
      });
    }, state.hasDrawnThisTurn ? 900 : 650);
    return () => clearTimeout(timer);
  }, [state.currentPlayerIndex, state.hasDrawnThisTurn, state.phase]);

  useEffect(() => {
    if (state.phase !== "playing") return;
    const resetTimer = setTimeout(() => setTurnTimeLeft(30), 0);
    const timer = setInterval(() => setTurnTimeLeft((left) => Math.max(0, left - 1)), 1_000);
    return () => {
      clearTimeout(resetTimer);
      clearInterval(timer);
    };
  }, [state.currentPlayerIndex, state.hasDrawnThisTurn, state.phase]);

  useEffect(() => {
    if (state.phase !== "finished" || settledRoundRef.current === currentRound) return;
    settledRoundRef.current = currentRound;
    const scoreDetails = getRoundResultScoreDetails(state);
    const roundScore = getRoundResultTeamScores(state);
    const winnerTeamId = state.players.find((player) => player.id === state.winnerId)?.teamId ?? null;
    setRoundResults((results) => [...results, {
      round: currentRound,
      scoreDetails,
      winnerId: state.winnerId,
      winnerTeamId,
      endReason: state.endReason,
    }]);
    setMatchScores((scores) => ({ teamA: scores.teamA + roundScore.teamA, teamB: scores.teamB + roundScore.teamB }));
  }, [currentRound, state]);

  const completeFinalPresentation = useCallback(() => {
    setFinalPresentationComplete(true);
    setShowRoundResultPopup(true);
  }, []);

  useEffect(() => {
    if (!showRoundResultPopup) return;
    const timer = setTimeout(() => {
      if (currentRound >= OKEY_RULESET_V1.match.roundCount) {
        setShowRoundResultPopup(false);
        setMatchFinished(true);
        setMatchWinnerTeamId(getMatchWinnerTeamId(matchScores));
        return;
      }
      setCurrentRound((round) => round + 1);
      setState(createPreviewRound((state.dealerIndex + 1) % 4));
      setFinalPresentationComplete(false);
      setShowRoundResultPopup(false);
    }, 4_000);
    return () => clearTimeout(timer);
  }, [currentRound, matchScores, showRoundResultPopup, state.dealerIndex]);

  const onlineProjection = useMemo(() => ({
    version,
    phase: state.phase,
    players: state.players,
    currentPlayerIndex: state.currentPlayerIndex,
    turnDeadlineAt: null,
    turnDurationSeconds: 30,
    settlement: null,
    forcedKonkanTeamId: null,
    roundStartsAt: null,
    matchFinished,
    lastTimeoutDiscardEvent: null,
  }) as unknown as OkeyMatchServerProjection, [matchFinished, state, version]);

  return {
    state, currentRound, maxRounds: OKEY_RULESET_V1.match.roundCount, matchScores, roundResults,
    showRoundResultPopup, currentRoundResult: roundResults.at(-1) ?? null,
    matchFinished, matchWinnerTeamId, showMatchResultPopup: matchFinished,
    finalPresentationComplete, completeFinalPresentation,
    draw, discard, commitOpenIntent, declareKonkan, spendTileOnTableMeld, lockKonkanSetOnTable,
    turnTimeLeft, turnTimeLeftMilliseconds: turnTimeLeft * 1_000,
    serverClockOffsetMs: 0, isAppActive: true, lifecycleResumeToken: 0,
    onlineProjection, onlineAdapter: null,
    leaveOnlineMatch: async () => undefined, requestExit: () => undefined, cancelExit: () => undefined,
    exitConfirmationVisible: false, leaving: false,
  };
}

