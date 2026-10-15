import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let failures=0;
function check(ok,label,help=''){console.log(`${ok?'✓':'✗'} ${label}`);if(!ok){failures++;if(help)console.log(`  ${help}`);}}
check(Number(process.versions.node.split('.')[0])>=24,`Node.js ${process.versions.node}`,'Node.js 24 이상을 설치하세요: https://nodejs.org/');
const version=spawnSync('codex',['--version'],{encoding:'utf8',timeout:10000});
check(!version.error&&version.status===0,'Codex CLI 설치','npm install -g @openai/codex');
if(!version.error&&version.status===0){
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8',timeout:10000});
 check(auth.status===0,'Codex 로그인','codex login 실행 후 본인 계정으로 로그인하세요. 앱의 계정 호환성은 시작 시 추가 확인합니다.');
}
check(fs.existsSync(path.join(root,'public/app.js')),'사무실 화면 준비','npm ci && npm run build');
try{fs.accessSync(root,fs.constants.W_OK);check(true,'프로젝트 저장 권한');}catch{check(false,'프로젝트 저장 권한','압축을 쓰기 가능한 개인 폴더에 풀어주세요.');}
console.log(failures?`\n${failures}개 항목을 확인한 뒤 npm run doctor를 다시 실행하세요.`:'\n준비됐습니다. npm run launch로 시작하세요.');
process.exitCode=failures?1:0;
