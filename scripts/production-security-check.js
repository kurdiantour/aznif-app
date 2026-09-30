const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const failures = [];

const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing required security-check file: ${relativePath}`);
    return "";
  }

  return fs.readFileSync(absolutePath, "utf8");
};

const matches = (source, pattern) => pattern.test(source);

const gameScreen = read("app/domino/game.tsx");
if (gameScreen.includes("award_ai_practice_win")) {
  failures.push("The game client must not settle authoritative rewards.");
}

const oneVsOneHook = read("domino/modes/one-vs-one/presentation/use-one-vs-one-game.ts");
const latestHardening = read(
  "supabase/migrations/20260615000100_remove_private_hand_debug_and_wallet_inserts.sql",
);
const terminalReveal = read(
  "supabase/migrations/20260615000200_terminal_one_vs_one_hand_reveal.sql",
);
for (const forbidden of [
  "debugPrivateHandsRaw",
  "privateHands",
  "one_vs_one_private_states:",
]) {
  if (oneVsOneHook.includes(forbidden))
    failures.push(`1v1 client still consumes private-hand data: ${forbidden}`);
}
if (!latestHardening.includes("- 'debugPrivateHandsRaw'")) {
  failures.push("The latest 1v1 snapshot does not strip all private hands.");
}
for (const required of [
  "IF NOT v_round_finished THEN",
  "RETURN v_safe_snapshot - 'revealedFinalHands'",
  "'revealedFinalHands'",
  "- 'debugPrivateHandsRaw'",
]) {
  if (!terminalReveal.includes(required))
    failures.push(`Missing terminal hand-reveal invariant: ${required}`);
}
if (!oneVsOneHook.includes("rawState?.revealedFinalHands")) {
  failures.push(
    "1v1 round results do not consume the terminal-only final hands.",
  );
}
if (
  oneVsOneHook.includes("rawState?.revealedFinalHands") &&
  !oneVsOneHook.includes("createRoundResult")
) {
  failures.push(
    "Terminal final hands are consumed outside the round-result path.",
  );
}
for (const required of [
  'DROP POLICY IF EXISTS "Users can insert own wallet"',
  "REVOKE INSERT ON public.wallets FROM PUBLIC, anon, authenticated",
]) {
  if (!latestHardening.includes(required))
    failures.push(`Missing wallet hardening invariant: ${required}`);
}

const walletClient = read("lib/wallet.ts");
if (walletClient.includes(".from('wallets')\n      .insert")) {
  failures.push("The client must not create wallet rows directly.");
}

const hardening = read(
  "supabase/migrations/20260613000100_production_security_hardening.sql",
);
for (const required of [
  "Cannot disconnect another player",
  "REVOKE ALL ON FUNCTION public.award_ai_practice_win",
  "TO service_role",
]) {
  if (!hardening.includes(required))
    failures.push(`Missing hardening invariant: ${required}`);
}

const oneVsOneEdgeFiles = [
  "supabase/functions/submit_one_vs_one/move.ts",
  "supabase/functions/submit_one_vs_one/draw.ts",
  "supabase/functions/submit_one_vs_one/pass.ts",
];
const authoritativeCommitCore = read(
  "lib/multiplayer/core/authoritative-commit.ts",
);
if (!matches(authoritativeCommitCore, /rpc\(\s*["']commit_multiplayer_action["']/)) {
  failures.push("Multiplayer commit core bypasses the atomic action commit.");
}
for (const file of oneVsOneEdgeFiles) {
  if (!matches(read(file), /commitMultiplayerAction\(\s*svc\s*,/)) {
    failures.push(`${file} bypasses the shared atomic commit core.`);
  }
}

const edgeFiles = [
  "supabase/functions/submit_two_vs_two/move.ts",
  "supabase/functions/submit_two_vs_two/pass.ts",
  "supabase/functions/process_bot_turns/index.ts",
];

for (const file of edgeFiles) {
  if (!matches(read(file), /rpc\(\s*["']commit_multiplayer_action["']/)) {
    failures.push(`${file} bypasses the atomic action commit.`);
  }
}

const shopClient = read("lib/shop.ts");

if (
  !matches(
    shopClient,
    /rpc\(\s*["']purchase_or_equip_shop_item["']/,
  )
) {
  failures.push(
    "Shop purchases must go through purchase_or_equip_shop_item RPC.",
  );
}

for (const forbidden of [
  '.from("wallets").update',
  ".from('wallets').update",
  '.from("wallets").insert',
  ".from('wallets').insert",
]) {
  if (shopClient.includes(forbidden)) {
    failures.push(
      `Shop client must not mutate wallets directly: ${forbidden}`,
    );
  }
}

const deleteFunction = read("supabase/functions/delete_account/index.ts");
if (
  !matches(
    deleteFunction,
    /admin\.auth\.admin\.deleteUser\(\s*data\.user\.id\s*,?\s*\)/,
  )
) {
  failures.push(
    "Account deletion must target only the authenticated token user.",
  );
}
if (
  !matches(
    deleteFunction,
    /get_active_okey_memberships/,
  )
) {
  failures.push(
    "Account deletion must verify active Okey memberships before deletion.",
  );
}

const privilegeLockdown = read(
  "supabase/migrations/20260613000500_rpc_privilege_lockdown.sql",
);
for (const dangerousFunction of [
  "update_mc_balance",
  "place_room_bet",
  "transfer_mc(uuid, uuid, numeric)",
]) {
  if (
    !privilegeLockdown.includes(
      `REVOKE ALL ON FUNCTION public.${dangerousFunction}`,
    )
  ) {
    failures.push(`Dangerous RPC remains executable: ${dangerousFunction}`);
  }
}

const supabaseConfig = read("supabase/config.toml");
for (const functionName of [
  "submit_one_vs_one",
  "submit_two_vs_two",
  "delete_account",
]) {
  const block =
    supabaseConfig
      .split(`[functions.${functionName}]`)[1]
      ?.split("[functions.")[0] ?? "";
  if (!block.includes("verify_jwt = true"))
    failures.push(`${functionName} must enable gateway JWT verification.`);
}

const sharedGameUtils = read("supabase/functions/_shared/game-utils.ts");
if (sharedGameUtils.includes("@ts-nocheck")) {
  failures.push(
    "Shared Edge Function game utilities must remain type-checked.",
  );
}

const privateRoomScreen = read("app/create-room.tsx");
const matchmakingScreen = read("domino/multiplayer/useDominoWaitingRoom.ts");
const localAiRewardHardening = read(
  "supabase/migrations/20260630000300_harden_local_ai_practice_reward_claims.sql",
);
for (const required of [
  "char_length(v_match_id) <> 36",
  "pg_try_advisory_xact_lock",
  "ON CONFLICT (practice_match_id, user_id) DO NOTHING",
  "REVOKE ALL ON FUNCTION public.award_ai_practice_win",
  "TO authenticated",
]) {
  if (!localAiRewardHardening.includes(required)) {
    failures.push(`Missing local AI reward hardening invariant: ${required}`);
  }
}


const twoVsTwoAdapter = read("domino/modes/two-vs-two/adapters/domino-two-vs-two-supabase-api.ts");

const oneVsOneAdapter = read(
  "domino/modes/one-vs-one/adapters/supabase-domino-one-vs-one-adapter.ts",
);
const dominoProfileSources = [
  ["1v1", oneVsOneAdapter],
  ["2v2", twoVsTwoAdapter],
];
for (const [label, source] of dominoProfileSources) {
  if (matches(source, /\bcups\b/)) {
    failures.push(`${label} must use profiles.points; profiles.cups does not exist.`);
  }

  if (!matches(source, /\.select\(["'][^"']*\bpoints\b[^"']*["']\)/)) {
    failures.push(`${label} profile query must select profiles.points.`);
  }
}



for (const forbidden of [
  "created_at >",
  "count(*)",
  "interval '1 day'",
]) {
  if (localAiRewardHardening.includes(forbidden)) {
    failures.push(
      `Local AI rewards must not impose a win cap: ${forbidden}`,
    );
  }
}

if (
  !matches(
    privateRoomScreen,
    /rpc\(\s*["']create_private_10_aznif_room["']/,
  )
) {
  failures.push("Fixed-price private room creation flow is missing.");
}

if (
  !matches(
    privateRoomScreen,
    /rpc\(\s*["']join_private_10_aznif_room["']/,
  )
) {
  failures.push(
    "Rate-limited private room join-by-code flow is missing.",
  );
}

const gameInvitesMigration = read(
  "supabase/migrations/20260627000200_presence_and_game_invites.sql",
);
for (const required of [
  "CREATE TABLE IF NOT EXISTS public.user_presence",
  "CREATE TABLE IF NOT EXISTS public.game_invites",
  "public.are_friends(auth.uid(), p_recipient_id)",
  "Player is not available",
  "FOR UPDATE",
  "REVOKE ALL ON public.game_invites FROM anon, authenticated",
  "REVOKE ALL ON FUNCTION public.respond_game_invite(uuid, boolean)",
]) {
  if (!gameInvitesMigration.includes(required))
    failures.push(`Missing secure game-invite invariant: ${required}`);
}
if (!matches(matchmakingScreen, /currentMatchType\s*===\s*["']private["']/)) {
  failures.push(
    "Private matchmaking must not depend on the public queue state.",
  );
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Production security invariants passed.");
