'use strict';
// game-core.js の単体テスト：CPU戦（プレイヤー=スクリプトBot）を画面なしで回し、破綻がないか確認する
const assert=require('assert');const C=require('../game-core.js');
const {Fighter,AI,combat,STEP,CFG,offer,calc,PUNCHES,lerpSnap,separate,SYN,ABM}=C;
const face=(f,o)=>Math.atan2(-(o.p.x-f.p.x),-(o.p.z-f.p.z));
function play(seed,styleKey){
  let s=seed;const rand=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;
  const P=new Fighter(true),Q=new Fighter(false);P.id='p';Q.id='c';P.newPoint(0,2.4,0);Q.newPoint(0,-1.6,Math.PI);
  const ai=new AI(styleKey);const hits={p:0,c:0},dodges={p:0,c:0};let blocked=0,tags=new Set();
  const ids=Object.keys(PUNCHES);
  for(let i=0;i<120*60;i++){            // 最大60秒
    const I={mx:rand()<.5?1:0,mz:rand()<.6?1:(rand()<.3?-1:0),punch:{},guard:rand()<.15?(rand()<.5?1:2):0,sway:rand()<.02?(rand()<.5?-1:1):0,duck:rand()<.01,face:face(P,Q)};
    if(rand()<.08){const id=ids[Math.floor(rand()*ids.length)];I.punch[PUNCHES[id].hand]=id}
    if(rand()<.01)I.dash={x:rand()<.5?-1:1,z:0};
    P.upd(STEP,I,Q);Q.upd(STEP,ai.think(Q,P,STEP),P);
    const ev=[];combat(P,[Q],STEP,ev);combat(Q,[P],STEP,ev);
    for(const e of ev){if(e.type==='hit'){hits[e.att]++;if(e.blocked)blocked++;e.tags.forEach(t=>tags.add(t));assert(e.dmg>=.3&&e.dmg<=CFG.dmg.max,'dmg range '+e.dmg);assert(e.speed>=0&&e.speed<=30)}else dodges[e.id]++}
    for(const f of[P,Q]){for(const v of[f.p.x,f.p.z,f.hp,f.st,f.yaw])assert(Number.isFinite(v),'NaN');assert(f.hp>=0&&f.hp<=f.hpMax);assert(f.st>=0&&f.st<=f.stMax()+1e-6);
      assert(Math.abs(f.p.x)<=CFG.ringHalf+.4&&Math.abs(f.p.z)<=CFG.ringHalf+.4,'ring bound')}   // 元のCPU戦と同じ挙動：押し出しでロープ内側(±3.7)の手前まで出ることがある
    if(P.hp<=0||Q.hp<=0)break}
  return{hits,dodges,blocked,tags:[...tags],php:P.hp,chp:Q.hp}}
let total={p:0,c:0};
for(const st of['combo','power','counter','guard'])for(const seed of[1,2,3]){const r=play(seed*7919,st);total.p+=r.hits.p;total.c+=r.hits.c}
assert(total.p>0&&total.c>0,'both sides must be able to land hits (fairness): '+JSON.stringify(total));
console.log('OK  CPU戦ヘッドレス12試合: 被弾/命中が両側で発生',total);
// 進化：全能力を適用しても NaN/例外が出ない・シナジーが発動する
const picks=[{id:'combo',r:1},{id:'spd',r:3},{id:'spd',r:0},{id:'counter',r:1},{id:'dod',r:2},{id:'revenge',r:1},{id:'grd',r:1},{id:'breaker',r:2},{id:'pow',r:1},{id:'phantom',r:3}];
const M=calc(picks);for(const s of SYN)assert(M.f[s.id],'synergy '+s.id);assert(M.hp===-20&&M.dg>.5);
for(let i=0;i<500;i++){const o=offer(picks.slice(0,i%8),['off','def','dodge',null][i%4]);assert(o.length===3&&new Set(o.map(x=>x.id)).size===3);assert(o.some(x=>x.r>=1),'at least one Rare+')}
console.log('OK  進化: 全シナジー発動・候補3つが重複せず、必ずRare以上を1つ含む');
// スナップショット：往復と補間
const a=new Fighter(true);a.id='x';a.newPoint(1,2,.5);const b=new Fighter(false);b.id='x';b.newPoint(0,0,0);
b.applySnap(a.snap());assert(Math.abs(b.p.x-1)<1e-3&&Math.abs(b.yaw-.5)<1e-3);
const s1=a.snap(),a2=JSON.parse(JSON.stringify(s1));a2.p=[3,4];a2.y=-.5;const mid=lerpSnap(s1,a2,.5);assert(Math.abs(mid.p[0]-2)<1e-9&&Math.abs(mid.y-0)<1e-9);
console.log('OK  スナップショット: 往復・補間');
