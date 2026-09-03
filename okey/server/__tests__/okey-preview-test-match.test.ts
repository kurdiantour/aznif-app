import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import test from "node:test";

const read = (
  path: string,
) =>
  readFileSync(
    path,
    "utf8",
  );

const migration =
  read(
    "supabase/migrations/20260824141125_okey_preview_test_matches.sql",
  );

const legacyCleanup =
  read(
    "supabase/migrations/20260831072553_remove_legacy_okey_preview_test_rpcs.sql",
  );

const waitingMigrationName =
  readdirSync(
    "supabase/migrations",
  ).find((name) =>
    name.endsWith(
      "_okey_preview_two_admin_waiting_room.sql",
    ),
  );

assert.ok(
  waitingMigrationName,
  "missing okey_preview_two_admin_waiting_room migration",
);

const waitingMigration =
  read(
    `supabase/migrations/${waitingMigrationName}`,
  );

const gateway =
  read(
    "supabase/functions/okey_test_match/index.ts",
  );

const matchGateway =
  read(
    "supabase/functions/okey_match/index.ts",
  );

const worker =
  read(
    "supabase/functions/process_bot_turns/index.ts",
  );

const executor =
  read(
    "okey/server/okey-bot-executor.ts",
  );

const preview =
  read(
    "app/okey/preview.tsx",
  );

test(
  "Okey Preview creates an admin-only two-human waiting match",
  () => {
    assert.match(
      gateway,
      /\.select\("username, is_admin"\)/,
    );

    assert.match(
      gateway,
      /admin_test_access_required/,
    );

    assert.match(
      gateway,
      /okey_preview_test_join_or_create/,
    );

    assert.match(
      gateway,
      /okey_preview_test_start/,
    );

    assert.match(
      waitingMigration,
      /'waiting'/,
    );

    assert.match(
      waitingMigration,
      /player_index[\s\S]*0/,
    );

    assert.match(
      waitingMigration,
      /player_index[\s\S]*2/,
    );

    assert.match(
      waitingMigration,
      /Test Bot 1/,
    );

    assert.match(
      waitingMigration,
      /Test Bot 2/,
    );

    assert.match(
      migration,
      /references auth\.users\(id\)/,
    );

    assert.match(
      migration,
      /okey\.test_bot_accounts/,
    );

    assert.match(
      migration,
      /revoke all on table okey\.test_bot_accounts from public, anon, authenticated/,
    );
  },
);

test(
  "Preview waits for two Admins and then creates one authoritative match",
  () => {
    assert.match(
      gateway,
      /const botIds = \[1, 2\]/,
    );

    assert.match(
      gateway,
      /!room\.readyToStart/,
    );

    assert.match(
      gateway,
      /createAuthoritativeOkeyMatch/,
    );

    assert.match(
      waitingMigration,
      /readyToStart/,
    );

    assert.match(
      waitingMigration,
      /seat\.player_index = 2/,
    );

    assert.match(
      waitingMigration,
      /status = 'playing'/,
    );

    assert.match(
      preview,
      /2 Admin Players \+ 2 Server Bots/,
    );
  },
);

test(
  "test Bot seats use the production Bot and command path",
  () => {
    assert.match(
      gateway,
      /controlledByBot: true/,
    );

    assert.match(
      gateway,
      /botDifficulty: "normal"/,
    );

    assert.match(
      preview,
      /pathname: "\/okey\/game"/,
    );

    assert.doesNotMatch(
      preview,
      /useLocalOkeyPreviewGame/,
    );

    assert.match(
      worker,
      /executeOkeyBotTurn/,
    );

    assert.match(
      executor,
      /isTestMatch/,
    );
  },
);

test(
  "test matches cannot change production economy or rewards",
  () => {
    assert.match(
      migration,
      /if new\.is_test/,
    );

    assert.match(
      matchGateway,
      /const dailyQuestEvents = isTestMatch\s*\? \[\]/,
    );

    assert.match(
      matchGateway,
      /economyApplied: false/,
    );

    assert.match(
      executor,
      /economyApplied: false/,
    );

    assert.match(
      waitingMigration,
      /entry_fee[\s\S]*currency[\s\S]*commission_rate/,
    );

    assert.match(
      waitingMigration,
      /0,[\s\S]*'fun',[\s\S]*0,[\s\S]*0,[\s\S]*0,[\s\S]*0,[\s\S]*0,[\s\S]*true/,
    );
  },
);

test(
  "Preview waiting RPCs are service-role only",
  () => {
    assert.match(
      waitingMigration,
      /service_role_required/,
    );

    assert.match(
      waitingMigration,
      /revoke all on function public\.okey_preview_test_join_or_create\(uuid, uuid\[\]\)[\s\S]*from public, anon, authenticated/,
    );

    assert.match(
      waitingMigration,
      /grant execute on function public\.okey_preview_test_join_or_create\(uuid, uuid\[\]\)[\s\S]*to service_role/,
    );

    assert.match(
      waitingMigration,
      /revoke all on function public\.okey_preview_test_start\(uuid, uuid, jsonb, jsonb, timestamptz\)[\s\S]*from public, anon, authenticated/,
    );
  },
);

test(
  "legacy Preview cleanup does not remove the current waiting Preview flow",
  () => {
    assert.match(
      legacyCleanup,
      /okey_get_active_preview_test_match/,
    );

    assert.match(
      legacyCleanup,
      /okey_get_preview_test_bot_accounts/,
    );

    assert.match(
      legacyCleanup,
      /okey_register_preview_test_bot_account/,
    );

    assert.match(
      legacyCleanup,
      /pg_get_function_identity_arguments/,
    );

    assert.doesNotMatch(
      legacyCleanup,
      /'okey_preview_test_join_or_create'/,
    );

    assert.doesNotMatch(
      legacyCleanup,
      /'okey_preview_test_start'/,
    );

    assert.match(
      gateway,
      /okey_preview_test_join_or_create/,
    );

    assert.match(
      gateway,
      /okey_preview_test_start/,
    );
  },
);