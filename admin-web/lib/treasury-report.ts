import type { SupabaseClient } from "@supabase/supabase-js";

type LedgerEntry = {
  id: string;
  entry_type: string;
  amount: number;
  treasury_delta?: number;
  user_id?: string | null;
  username?: string | null;
  player_id?: string | null;
  wallet_transaction_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

async function readAllBurns(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const rows: any[] = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await fetchPage(from, from + 999);
      if (error) {
        console.warn("readAllBurns query warning:", error);
        break;
      }
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
  } catch (err) {
    console.warn("readAllBurns caught:", err);
  }
  return rows;
}

export async function getRemoteTreasuryReport(
  client: SupabaseClient,
  serviceClient?: SupabaseClient,
) {
  const service = serviceClient || client;

  // 1. Fetch canonical RPC from the database
  let rpcData: any = null;
  const { data, error } = await client.rpc("admin_get_aznif_treasury", { p_limit: 100 });
  if (!error && data) {
    rpcData = data;
  } else if (serviceClient) {
    const { data: sData, error: sError } = await serviceClient.rpc("admin_get_aznif_treasury", { p_limit: 100 });
    if (!sError && sData) {
      rpcData = sData;
    }
  }

  // 2. Fetch Domino and Okey commission burns from their respective remote tables
  const [dominoBurns, okeyBurns] = await Promise.all([
    readAllBurns((from, to) =>
      service
        .from("domino_wallet_ledger")
        .select("id,amount,created_at,metadata")
        .eq("currency", "aznif")
        .eq("reason", "commission_burn")
        .range(from, to),
    ),
    readAllBurns((from, to) =>
      service
        .schema("okey")
        .from("wallet_ledger")
        .select("id,amount,created_at,metadata")
        .eq("currency", "aznif")
        .eq("reason", "house_commission")
        .range(from, to),
    ),
  ]);

  const dominoCommissionBurn = dominoBurns.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const okeyCommissionBurn = okeyBurns.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const dominoTakeoverBurn = dominoBurns
    .filter((r) => r.metadata?.event === "takeover_prize_burn")
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const okeyTakeoverBurn = okeyBurns
    .filter((r) => r.metadata?.event === "takeover_prize_burn")
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const dominoRegularBurn = Math.max(0, dominoCommissionBurn - dominoTakeoverBurn);
  const okeyRegularBurn = Math.max(0, okeyCommissionBurn - okeyTakeoverBurn);
  const totalTakeoverBurn = dominoTakeoverBurn + okeyTakeoverBurn;

  // If RPC returned successfully, parse and aggregate all real data
  if (rpcData) {
    const rawLedger: LedgerEntry[] = Array.isArray(rpcData.ledger) ? rpcData.ledger : [];

    const grossDistributedTotal = rawLedger
      .filter((e) => (e.entry_type || "").toLowerCase() === "distribution")
      .reduce((sum, e) => sum + Number(e.amount || 0), 0) || Number(rpcData.grossDistributedTotal ?? 0);

    const returnedTotal = rawLedger
      .filter((e) => {
        const t = (e.entry_type || "").toLowerCase();
        return t === "return_to_admin" || t === "return";
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const betBurnFromLedger = rawLedger
      .filter((e) => (e.entry_type || "").toLowerCase() === "burn")
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const betBurnTotal = betBurnFromLedger > 0 ? betBurnFromLedger : Number(rpcData.burnedTotal ?? 0);
    const totalBurned = betBurnTotal + dominoCommissionBurn + okeyCommissionBurn;

    const mappedDominoBurns: LedgerEntry[] = dominoBurns.map((row) => ({
      id: `domino:${row.id}`,
      entry_type: "burn",
      amount: Number(row.amount ?? 0),
      treasury_delta: 0,
      user_id: null,
      username: "Domino Match",
      player_id: "-",
      wallet_transaction_id: null,
      metadata: {
        ...row.metadata,
        source: "domino_commission_burn",
        source_id: row.id,
        game: "Domino",
        is_takeover: row.metadata?.event === "takeover_prize_burn",
      },
      created_at: row.created_at,
    }));

    const mappedOkeyBurns: LedgerEntry[] = okeyBurns.map((row) => ({
      id: `okey:${row.id}`,
      entry_type: "burn",
      amount: Number(row.amount ?? 0),
      treasury_delta: 0,
      user_id: null,
      username: "Okey Match",
      player_id: "-",
      wallet_transaction_id: null,
      metadata: {
        ...row.metadata,
        source: "okey_house_commission",
        source_id: row.id,
        game: "Okey",
        is_takeover: row.metadata?.event === "takeover_prize_burn",
      },
      created_at: row.created_at,
    }));

    const treasuryOnlyLedger = rawLedger.filter(
      (e) => (e.entry_type || "").toLowerCase() !== "spend",
    );

    const combinedLedger = [...treasuryOnlyLedger, ...mappedDominoBurns, ...mappedOkeyBurns]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 100);

    return {
      initialSupply: Number(rpcData.initialSupply ?? 1000000000),
      currentBalance: Number(rpcData.currentBalance ?? 0),
      distributedTotal: Number(rpcData.distributedTotal ?? rpcData.userWalletTotal ?? 0),
      grossDistributedTotal,
      netDistributedTotal: Number(rpcData.distributedTotal ?? rpcData.userWalletTotal ?? 0),
      returnedTotal,
      burnedTotal: totalBurned,
      betBurnTotal,
      dominoCommissionBurn,
      dominoTakeoverBurn,
      dominoRegularBurn,
      okeyCommissionBurn,
      okeyTakeoverBurn,
      okeyRegularBurn,
      totalTakeoverBurn,
      adminWalletTotal: Number(rpcData.adminWalletTotal ?? rpcData.currentBalance ?? 0),
      userWalletTotal: Number(rpcData.userWalletTotal ?? rpcData.distributedTotal ?? 0),
      totalLedgerEntries: Number(rpcData.totalLedgerEntries ?? rawLedger.length) + dominoBurns.length + okeyBurns.length,
      createdAt: rpcData.createdAt ?? new Date().toISOString(),
      updatedAt: rpcData.updatedAt ?? new Date().toISOString(),
      ledger: combinedLedger,
    };
  }

  // Fallback: If RPC failed (e.g. dev bypass), query profiles & wallets safely
  const [profilesRes, walletsRes, betBurnRes] = await Promise.all([
    service.from("profiles").select("id,username,player_id,is_admin"),
    service.from("wallets").select("user_id,mc"),
    service.from("wallet_transactions").select("amount").eq("currency", "MC").eq("transaction_type", "bet_burn"),
  ]);

  const initialSupply = 1000000000;
  const profiles = profilesRes.data ?? [];
  const wallets = walletsRes.data ?? [];

  const adminIds = new Set(profiles.filter((p: any) => p.is_admin).map((p: any) => p.id));
  let adminWalletTotal = 0;
  let playerWalletsTotal = 0;

  wallets.forEach((w: any) => {
    const val = Number(w.mc ?? 0);
    if (adminIds.has(w.user_id)) {
      adminWalletTotal += val;
    } else {
      playerWalletsTotal += val;
    }
  });

  const grossDistributedTotal = playerWalletsTotal;
  const returnedTotal = 0;
  const rawLedger: LedgerEntry[] = [];

  const mappedDominoBurns: LedgerEntry[] = dominoBurns.map((row) => ({
    id: `domino:${row.id}`,
    entry_type: "burn",
    amount: Number(row.amount ?? 0),
    treasury_delta: 0,
    user_id: null,
    username: "Domino Match",
    player_id: "-",
    wallet_transaction_id: null,
    metadata: {
      ...row.metadata,
      source: "domino_commission_burn",
      source_id: row.id,
      game: "Domino",
      is_takeover: row.metadata?.event === "takeover_prize_burn",
    },
    created_at: row.created_at,
  }));

  const mappedOkeyBurns: LedgerEntry[] = okeyBurns.map((row) => ({
    id: `okey:${row.id}`,
    entry_type: "burn",
    amount: Number(row.amount ?? 0),
    treasury_delta: 0,
    user_id: null,
    username: "Okey Match",
    player_id: "-",
    wallet_transaction_id: null,
    metadata: {
      ...row.metadata,
      source: "okey_house_commission",
      source_id: row.id,
      game: "Okey",
      is_takeover: row.metadata?.event === "takeover_prize_burn",
    },
    created_at: row.created_at,
  }));

  const treasuryOnlyLedger = rawLedger.filter(
    (e) => (e.entry_type || "").toLowerCase() !== "spend",
  );

  const combinedLedger = [...treasuryOnlyLedger, ...mappedDominoBurns, ...mappedOkeyBurns]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 100);

  return {
    initialSupply,
    currentBalance: adminWalletTotal,
    distributedTotal: playerWalletsTotal,
    grossDistributedTotal,
    netDistributedTotal: playerWalletsTotal,
    returnedTotal,
    burnedTotal: totalBurned,
    betBurnTotal,
    dominoCommissionBurn,
    dominoTakeoverBurn,
    dominoRegularBurn,
    okeyCommissionBurn,
    okeyTakeoverBurn,
    okeyRegularBurn,
    totalTakeoverBurn,
    adminWalletTotal,
    userWalletTotal: playerWalletsTotal,
    totalLedgerEntries: rawLedger.length + dominoBurns.length + okeyBurns.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ledger: combinedLedger,
  };
}

export const includeGameCommissionBurns = getRemoteTreasuryReport;
