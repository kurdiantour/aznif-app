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
  | "bet_burn"
  | "bet_loss"
  | "bet_win"
  | "manual_purchase"
  | "reward"
  | "reward_bonus"
  | "daily_quest_reward"
  | "shop_purchase"
  | "entry_fee"
  | "payout"
  | "refund"
  | "admin_credit"
  | "admin_debit"
  | "admin_adjustment"
  | "admin_aznif_debit"
  | "admin_treasury_sync"
  | "unknown";

export type WalletTransactionStatus = "pending" | "completed" | "failed";

export type WalletTransaction = {
  id: string;
  user_id: string;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount: number;
  signed_amount?: number;
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
  source?: "wallet_transactions" | "domino_wallet_ledger" | "okey_wallet_ledger";
  game?: "domino" | "okey" | null;
};
