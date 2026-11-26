/* RING FIRST — game-core.js
   戦闘ロジック・進化能力・CPU AI の共有モジュール。ブラウザ（index.html）とNode.js（server.js）の両方で動きます。
   描画・DOM・通信には一切依存しません。 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RFCore=factory()})(typeof self!=='undefined'?self:this,function(){
"use strict";
class V{constructor(x,y,z){this.x=x||0;this.y=y||0;this.z=z||0}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this}copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this}clone(){return new V(this.x,this.y,this.z)}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this}sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
 multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this}addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this}
 dot(v){return this.x*v.x+this.y*v.y+this.z*v.z}length(){return Math.hypot(this.x,this.y,this.z)}
 normalize(){const l=this.length()||1;return this.multiplyScalar(1/l)}
 lerp(v,a){this.x+=(v.x-this.x)*a;this.y+=(v.y-this.y)*a;this.z+=(v.z-this.z)*a;return this}
 setX(x){this.x=x;return this}distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z)}}
/* ============ 設定（調整はここ） ============ */
const CFG={doubleTapMs:250,faceRate:8,
 move:{speed:3.4,accel:14},dash:{dist:1.7,time:.16,cd:.55,cost:14},
 sway:{dist:.4,dur:.34,cd:.55,cost:8,rec:.1},duck:{drop:.38,dur:.5,cd:.7,cost:8},
 stam:{max:100,regen:20,delay:.7,low:25},
 dmg:{min:1,max:40,speedRef:7,speedMin:.5,speedMax:1.6,rangeStart:.85,rangeFalloff:.35,
  zone:{head:1.5,chest:1.0,abdomen:1.2,armL:.4,armR:.4},guard:{stam:.5}},
 hitstun:.2,pointsToWin:3,roundTime:60,hp:100,fistR:.1,ringHalf:3.3,minSep:.75,bob:.012,
 roles:{lead:{ts:1.06,reach:1.04,dmg:.94,cost:.94,whiff:.94},rear:{ts:.95,reach:1,dmg:1.08,cost:1.06,whiff:1.06}},   // 前手：速い・届く・軽い／後手：遅い・重い。構え(オーソドックス/サウスポー)で左右が入れ替わる
 rules:{on:true,                                               // ★false にすると、読み合い改善前の挙動に戻る
  chain:{window:.9,costStep:.18,max:5,lockFrom:3,lockStep:.045}, // 連打：直前から0.9秒以内に打つとスタミナ+18%/回(最大5段)、3連打目以降は攻撃後の隙が増える
  whiffCost:.4,                                                // 空振り：スタミナ消費の40%を追加で失う（＋パンチごとの硬直）
  stale:{n:3,step:.08,min:.76},                                // 同じパンチの連続：3回目以降は威力-8%ずつ（最低-24%）
  range:{below:.55},                                           // 近すぎる（最小射程未満）と威力×0.55。詳細は X 表
  blockLock:.2,guardBreakStun:.35,guardDrain:2.5,              // ガード：防がれた側の隙/ガードブレイク/ガード維持のスタミナ消費(毎秒)
  gc:{t:.7,speed:.2,pow:.15},                                  // ガード成功後0.7秒の反撃チャンス（速度+20%・威力+15%）
  armMul:.4,                                                   // 腕に当たった時の倍率。ガード成功時も同じ倍率を使い、さらにガード軽減が掛かる（ガードの方が必ず有利）
  chipMin:.3}};                                                  // ガードされた時の最小ダメージ（パンチごとのガード圧力を掛ける）
const STEP=1/120,ZERO=new V();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rnd=(a,b)=>a+Math.random()*(b-a);
const angd=(a,b)=>{let d=a-b;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d};
const quad=(a,b,c,t)=>a.clone().multiplyScalar((1-t)*(1-t)).addScaledVector(b,2*(1-t)*t).addScaledVector(c,t*t);

/* ============ パンチ定義（基本威力,[構え,突き,保持,戻し],W,C,A,スタミナ消費） ============ */
const T={   // [基本威力,[予備動作,突き,保持,戻し 秒],W,C,A,スタミナ]。右手基準の座標（左手はxを反転）。前手/後手の補正は CFG.roles で別に掛かる
 JAB:[6,[.04,.12,.02,.14],[.26,1.34,.4],[.15,1.45,.75],[.03,1.55,1.05],6],                  // 左ジャブ：素早い・軽い・リーチ長め・消費小
 STRAIGHT:[13,[.08,.17,.02,.2],[.3,1.3,.3],[.15,1.45,.75],[-.02,1.52,1.15],10],              // 右ストレート：高威力・リーチ長・消費中（主力）
 UPPERL:[8.5,[.12,.15,.02,.22],[.25,.9,.4],[.15,1.0,.75],[-.02,1.5,.85],9],                  // 左アッパー：近距離・比較的素早い・威力中
 UPPERR:[12,[.22,.2,.02,.34],[.25,.9,.4],[.15,1.0,.75],[-.02,1.5,.85],18],                   // 右アッパー：近距離・高威力・予備動作と隙と消費が大きい
 HOOKL:[8.5,[.1,.18,.02,.2],[.5,1.42,.35],[.9,1.5,.7],[-.12,1.55,.95],9],                    // 左フック：横から・ガードへの圧力・中距離
 HOOKR:[14,[.14,.22,.02,.26],[.5,1.42,.35],[.95,1.5,.65],[-.12,1.55,.9],15]};                // 右フック：高威力・消費と隙が大きい（大きなチャンス用）
// 役割表：rng=[最小射程,最適射程,最大射程](選手間の距離。最大射程は突きの到達距離＋当たり判定と一致) / whiff=空振り硬直 / hitLock=命中後の隙 / pierce=ガード貫通 / gp=ガード圧力(ガードされた時のスタミナ消耗・最小ダメージ倍率)
const X={JAB:{rng:[.85,1.15,1.4],baseMul:1,costMul:1,whiff:.09,hitLock:.04,pierce:0,gp:1},
 STRAIGHT:{rng:[.95,1.3,1.5],baseMul:1,costMul:1,whiff:.22,hitLock:.06,pierce:0,gp:1},
 UPPERL:{rng:[.7,.88,1.12],baseMul:1,costMul:1,whiff:.26,hitLock:.14,pierce:.3,gp:1},
 UPPERR:{rng:[.7,.88,1.12],baseMul:1,costMul:1,whiff:.45,hitLock:.3,pierce:.45,gp:1},
 HOOKL:{rng:[.85,1.05,1.3],baseMul:1,costMul:1,whiff:.18,hitLock:.06,pierce:0,gp:1.7},
 HOOKR:{rng:[.8,1.0,1.25],baseMul:1,costMul:1,whiff:.38,hitLock:.2,pierce:0,gp:1.3}};
const PUNCHES={};
(function(){const mk=(id,name,hand,k)=>{const [base,t,W,C,A,cost]=T[k],m=hand==='L'?-1:1,f=p=>new V(p[0]*m,p[1],p[2]);
 PUNCHES[id]={id,name,hand,base,cost,t,dur:t[0]+t[1]+t[2]+t[3],W:f(W),C:f(C),A:f(A),reach:Math.hypot(A[0],A[2]),x:X[k]}};
 mk('L_JAB','左ジャブ','L','JAB');mk('R_STRAIGHT','右ストレート','R','STRAIGHT');mk('L_UPPER','左アッパー','L','UPPERL');
 mk('R_UPPER','右アッパー','R','UPPERR');mk('L_HOOK','左フック','L','HOOKL');mk('R_HOOK','右フック','R','HOOKR')})();
const PUNCH_KEYS={j:'L_JAB',k:'R_STRAIGHT',u:'L_UPPER',i:'R_UPPER',n:'L_HOOK',m:'R_HOOK'};   // キー→パンチ。移動キー(WASD)とは完全に独立


/* ============ 進化能力（データ駆動） ============ */
const RN=['Common','Rare','Epic','Legendary'],RC=['#9aa4bd','#4a8fe8','#b266e8','#e8b04a'];
const AB=[
{id:'spd',n:'パンチ速度',tag:'off',k:'ps',v:[.06,.1,.15,.22],l:'パンチ速度',p:['cm',[0,0,.12,.25],'スタミナ消費 +#%']},
{id:'pow',n:'パンチ威力',tag:'off',k:'pw',v:[.08,.14,.2,.3],l:'パンチ威力',p:['rc',[0,0,-.1,-.2],'攻撃後の硬直 +#%']},
{id:'stm',n:'スタミナ最大値',tag:'util',k:'sm',v:[12,20,30,45],l:'スタミナ最大値'},
{id:'reg',n:'スタミナ回復',tag:'util',k:'sr',v:[.15,.25,.4,.6],l:'スタミナ回復速度'},
{id:'mov',n:'移動速度',tag:'util',k:'mv',v:[.06,.1,.15,.22],l:'移動速度'},
{id:'dsh',n:'ダッシュ性能',tag:'dodge',k:'ds',v:[.08,.14,.2,.3],l:'ダッシュ距離'},
{id:'grd',n:'ガード性能',tag:'def',k:'gd',v:[.08,.14,.2,.3],l:'ガード時の被ダメ軽減',p:['gp',[0,0,.1,.2],'ガード中の移動速度 -#%']},
{id:'dod',n:'回避性能',tag:'dodge',k:'dg',v:[.08,.14,.22,.32],l:'スウェー距離'},
{id:'rcv',n:'硬直短縮',tag:'util',k:'rc',v:[.1,.18,.26,.38],l:'攻撃後の硬直短縮'},
{id:'combo',n:'連撃加速',tag:'off',r:1,f:'combo',d:'連続ヒットごとにパンチ速度+5%（最大5段）。外す・被弾で解除。'},
{id:'counter',n:'カウンターセンス',tag:'dodge',r:1,f:'counter',d:'スウェー／ダッキングで攻撃を避けると、1.5秒間次のパンチ威力+40%。'},
{id:'revenge',n:'ガードリベンジ',tag:'def',r:1,f:'revenge',d:'ガード成功後0.8秒間、パンチ速度+25%・威力+20%。'},
{id:'ambush',n:'ダックブロー',tag:'dodge',r:2,f:'ambush',d:'ダッキング後、次のパンチ威力+40%。',pen:'ダッキングのスタミナ消費 +4'},
{id:'breaker',n:'プレシジョンブレイカー',tag:'off',r:2,f:'breaker',d:'突きの伸び切り前（ベストタイミング）で当てると威力+45%。',pen:'空振り時の硬直 +0.15秒'},
{id:'desp',n:'背水の陣',tag:'off',r:2,f:'desp',d:'スタミナ30未満でパンチ速度+25%・威力+20%。',pen:'スタミナ回復 -20%'},
{id:'berserk',n:'バーサーカー',tag:'off',r:3,f:'berserk',d:'HP40%未満でパンチ速度+35%・威力+35%。',pen:'被ダメージ +20%'},
{id:'phantom',n:'ファントム',tag:'dodge',r:3,f:'phantom',d:'スウェー・ダッシュ・ダッキングのスタミナ消費が0。スウェー距離+35%。',pen:'最大HP -20',m:{dg:.35,hp:-20}}];
const ABM={};AB.forEach(a=>ABM[a.id]=a);
const SYN=[
{id:'rhythm',n:'リズムマスター',need:['combo','spd'],d:'連撃加速が最大8段・1段ごと+8%に強化。'},
{id:'ghost',n:'ゴーストステップ',need:['counter','dod'],d:'カウンターの威力ボーナスが+40%→+80%。'},
{id:'bulwark',n:'鉄壁の返し',need:['revenge','grd'],d:'ガード成功でスタミナ15回復、反撃時間が1.6秒に延長。'},
{id:'crusher',n:'クラッシャー',need:['breaker','pow'],d:'ベストタイミングの威力ボーナスが+45%→+75%。'}];
const pc=v=>Math.round(v*100);
function calc(picks){const m={ps:0,pw:0,sm:0,sr:0,mv:0,ds:0,gd:0,dg:0,rc:0,cm:0,gp:0,hp:0,f:{}},own=new Set();
 for(const p of picks){const a=ABM[p.id];own.add(p.id);
  if(a.v){m[a.k]+=a.v[p.r];if(a.p)m[a.p[0]]+=a.p[1][p.r]}else{m.f[a.f]=1;if(a.m)for(const k in a.m)m[k]+=a.m[k]}}
 m.rc=Math.min(m.rc,.6);for(const s of SYN)if(s.need.every(i=>own.has(i)))m.f[s.id]=1;return m}
function rollR(){const x=Math.random()*100;return x<55?0:x<83?1:x<96?2:3}
function offer(own,fav){
 const cnt={};own.forEach(p=>cnt[p.id]=(cnt[p.id]||0)+1);const ids=new Set(own.map(p=>p.id));
 const pool=AB.filter(a=>(cnt[a.id]||0)<(a.v?4:1)),used=new Set();
 const pick=f=>{let c=pool.filter(a=>!used.has(a.id)&&f(a));if(!c.length)c=pool.filter(a=>!used.has(a.id));const a=c[Math.floor(Math.random()*c.length)];used.add(a.id);return a};
 const partner=a=>SYN.some(s=>s.need.includes(a.id)&&s.need.some(i=>i!==a.id&&ids.has(i)));
 fav=fav||['off','def','dodge'][Math.floor(Math.random()*3)];
 const A=[pick(a=>a.tag===fav),pick(partner),pick(a=>a.tag!==fav&&!partner(a))].filter(Boolean);
 const out=A.map(a=>({id:a.id,r:a.v?rollR():a.r}));
 if(out.every(o=>o.r===0)){const b=out.find(o=>ABM[o.id].v);if(b)b.r=1}
 return out.sort(()=>Math.random()-.5)}

/* ============ 幾何 ============ */
function segDist(p1,q1,p2,q2){
 const d1=q1.clone().sub(p1),d2=q2.clone().sub(p2),r=p1.clone().sub(p2),a=d1.dot(d1),e=d2.dot(d2),f=d2.dot(r);let s,t;
 if(a<1e-9&&e<1e-9)return p1.distanceTo(p2);
 if(a<1e-9){s=0;t=clamp(f/e,0,1)}
 else{const c=d1.dot(r);
  if(e<1e-9){t=0;s=clamp(-c/a,0,1)}
  else{const b=d1.dot(d2),den=a*e-b*b;s=den>1e-9?clamp((b*f-c*e)/den,0,1):0;t=(b*s+f)/e;
   if(t<0){t=0;s=clamp(-c/a,0,1)}else if(t>1){t=1;s=clamp((b-c)/a,0,1)}}}
 return p1.clone().addScaledVector(d1,s).distanceTo(p2.clone().addScaledVector(d2,t))}

/* ============ 戦闘ロジック（描画非依存） ============ */
let PID=0;
const IDLE={mx:0,mz:0,punch:{},guard:0,sway:0,duck:false};
class Fighter{
 constructor(isP){this.isP=isP;this.picks=[];this.M=calc([]);this.bonus=null;this.stance='orth';this.infStam=false;this.off=new V();this.newPoint(0,0,0)}
 newMatch(){this.picks=[];this.M=calc([]);this.infStam=false;this.applyBonus()}   // 無限スタミナ(サンドバッグ用)は新しい試合で必ず解除
 setPicks(){this.M=calc(this.picks);this.applyBonus()}
 applyBonus(){const b=this.bonus;if(b)for(const k in b)this.M[k]=(this.M[k]||0)+b[k]}   // CPU難易度「激ムズ」の基礎能力補正
 stMax(){return CFG.stam.max+this.M.sm}
 newPoint(x,z,yaw){this.p=new V(x,0,z);this.v=new V();this.kick=new V();this.yaw=yaw;this.hpMax=CFG.hp+this.M.hp;this.hp=this.hpMax;
  this.st=this.stMax();this.stDelay=0;this.exh=false;this.dash={t:0,cd:0,dir:new V()};this.gb=0;this.gh=0;this.shake=0;this.koT=0;
  this.q={L:null,R:null};this.lock=0;this.stun=0;this.swCd=0;this.dkCd=0;this.sw=null;this.dk=null;this.counterT=0;this.ambT=0;this.revT=0;
  this.combo=0;this.comboT=0;this.chain=0;this.chainT=0;this.hist=[];this.gcT=0;this.tNow=0;this.off.set(0,0,0);this.stat={punch:0,guard:0,dodge:0};
  const H=()=>({act:false,def:null,t:0,hit:false,dg:{},prev:new V(),speed:0,sp0:false,first:false,id:0,aim:0,ph:'',live:false,u:0,ext:0,stale:0,lead:true,tsc:1,rch:1,dmgMul:1,whMul:1,local:new V()});
  this.h={L:H(),R:H()};for(const k of['L','R'])this.h[k].local=this.handLocal(k)}
 fwd(){return new V(-Math.sin(this.yaw),0,-Math.cos(this.yaw))}
 right(){return new V(Math.cos(this.yaw),0,-Math.sin(this.yaw))}
 toWorld(l,no){const o=no?ZERO:this.off,f=this.fwd(),r=this.right(),x=l.x+o.x;return new V(this.p.x+r.x*x+f.x*l.z,l.y+o.y,this.p.z+r.z*x+f.z*l.z)}
 punching(){return this.h.L.act||this.h.R.act}
 isLead(k){return k===(this.stance==='south'?'R':'L')}   // 前手：オーソドックス=左／サウスポー=右
 guardMode(){return this.gb>.5&&this.st>0?(this.gh>.5?2:1):0}
 pSpeed(){const F=this.M.f;let s=1+this.M.ps;if(F.combo)s+=this.combo*(F.rhythm?.08:.05);if(F.desp&&this.st<30)s+=.25;
  if(F.berserk&&this.hp<this.hpMax*.4)s+=.35;if(F.revenge&&this.revT>0)s+=.25;if(CFG.rules.on&&this.gcT>0)s+=CFG.rules.gc.speed;if(this.st<CFG.stam.low)s*=.85;return s}
 pPower(){const F=this.M.f;let p=1+this.M.pw;if(F.desp&&this.st<30)p+=.2;if(F.berserk&&this.hp<this.hpMax*.4)p+=.35;if(CFG.rules.on&&this.gcT>0)p+=CFG.rules.gc.pow;if(this.st<CFG.stam.low)p*=.85;return p}
 onDodge(){if(this.M.f.counter)this.counterT=1.5;this.stat.dodge+=.5}
 startPunch(k,id,opp){const h=this.h[k],d=PUNCHES[id];h.act=true;h.def=d;h.t=0;h.hit=false;h.dg={};h.speed=0;h.sp0=false;h.first=true;h.id=++PID;
  this.gb=0;this.gh=0;this.stat.punch++;this.stDelay=CFG.stam.delay;
  const R=CFG.rules,lead=this.isLead(k),role=lead?CFG.roles.lead:CFG.roles.rear;h.lead=lead;h.tsc=role.ts;h.rch=role.reach;h.dmgMul=role.dmg;h.whMul=role.whiff;   // 前手/後手の補正
  let cost=d.cost*(1+this.M.cm)*role.cost;
  if(R.on){this.chain=this.chainT>0?Math.min(R.chain.max,this.chain+1):0;this.chainT=R.chain.window;cost*=d.x.costMul*(1+R.chain.costStep*this.chain);
   this.hist=this.hist.filter(e=>this.tNow-e.t<3);this.hist.push({id,t:this.tNow});let run=0;for(let i=this.hist.length-1;i>=0&&this.hist[i].id===id;i--)run++;h.stale=run;
  }
  if(!this.infStam)this.st=Math.max(0,this.st-cost);
  const dv=opp.p.clone().sub(this.p),lat=dv.dot(this.right()),fw=Math.max(dv.dot(this.fwd()),.5);h.aim=clamp(lat/fw,-.5,.5)*(this.isP?.6:(this.aimK==null?1:this.aimK))+(this.aimErr?(Math.random()*2-1)*this.aimErr:0)}   // CPUは追尾を弱め、狙いに誤差を持たせる
 handLocal(k){
  const h=this.h[k],m=k==='L'?-1:1,ld=this.isLead(k),N=new V((ld?.24:.17)*m,ld?1.32:1.38,ld?.66:.46),Gb=new V(.2*m,1.4,.55),Gh=new V(.14*m,1.52,.46);
  if(!h.act){h.ph='';h.live=false;h.ext=0;h.u=0;return N.lerp(Gb,this.gb).lerp(Gh,this.gh)}
  const d=h.def,[w,s,ho,rt]=d.t,t=h.t,a=h.aim,ap=p=>{const q=p.clone();q.z*=h.rch||1;return q.setX(q.x+a*q.z)},W=ap(d.W),C=ap(d.C),A=ap(d.A);
  h.live=false;h.u=0;
  if(t<w){h.ph='w';h.ext=0;const u=t/w;return N.lerp(W,1-(1-u)*(1-u))}
  if(t<w+s){h.ph='s';const u=(t-w)/s;h.u=u;h.ext=u;h.live=u>.25;return quad(W,C,A,Math.pow(u,1.6))}
  if(t<w+s+ho){h.ph='h';h.ext=1;h.live=true;return A}
  h.ph='r';const v=clamp((t-w-s-ho)/rt,0,1);h.ext=1-v;return quad(A,C.clone().lerp(N,.5),N,v*v*(3-2*v))}
 upd(dt,I,opp){
  const al=this.hp>0,M=this.M,F=M.f;if(!al)I=IDLE;
  if(I.face!=null&&al)this.yaw+=angd(I.face,this.yaw)*Math.min(1,dt*CFG.faceRate*(I.faceScale==null?1:I.faceScale));
  this.lock-=dt;this.stun-=dt;this.stDelay-=dt;this.dash.cd-=dt;this.swCd-=dt;this.dkCd-=dt;this.counterT-=dt;this.ambT-=dt;this.revT-=dt;this.comboT-=dt;this.chainT-=dt;this.gcT-=dt;this.tNow+=dt;
  if(this.comboT<=0)this.combo=0;
  const R=CFG.rules;
  if(R.on&&this.gb>.5)this.st=Math.max(0,this.st-R.guardDrain*dt);   // ガード維持はスタミナを消費し、回復しない
  else if(this.stDelay<=0)this.st=Math.min(this.stMax(),this.st+CFG.stam.regen*(1+M.sr)*(F.desp?.8:1)*(this.gb>.5?.5:1)*dt);
  if(this.infStam){this.st=this.stMax();this.exh=false}
  if(this.st<=0)this.exh=true;else if(this.exh&&this.st>=20)this.exh=false;
  if(this.gb>.5)this.stat.guard+=dt;
  const free=this.lock<=0&&this.stun<=0&&al,cm=1+M.cm,f=this.fwd(),r=this.right();
  if(I.dash&&free&&this.dash.cd<=0&&this.dash.t<=0){const c=F.phantom?0:CFG.dash.cost*cm;
   if(this.st>=c*.5){this.st=Math.max(0,this.st-c);this.stDelay=CFG.stam.delay;this.dash.t=CFG.dash.time;this.dash.cd=CFG.dash.cd;this.stat.dodge++;
    this.dash.dir=r.clone().multiplyScalar(I.dash.x).addScaledVector(f,I.dash.z).normalize()}}
  if(I.sway&&free&&this.swCd<=0&&!this.sw&&!this.dk&&!this.punching()){const c=F.phantom?0:CFG.sway.cost*cm;
   if(this.st>=c){this.st-=c;this.stDelay=CFG.stam.delay;this.sw={t:0,dir:I.sway};this.swCd=CFG.sway.dur+CFG.sway.cd;this.stat.dodge++}}
  if(I.duck&&free&&this.dkCd<=0&&!this.dk&&!this.sw&&!this.punching()){const c=F.phantom?0:(CFG.duck.cost+(F.ambush?4:0))*cm;
   if(this.st>=c){this.st-=c;this.stDelay=CFG.stam.delay;this.dk={t:0};this.dkCd=CFG.duck.dur+CFG.duck.cd;this.stat.dodge++;if(F.ambush)this.ambT=CFG.duck.dur+.8}}
  let ox=0,oy=0;
  if(this.sw){const S=CFG.sway,u=this.sw.t/S.dur;this.sw.t+=dt;ox=this.sw.dir*S.dist*(1+M.dg)*Math.sin(Math.PI*clamp(u,0,1));
   if(u>=1){this.sw=null;this.lock=Math.max(this.lock,S.rec*(1-M.rc))}}
  if(this.dk){const u=this.dk.t/CFG.duck.dur;this.dk.t+=dt;oy=-CFG.duck.drop*clamp(Math.sin(Math.PI*clamp(u,0,1))*1.8,0,1);
   if(u>=1){this.dk=null;this.lock=Math.max(this.lock,.1*(1-M.rc))}}
  this.off.set(ox,oy,0);
  if(this.dash.t>0){this.v.copy(this.dash.dir).multiplyScalar(CFG.dash.dist*(1+M.ds)/CFG.dash.time);this.dash.t-=dt}
  else{let mx=I.mx,mz=I.mz;   // 移動は攻撃から完全に独立（パンチ入力で移動が変わらない）
   const l=Math.hypot(mx,mz),s=l>1?1/l:1,
   sp=CFG.move.speed*(1+M.mv)*(this.gb>.5?.55*(1-M.gp):1)*(this.stun>0?.4:1)*(this.sw||this.dk?.5:1);
   this.v.lerp(r.clone().multiplyScalar(mx*s*sp).addScaledVector(f,mz*s*sp),1-Math.exp(-CFG.move.accel*dt))}
  this.p.addScaledVector(this.v,dt).addScaledVector(this.kick,dt);this.kick.multiplyScalar(Math.exp(-8*dt));
  this.p.x=clamp(this.p.x,-CFG.ringHalf,CFG.ringHalf);this.p.z=clamp(this.p.z,-CFG.ringHalf,CFG.ringHalf);
  const dx=this.p.x-opp.p.x,dz=this.p.z-opp.p.z,dd=Math.hypot(dx,dz);
  if(opp!==this&&!opp.isDummy&&dd<CFG.minSep&&dd>1e-4){const k=(CFG.minSep-dd)*.5/dd;this.p.x+=dx*k;this.p.z+=dz*k}
  const ps=this.pSpeed();
  for(const k of['L','R']){const h=this.h[k],rq=I.punch[k];
   if(rq&&al)this.q[k]={id:rq,ttl:.2};let q=this.q[k];
   if(q){q.ttl-=dt;if(q.ttl<=0)this.q[k]=q=null}
   if(q&&h.act&&h.t>h.def.dur-h.def.t[3]*.4)this.endPunch(h);
   if(q&&!h.act&&free&&this.lock<=0&&!this.sw&&!this.dk&&this.st>=PUNCHES[q.id].cost*.6){this.startPunch(k,q.id,opp);this.q[k]=null}
   if(h.act){h.t+=dt*ps*(h.tsc||1);if(h.t>=h.def.dur)this.endPunch(h)}}
  const gt=I.guard&&!this.punching()&&!this.sw&&!this.dk?1:0;
  this.gb+=(gt-this.gb)*(1-Math.exp(-18*dt));this.gh+=((gt&&I.guard===2?1:0)-this.gh)*(1-Math.exp(-18*dt));
  this.shake*=Math.exp(-7*dt);if(!al)this.koT+=dt;
  for(const k of['L','R'])this.h[k].local=this.handLocal(k)}
 endPunch(h,intr){h.act=false;const M=this.M,R=CFG.rules,d=h.def;
  if(!h.hit){
   if(!R.on)this.lock=Math.max(this.lock,(.12+(M.f.breaker?.15:0))*(1-M.rc));
   else if(!intr){this.lock=Math.max(this.lock,(d.x.whiff*(h.whMul||1)+(M.f.breaker?.15:0))*(1-M.rc));   // 空振り：パンチごとの隙＋スタミナ追加消費
    if(!this.infStam)this.st=Math.max(0,this.st-d.cost*R.whiffCost);this.stDelay=Math.max(this.stDelay,CFG.stam.delay)}
   this.combo=0}
  else this.lock=Math.max(this.lock,R.on&&d.x.hitLock?d.x.hitLock*(1-M.rc):.04);   // 命中後の隙（アッパーは大きい）
  if(R.on&&!intr&&this.chain>=R.chain.lockFrom)this.lock=Math.max(this.lock,(this.chain-R.chain.lockFrom+1)*R.chain.lockStep*(1-M.rc))}   // 連打の後の隙
 snap(){const r=n=>Math.round(n*1000)/1000,H=k=>{const h=this.h[k];return[h.act?1:0,h.def?h.def.id:'',r(h.ext),r(h.local.x),r(h.local.y),r(h.local.z),r(h.u),h.ph]};
  return{id:this.id,p:[r(this.p.x),r(this.p.z)],y:r(this.yaw),v:[r(this.v.x),r(this.v.z)],o:[r(this.off.x),r(this.off.y)],sn:this.stance==='south'?1:0,gb:r(this.gb),gh:r(this.gh),
   hp:r(this.hp),hm:this.hpMax,st:r(this.st),ex:this.exh?1:0,sk:r(this.shake),ko:r(this.koT),h:[H('L'),H('R')],cb:this.combo}}
 applySnap(s){this.p.x=s.p[0];this.p.z=s.p[1];this.yaw=s.y;this.v.x=s.v[0];this.v.z=s.v[1];this.off.set(s.o[0],s.o[1],0);this.stance=s.sn?'south':'orth';this.gb=s.gb;this.gh=s.gh;
  this.hp=s.hp;this.hpMax=s.hm;this.st=s.st;this.exh=!!s.ex;this.shake=s.sk;this.koT=s.ko;this.combo=s.cb;
  [['L',0],['R',1]].forEach(([k,i])=>{const a=s.h[i],h=this.h[k];h.act=!!a[0];h.def=a[1]?PUNCHES[a[1]]:null;h.ext=a[2];h.local.set(a[3],a[4],a[5]);h.u=a[6];h.ph=a[7]})}
 zones(no){const l=(x,y,z)=>this.toWorld(new V(x,y,z),no),Z=[],pt=(n,k,y,r,b)=>{const c=l(0,y,0);Z.push({n,k,a:c,b:c,r,bias:b||0})};
  pt('頭部','head',1.64,.17,.06);pt('胸部','chest',1.32,.21);pt('腹部','abdomen',1.02,.2);
  for(const k of['L','R'])Z.push({n:k==='L'?'左腕':'右腕',k:'arm'+k,a:l((k==='L'?-1:1)*.24,1.42,0),b:this.toWorld(this.h[k].local,no),r:.09,bias:-.04});
  return Z}
}

/* ============ CPU（スタイル＋反応＋学習） ============ */
const STY={
 combo:{d:1.1,n:'連打型',cool:[.35,.8],cp:.7,gp:.2,ev:.3,pref:['spd','combo','rcv','mov']},
 power:{d:1.15,n:'パワー型',cool:[.8,1.5],cp:.15,gp:.3,ev:.25,pref:['pow','breaker','berserk','desp']},
 counter:{d:1.35,n:'カウンター型',cool:[.7,1.3],cp:.3,gp:.15,ev:.7,pref:['dod','counter','phantom','ambush']},
 guard:{d:1.4,n:'防御型',cool:[.8,1.4],cp:.3,gp:.65,ev:.25,pref:['grd','revenge','stm','reg']}};
const ATK={combo:[['L','L_JAB'],['L','L_JAB'],['R','R_STRAIGHT'],['L','L_HOOK'],['L','L_UPPER']],power:[['R','R_STRAIGHT'],['R','R_HOOK'],['L','L_HOOK'],['R','R_UPPER'],['L','L_UPPER']],
 counter:[['L','L_JAB'],['R','R_STRAIGHT'],['R','R_HOOK'],['L','L_UPPER']],guard:[['L','L_JAB'],['R','R_STRAIGHT'],['L','L_HOOK'],['L','L_UPPER']]};
const BODY=[['L','L_HOOK'],['R','R_UPPER'],['L','L_UPPER']];   // ガードの固い相手への圧力技（フック＝ガード圧力、アッパー＝貫通）
/* ---- CPU難易度。「激ムズ」は「つよい」と同じ判断力＋基礎能力補正（bonus）。補正は画面にも表示される ---- */
const DIFF={
 easy:{aimErr:.18,n:'よわい',rt:[.32,.5],miss:.35,ev:.55,gp:.5,cool:1.8,cp:.35,learn:0,punish:0,space:0,tired:45,pick:0,move:.5},
 normal:{aimErr:.1,n:'ふつう',rt:[.14,.3],miss:.12,ev:1,gp:1,cool:1,cp:1,learn:.5,punish:.45,space:.4,tired:28,pick:.6,move:1},
 hard:{aimErr:.05,n:'つよい',rt:[.1,.22],miss:.05,ev:1.15,gp:1.1,cool:.85,cp:1,learn:1,punish:1,space:1,tired:30,pick:1,move:1},
 insane:{aimErr:.05,n:'激ムズ',rt:[.1,.22],miss:.05,ev:1.15,gp:1.1,cool:.85,cp:1,learn:1,punish:1,space:1,tired:30,pick:1,move:1,
  bonus:{pw:.05,ps:.03,mv:.04,sm:8,sr:.06,hp:6},bonusText:'威力+5% ／ 攻撃速度+3% ／ 移動+4% ／ スタミナ+8・回復+6% ／ HP+6'}};
class AI{
 constructor(key,diff){this.key=key;this.S=STY[key];this.dk=DIFF[diff]?diff:'normal';this.D=DIFF[this.dk];this.mem=[];this.reset()}
 reset(){this.cool=1.2;this.stT=0;this.sg=0;this.seen=0;this.rt=-1;this.tg='head';this.gT=0;this.gM=1;this.combo=null;this.rec=0;this.dcd=0;this.t=0;
  this.punishT=0;this.pnT=-1;this.pnGo=false;this.vulT=0;this.mine=[];
  this.ob={times:[],ids:[],rate:0,guard:0,rep:0,seenId:{L:0,R:0},was:{L:false,R:false},cur:{L:null,R:null}}}
 /* プレイヤーの攻撃頻度・同じ技の繰り返し・ガードの多さ・空振りを観察（入力の先読みはしない：始まった攻撃を「見て」学ぶだけ） */
 observe(me,op,dt,dist){const ob=this.ob,D=this.D;
  for(const k of['L','R']){const h=op.h[k];
   if(h.act&&h.id!==ob.seenId[k]){ob.seenId[k]=h.id;ob.times.push(this.t);ob.ids.push(h.def.id);if(ob.ids.length>8)ob.ids.shift();ob.cur[k]=h}
   if(ob.was[k]&&!h.act&&ob.cur[k]&&!ob.cur[k].hit&&!(op.stun>0))this.openPunish(dist);   // 空振りした
   ob.was[k]=h.act}
  ob.times=ob.times.filter(x=>this.t-x<5);ob.rate=ob.times.length/5;
  ob.guard+=((op.gb>.5?1:0)-ob.guard)*Math.min(1,dt/3);
  let run=0;for(let i=ob.ids.length-1;i>=0&&ob.ids[i]===ob.ids[ob.ids.length-1];i--)run++;ob.rep=run;
  const vul=op.lock>.08&&!op.punching()&&dist<1.6;   // 攻撃後の隙（ガードされた・空振りした・連打の反動）
  if(vul&&this.vulT<=0)this.openPunish(dist);this.vulT=vul?this.vulT+dt:0;this.punishT-=dt;this.pnT-=dt}
 openPunish(dist){if(this.D.punish<=0||this.punishT>0||dist>1.7)return;this.punishT=.6;this.pnGo=Math.random()<this.D.punish;this.pnT=rnd(this.D.rt[0],this.D.rt[1])*.8}
 /* 距離に合ったパンチを選ぶ（役割表Xの射程）。ガードが多い相手にはボディ/アッパー、連打の後は軽いパンチ、同じ技の連発は避ける */
 pickPunch(me,op,dist){const S=this.S,D=this.D,ob=this.ob,base=ATK[this.key];
  if(D.pick<=0){const a=base[Math.floor(Math.random()*base.length)];return a[1]}
  const W={};for(const a of base)W[a[1]]=(W[a[1]]||0)+1;for(const a of BODY)W[a[1]]=(W[a[1]]||0)+.4;W.R_UPPER=(W.R_UPPER||0)+.2;
  let tot=0;const ws=[];
  for(const id in W){const d=PUNCHES[id],[mn,ide,mx]=d.x.rng;
   let w=W[id],suit=dist<mn-.08||dist>mx+.05?.04:.25+.75*Math.max(0,1-Math.abs(dist-ide)/Math.max(.2,mx-mn));
   w*=1-(1-suit)*D.pick;
   if(ob.guard*D.learn>.4){if(d.x.gp>1.2||d.x.pierce>0)w*=2.6;else if(id.endsWith('JAB'))w*=.5}
   if(this.mine.slice(-2).includes(id))w*=.35;
   if(me.st<45&&d.cost>9)w*=.55;
   ws.push([id,w]);tot+=w}
  let r=Math.random()*tot;for(const [id,w] of ws){r-=w;if(r<=0)return id}return ws[0][0]}
 think(me,op,dt){
  const S=this.S,D=this.D,ob=this.ob,I={mx:0,mz:0,punch:{},guard:0,dash:null,sway:0,duck:false},dx=op.p.x-me.p.x,dz=op.p.z-me.p.z,dist=Math.hypot(dx,dz);
  I.face=Math.atan2(-dx,-dz);I.faceScale=me.punching()?.3:1;me.aimK=.6;me.aimErr=D.aimErr==null?.1:D.aimErr;this.t+=dt;   // 攻撃中は相手を追尾しすぎない／狙いに誤差を持たせるthis.cool-=dt;this.rec-=dt;this.stT-=dt;this.dcd-=dt;
  this.observe(me,op,dt,dist);
  for(const k of['L','R']){const h=op.h[k];   // 相手のパンチ開始を「見てから」反応（難易度で反応時間が変わる）
   if(h.act&&h.id!==this.seen&&dist<2.2&&(h.ph==='w'||h.ph==='s')){this.seen=h.id;this.rt=rnd(D.rt[0],D.rt[1]);this.tg=h.def.A.y>1.35?'head':'body';this.mem.push(this.tg);if(this.mem.length>10)this.mem.shift()}}
  if(this.rt>=0){this.rt-=dt;if(this.rt<0&&Math.random()>=D.miss){   // 見逃し(miss)もある
   const hs=this.mem.filter(x=>x==='head').length/Math.max(1,this.mem.length),press=Math.min(1,ob.rate/2.5)*D.learn,rep=ob.rep>=3?D.learn:0;
   const ev=Math.min(.95,S.ev*D.ev*(1+.3*rep)),gp=Math.min(.95,(S.gp+.2*press)*D.gp),x=Math.random();
   if(x<ev*.88){if(this.tg==='head'&&Math.random()<.4+hs*.3)I.duck=true;else I.sway=Math.random()<.5?-1:1}
   else if(Math.random()<.5+gp){this.gT=.5+.2*press;this.gM=this.tg==='head'?2:1}}}
  if(this.gT>0){this.gT-=dt;I.guard=this.gM}
  else if(S.gp>.5*D.gp&&this.cool>.35&&!me.punching()&&dist<1.8&&me.st>35)I.guard=1;
  if(this.combo){this.combo.t-=dt;if(this.combo.t<=0){const id=this.pickPunch(me,op,dist),d=PUNCHES[id];if(dist<1.6&&!me.punching()){I.punch[d.hand]=id;this.mine.push(id)}this.combo=null}}
  const tired=me.st<D.tired,rdy=!I.guard&&!tired&&!me.punching()&&me.lock<=0&&dist<1.55;
  const react=me.counterT>0||me.revT>0||me.gcT>0;   // 避けた／ガードした直後の反撃チャンス
  let go=rdy&&this.cool<=0&&dist<1.5;
  if(rdy&&this.pnT<0&&this.pnT>-.05&&this.pnGo&&this.punishT>0){go=true;this.pnGo=false}   // 相手の空振り・隙への反撃
  if(rdy&&react&&this.cool<.6)go=true;
  if(go){const id=this.pickPunch(me,op,dist),d=PUNCHES[id];I.punch[d.hand]=id;this.mine.push(id);if(this.mine.length>6)this.mine.shift();
   const cp=S.cp*D.cp*(me.chain>=2?.3:1)*(me.st<50?.6:1);if(Math.random()<cp)this.combo={t:.2};
   this.cool=rnd(S.cool[0],S.cool[1])*D.cool*(1+.15*me.chain);this.rec=D.space>0&&me.chain>=2?.5:.35}
  /* 距離管理：スタイル別の理想距離を中心に、近すぎ/遠すぎの幅を分けて小刻みな前後移動を抑える。
     相手の連打・自分のスタミナ・反撃チャンスに応じて距離を変え、棒立ちの追いかけ合いを減らす。 */
  const pressure=clamp(ob.rate/2.5,0,1);
  let want=S.d;
  if(D.space>0){
   want+=D.space*(.20*pressure+(me.st<40?.16:0));
   if(this.pnGo&&this.punishT>0)want-=.12*D.punish;   // 相手の隙を見たら一歩踏み込む
   if(ob.guard>.55)want+=.05*D.learn;                 // ガードが多い相手には正面から密着しすぎない
  }
  const inner=want-.17,outer=want+.22;
  if(tired){if(dist<outer+.18)I.mz=-.75;else if(dist>outer+.5)I.mz=.35}
  else if(this.rec>0){if(dist<outer)I.mz=-.45;else if(dist>outer+.22)I.mz=.35}
  else if(dist>outer)I.mz=1;
  else if(dist<inner)I.mz=-.8;
  else I.mz=0;
  if(D.space>.5&&dist<.95&&ob.rate>2&&this.dcd<=0&&!I.guard&&Math.random()<.01){I.dash={x:Math.random()<.5?-1:1,z:-1};this.dcd=1.4}
  if(this.stT<=0){this.sg=D.move<1&&Math.random()<.7?0:[-1,0,1][Math.floor(Math.random()*3)];this.stT=rnd(.6,1.6)}
  if(!I.guard)I.mx=this.sg*(dist<2?.48:.65);
  return I}
}

/* ============ N人対応の戦闘解決（サーバー／CPU戦で共通） ============ */
const r3=n=>Math.round(n*1000)/1000;
// 生存者同士が重ならないように押し出す（乱闘用。2人でも使える）
function separate(F){
 for(let i=0;i<F.length;i++)for(let j=i+1;j<F.length;j++){const a=F[i],b=F[j];if(a.hp<=0||b.hp<=0)continue;
  const dx=a.p.x-b.p.x,dz=a.p.z-b.p.z,d=Math.hypot(dx,dz);
  if(d<CFG.minSep&&d>1e-4){const k=(CFG.minSep-d)*.5/d;a.p.x+=dx*k;a.p.z+=dz*k;b.p.x-=dx*k;b.p.z-=dz*k;for(const f of[a,b]){f.p.x=clamp(f.p.x,-CFG.ringHalf,CFG.ringHalf);f.p.z=clamp(f.p.z,-CFG.ringHalf,CFG.ringHalf)}}}}
/* ============ サンドバッグ（練習モード用の的） ============
   Fighter を継承し、combat()/applyHit() をそのまま使う ＝ 射程・威力・スタミナの計算は対人戦と完全に同じ。
   HP/KOはなく（毎ステップ全回復）、当たった時の揺れ方だけが種類ごとに違う。 */
const DUMMY_TYPES={bag:'ヘビーバッグ',ball:'リフレックスボール',stand:'スパーリングスタンド',human:'人型ダミー'};
class Dummy extends Fighter{
 constructor(type,x,z,yaw,owner){super(false);this.type=DUMMY_TYPES[type]?type:'bag';this.isDummy=true;this.id='s';this.owner=owner||null;
  this.newPoint(x,z,yaw);this.hpMax=1e9;this.hp=1e9;this.base=new V(x,0,z);this.sx=0;this.sz=0;this.vx=0;this.vz=0;this.phi=0;this.om=0;this.bp=new V(x,1.5,z);this.bv=new V();this.rest=false;
  this.ballNext=rnd(.45,.9);this.ballPhase=rnd(0,Math.PI*2);
  this.standBurst=0;this.standNext=rnd(.4,1);this.standDir=Math.random()<.5?-1:1;this.standHitT=0;this.standPhase=rnd(0,Math.PI*2);
  for(const k of['L','R'])this.h[k].local=this.handLocal(k)}
 restPos(){const o=this.owner,f=o.fwd();return new V(o.p.x+f.x*1.1,1.5,o.p.z+f.z*1.1)}   // ボールの定位置＝プレイヤーの顔の前
 upd(dt){this.hp=this.hpMax;this.stun=0;this.kick.set(0,0,0);this.shake*=Math.exp(-6*dt);this.tNow+=dt;
  if(this.type==='bag'){   // 吊り下げ：振り子（周期は約2.8秒、ゆっくり減衰）
   for(const a of['x','z']){const s='s'+a,v='v'+a;this[v]+=(-5.2*this[s]-.55*this[v])*dt;this[s]=clamp(this[s]+this[v]*dt,-.6,.6)}
   this.p.x=this.base.x+1.25*this.sx;this.p.z=this.base.z+1.25*this.sz}
  else if(this.type==='ball'){   // リフレックスボール：自発的な小さな揺れ＋不規則な弾み。打つと大きく跳ね、紐の範囲内で戻る
   const o=this.owner;if(o){
    if(!this.rest){this.bp.copy(this.restPos());this.rest=true}
    this.ballNext-=dt;
    if(this.ballNext<=0){const a=rnd(-Math.PI,Math.PI),sp=rnd(.65,1.05);this.bv.x+=Math.cos(a)*sp;this.bv.z+=Math.sin(a)*sp;this.bv.y+=rnd(-.18,.28);this.ballNext=rnd(.55,1.05)}
    const r=this.restPos();
    r.x+=Math.sin(this.tNow*2.1+this.ballPhase)*.10;
    r.z+=Math.sin(this.tNow*1.7+this.ballPhase*1.3)*.07;
    r.y+=Math.sin(this.tNow*3+this.ballPhase)*.045;
    const a=r.clone().sub(this.bp).multiplyScalar(48).addScaledVector(this.bv,-7.2);this.bv.addScaledVector(a,dt);this.bp.addScaledVector(this.bv,dt);
    const anc=new V(o.p.x,1.75,o.p.z),d=this.bp.clone().sub(anc),L=d.length();   // 紐の長さ（1.6m）を超えない
    if(L>1.6){d.multiplyScalar(1/L);this.bp.copy(anc).addScaledVector(d,1.6);const vr=this.bv.dot(d);if(vr>0)this.bv.addScaledVector(d,-vr)}
    this.bp.y=clamp(this.bp.y,.3,2.2)}
   this.p.x=this.bp.x;this.p.z=this.bp.z}
  else if(this.type==='stand'){   // スパーリングスタンド：ゆっくり回る時間と素早く掃く時間を切り替え、命中時は強く回転
   this.standNext-=dt;
   if(this.standNext<=0){if(Math.random()<.48)this.standDir*=-1;this.standBurst=rnd(.35,.7);this.standNext=rnd(1.15,2.05)}
   if(this.standHitT>0){this.standHitT=Math.max(0,this.standHitT-dt);this.om*=Math.exp(-.9*dt)}
   else if(this.standBurst>0){this.standBurst-=dt;const target=this.standDir*(2.35+.75*Math.sin(this.tNow*4+this.standPhase));this.om+=(target-this.om)*Math.min(1,dt*3.2)}
   else{const target=Math.sin(this.tNow*1.05+this.standPhase)*.45;this.om+=(target-this.om)*Math.min(1,dt*1.8)}
   this.om=clamp(this.om,-8,8);this.phi+=this.om*dt;this.p.x=this.base.x;this.p.z=this.base.z}
  for(const k of['L','R'])this.h[k].local=this.handLocal(k)}
 zones(no){const Z=[],S=(n,x,y,z,r)=>{const c=new V(x,y,z);Z.push({n,k:'chest',a:c,b:c,r,bias:0})};   // 器具は部位倍率を1.0（胸）に統一して威力を比べやすくする
  if(this.type==='human')return Fighter.prototype.zones.call(this,no);   // 人型：頭・胸・腹・腕の部位別（対人戦と同じ倍率）
  const b=this.base;
  if(this.type==='bag'){for(const [n,y] of[['バッグ上部',1.6],['バッグ中部',1.15],['バッグ下部',.7]]){const h=2.4-y;S(n,b.x+h*this.sx,y,b.z+h*this.sz,.27)}}
  else if(this.type==='ball')S('ボール',this.bp.x,this.bp.y,this.bp.z,.12);
  else{S('ボール(頭)',b.x,1.62,b.z,.17);const a=new V(b.x,1.15,b.z),t=new V(b.x+Math.cos(this.phi)*.95,1.15,b.z+Math.sin(this.phi)*.95);Z.push({n:'回転バー',k:'chest',a,b:t,r:.1,bias:0})}
  return Z}
 react(e,att){const dx=this.p.x-att.p.x,dz=this.p.z-att.p.z,d=Math.hypot(dx,dz)||1,ux=dx/d,uz=dz/d,m=e.dmg;this.shake=1;   // 当たった方向・強さに応じて揺れる
  if(this.type==='bag'){this.vx+=ux*(.9+m*.22);this.vz+=uz*(.9+m*.22)}
  else if(this.type==='ball'){this.bv.x+=ux*(2.8+m*.5);this.bv.z+=uz*(2.8+m*.5);this.bv.y+=.4}
  else if(this.type==='stand'&&e.zone==='回転バー'){const tx=-Math.sin(this.phi),tz=Math.cos(this.phi),sg=Math.sign(tx*ux+tz*uz)||1;this.om=clamp(this.om+sg*(3+m*.5),-14,14);this.standHitT=.7}}
}
// 命中確定：ダメージ計算とHP更新。結果はイベントとして返す（描画・音・ログは呼び出し側）
function applyHit(att,tgt,h,z,np,ev){
 const Rl=CFG.rules,D=CFG.dmg,def=h.def,F=att.M.f,speed=Math.min(h.speed,30),sf=clamp(speed/D.speedRef,D.speedMin,D.speedMax);
 const dist=Math.hypot(np.x-att.p.x,np.z-att.p.z),df=1-D.rangeFalloff*clamp((dist/def.reach-D.rangeStart)/(1-D.rangeStart),0,1);
 const cls=z.k==='head'?'head':z.k.startsWith('arm')?(def.A.y>1.35?'head':'body'):'body',gm=tgt.guardMode(),blocked=gm>0,tags=[];
 const zmC=cls==='head'?D.zone.head:D.zone.chest,armHit=Rl.on&&z.k.startsWith('arm'),zm=armHit?Rl.armMul:(blocked?zmC:D.zone[z.k]);   // 腕に当たった場合はガード有無にかかわらず腕の倍率（ガードの方が必ず有利）
 let mul=att.pPower();
 if(att.counterT>0){mul*=1+(F.ghost?.8:.4);att.counterT=0;tags.push('COUNTER')}
 if(att.ambT>0&&F.ambush){mul*=1.4;att.ambT=0;tags.push('AMBUSH')}
 if(att.revT>0&&F.revenge){mul*=1.2;tags.push('REVENGE')}
 if(F.breaker&&h.ph==='s'&&h.u>.55){mul*=F.crusher?1.75:1.45;tags.push('SWEET')}
 let rm=1;   // 距離の適性・パンチの役割・同一パンチの連続（読まれやすさ）
 if(Rl.on){const Dc=Math.hypot(att.p.x-tgt.p.x,att.p.z-tgt.p.z),[mn,id,mx]=def.x.rng;
  rm=def.x.baseMul*(h.dmgMul||1)*(Dc<mn?Rl.range.below:Dc<id?.8+.2*(Dc-mn)/(id-mn):Dc<=mx?1-.2*(Dc-id)/(mx-id):.75);
  if(h.stale>=Rl.stale.n)rm*=Math.max(Rl.stale.min,1-Rl.stale.step*(h.stale-Rl.stale.n+1));
  if(att.gcT>0){att.gcT=0;tags.push('COUNTER-GUARD')}}
 let dmg=def.base*sf*zm*df*mul*rm*(tgt.M.f.berserk?1.2:1);
 if(blocked){tgt.st=Math.max(0,tgt.st-(armHit?dmg/zm*zmC:dmg)*D.guard.stam*(def.x.gp||1));tgt.stDelay=1;   // ガードの消耗は部位ではなく攻撃の威力で決まる
  let bm=Math.max(.05,(gm===1?.4:(cls==='head'?.2:.8))*(1-tgt.M.gd));if(Rl.on)bm+=(1-bm)*(def.x.pierce||0);dmg*=bm;
  if(Rl.on){tgt.gcT=Rl.gc.t;if(tgt.st<=0){tgt.stun=Math.max(tgt.stun,Rl.guardBreakStun);tgt.gb=0;tgt.gh=0;tags.push('GUARD BREAK')}}   // ガード成功＝反撃の好機／スタミナ切れでガードブレイク
  if(tgt.M.f.revenge){tgt.revT=tgt.M.f.bulwark?1.6:.8;if(tgt.M.f.bulwark)tgt.st=Math.min(tgt.stMax(),tgt.st+15)}
  att.lock=Math.max(att.lock,Rl.on?Rl.blockLock:.08)}
 dmg=clamp(dmg,blocked?Rl.chipMin*(def.x.gp||1):D.min,D.max);
 h.hit=true;tgt.hp=Math.max(0,tgt.hp-dmg);tgt.shake=blocked?.4:1;tgt.kick.addScaledVector(att.fwd(),blocked?.8:1.8);
 if(!blocked){tgt.stun=CFG.hitstun;tgt.combo=0;for(const k of['L','R']){const o=tgt.h[k];if(o.act&&o.ph==='w')tgt.endPunch(o,true)}}
 if(F.combo){att.combo=Math.min(F.rhythm?8:5,att.combo+1);att.comboT=1.4}
 ev.push({type:'hit',att:att.id,tgt:tgt.id,zone:z.n,punch:def.name,pid:def.id,speed,dmg,blocked,tags,np:[r3(np.x),r3(np.y),r3(np.z)]});
}
// attの両拳を、候補targets全員に対して判定する（1回のパンチで命中は1回まで）
function combat(att,list,dt,ev){
 if(att.hp<=0)return;
 for(const k of['L','R']){const h=att.h[k];if(!h.act)continue;const np=att.toWorld(h.local);
  if(h.first){h.prev.copy(np);h.first=false;continue}
  if(h.ph==='s'){const raw=h.prev.distanceTo(np)/dt;h.speed=h.sp0?h.speed*.65+raw*.35:raw;h.sp0=true}   // 実移動量÷経過時間（平滑化）
  if(h.live&&!h.hit){let best=null,bt=null,bp=0;
   for(const tgt of list){if(tgt===att||tgt.hp<=0||h.dg[tgt.id])continue;let found=false;
    for(const z of tgt.zones()){const d=segDist(h.prev,np,z.a,z.b),R=z.r+CFG.fistR;   // 軌道線分で判定（すり抜け防止）
     if(d<R){found=true;if(R-d+z.bias>bp){bp=R-d+z.bias;best=z;bt=tgt}}}
    if(!found&&(Math.abs(tgt.off.x)>.1||tgt.off.y<-.15)){   // 回避しなければ当たっていたか
     for(const z of tgt.zones(true)){if(segDist(h.prev,np,z.a,z.b)<z.r+CFG.fistR){h.dg[tgt.id]=1;tgt.onDodge();ev.push({type:'dodge',id:tgt.id});break}}}}
   if(best)applyHit(att,bt,h,best,np,ev)}
  h.prev.copy(np)}}
// スナップショット補間（クライアントの描画用）
function lerpSnap(a,b,t){
 const L=(x,y)=>x+(y-x)*t,A=(x,y)=>x+angd(y,x)*t,o=t<.5?a:b;
 return{id:b.id,p:[L(a.p[0],b.p[0]),L(a.p[1],b.p[1])],y:A(a.y,b.y),v:[L(a.v[0],b.v[0]),L(a.v[1],b.v[1])],o:[L(a.o[0],b.o[0]),L(a.o[1],b.o[1])],
  sn:b.sn,gb:L(a.gb,b.gb),gh:L(a.gh,b.gh),hp:b.hp,hm:b.hm,st:L(a.st,b.st),ex:b.ex,sk:L(a.sk,b.sk),ko:b.ko,cb:b.cb,
  h:[0,1].map(i=>{const x=a.h[i],y=b.h[i];return[o.h[i][0],o.h[i][1],L(x[2],y[2]),L(x[3],y[3]),L(x[4],y[4]),L(x[5],y[5]),L(x[6],y[6]),o.h[i][7]]})}}

return{CFG,STEP,V,clamp,rnd,angd,pc,PUNCHES,PUNCH_KEYS,AB,ABM,SYN,RN,RC,calc,rollR,offer,Fighter,IDLE,STY,DIFF,AI,combat,separate,lerpSnap,segDist,Dummy,DUMMY_TYPES};
});
