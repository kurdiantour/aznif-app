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
  canSpendTileOnBestMeld,
  createInitialOkeyGame,
  discardTile,
  getNextRoundDealerIndex,
  spendTileOnBestMeld,
} from "@/okey/engine/okey-engine";
import {
  prepareTimeoutTurn,
  resolveTimeoutTurn,
} from "@/okey/engine/okey-timeout";
import { reconcileOkeyMatchAfterInterruption } from "@/okey/lifecycle/okey-match-lifecycle";
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

// No local match adapter or local persistence exists in the online-only client.
const onlineOnlyFallback = {
  apply: <T,>(state: T, ..._args: unknown[]) => state,
};
const loadDisabledSnapshot = async (): Promise<{ match: OkeyMatchState; savedAt: number } | null> => null;
const saveDisabledSnapshot = async (..._args: unknown[]) => undefined;
const clearDisabledSnapshot = async () => undefined;

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

  const [hasLoadedSavedGame, setHasLoadedSavedGame] =
    useState(false);

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

  const inactiveAtRef =
    useRef<number | null>(null);

  const appStateRef = useRef(
    AppState.currentState,
  );

  const [
    pendingTimeoutDiscardTileId,
    setPendingTimeoutDiscardTileId,
  ] = useState<string | null>(null);

  const state = match.roundState;

  const onlineReady =
    !isOnline ||
    onlineProjection !== null;

  useEffect(() => {
    if (isOnline) {
      setHasLoadedSavedGame(true);
      return;
    }

    let mounted = true;

    loadDisabledSnapshot()
      .then((snapshot) => {
        if (!mounted || !snapshot) {
          return;
        }

        const settled =
          settleFinishedRound(
            snapshot.match,
          );

        setMatch(
          reconcileOkeyMatchAfterInterruption(
            settled,
            Date.now() -
              snapshot.savedAt,
          ).match,
        );
      })
      .catch((error) =>
        console.warn(
          "Unable to load saved Okey match",
          error,
        ),
      )
      .finally(() => {
        if (mounted) {
          setHasLoadedSavedGame(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isOnline]);

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

    void adapter
      .reconnect()
      .catch((error) => {
        if (mounted) {
          setOnlineError(
            normalizeOnlineError(
              error,
            ),
          );
        }
      });

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
            const suspendedAt =
              Date.now();

            inactiveAtRef.current =
              suspendedAt;

            setIsAppActive(false);
            setPendingTimeoutDiscardTileId(
              null,
            );

            if (!isOnline) {
              void saveDisabledSnapshot(
                matchRef.current,
                suspendedAt,
              ).catch((error) =>
                console.warn(
                  "Unable to save suspended Okey match",
                  error,
                ),
              );
            }

            return;
          }

          if (
            previousState !==
              "active" &&
            nextState === "active"
          ) {
            const resumedAt =
              Date.now();

            const elapsedMs =
              inactiveAtRef.current ===
              null
                ? 0
                : resumedAt -
                  inactiveAtRef.current;

            inactiveAtRef.current =
              null;

            if (isOnline) {
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
            } else {
              setMatch((current) =>
                reconcileOkeyMatchAfterInterruption(
                  current,
                  elapsedMs,
                ).match,
              );
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
  }, [isOnline]);


  const saveMatchTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  useEffect(() => {
    if (
      isOnline ||
      !hasLoadedSavedGame
    ) {
      return;
    }

    if (saveMatchTimerRef.current) {
      clearTimeout(
        saveMatchTimerRef.current,
      );
    }

    saveMatchTimerRef.current =
      setTimeout(() => {
        void saveDisabledSnapshot(
          matchRef.current,
        ).catch((error) =>
          console.warn(
            "Unable to save Okey match",
            error,
          ),
        );

        saveMatchTimerRef.current =
          null;
      }, 300);

    return () => {
      if (
        saveMatchTimerRef.current
      ) {
        clearTimeout(
          saveMatchTimerRef.current,
        );

        saveMatchTimerRef.current =
          null;
      }
    };
  }, [
    hasLoadedSavedGame,
    isOnline,
    match,
  ]);

  useEffect(
    () => () => {
      if (
        saveMatchTimerRef.current
      ) {
        clearTimeout(
          saveMatchTimerRef.current,
        );

        saveMatchTimerRef.current =
          null;
      }
    },
    [],
  );

  const updateRoundState =
    useCallback(
      (
        updater: (
          current: OkeyGameState,
        ) => OkeyGameState,
      ) => {
        setMatch((current) => {
          if (current.matchFinished) {
            return current;
          }

          return settleFinishedRound({
            ...current,
            roundState: updater(
              current.roundState,
            ),
          });
        });
      },
      [],
    );


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
    if (isOnline) {
      void reconnectOnline();
      return;
    }

    void clearDisabledSnapshot().catch(
      (error) =>
        console.warn(
          "Unable to clear saved Okey match",
          error,
        ),
    );

    setMatch(
      createInitialOkeyMatch(),
    );
  }, [isOnline, reconnectOnline]);

  const nextRound = useCallback(() => {

    if (isOnline) {
      setMatch((current) => ({
        ...current,
        showRoundResultPopup: false,
        showFinishRevealPopup: false,
        roundResultCountdownRemaining:
          null,
      }));
      return;
    }

    setMatch((current) => {
      if (
        !current.showRoundResultPopup
      ) {
        return current;
      }

      if (
        current.roundState.endReason ===
        "tile-cycle-limit"
      ) {
        return {
          ...current,
          roundState:
            createInitialOkeyGame(
              current.roundState
                .dealerIndex,
            ),
          showRoundResultPopup: false,
          showFinishRevealPopup: false,
          roundResultCountdownRemaining:
            null,
        };
      }

      if (
        !current.roundResults.some(
          (result) =>
            result.round ===
            current.currentRound,
        )
      ) {
        return current;
      }

      if (
        current.matchFinished ||
        current.currentRound >=
          MAX_ROUNDS
      ) {
        return {
          ...current,
          showRoundResultPopup: true,
          roundResultCountdownRemaining:
            null,
          matchFinished: true,
        };
      }

      return {
        ...current,
        roundState:
          createInitialOkeyGame(
            getNextRoundDealerIndex(
              current.roundState,
            ),
          ),
        currentRound:
          current.currentRound + 1,
        showRoundResultPopup: false,
        showFinishRevealPopup: false,
        roundResultCountdownRemaining:
          null,
      };
    });
  }, [isOnline]);

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
      if (isOnline) {
        void dispatchOnline({
          type: "draw",
          source,
        });

        return;
      }

      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "draw",
            source,
          },
        ),
      );
    },
    [
      dispatchOnline,
      isOnline,
      updateRoundState,
    ],
  );

  const discard = useCallback(
    (tileId: string) => {
      if (isOnline) {
        void dispatchOnline({
          type: "discard",
          tileId,
        });

        return;
      }

      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "discard",
            tileId,
          },
        ),
      );
    },
    [
      dispatchOnline,
      isOnline,
      updateRoundState,
    ],
  );

  const sortHand = useCallback(() => {
    updateRoundState((current) =>
      onlineOnlyFallback.apply(
        current,
        {
          type: "sort-hand",
          playerIndex: 0,
        },
      ),
    );
  }, [updateRoundState]);

  const moveTile = useCallback(
    (
      tileId: string,
      targetIndex: number,
    ) => {
      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "move-tile",
            playerIndex: 0,
            tileId,
            targetIndex,
          },
        ),
      );
    },
    [updateRoundState],
  );

  const moveTiles = useCallback(
    (
      tileIds: string[],
      targetIndex: number,
    ) => {
      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "move-tiles",
            playerIndex: 0,
            tileIds,
            targetIndex,
          },
        ),
      );
    },
    [updateRoundState],
  );

  const openMelds = useCallback(
    (
      melds: OkeyMeld[],
      score: number,
    ) => {
      if (isOnline) {
        void dispatchOnline({
          type: "open-melds",
          melds,
          score,
        });

        return;
      }

      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "open-melds",
            playerIndex: 0,
            melds,
            score,
          },
        ),
      );
    },
    [
      dispatchOnline,
      isOnline,
      updateRoundState,
    ],
  );

  const declareKonkan =
    useCallback(() => {
      if (isOnline) {
        void dispatchOnline({
          type: "declare-konkan",
        });

        return;
      }

      updateRoundState((current) =>
        onlineOnlyFallback.apply(
          current,
          {
            type: "declare-konkan",
            playerIndex: 0,
          },
        ),
      );
    }, [
      dispatchOnline,
      isOnline,
      updateRoundState,
    ]);

  const spendTile =
    useCallback(
      (tileId: string) => {

        if (isOnline) {
          return;
        }

        updateRoundState(
          (current) =>
            onlineOnlyFallback.apply(
              current,
              {
                type: "spend-best",
                playerIndex: 0,
                tileId,
              },
            ),
        );
      },
      [isOnline, updateRoundState],
    );

  const spendTileOnTableMeld =
    useCallback(
      (
        tileId: string,
        targetPlayerId: string,
        targetMeldId: string,
      ) => {
        if (isOnline) {
          void dispatchOnline({
            type: "spend-meld",
            tileId,
            targetPlayerId,
            targetMeldId,
          });

          return;
        }

        updateRoundState(
          (current) =>
            onlineOnlyFallback.apply(
              current,
              {
                type: "spend-meld",
                playerIndex: 0,
                tileId,
                targetPlayerId,
                targetMeldId,
              },
            ),
        );
      },
      [
        dispatchOnline,
        isOnline,
        updateRoundState,
      ],
    );

  const lockKonkanSetOnTable =
    useCallback(
      (
        tileId: string,
        targetPlayerId: string,
        targetMeldId: string,
      ) => {
        if (isOnline) {
          void dispatchOnline({
            type: "lock-konkan",
            tileId,
            targetPlayerId,
            targetMeldId,
          });

          return;
        }

        updateRoundState(
          (current) =>
            onlineOnlyFallback.apply(
              current,
              {
                type: "lock-konkan",
                playerIndex: 0,
                tileId,
                targetPlayerId,
                targetMeldId,
              },
            ),
        );
      },
      [
        dispatchOnline,
        isOnline,
        updateRoundState,
      ],
    );

  const spendOrDiscardTile =
    useCallback(
      (tileId: string) => {
        if (isOnline) {
          if (
            state.hasDrawnThisTurn
          ) {
            void dispatchOnline({
              type: "discard",
              tileId,
            });
          }

          return;
        }

        updateRoundState(
          (current) =>
            canSpendTileOnBestMeld(
              current,
              0,
              tileId,
            )
              ? spendTileOnBestMeld(
                  current,
                  0,
                  tileId,
                )
              : current.hasDrawnThisTurn
                ? discardTile(
                    current,
                    tileId,
                  )
                : current,
        );
      },
      [
        dispatchOnline,
        isOnline,
        state.hasDrawnThisTurn,
        updateRoundState,
      ],
    );

  const beginTimeoutHumanTurn =
    useCallback(() => {
      if (isOnline) {
        return null;
      }

      let preparedTileId:
        | string
        | null = null;

      updateRoundState(
        (current) => {
          if (
            current.phase !==
              "playing" ||
            current.currentPlayerIndex !==
              0
          ) {
            return current;
          }

          if (
            current.hasDrawnThisTurn
          ) {
            return resolveTimeoutTurn(
              current,
              0,
            );
          }

          const prepared =
            prepareTimeoutTurn(
              current,
              0,
            );

          preparedTileId =
            prepared.drawnTileId;

          setPendingTimeoutDiscardTileId(
            prepared.drawnTileId,
          );

          return prepared.state;
        },
      );

      return preparedTileId;
    }, [
      isOnline,
      updateRoundState,
    ]);

  const playEliminated =
    useCallback(() => {
      if (isOnline) {
        return;
      }

      updateRoundState(
        (current) =>
          onlineOnlyFallback.apply(
            current,
            {
              type: "play-eliminated",
            },
          ),
      );
    }, [
      isOnline,
      updateRoundState,
    ]);

  const commitPendingTimeoutDiscard =
    useCallback(() => {
      if (isOnline) {
        setPendingTimeoutDiscardTileId(
          null,
        );
        return;
      }

      const tileId =
        pendingTimeoutDiscardTileId;

      if (!tileId) {
        return;
      }

      setPendingTimeoutDiscardTileId(
        null,
      );

      updateRoundState((current) =>
        discardTile(
          current,
          tileId,
        ),
      );
    }, [
      isOnline,
      pendingTimeoutDiscardTileId,
      updateRoundState,
    ]);

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