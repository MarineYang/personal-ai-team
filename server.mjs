import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {roles,expertInstructions} from './lib/roles.mjs';
import {CodexClient} from './lib/codex.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), cwd=path.join(root,'workspace');
const port=Number(process.env.PORT||18940), statePath=path.join(root,'.runtime/state.json');
fs.mkdirSync(path.join(cwd,'artifacts'),{recursive:true});fs.mkdirSync(path.dirname(statePath),{recursive:true});
let saved={};try{saved=JSON.parse(fs.readFileSync(statePath,'utf8'));}catch{}
const migrated=saved.roleVersion!==4;
const directorRole=roles.find(r=>r.id==='director');
const newDirector=()=>({...directorRole,instructions:undefined,status:'idle',currentTask:'',messages:[],queueCount:0});
const state={roleVersion:4,conversation:migrated?[]:saved.conversation||[],briefs:saved.briefs||[],connection:{status:'connecting',message:'Codex 연결 중'},model:saved.model||'',models:[],teamGoal:migrated?'':saved.teamGoal||'',teamProposal:migrated?null:saved.teamProposal||null,teamSpecs:migrated?[]:saved.teamSpecs||[],archivedTeams:[...(saved.archivedTeams||[]),...(migrated&&saved.agents?.length?[{run:saved.run,goal:saved.teamGoal,agents:saved.agents}]:[])],paused:true,agents:migrated?[newDirector()]:(saved.agents?.length?saved.agents:[newDirector()]).map(a=>({...a,status:'idle',queueCount:0})),events:saved.events||[],artifacts:saved.artifacts||[],approvals:[],run:migrated?{id:randomUUID(),automaticTurns:0,maxAutomaticTurns:20,phase:'idle'}:{...saved.run,id:saved.run?.id||randomUUID(),automaticTurns:saved.run?.automaticTurns||0,maxAutomaticTurns:20,phase:['complete','awaiting_input','consulting','awaiting_team'].includes(saved.run?.phase)?saved.run.phase:'idle'}};
const queues=new Map(state.agents.map(r=>[r.id,[]])), active=new Map(), resumed=new Set(), clients=new Set(), approvalRequests=new Map();
const stageAgents=stage=>state.agents.filter(a=>a.stage===stage);
let writeTimer;const now=()=>new Date().toISOString();
function persist(){clearTimeout(writeTimer);fs.writeFileSync(statePath+'.tmp',JSON.stringify(state,null,2));fs.renameSync(statePath+'.tmp',statePath);}
function publish(){for(const a of state.agents)a.queueCount=queues.get(a.id).length;const data=JSON.stringify(state);for(const c of clients)c.write(`event: state\ndata: ${data}\n\n`);clearTimeout(writeTimer);writeTimer=setTimeout(()=>{try{persist();}catch(e){console.error('상태 저장 실패:',e.message);}},200);}
function event(type,text,agentId){state.events.push({id:randomUUID(),at:now(),type,text,agentId});state.events=state.events.slice(-400);publish();}
function message(a,role,text,extra={}){const m={id:randomUUID(),at:now(),role,text,runId:state.run.id,...extra};a.messages.push(m);a.messages=a.messages.slice(-160);publish();return m;}
const agent=id=>state.agents.find(a=>a.id===id);
const client=new CodexClient({cwd});
function respond(id,result){try{client.respond(id,result);}catch(e){fail(e);}}
const tool=(name,description,properties,required=Object.keys(properties))=>({type:'function',name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const tools=[tool('team_propose_team','Director consultation only: propose a tailored team without creating agents; user must explicitly confirm',{goal:{type:'string',maxLength:1000},summary:{type:'string',maxLength:350},experts:{type:'array',minItems:2,maxItems:4,items:{type:'object',properties:{name:{type:'string',maxLength:30},role:{type:'string',maxLength:70},expertise:{type:'string',maxLength:1000},deliverable:{type:'string',maxLength:300},stage:{type:'string',enum:['research','production','review']}},required:['name','role','expertise','deliverable','stage'],additionalProperties:false}}}),tool('team_set_direction','Director assessment only: proceed with justified direction or ask user before production',{mode:{type:'string',enum:['proceed','ask']},reason:{type:'string',maxLength:350},evidence:{type:'string',maxLength:180},alternative:{type:'string',maxLength:180},question:{type:'string',maxLength:250},direction:{type:'string',maxLength:350}}),tool('team_publish_brief','Director only: publish concise user-facing decisions, next action and deliverable status',{summary:{type:'string',maxLength:350},decisions:{type:'array',maxItems:3,items:{type:'string',maxLength:180}},nextAction:{type:'string',maxLength:250},deliverableStatus:{type:'string',maxLength:180}}),tool('team_read_board','Read team task state, messages and full saved artifacts',{}),tool('team_update_task','Publish current task progress',{summary:{type:'string'}}),tool('team_save_artifact','Save a Markdown deliverable',{title:{type:'string'},filename:{type:'string'},content:{type:'string'}}),tool('team_send_message','Send information or assign work to a teammate',{to:{type:'string'},message:{type:'string'},requestWork:{type:'boolean'}})];
async function thread(a){if(resumed.has(a.id))return;const instructions=a.id==='director'?directorRole.instructions:expertInstructions(state.teamSpecs.find(r=>r.id===a.id));if(a.threadId){try{await client.request('thread/resume',{threadId:a.threadId,cwd,model:state.model,approvalPolicy:'on-request',sandbox:'workspace-write'});resumed.add(a.id);return;}catch{a.threadId=null;}}
const result=await client.request('thread/start',{cwd,model:state.model,modelProvider:'openai',approvalPolicy:'on-request',sandbox:'workspace-write',developerInstructions:instructions,dynamicTools:tools,experimentalRawEvents:false});a.threadId=result.thread.id;resumed.add(a.id);}
function enqueue(a,text,automatic=false,stage='manual'){if(automatic&&state.run.automaticTurns>=state.run.maxAutomaticTurns)throw Error('자동 작업 한도에 도달했습니다.');if(automatic)state.run.automaticTurns++;queues.get(a.id).push({text,stage,runId:state.run.id});message(a,'user',text);publish();void pump(a);}
async function pump(a){
if(active.has(a.id)||!queues.get(a.id).length||state.connection.status!=='ready'||state.paused)return;
const job=queues.get(a.id).shift();
if(job.runId!==state.run.id||(job.stage!=='manual'&&['stopped','error'].includes(state.run.phase))){publish();void pump(a);return;}
if(job.stage==='consultation'){state.teamProposal=null;state.run.phase='consulting';}
const work={...job,turnId:null,cancelled:false};active.set(a.id,work);a.status='running';a.error=null;a.currentTask=job.text.slice(0,180);publish();
try{
await thread(a);
if(work.cancelled){if(active.get(a.id)===work){active.delete(a.id);a.status='idle';a.currentTask='작업 중단';publish();void pump(a);}return;}
const r=await client.request('turn/start',{threadId:a.threadId,model:state.model,input:[{type:'text',text:job.text}],effort:'low'});
if(active.get(a.id)!==work)return;
work.turnId=r.turn.id;
if(work.cancelled)await client.request('turn/interrupt',{threadId:a.threadId,turnId:work.turnId});
}catch(e){if(active.get(a.id)!==work)return;active.delete(a.id);a.status=work.cancelled?'idle':'error';a.error=work.cancelled?null:e.message;event('error',e.message,a.id);if(job.stage!=='manual'&&job.runId===state.run.id&&!work.cancelled)state.run.phase='error';publish();void pump(a);}}
function advance(a,work,status){
if(work.cancelled||work.runId!==state.run.id||work.stage==='manual'||['idle','stopped','error','complete'].includes(state.run.phase))return;
if(status!=='completed'||state.paused){if(status==='failed')state.run.phase='error';return;}
if(work.stage==='consultation'){if(work.proposal){state.teamProposal=work.proposal;state.run.phase='awaiting_team';publish();}return;}
if(work.stage==='initial'){
state.run.directorDone=true;
for(const {id} of stageAgents('research'))if(!state.run.assigned?.includes(id)){state.run.assigned??=[];state.run.assigned.push(id);enqueue(agent(id),`팀 목표: ${state.teamGoal}\n아이디어의 수요·차별성·실행 가능성을 비판적으로 검토하세요. 반대 근거와 미확인 가설, 개선 대안, 사용자에게 필요한 핵심 질문을 저장하세요. 제작은 아직 시작하지 않습니다.`,true,'specialist');}
}
if(work.stage==='specialist'){state.run.done??=[];if(!state.run.done.includes(a.id))state.run.done.push(a.id);}
if(state.run.phase==='work'&&state.run.directorDone&&stageAgents('research').length&&stageAgents('research').every(a=>state.run.done?.includes(a.id))){
state.run.phase='assessment';enqueue(agent('director'),'리서치와 마케팅 검토가 완료됐습니다. 보드의 근거와 반대 의견을 읽고 team_set_direction을 호출하세요. 사용자 목표와 충돌하거나 방향을 바꿀 핵심 선택이 필요하면 ask로 우려·근거·대안·핵심 질문 하나를 제시하세요. 근거가 충분하고 중요한 선택이 없으면 proceed로 진행 방향을 정하세요. 제작은 서버가 이후 배정합니다.',true,'assessment');
}else if(work.stage==='assessment'&&state.run.phase==='assessment'){
const d=work.direction;
if(!d){state.run.phase='error';event('error','디렉터의 방향 판단이 저장되지 않았습니다. 디렉터에게 재검토를 요청해주세요.','director');return;}
state.run.direction=d;
const brief={runId:work.runId,at:now(),summary:d.reason,decisions:[d.evidence,d.alternative].filter(Boolean),nextAction:d.mode==='ask'?d.question:'정해진 방향으로 제작 구성을 준비합니다.',deliverableStatus:d.mode==='ask'?'방향 확인 대기 · 제작 시작 전':'방향 검토 완료 · 제작 구성 준비'};
state.briefs=state.briefs.filter(x=>x.runId!==work.runId).concat(brief).slice(-30);
if(d.mode==='ask'){state.run.phase='awaiting_input';event('direction','사용자 답변을 기다립니다. 제작은 아직 시작하지 않습니다.');}
else{state.run.phase='production';state.run.produced=[];for(const expert of stageAgents('production'))enqueue(expert,`합의한 방향: ${d.direction}\n보드의 근거와 사용자 답변을 반영하고 본인의 전문 산출물을 제작하세요.`,true,'production');}
}else if(work.stage==='production'&&state.run.phase==='production'){
state.run.produced??=[];if(!state.run.produced.includes(a.id))state.run.produced.push(a.id);if(!stageAgents('production').every(x=>state.run.produced.includes(x.id)))return;const reviewers=stageAgents('review');if(reviewers.length){state.run.phase='review';state.run.reviewed=[];for(const reviewer of reviewers)enqueue(reviewer,'합의한 목표와 방향, 조사와 제작 결과를 검수하세요.',true,'review');}else startSynthesis();
}else if(work.stage==='review'&&state.run.phase==='review'){
state.run.reviewed??=[];if(!state.run.reviewed.includes(a.id))state.run.reviewed.push(a.id);if(stageAgents('review').every(x=>state.run.reviewed.includes(x.id)))startSynthesis();
}else if(work.stage==='final'&&state.run.phase==='synthesis'){state.run.phase='complete';event('complete','기획 정리가 완료됐습니다. 결과물을 확인하세요.');}
}
function startSynthesis(){state.run.phase='synthesis';enqueue(agent('director'),'최종 종합 단계입니다. 보드의 전문 산출물을 목표와 대조하고 최종 결과 및 team_publish_brief를 저장하세요. 검수 전담자가 없으면 직접 검수하고 검수 범위를 명시하세요.',true,'final');}
function startConsultation(goal){
if(active.size)throw Error('진행 중인 작업을 먼저 중지해주세요.');
if(state.teamGoal)state.archivedTeams.push({run:state.run,goal:state.teamGoal,agents:state.agents});
state.conversation=[{role:'user',text:goal}];state.teamGoal=goal;state.teamSpecs=[];state.teamProposal=null;state.agents=[newDirector()];queues.clear();queues.set('director',[]);resumed.clear();state.paused=false;
state.run={id:randomUUID(),automaticTurns:0,maxAutomaticTurns:20,phase:'consulting',assigned:[],done:[]};
enqueue(agent('director'),`사용자가 만들고 싶은 팀에 대해 1:1 상담을 시작합니다. 아직 전문가는 존재하지 않습니다. 목적·원하는 결과·제약·팀이 맡을 범위를 충분히 이해할 때까지 짧은 질문으로 대화하세요. 첫 요청을 바로 팀 생성 동의로 취급하지 마세요. 사용자 요청: ${goal}`,false,'consultation');
}
function replyToConsultation(a,text){
if(a.id!=='director'||state.teamSpecs.length)return false;
state.conversation.push({role:'user',text});state.teamProposal=null;state.run.phase='consulting';state.paused=false;
enqueue(a,text,false,'consultation');return true;
}
function confirmTeam(proposalId){
if(state.connection.status!=='ready')throw Error('연결을 먼저 확인해주세요.');
if(active.size||state.run.phase!=='awaiting_team'||!state.teamProposal||state.teamProposal.id!==proposalId)throw Error('현재 팀 구성안을 다시 확인해주세요.');
const proposal=state.teamProposal;state.teamGoal=proposal.goal;
state.briefs=state.briefs.filter(b=>b.runId!==state.run.id).concat({runId:state.run.id,at:now(),summary:proposal.summary,decisions:[`합의한 전문가 ${proposal.experts.length}명이 팀에 합류했습니다.`],nextAction:'전문가들이 목표와 방향을 검토합니다. 추가 의견은 디렉터에게 알려주세요.',deliverableStatus:'팀 구성 완료 · 전문 작업 시작'}).slice(-30);
state.teamSpecs=proposal.experts.map((x,i)=>({...x,id:`expert_${i+1}`}));
for(const spec of state.teamSpecs){state.agents.push({...spec,description:spec.expertise,status:'idle',currentTask:'',messages:[],queueCount:0,model:state.model});queues.set(spec.id,[]);}
state.teamProposal=null;state.paused=false;state.run.phase='work';state.run.directorDone=true;state.run.done=[];state.run.assigned=state.teamSpecs.map(x=>x.id);
for(const expert of stageAgents('research'))enqueue(expert,`사용자가 팀 구성을 확정했습니다. 목표: ${state.teamGoal}\n본인의 전문 영역에서 기회와 반대 근거·미확인 가설·대안을 조사하고 산출물을 저장하세요.`,true,'specialist');
event('team','합의한 전문가 팀을 구성했습니다.');
}
function replyToDirection(a,text){
if(a.id!=='director'||!['awaiting_input','error'].includes(state.run.phase)||!state.run.directorDone)return false;
if(active.has(a.id))throw Error('디렉터가 정리 중입니다. 잠시 후 답변해주세요.');
state.paused=false;state.run.phase='assessment';
enqueue(a,`방향 재검토입니다. 보드의 기존 우려와 사용자 답변을 함께 읽으세요. 이 답변을 자동 동의로 간주하지 말고 질문·이견이면 답하고, 필요한 경우 다시 ask하세요. 의도가 명확하면 해당 방향으로 proceed하세요. team_set_direction 호출이 필수입니다.\n사용자 답변: ${text}`,false,'assessment');return true;
}
client.on('notification',({method,params:p})=>{const a=state.agents.find(x=>x.threadId===p?.threadId);if(!a)return;const work=active.get(a.id);if(method==='turn/started'&&work&&!work.turnId)work.turnId=p.turn.id;
const eventTurnId=p.turnId||p.turn?.id;if(work&&eventTurnId&&work.turnId&&eventTurnId!==work.turnId)return;
if(method==='item/agentMessage/delta'){let m=a.messages.find(x=>x.itemId===p.itemId);if(!m)m=message(a,'assistant','',{itemId:p.itemId,streaming:true});m.text+=p.delta;publish();}
if(method==='item/completed'&&p.item?.type==='agentMessage'){let m=a.messages.find(x=>x.itemId===p.item.id);if(!m)m=message(a,'assistant',p.item.text||'',{itemId:p.item.id});m.streaming=false;publish();}
if(method==='item/started'&&['commandExecution','fileChange','webSearch'].includes(p.item?.type))event('tool',p.item.type==='commandExecution'?`명령 실행: ${p.item.command}`:`도구 실행: ${p.item.type}`,a.id);
if(method==='thread/tokenUsage/updated'){a.tokens=p.tokenUsage?.total;publish();}
if(method==='turn/completed'&&work&&work.turnId===p.turn.id){active.delete(a.id);for(const m of a.messages)m.streaming=false;a.status=p.turn.status==='failed'?'error':'idle';a.error=p.turn.error?.message;a.currentTask=p.turn.status==='completed'?'작업 완료':`작업 ${p.turn.status}`;event('turn',a.currentTask,a.id);advance(a,work,p.turn.status);publish();void pump(a);}});
function artifactPath(item){
const filename=item.storageName||item.filename;
if(typeof filename!=='string'||!filename.match(/^[a-zA-Z0-9_-]+\.md$/))throw Error('잘못된 문서 경로');
const base=path.join(cwd,'artifacts');
if(fs.lstatSync(base).isSymbolicLink()||fs.realpathSync(base)!==path.join(fs.realpathSync(cwd),'artifacts'))throw Error('문서 폴더 링크는 허용되지 않습니다.');
return path.join(base,filename);
}
function readArtifact(item){const fd=fs.openSync(artifactPath(item),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>800000)throw Error('읽을 수 없는 문서 형식 또는 크기');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}
async function dynamic(a,name,args){const work=active.get(a.id);if(!work||work.cancelled||work.runId!==state.run.id)throw Error('비활성 작업입니다.');if(name==='team_read_board')return {goal:state.teamGoal,run:state.run,agents:state.agents.map(x=>({id:x.id,name:x.name,role:x.role,stage:x.stage,status:x.status,currentTask:x.currentTask,messages:x.messages.filter(m=>['peer','user'].includes(m.role)&&m.runId===state.run.id).slice(-12)})),artifacts:state.artifacts.filter(x=>x.runId===state.run.id).map(x=>{try{return {...x,content:readArtifact(x)};}catch(e){return {...x,error:e.message};}})};
if(name==='team_propose_team'){
if(a.id!=='director'||work.stage!=='consultation'||state.teamSpecs.length)throw Error('팀 구성 상담 중에만 제안할 수 있습니다.');
if(typeof args.goal!=='string'||!args.goal.trim()||args.goal.length>1000||typeof args.summary!=='string'||!args.summary.trim()||args.summary.length>350)throw Error('팀 목표와 요약을 확인해주세요.');
if(!Array.isArray(args.experts)||args.experts.length<2||args.experts.length>4)throw Error('필요한 전문가 2~4명을 제안하세요.');
for(const e of args.experts){if(!['research','production','review'].includes(e.stage))throw Error('잘못된 전문 단계');for(const [key,max] of [['name',30],['role',70],['expertise',1000],['deliverable',300]])if(typeof e[key]!=='string'||!e[key].trim()||e[key].length>max)throw Error('전문가 역할과 산출물을 구체화하세요.');}
if(!args.experts.some(e=>e.stage==='research')||!args.experts.some(e=>e.stage==='production'))throw Error('조사와 제작 전문성이 필요합니다.');
work.proposal={id:randomUUID(),runId:work.runId,goal:args.goal,summary:args.summary,experts:args.experts.map(e=>({name:e.name,role:e.role,expertise:e.expertise,deliverable:e.deliverable,stage:e.stage}))};return {ok:true,created:false};}
if(name==='team_set_direction'){
if(a.id!=='director'||work.stage!=='assessment'||state.run.phase!=='assessment')throw Error('방향 검토 단계의 디렉터만 판단할 수 있습니다.');
if(!['ask','proceed'].includes(args.mode))throw Error('잘못된 판단');
for(const [key,max] of [['reason',350],['evidence',180],['alternative',180],['question',250],['direction',350]])if(typeof args[key]!=='string'||args[key].length>max)throw Error('방향 판단 형식 오류');
if(!args.reason.trim()||!args.evidence.trim()||(args.mode==='ask'&&(!args.question.trim()||!args.alternative.trim()))||(args.mode==='proceed'&&!args.direction.trim()))throw Error('근거·질문·대안 또는 진행 방향이 필요합니다.');
work.direction={mode:args.mode,reason:args.reason,evidence:args.evidence,alternative:args.alternative,question:args.question,direction:args.direction};return {ok:true};}
if(name==='team_publish_brief'){
if(a.id!=='director')throw Error('디렉터만 브리핑을 게시할 수 있습니다.');
for(const [key,max] of [['summary',350],['nextAction',250],['deliverableStatus',180]])if(typeof args[key]!=='string'||!args[key].trim()||args[key].length>max)throw Error('브리핑 형식 또는 길이 오류');
if(!Array.isArray(args.decisions)||args.decisions.length>3||args.decisions.some(x=>typeof x!=='string'||x.length>180))throw Error('결정 사항은 3개 이하로 작성하세요.');
if(!state.teamSpecs.length)state.conversation.push({role:'assistant',text:[args.summary,...args.decisions,args.nextAction].filter(Boolean).join('\n\n')});
const brief={runId:work.runId,at:now(),summary:args.summary,decisions:args.decisions,nextAction:args.nextAction,deliverableStatus:args.deliverableStatus};
state.briefs=state.briefs.filter(x=>x.runId!==work.runId).concat(brief).slice(-30);publish();return {ok:true};}
if(name==='team_update_task'){a.currentTask=String(args.summary).slice(0,500);event('progress',a.currentTask,a.id);return {ok:true};}
if(name==='team_save_artifact'){
const filename=args.filename;if(typeof filename!=='string'||!filename.match(/^[a-zA-Z0-9_-]+\.md$/))throw Error('영문·숫자·하이픈 .md 파일명만 허용됩니다.');
if(typeof args.content!=='string'||args.content.length>200000)throw Error('문서 크기 제한');
let item=state.artifacts.find(x=>x.filename===filename&&x.runId===work.runId);
if(item&&item.agentId!==a.id)throw Error('다른 팀원의 파일명입니다.');
// Keep previous runs immutable and visible in the UI even with repeated names.
const storageName=item?.storageName||`${work.runId}-${filename}`;
const dest=artifactPath({filename:storageName});
const fd=fs.openSync(dest,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
try{if(!fs.fstatSync(fd).isFile())throw Error('일반 파일만 허용됩니다.');fs.ftruncateSync(fd,0);fs.writeFileSync(fd,args.content);}finally{fs.closeSync(fd);}
if(!item){item={id:randomUUID(),filename,storageName,agentId:a.id,runId:work.runId};state.artifacts.push(item);}
Object.assign(item,{title:String(args.title),updatedAt:now()});event('artifact',`결과물 저장: ${item.title}`,a.id);return item;}
if(name==='team_send_message'){const to=agent(args.to);if(!to||to===a)throw Error('잘못된 수신자');message(to,'peer',String(args.message),{from:a.id,to:to.id});event('message',`${a.name} → ${to.name}: ${String(args.message).slice(0,180)}`,a.id);if(args.requestWork){if(a.id!=='director'||work.stage!=='initial'||to.stage!=='research'||state.run.phase!=='work')return {delivered:true,started:false,reason:'자동 배정은 초기 팀장의 리서치·마케팅 배정만 허용됩니다.'};state.run.assigned??=[];if(state.run.assigned.includes(to.id))return {delivered:true,started:false,reason:'이미 배정됨'};state.run.assigned.push(to.id);enqueue(to,String(args.message),true,'specialist');}return {delivered:true};}throw Error('Unknown tool');}
client.on('request',async r=>{const a=state.agents.find(x=>x.threadId===r.params?.threadId);if(r.method==='item/tool/call'){try{if(!a)throw Error('Unknown agent');const current=active.get(a.id);if(!current||current.cancelled||(current.turnId&&current.turnId!==r.params.turnId))throw Error('만료된 작업 요청');const result=await dynamic(a,r.params.tool,r.params.arguments);respond(r.id,{contentItems:[{type:'inputText',text:JSON.stringify(result)}],success:true});}catch(e){respond(r.id,{contentItems:[{type:'inputText',text:e.message}],success:false});}return;}
if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(r.method)&&a){const id=randomUUID();approvalRequests.set(id,r);state.approvals.push({id,agentId:a.id,title:'작업 권한 승인',detail:JSON.stringify(r.params,null,2)});a.status='waiting_approval';publish();return;}
if(r.method==='item/tool/requestUserInput'){if(a)message(a,'system','추가 정보가 필요합니다. 개별 지시로 내용을 전달해주세요.');respond(r.id,{answers:{}});return;}respond(r.id,r.method==='item/permissions/requestApproval'?{permissions:{},scope:'turn'}:{decision:'decline'});});
function fail(e){state.connection={status:'error',message:e.message||String(e)};state.paused=true;for(const a of state.agents){if(active.has(a.id)){a.status='error';a.error='연결 중단. 다시 지시해주세요.';}}active.clear();publish();}
client.on('error',fail);client.on('exit',()=>fail(Error('Codex 프로세스가 종료됐습니다. 서버를 다시 시작해주세요.')));
async function stop(a){if(['work','assessment','awaiting_input','production','review','synthesis'].includes(state.run.phase))state.run.phase='stopped';queues.get(a.id).length=0;const work=active.get(a.id);if(work){work.cancelled=true;if(work.turnId)await client.request('turn/interrupt',{threadId:a.threadId,turnId:work.turnId});}for(const [id,r]of approvalRequests){if(r.params.threadId===a.threadId){respond(r.id,{decision:'decline'});approvalRequests.delete(id);state.approvals=state.approvals.filter(x=>x.id!==id);}}if(active.get(a.id)===work&&work){a.status='running';a.currentTask='중단 요청 중';}else a.status='idle';publish();}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{try{const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];if(!hosts.includes(req.headers.host))return json(res,403,{error:'허용되지 않은 호스트'});if(req.headers.origin&&!hosts.some(h=>req.headers.origin===`http://${h}`))return json(res,403,{error:'외부 출처 요청 거부'});if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'외부 요청 거부'});const url=new URL(req.url,`http://127.0.0.1:${port}`),p=url.pathname;
if(req.method==='GET'&&p==='/api/state')return json(res,200,state);
if(req.method==='GET'&&p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
if(req.method==='GET'&&p.startsWith('/api/artifacts/')){const item=state.artifacts.find(x=>x.id===p.split('/').at(-1));if(!item)return json(res,404,{error:'결과물 없음'});return json(res,200,{title:item.title,content:readArtifact(item)});}
if(req.method==='POST'){if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON 요청만 허용됩니다.'});let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('요청 크기 초과');}const data=JSON.parse(body||'{}');
if(p==='/api/team/stop'){state.paused=true;state.run.phase='stopped';await Promise.all(state.agents.map(stop));}
else if(p==='/api/team/start'){if(state.connection.status!=='ready')throw Error('Codex 연결을 먼저 확인해주세요.');if(typeof data.goal!=='string'||!data.goal.trim())throw Error('만들고 싶은 팀을 알려주세요.');startConsultation(data.goal.trim());}
else if(p==='/api/team/confirm'){confirmTeam(data.proposalId);}
else if(p==='/api/model'){if(active.size)throw Error('작업 완료 후 모델을 변경해주세요.');if(!state.models.some(m=>m.id===data.model))throw Error('모델을 확인해주세요.');state.model=data.model;for(const a of state.agents)a.model=data.model;}
else if(p.startsWith('/api/agents/')){const [, , ,id,action]=p.split('/');const a=agent(id);if(!a)throw Error('팀원 없음');if(action==='stop')await stop(a);else if(action==='message'){if(state.connection.status!=='ready')throw Error('Codex 연결 안 됨');if(!data.message?.trim())throw Error('지시를 입력해주세요.');state.paused=false;const w=active.get(id);if(data.mode==='steer'&&w?.turnId){await client.request('turn/steer',{threadId:a.threadId,expectedTurnId:w.turnId,input:[{type:'text',text:data.message}]});message(a,'user',data.message);}else if(!replyToConsultation(a,data.message)&&!replyToDirection(a,data.message))enqueue(a,data.message);}else throw Error('잘못된 작업');}
else if(p.startsWith('/api/approvals/')){const id=p.split('/').at(-1),r=approvalRequests.get(id);if(!r)throw Error('승인 요청 없음');if(!['accept','decline'].includes(data.decision))throw Error('잘못된 승인');respond(r.id,{decision:data.decision});approvalRequests.delete(id);state.approvals=state.approvals.filter(x=>x.id!==id);const a=state.agents.find(x=>x.threadId===r.params.threadId);if(a)a.status='running';}else return json(res,404,{error:'경로 없음'});publish();return json(res,200,{ok:true});}
if(req.method==='GET'){const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!files[p])return json(res,404,{error:'경로 없음'});res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});return res.end(fs.readFileSync(path.join(root,'public',files[p])));}json(res,405,{error:'허용되지 않은 메서드'});
}catch(e){json(res,400,{error:e.message});}});
server.on('error',e=>{console.error('로컬 서버 오류:',e.code||e.message);client.close();clearTimeout(writeTimer);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Personal AI Team: http://127.0.0.1:${port}`));
try{await client.start();const account=await client.request('account/read',{});if(!account.account||!String(account.account.type).toLowerCase().includes('chatgpt'))throw Error('ChatGPT 구독 로그인 필요: 터미널에서 codex login을 실행해주세요.');const result=await client.request('model/list',{});state.models=result.data.filter(m=>!m.hidden&&/^gpt-/i.test(m.model||m.id)).map(m=>({id:m.model||m.id,displayName:m.displayName,isDefault:m.isDefault}));if(!state.models.some(m=>m.id===state.model))state.model=(state.models.find(m=>m.isDefault)||state.models[0])?.id;if(!state.model)throw Error('사용 가능한 GPT 모델이 없습니다.');for(const a of state.agents)a.model=state.model;state.connection={status:'ready',message:'ChatGPT 계정으로 연결됨',authType:'chatgpt'};event('connection','Codex 연결 완료');}catch(e){fail(e);}
setInterval(()=>{for(const c of clients)c.write(': heartbeat\n\n');},15000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{state.paused=true;for(const a of state.agents){if(active.has(a.id)){a.status='idle';a.currentTask='서버 종료로 중단됨. 다시 지시해주세요.';}}try{persist();}catch(e){console.error('종료 시 상태 저장 실패:',e.message);}client.close();server.close();process.exit(0);});
