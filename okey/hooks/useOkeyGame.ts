import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { SupabaseOkeyMatchAdapter } from "@/okey/adapters/supabase-okey-match-adapter";
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
  onlineTableId?: string,
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

  const [onlineCommandPending, setOnlineCommandPending] =
    useState(false);

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

  // The scene reports active tile animation through this controller hook.
  const [, setTurnPresentationBlocked] = useState(false);

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

  const state = match.roundState;

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

    const applyProjection = (
      projection: OkeyMatchServerProjection,
    ) => {
      if (!mounted) {
        return;
      }

      setOnlineProjection(projection);

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
            hasNewRoundResult
              ? true
              : isFirstProjection
                ? false
                : current.showFinishRevealPopup,

          showRoundResultPopup:
            hasNewRoundResult
              ? false
              : isFirstProjection
                ? false
                : current.showRoundResultPopup,

          roundResultCountdownRemaining:
            hasNewRoundResult
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
        const adapter =
          onlineAdapterRef.current;

        if (!adapter) {
          setOnlineError(
            new Error(
              "okey_online_adapter_unavailable",
            ),
          );
          return;
        }

        if (onlineCommandPending) {
          return;
        }

        setOnlineCommandPending(true);
        setOnlineError(null);

        try {
          await adapter.dispatch(
            command,
          );
        } catch (error) {
          setOnlineError(
            normalizeOnlineError(
              error,
            ),
          );
        } finally {
          setOnlineCommandPending(
            false,
          );
        }
      },
      [onlineCommandPending],
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

  const newGame = useCallback(() => {
    void reconnectOnline();
  }, [reconnectOnline]);

  const nextRound = useCallback(() => {
    setMatch((current) => ({
      ...current,
      showRoundResultPopup: false,
      showFinishRevealPopup: false,
      roundResultCountdownRemaining:
        null,
    }));
  }, []);

  useEffect(() => {
    if (
      !hasLoadedSavedGame ||
      !isAppActive ||
      !match.showFinishRevealPopup
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setMatch((current) => {
        if (
          !current.showFinishRevealPopup
        ) {
          return current;
        }

        return {
          ...current,
          showFinishRevealPopup: false,
          showRoundResultPopup: true,
          roundResultCountdownRemaining:
            ROUND_RESULT_COUNTDOWN_SECONDS,
        };
      });
    }, FINISH_REVEAL_SECONDS * 1000);

    return () =>
      clearTimeout(timer);
  }, [
    hasLoadedSavedGame,
    isAppActive,
    match.showFinishRevealPopup,
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

    if (
      match.roundResultCountdownRemaining <=
      0
    ) {
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

        return {
          ...current,
          roundResultCountdownRemaining:
            Math.max(
              0,
              current.roundResultCountdownRemaining -
                1,
            ),
        };
      });
    }, 1000);

    return () =>
      clearTimeout(timer);
  }, [
    hasLoadedSavedGame,
    isAppActive,
    match.matchFinished,
    match.roundResultCountdownRemaining,
    match.showRoundResultPopup,
    nextRound,
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

  // Rack ordering is presentation-only in the online client.
  // OkeyPlayerRack owns the local visual order, so these controller
  // callbacks remain no-ops for API compatibility with the scene.
  const sortHand = useCallback(() => {}, []);

  const moveTile = useCallback(
    (_tileId: string, _targetIndex: number) => {},
    [],
  );

  const moveTiles = useCallback(
    (_tileIds: string[], _targetIndex: number) => {},
    [],
  );

  const openMelds = useCallback(
    (
      melds: OkeyMeld[],
      score: number,
    ) => {
      void dispatchOnline({
        type: "open-melds",
        melds,
        score,
      });
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

  // Kept for controller compatibility. Online gameplay uses
  // spendTileOnTableMeld / lockKonkanSetOnTable server commands.
  const spendTile = useCallback(
    (_tileId: string) => {},
    [],
  );

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

  const spendOrDiscardTile =
    useCallback(
      (tileId: string) => {
        if (state.hasDrawnThisTurn) {
          void dispatchOnline({
            type: "discard",
            tileId,
          });
        }
      },
      [
        dispatchOnline,
        state.hasDrawnThisTurn,
      ],
    );

  // Timeout gameplay is server-authoritative online. The scene still
  // consumes these callbacks, so keep the API without local mutation.
  const beginTimeoutHumanTurn =
    useCallback(() => null, []);

  const playEliminated =
    useCallback(() => {}, []);

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
    onlineTableId:
      onlineTableId ?? null,
    onlineMatchId:
      onlineMatchId ?? null,

    onlineReady,
    onlineError,
    onlineCommandPending,
    onlineProjection,
    onlineAdapter,

    reconnectOnline,
    leaveOnlineMatch,

    isAppActive,
    lifecycleResumeToken,
    setTurnPresentationBlocked,

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

    resetGame: newGame,
    newGame,
    nextRound,

    draw,
    discard,
    sortHand,
    moveTile,
    moveTiles,
    openMelds,
    declareKonkan,
    spendTile,
    spendTileOnTableMeld,
    lockKonkanSetOnTable,
    playEliminated,
    spendOrDiscardTile,

    pendingTimeoutDiscardTileId,
    beginTimeoutHumanTurn,
    commitPendingTimeoutDiscard,

  };
}
