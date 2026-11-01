'use strict';
/* RING FIRST — オンライン対戦サーバー（サーバー権威型）
   ・ダメージ／HP／スタミナ／進化の抽選／勝敗はすべてここで決定します。
   ・クライアントは「入力」と「進化の選択番号」しか送れません。
   ・戦闘ロジックは CPU戦と同じ game-core.js を共有します。 */
const http=require('http'),crypto=require('crypto');
const Core=require('./game-core.js');
const {CFG,PUNCHES,Fighter,offer,combat,separate,SYN,clamp}=Core;

const E=process.env,num=(v,d,a,b)=>{const n=+v;return Number.isFinite(n)&&v!==undefined&&v!==''?Math.min(b,Math.max(a,n)):d};
const PORT=num(E.PORT,8080,1,65535),SIM_HZ=num(E.SIM_HZ,60,20,120),STATE_HZ=num(E.STATE_HZ,20,5,60);
const ENABLE_BRAWL=E.ENABLE_BRAWL==='1';                        // フェーズ2で有効化する4人乱闘のスイッチ
const ORIGINS=(E.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const MAX_ROOMS=num(E.MAX_ROOMS,50,1,500),GRACE_LOBBY=15e3,GRACE_MATCH=30e3,EVO_MS=25e3;

const rooms=new Map();let NID=0;
const CODE_CH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode=()=>{for(;;){let c='';for(let i=0;i<6;i++)c+=CODE_CH[crypto.randomInt(CODE_CH.length)];if(!rooms.has(c))return c}};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,n);
const send=(ws,o)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))};

class Room{
 constructor(code){this.code=code;this.players=new Map();this.hostId=null;this.mode='duel';this.state='lobby';this.match=null}
 cap(){return this.mode==='brawl'?4:2}
 active(){return[...this.players.values()].filter(p=>!p.gone)}
 freeSlot(){const used=new Set(this.active().map(p=>p.slot));for(let i=0;i<4;i++)if(!used.has(i))return i;return -1}
 add(name,ws){const p={id:'u'+(++NID),name,ws,token:crypto.randomBytes(12).toString('hex'),slot:this.freeSlot(),ready:false,connected:true,dcAt:0,gone:false,chatT:[]};
  this.players.set(p.id,p);if(!this.hostId)this.hostId=p.id;return p}
 bc(o){const s=JSON.stringify(o);for(const p of this.players.values())if(p.ws&&p.ws.readyState===1)p.ws.send(s)}
 info(){return{t:'room',code:this.code,hostId:this.hostId,mode:this.mode,state:this.state,brawl:ENABLE_BRAWL,
  players:this.active().map(p=>({id:p.id,name:p.name,slot:p.slot,ready:p.ready||p.id===this.hostId,connected:p.connected,host:p.id===this.hostId}))}}
 sys(text){this.bc({t:'chat',id:'sys',name:'',text,ts:Date.now()})}
 pickHost(){const a=this.active(),c=a.find(p=>p.connected)||a[0];this.hostId=c?c.id:null}
 remove(p,why){
  if(!this.players.has(p.id))return;
  if(this.match){const m=this.match;m.forfeit(p.id);   // 試合中は結果確定まで保持（DUELなら即・不戦勝で終了）
   if(this.match===m){p.gone=true;p.ready=false;p.connected=false}else this.players.delete(p.id)}
  else this.players.delete(p.id);
  if(p.ws){p.ws.room=null;p.ws.pid=null;p.ws=null}
  this.sys(`${p.name}が${why==='timeout'?'切断されました':'退出しました'}`);
  if(this.hostId===p.id)this.pickHost();
  this.bc(this.info())}
 startMatch(){this.state='playing';this.match=new Match(this,this.active());this.bc(this.match.startMsg())}
}

class Match{
 constructor(room,ps){
  this.room=room;this.mode=room.mode;this.F=[];this.by=new Map();this.inp=new Map();this.ns={};
  for(const p of ps){const f=new Fighter(true);f.id=p.id;f.name=p.name;f.slot=p.slot;f.tgtId=null;f.left=false;this.F.push(f);this.by.set(p.id,f);
   this.inp.set(p.id,{mx:0,mz:0,g:0,one:{L:null,R:null,dash:null,sw:0,dk:false}})}
  this.score={};for(const f of this.F)this.score[f.id]=0;
  this.round=1;this.ended=false;this.winner=null;this.tie=false;this.offers={};this.picked=new Set();this.deadline=0;this.beginRound()}
 beginRound(){
  const n=this.F.length,pos=n<=2?[[0,2],[0,-2]]:[[-2,2],[2,2],[2,-2],[-2,-2]];   // 乱闘では四隅に配置
  this.F.forEach((f,i)=>{const [x,z]=pos[i];f.newPoint(x,z,Math.atan2(x,z));f.tgtId=null;if(f.left)f.hp=0;
   const s=this.inp.get(f.id);s.one={L:null,R:null,dash:null,sw:0,dk:false}});
  this.state='ready';this.t=1.8;this.timer=CFG.roundTime;this.winner=null;this.tie=false}
 startMsg(){const picks={};for(const f of this.F)picks[f.id]=f.picks.map(p=>({id:p.id,r:p.r}));
  return{t:'start',mode:this.mode,fs:this.F.map(f=>({id:f.id,name:f.name,slot:f.slot})),picks,score:this.score}}
 resync(p){send(p.ws,this.startMsg());if(this.state==='evolve'&&this.offers[p.id]&&!this.picked.has(p.id))send(p.ws,{t:'offers',o:this.offers[p.id],ms:Math.max(0,this.deadline-Date.now())})}
 /* ----- 入力（検証してから保持。ダメージ等は一切受け取らない） ----- */
 input(pid,m){const s=this.inp.get(pid);if(!s)return;const nn=v=>Number.isFinite(v)?clamp(v,-1,1):0;
  s.mx=nn(m.mx);s.mz=nn(m.mz);s.g=(m.g===1||m.g===2)?m.g:0;const o=s.one;
  if(Array.isArray(m.p)){const L=typeof m.p[0]==='string'&&PUNCHES[m.p[0]],R=typeof m.p[1]==='string'&&PUNCHES[m.p[1]];
   if(L&&L.hand==='L')o.L=L.id;if(R&&R.hand==='R')o.R=R.id}
  if(Array.isArray(m.d)){const x=Math.sign(+m.d[0]||0),z=Math.sign(+m.d[1]||0);if(x||z)o.dash={x,z}}
  if(m.sw===-1||m.sw===1)o.sw=m.sw;if(m.dk)o.dk=true}
 enemies(f){return this.F.filter(o=>o!==f&&o.hp>0)}
 targetOf(f){const al=this.enemies(f);if(!al.length)return this.F.find(o=>o!==f)||f;
  if(f.tgtId){const t=al.find(o=>o.id===f.tgtId);if(t)return t}
  return al.reduce((a,b)=>Math.hypot(a.p.x-f.p.x,a.p.z-f.p.z)<=Math.hypot(b.p.x-f.p.x,b.p.z-f.p.z)?a:b)}
 cycle(pid){const f=this.by.get(pid);if(!f||f.hp<=0)return;const al=this.enemies(f).sort((a,b)=>Math.hypot(a.p.x-f.p.x,a.p.z-f.p.z)-Math.hypot(b.p.x-f.p.x,b.p.z-f.p.z));
  if(al.length<2)return;const cur=this.targetOf(f),i=al.indexOf(cur);f.tgtId=al[(i+1)%al.length].id}
 intent(f,tgt,fight){
  const p=this.room.players.get(f.id),s=this.inp.get(f.id),face=Math.atan2(-(tgt.p.x-f.p.x),-(tgt.p.z-f.p.z));
  if(!fight||!p||p.gone||!p.connected||f.hp<=0)return{mx:0,mz:0,punch:{},guard:0,sway:0,duck:false,face};
  const o=s.one,I={mx:s.mx,mz:s.mz,guard:s.g,punch:{L:o.L,R:o.R},dash:o.dash,sway:o.sw,duck:o.dk,face};
  o.L=o.R=null;o.dash=null;o.sw=0;o.dk=false;return I}
 /* ----- 1ステップ ----- */
 step(dt){
  if(this.ended)return;const fight=this.state==='fight';
  if(this.state==='evolve'){if(Date.now()>this.deadline)this.forceEvo();return}
  for(const f of this.F){const tgt=this.targetOf(f);f.upd(dt,this.intent(f,tgt,fight),tgt)}
  separate(this.F);
  if(fight){const ev=[];for(const a of this.F)combat(a,this.F,dt,ev);
   if(ev.length)this.room.bc({t:'ev',ts:Date.now(),e:ev});
   this.timer-=dt;this.checkEnd()}
  else{this.t-=dt;if(this.t<=0){if(this.state==='ready')this.state='fight';else if(this.state==='pointEnd')this.afterPoint()}}}
 checkEnd(){const al=this.F.filter(f=>f.hp>0);
  if(this.mode==='duel'){
   if(al.length===1)return this.endPoint(al[0].id);if(al.length===0)return this.endPoint('tie');
   if(this.timer<=0){const [a,b]=this.F,ra=a.hp/a.hpMax,rb=b.hp/b.hpMax;return this.endPoint(Math.abs(ra-rb)<.005?'tie':ra>rb?a.id:b.id)}}
  else{if(al.length<=1)return this.endPoint(al[0]?al[0].id:'tie');
   if(this.timer<=0)return this.endPoint(al.reduce((x,y)=>x.hp>=y.hp?x:y).id)}}
 endPoint(w){if(this.state!=='fight')return;this.state='pointEnd';this.t=1.9;this.tie=w==='tie';this.winner=this.tie?null:w;if(!this.tie)this.score[w]++}
 afterPoint(){
  if(this.mode==='brawl')return this.finish(this.winner,'last');
  if(this.tie)return this.beginRound();
  const top=this.F.find(f=>this.score[f.id]>=CFG.pointsToWin);if(top)return this.finish(top.id,'points');
  this.openEvolve()}
 /* ----- 進化（抽選・検証・適用はサーバーのみ） ----- */
 openEvolve(){this.state='evolve';this.offers={};this.picked=new Set();this.ns={};this.deadline=Date.now()+EVO_MS;
  for(const f of this.F){const p=this.room.players.get(f.id);
   if(!p||p.gone||!p.connected){this.auto(f);continue}
   const st=f.stat,sc={off:st.punch/10,def:st.guard/4,dodge:st.dodge/3},m=Math.max(sc.off,sc.def,sc.dodge),fav=m>0?Object.keys(sc).find(k=>sc[k]===m):null;
   this.offers[f.id]=offer(f.picks,fav);send(p.ws,{t:'offers',o:this.offers[f.id],ms:EVO_MS})}
  this.checkEvo()}
 apply(f,o){const before=new Set(SYN.filter(s=>f.M.f[s.id]).map(s=>s.id));f.picks.push({id:o.id,r:o.r});f.setPicks();
  const now=SYN.filter(s=>f.M.f[s.id]&&!before.has(s.id)).map(s=>s.n);if(now.length)this.ns[f.id]=now;this.picked.add(f.id)}
 auto(f){const o=offer(f.picks,null);this.apply(f,o[Math.floor(Math.random()*o.length)])}
 pick(pid,i){if(this.state!=='evolve'||this.picked.has(pid))return;const f=this.by.get(pid),o=this.offers[pid]&&this.offers[pid][i|0];if(!f||!o)return;this.apply(f,o);this.checkEvo()}
 checkEvo(){if(this.F.every(f=>this.picked.has(f.id)))this.finishEvo()}
 forceEvo(){for(const f of this.F)if(!this.picked.has(f.id))this.auto(f);this.finishEvo()}
 finishEvo(){const picks={};for(const f of this.F)picks[f.id]=f.picks.map(p=>({id:p.id,r:p.r}));
  this.room.bc({t:'picks',picks,ns:this.ns});this.ns={};this.round++;this.beginRound()}
 forfeit(pid){const f=this.by.get(pid);if(!f||this.ended)return;f.left=true;f.hp=0;
  if(this.mode==='duel'){const o=this.F.find(x=>x.id!==pid);this.finish(o?o.id:null,'forfeit')}}
 finish(w,reason){if(this.ended)return;this.ended=true;this.state='end';const r=this.room;
  r.bc({t:'end',winner:w||null,reason,score:this.score,names:Object.fromEntries(this.F.map(f=>[f.id,f.name]))});
  r.match=null;r.state='lobby';
  for(const [id,p] of [...r.players]){if(p.gone)r.players.delete(id);else p.ready=false}
  if(!r.players.has(r.hostId))r.pickHost();r.bc(r.info())}
 snapMsg(){return{t:'snap',ts:Date.now(),m:{s:this.state,tm:Math.max(0,Math.round(this.timer*10)/10),r:this.round,sc:this.score,w:this.winner},
  f:this.F.map(f=>{const s=f.snap();s.tg=this.targetOf(f).id;return s})}}
}

/* ============ メッセージ処理 ============ */
const err=(ws,c,m)=>send(ws,{t:'err',c,m});
const joinedMsg=(r,p)=>({t:'joined',id:p.id,token:p.token,code:r.code,cfg:{stateHz:STATE_HZ,simHz:SIM_HZ}});
function attach(ws,r,p){ws.room=r;ws.pid=p.id;send(ws,joinedMsg(r,p));r.sys(p.name+'が参加しました');r.bc(r.info())}

function onMsg(ws,m){
 const room=ws.room,p=room&&room.players.get(ws.pid);
 switch(m.t){
 case'ping':return send(ws,{t:'pong',ts:m.ts});
 case'create':{
  if(room)return err(ws,'busy','すでにルームに参加しています');
  if(rooms.size>=MAX_ROOMS)return err(ws,'busy','サーバーが混み合っています。しばらくしてからお試しください');
  const r=new Room(genCode());rooms.set(r.code,r);return attach(ws,r,r.add(clean(m.name,12)||'PLAYER',ws))}
 case'join':{
  if(room)return err(ws,'busy','すでにルームに参加しています');
  const r=rooms.get(clean(m.code,6).toUpperCase());
  if(!r)return err(ws,'no_room','ルームが見つかりません。コードを確認してください');
  if(r.state!=='lobby')return err(ws,'in_match','試合中のルームには参加できません');
  if(r.active().length>=r.cap())return err(ws,'full','ルームが満員です');
  return attach(ws,r,r.add(clean(m.name,12)||'PLAYER',ws))}
 case'rejoin':{
  const r=rooms.get(clean(m.code,6).toUpperCase()),q=r&&typeof m.token==='string'&&r.active().find(x=>x.token===m.token);
  if(!q)return err(ws,'no_session','ルームに復帰できませんでした');
  if(q.ws&&q.ws!==ws){const old=q.ws;old.room=null;old.pid=null;try{old.close()}catch(e){}}   // 二重参加は後から来た接続を優先
  q.ws=ws;q.connected=true;q.dcAt=0;ws.room=r;ws.pid=q.id;send(ws,joinedMsg(r,q));r.sys(q.name+'が復帰しました');r.bc(r.info());
  if(r.match)r.match.resync(q);return}
 }
 if(!p)return;
 switch(m.t){
 case'ready':if(room.state!=='lobby')return;p.ready=!!m.v;return room.bc(room.info());
 case'mode':{if(p.id!==room.hostId||room.state!=='lobby')return;
  const k=m.mode;if(k!=='duel'&&k!=='brawl')return;
  if(k==='brawl'&&!ENABLE_BRAWL)return err(ws,'nope','BRAWLはフェーズ2で対応予定です');
  if(k==='duel'&&room.active().length>2)return err(ws,'nope','参加者が3人以上のためDUELにできません');
  room.mode=k;for(const q of room.players.values())q.ready=false;return room.bc(room.info())}
 case'start':{if(p.id!==room.hostId||room.state!=='lobby')return;
  const a=room.active(),okN=room.mode==='duel'?a.length===2:(a.length>=2&&a.length<=4);
  if(!okN)return err(ws,'nope',room.mode==='duel'?'DUELは2人で開始できます':'2〜4人で開始できます');
  if(!a.every(q=>q.connected))return err(ws,'nope','接続が切れているプレイヤーがいます');
  if(!a.every(q=>q.id===room.hostId||q.ready))return err(ws,'nope','全員の準備が完了していません');
  return room.startMatch()}
 case'leave':{const r=room;r.remove(p,'leave');return}
 case'in':if(room.match)room.match.input(p.id,m);return;
 case'pick':if(room.match)room.match.pick(p.id,m.i);return;
 case'tgt':if(room.match)room.match.cycle(p.id);return;
 case'chat':{
  const now=Date.now();p.chatT=p.chatT.filter(t=>now-t<3000);
  if(p.chatT.length>=3)return err(ws,'rate','送信が速すぎます。少し待ってください');
  const text=clean(m.text,80);if(!text)return;p.chatT.push(now);
  return room.bc({t:'chat',id:p.id,name:p.name,slot:p.slot,text,ts:now})}
 }
}
function onClose(ws){
 const r=ws.room;if(!r)return;const p=r.players.get(ws.pid);if(!p||p.ws!==ws)return;
 p.connected=false;p.ws=null;p.dcAt=Date.now();r.bc(r.info())}
function handleConnection(ws){
 ws.isAlive=true;ws.room=null;ws.pid=null;ws.cnt=0;ws.cntT=Date.now();
 ws.on('pong',()=>{ws.isAlive=true});
 ws.on('message',d=>{const n=Date.now();if(n-ws.cntT>1000){ws.cnt=0;ws.cntT=n}if(++ws.cnt>150)return;   // 連続送信の制限
  const s=d.toString();if(s.length>1500)return;let m;try{m=JSON.parse(s)}catch(e){return}
  if(!m||typeof m!=='object'||typeof m.t!=='string')return;try{onMsg(ws,m)}catch(e){console.error('onMsg',e)}});
 ws.on('close',()=>onClose(ws));ws.on('error',()=>{})}

/* ============ 定期処理 ============ */
function tickAll(dt){for(const r of rooms.values()){if(!r.match)continue;
 try{r.match.step(dt)}catch(e){console.error('match error',e);try{r.match.finish(null,'error')}catch(x){r.match=null;r.state='lobby'}}}}
function snapAll(){for(const r of rooms.values()){const m=r.match;if(m&&!m.ended)r.bc(m.snapMsg())}}
function janitor(){const now=Date.now();
 for(const [code,r] of [...rooms]){
  for(const p of r.active()){if(!p.connected&&p.dcAt&&now-p.dcAt>(r.match?GRACE_MATCH:GRACE_LOBBY))r.remove(p,'timeout')}
  if(r.players.size===0||r.active().length===0)rooms.delete(code)}}

function start(){
 const {WebSocketServer}=require('ws');
 const server=http.createServer((req,res)=>{
  if(req.url&&req.url.startsWith('/health')){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*','cache-control':'no-store'});
   return res.end(JSON.stringify({ok:true,rooms:rooms.size,simHz:SIM_HZ,stateHz:STATE_HZ}))}
  res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});res.end('RING FIRST server is running')});
 const wss=new WebSocketServer({server,maxPayload:4096,verifyClient:i=>!ORIGINS.length||ORIGINS.includes(i.origin)});
 wss.on('connection',handleConnection);
 let last=Date.now(),acc=0;const dt=1/SIM_HZ;
 setInterval(()=>{const n=Date.now();acc+=Math.min((n-last)/1000,.25);last=n;let k=0;while(acc>=dt&&k++<10){tickAll(dt);acc-=dt}},Math.max(4,Math.floor(500/SIM_HZ)));
 setInterval(snapAll,Math.round(1000/STATE_HZ));setInterval(janitor,1000);
 setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue}ws.isAlive=false;try{ws.ping()}catch(e){}}},15000);
 server.listen(PORT,()=>console.log(`RING FIRST server on :${PORT}  sim=${SIM_HZ}Hz state=${STATE_HZ}Hz brawl=${ENABLE_BRAWL} origins=${ORIGINS.join(',')||'(any)'}`))}

module.exports={handleConnection,tickAll,snapAll,janitor,rooms,Match,Room};
if(require.main===module)start();
