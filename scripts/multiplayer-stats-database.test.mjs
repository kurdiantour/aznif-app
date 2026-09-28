import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { fixture, users, createDomino, leave, finish, results, counters, createOkey, commitOkey } from './helpers/multiplayer-stats-fixture.mjs';

let db;
before(async () => { db = await fixture(); });
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('BEGIN'); });
afterEach(async () => { await db.exec('ROLLBACK; RESET ROLE'); });
async function flush() { await db.exec('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED'); }
const zero = { games_played: 0, games_won: 0, games_lost: 0 };
const win = { games_played: 1, games_won: 1, games_lost: 0 };
const loss = { games_played: 1, games_won: 0, games_lost: 1 };

for (const mode of ['1v1', '2v2']) {
  test(`${mode}: manual leave is immediate, personal, idempotent and independent of currency`, async () => {
    const room = await createDomino(db,mode,{currency:'aznif'});
    await leave(db,room,0);
    assert.deepEqual((await counters(db))[0],loss);
    await leave(db,room,0);
    await finish(db,room,'teamA');
    await flush();
    assert.deepEqual((await counters(db))[0],loss);
    assert.equal((await results(db)).find(r=>r.user_id===users[0]).reason,'manual_leave');
  });
  test(`${mode}: reward retry does not duplicate stats or economics`, async () => {
    const room = await createDomino(db,mode);
    await leave(db,room,1);
    await finish(db,room,'teamA');
    await flush();
    const before = await db.query('SELECT id,points FROM profiles ORDER BY id');
    const wallet = await db.query('SELECT * FROM wallets ORDER BY user_id');
    const expected = await counters(db);
    await db.query('SELECT domino_settle_match($1,$2)',[mode,room.id]);
    await finish(db,room,'teamA');
    await flush();
    assert.deepEqual(await counters(db),expected);
    assert.deepEqual((await db.query('SELECT id,points FROM profiles ORDER BY id')).rows,before.rows);
    assert.deepEqual((await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,wallet.rows);
    assert.deepEqual(expected[0],win);
    assert.deepEqual(expected[1],loss);
    assert.equal(Number(before.rows[0].points),135);
    assert.equal(Number(before.rows[1].points),75);
  });
  test(`${mode}: timeout/disconnect alone and null winner never manufacture results`, async () => {
    const room = await createDomino(db,mode);
    await db.query(`UPDATE ${room.prefix}_players SET connected=false,bot_takeover=true WHERE room_id=$1`,[room.id]);
    await db.query(`UPDATE ${room.prefix}_rooms SET state='{"winningTeamId":null}' WHERE id=$1`,[room.id]);
    await flush();
    assert.deepEqual(await results(db),[]);
    await db.query('SELECT check_and_finalize_zero_human_room($1,$2)',[mode,room.id]);
    await flush();
    assert.equal((await db.query(`SELECT status FROM ${room.prefix}_rooms WHERE id=$1`,[room.id])).rows[0].status,'finished');
    assert.deepEqual(await results(db),[]);
    assert.deepEqual(await counters(db),users.map(()=>zero));
  });
  test(`${mode}: all manual leaves finish without a winner and without extra stats`, async () => {
    const room = await createDomino(db,mode);
    const count = mode==='1v1'?2:4;
    for(let i=0;i<count;i++) await leave(db,room,i);
    await flush();
    assert.equal((await results(db)).length,count);
    assert.ok((await results(db)).every(r=>r.reason==='manual_leave'&&r.outcome==='loss'));
    assert.deepEqual((await counters(db)).slice(0,count),Array.from({length:count},()=>loss));
  });
  test(`${mode}: waiting, cancelled, and test matches do not count`, async () => {
    const waiting=await createDomino(db,mode,{status:'waiting'});
    await leave(db,waiting,0);
    const testing=await createDomino(db,mode,{isTest:true});
    await leave(db,testing,0);
    await finish(db,testing);
    const cancelled=await createDomino(db,mode);
    await finish(db,cancelled,'teamA','cancelled');
    await flush();
    assert.deepEqual(await results(db),[]);
  });
  test(`${mode}: actual terminal-round resolver overrides intermediate winner before stats`, async () => {
    const room=await createDomino(db,mode);
    await leave(db,room,0);
    if(mode==='2v2') await db.query('SELECT apply_two_vs_two_timeout_strike_takeover($1,$2)',[room.id,users[2]]);
    await db.query(`UPDATE ${room.prefix}_rooms SET state=$2,version=version+1 WHERE id=$1`,
      [room.id,JSON.stringify({roundWinnerPlayerId:users[0],winningTeamId:'teamA',teamScores:{teamA:350,teamB:20}})]);
    const stored=(await db.query(`SELECT state,status FROM ${room.prefix}_rooms WHERE id=$1`,[room.id])).rows[0];
    assert.equal(stored.status,'finished');
    assert.equal(stored.state.winningTeamId,'teamB');
    await flush();
    assert.deepEqual((await counters(db))[0],loss);
    assert.deepEqual((await counters(db))[1],win);
    if(mode==='2v2') assert.deepEqual((await counters(db))[2],loss);
  });
  test(`${mode}: timeout-only terminal resolver records final result, not takeover loss`, async () => {
    const room=await createDomino(db,mode);
    await db.query(`SELECT apply_${room.prefix}_timeout_strike_takeover($1,$2)`,[room.id,users[0]]);
    if(mode==='2v2') await db.query(`SELECT apply_${room.prefix}_timeout_strike_takeover($1,$2)`,[room.id,users[2]]);
    assert.deepEqual(await results(db),[]);
    await db.query(`UPDATE ${room.prefix}_rooms SET state=$2,version=version+1 WHERE id=$1`,
      [room.id,JSON.stringify({roundWinnerPlayerId:users[1],teamScores:{teamA:0,teamB:10}})]);
    await flush();
    assert.deepEqual((await counters(db))[0],loss);
    assert.deepEqual((await counters(db))[1],win);
    assert.ok((await results(db)).every(r=>r.reason==='match_finished'));
  });
}

test('2v2: normal authoritative winner counts while status stays active',async()=>{
  const room=await createDomino(db,'2v2');
  await finish(db,room,'teamB','active'); await flush();
  assert.deepEqual(await counters(db),[loss,win,loss,win]);
  assert.equal((await db.query('SELECT status FROM two_vs_two_rooms WHERE id=$1',[room.id])).rows[0].status,'active');
});
test('status-only Bot finish and repeated state updates count once',async()=>{
  const room=await createDomino(db,'1v1');
  await finish(db,room,'teamB','active');
  await db.query('UPDATE one_vs_one_rooms SET status=\'finished\' WHERE id=$1',[room.id]);
  await flush();
  assert.deepEqual(await counters(db),[loss,win,zero,zero]);
});
test('game namespaces isolate identical match/user UUIDs',async()=>{
  const id=randomUUID();
  for(const mode of ['1v1','2v2']) { const room=await createDomino(db,mode,{id}); await finish(db,room); }
  const state={matchFinished:false,manualLeftPlayerIds:[]};
  await createOkey(db,state,{id});
  await commitOkey(db,id,{...state,matchFinished:true,matchWinnerTeamId:'teamA'});
  await flush();
  assert.equal((await results(db)).length,10);
  assert.equal((await counters(db))[0].games_played,3);
});
test('Okey: manual commit is immediate, retries and later winning team preserve loss',async()=>{
  const state={matchFinished:false,manualLeftPlayerIds:[users[0]]};
  const id=await createOkey(db,{...state,manualLeftPlayerIds:[]});
  const commandId=randomUUID();
  await commitOkey(db,id,state,'manual-leave',0,{commandId});
  assert.deepEqual((await counters(db))[0],loss);
  await commitOkey(db,id,state,'manual-leave',0,{commandId});
  await commitOkey(db,id,state,'manual-leave');
  await commitOkey(db,id,{...state,matchFinished:true,matchWinnerTeamId:'teamA'},'discard',1);
  assert.deepEqual(await counters(db),[loss,loss,win,loss]);
});
test('Okey: no-humans records only command manual losses, finalization adds none',async()=>{
  const id=await createOkey(db,{matchFinished:false,manualLeftPlayerIds:[]});
  for(let i=0;i<4;i++) await commitOkey(db,id,{manualLeftPlayerIds:users.slice(0,i+1),
    matchFinished:i===3,matchWinnerTeamId:null,leaveTerminationReason:i===3?'no-humans':null},'manual-leave',i);
  assert.deepEqual(await counters(db),users.map(()=>loss));
  assert.ok((await results(db)).every(r=>r.reason==='manual_leave'));
});
test('Okey: test match manual and final commits do not change counters',async()=>{
  const id=await createOkey(db,{}, {isTest:true});
  await commitOkey(db,id,{manualLeftPlayerIds:[users[0]],matchFinished:false},'manual-leave');
  await commitOkey(db,id,{manualLeftPlayerIds:[users[0]],matchFinished:true,matchWinnerTeamId:'teamB'});
  assert.deepEqual(await results(db),[]);
});
test('Okey: version conflict, duplicate final request and failed commit cannot double count',async()=>{
  const id=await createOkey(db,{});
  await commitOkey(db,id,{matchFinished:false},'system-timeout');
  await db.exec('SAVEPOINT stale');
  await assert.rejects(commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA'},'discard',0,{version:0}),/version_conflict/);
  await db.exec('ROLLBACK TO stale');
  assert.deepEqual(await results(db),[]);
  await commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA'});
  await db.exec('SAVEPOINT duplicate');
  await assert.rejects(commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA'}),/match_not_active/);
  await db.exec('ROLLBACK TO duplicate');
  assert.deepEqual(await counters(db),[win,loss,win,loss]);
});
test('missing profile rolls back Okey state, command, ledger and other profile increments',async()=>{
  const id=await createOkey(db,{});
  await db.query('DELETE FROM profiles WHERE id=$1',[users[3]]);
  await db.exec('SAVEPOINT failure');
  await assert.rejects(commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA'}),/stats_profile_not_initialized/);
  await db.exec('ROLLBACK TO failure');
  assert.deepEqual(await results(db),[]);
  assert.equal(Number((await db.query('SELECT version FROM okey.matches WHERE id=$1',[id])).rows[0].version),0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM okey.match_commands')).rows[0].n,0);
  assert.deepEqual(await counters(db),[zero,zero,zero]);
});
test('writer rejects conflicting final results instead of silently rewriting them',async()=>{
  const room=await createDomino(db,'1v1'); await finish(db,room); await flush();
  await db.exec('SAVEPOINT conflict');
  await finish(db,room,'teamB');
  await assert.rejects(flush(),/conflicting_match_stat_result/);
  await db.exec('ROLLBACK TO conflict');
  assert.deepEqual(await counters(db),[win,loss,zero,zero]);
});
test('clients cannot write ledger or execute private writer; legacy stats triggers are removed',async()=>{
  for(const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'multiplayer_private.record_player_results(text,uuid,bigint,text,jsonb)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_table_privilege($1,'public.multiplayer_match_stat_results','INSERT') AS allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('record_one_vs_one_match_stats','record_two_vs_two_match_stats')")).rows[0].n,0);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.multiplayer_match_stat_results'::regclass")).rows[0].relrowsecurity,true);
});

test('1v1: real next-hand RPC finishes from pending end-of-hand points',async()=>{
  const room=await createDomino(db,'1v1');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[users[0]]);
  await db.query('UPDATE one_vs_one_rooms SET state=$2 WHERE id=$1',[room.id,JSON.stringify({
    roundWinnerPlayerId:users[0],teamScores:{teamA:340,teamB:20},endOfHandScoreApplied:false,
    endOfHandScoringEvent:{teamId:'teamA',points:20}})]);
  await db.query('SELECT start_one_vs_one_game($1)',[room.id]); await flush();
  assert.deepEqual(await counters(db),[win,loss,zero,zero]);
});

for(const mode of ['1v1','2v2']) {
  test(mode+': real atomic pass commit counts once and rejects stale replay',async()=>{
    const room=await createDomino(db,mode);
    const args=[mode,room.id,0,JSON.stringify({winningTeamId:'teamB'}),'[]','[]',null,'finished',users[1],'pass_turn','{}'];
    const sql='SELECT commit_multiplayer_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';
    await db.query(sql,args); await flush();
    const expected=await counters(db);
    await db.exec('SAVEPOINT stale_domino');
    await assert.rejects(db.query(sql,args),/STALE_GAME_STATE/);
    await db.exec('ROLLBACK TO stale_domino');
    assert.deepEqual(await counters(db),expected);
    assert.deepEqual(expected[0],loss); assert.deepEqual(expected[1],win);
  });
  test(mode+': genuine bot seat has no profile statistics',async()=>{
    const room=await createDomino(db,mode);
    await db.query('UPDATE '+room.prefix+"_players SET kind='bot',user_id=NULL WHERE room_id=$1 AND player_index=0",[room.id]);
    await finish(db,room); await flush();
    assert.deepEqual((await counters(db))[0],zero);
    assert.equal((await results(db)).length,mode==='1v1'?1:3);
  });
}

test('overlapping Okey leave/final version claims and retry preserve the manual loss',async()=>{
  const concurrentDb=await fixture();
  try {
    const id=await createOkey(concurrentDb,{matchFinished:false,manualLeftPlayerIds:[]});
    // PGlite queues statements: competing version claims, not multi-session MVCC.
    const attempts=await Promise.allSettled([
      commitOkey(concurrentDb,id,{matchFinished:false,manualLeftPlayerIds:[users[0]]},'manual-leave',0,{version:0}),
      commitOkey(concurrentDb,id,{matchFinished:true,matchWinnerTeamId:'teamA',manualLeftPlayerIds:[]},'discard',1,{version:0}),
    ]);
    assert.equal(attempts[0].status,'fulfilled');
    assert.equal(attempts[1].status,'rejected');
    assert.deepEqual((await counters(concurrentDb))[0],loss);
    await commitOkey(concurrentDb,id,{matchFinished:true,matchWinnerTeamId:'teamA',manualLeftPlayerIds:[users[0]]},'discard',1);
    assert.deepEqual(await counters(concurrentDb),[loss,loss,win,loss]);
  } finally { await concurrentDb.close(); }
});

test('final then manual leave cannot replace an already committed personal result',async()=>{
  const id=await createOkey(db,{});
  await commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA'});
  await db.exec('SAVEPOINT late_leave');
  await assert.rejects(commitOkey(db,id,{matchFinished:true,matchWinnerTeamId:'teamA',manualLeftPlayerIds:[users[0]]},'manual-leave'),/match_not_active/);
  await db.exec('ROLLBACK TO late_leave');
  assert.deepEqual((await counters(db))[0],win);
});
