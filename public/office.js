import * as THREE from 'three';
const host=document.getElementById('office'),loading=document.getElementById('office-loading');
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{loading.textContent='이 환경에서는 3D 사무실을 표시할 수 없어요. 아래에서 팀 상태와 브리핑을 확인할 수 있습니다.';}
if(renderer) init();
function init(){
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0xeeeee6,0);host.prepend(renderer.domElement);loading.remove();
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-9,9,7,-7,.1,100);camera.position.set(13,14,17);camera.lookAt(0,.7,0);
scene.add(new THREE.HemisphereLight(0xfffaf0,0x9baf96,2.5));const sun=new THREE.DirectionalLight(0xfff2db,3.1);sun.position.set(-5,12,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-10,right:10,top:10,bottom:-10});sun.shadow.normalBias=.035;sun.shadow.bias=-.0002;sun.shadow.radius=4;scene.add(sun);
const materials=new Map();function mat(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.75}));return materials.get(color);}
function mesh(geometry,color,x,y,z,parent=scene){const m=new THREE.Mesh(geometry,mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function box(w,h,d,c,x,y,z,p){return mesh(new THREE.BoxGeometry(w,h,d),c,x,y,z,p);}
function sphere(r,c,x,y,z,p,s=[1,1,1]){const m=mesh(new THREE.SphereGeometry(r,24,16),c,x,y,z,p);m.scale.set(...s);return m;}
function cyl(r1,r2,h,c,x,y,z,p){return mesh(new THREE.CylinderGeometry(r1,r2,h,24),c,x,y,z,p);}
function group(x,y,z,rot=0){const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=rot;scene.add(g);return g;}
function textPlane(text,w,h,x,y,z,size=70,color='#536449',bg='#f7f7eb',parent=scene){const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1024,256);ctx.fillStyle=color;ctx.font=`600 ${size}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,128);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture}));m.position.set(x,y,z);parent.add(m);return m;}
// An open architectural model: two walls, generous windows and warm oak furniture.
box(12,.3,9.2,0xd9dccc,0,-.23,0);box(12,.08,9.2,0xe4e5db,0,-.04,0);
for(let x=-5.5;x<6;x+=1){box(.015,.004,9.1,0xd4d7ca,x,.008,0);}for(let z=-4;z<4.5;z+=1){box(12,.004,.015,0xd4d7ca,0,.008,z);}
box(12,4,.15,0xf3f2e8,0,2,-4.5);box(.15,4,9.2,0xe4e8dc,-6,2,0);
box(12,.13,.11,0xc5cbb9,0,.08,-4.38);box(.11,.13,9,0xc5cbb9,-5.9,.08,0);
for(const z of [-2.6,.4]){box(.07,2.5,2.5,0xc3d7d4,-5.9,2.5,z);for(const zz of [z-1.3,z,z+1.3])box(.12,2.7,.07,0x758d7e,-5.81,2.5,zz);for(const yy of [1.2,2.5,3.8])box(.12,.07,2.65,0x758d7e,-5.8,yy,z);box(.4,.09,2.8,0xf8f8eb,-5.7,1.16,z);}
textPlane('TEAMROOM',3,.75,2.8,3.27,-4.39,90);textPlane('GOOD IDEAS START HERE',2.8,.35,2.8,2.78,-4.38,42);
// Team planning board, including pinned notes.
box(3.1,1.8,.12,0xabb6a0,-2.4,2.3,-4.32);box(2.97,1.67,.06,0xfffef7,-2.4,2.3,-4.22);
textPlane('THIS WEEK',2,.28,-2.4,2.94,-4.17,55);
for(let i=0;i<3;i++){for(let j=0;j<2;j++){const note=box(.48,.4,.025,[0xe9bd7d,0xb5cfb5,0xc9c1df][i],-3.25+i*.8,2.42-j*.55,-4.15);note.rotation.z=(i-j)*.04;box(.25,.018,.01,0xa0a88f,-3.25+i*.8,2.46-j*.55,-4.13);}}
function plant(x,z,s=1,y=0){const p=group(x,y,z);cyl(.24,.18,.43,0xc3aa83,0,.22,0,p);cyl(.21,.21,.03,0x4c4d32,0,.44,0,p);cyl(.025,.035,.7,0x627b4d,0,.78,0,p);for(let i=0;i<7;i++){const angle=i*2.4;const leaf=sphere(.3,i%2?0x66885d:0x83a16b,Math.sin(angle)*.22,.85+(i%3)*.17,Math.cos(angle)*.22,p,[.4,1,.65]);leaf.rotation.z=Math.cos(angle)*.7;leaf.rotation.x=Math.sin(angle)*.7;}p.scale.setScalar(s);}
plant(-5.1,-3.6,1.3);plant(5.1,-3.5,1.5);plant(-5.2,3.3,1.4);
// Bookshelf on the rear wall.
const shelf=group(.25,0,-4.03);for(const y of [.18,.8,1.42,2.04])box(1.6,.08,.62,0xb6a184,0,y,0,shelf);for(const x of [-.78,.78])box(.08,1.92,.62,0xb6a184,x,1.1,0,shelf);for(let j=0;j<3;j++)for(let i=0;i<7;i++){const book=box(.12,.39+(i%3)*.05,.38,[0x7b917c,0xe1d5bd,0xb38a69,0x8599a3][i%4],-.61+i*.19,.43+j*.62,0,shelf);book.rotation.z=i===4?.1:0;}plant(.25,-4.02,.55,2.09);
function desk(x,z,color,rot=0){const p=group(x,0,z,rot);box(2.65,.025,2.15,color,0,.025,.27,p);box(2.3,.14,1.08,0xc7a77e,0,1.12,0,p);for(const xx of [-.97,.97])for(const zz of [-.38,.38])box(.07,1.05,.07,0x586657,xx,.55,zz,p);box(.6,.7,.68,0xe6e5d8,.75,.69,-.06,p);for(const yy of [.55,.82])box(.24,.025,.02,0x9ea490,.75,yy,.29,p);box(.87,.58,.07,0x43534a,-.2,1.62,-.29,p);box(.77,.47,.025,0xd6e4d9,-.2,1.63,-.24,p);box(.06,.25,.06,0x59665d,-.2,1.28,-.29,p);box(.35,.03,.22,0x59665d,-.2,1.21,-.29,p);
for(let i=0;i<4;i++)box(.42-i*.06,.025,.02,[0x96b5a0,0xa8b6c8,0x94aa92,0xa8b6c8][i],-.3,1.76-i*.08,-.22,p);
box(.65,.035,.23,0x59665d,-.2,1.23,.2,p);for(let j=0;j<3;j++)for(let i=0;i<8;i++)box(.045,.007,.027,0xb8c4b6,-.46+i*.073,1.252,.13+j*.065,p);sphere(.07,0xe0e6dc,.34,1.23,.2,p,[.7,.4,1.2]);cyl(.09,.08,.16,0xf9f5e5,.83,1.28,.15,p);cyl(.075,.075,.008,0x655442,.83,1.366,.15,p);box(.25,.03,.35,0xeee2bd,-.88,1.23,.17,p);
// Small office chair behind the keyboard.
cyl(.3,.3,.08,0x526658,-.1,.59,1.05,p);box(.64,.53,.1,0x62796a,-.1,.83,1.32,p);cyl(.045,.045,.52,0x6b7569,-.1,.3,1.05,p);for(let i=0;i<4;i++){const leg=box(.65,.035,.045,0x6b7569,-.1,.08,1.05,p);leg.rotation.y=i*Math.PI/2;}
return p;}
desk(-3.65,-1.4,0xc7d3b8);desk(-3.4,1.9,0xe1c8a4);desk(.15,.8,0xc8c3d6);
// Circular meeting nook and an open notebook.
const table=group(3.8,0,1.75);cyl(1.12,1.12,.13,0xe5d9bd,0,1.08,0,table);cyl(.13,.25,1.0,0x9a957c,0,.52,0,table);cyl(.5,.55,.06,0xa7a48e,0,.06,0,table);box(.4,.025,.43,0xfdfbed,-.35,1.17,.2,table);box(.18,.025,.3,0x405849,.38,1.17,-.08,table);plant(3.8,1.6,.4,1.18);
for(const [x,z]of [[4.8,2.8],[2.65,2.55],[4.65,.6]]){const c=group(x,0,z);cyl(.31,.31,.1,0xc1b79e,0,.53,0,c);box(.62,.45,.1,0xc1b79e,0,.77,.25,c);for(const xx of [-.2,.2])for(const zz of [-.2,.2])box(.04,.5,.04,0x747e69,xx,.25,zz,c);}
// Coffee sideboard at the front edge.
const coffee=group(2.4,0,4);box(2.1,.12,.65,0xb79a72,0,.94,0,coffee);box(2.1,.1,.65,0xb79a72,0,.24,0,coffee);for(const x of [-1,1])box(.08,.9,.58,0x8e866c,x,.48,0,coffee);box(.46,.45,.36,0x4c5751,-.4,1.22,0,coffee);box(.3,.11,.05,0x9cae9f,-.4,1.31,.2,coffee);cyl(.07,.06,.14,0xf8f5e5,-.4,1.08,.23,coffee);plant(3.05,4,.4,1.0);
const people=[];function person(id,x,z,c,rot,action){const p=group(x,.03,z,rot);sphere(.29,c,0,.76,0,p,[.82,1.25,.68]);sphere(.43,c,0,1.43,0,p,[1,1.03,.92]);for(const xx of [-.15,.15]){const leg=mesh(new THREE.CapsuleGeometry(.1,.31,5,12),c,xx,.27,0,p);sphere(.115,c,xx,.09,.09,p,[1,.7,1.5]);}
for(const xx of [-.14,.14]){sphere(.089,0xfffdf4,xx,1.46,.35,p,[.9,1.2,.6]);sphere(.043,0x273b32,xx,1.46,.4,p,[.8,1.1,.6]);sphere(.013,0xffffff,xx-.01,1.48,.426,p);}
const arms=[];for(const side of [-1,1]){const a=new THREE.Group();a.position.set(side*.24,.99,0);p.add(a);mesh(new THREE.CapsuleGeometry(.085,.28,5,12),c,side*.06,-.13,.03,a);sphere(.1,c,side*.06,-.31,.03,a);a.rotation.x=action==='typing'?-1.1:-.25;a.rotation.z=side*.18;arms.push(a);}
if(action==='tablet'){const tablet=box(.39,.48,.05,0x3b5046,0,.92,.36,p);tablet.rotation.x=-.35;const screen=box(.31,.36,.02,0xc9dfd4,0,.94,.405,p);screen.rotation.x=-.35;arms[0].rotation.x=-.85;arms[1].rotation.x=-.85;}
const halo=mesh(new THREE.TorusGeometry(.44,.023,8,40),0x86af77,0,.025,0,p);halo.rotation.x=Math.PI/2;halo.visible=false;people.push({id,p,arms,halo,action,base:rot,status:'idle'});}
person('researcher',-3.7,-.4,0x67a0bc,Math.PI,'typing');person('marketer',-3.45,2.93,0xe6b54f,Math.PI,'typing');person('producer',.05,1.83,0xa18abd,Math.PI,'typing');person('director',-1.9,-2.25,0xd98051,-.35,'board');person('reviewer',3.3,-1.5,0x759975,.35,'tablet');
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);const aspect=w/h;const span=Math.max(11.8,16/aspect);camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();render(performance.now());}new ResizeObserver(resize).observe(host);
const slots=[people.find(p=>p.id==='director'),...people.filter(p=>p.id!=='director')];
let arrivalVisible=null;
function syncTeam(state){for(const [i,p]of slots.entries()){const a=state?.agents?.[i];const wasVisible=p.p.visible;p.p.visible=!!a&&(!arrivalVisible||arrivalVisible.includes(a.id));if(!wasVisible&&p.p.visible)p.arrivedAt=performance.now();p.status=a?.status||'idle';}render(performance.now());}
window.addEventListener('team-state',e=>syncTeam(e.detail));
window.addEventListener('team-arrival',e=>{arrivalVisible=e.detail.visibleIds;syncTeam(window.teamState);});
for(const p of people)p.p.visible=p.id==='director';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let paused=reduced.matches;const toggle=document.getElementById('motion-toggle');function syncToggle(){toggle.textContent=paused?'▷':'Ⅱ';toggle.setAttribute('aria-pressed',String(paused));toggle.setAttribute('aria-label',paused?'사무실 애니메이션 재생':'사무실 애니메이션 일시 정지');}syncToggle();toggle.onclick=()=>{paused=!paused;syncToggle();render(performance.now());};reduced.addEventListener('change',e=>{paused=e.matches;syncToggle();});
function render(ms){const t=ms/1000;for(const [i,a]of people.entries()){const busy=a.status==='running';const enter=paused?1:Math.min(1,(ms-(a.arrivedAt||0))/550);a.p.scale.setScalar(Math.max(.01,enter));a.halo.visible=busy||a.status==='waiting_approval'||a.status==='error';a.halo.material=mat(busy?0x8caf74:0xd79757);a.p.position.y=.03+(!paused&&busy?Math.sin(t*3+i)*.025:0);a.p.rotation.y=a.base+(!paused&&busy?Math.sin(t*1.4+i)*.07:0);for(const [j,arm]of a.arms.entries()){const base=a.action==='typing'?-1.1:a.action==='tablet'?-.85:-.25;arm.rotation.x=base+(!paused&&busy?Math.sin(t*(a.action==='typing'?9:2)+j*2)*.16:0);}}renderer.render(scene,camera);}
let last=0;renderer.setAnimationLoop(ms=>{if(document.hidden)return;if(ms-last<33)return;last=ms;render(ms);});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();renderer.setAnimationLoop(null);const note=document.createElement('div');note.id='office-loading';note.textContent='3D 연결이 중단됐어요. 새로고침하면 사무실을 다시 열 수 있습니다.';host.append(note);});
if(window.teamState)syncTeam(window.teamState);
resize();
}
