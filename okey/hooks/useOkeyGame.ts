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
import {
  MAX_ROUNDS,
  ROUND_RESULT_COUNTDOWN_SECONDS,
  createInitialOkeyMatch,
  settleFinishedRound,
  type OkeyMatchState,
} from "@/okey/match/okey-match-state";
import type {
  OkeyAuthoritativeCommand,
  OkeyMatchServerProjection,
} from "@/okey/server/okey-authoritative";
import type {
  OkeyDrawSource,
  OkeyGameState,
  OkeyMeld,
  OkeyTile,
} from "@/okey/types/okey";

const FINISH_REVEAL_SECONDS = 5.35;

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
): OkeyMatchState["roundResults"] {
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
function preserveViewerRackOrder(
  previousState: OkeyGameState,
  nextState: OkeyGameState,
): OkeyGameState {
  const previousHand =
    previousState.players[0]?.hand ?? [];

  const nextHand =
    nextState.players[0]?.hand ?? [];

  const nextById = new Map(
    nextHand.map((tile) => [
      tile.id,
      tile,
    ]),
  );

  const ordered: OkeyTile[] = [];

  for (const previousTile of previousHand) {
    const currentTile =
      nextById.get(previousTile.id);

    if (!currentTile) {
      continue;
}
    ordered.push(currentTile);
    nextById.delete(previousTile.id);
}
  ordered.push(...nextById.values());

  if (!nextState.players[0]) {
    return nextState;
}
  return {
    ...nextState,
    players: nextState.players.map(
      (player, index) =>
        index === 0
          ? {
              ...player,
              hand: ordered,
            }
          : player,
    ),
  };
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
) {

  const isOnline = true;

  const [match, setMatch] =
    useState<OkeyMatchState>(() =>
      createInitialOkeyMatch(),
    );

  const [onlineProjection, setOnlineProjection] =
    useState<OkeyMatchServerProjection | null>(
      null,
    );

  const [onlineAdapter, setOnlineAdapter] =
    useState<SupabaseOkeyMatchAdapter | null>(
      null,
    );

  const [onlineError, setOnlineError] =
    useState<Error | null>(null);


  const hasLoadedSavedGame = true;

  const [isAppActive, setIsAppActive] =
    useState(
      AppState.currentState ===
        "active",
    );

  const [
    lifecycleResumeToken,
    setLifecycleResumeToken,
  ] = useState(0);


  const matchRef = useRef(match);
  const onlineAdapterRef =
    useRef<SupabaseOkeyMatchAdapter | null>(
      null,
    );

  const hasAppliedOnlineProjectionRef =
    useRef(false);

  const appStateRef = useRef(
    AppState.currentState,
  );

  const [
    pendingTimeoutDiscardTileId,
    setPendingTimeoutDiscardTileId,
  ] = useState<string | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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

  const state = match.roundState;

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

  const onlineReady =
    onlineProjection !== null;

  useEffect(() => {
    matchRef.current = match;
  }, [match]);


  useEffect(() => {
    if (!onlineMatchId) {
      onlineAdapterRef.current = null;
      setOnlineAdapter(null);
      setOnlineProjection(null);
      setOnlineError(null);
      hasAppliedOnlineProjectionRef.current =
        false;
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
    hasAppliedOnlineProjectionRef.current =
      false;

    adapter
      .getCurrentUserId()
      .then((userId) => {
        if (mounted) {
          setCurrentUserId(userId);
        }
      })
      .catch(console.error);

    const applyProjection = (
      projection: OkeyMatchServerProjection,
    ) => {
      if (!mounted) {
        return;
}
      setOnlineProjection(projection);
      serverClockOffsetMsRef.current = adapter.getServerClockOffsetMs();

      setMatch((current) => {
        const projectedState =
          projectToOkeyGameState(
            projection,
          );

        const orderedState =
          preserveViewerRackOrder(
            current.roundState,
            projectedState,
          );

        const projectedRoundResults =
          projectAuthoritativeRoundResults(
            projection,
          );

        const isFirstProjection =
          !hasAppliedOnlineProjectionRef.current;

        const hasNewRoundResult =
          !isFirstProjection &&
          projectedRoundResults.length >
            current.roundResults.length;

        const matchJustFinished =
          !current.matchFinished && projection.matchFinished;
        const authoritativeRoundPresentation =
          getOkeyAuthoritativeRoundPresentation({
            eligibleAt: projection.nextRoundEligibleAt,
            serverNowMs: Date.now() + serverClockOffsetMsRef.current,
            countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
          });
        const awaitingAuthoritativeNextRound =
          projection.phase === "finished" &&
          !projection.matchFinished &&
          authoritativeRoundPresentation !== null;
        const initializeAuthoritativeRoundPresentation =
          awaitingAuthoritativeNextRound &&
          (hasNewRoundResult || isFirstProjection);
        const authoritativeRoundStarted =
          current.roundState.phase === "finished" &&
          projection.phase === "playing";

        return {
          ...current,
          roundState: orderedState,
          currentRound:
            projection.currentRound,
          roundResults:
            projectedRoundResults,
          matchScores: {
            teamA:
              projection.matchScores.teamA,
            teamB:
              projection.matchScores.teamB,
          },
          matchFinished:
            projection.matchFinished,
          matchWinnerTeamId:
            projection.matchWinnerTeamId,

          showFinishRevealPopup:
            authoritativeRoundStarted
              ? false
              : initializeAuthoritativeRoundPresentation
                ? authoritativeRoundPresentation.showFinishReveal
              : hasNewRoundResult
              ? true
              : isFirstProjection
                ? false
                : current.showFinishRevealPopup,

          showRoundResultPopup:
            authoritativeRoundStarted
              ? false
              : initializeAuthoritativeRoundPresentation
                ? !authoritativeRoundPresentation.showFinishReveal
              : hasNewRoundResult
              ? false
              : isFirstProjection
                ? false
                : current.showRoundResultPopup,

          roundResultCountdownRemaining:
            authoritativeRoundStarted
              ? null
              : initializeAuthoritativeRoundPresentation
                ? authoritativeRoundPresentation.showFinishReveal
                  ? null
                  : authoritativeRoundPresentation.countdownRemaining
              : hasNewRoundResult
              ? null
              : isFirstProjection
                ? null
                : current.roundResultCountdownRemaining,

          showMatchResultPopup:
            isFirstProjection &&
            projection.matchFinished
              ? true
              : matchJustFinished && !hasNewRoundResult
                ? true
              : current.showMatchResultPopup,
        };
      });

      hasAppliedOnlineProjectionRef.current =
        true;

      setOnlineError(null);
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
            setPendingTimeoutDiscardTileId(
              null,
            );
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
      ) => {
        const adapter = onlineAdapterRef.current;

        if (!adapter) {
          setOnlineError(new Error("okey_online_adapter_unavailable"));
          return;
        }

        setOnlineError(null);

        try {
          await adapter.dispatch(command);
        } catch (error) {
          setOnlineError(normalizeOnlineError(error));
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
    }).then(() => {
      setMatch((current) => ({
        ...current,
        showRoundResultPopup: false,
        showFinishRevealPopup: false,
        roundResultCountdownRemaining: null,
      }));
    }).catch((error) => {
      nextRoundClaimRef.current = null;
      setOnlineError(normalizeOnlineError(error));
    });
  }, [onlineProjection]);

  useEffect(() => {
    if (
      !hasLoadedSavedGame ||
      !isAppActive ||
      !match.showFinishRevealPopup
    ) {
      return;
    }

    const authoritativePresentation =
      getOkeyAuthoritativeRoundPresentation({
        eligibleAt: onlineProjection?.nextRoundEligibleAt ?? null,
        serverNowMs: Date.now() + serverClockOffsetMsRef.current,
        countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
      });
    const revealDelayMs = authoritativePresentation
      ? authoritativePresentation.msUntilCountdown
      : FINISH_REVEAL_SECONDS * 1000;

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (
          !current.showFinishRevealPopup
        ) {
          return current;
        }

        const latestPresentation =
          getOkeyAuthoritativeRoundPresentation({
            eligibleAt: onlineProjection?.nextRoundEligibleAt ?? null,
            serverNowMs: Date.now() + serverClockOffsetMsRef.current,
            countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
          });

        return {
          ...current,
          showFinishRevealPopup: false,
          showRoundResultPopup: true,
          roundResultCountdownRemaining:
            latestPresentation?.countdownRemaining ??
            ROUND_RESULT_COUNTDOWN_SECONDS,
        };
      });
    }, revealDelayMs);

    return () =>
      clearTimeout(timer);
  }, [
    hasLoadedSavedGame,
    isAppActive,
    match.showFinishRevealPopup,
    onlineProjection?.nextRoundEligibleAt,
  ]);

  useEffect(() => {
    if (
      !hasLoadedSavedGame ||
      !isAppActive ||
      !match.showRoundResultPopup ||
      match.roundResultCountdownRemaining ===
        null
    ) {
      return;
    }

    const authoritativePresentation =
      getOkeyAuthoritativeRoundPresentation({
        eligibleAt: onlineProjection?.nextRoundEligibleAt ?? null,
        serverNowMs: Date.now() + serverClockOffsetMsRef.current,
        countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
      });
    const countdownRemaining =
      authoritativePresentation?.countdownRemaining ??
      match.roundResultCountdownRemaining;

    if (countdownRemaining <= 0) {
      if (match.matchFinished) {
        setMatch((current) => ({
          ...current,
          showRoundResultPopup: false,
          showFinishRevealPopup: false,
          roundResultCountdownRemaining:
            null,
          showMatchResultPopup: true,
        }));

        return;
      }

      nextRound();
      return;
    }

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (
          !current.showRoundResultPopup ||
          current.roundResultCountdownRemaining ===
            null
        ) {
          return current;
        }

        const latestPresentation =
          getOkeyAuthoritativeRoundPresentation({
            eligibleAt: onlineProjection?.nextRoundEligibleAt ?? null,
            serverNowMs: Date.now() + serverClockOffsetMsRef.current,
            countdownSeconds: ROUND_RESULT_COUNTDOWN_SECONDS,
          });
        const nextCountdown = latestPresentation
          ? latestPresentation.countdownRemaining
          : Math.max(0, current.roundResultCountdownRemaining - 1);

        if (nextCountdown === current.roundResultCountdownRemaining) {
          return current;
        }

        return {
          ...current,
          roundResultCountdownRemaining: nextCountdown,
        };
      });
    }, authoritativePresentation
      ? authoritativePresentation.msUntilNextCountdownTick
      : 1000);

    return () =>
      clearTimeout(timer);
  }, [
    hasLoadedSavedGame,
    isAppActive,
    match.matchFinished,
    match.roundResultCountdownRemaining,
    match.showRoundResultPopup,
    nextRound,
    onlineProjection?.nextRoundEligibleAt,
  ]);

  const draw = useCallback(
    (source: OkeyDrawSource) => {
      void dispatchOnline({
        type: "draw",
        source,
      });
    },
    [dispatchOnline],
  );

  const discard = useCallback(
    (tileId: string) => {
      void dispatchOnline({
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
      void dispatchOnline(discardTileId
        ? { type: "open-and-discard", melds, score, tileId: discardTileId }
        : { type: "open-melds", melds, score });
    },
    [dispatchOnline],
  );

  const declareKonkan =
    useCallback((orderedRunTileIds: string[]) => {
      void dispatchOnline({
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
      ) => {
        void dispatchOnline({
          type: "spend-meld",
          tileId,
          targetPlayerId,
          targetMeldId,
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
      ) => {
        void dispatchOnline({
          type: "lock-konkan",
          tileId,
          targetPlayerId,
          targetMeldId,
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

  const commitPendingTimeoutDiscard =
    useCallback(() => {
      setPendingTimeoutDiscardTileId(
        null,
      );
    }, []);

  const currentRoundResult =
    useMemo(() => {
      if (
        match.showFinishRevealPopup ||
        match.showRoundResultPopup ||
        match.matchFinished
      ) {
        return (
          match.roundResults[
            match.roundResults.length - 1
          ] ?? null
        );
      }

      return (
        match.roundResults.find(
          (result) =>
            result.round ===
            match.currentRound,
        ) ?? null
      );
    }, [
      match.currentRound,
      match.matchFinished,
      match.roundResults,
      match.showFinishRevealPopup,
      match.showRoundResultPopup,
    ]);

  return {
    state,

    isOnline,
    onlineReady,
    onlineProjection,
    onlineAdapter,

    leaveOnlineMatch,

    isAppActive,
    lifecycleResumeToken,

    currentRound:
      match.currentRound,

    maxRounds:
      onlineProjection?.maxRounds ??
      MAX_ROUNDS,
    roundResults:
      match.roundResults,
    matchScores:
      match.matchScores,

    showRoundResultPopup:
      match.showRoundResultPopup,

    showFinishRevealPopup:
      match.showFinishRevealPopup,

    currentRoundResult,

    matchFinished:
      match.matchFinished,

    matchWinnerTeamId:
      match.matchWinnerTeamId,

    showMatchResultPopup:
      match.showMatchResultPopup,

    roundResultCountdownRemaining:
      match.roundResultCountdownRemaining,

    draw,
    discard,
    commitOpenIntent,
    declareKonkan,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    playEliminated,

    pendingTimeoutDiscardTileId,
    turnTimeLeft,
    commitPendingTimeoutDiscard,

  };
}

