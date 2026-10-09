import type { Wallet } from '@/types/wallet';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAuthState, useAuthState } from './auth-state';
import { supabase } from './supabase';
import { getBalance } from './wallet';
import { subscribeWalletRefresh } from './walletEvents';

export type WalletStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';
type WalletContextValue = {
  wallet: Wallet | null;
  status: WalletStatus;
  error: Error | null;
  hasValidWallet: boolean;
  coinBalance: number | null;
  gemBalance: number | null;
  aznifBalance: number | null;
  refreshWallet: () => Promise<Wallet | null>;
};
const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { userId, authReady } = useAuthState();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const walletRef = useRef<Wallet | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const inFlightRef = useRef<Promise<Wallet | null> | null>(null);
  const pendingRefreshRef = useRef(false);

  const publishWallet = useCallback((nextWallet: Wallet | null) => {
    walletRef.current = nextWallet;
    setWallet(nextWallet);
  }, []);

  const refreshWallet = useCallback(async (): Promise<Wallet | null> => {
    if (!userId || getAuthState().userId !== userId) return null;
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      return inFlightRef.current;
    }

    const requestUserId = userId;
    let latestRequestSequence = 0;

    const request = (async (): Promise<Wallet | null> => {
      let latestWallet = walletRef.current;

      do {
        pendingRefreshRef.current = false;
        const requestSequence = ++requestSequenceRef.current;
        latestRequestSequence = requestSequence;
        setStatus(walletRef.current ? 'refreshing' : 'loading');
        setError(null);

        try {
          const nextWallet = await getBalance(requestUserId);
          if (
            activeUserIdRef.current !== requestUserId ||
            getAuthState().userId !== requestUserId ||
            requestSequenceRef.current !== requestSequence
          ) {
            return walletRef.current;
          }

          publishWallet(nextWallet);
          setStatus('ready');
          latestWallet = nextWallet;
        } catch (reason: unknown) {
          if (
            activeUserIdRef.current !== requestUserId ||
            getAuthState().userId !== requestUserId ||
            requestSequenceRef.current !== requestSequence
          ) {
            return walletRef.current;
          }

          setError(reason instanceof Error ? reason : new Error(String(reason)));
          setStatus('error');
          latestWallet = null;
        }
      } while (
        pendingRefreshRef.current &&
        activeUserIdRef.current === requestUserId
      );

      return latestWallet;
    })().finally(() => {
      if (requestSequenceRef.current === latestRequestSequence) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = request;
    return request;
  }, [publishWallet, userId]);

  useEffect(() => {
    if (!authReady) return;
    requestSequenceRef.current += 1;
    inFlightRef.current = null;
    pendingRefreshRef.current = false;
    activeUserIdRef.current = userId;
    // Preserve the existing immediate wallet reset when the auth user changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    publishWallet(null);
    setError(null);
    if (!userId) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    void refreshWallet();
  }, [authReady, publishWallet, refreshWallet, userId]);

  useEffect(
    () => subscribeWalletRefresh(() => void refreshWallet()),
    [refreshWallet],
  );

  useEffect(() => {
    if (!authReady || !userId) return;

    let active = true;
    const channel = supabase
      .channel(`wallet:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          if (active && getAuthState().userId === userId) {
            void refreshWallet();
          }
        },
      )
      .subscribe((status) => {
        if (active && status === 'SUBSCRIBED' && getAuthState().userId === userId) {
          void refreshWallet();
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [authReady, refreshWallet, userId]);

  const currentWallet = wallet?.user_id === userId ? wallet : null;

  const value = useMemo<WalletContextValue>(() => ({
    wallet: currentWallet,
    status,
    error,
    hasValidWallet: currentWallet !== null,
    coinBalance: currentWallet?.balances.coin ?? null,
    gemBalance: currentWallet?.balances.gem ?? null,
    aznifBalance: currentWallet?.balances.mc ?? null,
    refreshWallet,
  }), [currentWallet, error, refreshWallet, status]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
}
