'use strict';
// オンラインの新機能（ラウンド数の共有・チュートリアルと接続の両立・オンラインのポーズ・勝敗ムービー・カメラ連動）を、
// 実サーバーのロジック（モックWebSocket）とクライアント（偽DOM）を直接つないで検証する。
const assert=require('assert'),Module=require('module'),EventEmitter=require('events');
const {makeCtx,run,fire}=require('./fakedom.js');
const orig=Module._load;Module._load=function(r,...a){return r==='ws'?{WebSocketServer:class{}}:orig.call(this,r,...a)};
const S=require('../server.js');Module._load=orig;
class FW extends EventEmitter{constructor(){super();this.readyState=1;this.out=[];this.fed=0}send(s){this.out.push(JSON.parse(s))}ping(){}terminate(){}close(){if(this.readyState===1){this.readyState=3;this.emit('close')}}}
const sconn=()=>{const w=new FW();S.handleConnection(w);return w},tx=(w,m)=>{w.cntT=0;w.emit('message',Buffer.from(JSON.stringify(m)))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// クライアント1つ＝偽DOM＋サーバー側の接続1つ。クライアントの送信→サーバー、サーバーの出力→クライアントへ受け渡す
function client(name){const ctx=makeCtx(),on=ctx.online,E=ctx.__els,w=sconn();let sent=[];
  on.ws={readyState:1,send:s=>{const m=JSON.parse(s);sent.push(m);tx(w,m)},close(){}};on.active=true;on.g.state='online';
  const pump=()=>{while(w.fed<w.out.length){const m=w.out[w.fed++];on.on(JSON.parse(JSON.stringify(m)))}};
  return{ctx,on,E,w,name,sent:()=>sent,pump,UI:run(ctx,'UI'),Tut:run(ctx,'Tut'),NET:run(ctx,'NET'),Settings:run(ctx,'Settings')}}
let sw=0;const tick=(n=1)=>{for(let i=0;i<n;i++){S.tickAll(1/60);if(++sw%3===0)S.snapAll()}};

(async()=>{
/* ===== 1. ロビーのラウンド数：ホスト設定が全員に共有・入力検証 ===== */
{const H=client('host'),G=client('guest');tx(H.w,{t:'create',name:'Host'});H.pump();const code=H.w.out[0].code;tx(G.w,{t:'join',code,name:'Guest'});H.pump();G.pump();
 assert(!H.E.lobby.classList.contains('off')&&!G.E.lobby.classList.contains('off'),'両者ロビー表示');
 const btns=el=>el.children.find(c=>c.className&&c.className.includes('seg')).children;
 const hb=btns(H.E.lrounds),gb=btns(G.E.lrounds);assert(hb.every(b=>!b.disabled)&&gb.every(b=>b.disabled),'ホストだけが設定できる');
 assert.strictEqual(hb.filter(b=>b.className==='on').length,1);assert.strictEqual(hb.find(b=>b.className==='on').textContent,'3','既定は3');
 hb[1].onclick();H.pump();G.pump();assert.strictEqual(H.on.room.rounds,5);assert.strictEqual(G.on.room.rounds,5,'参加者にも共有');
 assert(btns(G.E.lrounds).find(b=>b.className==='on').textContent==='5');assert(G.E.lrounds.children.some(c=>c.textContent&&c.textContent.includes('現在：5')),'非ホストには現在値を表示');
 const row=H.E.lrounds.children.find(c=>c.className==='row'),inp=row.children[0],ok=row.children[1],msg=H.E.lrounds.children[H.E.lrounds.children.length-1];
 for(const bad of['0','00','21','99']){inp.value=bad;inp.oninput();assert(ok.disabled,'不正は決定不可: '+bad);if(+bad!==0||bad==='00')assert(msg.textContent.length>0)}
 inp.value='abc';inp.oninput();assert.strictEqual(inp.value,'','数字以外は入力できない');ok.onclick();H.pump();assert.strictEqual(H.on.room.rounds,5,'不正入力は送信されない');
 inp.value='7';inp.oninput();assert(!ok.disabled);ok.onclick();H.pump();G.pump();assert.strictEqual(G.on.room.rounds,7,'カスタム7が全員へ');
 assert(btns(H.E.lrounds).find(b=>b.className==='on').textContent==='カスタム');
 // 試合開始→スナップショットで両者のHUDが同じラウンド表示
 tx(G.w,{t:'ready',v:true});H.pump();tx(H.w,{t:'start'});H.pump();G.pump();assert.strictEqual(G.on.me&&G.on.me.id,G.on.id);
 const m=S.rooms.get(code).match;assert.strictEqual(m.rounds,7);tick(60*3);H.pump();G.pump();
 for(const c of[H,G]){await sleep(150);for(let i=0;i<3;i++)c.on.frame(.1);assert.strictEqual(c.E.rd.textContent,'ROUND 1 / 7','両者に同じ ROUND 1 / 7: '+c.name)}
 // ラウンドが進むと表示も進み、延長は（延長）と出る
 m.round=8;tick(6);H.pump();await sleep(150);for(let i=0;i<4;i++)H.on.frame(.1);assert.strictEqual(H.E.rd.textContent,'ROUND 8 / 7（延長）');
 console.log('OK  オンラインのラウンド数: ホストのみ設定／3・5・10・カスタム(1〜20検証)／全員に共有／HUDにROUND n / N（延長表示）')}

/* ===== 2. チュートリアル：接続待機中に開けて、接続処理は継続する ===== */
{const c=client('tut'),{on,E,ctx,Tut,NET}=c;on.ws=null;on.active=false;on.open();NET.server='wss://example.invalid';NET.wakeIntervalMs=20;NET.wakeTimeoutMs=3000;
 let wakeOk=false;ctx.fetch=()=>new Promise(r=>setTimeout(()=>r({ok:wakeOk}),10));
 E.oncreate.onclick();await sleep(80);
 E.ontut.onclick();assert(!E.tut.classList.contains('off'),'接続待機画面から遊び方を開ける');assert.strictEqual(E.tutpage.textContent,'1 / 8');
 Tut.status();assert.strictEqual(E.tutstat.style.display,'');assert(/接続|起動/.test(E.tutstat.textContent),'接続状況を表示: '+E.tutstat.textContent);
 const titles=[];for(let i=0;i<8;i++){titles.push(E.tuttitle.textContent);assert.strictEqual(E.tutpage.textContent,`${i+1} / 8`);assert(E.tutvis.innerHTML.length>20&&E.tutbody.innerHTML.length>20,'図とテキストがある');assert.strictEqual(E.tutdots.innerHTML.split('<i').length-1,8);
  if(i<7)E.tutnext.onclick()}
 assert.strictEqual(E.tutnext.textContent,'完了','最終ページ');for(const k of['移動','パンチ','ガード','回避','種類','スタミナ','距離','読み合い'])assert(titles.some(t=>t.includes(k)),'項目: '+k);
 assert(titles[0].includes('WASD')&&titles[1].includes('J / K')&&titles[2].includes('ガード'));
 E.tutprev.onclick();assert.strictEqual(E.tutpage.textContent,'7 / 8');fire(ctx,'keydown',{code:'ArrowLeft'});assert.strictEqual(E.tutpage.textContent,'6 / 8','←→キーでも移動');fire(ctx,'keydown',{code:'ArrowRight'});
 for(let i=0;i<10;i++)E.tutprev.onclick();assert(E.tutprev.disabled&&E.tutpage.textContent==='1 / 8','先頭より前へは行けない');
 // 閲覧中に接続が完了（wake成功→WebSocket→joined）。遊び方は開いたまま、接続状態が保持される
 wakeOk=true;await sleep(120);const ws=ctx.__ws[ctx.__ws.length-1];assert(ws&&ws.url==='wss://example.invalid','遊び方を見ている間も接続処理は続く');assert(!E.tut.classList.contains('off'),'接続しても勝手に閉じない');
 ws.readyState=1;ws.onopen();assert.strictEqual(ws.sent[0].t,'create');
 on.on({t:'joined',id:'u1',token:'t',code:'ABC234',cfg:{stateHz:20}});on.on({t:'room',code:'ABC234',hostId:'u1',mode:'duel',state:'lobby',brawl:true,rounds:3,players:[{id:'u1',name:'me',slot:0,ready:true,connected:true,host:true}]});
 Tut.status();assert(E.tutstat.textContent.includes('接続完了')&&E.tutstat.className.includes('ok'),'接続完了を保持して表示: '+E.tutstat.textContent);
 assert(!E.lobby.classList.contains('off')&&E.onl.classList.contains('off'),'画面遷移（ロビー）は裏で完了している');
 E.tutclose.onclick();assert(E.tut.classList.contains('off'));assert(!E.lobby.classList.contains('off'),'閉じるとそのままロビー（対戦画面）へ');
 // ロビーから開き、試合開始で自動的に閉じる
 E.ltut.onclick();assert(!E.tut.classList.contains('off'));on.on({t:'start',mode:'duel',rounds:3,fs:[{id:'u1',name:'me',slot:0},{id:'u2',name:'x',slot:1}],picks:{},score:{}});assert(E.tut.classList.contains('off'),'試合開始で自動的に閉じる');
 // Escで閉じる／CPUメニューからも開ける
 const d=makeCtx();d.__els.btut.onclick();assert(!d.__els.tut.classList.contains('off'));Tut.status;fire(d,'keydown',{code:'Escape'});assert(d.__els.tut.classList.contains('off'),'Escで閉じる');
 console.log('OK  チュートリアル: 8ページ（図＋説明）／前へ・次へ・ページ表示／接続待機中も接続は継続し完了状態を保持／閉じるとロビー／開始時に自動で閉じる')}

/* ===== 3. オンラインのポーズ（メニューを開いても試合は止まらず、操作のみ無効） ===== */
{const H=client('h'),G=client('g');tx(H.w,{t:'create',name:'H'});H.pump();const code=H.w.out[0].code;tx(G.w,{t:'join',code,name:'G'});H.pump();G.pump();tx(G.w,{t:'ready',v:true});H.pump();tx(H.w,{t:'start'});H.pump();G.pump();tick(60*3);H.pump();await sleep(150);H.on.frame(.1);
 const {on,E,ctx}=H;on.live=true;on.g.inp.down({code:'KeyW'});on.g.inp.down({code:'KeyJ'});
 fire(ctx,'keydown',{code:'KeyP'});assert(on.menuOpen&&!E.pause.classList.contains('off'),'オンラインでもPでメニュー');assert.strictEqual(E.prestart.style.display,'none','やり直しは出さない');assert(E.pnote.textContent.includes('止まりません'),'試合は止まらない旨を表示');
 const sent=H.sent();const n0=sent.length;on.sendInput();const last=sent[sent.length-1];assert.strictEqual(last.t,'in');assert.deepStrictEqual([last.mx,last.mz,last.g,last.p[0],last.p[1],last.dk],[0,0,0,null,null,0],'メニュー中は中立の入力を送る');
 fire(ctx,'keydown',{code:'KeyP'});assert(!on.menuOpen&&E.pause.classList.contains('off'),'もう一度Pで閉じる');
 fire(ctx,'keydown',{code:'KeyP'});E.presume.onclick();assert(!on.menuOpen,'再開ボタン');
 on.offs=[{id:'spd',r:0}];E.evo.classList.remove('off');fire(ctx,'keydown',{code:'KeyP'});assert(!on.menuOpen,'進化選択中はPが無効');E.evo.classList.add('off');on.offs=null;
 E.onres.classList.remove('off');fire(ctx,'keydown',{code:'KeyP'});assert(!on.menuOpen,'結果画面ではPが無効');E.onres.classList.add('off');
 fire(ctx,'keydown',{code:'KeyP'});E.pset.onclick();assert(!E.settings.classList.contains('off'),'メニューから設定を開ける');E.sgclose.onclick();
 E.pquit.onclick();H.pump();assert(H.sent().some(m=>m.t==='leave'),'終了で退出を送る');assert(!E.onl.classList.contains('off')&&!on.menuOpen&&E.pause.classList.contains('off'));
 H.pump();G.pump();assert(G.w.out.some(m=>m.t==='end'&&m.reason==='forfeit'),'相手は不戦勝');
 console.log('OK  オンラインのポーズ: Pでメニュー（試合は継続・自分の操作のみ無効）／進化・結果では無効／設定・退出が使える')}

/* ===== 4. オンラインの勝敗ムービーとカメラ連動 ===== */
for(const mine of['win','lose']){const H=client('h'),G=client('g');tx(H.w,{t:'create',name:'H'});H.pump();const code=H.w.out[0].code;tx(G.w,{t:'join',code,name:'G'});H.pump();G.pump();tx(G.w,{t:'rounds',n:1});tx(H.w,{t:'rounds',n:1});H.pump();G.pump();
 tx(G.w,{t:'ready',v:true});H.pump();tx(H.w,{t:'start'});H.pump();G.pump();const m=S.rooms.get(code).match;tick(60*3);const hid=H.on.id,gid=G.on.id;
 m.F.find(f=>f.id===(mine==='win'?gid:hid)).hp=0;tick(60*3);H.pump();G.pump();await sleep(250);for(let i=0;i<8;i++){H.on.frame(.1);G.on.frame(.1)}
 const c=H,{on,E}=c;assert(on.cineOn,'終了でムービー再生');assert(c.ctx.document.body.classList.contains('cine'),'HUDを隠す');assert(E.onres.classList.contains('off'),'ムービー中は結果画面は出ない');
 const calls=[];const SF=c.ctx.SFX||run(c.ctx,'SFX');assert.strictEqual(on.g.v.cine.kind,mine,'自分の勝敗に応じたムービー: '+mine);assert.strictEqual(on.g.v.cine.W.id,mine==='win'?hid:gid);
 fire(c.ctx,'keydown',{code:'Space'});for(let i=0;i<3;i++)on.frame(.1);assert(!on.cineOn&&!E.onres.classList.contains('off'),'スキップして結果画面へ');assert(!c.ctx.document.body.classList.contains('cine'));
 assert(E.onrt.textContent==='YOU WIN'||E.onrt.textContent==='YOU LOSE');assert.strictEqual(E.onrt.textContent,mine==='win'?'YOU WIN':'YOU LOSE');
 E.onlb.onclick();assert(!E.lobby.classList.contains('off'),'結果→ロビーへ（再戦可能）');
 console.log('OK  オンライン勝敗ムービー['+mine+']: 終了→ムービー→スキップ→結果→ロビー')}
{const H=client('h');H.on.me=null;const v=H.on.g.v,Set=H.Settings;Set.set('cam',true);v.cs=0;
 const hit=(att,tgt,dmg)=>({type:'hit',att,tgt,zone:'頭部',punch:'x',pid:'R_STRAIGHT',speed:6,dmg,blocked:false,tags:[],np:[0,1.5,0]});
 H.on.id='me';H.on.fx={me:{},o:{}};H.on.ev(hit('o','me',15));assert(v.cs>.05,'被弾のカメラ演出（オンライン）');v.cs=0;H.on.ev(hit('me','o',15));assert(v.cs>0,'命中のカメラ演出（オンライン）');
 Set.set('cam',false);v.cs=0;H.on.ev(hit('o','me',15));H.on.ev(hit('me','o',15));assert.strictEqual(v.cs,0,'OFFならオンラインでも無効');
 console.log('OK  オンラインのカメラ演出: 命中・被弾に連動、OFFで無効')}
process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
