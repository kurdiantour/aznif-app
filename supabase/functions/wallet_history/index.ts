import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !authorization) return reply({ error: "unauthorized" }, 401);
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return reply({ error: "unauthorized" }, 401);
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = authData.user.id;
  const [walletResult, dominoResult, okeyResult] = await Promise.all([
    service.from("wallet_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    service.from("domino_wallet_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
    service.schema("okey").from("wallet_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
  ]);
  const error = walletResult.error ?? dominoResult.error ?? okeyResult.error;
  if (error) return reply({ error: "wallet_history_unavailable" }, 500);
  const wallet = (walletResult.data ?? []).map((row) => {
    const hasBalances = row.balance_before != null && row.balance_after != null;
    let signed = hasBalances ? numeric(row.balance_after) - numeric(row.balance_before) : numeric(row.amount);
    if (!hasBalances) {
      const debit = row.from_user_id === userId && row.to_user_id !== userId || ["bet", "bet_burn", "manual_purchase", "shop_purchase"].includes(row.transaction_type);
      signed = debit ? -Math.abs(signed) : Math.abs(signed);
    }
    return { ...row, signed_amount: signed, source: "wallet_transactions", game: null };
  });
  const gameRows = (rows: Record<string, unknown>[], game: "domino" | "okey") => rows.map((row) => ({
    id: row.id, user_id: row.user_id, amount: Math.abs(numeric(row.amount)), signed_amount: numeric(row.amount),
    currency: row.currency === "aznif" ? "MC" : "Coin", transaction_type: row.reason === "prize" ? "payout" : row.reason,
    status: "completed", metadata: row.metadata ?? {}, created_at: row.created_at, source: `${game}_wallet_ledger`, game,
  }));
  const history = [...wallet, ...gameRows(dominoResult.data ?? [], "domino"), ...gameRows(okeyResult.data ?? [], "okey")]
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))).slice(0, 200);
  return reply({ history });
});
