import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrations = [
  '20260921000100_shop_catalog.sql',
  '20260921000200_shop_commerce.sql',
  '20260921000300_multiplayer_cosmetics_foundation.sql',
  '20260921000400_okey_multiplayer_cosmetics.sql',
  '20260921000500_domino_multiplayer_cosmetics.sql',
];

test('canonical cosmetics baseline is exactly five responsibility-scoped migrations', () => {
  for (const file of migrations) assert.doesNotThrow(() => read(`supabase/migrations/${file}`));
});

test('canonical baseline has no price_gold or legacy multiplayer RPC definitions', () => {
  const sql = migrations.map(f => read(`supabase/migrations/${f}`)).join('\n');
  assert.doesNotMatch(sql, /price_gold/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.get_multiplayer_room_(?:table|cosmetics)/i);
});

test('Okey and Domino own their game-specific membership and snapshot logic', () => {
  const foundation = read('supabase/migrations/20260921000300_multiplayer_cosmetics_foundation.sql');
  const okey = read('supabase/migrations/20260921000400_okey_multiplayer_cosmetics.sql');
  const domino = read('supabase/migrations/20260921000500_domino_multiplayer_cosmetics.sql');
  assert.doesNotMatch(foundation, /okey\.match_seats|one_vs_one_players|two_vs_two_players/);
  assert.match(okey, /okey\.match_seats/);
  assert.match(okey, /waiting.*playing/s);
  assert.match(domino, /one_vs_one_players/);
  assert.match(domino, /two_vs_two_players/);
  assert.match(domino, /waiting.*active/s);
});

test('multiplayer winner is driven by database price_gem and per-player sets are retained', () => {
  const okey = read('supabase/migrations/20260921000400_okey_multiplayer_cosmetics.sql');
  const domino = read('supabase/migrations/20260921000500_domino_multiplayer_cosmetics.sql');
  for (const sql of [okey, domino]) {
    assert.match(sql, /resolved\.price_gem\s+DESC/i);
    assert.match(sql, /player_set_asset_keys/);
    assert.match(sql, /resolve_multiplayer_cosmetic/);
  }
});

test('local registries contain current Okey and Domino asset keys without commercial prices', () => {
  const okey = read('constants/catalog/okey-sets.ts');
  const domino = read('constants/catalog/domino-sets.ts');
  for (const id of ['table-classic','table-midnight','table-royal','table-emerald-ivory','table-zagros']) assert.match(okey, new RegExp(`"${id}"`));
  for (const id of ['domino-classic','domino-emerald-ivory']) assert.match(domino, new RegExp(`"${id}"`));
  assert.doesNotMatch(okey, /price_(?:gem|gold)|price\s*:/i);
  assert.doesNotMatch(domino, /price_(?:gem|gold)|price\s*:/i);
});

