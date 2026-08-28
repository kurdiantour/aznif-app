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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unsubscribeRealtimeRef = useRef<(() => void) | null>(null);

  const reconcile = useCallback(async () => {
    await Promise.all([
      input.refreshSnapshot(),
      input.loadPlayers(false),
    ]);
  }, [input.refreshSnapshot, input.loadPlayers]);

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
        if (channel === 'rooms') {
          const reconnected = reconnectAttemptRef.current > 0;
          reconnectAttemptRef.current = 0;
          input.setError(null);

          if (reconnected) {
            void reconcile().catch((reconcileError) => {
              console.warn('2v2 realtime reconnect reconcile failed', reconcileError);
            });
          }
        }
        return;
      }

      if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT') {
        return;
      }

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

          input.applyRealtimeRoom(snapshot);

          // Realtime room payload contains public state only.
          // Fetch one authoritative snapshot to refresh this player's private hand.
          void input.refreshSnapshot().catch((error) => {
            console.warn('2v2 private hand refresh after room update failed', error);
          });
        },
        onRosterInvalidated: () => {
          if (!mounted) return;
          void input.loadPlayers(false).catch((error) => {
            console.warn('2v2 realtime roster refresh failed', error);
          });
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
        if (!mounted) return;

        await Promise.all([
          input.refreshSnapshot(),
          input.loadPlayers(),
        ]);
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
    reconcile,
  ]);

  useEffect(() => {
    if (!input.roomId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;

      void (async () => {
        await reconcile();
      })().catch((error) => {
        console.warn('2v2 AppState reconcile failed', error);
      });
    });

    return () => subscription.remove();
  }, [input.roomId, reconcile]);
}
