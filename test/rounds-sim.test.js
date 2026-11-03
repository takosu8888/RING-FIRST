'use strict';
// ラウンド数設定（DUEL）：ホスト設定の共有・検証・総ラウンド制の勝敗・延長ラウンド・BRAWLへの非影響
const assert=require('assert'),Module=require('module'),EventEmitter=require('events');
const orig=Module._load;Module._load=function(r,...a){return r==='ws'?{WebSocketServer:class{}}:orig.call(this,r,...a)};
const S=require('../server.js');Module._load=orig;
class FW extends EventEmitter{constructor(){super();this.readyState=1;this.out=[]}send(s){this.out.push(JSON.parse(s))}ping(){}terminate(){}close(){if(this.readyState===1){this.readyState=3;this.emit('close')}}}
const conn=()=>{const w=new FW();S.handleConnection(w);return w},tx=(w,m)=>{w.cntT=0;w.emit('message',Buffer.from(JSON.stringify(m)))};
const ofType=(w,t)=>w.out.filter(m=>m.t===t),lastOf=(w,t)=>ofType(w,t).slice(-1)[0];
function duel(n){const a=conn();tx(a,{t:'create',name:'A'});const code=a.out[0].code,b=conn();tx(b,{t:'join',code,name:'B'});
  if(n!==undefined)tx(a,{t:'rounds',n});tx(b,{t:'ready',v:true});return{a,b,code,ia:a.out[0].id,ib:b.out[0].id,room:()=>S.rooms.get(code)}}
let sw=0;const run=(m,n=1)=>{for(let i=0;i<n;i++){S.tickAll(1/60);if(++sw%3===0)S.snapAll()}};
// 各ラウンドを指定した勝者で終わらせる（敗者のHPを0に）。進化は自動で選択
function playRounds(g,winners){let k=0;const m=g.room().match;let guard=0;
  while(!lastOf(g.a,'end')&&guard++<20000){
    if(m.state==='fight'&&k<winners.length){const loser=m.F.find(f=>f.id!==winners[k]);loser.hp=0;k++}
    run(m);for(const w of[g.a,g.b]){const o=ofType(w,'offers').slice(-1)[0];if(o&&w.po!==o){w.po=o;tx(w,{t:'pick',i:0})}}}
  return lastOf(g.a,'end')}

// --- 設定の検証 ---
let g=duel();assert.strictEqual(lastOf(g.a,'room').rounds,3,'既定は3ラウンド');
for(const bad of[0,-1,21,2.5,'x',null,NaN,1e9]){tx(g.a,{t:'rounds',n:bad});assert.strictEqual(g.room().rounds,3,'不正値は無視: '+bad)}
tx(g.b,{t:'rounds',n:10});assert.strictEqual(g.room().rounds,3,'ホスト以外は変更できない');
for(const ok of[1,5,10,20]){tx(g.a,{t:'rounds',n:ok});assert.strictEqual(lastOf(g.b,'room').rounds,ok,'参加者にも共有: '+ok)}
console.log('OK  ラウンド数: 既定3 / 1〜20のみ有効 / 不正値・非ホストは無効 / 全員に共有');

// --- 5ラウンド：全ラウンド戦って終了。進化は最終ラウンドの前まで ---
g=duel(5);tx(g.b,{t:'ready',v:true});tx(g.a,{t:'start'});assert.strictEqual(lastOf(g.b,'start').rounds,5,'startで総ラウンド数が全員に届く');
tx(g.a,{t:'rounds',n:2});assert.strictEqual(g.room().rounds,5,'試合中は変更できない');
let m=g.room().match;run(m,60*3);assert.strictEqual(lastOf(g.a,'snap').m.rt,5,'スナップショットに総ラウンド数');
let end=playRounds(g,[g.ia,g.ia,g.ia,g.ib,g.ia]);
assert(end&&end.winner===g.ia&&end.score[g.ia]===4&&end.score[g.ib]===1,'5ラウンドを戦い切って勝ち越しで勝利');
assert.strictEqual(ofType(g.a,'picks').length,4,'進化は各ラウンド終了後（最終ラウンドを除く4回）');
assert(Math.max(...ofType(g.a,'snap').map(x=>x.m.r))===5,'ラウンド番号は5まで');
console.log('OK  5ラウンド: 全ラウンドを戦って勝ち越しで決着 / 進化4回 / 途中変更不可');

// --- 早期決着しない（3-0でも残りラウンドを戦う）---
g=duel(5);tx(g.b,{t:'ready',v:true});tx(g.a,{t:'start'});m=g.room().match;
playRounds(g,[g.ia,g.ia,g.ia]);assert(!lastOf(g.a,'end')&&m.state!=='end','3-0でも5ラウンドに達するまで続く');
console.log('OK  選んだラウンド数に達するまで試合は続く');

// --- 同点なら延長ラウンド ---
g=duel(2);tx(g.b,{t:'ready',v:true});tx(g.a,{t:'start'});m=g.room().match;
end=playRounds(g,[g.ia,g.ib,g.ib]);assert(end&&end.winner===g.ib&&end.score[g.ib]===2,'1-1の同点→延長ラウンドで決着');
assert(Math.max(...ofType(g.a,'snap').map(x=>x.m.r))===3,'延長ラウンド(ROUND 3 / 2)が行われた');
console.log('OK  同点は延長ラウンドで決着');

// --- 1ラウンド制 ---
g=duel(1);tx(g.b,{t:'ready',v:true});tx(g.a,{t:'start'});end=playRounds(g,[g.ib]);assert(end&&end.winner===g.ib&&!ofType(g.a,'picks').length,'1ラウンドは進化なしで終了');
console.log('OK  1ラウンド制');

// --- BRAWL はラウンド設定の影響を受けない ---
const a=conn();tx(a,{t:'create',name:'A'});const code=a.out[0].code,ws=[a];for(let i=1;i<3;i++){const w=conn();tx(w,{t:'join',code,name:'P'+i});ws.push(w)}
tx(a,{t:'rounds',n:10});for(const w of ws.slice(1))tx(w,{t:'ready',v:true});tx(a,{t:'start'});
const bm=S.rooms.get(code).match;assert.strictEqual(bm.mode,'brawl');assert.strictEqual(bm.rounds,1);assert.strictEqual(lastOf(ws[1],'start').rounds,1,'BRAWLは常に1ラウンド（最後の1人）');
console.log('OK  BRAWLは従来どおり最後の1人（ラウンド設定は影響しない）');
