import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import {
  createAuthoritativeOkeyMatch, applyAuthoritativeManualLeave,
  resolveAuthoritativeMatchDeadline, applyAuthoritativeOkeyMatchCommand,
  applyAuthoritativeOkeyEliminatedTurn, settleAuthoritativeOkeyRound,
  startAuthoritativeOkeyNextRound,
} from '../okey/server/okey-authoritative.ts';
import { handSeatToBot } from '../okey/engine/okey-bot-engine.ts';
import { reduceOneVsOnePlay } from '../domino/modes/one-vs-one/authoritative/domino-one-vs-one-command-reducer.ts';
import { reduceTwoVsTwoPlay } from '../domino/modes/two-vs-two/authoritative/domino-two-vs-two-command-reducer.ts';
import { fixture, users, createOkey, commitOkey, results, counters, createDomino } from './helpers/multiplayer-stats-fixture.mjs';

let db: Awaited<ReturnType<typeof fixture>>;
before(async()=>{ db=await fixture(); });
after(async()=>{ await db?.close(); });
beforeEach(async()=>{ await db.exec('BEGIN'); });
afterEach(async()=>{ await db.exec('ROLLBACK'); });
const identities = [
  { id: users[0], name: 'Human 0' },
  { id: users[1], name: 'Human 1' },
  { id: users[2], name: 'Human 2' },
  { id: users[3], name: 'Human 3' },
] as const;
const initial=()=>createAuthoritativeOkeyMatch(identities,0);
type Match=ReturnType<typeof initial>;
function timeout(match: Match,index: number): Match {
  return resolveAuthoritativeMatchDeadline({...match,
    roundState:{...match.roundState,currentPlayerIndex:index,hasDrawnThisTurn:false}},
    '2026-08-02T00:00:00.000Z',Date.parse('2026-08-02T00:01:00.000Z'));
}
async function checkFinal(match: Match, id: string) {
  const rows=await results(db);
  assert.equal(rows.length,4);
  for(let i=0;i<4;i++) {
    const row=rows.find((r: any)=>r.user_id===users[i]);
    const left=match.manualLeftPlayerIds.includes(users[i]);
    assert.equal(row.outcome,left?'loss':match.roundState.players[i].teamId===match.matchWinnerTeamId?'win':'loss');
    assert.equal(row.reason,left?'manual_leave':'match_finished');
  }
  assert.equal((await db.query<{ status: string }>('SELECT status FROM okey.matches WHERE id=$1',[id])).rows[0].status,'finished');
}

test('Okey real timeout, Bot takeover and take-back-seat leave stats untouched',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  for(let i=0;i<2;i++) { state=timeout(state,1); await commitOkey(db,id,state,'system-timeout',1); }
  assert.equal(state.matchFinished,false);
  assert.equal(state.roundState.players[1].controlledByBot,true);
  assert.deepEqual(await results(db),[]);
  state=applyAuthoritativeOkeyMatchCommand(state,1,{type:'take-back-seat'});
  await commitOkey(db,id,state,'take-back-seat',1);
  assert.equal(state.roundState.players[1].controlledByBot,false);
  assert.deepEqual(await results(db),[]);
});

for(const scenario of ['manual-manual','manual-timeout','timeout-timeout'] as const) {
  test(`Okey real engine ${scenario} team forfeit commits personal and final results`,async()=>{
    let state=initial(); const id=await createOkey(db,state);
    for(const index of [1,3]) {
      const manual=scenario==='manual-manual'||(scenario==='manual-timeout'&&index===1);
      if(manual) { state=applyAuthoritativeManualLeave(state,index); await commitOkey(db,id,state,'manual-leave',index); }
      else { for(let n=0;n<2;n++) { state=timeout(state,index); await commitOkey(db,id,state,'system-timeout',index); } }
      if(index===1) assert.equal((await results(db)).length,manual?1:0);
    }
    assert.equal(state.leaveTerminationReason,'team-forfeit');
    assert.equal(state.matchFinished,true);
    await checkFinal(state,id);
  });
}

test('Okey manual leave of already taken-over human is one immediate loss',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  state=timeout(timeout(state,1),1); await commitOkey(db,id,state,'system-timeout',1);
  assert.deepEqual(await results(db),[]);
  state=applyAuthoritativeManualLeave(state,1); await commitOkey(db,id,state,'manual-leave',1);
  assert.equal((await results(db)).length,1);
  assert.deepEqual((await counters(db))[1],{games_played:1,games_won:0,games_lost:1});
});

test('Okey real round-only finish, restart and eliminated turn do not count a match',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  state=settleAuthoritativeOkeyRound({...state,roundState:{...state.roundState,phase:'finished',winnerId:users[0],endReason:'win'}});
  await commitOkey(db,id,state,'discard');
  assert.equal(state.matchFinished,false); assert.deepEqual(await results(db),[]);
  state=startAuthoritativeOkeyNextRound(state);
  await commitOkey(db,id,state,'start-next-round');
  state={...state,roundState:{...state.roundState,currentPlayerIndex:0,hasDrawnThisTurn:false,
    players:state.roundState.players.map((p,i)=>i===0?{...p,eliminated:true}:p)}};
  state=applyAuthoritativeOkeyEliminatedTurn(state,users[0]);
  await commitOkey(db,id,state,'system-eliminated-turn');
  assert.deepEqual(await results(db),[]);
});

for(const actor of ['human','bot','eliminated'] as const) {
  test(`Okey ${actor} final round uses engine winner, not controller kind`,async()=>{
    let state=initial(); const id=await createOkey(db,state);
    if(actor==='bot') state={...state,roundState:handSeatToBot(state.roundState,0,'normal')};
    if(actor==='eliminated') state={...state,roundState:{...state.roundState,
      players:state.roundState.players.map((p,i)=>i===0?{...p,eliminated:true}:p)}};
    state=settleAuthoritativeOkeyRound({...state,currentRound:7,matchScores:{teamA:0,teamB:1000},
      roundState:{...state.roundState,phase:'finished',winnerId:users[0],endReason:'win'}});
    assert.equal(state.matchFinished,true);
    await commitOkey(db,id,state,actor==='human'?'discard':actor==='bot'?'system-bot':'system-eliminated-turn');
    await checkFinal(state,id);
  });
}

test('Okey determine-round early match completion uses existing score-gap rule',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  state=settleAuthoritativeOkeyRound({...state,currentRound:6,matchScores:{teamA:0,teamB:1000},
    roundState:{...state.roundState,phase:'finished',winnerId:users[0],endReason:'win'}});
  assert.equal(state.matchFinished,false);
  await commitOkey(db,id,state,'discard'); assert.deepEqual(await results(db),[]);
  state=startAuthoritativeOkeyNextRound(state);
  assert.equal(state.matchFinished,true);
  await commitOkey(db,id,state,'start-next-round'); await checkFinal(state,id);
});

test('Okey existing no-humans branch adds no final results beyond manual losses',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  // Prepared historical state, as in the existing authoritative no-humans test.
  // Ordinary sequential play can finish earlier via the existing team-forfeit rule.
  for(let i=0;i<3;i++) {
    state={...state,manualLeftPlayerIds:[...state.manualLeftPlayerIds,users[i]],roundState:handSeatToBot(state.roundState,i,'normal')};
    await commitOkey(db,id,state,'manual-leave',i);
  }
  state=applyAuthoritativeManualLeave(state,3);
  assert.equal(state.leaveTerminationReason,'no-humans'); assert.equal(state.matchWinnerTeamId,null);
  await commitOkey(db,id,state,'manual-leave',3);
  assert.equal((await results(db)).length,4);
  assert.ok((await results(db)).every((r:any)=>r.reason==='manual_leave'));
});

test('Okey legacy last-human-winner terminal branch preserves three personal losses',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  for(const i of [1,2,3]) {
    state={...state,manualLeftPlayerIds:[...state.manualLeftPlayerIds,users[i]]};
    await commitOkey(db,id,state,'manual-leave',i);
  }
  state=settleAuthoritativeOkeyRound({...state,leaveTerminationReason:'last-human-winner',
    roundState:{...state.roundState,phase:'finished',winnerId:users[1],endReason:'win'}});
  assert.equal(state.matchWinnerTeamId,'teamA');
  await commitOkey(db,id,state,'system-bot'); await checkFinal(state,id);
});

test('Okey pending-forfeit tile-cycle-limit branch uses lifecycle winner',async()=>{
  let state=initial(); const id=await createOkey(db,state);
  for(const i of [1,3]) {
    state={...state,manualLeftPlayerIds:[...state.manualLeftPlayerIds,users[i]]};
    await commitOkey(db,id,state,'manual-leave',i);
  }
  state=settleAuthoritativeOkeyRound({...state,pendingForfeitTeamId:'teamB',
    roundState:{...state.roundState,phase:'finished',winnerId:null,endReason:'tile-cycle-limit'}});
  assert.equal(state.matchFinished,true);
  await commitOkey(db,id,state,'system-bot'); await checkFinal(state,id);
});

for(const mode of ['1v1','2v2']) {
  test(`Domino ${mode} real reducer winner flows to shared stats unchanged`,async()=>{
    const room=await createDomino(db,mode);
    const tile={id:'6-6',left:6,right:6};
    const count=mode==='1v1'?2:4;
    const players=users.slice(0,count).map((user_id:string,player_index:number)=>({user_id,player_index,team_id:player_index%2?'teamB' as const:'teamA' as const}));
    const common={state:{teamScores:{teamA:345,teamB:10}},hands:Array.from({length:count},()=>[tile]),
      boneyard:[],players,playerIndex:0,actorUserId:users[0],tile,nextBoard:{centerTile:tile},nextSpinnerValue:6,
      moveScore:10,phaseStartedAt:'2026-09-28T00:00:00Z',isSameTile:(a:any,b:any)=>a.id===b.id};
    const transition=mode==='1v1'?reduceOneVsOnePlay({...common,canNextPlayerDraw:()=>false,isHandPlayable:()=>false,isBoneyardPlayable:()=>false})
      :reduceTwoVsTwoPlay({...common,canAnyPlayerMove:()=>true});
    assert.equal(transition.nextState.winningTeamId,'teamA');
    await db.query(`UPDATE ${room.prefix}_rooms SET state=$2,status=$3 WHERE id=$1`,[room.id,JSON.stringify(transition.nextState),transition.status]);
    await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    assert.equal((await results(db)).length,count);
    assert.equal((await results(db))[0].outcome,'win');
  });
}
