const assert = require("node:assert/strict");
const fs = require("node:fs");

const sql = fs.readFileSync(
  "supabase/migrations/20260810000500_domino_okey_economy.sql",
  "utf8",
);
const fun = fs.readFileSync("app/domino/fun.tsx", "utf8");
const aznif = fs.readFileSync("app/domino/aznif.tsx", "utf8");

assert.match(sql, /currency='aznif' THEN 0\.05 ELSE 0/);
assert.match(sql, /coin=coin-v_room\.entry_fee/);
assert.match(sql, /mc=mc-v_room\.entry_fee/);
assert.match(sql, /'commission_burn'/);
assert.match(sql, /'refund'/);
assert.match(sql, /v_slots:=CASE WHEN p_mode='1v1' THEN 1 ELSE 2 END/);
assert.match(sql, /v_points:=CASE[\s\S]*THEN 35 ELSE -15 END/);
assert.match(sql, /v_gems:=CASE[\s\S]*THEN 10 ELSE 0 END/);
assert.doesNotMatch(sql, /ALTER TABLE okey\.|UPDATE okey\.|INSERT INTO okey\./i);

assert.match(fun, /p_currency: "fun"/);
assert.match(fun, /mode === "1v1" \? 500 : 3500/);
assert.match(aznif, /p_mode: config\.mode/);
assert.match(aznif, /p_currency: "aznif"/);
assert.match(aznif, /config\.mode === "1v1" \? "duo" : "squad"/);

console.log("Domino economy checks passed.");
