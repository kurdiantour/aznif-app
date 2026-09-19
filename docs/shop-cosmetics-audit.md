# Shop / Cosmetics local implementation audit

This work is local only. Do not deploy the migration before reviewing this report,
the final diff, and a read-only inventory of the target database. No remote data
has been inspected; ownership counts on production are unknown.

## Legacy mapping (before any migration execution)

Evidence: `20260613000300_shop_and_account_readiness.sql`,
`20260622000100_shop_gem_purchases.sql`, and
`20260622000400_domino_skins_catalog_defaults.sql`.

| Existing item | Existing asset_key | Proposed handling | Ownership |
| --- | --- | --- | --- |
| skin-ivory | skin-ivory | Retain row/key. Only an equipped free legacy default is replaced with the database-selected Domino default. Keep a bundled legacy asset entry. | Retain all rows |
| skin-obsidian | skin-obsidian | No proven equivalent; retain ID/key and equip. Explicit asset-key entry referencing bundled Classic artwork; no new product or artwork is invented. Hide from new sales. | Retain all rows |
| skin-aurora | skin-aurora | No proven equivalent; retain ID/key and equip. Explicit asset-key entry referencing bundled Classic artwork; no new product or artwork is invented. Hide from new sales. | Retain all rows |
| skin-purple | skin-purple | No proven equivalent; do not infer equivalence to Royal. Retain ID/key and equip. Explicit asset-key entry referencing bundled Classic artwork; no new product or artwork is invented. Hide from new sales. | Retain all rows |
| skin-black-gold | skin-black-gold | No proven equivalent; retain ID/key and equip. Explicit asset-key entry referencing bundled Classic artwork; no new product or artwork is invented. Hide from new sales. | Retain all rows |
| table-skin-midnight | table-midnight | Legacy category table_skin; no ownership/category conversion to tables. Retain unchanged. | Retain all rows |
| tile-skin-ivory | tiles-ivory | Legacy category tile_skin; no conversion to a full Domino set. Retain unchanged. | Retain all rows |
| avatar-frame-violet | frame-violet | Outside the two game-set categories; retain unchanged. | Retain all rows |

The migration must not delete ownership, rewrite purchase ledgers, or map a paid
legacy item to a new product. Legacy placeholders preserve entitlement and identity;
they do not claim to reproduce unavailable historical artwork.

## Business contract

- Database rows define prices, sale visibility (`active`), sale windows,
  temporary promotions, explicit use disabling (`enabled`), and category defaults.
- `active = false` or the end of a sale window never removes paid ownership or
  the right to equip an owned, enabled item.
- Only `enabled = false` explicitly disables use; ownership is still retained.
- A promotion requires two non-null, finite timestamps, start < end, and server
  time in the half-open interval [start, end). It never creates ownership.
- Each managed category has a protected, permanently free default, selected by
  catalog metadata, never by an item-specific resolver branch.
- Bundled registries contain only asset keys and assets. Unknown keys cannot be
  offered for purchase in that app version. Visual fallback never rewrites ownership.
- Multiplayer RPC definitions and room selection contracts are outside this change.

## Validation and final diff

Results are recorded below. Migration validation uses an isolated local database
only; a local fixture is not a production-data audit.

## Historical migration limitation

The committed 20260914133715 Emerald migration refers to price_gem, but the
preceding committed shop schema defines price_gold and no rename exists in the
repository. The historical file is unchanged. The pending migration seeds the
known Emerald item (900, from the existing catalog) only if absent. Local tests
validate against the actual preceding shop migrations; the test suite explicitly
reproduces the historical mismatch. A full fresh replay of all historical
migrations is NOT claimed. Before any future remote action, inspect actual
columns and migration history read-only and reconcile this pre-existing drift.

## Zagros

Zagros is a real fifth Okey bundle. Its row is active=false, price_gem=NULL.
The generic constraint rejects active=true until a non-null price is configured.
No new Domino product, guessed price or artificial fifth bundle is introduced.
There are two current Domino sets plus asset-only aliases for existing legacy IDs.

## Implemented local changes

- The existing pending migration is rewritten in place; no patch migration was added.
- `is_default` plus a partial unique index, check constraint and one generic guard
  designate and protect a permanently free default per managed category. Classic
  identities appear only in seed/backfill data. The existing cover default is also
  registered to preserve that existing category's purchase/equip compatibility.
- `enabled` explicitly controls use. `active`, `available_from` and
  `available_until` control acquisition/sale. Previously owned, enabled products
  remain usable even after being hidden or after their sale window ends.
- `get_my_shop_state()` authenticates the caller and returns only that caller's
  ownership and effective equipment, with server time and catalog metadata.
  There is no public resolved-equipment view.
- `purchase_or_equip_shop_item(text, integer DEFAULT NULL)` replaces the old
  one-argument signature (no ambiguous overload). The optional expected price
  is consent only; price and charge come from the locked database row.
  Missing/stale price consent returns `price_changed`, never an implicit charge.
  Old one-argument calls still support free use/equip, but paid purchases require
  the updated app's explicit expected-price argument.
- The engine locks the catalog row and wallet before resolving access and
  checking ownership. Debit, ledger, permanent ownership and equip commit
  together. Promotional access only equips and never claims ownership.
- Defaults are provisioned by the existing signup hook using catalog metadata,
  with a matching existing-user backfill. Reads resolve missing/expired equip
  to the catalog default without requiring a cron job.
- Registries contain only bundled assets, keyed by `asset_key`. Product IDs,
  titles, prices, availability, promotion and ordering come from the database.
  TypeScript key types derive from registry keys, not a hand-maintained set list.
- Shop filters out unknown bundles and unowned products unavailable for sale.
  Previously owned hidden products remain in the personal collection. Temporary
  access is labelled as temporary and is not labelled as purchased.
- One shared personal lifecycle handles purchase/equip notifications, account
  changes, foreground, a 60-second active-app refresh and promotion/sale boundaries.
  A failed expiry refresh does not keep expired temporary equipment active.
- Okey and Domino retain their renderers. Personal asset resolution joins the
  effective product to its asset key, then to the corresponding game registry.
  Classic constants in registry helpers are emergency *visual* fallbacks only;
  they do not grant entitlement or select a database default.
- Multiplayer room selection and both RPC definitions are unchanged. Providers
  opt out of the personal lifecycle for room games; the existing raw equip read
  and legacy room-preload fallback are retained. In-room promotion expiry and
  opponent cosmetics remain outside this stage, as agreed.

## Final local validation (2026-09-20)

| Command / check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS, no errors or warnings |
| `npm run test:shop` | PASS: 20 SQL/asset tests + 11 client/state/lifecycle tests |
| `npm run test:okey:ui` | PASS: 58 tests in 16 suites |
| `git diff --check` | PASS |

The Okey suite prints missing-Supabase-environment diagnostics in its isolated
test setup; all assertions pass. No remote credentials were supplied to tests.

The SQL suite executes the actual pending migration in an isolated in-memory
PostgreSQL engine via pinned dev dependency `@electric-sql/pglite@0.5.8`.
It loads the real prior shop schema/RLS/RPC migrations and uses a minimal fixture
for external auth/wallet dependencies. It covers:

- Existing/new-user defaults, missing equipment, immutable free-default guarantees.
- Preserved legacy purchases/equipment and the free legacy default backfill.
- Unpriced Zagros; hidden/expired sale windows versus explicit use disabling.
- Valid/invalid/null promotion bounds; inclusive start and exclusive end.
- No temporary ownership/charge; expiry fallback; retained purchased access.
- Atomic successful purchases, insufficient balance, changed prices, missing
  consent, repeated queued requests and transaction rollback on ledger failure.
- RLS isolation, denied direct writes, legacy-RPC denial and RPC authentication.
- Cross-category equip rejection and an arbitrary sixth product with a distinct
  asset key, created only inside a rolled-back test.
- Byte-for-byte equality of PostgreSQL's definitions of both Multiplayer RPCs
  before and after the pending migration.
- Static asset existence/completeness and the pre-existing Emerald history error.

Limits: PGlite serializes a single connection. Queued duplicate requests were
tested; true multi-connection lock contention was not executed. Full Supabase
history replay is blocked by the pre-existing `price_gem` mismatch documented
above, so this is focused migration validation, not a claim that a complete fresh
Supabase reset passes. No remote history, deployed schema, production ownership
counts or device rendering were verified.

## Adding the sixth or tenth real set

1. Add that game's complete artwork under its own `assets/cosmetics/<game>/<set>/`
   folder (explicit Classic artwork reuse is acceptable while artwork is pending).
2. Add one static bundle entry under a distinct key in the appropriate asset
   registry. Types derive automatically from the registry. No purchase/equip
   resolver, hook, RPC, function, trigger or schema change is needed.
3. Insert one `shop_items` row with its independent product ID, matching
   `asset_key`, existing category, title, description, merchant-supplied price,
   sort order and desired availability/promotion. Keep `is_default=false`.
   If the price is undecided, use `price_gem=NULL, active=false`.
4. Ship the app update containing the bundle. Activate the catalog row only when
   ready. Older apps exclude unknown asset keys from purchases and use a visual
   fallback for an unknown equipped bundle without rewriting ownership.

Zagros demonstrates the same path in this implementation. No Zagros-specific
function, predicate, trigger or RPC exists. The synthetic sixth-product test is
rolled back and creates no production/local catalog product.

## Changed-file inventory

Modified tracked files:
- `app/(tabs)/shop.tsx`
- `app/domino/game.tsx`
- `components/game/DominoTile.tsx`
- `constants/catalog/domino-sets.ts`
- `constants/catalog/tables.ts`
- `constants/shop.ts`
- `domino/hooks/useDominoCosmetics.tsx`
- `lib/game/gameLaunchPreload.ts`
- `lib/shop.ts`
- `okey/hooks/useOkeyCosmetics.tsx`
- `package-lock.json`
- `package.json`
- `supabase/migrations/20260919193000_add_domino_sets.sql`

New implementation/report/test files:
- `constants/catalog/cosmetics.ts`
- `docs/shop-cosmetics-audit.md`
- `hooks/useShopState.ts`
- `jest.shop.config.cjs`
- `lib/shop-state.ts`
- `lib/shop-types.ts`
- `scripts/shop-assets.test.mjs`
- `scripts/shop-database.test.mjs`
- `tests/shop/lifecycle.test.tsx`
- `tests/shop/state.test.ts`

Generated review artifact:
- `docs/shop-cosmetics-implementation.diff` contains the complete textual diff
  of the above implementation files, including new/untracked source and tests.
  The artifact excludes itself.

Pre-existing user artwork, not edited by this work:
- `assets/cosmetics/domino/classic/table.webp`
- `assets/cosmetics/domino/classic/tiles/0-0.webp`
- `assets/cosmetics/domino/classic/tiles/0-1.webp`
- `assets/cosmetics/domino/classic/tiles/1-1.webp`
- `assets/cosmetics/domino/classic/tiles/6-6.webp`
- The 59 supplied Zagros files under `assets/cosmetics/okey/zagros/`.

No commit, push, deploy, remote SQL or Supabase migration-history mutation was
performed. The only SQL execution was against the disposable local test engine.
