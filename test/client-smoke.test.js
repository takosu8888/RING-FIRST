'use strict';
// index.html のスモークテスト（ブラウザ無し）。偽DOM＋偽THREEの上でスクリプトを実行し、
//  (1) CPU戦の一連の流れ  (2) 実サーバーの出力をオンライン側へ流し込んだ挙動  (3) 接続失敗/再接続の表示 を確認する。
// ※WebGLの実描画・実ブラウザでの見た目はこのテストでは検証できません。
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert'),Module=require('module'),EventEmitter=require('events');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),coreSrc=fs.readFileSync(path.join(root,'game-core.js'),'utf8');
assert(html.indexOf('three.min.js')<html.indexOf('src="game-core.js"')&&html.indexOf('src="game-core.js"')<html.lastIndexOf('<script>'),'読み込み順: THREE → game-core.js → 本体');
const stub=(()=>{const f=function(){};const p=new Proxy(f,{get:(t,k)=>k===Symbol.toPrimitive?()=>0:(k==='length'?0:p),set:()=>true,apply:()=>p,construct:()=>p,has:()=>true});return p})();
class El{constructor(id,cls){this.id=id;this.cl=new Set((cls||'').split(/\s+/).filter(Boolean));this.style={};this.children=[];this._t='';this.innerHTML='';this.value='';this.scrollTop=0;this.scrollHeight=0;this.clientHeight=0;this.L={};this.onclick=null;
 this.classList={add:(...c)=>c.forEach(x=>this.cl.add(x)),remove:(...c)=>c.forEach(x=>this.cl.delete(x)),contains:c=>this.cl.has(c),toggle:(c,on)=>{const w=on===undefined?!this.cl.has(c):!!on;w?this.cl.add(c):this.cl.delete(c);return w}}}
 get textContent(){return this._t}set textContent(v){this._t=String(v);this.children=[]}
 appendChild(c){this.children.push(c);return c}removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1)}get firstChild(){return this.children[0]}
 remove(){}querySelectorAll(){return[]}addEventListener(t,f){(this.L[t]=this.L[t]||[]).push(f)}focus(){}blur(){}select(){}getContext(){return stub}closest(){return null}
 set className(v){this.cl=new Set(String(v).split(/\s+/).filter(Boolean))}get className(){return[...this.cl].join(' ')}}
function makeCtx(){
 const els={};for(const m of html.matchAll(/<[a-z0-9]+\b[^>]*\bid="([^"]+)"[^>]*>/gi)){const c=/class="([^"]*)"/.exec(m[0]);els[m[1]]=new El(m[1],c?c[1]:'')}
 const doc={getElementById:id=>els[id]||(els[id]=new El(id)),createElement:()=>new El(''),addEventListener(){},body:{appendChild(){},insertAdjacentHTML(){}},hidden:false};
 const store=()=>{const s={};return{getItem:k=>(k in s?s[k]:null),setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]}}};
 class FakeWS{constructor(u){this.url=u;this.readyState=0;this.sent=[];ctx.__ws.push(this)}send(s){this.sent.push(JSON.parse(s))}close(){this.readyState=3}}
 const ctx={THREE:stub,document:doc,console,Math,Date,JSON,Object,Array,Set,Map,Promise,Number,String,Symbol,RegExp,Error,URLSearchParams,AbortController,
  setTimeout,clearTimeout,setInterval,clearInterval,performance,innerWidth:1280,innerHeight:720,devicePixelRatio:1,
  requestAnimationFrame(){},addEventListener(){},location:{search:''},sessionStorage:store(),localStorage:store(),navigator:{},
  fetch:()=>Promise.reject(new Error('offline')),WebSocket:FakeWS,__ws:[],__els:els};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(coreSrc,ctx);
 const a=html.lastIndexOf('<script>\n"use strict"');vm.runInContext(html.slice(a+8,html.lastIndexOf('</script>')),ctx);return ctx}
const run=(ctx,code)=>vm.runInContext(code,ctx);

(async()=>{
 /* ---- (1) CPU戦：既存の流れが壊れていない ---- */
 let ctx=makeCtx(),g=ctx.game;assert(g&&ctx.online,'ゲームとオンライン機能が初期化される');
 assert.strictEqual(g.state,'menu');g.newMatch();assert.strictEqual(g.state,'ready');
 for(let i=0;i<260;i++)g.step(1/120);assert.strictEqual(g.state,'fight');
 let seed=7;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296;
 for(let i=0;i<120*45&&g.state==='fight';i++){if(i%30===0){g.inp.down({code:'KeyW'});g.inp.up({code:'KeyW'});}
  if(i%40===0)g.inp.down({code:rnd()<.5?'KeyJ':'KeyK'});if(i%200===0){g.inp.down({code:'KeyE'})}if(i%200===60)g.inp.up({code:'KeyE'});g.step(1/120)}
 g.frame(performance.now()+16);
 assert(g.P.hp<100||g.C.hp<100,'CPU戦で命中が発生');assert(ctx.__els.log.children.length>0,'左下ログが描画される');
 g.C.hp=0;for(let i=0;i<12&&g.state==='fight';i++)g.step(1/120);assert.strictEqual(g.state,'pointEnd');
 for(let i=0;i<120*2.2;i++)g.step(1/120);assert.strictEqual(g.state,'evolve');assert(!ctx.__els.evo.classList.contains('off'));
 g.choose(0);assert.strictEqual(g.state,'ready');assert.strictEqual(g.P.picks.length,1);assert.strictEqual(g.C.picks.length,1);
 g.choose(0);assert.strictEqual(g.P.picks.length,1,'進化の二重処理が起きない');
 for(let r=0;r<4&&g.state!=='end';r++){for(let i=0;i<400&&g.state!=='fight';i++)g.step(1/120);if(g.state==='fight'){g.C.hp=0;for(let i=0;i<300&&g.state!=='end'&&g.state!=='evolve';i++)g.step(1/120);if(g.state==='evolve')g.choose(1)}}
 assert.strictEqual(g.state,'end');assert.strictEqual(ctx.__els.res.textContent,'YOU WIN');assert.strictEqual(g.score.p,3);
 g.newMatch();assert.strictEqual(g.P.picks.length,0,'試合ごとに能力リセット');assert.deepStrictEqual({...g.score},{p:0,c:0});
 console.log('OK  CPU戦: 開始→戦闘→ポイント→進化(二重処理なし)→3ポイントで勝利→再戦で能力リセット');

 /* ---- (2) 実サーバーのメッセージをオンライン側へ流し込む ---- */
 const orig=Module._load;Module._load=function(r,...a){return r==='ws'?{WebSocketServer:class{}}:orig.call(this,r,...a)};
 const S=require('../server.js');Module._load=orig;
 class FW extends EventEmitter{constructor(){super();this.readyState=1;this.out=[]}send(s){this.out.push(JSON.parse(s))}ping(){}terminate(){}close(){}}
 const conn=()=>{const w=new FW();S.handleConnection(w);return w},tx=(w,m)=>{w.cntT=0;w.emit('message',Buffer.from(JSON.stringify(m)))};
 const A=conn(),B=conn();tx(A,{t:'create',name:'Alice'});const code=A.out[0].code;tx(B,{t:'join',code,name:'Bob'});tx(B,{t:'ready',v:true});tx(A,{t:'start'});
 const m=S.rooms.get(code).match,fb=m.F[1];let n=0;
 for(let i=0;i<60*6;i++){if(m.state==='fight'&&i%2===0)tx(A,{t:'in',mx:0,mz:1,g:0,p:[i%40===0?'L_JAB':null,i%70===0?'R_STRAIGHT':null],d:0,sw:0,dk:0});S.tickAll(1/60);if(++n%3===0)S.snapAll()}
 tx(B,{t:'chat',text:'こんにちは<b>'});fb.hp=0;for(let i=0;i<60*3;i++){S.tickAll(1/60);if(++n%3===0)S.snapAll()}
 tx(A,{t:'pick',i:0});tx(B,{t:'pick',i:1});for(let i=0;i<30;i++){S.tickAll(1/60);if(++n%3===0)S.snapAll()}
 assert(A.out.some(x=>x.t==='offers')&&A.out.some(x=>x.t==='picks')&&A.out.some(x=>x.t==='ev'),'サーバーが offers/picks/ev を出した');
 ctx=makeCtx();const on=ctx.online,E=ctx.__els;on.open();assert(!E.onl.classList.contains('off'));
 let sawOffers=false,sawPicks=false,startOk=false,frames=0;
 for(const msg of JSON.parse(JSON.stringify(A.out))){on.on(msg);
  if(msg.t==='joined')assert(!E.onl.classList.contains('off')===false,'参加でオンラインメニューが閉じる');
  if(msg.t==='room'&&!on.me)assert(!E.lobby.classList.contains('off'),'ロビー表示');
  if(msg.t==='start'){startOk=on.me&&on.order.length===2&&on.me.id===msg.fs[0].id;assert(startOk);assert(E.lobby.classList.contains('off'))}
  if(msg.t==='snap'){on.frame(1/60);frames++}
  if(msg.t==='offers'){sawOffers=true;assert(!E.evo.classList.contains('off'));assert(E.cards.innerHTML.includes('data-i="2"'),'3枚のカード')}
  if(msg.t==='picks'){sawPicks=true;assert(E.evo.classList.contains('off'));assert(on.me.picks.length>=1,'進化が全員に反映')}}
 assert(startOk&&sawOffers&&sawPicks&&frames>10,'start/offers/picks/snap を処理');
 assert(Math.abs(on.me.p.z)>1&&Number.isFinite(on.me.hp),'スナップショットが補間されてFighterに反映');
 assert(on.me.hp>0&&on.order[1].picks.length>=1,'相手の進化内容も保持');
 const bobId=A.out.find(x=>x.t==='chat'&&x.id!=='sys').id;assert(on.bub[bobId],'発言者の頭上吹き出しが作られる');
 assert(E.clog.children.length>=2&&!/[<>]/.test(E.clog.children[E.clog.children.length-1].children[1]._t),'チャットログと吹き出しは同じメッセージ');
 console.log(`OK  オンライン受信: start/snap(${frames}回)/ev/offers/picks/chat をクライアントが処理（補間・進化・ログ・吹き出し）`);
 // 入力送信：ダブルタップのダッシュとパンチ種別
 const sent=[];on.ws={readyState:1,send:s=>sent.push(JSON.parse(s))};on.live=true;
 on.g.inp.down({code:'KeyW'});on.g.inp.up({code:'KeyW'});on.g.inp.down({code:'KeyW'});on.g.inp.up({code:'KeyW'});on.g.inp.down({code:'KeyA'});on.g.inp.down({code:'KeyJ'});on.g.inp.down({code:'KeyE'});on.g.inp.down({code:'KeyQ'});on.sendInput();
 const s0=sent[0];assert.strictEqual(s0.t,'in');assert.deepStrictEqual(s0.d,[0,1],'WWでダッシュ');assert.strictEqual(s0.p[0],'L_HOOK','J+A=左フック');assert.strictEqual(s0.g,2);assert.strictEqual(s0.sw,-1);
 on.sendInput();assert.strictEqual(sent[1].d,0,'一度送った入力は繰り返し送られない');
 // 終了表示
 const endMsg=A.out.find(x=>x.t==='end')||{t:'end',winner:on.id,score:{},names:{},reason:'points'};on.on(endMsg);assert(!E.onres.classList.contains('off'));
 E.onlb.onclick();assert(!E.lobby.classList.contains('off')&&on.me===null,'ロビーへ戻れる');
 console.log('OK  入力送信（ダッシュ/パンチ種別/ガード/スウェー）・結果画面・ロビー復帰');

 /* ---- (3) 接続の表示（Render起動待ち／失敗／再接続） ---- */
 ctx=makeCtx();const o3=ctx.online,E3=ctx.__els,NET=run(ctx,'NET');o3.open();E3.oncreate.onclick();await new Promise(r=>setTimeout(r,20));
 assert(E3.onmsg.textContent.includes('サーバーURLが未設定'),'URL未設定の案内');
 NET.server='wss://example.invalid';NET.wakeTimeoutMs=80;NET.wakeIntervalMs=15;E3.oncreate.onclick();await new Promise(r=>setTimeout(r,250));
 assert(E3.onmsg.textContent.includes('サーバーに接続できませんでした')&&E3.onmsg.textContent.includes('Render'),'接続失敗の案内: '+E3.onmsg.textContent);
 let seen='';const oldMsg=o3.msg.bind(o3);o3.msg=t=>{seen+=t+'|';oldMsg(t)};
 ctx.fetch=()=>new Promise(r=>setTimeout(()=>r({ok:false}),5));NET.wakeTimeoutMs=120;E3.oncreate.onclick();await new Promise(r=>setTimeout(r,300));
 assert(seen.includes('起動しています'),'起動待ちの説明を表示（Render無料枠）');
 ctx.fetch=()=>Promise.resolve({ok:true});NET.wakeTimeoutMs=2000;E3.oncode.value='abc123';E3.onname.value='Tester<x>';E3.oncreate.onclick();await new Promise(r=>setTimeout(r,60));
 const ws=ctx.__ws[ctx.__ws.length-1];assert(ws&&ws.url==='wss://example.invalid');ws.readyState=1;ws.onopen();assert.strictEqual(ws.sent[0].t,'create');assert.strictEqual(ws.sent[0].name,'Testerx','名前のサニタイズ');
 o3.on({t:'joined',id:'u9',token:'tok',code:'ABC234',cfg:{stateHz:20}});assert(o3.sess&&o3.sess.token==='tok');assert.strictEqual(o3.interp,100);
 ws.readyState=3;ws.onclose();assert(E3.onstat.textContent.includes('再接続しています')&&E3.onstat.textContent.includes('1/8'),'再接続の表示');
 await new Promise(r=>setTimeout(r,1500));const ws2=ctx.__ws[ctx.__ws.length-1];assert(ws2!==ws,'自動で再接続を試みる');ws2.readyState=1;ws2.onopen();
 assert.deepStrictEqual(ws2.sent[0],{t:'rejoin',code:'ABC234',token:'tok'},'セッションで復帰要求');
 o3.on({t:'err',c:'no_session',m:'x'});assert(!E3.onl.classList.contains('off')&&E3.onmsg.textContent.includes('復帰できませんでした'),'復帰不能時は分かりやすく案内');
 console.log('OK  接続: URL未設定/失敗/起動待ち/切断→自動再接続→復帰要求/復帰不能の表示');

 /* ---- (4) 乱闘：最初に脱落した人の視点でサーバー出力を流し込む（名簿・名札・標的・観戦・順位） ---- */
 const wsl=[],nm4=['A1','A2','A3','A4'];const a1=conn();tx(a1,{t:'create',name:'A1'});const code4=a1.out[0].code;wsl.push(a1);
 for(let i=1;i<4;i++){const w=conn();tx(w,{t:'join',code:code4,name:nm4[i]});wsl.push(w)}
 for(const w of wsl.slice(1))tx(w,{t:'ready',v:true});tx(a1,{t:'start'});const mb=S.rooms.get(code4).match;assert.strictEqual(mb.mode,'brawl');
 const IDS=['L_JAB','R_STRAIGHT','R_HOOK','L_HOOK'];let st=0;
 while(!wsl[0].out.some(x=>x.t==='end')&&st++<60*60*6){
  if(mb.state==='fight')for(const [i,f] of mb.F.entries()){const id=IDS[((st/30|0)+i)%4],go=(st+i*7)%30===0;mb.input(f.id,{mx:.5,mz:1,g:0,p:[go&&id[0]==='L'?id:null,go&&id[0]==='R'?id:null],d:0,sw:0,dk:0})}
  S.tickAll(1/60);if(++n%3===0)S.snapAll();
  for(const w of wsl){const o=w.out.filter(x=>x.t==='offers').slice(-1)[0];if(o&&w.po!==o){w.po=o;tx(w,{t:'pick',i:0})}}}
 assert(wsl[0].out.some(x=>x.t==='end'),'乱闘が終了した');
 const firstKo=wsl[0].out.filter(x=>x.t==='ev').flatMap(x=>x.e).find(x=>x.type==='ko').id,specWs=wsl.find(w=>w.out[0].id===firstKo);
 ctx=makeCtx();const o4=ctx.online,E4=ctx.__els,UI4=run(ctx,'UI'),toasts=[];const ot=UI4.toast;UI4.toast=(t,ms)=>{toasts.push(t);ot.call(UI4,t,ms)};
 o4.open();let sawSpec=false,sawPov=false,sawRoster=false,sawTarget=false;
 for(const msg of JSON.parse(JSON.stringify(specWs.out))){o4.on(msg);
  if(msg.t==='start'){assert.strictEqual(o4.mode,'brawl');assert.strictEqual(Object.keys(o4.rows).length,3,'名簿は自分以外の3人');
   assert(!E4.roster.classList.contains('off')&&E4.sider.classList.contains('off')&&!E4.tgtlbl.classList.contains('off'),'4人用HUDに切替');sawRoster=true}
  if(msg.t==='snap'){o4.frame(.25);
   if(o4.me.hp>0&&E4.tgtlbl.textContent.startsWith('▶ '))sawTarget=true;
   if(o4.spec&&!sawSpec){sawSpec=true;assert.strictEqual(ctx.game.v.spec,'orbit','脱落後は俯瞰の観戦カメラ');o4.frame(.01);assert(E4.tgtlbl.textContent.includes('観戦中'),'観戦中の案内表示');
    const alive=o4.order.filter(f=>f!==o4.me&&f.hp>0);if(alive.length){o4.cycleSpec();const sv=ctx.game.v.spec;sawPov=typeof sv==='object'&&sv!==o4.me&&sv.hp>0;o4.cycleSpec();o4.cycleSpec();o4.cycleSpec();o4.specI=0;o4.applySpec()}}}}
 assert(sawRoster&&sawTarget,'標的表示が出る');assert(sawSpec,'脱落後に観戦へ移行する');assert(sawPov,'Tabで生存者の視点へ切替できる');
 assert(toasts.some(t=>t.includes('を倒した')||t.includes('脱落')),'脱落の通知: '+toasts.join('|'));
 const rt=E4.onrs.textContent.split('\n');assert(rt.length>=4&&rt[0].startsWith('1位'),'順位表示: '+E4.onrs.textContent);assert(!E4.onres.classList.contains('off'));
 assert(/位|YOU/.test(E4.onrt.textContent));
 E4.onlb.onclick();assert(E4.roster.classList.contains('off')&&!E4.sider.classList.contains('off')&&ctx.game.v.spec===null,'ロビーへ戻るとHUD・視点が元に戻る');
 console.log('OK  乱闘クライアント: 名簿/標的表示/脱落通知/観戦(俯瞰→Tabで生存者視点)/順位表示/HUD復元');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
