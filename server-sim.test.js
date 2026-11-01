'use strict';
// server.js の統合テスト。実ネットワークは使わず、モックWebSocketでサーバーのロジックを直接駆動する。
const assert=require('assert'),Module=require('module'),EventEmitter=require('events');
const orig=Module._load;Module._load=function(r,...a){return r==='ws'?{WebSocketServer:class{}}:orig.call(this,r,...a)};
const S=require('../server.js');Module._load=orig;
class FW extends EventEmitter{constructor(){super();this.readyState=1;this.out=[]}send(s){this.out.push(JSON.parse(s))}ping(){}terminate(){}close(){if(this.readyState===1){this.readyState=3;this.emit('close')}}}
const conn=()=>{const w=new FW();S.handleConnection(w);return w};
const tx=(w,m)=>{w.cntT=0;w.emit('message',Buffer.from(JSON.stringify(m)))};   // シミュレーションは実時間より速いので、連続送信制限のカウンタをリセット
const ofType=(w,t)=>w.out.filter(m=>m.t===t),lastOf=(w,t)=>ofType(w,t).slice(-1)[0];
let sw=0;const tick=(n=1)=>{for(let i=0;i<n;i++){S.tickAll(1/60);if(++sw%3===0)S.snapAll()}};

// --- ルーム ---
const A=conn(),B=conn(),C=conn();
tx(A,{t:'create',name:'Alice<script>'});const ja=lastOf(A,'joined');assert(ja&&/^[A-HJ-NP-Z2-9]{6}$/.test(ja.code),'6桁コード');
assert.strictEqual(lastOf(A,'room').players[0].name,'Alicescript','名前のサニタイズ');
tx(B,{t:'join',code:'ZZZZZZ',name:'Bob'});assert.strictEqual(lastOf(B,'err').c,'no_room');
tx(B,{t:'join',code:ja.code.toLowerCase(),name:'Bob'});const jb=lastOf(B,'joined');assert(jb);
tx(C,{t:'join',code:ja.code,name:'Carol'});assert.strictEqual(lastOf(C,'err').c,'full','満員');
let room=lastOf(A,'room');assert.strictEqual(room.players.length,2);assert(room.players[0].host);
tx(B,{t:'start'});assert(!ofType(B,'start').length,'非ホストは開始できない');
tx(A,{t:'start'});assert.strictEqual(lastOf(A,'err').c,'nope','準備前は開始できない');
tx(A,{t:'mode',mode:'brawl'});assert.strictEqual(lastOf(A,'err').c,'nope','BRAWLはフェーズ1では無効');
tx(B,{t:'ready',v:true});tx(A,{t:'start'});
assert(lastOf(A,'start')&&lastOf(B,'start'),'両者にstart');console.log('OK  ルーム作成/参加/無効コード/満員/ホスト権限/準備/開始');

// --- 不正入力・チャット ---
const cheat={t:'in',mx:1e9,mz:NaN,g:99,p:['R_STRAIGHT','L_JAB'],d:[5,'x'],sw:7,dk:1,dmg:9999,hp:9999,st:9999};
tx(A,cheat);const m=S.rooms.get(ja.code).match,sA=m.inp.get(ja.id);
assert.strictEqual(sA.mx,1);assert.strictEqual(sA.mz,0);assert.strictEqual(sA.g,0);assert.strictEqual(sA.one.L,null,'手の違うパンチ指定は無効');assert.strictEqual(sA.one.R,null);
assert.strictEqual(m.by.get(ja.id).hp,m.by.get(ja.id).hpMax,'クライアントからHPは変更できない');
tx(A,{t:'in',p:{__proto__:1},d:'x'});tx(A,{t:'pick',i:-5});tx(A,{t:'in',p:['constructor','toString']});
tx(A,{t:'chat',text:'<b>hi</b>\u0000 '+'あ'.repeat(200)});const ch=lastOf(B,'chat');assert(!/[<>\u0000]/.test(ch.text)&&ch.text.length<=80,'チャット無害化・長さ制限');
tx(A,{t:'chat',text:'1'});tx(A,{t:'chat',text:'2'});tx(A,{t:'chat',text:'3'});assert.strictEqual(lastOf(A,'err').c,'rate','チャット連投制限');
console.log('OK  不正入力の無害化 / HP改ざん不可 / チャット無害化・文字数・連投制限');

// --- 1試合：3ポイント先取＋進化 ---
let steps=0,hitsA=0,hitsB=0,evos=0,snapChecked=false;const ids=['L_JAB','R_STRAIGHT','R_HOOK','L_HOOK','R_UPPER','L_BODY'];
while(!lastOf(A,'end')&&steps++<60*60*8){
  const mt=S.rooms.get(ja.code)&&S.rooms.get(ja.code).match;
  if(mt&&mt.state==='fight'&&steps%2===0){const id=ids[(steps/30|0)%ids.length],go=steps%30===0;   // 0.5秒に1発（スタミナ切れを避ける現実的なペース）
    tx(A,{t:'in',s:steps,mx:0,mz:1,g:0,p:[go&&id[0]==='L'?id:null,go&&id[0]==='R'?id:null],d:0,sw:0,dk:0});tx(B,{t:'in',mx:0,mz:0,g:0,p:[null,null],d:0,sw:0,dk:0})}
  tick();
  for(const w of[A,B]){const o=ofType(w,'offers').slice(-1)[0];if(o&&w.po!==o){w.po=o;   // 新しい選択肢が届いたら選ぶ（不正な番号を先に送ってもサーバーは無視する）
    assert.strictEqual(o.o.length,3);tx(w,{t:'pick',i:9});tx(w,{t:'pick',i:0})}}
  const p=lastOf(A,'picks');if(p&&p!==A.lp){A.lp=p;evos++}
  if(!snapChecked&&lastOf(A,'snap')){const s=lastOf(A,'snap');assert(s.ts&&s.m.s&&s.f.length===2&&s.f[0].h.length===2&&s.f[0].tg);snapChecked=true}}
const end=lastOf(A,'end');assert(end&&end.winner===ja.id,'Aの勝利（3ポイント先取）');assert.strictEqual(end.score[ja.id],3);assert.strictEqual(end.reason,'points');
for(const w of[A,B])for(const e of ofType(w,'ev'))for(const x of e.e)if(x.type==='hit'){assert(x.dmg>0&&x.dmg<=40);x.att===ja.id?hitsA++:hitsB++}
assert(hitsA>=3&&hitsB===0,'命中イベントはAのみ（Bは入力なし）');assert(evos>=2,'進化が各ポイント後に同期された: '+evos);
const pk=lastOf(A,'picks').picks;assert(pk[ja.id].length>=2&&pk[jb.id].length>=2);assert.deepStrictEqual(lastOf(A,'picks'),lastOf(B,'picks'),'全員に同じ進化内容');
const rm=S.rooms.get(ja.code);assert.strictEqual(rm.state,'lobby');assert(!rm.match);assert(rm.active().every(p=>!p.ready),'試合後はロビーに戻り準備解除');
console.log(`OK  DUEL1試合: 3ポイント先取で勝敗確定 / 命中イベント${hitsA}件 / 進化${evos}回同期 / 試合後ロビー復帰`);

// --- 切断→復帰（猶予内） ---
tx(B,{t:'ready',v:true});tx(A,{t:'start'});tick(60);
B.close();assert.strictEqual(lastOf(A,'room').players.find(p=>p.id===jb.id).connected,false,'切断が通知される');tick(120);
assert(S.rooms.get(ja.code).match,'DUELは猶予中、試合継続');
const B2=conn();tx(B2,{t:'rejoin',code:ja.code,token:jb.token});assert(lastOf(B2,'joined')&&lastOf(B2,'start'),'復帰時に試合状態を再送');
assert.strictEqual(lastOf(A,'room').players.find(p=>p.id===jb.id).connected,true);
const B3=conn();tx(B3,{t:'rejoin',code:ja.code,token:'bad'});assert.strictEqual(lastOf(B3,'err').c,'no_session','不正トークンは拒否');
const B4=conn();tx(B4,{t:'rejoin',code:ja.code,token:jb.token});assert.strictEqual(B2.readyState,3,'二重参加は後勝ち（旧接続を閉じる）');
console.log('OK  切断通知 / 猶予内の復帰 / 不正トークン拒否 / 二重参加');

// --- 試合中の退出：不戦勝、ロビー復帰、ホスト引き継ぎ ---
tx(B4,{t:'leave'});const e2=lastOf(A,'end');assert(e2&&e2.reason==='forfeit'&&e2.winner===ja.id,'退出で相手が不戦勝');
assert.strictEqual(S.rooms.get(ja.code).state,'lobby');assert.strictEqual(lastOf(A,'room').players.length,1);
const D=conn();tx(D,{t:'join',code:ja.code,name:'Dan'});assert(lastOf(D,'joined'),'試合後に再参加できる');
tx(A,{t:'leave'});assert.strictEqual(S.rooms.get(ja.code).hostId,jb.id===null?null:lastOf(D,'room').players[0].id,'ホスト退出で次の人がホスト');
// 猶予切れの掃除
D.close();for(const p of S.rooms.get(ja.code).players.values())p.dcAt=Date.now()-60000;S.janitor();assert(!S.rooms.has(ja.code),'無人ルームは削除');
console.log('OK  試合中の退出=不戦勝 / ホスト引き継ぎ / 猶予切れ・無人ルームの掃除');
