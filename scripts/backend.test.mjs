import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { roles, expertInstructions } from '../lib/roles.mjs';

// Exercise the real orchestration functions without binding a port or starting
// Codex. This boundary is intentionally asserted so a server refactor fails
// clearly instead of accidentally contacting the live app or a model.
const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const boundary = 'const server=http.createServer';
assert.equal(source.split(boundary).length, 2, 'Update test harness after server boundary refactor');
const rootExpression = 'path.dirname(fileURLToPath(import.meta.url))';
assert.ok(source.includes(rootExpression));

function fixture(t, {fresh=false,seed}={}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-team-test-'));
  if(seed){fs.mkdirSync(path.join(root,'.runtime'));fs.writeFileSync(path.join(root,'.runtime/state.json'),JSON.stringify(seed));}
  const timers = new Set();
  class FakeCodex extends EventEmitter {
    calls = [];
    responses = [];
    handler = async () => ({});
    request(method, params) { this.calls.push({ method, params }); return this.handler(method, params); }
    respond(id, result) { this.responses.push({ id, result }); }
  }
  const context = vm.createContext({
    fs, path, randomUUID, roles, expertInstructions, CodexClient: FakeCodex, console,
    process: { env: {} },
    setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
  });
  const code = source.split(boundary)[0].replace(/^import .*;\n/gm, '').replace(rootExpression, JSON.stringify(root));
  vm.runInContext(code, context, { filename: 'server-core-under-test.mjs' });
  const api = vm.runInContext('({state,active,queues,agent,dynamic,readArtifact,advance,replyToDirection,startConsultation,replyToConsultation,confirmTeam,stop,pump,client,cwd})', context);
  t.after(() => { for (const timer of timers) clearTimeout(timer); fs.rmSync(root, { recursive: true, force: true }); });
  api.activate = (id, extra = {}) => {
    const a = api.agent(id);
    api.active.set(id, { runId: api.state.run.id, cancelled: false, stage: 'manual', ...extra });
    return a;
  };
  if(!fresh){
    api.state.agents=roles.map(r=>({...r,instructions:undefined,status:'idle',messages:[],queueCount:0,stage:{researcher:'research',marketer:'research',producer:'production',reviewer:'review'}[r.id]}));
    api.state.teamSpecs=api.state.agents.filter(a=>a.id!=='director').map(a=>({...a,expertise:a.description,deliverable:'검증용 산출물'}));
    for(const a of api.state.agents)api.queues.set(a.id,[]);
  }
  return api;
}
const doc = (content, filename = 'plan.md') => ({ title: 'Plan', filename, content });

test('another agent cannot overwrite an owned artifact, even when the request fails', async t => {
  const f = fixture(t), owner = f.activate('researcher'), other = f.activate('producer');
  const saved = await f.dynamic(owner, 'team_save_artifact', doc('original'));
  await assert.rejects(f.dynamic(other, 'team_save_artifact', doc('replacement')), /다른 팀원/);
  assert.equal(f.readArtifact(saved), 'original');
  assert.equal(f.state.artifacts.length, 1);
});

test('new runs isolate the board while preserving earlier files with identical names', async t => {
  const f = fixture(t), a = f.activate('researcher');
  const original = await f.dynamic(a, 'team_save_artifact', doc('old run'));
  f.state.run.id = randomUUID(); f.activate(a.id);
  const next = await f.dynamic(a, 'team_save_artifact', doc('new run'));
  assert.notEqual(original.storageName, next.storageName);
  assert.equal(f.readArtifact(original), 'old run');
  const board = await f.dynamic(a, 'team_read_board', {});
  assert.equal(board.artifacts.length, 1);
  assert.equal(board.artifacts[0].content, 'new run');
  assert.equal(f.state.artifacts.length, 2);
});

test('artifact reads reject traversal and symlinks without reading the target', t => {
  const f = fixture(t);
  const target = path.join(path.dirname(f.cwd), 'private.txt');
  fs.writeFileSync(target, 'private fixture data');
  fs.symlinkSync(target, path.join(f.cwd, 'artifacts', 'link.md'));
  assert.throws(() => f.readArtifact({ filename: 'link.md' }));
  assert.throws(() => f.readArtifact({ filename: '../private.txt' }), /경로/);
});

test('cancelled or previous-run completions cannot advance the workflow', t => {
  const f = fixture(t), a = f.agent('director');
  f.state.paused = false; f.state.run.phase = 'work';
  f.advance(a, { runId: f.state.run.id, stage: 'initial', cancelled: true }, 'completed');
  f.advance(a, { runId: 'old-run', stage: 'initial', cancelled: false }, 'completed');
  assert.equal(f.state.run.directorDone, undefined);
  assert.equal(f.queues.get('researcher').length, 0);
  assert.equal(f.queues.get('producer').length, 0);
});

test('stopping one specialist blocks automatic progression without cancelling teammates', async t => {
  const f = fixture(t), a = f.activate('researcher', { stage: 'specialist', turnId: 'r-turn' });
  f.activate('producer', { stage: 'specialist', turnId: 'p-turn' });
  f.state.paused = false; f.state.run.phase = 'work';
  await f.stop(a);
  assert.equal(f.state.run.phase, 'stopped');
  assert.equal(f.active.get('researcher').cancelled, true);
  assert.equal(f.active.get('producer').cancelled, false);
  f.advance(f.agent('producer'), f.active.get('producer'), 'completed');
  assert.equal(f.queues.get('reviewer').length, 0);
});

test('delayed completion from an earlier turn leaves the current turn active', t => {
  const f = fixture(t), a = f.activate('researcher', { turnId: 'current-turn' });
  a.threadId = 'thread';
  const work = f.active.get(a.id);
  f.client.emit('notification', { method: 'turn/completed', params: {
    threadId: a.threadId, turn: { id: 'old-turn', status: 'completed' },
  } });
  assert.equal(f.active.get(a.id), work);
});

test('stop during thread initialization cleans up without starting a turn', async t => {
  const f = fixture(t), a = f.agent('researcher');
  let release;
  f.client.handler = () => new Promise(resolve => { release = resolve; });
  f.state.connection.status = 'ready'; f.state.paused = false; f.state.run.phase = 'work';
  f.queues.get(a.id).push({ text: 'task', stage: 'specialist', runId: f.state.run.id });
  const pumping = f.pump(a);
  await f.stop(a);
  release({ thread: { id: 'new-thread' } });
  await pumping;
  assert.equal(f.active.has(a.id), false);
  assert.equal(a.status, 'idle');
  assert.equal(f.client.calls.some(call => call.method === 'turn/start'), false);
});

test('research and marketing finish before direction assessment; production remains blocked', t => {
  const f=fixture(t); f.state.paused=false; f.state.run.phase='work';
  f.advance(f.agent('director'),{runId:f.state.run.id,stage:'initial'},'completed');
  assert.equal(f.queues.get('marketer').length,1);
  assert.equal(f.queues.get('producer').length,0);
  f.advance(f.agent('researcher'),{runId:f.state.run.id,stage:'specialist'},'completed');
  assert.equal(f.state.run.phase,'work');
  f.advance(f.agent('marketer'),{runId:f.state.run.id,stage:'specialist'},'completed');
  assert.equal(f.state.run.phase,'assessment');
  assert.equal(f.queues.get('director')[0].stage,'assessment');
  assert.equal(f.queues.get('producer').length,0);
  assert.equal(f.queues.get('reviewer').length,0);
});

test('only director can publish concise briefs and new runs keep them isolated', async t => {
  const f=fixture(t),d=f.activate('director'),r=f.activate('researcher');
  const brief={summary:'방향 결정',decisions:['한 구역 촬영'],nextAction:'원본 촬영',deliverableStatus:'촬영 준비'};
  await assert.rejects(f.dynamic(r,'team_publish_brief',brief),/디렉터/);
  await f.dynamic(d,'team_publish_brief',brief);
  await f.dynamic(d,'team_publish_brief',{...brief,summary:'수정된 방향'});
  assert.equal(f.state.briefs.length,1);
  assert.equal(f.state.briefs[0].summary,'수정된 방향');
  await assert.rejects(f.dynamic(d,'team_publish_brief',{...brief,decisions:Array(4).fill('x')}),/3개/);
  await assert.rejects(f.dynamic(d,'team_publish_brief',{...brief,summary:'x'.repeat(351)}),/길이/);
  const oldRun=f.state.run.id;f.state.run.id=randomUUID();f.activate('director');
  await f.dynamic(d,'team_publish_brief',brief);
  assert.equal(f.state.briefs.length,2);
  assert.equal(f.state.briefs.find(b=>b.runId===oldRun).summary,'수정된 방향');
});

const direction={mode:'ask',reason:'대상이 너무 넓습니다.',evidence:'대상 수요는 아직 미검증입니다.',alternative:'입문 직장인으로 좁힐 수 있습니다.',question:'가장 돕고 싶은 대상은 누구인가요?',direction:''};
test('asking waits indefinitely and user response is reassessed, never auto-approved',async t=>{
 const f=fixture(t);f.state.paused=false;f.state.run.phase='assessment';f.state.run.directorDone=true;
 const a=f.activate('director',{stage:'assessment'}),w=f.active.get(a.id);
 await f.dynamic(a,'team_set_direction',direction);
 assert.equal(f.state.briefs.length,0);
 f.active.delete(a.id);f.advance(a,w,'completed');
 assert.equal(f.state.run.phase,'awaiting_input');
 assert.equal(f.state.briefs[0].nextAction,direction.question);
 assert.equal(f.queues.get('producer').length,0);
 assert.equal(f.replyToDirection(a,'왜 대상을 좁혀야 하나요?'),true);
 assert.equal(f.state.run.phase,'assessment');
 assert.equal(f.queues.get('director')[0].stage,'assessment');
 assert.equal(f.queues.get('producer').length,0);
});
test('proceed starts production once and only then enables review',async t=>{
 const f=fixture(t);f.state.paused=false;f.state.run.phase='assessment';
 const a=f.activate('director',{stage:'assessment'}),w=f.active.get(a.id);
 await f.dynamic(a,'team_set_direction',{...direction,mode:'proceed',question:'',direction:'입문 직장인을 위한 시범 영상'});
 f.active.delete(a.id);f.advance(a,w,'completed');f.advance(a,w,'completed');
 assert.equal(f.state.run.phase,'production');assert.equal(f.queues.get('producer').length,1);
 assert.equal(f.queues.get('reviewer').length,0);
 f.advance(f.agent('producer'),{runId:f.state.run.id,stage:'production'},'completed');
 assert.equal(f.state.run.phase,'review');assert.equal(f.queues.get('reviewer').length,1);
});
test('missing, cancelled, unauthorized or invalid decisions cannot release production',async t=>{
 const f=fixture(t);f.state.paused=false;f.state.run.phase='assessment';
 const r=f.activate('researcher',{stage:'assessment'});
 await assert.rejects(f.dynamic(r,'team_set_direction',direction),/디렉터/);
 const a=f.activate('director',{stage:'assessment'});
 await assert.rejects(f.dynamic(a,'team_set_direction',{...direction,question:''}),/필요/);
 await f.dynamic(a,'team_set_direction',direction);
 const w=f.active.get(a.id);w.cancelled=true;f.advance(a,w,'completed');
 assert.equal(f.state.run.phase,'assessment');assert.equal(f.state.briefs.length,0);
 f.advance(a,{runId:f.state.run.id,stage:'assessment'},'completed');
 assert.equal(f.state.run.phase,'error');assert.equal(f.queues.get('producer').length,0);
});

const teamProposal={goal:'교육 앱 제작팀',summary:'교사 요구를 조사하고 학습 앱을 구현하는 팀',experts:[
 {name:'윤서',role:'교육 사용자 리서처',expertise:'교사의 수업 준비 과정과 학습자 요구 검증',deliverable:'인터뷰 질문과 요구 분석',stage:'research'},
 {name:'태오',role:'교육 앱 개발자',expertise:'학습 흐름을 구현하고 접근성을 확인',deliverable:'실행 가능한 앱',stage:'production'}
]};
test('first visit and new consultation have only director; old teams are archived',t=>{
 const f=fixture(t,{fresh:true,seed:{roleVersion:3,teamGoal:'old',agents:[{id:'director'},{id:'researcher'}],artifacts:[],run:{id:'old-run',phase:'complete'}}});
 assert.deepEqual(Array.from(f.state.agents,a=>a.id),['director']);
 assert.equal(f.state.archivedTeams.length,1);
 f.startConsultation('앱 개발 팀을 만들고 싶어요');
 assert.equal(f.state.run.phase,'consulting');assert.equal(f.state.agents.length,1);
 assert.equal(f.queues.has('expert_1'),false);
});
test('proposal creates no agents; revision invalidates it; exact confirmation creates tailored team once',async t=>{
 const f=fixture(t,{fresh:true});f.startConsultation('교육 앱 팀');f.state.paused=false;
 const a=f.activate('director',{stage:'consultation'}),w=f.active.get('director');
 await f.dynamic(a,'team_propose_team',teamProposal);assert.equal(f.state.agents.length,1);assert.equal(f.state.teamProposal,null);
 f.active.delete('director');f.advance(a,w,'completed');
 assert.equal(f.state.run.phase,'awaiting_team');const oldId=f.state.teamProposal.id;
 f.replyToConsultation(a,'개발자를 다른 분야로 바꾸고 싶어요');
 assert.equal(f.state.teamProposal,null);assert.throws(()=>f.confirmTeam(oldId));
 f.activate('director',{stage:'consultation'});await f.dynamic(a,'team_propose_team',teamProposal);
 const revised=f.active.get('director');f.active.delete('director');f.advance(a,revised,'completed');
 f.queues.get('director').length=0;
 f.state.connection.status='ready';f.client.handler=async(method)=>method==='thread/start'?{thread:{id:'test-thread'}}:{turn:{id:'test-turn'}};
 assert.throws(()=>f.confirmTeam(oldId));
 const proposalId=f.state.teamProposal.id;f.confirmTeam(proposalId);
 assert.equal(f.state.agents.length,3);assert.equal(f.agent('expert_2').role,'교육 앱 개발자');
 assert.match(expertInstructions(f.state.teamSpecs[1]),/학습 흐름을 구현/);
 assert.equal(f.state.run.phase,'work');assert.equal(f.queues.get('expert_2').length,0);
 assert.throws(()=>f.confirmTeam(proposalId));
 await new Promise(resolve=>setImmediate(resolve));
});
test('awaiting team proposal survives restart without spawning specialists',t=>{
 const f=fixture(t,{fresh:true,seed:{roleVersion:4,teamGoal:'교육 앱',agents:[{id:'director',messages:[]}],teamSpecs:[],teamProposal:{...teamProposal,id:'proposal-1'},run:{id:'r1',phase:'awaiting_team'}}});
 assert.equal(f.state.run.phase,'awaiting_team');assert.equal(f.state.teamProposal.id,'proposal-1');assert.equal(f.state.agents.length,1);
});
