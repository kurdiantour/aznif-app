import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260811000700_okey_party_eligibility_service_access.sql",
  "utf8",
).toLowerCase().replace(/--.*$/gm, "").replace(/\s+/g, " ");

test("Okey party eligibility grants service role read-only access", () => {
  for (const table of ["user_presence", "wallets", "profiles"]) {
    assert.match(sql, new RegExp(`grant select on table public\\.${table} to service_role`));
  }
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

