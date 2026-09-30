import { createEmptyBoard } from '@/domino/core/engine/kozel-engine';
import { shouldExitLocalHumanAfterTakeover } from "@/domino/shared/lifecycle/local-takeover-exit-policy";
import { assignDominoBotIdentities } from '@/domino/shared/bot-identity';
import { SupabaseDominoOneVsOneAdapter } from '@/domino/modes/one-vs-one/adapters/supabase-domino-one-vs-one-adapter';
import {
  DominoOneVsOneSnapshotController,
} from '@/domino/modes/one-vs-one/controllers/domino-one-vs-one-controller';
import { useDominoOneVsOneConnectionController } from '@/domino/modes/one-vs-one/controllers/use-domino-one-vs-one-connection-controller';
import { useDominoOneVsOneBotController } from '@/domino/modes/one-vs-one/controllers/use-domino-one-vs-one-bot-controller';
import { useDominoOneVsOneRoundSync } from '@/domino/modes/one-vs-one/controllers/use-domino-one-vs-one-round-sync';
import { useDominoOneVsOneTimeoutController } from '@/domino/modes/one-vs-one/controllers/use-domino-one-vs-one-timeout-controller';
import { MultiplayerRequestError } from '@/lib/multiplayer/core/http-command-client';
import {
  type PendingMultiplayerMove,
} from '@/domino/shared/optimistic/domino-optimistic-move';
import { calculateLevelFromPoints } from '@/lib/progression';
import type {
  DominoTileData,
  KozelBoardState,
  KozelBranch,
  MatchReward,
  ScoringEvent,
  TeamId,
} from '@/domino/types/domino-game';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAvailableBranches,
  handContainsTile,
  handHasPlayableTile,
} from '@/domino/shared/rules/game-rule-queries';
import {
  MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN,
  PLAYER_TURN_DURATION_SECONDS,
  ROUND_TRANSITION_SYNC_MS,
} from '@/domino/shared/game-shared';
import { runMultiplayerAction } from '@/lib/multiplayer/core/multiplayer-action';
import {
  getPlayerIndex,
  getRelativeSeat,
} from '@/lib/multiplayer/core/player-normalization';
import { buildRoundResult } from '@/domino/shared/lifecycle/round-result';
import type { DominoGameViewModel } from '@/domino/shared/contracts/domino-game-view-model';
import { useRoundLifecycle } from '@/domino/shared/lifecycle/use-round-lifecycle';

type UseOneVsOneResult = Omit<
  DominoGameViewModel,
  'playTile' | 'drawTile' | 'passTurn'
> & {
  loading: boolean;
  error: string | null;
  rawState: any;
  myPlayerIndex: number;
  opponentPlayerIndex: number;
  currentUserId: string | null;
  localPlayerTakenOver: boolean;
  drawTimeLeft: number;
  pendingMove: PendingMultiplayerMove | null;
  playTile: (
    tile: DominoTileData,
    branch?: KozelBranch,
  ) => Promise<any>;
  drawTile: () => Promise<boolean>;
  passTurn: () => Promise<boolean>;
  leaveMatch: () => Promise<void>;
};

export function useOneVsOneGame(
  roomId?: string,
  options?: { enabled?: boolean },
): UseOneVsOneResult {
  const isEnabled = options?.enabled ?? Boolean(roomId);
  const [loading, setLoading] = useState(isEnabled);
  const [error, setError] = useState<string | null>(null);
  const [rawState, setRawState] = useState<any>(null);
  const [playersRows, setPlayersRows] = useState<any[]>([]);
  const [profileById, setProfileById] = useState<Map<string, any>>(
    new Map(),
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    null,
  );
  const [pendingMove, setPendingMove] =
    useState<PendingMultiplayerMove | null>(null);

  const matchAdapter = useMemo(
    () =>
      roomId
        ? new SupabaseDominoOneVsOneAdapter(roomId)
        : null,
    [roomId],
  );

  const latestVersionRef = useRef(-1);
  const pendingMoveRef =
    useRef<PendingMultiplayerMove | null>(null);
  const snapshotControllerRef = useRef(
    new DominoOneVsOneSnapshotController(),
  );
  const timeoutSnapshotObserverRef =
    useRef<(state: any) => void>(() => undefined);
  const refreshSnapshotRef =
    useRef<() => Promise<unknown>>(async () => undefined);

  useEffect(() => {
    snapshotControllerRef.current =
      new DominoOneVsOneSnapshotController();
    latestVersionRef.current = -1;
    pendingMoveRef.current = null;
    setPendingMove(null);
  }, [roomId]);

  const applySnapshot = useCallback((snapshot: any) => {
    if (!snapshotControllerRef.current.apply(snapshot)) {
      return false;
    }

    const version =
      snapshotControllerRef.current.getVersion();

    latestVersionRef.current = version;

    const nextRawState =
      snapshotControllerRef.current.getSnapshot();

    timeoutSnapshotObserverRef.current(nextRawState);
    setRawState(nextRawState);

    const reconciledPending =
      snapshotControllerRef.current.getPendingMove();

    pendingMoveRef.current = reconciledPending;
    setPendingMove(reconciledPending);

    return true;
  }, []);

  const { refreshSnapshot } =
    useDominoOneVsOneConnectionController({
      roomId,
      enabled: isEnabled,
      adapter: matchAdapter,
      loading,
      status: rawState?.status,
      roundWinnerPlayerId:
        rawState?.roundWinnerPlayerId ?? null,
      winningTeamId:
        rawState?.winningTeamId ?? null,
      rawState,
      currentUserId,
      players: playersRows,
      privateHandCount: Array.isArray(rawState?.myHand)
        ? rawState.myHand.length
        : 0,
      applySnapshot,
      setLoading,
      setError,
      setCurrentUserId,
      setPlayers: setPlayersRows,
      setProfiles: setProfileById,
    });

  refreshSnapshotRef.current = refreshSnapshot;

  const applySuccessfulAction = useCallback(
    async (result: any) => {
      if (!result?.ok) return false;

      const actionSnapshot = {
        ...(result.room ?? {}),
        state:
          result.state ??
          result.room?.state ??
          {},
      };

      applySnapshot(actionSnapshot);
      setError(null);

      return true;
    },
    [applySnapshot],
  );

  const currentTurnPlayerId =
    rawState?.currentTurnPlayerId ?? '';

  const roundWinnerPlayerId =
    rawState?.roundWinnerPlayerId ?? null;

  const winningTeamId =
    rawState?.winningTeamId ?? null;

  const reconcileSnapshot = useCallback(
    () => refreshSnapshotRef.current(),
    [],
  );

  const {
    turnTimeLeft,
    drawTimeLeft,
    acceptSnapshot,
  } = useDominoOneVsOneTimeoutController({
    roomId,
    adapter: matchAdapter,
    rawState,
    currentTurnPlayerId,
    roundWinnerPlayerId,
    winningTeamId,
    currentUserId,
    turnDurationSeconds:
      PLAYER_TURN_DURATION_SECONDS,
    reconcile: reconcileSnapshot,
  });

  timeoutSnapshotObserverRef.current =
    acceptSnapshot;

  useDominoOneVsOneBotController({
    roomId,
    loading,
    currentTurnPlayerId,
    roundWinnerPlayerId,
    winningTeamId,
    players: playersRows,
    adapter: matchAdapter,
    refreshSnapshot,
  });

  const createRoundResult = useCallback(
    (winnerId: string) => {
      if (playersRows.length < 2) {
        return null;
      }

      const winnerTeam = playersRows.find(
        (row) =>
          (row.user_id ?? `bot-${row.id}`) ===
          winnerId,
      )?.team_id;

      const players = playersRows.map((row) => ({
        id:
          row.user_id ??
          `bot-${row.id}`,
        playerIndex:
          typeof row.player_index === 'number'
            ? row.player_index
            : -1,
      }));

      const awardedPoints =
        rawState?.endOfHandScoringEvent?.points ?? 0;

      if (
        !Array.isArray(rawState?.revealedFinalHands) ||
        rawState.revealedFinalHands.length < 2
      ) {
        return null;
      }

      return buildRoundResult({
        winnerId,
        winnerTeam,
        endReason:
          rawState?.roundEndReason ?? undefined,
        awardedPoints,
        players,
        hands: rawState.revealedFinalHands,
      });
    },
    [playersRows, rawState],
  );

  const { startNextRound } =
    useDominoOneVsOneRoundSync({
      roomId,
      adapter: matchAdapter,
      roundWinnerPlayerId,
      winningTeamId,
      status: rawState?.status,
      hasAuthoritativeActiveHand:
        rawState?.status === 'started' &&
        !roundWinnerPlayerId &&
        !winningTeamId &&
        !!rawState?.currentTurnPlayerId &&
        Array.isArray(rawState?.myHand) &&
        rawState.myHand.length > 0,
      syncIntervalMs:
        ROUND_TRANSITION_SYNC_MS,
      applySnapshot,
      refreshSnapshot,
    });

  const {
    phase,
    roundResult,
    completedFinalRevealKey,
    nextRoundCountdown,
    resetRoundPresentation,
  } = useRoundLifecycle({
    roundWinnerPlayerId,
    winningTeamId,
    buildRoundResult: createRoundResult,
    startNextRound,
  });

  const myPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;

    return getPlayerIndex(
      playersRows,
      (row) => row.user_id === currentUserId,
    );
  }, [playersRows, currentUserId]);

  const opponentPlayerIndex = useMemo(() => {
    if (!currentUserId) return -1;

    return getPlayerIndex(
      playersRows,
      (row) => row.user_id !== currentUserId,
    );
  }, [playersRows, currentUserId]);

  const localPlayerTakenOver = useMemo(
    () =>
      shouldExitLocalHumanAfterTakeover(
        currentUserId,
        playersRows,
      ),
    [playersRows, currentUserId],
  );

  const players = useMemo(() => {
    const state = rawState ?? {};
    const handCounts = state.handCounts ?? [];

    const botIdentities =
      assignDominoBotIdentities(
        playersRows.map((row) => ({
          id: String(row.id),
          playerIndex:
            typeof row.player_index === 'number'
              ? row.player_index
              : 0,
        })),
      );

    return playersRows.map((row) => {
      const playerId =
        row.user_id ?? `bot-${row.id}`;

      const profile = row.user_id
        ? profileById.get(row.user_id)
        : null;

      const playerIndex =
        typeof row.player_index === 'number'
          ? row.player_index
          : 0;

      const isBot =
        row.bot_takeover ||
        row.kind === 'bot' ||
        !row.user_id;

      const botIdentity = isBot
        ? botIdentities.get(String(row.id))
        : undefined;

      return {
        id: playerId,

        name: isBot
          ? botIdentity!.name
          : profile?.username ?? 'Player',

        seat: getRelativeSeat(
          playerIndex,
          myPlayerIndex,
          2,
        ),

        kind: row.kind,
        teamId: row.team_id,

        isActive:
          playerId ===
          state.currentTurnPlayerId,

        timeLeft:
          playerId ===
          state.currentTurnPlayerId
            ? turnTimeLeft
            : PLAYER_TURN_DURATION_SECONDS,

        tileCount:
          handCounts[playerIndex] ?? 0,

        score:
          state.teamScores?.[row.team_id] ?? 0,

        isLeader: state.leaderPlayerId
          ? playerId === state.leaderPlayerId
          : false,

        avatarId: isBot
          ? botIdentity!.avatarId
          : profile?.avatar_id,

        avatarUrl: isBot
          ? botIdentity!.avatarUrl
          : profile?.avatar_url,

        level: calculateLevelFromPoints(
          profile?.points,
        ),

        points: profile?.points,
      };
    });
  }, [
    playersRows,
    profileById,
    rawState,
    myPlayerIndex,
    turnTimeLeft,
    drawTimeLeft,
  ]);

  const board: KozelBoardState =
    rawState?.board ?? createEmptyBoard();

  const teamScores: Record<TeamId, number> = {
    teamA:
      rawState?.teamScores?.teamA ?? 0,
    teamB:
      rawState?.teamScores?.teamB ?? 0,
  };

  const myHand: DominoTileData[] =
    useMemo(() => {
      return rawState?.myHand ?? [];
    }, [rawState]);

  useEffect(() => {
    const hasAuthoritativeActiveHand =
      rawState?.status === 'started' &&
      !rawState?.roundWinnerPlayerId &&
      !rawState?.winningTeamId &&
      !!rawState?.currentTurnPlayerId &&
      myHand.length > 0;

    if (!hasAuthoritativeActiveHand) {
      return;
    }

    resetRoundPresentation();
  }, [
    rawState?.status,
    rawState?.roundWinnerPlayerId,
    rawState?.winningTeamId,
    rawState?.currentTurnPlayerId,
    myHand.length,
    resetRoundPresentation,
  ]);

  const openingDouble =
    typeof rawState?.openingDouble === 'number'
      ? rawState.openingDouble
      : null;

  const isOpeningRound = Boolean(
    rawState?.isOpeningRound ??
      rawState?.isFirstRound ??
      true,
  );

  const playabilityContext = {
    board,
    spinnerValue:
      rawState?.spinnerValue ?? null,
    isOpeningRound,
    openingDouble,
  };

  const availableBranchesForTile = (
    tile: DominoTileData,
  ): KozelBranch[] =>
    getAvailableBranches(
      tile,
      playabilityContext,
    );

  const hasPlayableTile = useMemo(() => {
    return handHasPlayableTile(
      myHand,
      playabilityContext,
    );
  }, [
    myHand,
    board,
    rawState,
    isOpeningRound,
    openingDouble,
  ]);

  const playTile = async (
    tile: DominoTileData,
    branch?: KozelBranch,
  ) => {
    if (!roomId) {
      throw new Error('No 1v1 room id');
    }

    if (pendingMoveRef.current) {
      return false;
    }

    const tileInMyHand =
      handContainsTile(
        myHand,
        tile.id,
      );

    if (!tileInMyHand) {
      console.warn(
        '[1v1 playTile blocked: tile not in myHand]',
        {
          roomId,
          currentUserId,
          myPlayerIndex,
          opponentPlayerIndex,
          tileId:
            tile?.id ?? null,
          myHandIds: myHand.map(
            (handTile) => handTile.id,
          ),
        },
      );

      return false;
    }

    const resolvedBranch =
      branch ??
      availableBranchesForTile(tile)[0];

    if (!resolvedBranch) {
      return false;
    }

    const pending =
      snapshotControllerRef.current.beginOptimisticMove({
        roomId,
        tile,
        branch: resolvedBranch,
        baseVersion:
          latestVersionRef.current,
        board,
        spinnerValue:
          rawState?.spinnerValue ?? null,
        isOpeningRound,
      });

    pendingMoveRef.current = pending;
    setPendingMove(pending);

    try {
      const result =
        await matchAdapter!.dispatch({
          type: 'play',
          tile,
          branch: resolvedBranch,
        });

      await applySuccessfulAction(result);

      return result;
    } catch (error) {
      if (
        error instanceof MultiplayerRequestError &&
        error.ambiguous
      ) {
        try {
          await refreshSnapshot();

          if (!pendingMoveRef.current) {
            return { ok: true };
          }
        } catch {
          // The original request remains unconfirmed; roll back the visual layer.
        }
      }

      if (
        pendingMoveRef.current?.requestId ===
        pending.requestId
      ) {
        snapshotControllerRef.current.clearPendingMove(
          pending.requestId,
        );
        pendingMoveRef.current = null;
        setPendingMove(null);
      }

      throw error;
    }
  };

  const drawTile = async () => {
    if (!roomId) {
      return false;
    }

    return runMultiplayerAction({
      action: () =>
        matchAdapter!.dispatch({
          type: 'draw',
        }),
      onSuccess:
        applySuccessfulAction,
      errorLabel:
        '1v1 draw failed',
    });
  };

  const passTurn = async () => {
    if (!roomId) {
      return false;
    }

    return runMultiplayerAction({
      action: () =>
        matchAdapter!.dispatch({
          type: 'pass',
        }),
      onSuccess:
        applySuccessfulAction,
      errorLabel:
        '1v1 pass failed',
    });
  };

  const leaveMatch = useCallback(async () => {
    if (!matchAdapter) {
      return;
    }

    await matchAdapter.leave();
  }, [matchAdapter]);

  return {
    loading,
    error,

    drawTimeLeft,

    players,
    currentTurnPlayerId,
    board,
    myHand,

    boneyardCount:
      rawState?.boneyardCount ?? 0,

    mode: '1v1',

    roundWinnerPlayerId:
      rawState?.roundWinnerPlayerId ?? null,

    lastPlayedTile:
      rawState?.lastPlayedTile ?? null,

    lastScoringEvent:
      rawState?.lastScoringEvent as
        | ScoringEvent
        | null,

    endOfHandScoringEvent:
      rawState?.endOfHandScoringEvent as
        | ScoringEvent
        | null,

    teamScores,

    winningTeamId:
      rawState?.winningTeamId ?? null,

    matchReward:
      rawState?.matchReward as
        | MatchReward
        | null,

    leaderPlayerId:
      rawState?.leaderPlayerId ??
      players[0]?.id ??
      '',

    isFirstRound:
      isOpeningRound,

    availableBranchesForTile,
    playTile,
    passTurn,
    drawTile,
    leaveMatch,

    canDrawTile:
      rawState?.canDrawTile === true &&
      !!currentUserId &&
      currentTurnPlayerId ===
        currentUserId &&
      !hasPlayableTile &&
      (rawState?.boneyardCount ?? 0) >
        0 &&
      Number(
        rawState?.currentTurnDrawCount ??
          0,
      ) <
        MAX_ONE_VS_ONE_HUMAN_DRAWS_PER_TURN &&
      !rawState?.roundWinnerPlayerId &&
      !rawState?.winningTeamId,

    hasPlayableTile,

    lastPassedPlayerId:
      rawState?.lastPassedPlayerId ??
      null,

    rawState,
    pendingMove,
    myPlayerIndex,
    opponentPlayerIndex,
    currentUserId,
    localPlayerTakenOver,

    phase,
    roundResult,
    completedFinalRevealKey,
    nextRoundCountdown,
  };
}