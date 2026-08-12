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

const oneVsOneHook = read("hooks/useOneVsOneGame.ts");
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

const edgeFiles = [
  "supabase/functions/submit_one_vs_one/move.ts",
  "supabase/functions/submit_one_vs_one/draw.ts",
  "supabase/functions/submit_one_vs_one/pass.ts",
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
const matchmakingScreen = read("app/domino/matchmaking.tsx");
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

const disconnectTakeoverHardening = read(
  "supabase/migrations/20260630000500_reliable_disconnect_bot_takeover.sql",
);
for (const required of [
  "GREATEST(p_grace_seconds, 60)",
  "COALESCE(player.last_seen_at, player.joined_at, player.updated_at) < v_cutoff",
  "SET connected = false",
  "FOR UPDATE OF player SKIP LOCKED",
  "'reason', 'heartbeat_timeout'",
  "takeover_expires_at = now() + interval '60 seconds'",
  "process_one_vs_one_takeovers",
  "process_two_vs_two_takeovers",
]) {
  if (!disconnectTakeoverHardening.includes(required)) {
    failures.push(`Missing disconnect takeover invariant: ${required}`);
  }
}
const scopedTakeover = read(
  "supabase/migrations/20260630000600_scope_disconnect_takeover_to_room.sql",
);
for (const required of [
  "process_one_vs_one_room_takeovers",
  "process_two_vs_two_room_takeovers",
  "player.room_id=p_room_id",
  "pg_advisory_xact_lock",
  "max(move.sequence)",
]) {
  if (!scopedTakeover.includes(required)) {
    failures.push(`Missing room-scoped takeover invariant: ${required}`);
  }
}
const twoVsTwoHook = read("hooks/useTwoVsTwoGame.ts");

const dominoProfileSources = [
  ["1v1", oneVsOneHook],
  ["2v2", twoVsTwoHook],
];
for (const [label, source] of dominoProfileSources) {
  if (matches(source, /\bcups\b/)) {
    failures.push(`${label} must use profiles.points; profiles.cups does not exist.`);
  }

  if (!matches(source, /\.select\(["'][^"']*\bpoints\b[^"']*["']\)/)) {
    failures.push(`${label} profile query must select profiles.points.`);
  }
}

for (const [label, source] of [
  ["1v1", oneVsOneHook],
  ["2v2", twoVsTwoHook],
]) {
  if (
    !matches(
      source,
      /setInterval\(\(\) => void heartbeat\(\), 30_000\)/,
    )
  ) {
    failures.push(`${label} heartbeat must run every 30 seconds.`);
  }

  if (!source.includes("takeoverWatchdogInFlightRef")) {
    failures.push(`${label} active matches have no takeover watchdog.`);
  }

  if (
    !matches(
      source,
      /setInterval\(\(\) => void runTakeoverWatchdog\(\), 10_000\)/,
    )
  ) {
    failures.push(`${label} takeover watchdog is not scheduled.`);
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
