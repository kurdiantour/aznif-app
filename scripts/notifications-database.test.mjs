import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
let inTest=false;
const originalQuery=db.query.bind(db);
db.query=async (...args)=>{
 if(!inTest)return originalQuery(...args);
 await db.exec('SAVEPOINT test_query');
 try{const result=await originalQuery(...args);await db.exec('RELEASE SAVEPOINT test_query');return result;}
 catch(error){await db.exec('ROLLBACK TO SAVEPOINT test_query');await db.exec('RELEASE SAVEPOINT test_query');throw error;}
};
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const install='33333333-3333-4333-8333-333333333333', secret='44444444-4444-4444-8444-444444444444';
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8').replace(/^\uFEFF/,'');
async function root(){await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false)");}
async function user(id=a){await root();await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');}
async function rpc(name,args=[],placeholders=args.map((_,i)=>'$'+(i+1)).join(',')){return (await db.query('SELECT public.'+name+'('+placeholders+') AS result',args)).rows[0].result;}
async function register(id=a){await user(id);return rpc('push_register_device',[install,secret,'ExpoPushToken[test_token]','android']);}
before(async()=>{
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 INSERT INTO auth.users VALUES ('${a}'),('${b}');
 `);
 await db.exec(migration('20260923224758_immediate_push_devices'));
 await db.exec(migration('20261003073959_push_campaign_tracking'));
});
after(async()=>db.close());
beforeEach(async()=>{await root();await db.exec('BEGIN');inTest=true;});
afterEach(async()=>{inTest=false;await db.exec('ROLLBACK; RESET ROLE');});

test('device secrets are inaccessible to app users; anonymous RPC denied',async()=>{
 await user();await assert.rejects(db.query('SELECT * FROM public.push_devices'),/permission denied/);
 await assert.rejects(db.query('SELECT * FROM public.push_campaigns'),/permission denied/);
 await assert.rejects(db.query('SELECT * FROM public.push_opens'),/permission denied/);
 await root();await db.exec('SET ROLE anon');await assert.rejects(rpc('push_register_device',[install,secret,'ExpoPushToken[x]','ios']),/permission denied/);
});
test('registration is idempotent; account transfer requires installation proof',async()=>{
 const id=await register();assert.equal(await register(),id);await user(b);
 await assert.rejects(rpc('push_register_device',[install,a,'ExpoPushToken[test_token]','android']),/Invalid installation proof/);
 assert.equal(await register(b),id);await root();
 assert.equal((await db.query('SELECT user_id FROM public.push_devices')).rows[0].user_id,b);
});
test('another installation cannot steal a token; nulls and invalid environments fail',async()=>{
 await register();await user(b);
 await assert.rejects(rpc('push_register_device',[b,secret,'ExpoPushToken[test_token]','ios']),/another installation/);
 await assert.rejects(rpc('push_register_device',[b,secret,null,'ios']),/Invalid device/);
 await assert.rejects(rpc('push_register_device',[b,secret,'ExpoPushToken[x]','ios','staging']),/Invalid device/);
});
test('unregister requires current owner and proof, registration reactivates and rotates token',async()=>{
 await register();await user(b);await rpc('push_unregister_device',[install,secret]);await root();
 assert.equal((await db.query('SELECT active FROM public.push_devices')).rows[0].active,true);
 await user();await rpc('push_unregister_device',[install,secret]);await root();
 assert.equal((await db.query('SELECT active FROM public.push_devices')).rows[0].active,false);
 await user();await rpc('push_register_device',[install,secret,'ExpoPushToken[new]','ios','development']);await root();
 const d=(await db.query('SELECT * FROM public.push_devices')).rows[0];assert.equal(d.active,true);assert.equal(d.environment,'development');assert.equal(d.expo_push_token,'ExpoPushToken[new]');
});
test('campaign tables extend push_devices without legacy notification runtime',async()=>{
 await root();const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'push_campaign%' ORDER BY tablename")).rows;assert.deepEqual(tables.map(r=>r.tablename),['push_campaign_devices','push_campaigns']);
 assert.equal((await db.query("SELECT count(*) n FROM pg_namespace WHERE nspname='notification_private'")).rows[0].n,0);
 assert.deepEqual((await db.query("SELECT proname FROM pg_proc WHERE pronamespace='push_private'::regnamespace ORDER BY proname")).rows.map(r=>r.proname),['push_record_open','push_register_device','push_unregister_device']);
});

test('atomic claim rejects duplicate and open RPC deduplicates clicks',async()=>{
 const device=await register();await root();await db.exec('SET ROLE service_role');
 const campaign=(await db.query("INSERT INTO public.push_campaigns(title,body,environment,audience,user_ids) VALUES('t','b','production','users',ARRAY[$1::uuid]) RETURNING id",[a])).rows[0].id;
 await rpc('push_target_device',[campaign,device,a,'android']);
 assert.equal((await db.query('SELECT status FROM public.push_campaign_devices WHERE campaign_id=$1',[campaign])).rows[0].status,'target');
 assert.equal(await rpc('push_claim_device',[campaign,device,a,'android']),true);
 assert.equal(await rpc('push_claim_device',[campaign,device,a,'android']),false);
 await db.query("UPDATE public.push_campaign_devices SET status='accepted' WHERE campaign_id=$1",[campaign]);
 await user();assert.equal(await rpc('push_record_open',[campaign,device,install,secret]),true);
 assert.equal(await rpc('push_record_open',[campaign,device,install,secret]),true);
 await root();assert.equal((await db.query('SELECT count(*) n FROM public.push_opens')).rows[0].n,1);
 await db.exec('SET ROLE service_role');
 const report=(await db.query('SELECT * FROM public.push_campaign_report($1)',[campaign])).rows[0];
 assert.equal(report.target,1);assert.equal(report.accepted,1);assert.equal(report.opened,1);assert.equal(Number(report.open_rate),1);
 await user(b);assert.equal(await rpc('push_record_open',[campaign,device,install,secret]),false);
});
