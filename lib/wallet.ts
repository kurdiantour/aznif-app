import { CurrencyType, Wallet, WalletTransaction } from "@/types/wallet";
import { supabase } from "./supabase";
import { getCurrentUser } from "./supabaseAuth";

function toNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error("Wallet contains an invalid balance");
  return number;
}

async function getUid(userId?: string) {
  if (userId) return userId;

  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  return user.id;
}

function mapWalletRow(row: any): Wallet {
  return {
    id: row.id,
    user_id: row.user_id,
    balances: {
      mc: toNumber(row.mc),
      coin: toNumber(row.coin),
      gem: toNumber(row.gem),
    },
    updated_at: row.updated_at,
  };
}

export async function getBalance(userId?: string): Promise<Wallet> {
  const uid = await getUid(userId);

  const { data, error } = await supabase
    .from("wallets")
    .select("id, user_id, mc, coin, gem, updated_at")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "Wallet is not initialized. Please sign out and sign in again.",
    );
  }

  return mapWalletRow(data);
}

export async function getTransactions(
  userId?: string,
  currency?: CurrencyType,
): Promise<WalletTransaction[]> {
  const uid = await getUid(userId);

  let query = supabase
    .from("wallet_transactions")
    .select("*")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });

  if (currency) {
    query = query.eq("currency", currency);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as WalletTransaction[];
}

export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  return user.id;
}

export async function transferMc(recipientUserId: string, amount: number) {
  const uid = await getUid();
  const wholeAmount = Math.floor(amount);

  if (recipientUserId === uid) {
    throw new Error("You cannot transfer to yourself.");
  }

  if (!Number.isFinite(amount) || wholeAmount <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const { data, error } = await supabase.rpc("transfer_mc_to_friend", {
    receiver_profile_id: recipientUserId,
    transfer_amount: wholeAmount,
  });

  if (error) throw error;

  return data;
}

// Alias for compatibility
export const transferFunds = transferMc;


export default {
  getBalance,
  getTransactions,
  transferMc,
};
