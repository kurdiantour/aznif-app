import type { SupabaseClient } from "@supabase/supabase-js";

type BurnRow = { id: string; amount: number | string; created_at: string; metadata?: Record<string, unknown> };

async function readAllBurns(queryPage: (from: number, to: number) => PromiseLike<{ data: BurnRow[] | null; error: { message: string } | null }>) {
  const rows: BurnRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await queryPage(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export async function includeGameCommissionBurns(supabase: SupabaseClient, treasury: Record<string, any>) {
  const [domino, okey] = await Promise.all([
    readAllBurns((from, to) => supabase.from("domino_wallet_ledger")
      .select("id,amount,created_at,metadata").eq("currency", "aznif").eq("reason", "commission_burn").range(from, to)),
    readAllBurns((from, to) => supabase.schema("okey").from("wallet_ledger")
      .select("id,amount,created_at,metadata").eq("currency", "aznif").eq("reason", "house_commission").range(from, to)),
  ]);
  const gameBurns = [
    ...domino.map((row) => ({ ...row, source: "domino" })),
    ...okey.map((row) => ({ ...row, source: "okey" })),
  ];
  const additionalBurned = gameBurns.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const ledger = [
    ...(Array.isArray(treasury.ledger) ? treasury.ledger : []),
    ...gameBurns.map((row) => ({
      id: `${row.source}:${row.id}`,
      entry_type: "burn",
      amount: Number(row.amount),
      treasury_delta: 0,
      metadata: { ...row.metadata, source: `${row.source}_commission_burn`, source_id: row.id },
      created_at: row.created_at,
    })),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
  return {
    ...treasury,
    burnedTotal: Number(treasury.burnedTotal ?? 0) + additionalBurned,
    totalLedgerEntries: Number(treasury.totalLedgerEntries ?? 0) + gameBurns.length,
    ledger,
  };
}
