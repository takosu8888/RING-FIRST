'use strict';
// フェーズ2：4人乱闘（BRAWL）のサーバーロジックをモックWebSocketで検証する
const assert=require('assert'),Module=require('module'),EventEmitter=require('events');
const orig=Module._load;Module._load=function(r,...a){return r==='ws'?{WebSocketServer:class{}}:orig.call(this,r,...a)};
const S=require('../server.js');Module._load=orig;
class FW extends EventEmitter{constructor(){super();this.readyState=1;this.out=[]}send(s){this.out.push(JSON.parse(s))}ping(){}terminate(){}close(){if(this.readyState===1){this.readyState=3;this.emit('close')}}}
const conn=()=>{const w=new FW();S.handleConnection(w);return w},tx=(w,m)=>{w.cntT=0;w.emit('message',Buffer.from(JSON.stringify(m)))};
const ofType=(w,t)=>w.out.filter(m=>m.t===t),lastOf=(w,t)=>ofType(w,t).slice(-1)[0];
let sw=0;const tick=(n=1)=>{for(let i=0;i<n;i++){S.tickAll(1/60);if(++sw%3===0)S.snapAll()}};
const IDS=['L_JAB','R_STRAIGHT','R_HOOK','L_HOOK','R_UPPER','L_BODY'];

function makeRoom(n,names){
  const ws=[];const a=conn();tx(a,{t:'create',name:names[0]});const code=a.out[0].code;ws.push(a);
  for(let i=1;i<n;i++){const w=conn();tx(w,{t:'join',code,name:names[i]});assert(lastOf(w,'joined'),names[i]+'が参加できる');ws.push(w)}
  return{code,ws,ids:ws.map(w=>lastOf(w,'joined').id)}}
function startRoom(r){for(const w of r.ws.slice(1))tx(w,{t:'ready',v:true});tx(r.ws[0],{t:'start'});return S.rooms.get(r.code).match}
// 全員が最寄りの敵に向かって歩き、0.5秒に1発パンチするBot
function botInputs(m,steps,skip){for(const [i,f] of m.F.entries()){if(skip&&skip.has(f.id))continue;
  const id=IDS[((steps/30|0)+i)%IDS.length],go=(steps+i*7)%30===0;
  m.input(f.id,{mx:(steps/90|0)%2?.6:-.6,mz:1,g:0,p:[go&&id[0]==='L'?id:null,go&&id[0]==='R'?id:null],d:0,sw:0,dk:0})}}

/* ---------- 1. ルームと開始条件 ---------- */
const R=makeRoom(4,['Ann','Ben','Cat','Dan']);const room=S.rooms.get(R.code);
assert.strictEqual(room.mode,'brawl','3人目の参加でBRAWLへ自動切替');assert(R.ws[0].out.some(m=>m.t==='chat'&&/BRAWL/.test(m.text)),'切替が全員に通知される');
const E5=conn();tx(E5,{t:'join',code:R.code,name:'Eve'});assert.strictEqual(lastOf(E5,'err').c,'full','5人目は満員で拒否');
tx(R.ws[0],{t:'mode',mode:'duel'});assert.strictEqual(room.mode,'brawl','3人以上ではDUELにできない');
tx(R.ws[0],{t:'start'});assert.strictEqual(lastOf(R.ws[0],'err').c,'nope','準備前は開始できない');
console.log('OK  4人ルーム: 自動BRAWL切替 / 5人目は満員 / DUELへ戻せない / 準備前は開始不可');

/* ---------- 2. 4人乱闘を最後まで ---------- */
const m=startRoom(R);assert(m&&m.mode==='brawl'&&m.F.length===4);
const sp=m.F.map(f=>[Math.round(f.p.x),Math.round(f.p.z)].join());assert.deepStrictEqual(new Set(sp).size,4,'4人が別々の位置に配置');
assert(m.F.every(f=>Math.hypot(f.p.x,f.p.z)>2),'四隅に配置');
for(const w of R.ws)assert(lastOf(w,'start').fs.length===4,'全員にstart');
let steps=0,ko=[],evolves=0,evoOffers=[],resumed=0,prev='';const snaps=[];
while(!lastOf(R.ws[0],'end')&&steps++<60*60*10){
  if(m.state==='fight')botInputs(m,steps);
  tick();
  if(m.state!==prev){if(prev==='evolve'&&m.state==='fight')resumed++;if(m.state==='evolve'){evolves++;evoOffers.push(new Set(Object.keys(m.offers)));
     const alive=m.F.filter(f=>f.hp>0).map(f=>f.id);assert.deepStrictEqual([...evoOffers[evoOffers.length-1]].sort(),alive.sort(),'進化の選択肢は生存者だけに届く')}prev=m.state}
  for(const [i,w] of R.ws.entries()){const o=ofType(w,'offers').slice(-1)[0];if(o&&w.po!==o){w.po=o;tx(w,{t:'pick',i:9});tx(w,{t:'pick',i:i%3})}}
  const sn=lastOf(R.ws[0],'snap');if(sn&&sn!==snaps[snaps.length-1])snaps.push(sn)}
const end=lastOf(R.ws[0],'end');assert(end,'乱闘が終了する');
for(const w of R.ws)for(const e of ofType(w,'ev'))for(const x of e.e)if(x.type==='ko'&&!ko.includes(x.id))ko.push(x.id);
assert(ko.length>=3||end.winner===null,'3人が脱落して終了: '+ko.length);
assert.strictEqual(end.rank.length,4,'4人全員の順位');assert.strictEqual(new Set(end.rank).size,4);
if(end.winner){assert.strictEqual(end.rank[0],end.winner,'1位=最後の生存者');assert.strictEqual(end.rank[3],ko[0],'最初の脱落者が最下位')}
assert(evolves>=1&&resumed>=1,'脱落のたびに生存者が進化→同じ試合を再開: '+evolves);
assert(evoOffers.every(s=>s.size>=2),'生存者が2人以上のときだけ進化');
const pk=lastOf(R.ws[0],'picks');assert(pk&&Object.keys(pk.picks).length===4,'全員の進化内容が共有される');
assert.deepStrictEqual(lastOf(R.ws[0],'picks'),lastOf(R.ws[3],'picks'));
assert(snaps.every(s=>s.f.length===4&&s.m.k!==undefined),'スナップショットは全員分＋脱落リストを含む');
assert.strictEqual(room.state,'lobby');assert(!room.match);assert(room.active().every(p=>!p.ready),'終了後はロビーへ');
console.log(`OK  4人乱闘1試合: 最後の1人で終了 / 順位 ${end.rank.length}人 / 進化${evolves}回(生存者のみ) / 再開${resumed}回 / 脱落${ko.length}人`);

/* ---------- 3. 標的：最寄り優先・ヒステリシス・Tab手動・脱落で解除 ---------- */
const R2=makeRoom(3,['P1','P2','P3']);const m2=startRoom(R2);tick(60*2);
const [a,b,c]=m2.F;a.p.x=0;a.p.z=0;b.p.x=2;b.p.z=0;c.p.x=-2.2;c.p.z=0;a.tgtId=null;a.autoId=null;
assert.strictEqual(m2.targetOf(a),b,'最寄りが標的');
c.p.x=-1.9;assert.strictEqual(m2.targetOf(a),b,'わずかな差では標的が切り替わらない（視点の暴れ防止）');
c.p.x=-1.0;assert.strictEqual(m2.targetOf(a),c,'明確に近い敵がいれば切り替わる');
tx(R2.ws[0],{t:'tgt'});assert(a.tgtId&&a.tgtId!==c.id,'Tabで手動指定（標的が切り替わる）');const man=m2.targetOf(a);
c.p.x=-0.8;b.p.x=3;assert.strictEqual(m2.targetOf(a),man,'手動指定は距離が変わっても維持');
man.hp=0;assert.notStrictEqual(m2.targetOf(a),man,'標的が脱落したら自動に戻る');
console.log('OK  標的: 最寄り優先 / ヒステリシス / Tab手動 / 脱落で解除（パンチは入力時のみ発生）');

/* ---------- 4. 試合中の退出・切断：残りで継続し、最後の1人が勝つ ---------- */
const R3=makeRoom(3,['X','Y','Z']);const m3=startRoom(R3);tick(60*2.5);assert.strictEqual(m3.state,'fight');
tx(R3.ws[2],{t:'leave'});assert(!lastOf(R3.ws[0],'end'),'3人中1人退出でも試合は続く');
assert(ofType(R3.ws[0],'ev').some(e=>e.e.some(x=>x.type==='ko'&&x.id===R3.ids[2])),'退出者の脱落が通知される');
assert.strictEqual(m3.F.filter(f=>f.hp>0).length,2);
R3.ws[1].close();for(const p of S.rooms.get(R3.code).players.values())if(!p.connected)p.dcAt=Date.now()-60000;S.janitor();
const e3=lastOf(R3.ws[0],'end');assert(e3&&e3.winner===R3.ids[0]&&e3.reason==='last','最後の1人が勝利');assert.strictEqual(e3.rank.length,3);
console.log('OK  乱闘中の退出/切断: 残りで継続→猶予切れで脱落→最後の1人が勝利');

/* ---------- 5. 時間切れ・2人BRAWL・進化タイムアウト・不正pick ---------- */
const R4=makeRoom(3,['T1','T2','T3']);const m4=startRoom(R4);tick(60*2.5);
m4.F[1].hp=m4.F[1].hpMax*.3;m4.F[2].hp=m4.F[2].hpMax*.5;m4.timer=.01;tick(2);
const e4=lastOf(R4.ws[0],'end');assert(e4&&e4.reason==='time'&&e4.winner===R4.ids[0],'時間切れはHP割合の最も高い人が勝つ');
const R5=makeRoom(2,['D1','D2']);tx(R5.ws[0],{t:'mode',mode:'brawl'});const m5=startRoom(R5);tick(60*2.5);m5.F[1].hp=0;tick(2);
const e5=lastOf(R5.ws[0],'end');assert(e5&&e5.winner===R5.ids[0]&&e5.rank.length===2&&!ofType(R5.ws[0],'offers').length,'2人BRAWLは進化なしで即終了');
const R6=makeRoom(4,['F1','F2','F3','F4']);const m6=startRoom(R6);tick(60*2.5);m6.F[3].hp=0;tick(2);
assert.strictEqual(m6.state,'evolve');assert(!ofType(R6.ws[3],'offers').length,'脱落者には進化が届かない');
tx(R6.ws[3],{t:'pick',i:0});assert.strictEqual(m6.picked.size,0,'脱落者のpickは無視される');
m6.deadline=Date.now()-1;tick(2);assert.strictEqual(m6.state,'fight','進化の制限時間切れは自動選択で再開');
assert(m6.F.slice(0,3).every(f=>f.picks.length===1)&&m6.F[3].picks.length===0,'生存者のみ能力を獲得');
const dead=m6.F[3];m6.input(dead.id,{mx:1,mz:1,g:0,p:['L_JAB',null],d:0,sw:0,dk:0});const x0=dead.p.x;tick(30);assert.strictEqual(dead.p.x,x0,'脱落者の入力は無視される');
console.log('OK  時間切れ判定 / 2人BRAWL即終了 / 進化タイムアウト自動選択 / 脱落者の入力・進化は無効');
