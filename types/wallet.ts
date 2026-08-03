export type CurrencyType = "MC" | "Coin" | "Gem";

export type WalletBalances = {
  mc: number;
  coin: number;
  gem: number;
};

export type Wallet = {
  id: string;
  user_id: string;
  balances: WalletBalances;
  updated_at: string;
};

export type WalletTransactionType =
  | "transfer"
  | "bet"
  | "manual_purchase"
  | "reward"
  | "reward_bonus"
  | "shop_purchase";

export type WalletTransactionStatus = "pending" | "completed" | "failed";

export type WalletTransaction = {
  id: string;
  user_id: string;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount: number;
  currency: CurrencyType;
  transaction_type: WalletTransactionType;
  status: WalletTransactionStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  balance_before?: number | null;
  balance_after?: number | null;
  balance_before_from?: number | null;
  balance_after_from?: number | null;
  balance_before_to?: number | null;
  balance_after_to?: number | null;
};
