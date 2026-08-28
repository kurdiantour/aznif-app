import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
import { useOkeyMultiplayerBotController } from "@/okey/controllers/okey-multiplayer-bot-controller";
import { getOkeyAuthoritativeRoundPresentation } from "@/okey/presentation/okey-game-presentation";
import { useOkeyTimeoutController, useOkeyTurnClock } from "./useOkeyTimeoutController";
import { createInitialOkeyGame, getRoundResultScoreDetails } from "@/okey/engine/okey-engine";
import { OKEY_RULESET_V1 } from "@/okey/rules/okey-ruleset-v1";
import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";
import type {
  OkeyDrawSource,
  OkeyGameState,
  OkeyMeld,
  OkeyTeamId,
  OkeyTile,
} from "@/okey/types/okey";

const FINISH_REVEAL_SECONDS = 5.35;
const ROUND_RESULT_COUNTDOWN_SECONDS = 5;

export type OkeyRoundResult = {
  round: number;
  scoreDetails: ReturnType<typeof getRoundResultScoreDetails>;
  winnerId: string | null;
  winnerTeamId: OkeyTeamId | null;
  endReason: OkeyGameState["endReason"];
};

function createPlaceholderOkeyTile(
  id: string,
): OkeyTile {
  return {
    id,
    color: "black",
    value: 0,
    copy: 1,
  };
}
function createPlaceholderHand(
  playerId: string,
  count: number,
): OkeyTile[] {
  return Array.from(
    {
      length: count,
    },
    (_, index) =>
      createPlaceholderOkeyTile(
        `hidden-${playerId}-${index}`,
      ),
  );
}
function createPlaceholderDeck(
  count: number,
): OkeyTile[] {
  return Array.from(
    {
      length: count,
    },
    (_, index) =>
      createPlaceholderOkeyTile(
        `deck-placeholder-${index}`,
      ),
  );
}
function projectToOkeyGameState(
  projection: OkeyMatchServerProjection,
): OkeyGameState {
  const totalPlayers =
    projection.players.length;

const viewerIndex =
  projection.phase === "playing"
    ? projection.players.findIndex(
        (player) =>
          Array.isArray(player.hand),
      )
    : -1;

  const normalizedPlayers =
    projection.players.map((player) => {

    
  const hand = projection.phase === "playing"
    ? Array.isArray(player.hand)
      ? player.hand
      : createPlaceholderHand(player.id, player.handCount)
    : [];

return {
  id: player.id,
  name: player.name,
  kind: player.kind,
  botDifficulty:
    player.botDifficulty,
  controlledByBot:
    player.controlledByBot,
  botNumber:
    player.botNumber,
  teamId: player.teamId,
  hand,
  opened: player.opened,
  melds: player.melds,
  scoreOpened:
    player.scoreOpened,
  firstOpenScore:
    player.firstOpenScore ?? null,
  konkan: player.konkan,
  konkanEntryReason:
    player.konkanEntryReason,
  pendingKonkanFromDiscard:
    player.pendingKonkanFromDiscard ??
    false,
  eliminated:
    player.eliminated,
};
});

  const reorderedPlayers =
    viewerIndex > 0
      ? [
          ...normalizedPlayers.slice(
            viewerIndex,
          ),
          ...normalizedPlayers.slice(
            0,
            viewerIndex,
          ),
        ]
      : normalizedPlayers;

  const normalizeIndex = (
    index: number,
  ) => {
    if (viewerIndex < 0) {
      return index;
}
    return (
      (index -
        viewerIndex +
        totalPlayers) %
      totalPlayers
    );
  };

  return {
    players: reorderedPlayers,
    stagingMelds:
      projection.stagingMelds,
    teamFirstOpenScores:
      projection.teamFirstOpenScores,

    currentPlayerIndex:
      normalizeIndex(
        projection.currentPlayerIndex,
      ),

    dealerIndex: normalizeIndex(
      projection.dealerIndex,
    ),

deck:
  projection.phase === "playing"
    ? createPlaceholderDeck(
        projection.deckCount,
      )
    : [],

    discardPile:
      projection.discardPile,

discardOwners:
  projection.discardOwners.flatMap(
    (owner) => {
      if (!owner) {
        return [];
}
      const playerId =
        owner.playerId ??
        projection.players[
          owner.playerIndex
        ]?.id;

      if (!playerId) {
        return [];
}
      return [
        {
          playerId,
          playerIndex: normalizeIndex(
            owner.playerIndex,
          ),
        },
      ];
    },
  ),

    konkanDiscardPickCounts:
      projection.konkanDiscardPickCounts,

    mustFinishAfterSecondKonkanDiscardPickPlayerId:
      projection.mustFinishAfterSecondKonkanDiscardPickPlayerId,

    reshuffleCount:
      projection.reshuffleCount,

    indicatorTile:
      projection.indicatorTile,

    okeyTile: projection.okeyTile,
    phase: projection.phase,
    winnerId: projection.winnerId,
    endReason: projection.endReason,
    turnMessage:
      projection.turnMessage,
    hasDrawnThisTurn:
      projection.hasDrawnThisTurn,
  };
}
function projectAuthoritativeRoundResults(
  projection: OkeyMatchServerProjection,
): OkeyRoundResult[] {
  return projection.roundResults.map(
    (result) => ({
      round: result.round,
      winnerId: result.winnerId,
      winnerTeamId: result.winnerTeamId,
      endReason: result.endReason,
      scoreDetails: {
        scores: {
          teamA: result.teamAScore,
          teamB: result.teamBScore,
        },
        details: [],
      },
    }),
  );
}
function normalizeOnlineError(
  error: unknown,
) {
  return error instanceof Error
    ? error
    : new Error(
        "okey_online_request_failed",
      );
}
export function useOkeyGame(
  onlineMatchId?: string,
  currentUserId: string | null = null,
) {
  const [onlineProjection, setOnlineProjection] =
    useState<OkeyMatchServerProjection | null>(
      null,
    );

  const [onlineAdapter, setOnlineAdapter] =
    useState<SupabaseOkeyMatchAdapter | null>(
      null,
    );

  const [, setOnlineError] = useState<Error | null>(null);

  const [isAppActive, setIsAppActive] =
    useState(
      AppState.currentState ===
        "active",
    );

  const [
    lifecycleResumeToken,
    setLifecycleResumeToken,
  ] = useState(0);


  const onlineAdapterRef =
    useRef<SupabaseOkeyMatchAdapter | null>(
      null,
    );

  const previousProjectionRef =
    useRef<OkeyMatchServerProjection | null>(null);

  const appStateRef = useRef(
    AppState.currentState,
  );

  const [presentationTick, setPresentationTick] = useState(0);
  const [terminalPresentation, setTerminalPresentation] = useState<{
    stage: "finish" | "round" | "match";
    deadlineMs: number | null;
  } | null>(null);

  const serverClockOffsetMsRef = useRef(0);
  const timeoutPassInFlightRef = useRef(false);
  const timeoutRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutSubmitRef = useRef<((claim: any, turnKey: string, matchId: string) => void) | null>(null);
  const activeTurnKeyRef = useRef<string | null>(null);
  const matchIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    matchIdRef.current = onlineMatchId;
  }, [onlineMatchId]);

  const clearTimeoutRetry = useCallback(() => {
    if (timeoutRetryRef.current) {
      clearTimeout(timeoutRetryRef.current);
      timeoutRetryRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTimeoutRetry();
  }, [clearTimeoutRetry]);

  const fallbackState = useMemo(() => createInitialOkeyGame(), []);
  const state = useMemo(
    () => onlineProjection ? projectToOkeyGameState(onlineProjection) : fallbackState,
    [fallbackState, onlineProjection],
  );

  const currentPlayerId = onlineProjection && onlineProjection.players[onlineProjection.currentPlayerIndex]
    ? onlineProjection.players[onlineProjection.currentPlayerIndex].id
    : '';

  const turnTimeLeft = useOkeyTurnClock({
    currentPlayerId,
    projection: onlineProjection,
    serverClockOffsetMsRef,
  });

  useOkeyTimeoutController({
    matchId: onlineMatchId,
    turnTimeLeft,
    currentPlayerId,
    projection: onlineProjection,
    currentUserId,
    adapter: onlineAdapter,
    refreshSnapshot: async () => {
      if (onlineAdapter) {
        await onlineAdapter.refresh();
      }
    },
    matchIdRef,
    activeTurnKeyRef,
    serverClockOffsetMsRef,
    timeoutPassInFlightRef,
    timeoutRetryRef,
    timeoutSubmitRef,
    clearTimeoutRetry,
  });

  useEffect(() => {
    if (
      !onlineMatchId ||
      onlineProjection?.matchFinished
    ) {
      activeTurnKeyRef.current = null;
      return;
    }
    const expectedVersion = Number(onlineProjection?.version);
    const expectedTurnDeadlineAt = onlineProjection?.turnDeadlineAt;
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      typeof expectedTurnDeadlineAt !== "string" ||
      !currentPlayerId
    ) {
      activeTurnKeyRef.current = null;
      return;
    }
    activeTurnKeyRef.current =
      `${expectedVersion}:${expectedTurnDeadlineAt}:${currentPlayerId}`;
  }, [onlineMatchId, onlineProjection, currentPlayerId]);

  useOkeyMultiplayerBotController({
    matchId: onlineMatchId,
    projection: onlineProjection,
    adapter: onlineAdapter,
  });

  useEffect(() => {
    if (!onlineMatchId) {
      onlineAdapterRef.current = null;
      setOnlineAdapter(null);
      setOnlineProjection(null);
      setOnlineError(null);
      previousProjectionRef.current = null;
      setTerminalPresentation(null);
      return;
}
    let mounted = true;

    const adapter =
      new SupabaseOkeyMatchAdapter(
        onlineMatchId,
      );

    onlineAdapterRef.current =
      adapter;

    setOnlineAdapter(adapter);
    setOnlineProjection(null);
    setOnlineError(null);
    previousProjectionRef.current = null;
    setTerminalPresentation(null);

    const applyProjection = (
      projection: OkeyMatchServerProjection,
    ) => {
      if (!mounted) {
        return;
}
      const previousProjection = previousProjectionRef.current;
      previousProjectionRef.current = projection;
      setOnlineProjection(projection);
      setOnlineError(null);
      serverClockOffsetMsRef.current = adapter.getServerClockOffsetMs();
      if (projection.matchFinished) {
        if (!previousProjection) {
          setTerminalPresentation({ stage: "match", deadlineMs: null });
        } else if (!previousProjection.matchFinished) {
          const hasNewRoundResult =
            projection.roundResults.length > previousProjection.roundResults.length;
          setTerminalPresentation(hasNewRoundResult
            ? { stage: "finish", deadlineMs: Date.now() + FINISH_REVEAL_SECONDS * 1000 }
            : { stage: "match", deadlineMs: null });
        }
      } else {
        setTerminalPresentation(null);
      }
    };

    const unsubscribe =
      adapter.subscribe(
        applyProjection,
      );

    return () => {
      mounted = false;
      unsubscribe();

      if (
        onlineAdapterRef.current ===
        adapter
      ) {
        onlineAdapterRef.current =
          null;
      }
    };
  }, [onlineMatchId]);

  useEffect(() => {
    const subscription =
      AppState.addEventListener(
        "change",
        (nextState) => {
          const previousState =
            appStateRef.current;

          appStateRef.current =
            nextState;

          if (
            previousState ===
              "active" &&
            nextState !== "active"
          ) {
            setIsAppActive(false);
            return;
          }

          if (
            previousState !==
              "active" &&
            nextState === "active"
          ) {
            const adapter =
              onlineAdapterRef.current;

            if (adapter) {
              void adapter
                .reconnect()
                .then(() => {
                  setOnlineError(null);
                })
                .catch((error) => {
                  setOnlineError(
                    normalizeOnlineError(
                      error,
                    ),
                  );
                });
            }

            setIsAppActive(true);

            setLifecycleResumeToken(
              (token) => token + 1,
            );
          }
        },
      );

    return () =>
      subscription.remove();
  }, []);


  const dispatchOnline =
    useCallback(
      async (
        command: OkeyAuthoritativeCommand,
      ): Promise<boolean> => {
        const adapter = onlineAdapterRef.current;

        if (!adapter) {
          setOnlineError(new Error("okey_online_adapter_unavailable"));
          return false;
        }

        setOnlineError(null);

        try {
          await adapter.dispatch(command);
          return true;
        } catch (error) {
          setOnlineError(normalizeOnlineError(error));
          return false;
        }
      },
      [],
    );

  const reconnectOnline =
    useCallback(async () => {
      const adapter =
        onlineAdapterRef.current;

      if (!adapter) {
        return;
      }

      try {
        await adapter.reconnect();
        setOnlineError(null);
      } catch (error) {
        setOnlineError(
          normalizeOnlineError(error),
        );
      }
    }, []);

  const leaveOnlineMatch =
    useCallback(async () => {
      const adapter =
        onlineAdapterRef.current;

      if (!adapter) {
        return;
      }

      try {
        await adapter.leave();
      } finally {
        setOnlineProjection(null);
        setOnlineAdapter(null);
        onlineAdapterRef.current =
          null;
      }
    }, []);

  const nextRoundClaimRef = useRef<string | null>(null);
  const eliminatedTurnClaimRef = useRef<string | null>(null);
  const nextRound = useCallback(() => {
    const adapter = onlineAdapterRef.current;
    const projection = onlineProjection;

    if (
      !adapter ||
      !projection ||
      projection.matchFinished ||
      projection.phase !== "finished"
    ) {
      return;
    }

    const claimKey = projection.version + ":" + projection.currentRound;
    if (nextRoundClaimRef.current === claimKey) return;
    nextRoundClaimRef.current = claimKey;

    void adapter.startNextRound({
      expectedVersion: projection.version,
      expectedRound: projection.currentRound,
    }).catch((error) => {
      nextRoundClaimRef.current = null;
      setOnlineError(normalizeOnlineError(error));
    });
  }, [onlineProjection]);

  const authoritativePresentation = useMemo(
    () => getOkeyAuthoritativeRoundPresentation({
      eligibleAt: onlineProjection?.nextRoundEligibleAt ?? null,
      serverNowMs: Date.now() + serverClockOffsetMsRef.current,
      countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
    }),
    [onlineProjection?.nextRoundEligibleAt, presentationTick],
  );

  const terminalCountdownRemaining = terminalPresentation?.stage === "round" && terminalPresentation.deadlineMs
    ? Math.max(0, Math.ceil((terminalPresentation.deadlineMs - Date.now()) / 1000))
    : null;
  const showFinishRevealPopup = terminalPresentation?.stage === "finish" || (
    !onlineProjection?.matchFinished && onlineProjection?.phase === "finished" &&
    authoritativePresentation?.showFinishReveal === true
  );
  const showRoundResultPopup = terminalPresentation?.stage === "round" || (
    !onlineProjection?.matchFinished && onlineProjection?.phase === "finished" &&
    authoritativePresentation !== null && !authoritativePresentation.showFinishReveal
  );
  const showMatchResultPopup = terminalPresentation?.stage === "match";
  const roundResultCountdownRemaining = terminalCountdownRemaining ?? (
    showRoundResultPopup ? authoritativePresentation?.countdownRemaining ?? null : null
  );

  useEffect(() => {
    if (!isAppActive) return;

    if (terminalPresentation) {
      if (terminalPresentation.stage === "match" || !terminalPresentation.deadlineMs) return;
      const remainingMs = terminalPresentation.deadlineMs - Date.now();
      if (remainingMs <= 0) {
        setTerminalPresentation(terminalPresentation.stage === "finish"
          ? { stage: "round", deadlineMs: Date.now() + ROUND_RESULT_COUNTDOWN_SECONDS * 1000 }
          : { stage: "match", deadlineMs: null });
        return;
      }
      const timer = setTimeout(
        () => setPresentationTick((tick) => tick + 1),
        terminalPresentation.stage === "finish" ? remainingMs : Math.min(remainingMs, 1000),
      );
      return () => clearTimeout(timer);
    }

    if (onlineProjection?.phase !== "finished" || onlineProjection.matchFinished || !authoritativePresentation) return;
    if (authoritativePresentation.countdownRemaining <= 0) {
      nextRound();
      return;
    }
    const timer = setTimeout(
      () => setPresentationTick((tick) => tick + 1),
      authoritativePresentation.showFinishReveal
        ? authoritativePresentation.msUntilCountdown
        : authoritativePresentation.msUntilNextCountdownTick,
    );
    return () => clearTimeout(timer);
  }, [authoritativePresentation, isAppActive, nextRound, onlineProjection, terminalPresentation]);

  const draw = useCallback(
    (source: OkeyDrawSource) => {
      return dispatchOnline({
        type: "draw",
        source,
      });
    },
    [dispatchOnline],
  );

  const discard = useCallback(
    (tileId: string) => {
      return dispatchOnline({
        type: "discard",
        tileId,
      });
    },
    [dispatchOnline],
  );

  const commitOpenIntent = useCallback(
    (
      melds: OkeyMeld[],
      score: number,
      discardTileId?: string,
    ) => {
      return dispatchOnline(discardTileId
        ? { type: "open-and-discard", melds, score, tileId: discardTileId }
        : { type: "open-melds", melds, score });
    },
    [dispatchOnline],
  );

  const declareKonkan =
    useCallback((orderedRunTileIds: string[]) => {
      return dispatchOnline({
        type: "declare-konkan",
        orderedRunTileIds,
      });
    }, [dispatchOnline]);

  const spendTileOnTableMeld =
    useCallback(
      (
        tileId: string,
        targetPlayerId: string,
        targetMeldId: string,
        runEnd?: "start" | "end",
      ) => {
        return dispatchOnline({
          type: "spend-meld",
          tileId,
          targetPlayerId,
          targetMeldId,
          ...(runEnd ? { runEnd } : {}),
        });
      },
      [dispatchOnline],
    );

  const lockKonkanSetOnTable =
    useCallback(
      (
        tileId: string,
        targetPlayerId: string,
        targetMeldId: string,
        runEnd?: "start" | "end",
      ) => {
        return dispatchOnline({
          type: "lock-konkan",
          tileId,
          targetPlayerId,
          targetMeldId,
          ...(runEnd ? { runEnd } : {}),
        });
      },
      [dispatchOnline],
    );

  const playEliminated = useCallback(() => {
    const adapter = onlineAdapterRef.current;
    const projection = onlineProjection;
    const actor = projection?.players[projection.currentPlayerIndex];

    if (
      !adapter ||
      !projection ||
      projection.phase !== "playing" ||
      !actor?.eliminated
    ) {
      return;
    }

    const claimKey = projection.version + ":" + actor.id;
    if (eliminatedTurnClaimRef.current === claimKey) return;
    eliminatedTurnClaimRef.current = claimKey;

    void adapter.playEliminatedTurn({
      expectedVersion: projection.version,
      expectedActorId: actor.id,
    }).catch((error) => {
      eliminatedTurnClaimRef.current = null;
      setOnlineError(normalizeOnlineError(error));
    });
  }, [onlineProjection]);

  useEffect(() => {
    playEliminated();
  }, [playEliminated]);

  const roundResults = useMemo(
    () => onlineProjection ? projectAuthoritativeRoundResults(onlineProjection) : [],
    [onlineProjection],
  );
  const currentRound = onlineProjection?.currentRound ?? 1;
  const matchFinished = onlineProjection?.matchFinished ?? false;
  const currentRoundResult =
    useMemo(() => {
      if (
        showFinishRevealPopup ||
        showRoundResultPopup ||
        matchFinished
      ) {
        return (
          roundResults[
            roundResults.length - 1
          ] ?? null
        );
      }

      return (
        roundResults.find(
          (result) =>
            result.round ===
            currentRound,
        ) ?? null
      );
    }, [
      currentRound,
      matchFinished,
      roundResults,
      showFinishRevealPopup,
      showRoundResultPopup,
    ]);

  return {
    state,

    onlineProjection,
    onlineAdapter,

    leaveOnlineMatch,

    isAppActive,
    lifecycleResumeToken,

    currentRound,

    maxRounds:
      onlineProjection?.maxRounds ??
      OKEY_RULESET_V1.match.roundCount,
    roundResults,
    matchScores: onlineProjection?.matchScores ?? { teamA: 0, teamB: 0 },

    showRoundResultPopup,

    showFinishRevealPopup,

    currentRoundResult,

    matchFinished,

    matchWinnerTeamId:
      onlineProjection?.matchWinnerTeamId ?? null,

    showMatchResultPopup,

    roundResultCountdownRemaining,

    draw,
    discard,
    commitOpenIntent,
    declareKonkan,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    turnTimeLeft,

  };
}
