type WalletRefreshListener = () => void;

const walletRefreshListeners = new Set<WalletRefreshListener>();

export function subscribeWalletRefresh(listener: WalletRefreshListener) {
  walletRefreshListeners.add(listener);

  return () => {
    walletRefreshListeners.delete(listener);
  };
}

export function notifyWalletRefresh() {
  walletRefreshListeners.forEach((listener) => {
    listener();
  });
}
