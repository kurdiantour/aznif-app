import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { handleImmediatePush } from '../supabase/functions/_shared/push-immediate.ts';

// Run the actual entrypoint + handler, substituting only external services.
// Never connects to Supabase or Expo.
const source = readFileSync(new URL('../supabase/functions/send-push-notification/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const row = (id, user_id = alice, extra = {}) => ({ id, user_id, platform: 'ios', active: true, environment: 'production', expo_push_token: 'ExpoPushToken[' + id + ']', ...extra });

function harness(rows, tickets = [{ status: 'ok', id: 'audit-ticket' }], secret = 'dedicated-push-secret') {
  const calls = [], queries = [], updates = [], campaigns = new Map(), targets = new Set(), claims = new Set();
  let handler;
  const service = { rpc: async (name,args) => {
    const key=args.p_campaign+args.p_device;
    if(name==='push_target_device'){targets.add(key);return {data:null,error:null};}
    assert.equal(name,'push_claim_device');assert.equal(targets.has(key),true);
    if(claims.has(key))return {data:false,error:null};claims.add(key);return {data:true,error:null};
  }, from(table) {
    if(table==='push_campaigns')return {
      upsert(value){if(!campaigns.has(value.id))campaigns.set(value.id,value);return Promise.resolve({error:null});},
      select(){return this;},eq(_key,id){this.id=id;return this;},single(){return Promise.resolve({data:campaigns.get(this.id),error:null});},
      update(){return {eq:()=>Promise.resolve({error:null})};},
    };
    if(table==='push_campaign_devices')return {update(){return {eq(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};}};
    assert.equal(table, 'push_devices');
    const filters = [];
    let patch, limit = Infinity, ordering;
    return {
      select() { queries.push(filters); return this; },
      update(value) { patch = value; return this; },
      eq(key, value) { filters.push(['eq', key, value]); return this; },
      in(key, value) { filters.push(['in', key, value]); return this; },
      gt(key, value) { filters.push(['gt', key, value]); return this; },
      order(key) { ordering = key; return this; },
      limit(value) { limit = value; return this; },
      then(resolve, reject) {
        let selected = rows.filter(r => filters.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : r[k] > v));
        if (ordering) selected = selected.toSorted((a, b) => a[ordering].localeCompare(b[ordering]));
        selected = selected.slice(0, limit);
        if (patch) updates.push({ filters, patch, ids: selected.map(r => r.id) });
        return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
      },
    };
  } };
  vm.runInNewContext(compiled, {
    exports: {},
    require(specifier) {
      if (specifier.startsWith('jsr:')) return {};
      if (specifier.startsWith('npm:')) return { createClient: (url, key) => { assert.equal(url, 'https://audit.invalid'); assert.equal(key, 'runtime-service-key'); return service; } };
      if (specifier === '../_shared/push-immediate.ts') return { handleImmediatePush };
      throw new Error('Unexpected import: ' + specifier);
    },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://audit.invalid', SUPABASE_SERVICE_ROLE_KEY: 'runtime-service-key', PUSH_SEND_SECRET: secret, EXPO_ACCESS_TOKEN: 'expo-test-key' })[key] }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ data: tickets }); },
    Date,
  });
  const invoke = (authorization, body = { title: 'Aznif', body: 'Single user', userId: alice, environment: 'production' }) => handler(new Request('https://audit.invalid', {
    method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body),
  }));
  return { invoke, calls, queries, updates, campaigns, claims };
}

test('real Edge authorization rejects absent, anon, user and mismatched service keys before lookup', async () => {
  for (const auth of [undefined, 'Bearer anon-key', 'Bearer user-jwt', 'Bearer other-service-key', 'Bearer runtime-service-key', 'Bearer wrong-push-secret', 'dedicated-push-secret', 'Bearer dedicated-push-secret extra']) {
    const h = harness([row('a')]);
    assert.equal((await h.invoke(auth)).status, 401);
    assert.equal(h.queries.length, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('real Edge targets only active devices of one user/environment and sends the exact Expo payload', async () => {
  const h = harness([row('a'), row('b', bob), row('c', alice, { active: false }), row('d', alice, { environment: 'development' })]);
  const response = await h.invoke('Bearer dedicated-push-secret');
  assert.equal(response.status, 200);
  const payload=await response.json();
  assert.deepEqual(payload, { campaign_id: payload.campaign_id, complete: true, results: [{ deviceId: 'a', userId: alice, status: 'accepted', ticketId: 'audit-ticket' }] });
  assert.equal(h.calls.length, 1);
  const { url, options } = h.calls[0];
  assert.equal(url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer expo-test-key');
  assert.deepEqual(JSON.parse(options.body), [{ to: 'ExpoPushToken[a]', title: 'Aznif', body: 'Single user', sound: 'default', priority: 'high', channelId: 'general', ttl: 0, data: {campaign_id:payload.campaign_id,device_id:'a'} }]);
});

test('one user can target multiple active devices: it is not device-level targeting', async () => {
  const h = harness([row('a'), row('b')], [{ status: 'ok', id: 'ticket-a' }, { status: 'ok', id: 'ticket-b' }]);
  assert.equal((await (await h.invoke('Bearer dedicated-push-secret')).json()).results.length, 2);
  assert.equal(JSON.parse(h.calls[0].options.body).length, 2);
});

test('real Edge DeviceNotRegistered cleanup constrains device, owner and token', async () => {
  const h = harness([row('a'), row('b', bob)], [{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
  const body = await (await h.invoke('Bearer dedicated-push-secret')).json();
  assert.equal(body.results[0].error, 'DeviceNotRegistered');assert.equal(body.results[0].status,'inactive');
  assert.equal(h.updates.length, 1);
  assert.deepEqual(h.updates[0].ids, ['a']);
  assert.deepEqual(h.updates[0].filters, [['eq', 'id', 'a'], ['eq', 'user_id', alice], ['eq', 'expo_push_token', 'ExpoPushToken[a]']]);
  assert.equal(h.updates[0].patch.active, false);
});

// Missing server configuration must never fall back to the database credential.
test('missing or empty PUSH_SEND_SECRET fails closed before lookup or sending', async () => {
  for (const secret of [null, '']) {
    for (const authorization of ['Bearer runtime-service-key', 'Bearer dedicated-push-secret']) {
      const h = harness([row('a')], [], secret);
      const response = await h.invoke(authorization);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'Authorization unavailable' });
      assert.equal(h.queries.length, 0);
      assert.equal(h.calls.length, 0);
    }
  }
});
test('campaign id cannot be reused with changed payload', async () => {
  const h=harness([row('a')]);
  const base={title:'Aznif',body:'First',userId:alice,campaign_id:'33333333-3333-4333-8333-333333333333'};
  assert.equal((await h.invoke('Bearer dedicated-push-secret',base)).status,200);
  const rejected=await h.invoke('Bearer dedicated-push-secret',{...base,body:'Changed'});
  assert.equal(rejected.status,409);assert.equal(h.calls.length,1);
});
