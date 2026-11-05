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
const ENABLE_BRAWL=E.ENABLE_BRAWL!=='0';                        // 乱闘モード（緊急時は ENABLE_BRAWL=0 で無効化できる）
const ORIGINS=(E.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const MAX_ROOMS=num(E.MAX_ROOMS,50,1,500),GRACE_LOBBY=15e3,GRACE_MATCH=30e3,EVO_MS=25e3,MAX_ROUNDS=20,BRAWL_TIME=num(E.BRAWL_TIME,120,30,600),BRAWL_EVO_MS=num(E.BRAWL_EVO_MS,12e3,3e3,60e3);

const rooms=new Map();let NID=0;
const CODE_CH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode=()=>{for(;;){let c='';for(let i=0;i<6;i++)c+=CODE_CH[crypto.randomInt(CODE_CH.length)];if(!rooms.has(c))return c}};
const clean=(s,n)=>String(s==null?'':s).replace(/[\u0000-\u001f\u007f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,n);
const send=(ws,o)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))};

class Room{
 constructor(code){this.code=code;this.players=new Map();this.hostId=null;this.mode='duel';this.state='lobby';this.match=null;this.rounds=3}   // rounds：DUELの総ラウンド数（ホストが設定）
 cap(){return 4}
 active(){return[...this.players.values()].filter(p=>!p.gone)}
 freeSlot(){const used=new Set(this.active().map(p=>p.slot));for(let i=0;i<4;i++)if(!used.has(i))return i;return -1}
 add(name,ws){const p={id:'u'+(++NID),name,ws,token:crypto.randomBytes(12).toString('hex'),slot:this.freeSlot(),ready:false,connected:true,dcAt:0,gone:false,chatT:[]};
  this.players.set(p.id,p);if(!this.hostId)this.hostId=p.id;return p}
 bc(o){const s=JSON.stringify(o);for(const p of this.players.values())if(p.ws&&p.ws.readyState===1)p.ws.send(s)}
 info(){return{t:'room',code:this.code,hostId:this.hostId,mode:this.mode,state:this.state,brawl:ENABLE_BRAWL,rounds:this.rounds,
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
  this.room=room;this.mode=room.mode;this.rounds=room.mode==='duel'?room.rounds:1;this.F=[];this.by=new Map();this.inp=new Map();this.ns={};
  for(const p of ps){const f=new Fighter(true);f.id=p.id;f.name=p.name;f.slot=p.slot;f.tgtId=null;f.left=false;this.F.push(f);this.by.set(p.id,f);
   this.inp.set(p.id,{mx:0,mz:0,g:0,one:{L:null,R:null,dash:null,sw:0,dk:false}})}
  this.score={};for(const f of this.F)this.score[f.id]=0;
  this.round=1;this.ended=false;this.winner=null;this.tie=false;this.offers={};this.picked=new Set();this.deadline=0;this.out=[];this.evoSet=[];this.tmax=this.mode==='brawl'?BRAWL_TIME:CFG.roundTime;this.beginRound()}
 beginRound(){
  const n=this.F.length,pos=n<=2?[[0,2],[0,-2]]:n===3?[[-2,2],[2,2],[0,-2.2]]:[[-2,2],[2,2],[2,-2],[-2,-2]];   // 乱闘は三角／四隅に配置
  this.F.forEach((f,i)=>{const [x,z]=pos[i];f.newPoint(x,z,Math.atan2(x,z));f.tgtId=null;f.autoId=null;f.lastHit=null;if(f.left)f.hp=0;
   const s=this.inp.get(f.id);s.one={L:null,R:null,dash:null,sw:0,dk:false}});
  this.state='ready';this.t=1.8;this.timer=this.tmax;this.winner=null;this.tie=false}
 startMsg(){const picks={};for(const f of this.F)picks[f.id]=f.picks.map(p=>({id:p.id,r:p.r}));
  return{t:'start',mode:this.mode,rounds:this.rounds,fs:this.F.map(f=>({id:f.id,name:f.name,slot:f.slot})),picks,score:this.score}}
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
  const d=o=>Math.hypot(o.p.x-f.p.x,o.p.z-f.p.z);
  if(f.tgtId){const t=al.find(o=>o.id===f.tgtId);if(t)return t;f.tgtId=null}
  const near=al.reduce((a,b)=>d(a)<=d(b)?a:b),cur=f.autoId&&al.find(o=>o.id===f.autoId),pick=(cur&&d(cur)<d(near)+.6)?cur:near;
  f.autoId=pick.id;return pick}
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
   for(const e of ev)if(e.type==='hit'){const t=this.by.get(e.tgt);if(t)t.lastHit=e.att}
   this.timer-=dt;let after=null;if(this.mode==='brawl')after=this.brawlCheck(ev);
   if(ev.length)this.room.bc({t:'ev',ts:Date.now(),e:ev});
   if(this.mode==='brawl'){if(after)after()}else this.checkEnd()}
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
  if(this.round>=this.rounds){const [a,b]=this.F,sa=this.score[a.id],sb=this.score[b.id];if(sa!==sb)return this.finish(sa>sb?a.id:b.id,'points')}   // 同点なら延長ラウンド
  this.openEvolve()}
 /* ----- 進化（抽選・検証・適用はサーバーのみ） ----- */
 openEvolve(list){list=list||this.F;this.state='evolve';this.offers={};this.picked=new Set();this.ns={};this.evoSet=list.map(f=>f.id);
  const ms=this.mode==='brawl'?BRAWL_EVO_MS:EVO_MS;this.deadline=Date.now()+ms;
  for(const f of list){const p=this.room.players.get(f.id);
   if(!p||p.gone||!p.connected){this.auto(f);continue}
   const st=f.stat,sc={off:st.punch/10,def:st.guard/4,dodge:st.dodge/3},m=Math.max(sc.off,sc.def,sc.dodge),fav=m>0?Object.keys(sc).find(k=>sc[k]===m):null;
   this.offers[f.id]=offer(f.picks,fav);send(p.ws,{t:'offers',o:this.offers[f.id],ms})}
  this.checkEvo()}
 apply(f,o){const before=new Set(SYN.filter(s=>f.M.f[s.id]).map(s=>s.id));f.picks.push({id:o.id,r:o.r});f.setPicks();
  const now=SYN.filter(s=>f.M.f[s.id]&&!before.has(s.id)).map(s=>s.n);if(now.length)this.ns[f.id]=now;this.picked.add(f.id)}
 auto(f){const o=offer(f.picks,null);this.apply(f,o[Math.floor(Math.random()*o.length)])}
 pick(pid,i){if(this.state!=='evolve'||this.picked.has(pid)||!this.evoSet.includes(pid))return;const f=this.by.get(pid),o=this.offers[pid]&&this.offers[pid][i|0];if(!f||!o)return;this.apply(f,o);this.checkEvo()}
 checkEvo(){if(this.state==='evolve'&&this.evoSet.every(id=>this.picked.has(id)))this.finishEvo()}
 forceEvo(){for(const id of this.evoSet)if(!this.picked.has(id))this.auto(this.by.get(id));this.finishEvo()}
 finishEvo(){const picks={};for(const f of this.F)picks[f.id]=f.picks.map(p=>({id:p.id,r:p.r}));
  this.room.bc({t:'picks',picks,ns:this.ns});this.ns={};
  if(this.mode==='brawl'){this.state='fight';for(const s of this.inp.values())s.one={L:null,R:null,dash:null,sw:0,dk:false}}   // 乱闘は同じ試合を再開（HP等はそのまま）
  else{this.round++;this.beginRound()}}
 /* ----- 乱闘：脱落の検出・順位・終了 ----- */
 brawlCheck(ev){
  const newly=this.F.filter(f=>f.hp<=0&&!f.out);
  for(const f of newly){f.out=true;this.out.push(f.id);ev.push({type:'ko',id:f.id,by:f.lastHit||null})}
  const al=this.F.filter(f=>f.hp>0),r=f=>f.hp/f.hpMax;
  if(al.length<=1)return()=>this.finishBrawl(al[0]||null,'last');
  if(this.timer<=0){const s=[...al].sort((a,b)=>r(b)-r(a));return()=>this.finishBrawl(Math.abs(r(s[0])-r(s[1]))<.005?null:s[0],'time')}
  if(newly.length)return()=>this.openEvolve(al);   // 生存者だけが進化を選ぶ
  return null}
 finishBrawl(w,reason){const r=f=>f.hp/f.hpMax,alive=this.F.filter(f=>f.hp>0).sort((a,b)=>r(b)-r(a));
  const rank=[...alive.map(f=>f.id),...[...this.out].reverse().filter(id=>!alive.some(a=>a.id===id))];
  if(w){const i=rank.indexOf(w.id);if(i>0){rank.splice(i,1);rank.unshift(w.id)}}
  this.finish(w?w.id:null,reason,{rank})}
 forfeit(pid){const f=this.by.get(pid);if(!f||this.ended)return;f.left=true;f.hp=0;
  if(this.mode==='duel'){const o=this.F.find(x=>x.id!==pid);this.finish(o?o.id:null,'forfeit');return}
  if(!f.out){f.out=true;this.out.push(pid);this.room.bc({t:'ev',ts:Date.now(),e:[{type:'ko',id:pid,by:null}]})}
  const al=this.F.filter(x=>x.hp>0);
  if(al.length<=1)return this.finishBrawl(al[0]||null,'last');
  if(this.state==='evolve'){this.picked.add(pid);this.checkEvo()}}
 finish(w,reason,extra){if(this.ended)return;this.ended=true;this.state='end';const r=this.room;
  r.bc(Object.assign({t:'end',winner:w||null,reason,score:this.score,names:Object.fromEntries(this.F.map(f=>[f.id,f.name]))},extra||{}));
  r.match=null;r.state='lobby';
  for(const [id,p] of [...r.players]){if(p.gone)r.players.delete(id);else p.ready=false}
  if(!r.players.has(r.hostId))r.pickHost();r.bc(r.info())}
 snapMsg(){return{t:'snap',ts:Date.now(),m:{s:this.state,tm:Math.max(0,Math.round(this.timer*10)/10),r:this.round,rt:this.rounds,sc:this.score,w:this.winner,k:this.out.slice()},
  f:this.F.map(f=>{const s=f.snap();s.tg=this.targetOf(f).id;return s})}}
}

/* ============ メッセージ処理 ============ */
const err=(ws,c,m)=>send(ws,{t:'err',c,m});
const joinedMsg=(r,p)=>({t:'joined',id:p.id,token:p.token,code:r.code,cfg:{stateHz:STATE_HZ,simHz:SIM_HZ}});
function attach(ws,r,p){ws.room=r;ws.pid=p.id;send(ws,joinedMsg(r,p));r.sys(p.name+'が参加しました');
 if(r.mode==='duel'&&ENABLE_BRAWL&&r.active().length>2){r.mode='brawl';for(const q of r.players.values())q.ready=false;r.sys('3人以上になったため、BRAWL（乱闘）に切り替えました')}
 r.bc(r.info())}

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
  if(k==='brawl'&&!ENABLE_BRAWL)return err(ws,'nope','BRAWLは現在無効になっています');
  if(k==='duel'&&room.active().length>2)return err(ws,'nope','参加者が3人以上のためDUELにできません');
  room.mode=k;for(const q of room.players.values())q.ready=false;return room.bc(room.info())}
 case'rounds':{if(p.id!==room.hostId||room.state!=='lobby')return;
  const n=typeof m.n==='number'?m.n:(/^\d{1,2}$/.test(String(m.n))?+m.n:NaN);if(!Number.isInteger(n)||n<1||n>MAX_ROUNDS)return err(ws,'nope','ラウンド数は1〜'+MAX_ROUNDS+'の整数で指定してください');
  room.rounds=n;return room.bc(room.info())}
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
