import type { SupabaseClient } from "@supabase/supabase-js";
import { includeGameCommissionBurns } from "./treasury-report";

export type AznifEconomyOverview = {
  totalPlayerAznif: number;
  currentTreasuryAznif: number;
  totalDistributedAznif: number;
  totalReturnedAznif: number;
  totalBurnedAznif: number;
  dominoCommissionBurn: number;
  dominoTakeoverBurn?: number;
  dominoRegularBurn?: number;
  okeyCommissionBurn: number;
  okeyTakeoverBurn?: number;
  okeyRegularBurn?: number;
  betBurnTotal: number;
  totalTakeoverBurn?: number;
  transactionsToday: number;
  initialSupply: number;
  totalLedgerEntries: number;
  updatedAt: string;
};

export type AznifTransaction = {
  id: string;
  user_id: string | null;
  username: string;
  player_id: string;
  amount: number;
  signed_amount: number;
  transaction_type: string;
  display_type: string;
  game_type: "Domino" | "Okey" | "Treasury" | "Platform";
  match_id: string | null;
  created_at: string;
  status: string;
  metadata?: Record<string, unknown>;
  source: string;
};

export type AznifTransactionFilters = {
  category?: string;
  type?: string;
  game?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getAznifEconomyOverview(
  supabase: SupabaseClient,
  rawTreasuryData: Record<string, any>,
): Promise<AznifEconomyOverview> {
  const treasury =
    rawTreasuryData?.dominoCommissionBurn !== undefined
      ? rawTreasuryData
      : await includeGameCommissionBurns(supabase, rawTreasuryData);

  // Calculate transactions today (UTC 00:00:00 to now)
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfTodayIso = startOfToday.toISOString();

  const [walletToday, dominoToday, okeyToday] = await Promise.all([
    supabase
      .from("wallet_transactions")
      .select("id", { count: "exact", head: true })
      .eq("currency", "MC")
      .neq("transaction_type", "admin_commission_withdrawal")
      .gte("created_at", startOfTodayIso),
    supabase
      .from("domino_wallet_ledger")
      .select("id", { count: "exact", head: true })
      .eq("currency", "aznif")
      .gte("created_at", startOfTodayIso),
    supabase
      .schema("okey")
      .from("wallet_ledger")
      .select("id", { count: "exact", head: true })
      .eq("currency", "aznif")
      .gte("created_at", startOfTodayIso),
  ]);

  const transactionsToday =
    (walletToday.count ?? 0) + (dominoToday.count ?? 0) + (okeyToday.count ?? 0);

  const dominoCommissionBurn = Number(treasury.dominoCommissionBurn ?? 0);
  const dominoTakeoverBurn = Number(treasury.dominoTakeoverBurn ?? 0);
  const dominoRegularBurn = Number(treasury.dominoRegularBurn ?? Math.max(0, dominoCommissionBurn - dominoTakeoverBurn));

  const okeyCommissionBurn = Number(treasury.okeyCommissionBurn ?? 0);
  const okeyTakeoverBurn = Number(treasury.okeyTakeoverBurn ?? 0);
  const okeyRegularBurn = Number(treasury.okeyRegularBurn ?? Math.max(0, okeyCommissionBurn - okeyTakeoverBurn));

  return {
    totalPlayerAznif: Number(treasury.userWalletTotal ?? treasury.distributedTotal ?? 0),
    currentTreasuryAznif: Number(treasury.currentBalance ?? 0),
    totalDistributedAznif: Number(treasury.grossDistributedTotal ?? 0),
    totalReturnedAznif: Number(treasury.returnedTotal ?? 0),
    totalBurnedAznif: Number(treasury.burnedTotal ?? 0),
    dominoCommissionBurn,
    dominoTakeoverBurn,
    dominoRegularBurn,
    okeyCommissionBurn,
    okeyTakeoverBurn,
    okeyRegularBurn,
    betBurnTotal: Number(treasury.betBurnTotal ?? 0),
    totalTakeoverBurn: Number(treasury.totalTakeoverBurn ?? 0),
    transactionsToday,
    initialSupply: Number(treasury.initialSupply ?? 0),
    totalLedgerEntries: Number(treasury.totalLedgerEntries ?? 0),
    updatedAt: String(treasury.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeDisplayType(type: string, reason?: string): string {
  const raw = (reason || type || "").toLowerCase();
  if (raw.includes("commission_burn") || raw.includes("house_commission")) return "Commission Burn";
  if (raw.includes("bet_burn")) return "Bet Burn";
  if (raw.includes("burn")) return "Burn";
  if (raw.includes("entry_fee") || raw.includes("bet")) return "Match Entry";
  if (raw.includes("prize") || raw.includes("payout") || raw.includes("win")) return "Match Prize";
  if (raw.includes("refund")) return "Refund";
  if (raw.includes("distribution") || raw.includes("admin_credit")) return "Admin Distribution";
  if (raw.includes("return_to_admin") || raw.includes("return")) return "Treasury Return";
  if (raw.includes("transfer")) return "Player Transfer";
  if (raw.includes("shop_purchase") || raw.includes("purchase")) return "Shop Purchase";
  return type || reason || "Transaction";
}

export async function getAznifTransactions(
  supabase: SupabaseClient,
  filters: AznifTransactionFilters = {},
): Promise<{ transactions: AznifTransaction[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(100, Math.max(10, Number(filters.limit || 50)));

  // Date filters
  let fromIso: string | undefined;
  let toIso: string | undefined;

  if (filters.fromDate) {
    const d = new Date(filters.fromDate);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(0, 0, 0, 0);
      fromIso = d.toISOString();
    }
  }

  if (filters.toDate) {
    const d = new Date(filters.toDate);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 999);
      toIso = d.toISOString();
    }
  }

  // Build queries
  let walletQuery = supabase
    .from("wallet_transactions")
    .select("id,user_id,from_user_id,to_user_id,amount,currency,transaction_type,status,metadata,balance_before,balance_after,created_at")
    .eq("currency", "MC")
    .neq("transaction_type", "admin_commission_withdrawal")
    .order("created_at", { ascending: false })
    .limit(1000);

  let dominoQuery = supabase
    .from("domino_wallet_ledger")
    .select("id,user_id,mode,room_id,currency,amount,reason,idempotency_key,metadata,created_at")
    .eq("currency", "aznif")
    .order("created_at", { ascending: false })
    .limit(1000);

  let okeyQuery = supabase
    .schema("okey")
    .from("wallet_ledger")
    .select("id,user_id,match_id,currency,amount,reason,idempotency_key,metadata,created_at")
    .eq("currency", "aznif")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (fromIso) {
    walletQuery = walletQuery.gte("created_at", fromIso);
    dominoQuery = dominoQuery.gte("created_at", fromIso);
    okeyQuery = okeyQuery.gte("created_at", fromIso);
  }

  if (toIso) {
    walletQuery = walletQuery.lte("created_at", toIso);
    dominoQuery = dominoQuery.lte("created_at", toIso);
    okeyQuery = okeyQuery.lte("created_at", toIso);
  }

  const [walletRes, dominoRes, okeyRes] = await Promise.all([
    walletQuery,
    dominoQuery,
    okeyQuery,
  ]);

  if (walletRes.error) {
    console.error("Wallet transactions query warning:", walletRes.error);
  }
  if (dominoRes.error) {
    console.error("Domino wallet ledger query warning:", dominoRes.error);
  }
  if (okeyRes.error) {
    console.error("Okey wallet ledger query warning:", okeyRes.error);
  }

  const rawWallet = walletRes.data ?? [];
  const rawDomino = dominoRes.data ?? [];
  const rawOkey = okeyRes.data ?? [];

  // Map to unified format
  const mappedWallet: AznifTransaction[] = rawWallet.map((row: any) => {
    const hasBalances = row.balance_before != null && row.balance_after != null;
    let signed = hasBalances
      ? Number(row.balance_after) - Number(row.balance_before)
      : Number(row.amount);

    if (!hasBalances) {
      const isDebit =
        (row.from_user_id === row.user_id && row.to_user_id !== row.user_id) ||
        ["bet", "bet_burn", "manual_purchase", "shop_purchase"].includes(row.transaction_type);
      signed = isDebit ? -Math.abs(signed) : Math.abs(signed);
    }

    const matchId = row.metadata?.match_id || row.metadata?.room_id || null;
    let gameType: "Domino" | "Okey" | "Treasury" | "Platform" = "Platform";

    if (row.metadata?.game === "domino" || String(matchId || "").startsWith("domino")) {
      gameType = "Domino";
    } else if (row.metadata?.game === "okey" || String(matchId || "").startsWith("okey")) {
      gameType = "Okey";
    } else if (row.transaction_type?.includes("admin") || row.transaction_type?.includes("treasury")) {
      gameType = "Treasury";
    }

    return {
      id: row.id,
      user_id: row.user_id,
      username: "",
      player_id: "",
      amount: Math.abs(Number(row.amount || 0)),
      signed_amount: signed,
      transaction_type: row.transaction_type,
      display_type: normalizeDisplayType(row.transaction_type),
      game_type: gameType,
      match_id: matchId ? String(matchId) : null,
      created_at: row.created_at,
      status: row.status || "completed",
      metadata: row.metadata || {},
      source: "wallet_transactions",
    };
  });

  const mappedDomino: AznifTransaction[] = rawDomino.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    username: "",
    player_id: "",
    amount: Math.abs(Number(row.amount || 0)),
    signed_amount: Number(row.amount || 0),
    transaction_type: row.reason,
    display_type: normalizeDisplayType("Domino", row.reason),
    game_type: "Domino",
    match_id: row.room_id || row.metadata?.match_id || null,
    created_at: row.created_at,
    status: "completed",
    metadata: row.metadata || {},
    source: "domino_wallet_ledger",
  }));

  const mappedOkey: AznifTransaction[] = rawOkey.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    username: "",
    player_id: "",
    amount: Math.abs(Number(row.amount || 0)),
    signed_amount: Number(row.amount || 0),
    transaction_type: row.reason,
    display_type: normalizeDisplayType("Okey", row.reason),
    game_type: "Okey",
    match_id: row.match_id || row.metadata?.match_id || null,
    created_at: row.created_at,
    status: "completed",
    metadata: row.metadata || {},
    source: "okey_wallet_ledger",
  }));

  let allTransactions = [...mappedWallet, ...mappedDomino, ...mappedOkey];

  // Collect valid UUID user IDs to safely resolve profiles
  const rawUserIds = Array.from(
    new Set(allTransactions.map((tx) => tx.user_id).filter((id): id is string => Boolean(id))),
  );
  const validUserIds = rawUserIds.filter((id) => typeof id === "string" && UUID_REGEX.test(id));

  if (validUserIds.length > 0) {
    try {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, player_id")
        .in("id", validUserIds.slice(0, 500));

      if (profileError) {
        console.error("Profiles resolution warning:", profileError);
      }

      const profileMap = new Map<string, { username: string; player_id: string }>();
      (profiles ?? []).forEach((p: any) => {
        if (p?.id) {
          profileMap.set(p.id, {
            username: p.username || "Anonymous",
            player_id: p.player_id || p.id.slice(0, 8),
          });
        }
      });

      allTransactions.forEach((tx) => {
        if (tx.user_id && profileMap.has(tx.user_id)) {
          const p = profileMap.get(tx.user_id)!;
          tx.username = p.username;
          tx.player_id = p.player_id;
        } else {
          tx.username = tx.user_id ? `User-${tx.user_id.slice(0, 6)}` : "System";
          tx.player_id = tx.user_id ? tx.user_id.slice(0, 8) : "-";
        }
      });
    } catch (err) {
      console.error("Profile resolution caught:", err);
      allTransactions.forEach((tx) => {
        tx.username = tx.user_id ? `User-${tx.user_id.slice(0, 6)}` : "System";
        tx.player_id = tx.user_id ? tx.user_id.slice(0, 8) : "-";
      });
    }
  }

  // Sort by date descending
  allTransactions.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  // Category filter
  if (filters.category && filters.category !== "all") {
    const cat = filters.category.toLowerCase();
    if (cat === "domino") {
      allTransactions = allTransactions.filter((tx) => tx.game_type.toLowerCase() === "domino");
    } else if (cat === "okey") {
      allTransactions = allTransactions.filter((tx) => tx.game_type.toLowerCase() === "okey");
    } else if (cat === "transfers") {
      allTransactions = allTransactions.filter(
        (tx) =>
          tx.transaction_type.toLowerCase() === "transfer" ||
          tx.display_type.toLowerCase().includes("transfer"),
      );
    } else if (cat === "treasury" || cat === "treasury/admin" || cat === "admin") {
      allTransactions = allTransactions.filter(
        (tx) =>
          tx.game_type.toLowerCase() === "treasury" ||
          tx.transaction_type.toLowerCase().includes("admin") ||
          tx.transaction_type.toLowerCase().includes("distribution") ||
          tx.transaction_type.toLowerCase().includes("return") ||
          tx.display_type.toLowerCase().includes("admin") ||
          tx.display_type.toLowerCase().includes("treasury") ||
          tx.display_type.toLowerCase().includes("distribution") ||
          tx.display_type.toLowerCase().includes("return"),
      );
    } else if (cat === "burns" || cat === "burn") {
      allTransactions = allTransactions.filter(
        (tx) =>
          tx.display_type.toLowerCase().includes("burn") ||
          tx.transaction_type.toLowerCase().includes("burn") ||
          tx.transaction_type.toLowerCase().includes("commission"),
      );
    }
  }

  // Additional fallback type / game filters
  if (filters.game && filters.game !== "all") {
    allTransactions = allTransactions.filter(
      (tx) => tx.game_type.toLowerCase() === filters.game?.toLowerCase(),
    );
  }

  if (filters.type && filters.type !== "all") {
    const searchType = filters.type.toLowerCase();
    allTransactions = allTransactions.filter(
      (tx) =>
        tx.transaction_type.toLowerCase().includes(searchType) ||
        tx.display_type.toLowerCase().includes(searchType),
    );
  }

  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    allTransactions = allTransactions.filter(
      (tx) =>
        tx.username.toLowerCase().includes(q) ||
        tx.player_id.toLowerCase().includes(q) ||
        (tx.match_id && tx.match_id.toLowerCase().includes(q)) ||
        tx.display_type.toLowerCase().includes(q) ||
        tx.transaction_type.toLowerCase().includes(q),
    );
  }

  const total = allTransactions.length;
  const startIndex = (page - 1) * limit;
  const paginated = allTransactions.slice(startIndex, startIndex + limit);

  return {
    transactions: paginated,
    total,
    page,
    limit,
  };
}
