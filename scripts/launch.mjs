import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||18940);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT는 1024~65535 사이 숫자로 지정하세요.');
const url=`http://127.0.0.1:${port}`;
async function probe(){try{const r=await fetch(url+'/api/state',{signal:AbortSignal.timeout(1000)});if(!r.ok)return false;const s=await r.json();return s.roleVersion===4&&Array.isArray(s.agents)&&Array.isArray(s.teamSpecs);}catch{return false;}}
function open(){console.log(`\n팀룸: ${url}\n브라우저가 열리지 않으면 위 주소로 접속하세요.`);if(process.argv.includes('--no-open'))return;const cmd=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';const browser=spawn(cmd,[url],{stdio:'ignore'});browser.on('error',()=>{});browser.unref();}
if(await probe()){console.log('이미 실행 중인 팀룸을 엽니다.');open();}else{
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,stdio:'inherit',env:process.env});
 let stopped=false;child.on('error',e=>{stopped=true;console.error(e.message);process.exitCode=1;});
 child.on('exit',code=>{stopped=true;process.exitCode=code||0;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);});
 for(let i=0;i<40&&!stopped;i++){await new Promise(r=>setTimeout(r,250));if(await probe()){open();break;}}
}
