const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

const gameScreen = read('app/game.tsx');
if (gameScreen.includes('award_ai_practice_win') || gameScreen.includes('settle_match_rewards')) {
  failures.push('The game client must not settle authoritative rewards.');
}

const oneVsOneHook = read('hooks/useOneVsOneGame.ts');
const latestHardening = read('supabase/migrations/20260615000100_remove_private_hand_debug_and_wallet_inserts.sql');
const terminalReveal = read('supabase/migrations/20260615000200_terminal_one_vs_one_hand_reveal.sql');
for (const forbidden of ['debugPrivateHandsRaw', 'privateHands', 'one_vs_one_private_states:']) {
  if (oneVsOneHook.includes(forbidden)) failures.push(`1v1 client still consumes private-hand data: ${forbidden}`);
}
if (!latestHardening.includes("- 'debugPrivateHandsRaw'")) {
  failures.push('The latest 1v1 snapshot does not strip all private hands.');
}
for (const required of [
  "IF NOT v_round_finished THEN",
  "RETURN v_safe_snapshot - 'revealedFinalHands'",
  "'revealedFinalHands'",
  "- 'debugPrivateHandsRaw'",
]) {
  if (!terminalReveal.includes(required)) failures.push(`Missing terminal hand-reveal invariant: ${required}`);
}
if (!oneVsOneHook.includes('rawState?.revealedFinalHands')) {
  failures.push('1v1 round results do not consume the terminal-only final hands.');
}
if (oneVsOneHook.includes('rawState?.revealedFinalHands') && !oneVsOneHook.includes('createRoundResult')) {
  failures.push('Terminal final hands are consumed outside the round-result path.');
}
for (const required of ['DROP POLICY IF EXISTS "Users can insert own wallet"', 'REVOKE INSERT ON public.wallets FROM PUBLIC, anon, authenticated']) {
  if (!latestHardening.includes(required)) failures.push(`Missing wallet hardening invariant: ${required}`);
}

const walletClient = read('lib/wallet.ts');
if (walletClient.includes(".from('wallets')\n      .insert")) {
  failures.push('The client must not create wallet rows directly.');
}

const hardening = read('supabase/migrations/20260613000100_production_security_hardening.sql');
for (const required of [
  'Cannot disconnect another player',
  'REVOKE ALL ON FUNCTION public.award_ai_practice_win',
  'REVOKE ALL ON FUNCTION public.settle_match_rewards',
  'TO service_role',
]) {
  if (!hardening.includes(required)) failures.push(`Missing hardening invariant: ${required}`);
}

const edgeFiles = [
  'supabase/functions/submit_one_vs_one/move.ts',
  'supabase/functions/submit_one_vs_one/draw.ts',
  'supabase/functions/submit_one_vs_one/pass.ts',
  'supabase/functions/submit_two_vs_two/move.ts',
  'supabase/functions/submit_two_vs_two/pass.ts',
  'supabase/functions/process_bot_turns/index.ts',
];

for (const file of edgeFiles) {
  if (!read(file).includes("rpc('commit_multiplayer_action'")) {
    failures.push(`${file} bypasses the atomic action commit.`);
  }
}

const shopMigration = read('supabase/migrations/20260613000300_shop_and_account_readiness.sql');
for (const required of ['purchase_shop_item', 'FOR UPDATE', 'UNIQUE (user_id, item_id)', 'REVOKE ALL ON FUNCTION public.spend_gold_shop']) {
  if (!shopMigration.includes(required)) failures.push(`Missing shop invariant: ${required}`);
}

const deleteFunction = read('supabase/functions/delete_account/index.ts');
if (!deleteFunction.includes('admin.auth.admin.deleteUser(data.user.id)')) {
  failures.push('Account deletion must target only the authenticated token user.');
}

const privilegeLockdown = read('supabase/migrations/20260613000500_rpc_privilege_lockdown.sql');
for (const dangerousFunction of [
  'update_mc_balance',
  'update_gold_balance',
  'award_gold_reward',
  'spend_gold_shop',
  'place_room_bet',
  'transfer_mc(uuid, uuid, numeric)',
]) {
  if (!privilegeLockdown.includes(`REVOKE ALL ON FUNCTION public.${dangerousFunction}`)) {
    failures.push(`Dangerous RPC remains executable: ${dangerousFunction}`);
  }
}

const supabaseConfig = read('supabase/config.toml');
for (const functionName of ['submit_one_vs_one', 'submit_two_vs_two', 'delete_account']) {
  const block = supabaseConfig.split(`[functions.${functionName}]`)[1]?.split('[functions.')[0] ?? '';
  if (!block.includes('verify_jwt = true')) failures.push(`${functionName} must enable gateway JWT verification.`);
}

const sharedGameUtils = read('supabase/functions/_shared/game-utils.ts');
if (sharedGameUtils.includes('@ts-nocheck')) {
  failures.push('Shared Edge Function game utilities must remain type-checked.');
}

const privateRoomScreen = read('app/create-room.tsx');
const matchmakingScreen = read('app/matchmaking.tsx');
if (!privateRoomScreen.includes("rpc('join_one_vs_one_room'")) {
  failures.push('Private room join-by-code flow is missing.');
}
if (!matchmakingScreen.includes("currentMatchType === 'private'")) {
  failures.push('Private matchmaking must not depend on the public queue state.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Production security invariants passed.');
