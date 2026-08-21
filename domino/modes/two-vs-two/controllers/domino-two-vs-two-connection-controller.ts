import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { DominoTwoVsTwoAdapter } from '../adapters/domino-two-vs-two-adapter';

export function useDominoTwoVsTwoConnectionController(input: {
  roomId?: string;
  loading: boolean;
  status?: string | null;
  winningTeamId?: string | null;
  handCounts?: unknown;
  playersCount: number;
  adapter: DominoTwoVsTwoAdapter | null;
  refreshSnapshot: () => Promise<unknown>;
  loadPlayers: (includeProfiles?: boolean) => Promise<unknown>;
  applyRealtimeRoom: (snapshot: unknown) => void;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  setCurrentUserId: (value: string | null) => void;
  rawState?: any;
  currentUserId?: string | null;
  players?: any[];
  privateHandCount?: number;
}) {
  const lastRealtimeActivityRef = useRef(Date.now());
  const pollInFlightRef = useRef(false);
  const takeoverRosterInFlightRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unsubscribeRealtimeRef = useRef<(() => void) | null>(null);

  const markRealtimeActivity = useCallback(() => {
    lastRealtimeActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!input.roomId || !input.adapter) {
      input.setError('No 2v2 room id');
      input.setLoading(false);
      return;
    }
    let mounted = true;
    let subscribe = () => {};

    const handleStatus = (
      channel: string,
      status: string,
      error?: unknown,
    ) => {
      if (!mounted) return;
      if (status === 'SUBSCRIBED') {
        reconnectAttemptRef.current = 0;
        markRealtimeActivity();
        input.setError(null);
        void input.refreshSnapshot();
        void input.loadPlayers();
        return;
      }
      if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') return;
      console.warn(`2v2 Realtime ${channel} status: ${status}`, error);
      const delay = Math.min(
        1000 * Math.pow(2, reconnectAttemptRef.current),
        15000,
      );
      reconnectAttemptRef.current += 1;
      if (!reconnectTimerRef.current && mounted) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (mounted) subscribe();
        }, delay);
      }
    };

    subscribe = () => {
      unsubscribeRealtimeRef.current?.();
      unsubscribeRealtimeRef.current = input.adapter!.subscribe({
        onRoomInvalidated: (snapshot) => {
          if (!mounted) return;
          markRealtimeActivity();
          input.applyRealtimeRoom(snapshot);
          void input.refreshSnapshot().catch((error) => {
            console.warn('2v2 private hand refresh after room realtime update failed', error);
          });
        },
        onRosterInvalidated: () => {
          if (!mounted) return;
          markRealtimeActivity();
          void input.loadPlayers();
        },
        onStatus: handleStatus,
      });
    };

    const boot = async () => {
      try {
        input.setLoading(true);
        input.setError(null);
        const userId = await input.adapter!.getCurrentUserId();
        if (!mounted) return;
        input.setCurrentUserId(userId);
        await Promise.all([input.refreshSnapshot(), input.loadPlayers()]);
        if (!mounted) return;
        subscribe();
        input.setLoading(false);
      } catch (error: any) {
        if (!mounted) return;
        input.setError(error?.message ?? String(error));
        input.setLoading(false);
      }
    };
    void boot();

    return () => {
      mounted = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      unsubscribeRealtimeRef.current?.();
      unsubscribeRealtimeRef.current = null;
    };
  }, [
    input.roomId,
    input.adapter,
    input.applyRealtimeRoom,
    input.loadPlayers,
    input.refreshSnapshot,
    input.setCurrentUserId,
    input.setError,
    input.setLoading,
    markRealtimeActivity,
  ]);

  useEffect(() => {
    if (!input.roomId) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void Promise.all([input.refreshSnapshot(), input.loadPlayers(false)])
        .then(markRealtimeActivity)
        .catch((error) => console.warn('2v2 AppState reconcile failed', error));
    });
    return () => subscription.remove();
  }, [input.roomId, input.refreshSnapshot, input.loadPlayers, markRealtimeActivity]);

  useEffect(() => {
    if (
      !input.roomId ||
      input.loading ||
      input.status === 'finished' ||
      input.winningTeamId
    ) return;
    const pollFallbackWatchdog = async () => {
      if (
        pollInFlightRef.current ||
        Date.now() - lastRealtimeActivityRef.current < 12_000
      ) return;
      pollInFlightRef.current = true;
      try {
        await input.refreshSnapshot();
        markRealtimeActivity();
      } catch (error) {
        console.warn('2v2 snapshot fallback watchdog failed', error);
      } finally {
        pollInFlightRef.current = false;
      }
    };
    const interval = setInterval(() => void pollFallbackWatchdog(), 5000);
    return () => {
      clearInterval(interval);
      pollInFlightRef.current = false;
    };
  }, [
    input.roomId,
    input.loading,
    input.status,
    input.winningTeamId,
    input.refreshSnapshot,
    markRealtimeActivity,
  ]);

  useEffect(() => {
    if (!input.roomId || input.loading) return;

    const reconcileTakeoverRoster = async () => {
      if (takeoverRosterInFlightRef.current) return;
      takeoverRosterInFlightRef.current = true;
      try {
        await input.loadPlayers(false);
      } catch (error) {
        console.warn('2v2 takeover roster reconcile failed', error);
      } finally {
        takeoverRosterInFlightRef.current = false;
      }
    };

    void reconcileTakeoverRoster();
    const interval = setInterval(() => void reconcileTakeoverRoster(), 2_000);
    return () => {
      clearInterval(interval);
      takeoverRosterInFlightRef.current = false;
    };
  }, [input.roomId, input.loading, input.loadPlayers]);
  useEffect(() => {
    if (!input.roomId || input.loading || !input.rawState) return;
    if (
      input.rawState.roundWinnerPlayerId ||
      input.rawState.winningTeamId ||
      input.rawState.status === 'finished' ||
      (input.privateHandCount ?? 0) > 0
    ) return;

    const playerIndex = input.players?.find(
      (row) => row.user_id === input.currentUserId,
    )?.player_index;
    const expectedHandCount = Number(input.rawState.handCounts?.[playerIndex] ?? 0);
    if (expectedHandCount <= 0) return;

    const retry = setTimeout(() => {
      void input.refreshSnapshot().catch((error) => console.warn('2v2 private hand snapshot retry failed', error));
    }, 350);
    return () => clearTimeout(retry);
  }, [
    input.roomId,
    input.loading,
    input.rawState,
    input.privateHandCount,
    input.players,
    input.currentUserId,
    input.refreshSnapshot,
  ]);}
