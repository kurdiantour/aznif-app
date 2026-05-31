import { CurrencyType, Wallet, WalletTransaction } from '@/types/wallet';
import { supabase } from './supabase';
import { getCurrentUser } from './supabaseAuth';

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : parseFloat(String(value));
}

async function getUid(userId?: string) {
  if (userId) return userId;

  const user = await getCurrentUser();
  if (!user) throw new Error('User not authenticated');

  return user.id;
}

function mapWalletRow(row: any): Wallet {
  return {
    id: row.id,
    user_id: row.user_id,
    balances: {
      mc: toNumber(row.mc),
      gold: toNumber(row.gold),
    },
    updated_at: row.updated_at,
  };
}

export async function getBalance(userId?: string): Promise<Wallet> {
  const uid = await getUid(userId);

  const { data, error } = await supabase
    .from('wallets')
    .select('id, user_id, mc, gold, updated_at')
    .eq('user_id', uid)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('wallets')
      .insert({ user_id: uid })
      .select('id, user_id, mc, gold, updated_at')
      .maybeSingle();

    if (insertError) throw insertError;
    return mapWalletRow(inserted);
  }

  return mapWalletRow(data);
}

export async function getTransactions(
  userId?: string,
  currency?: CurrencyType
): Promise<WalletTransaction[]> {
  const uid = await getUid(userId);

  let query = supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });

  if (currency) {
    query = query.eq('currency', currency);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as WalletTransaction[];
}

export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('User not authenticated');
  return user.id;
}

export async function transferMc(recipientUserId: string, amount: number) {
  const uid = await getUid();

  if (recipientUserId === uid) {
    throw new Error('You cannot transfer to yourself.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const { data, error } = await supabase.rpc('transfer_mc', {
    p_from: uid,
    p_to: recipientUserId,
    p_amount: amount,
  });

  if (error) throw error;

  return data;
}

// Alias for compatibility
export const transferFunds = transferMc;
export const CURRENT_USER_ID = 'DEPRECATED: use getCurrentUserId() async function';

export async function placeRoomBet(amount: number) {
  const uid = await getUid();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const { data, error } = await supabase.rpc('place_room_bet', {
    p_user_id: uid,
    p_amount: amount,
  });

  if (error) throw error;

  return data;
}

export async function awardGoldReward(
  amount: number,
  metadata: Record<string, unknown> = {}
) {
  const uid = await getUid();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const { data, error } = await supabase.rpc('award_gold_reward', {
    p_user_id: uid,
    p_amount: amount,
    p_metadata: metadata,
  });

  if (error) throw error;

  return data;
}

export async function spendGoldInShop(
  amount: number,
  metadata: Record<string, unknown> = {}
) {
  const uid = await getUid();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const { data, error } = await supabase.rpc('spend_gold_shop', {
    p_user_id: uid,
    p_amount: amount,
    p_metadata: metadata,
  });

  if (error) throw error;

  return data;
}

export default {
  getBalance,
  getTransactions,
  transferMc,
  placeRoomBet,
  awardGoldReward,
  spendGoldInShop,
};
