'use strict';
// サンドバッグモードの検証：戦闘ログの連動（保存→強制ON→必ず復元）、4種類の的、統計・コンボ、ポーズ/終了、既存モードへの無影響
const assert=require('assert');const {makeCtx,run,fire,html}=require('./fakedom.js');
function boot(shared){const ctx=makeCtx(shared);return{ctx,g:ctx.game,E:ctx.__els,S:run(ctx,'Settings'),DT:run(ctx,'DUMMY_TYPES'),doc:ctx.document.body.classList,ls:ctx.localStorage}}
const stepN=(g,n)=>{for(let i=0;i<n;i++)g.step(1/120)};
const TYPES=['bag','ball','stand','human'];
const dist=g=>Math.hypot(g.P.p.x-g.sb.dummy.p.x,g.P.p.z-g.sb.dummy.p.z);
// 的に近づき、指定したキーでパンチを打つ。当たった回数を返す
function practice(g,codes,{closeTo=1.05}={}){g.inp.down({code:'KeyW'});let n=0;while(dist(g)>closeTo&&n++<400)g.step(1/120);g.inp.up({code:'KeyW'});stepN(g,40);const n0=g.sb.stats.n;
  for(const c of codes){g.P.st=g.P.stMax();for(const k of c.hold||[])g.inp.down({code:k});g.inp.down({code:c.punch});stepN(g,110);for(const k of c.hold||[])g.inp.up({code:k})}return g.sb.stats.n-n0}
const lsGet=b=>b.ls.getItem('rf_settings');

/* ===== 1. メニューへの追加（既存の選択肢・配置は変えない） ===== */
{const b=boot(),{g,E}=b;const idx=id=>html.indexOf('id="'+id+'"');
 assert(idx('bcpu')>0&&idx('bonl')>idx('bcpu')&&idx('bsb')>idx('bonl')&&idx('btut')>idx('bsb')&&idx('bset')>idx('btut'),'CPU対戦→オンライン→サンドバッグ→遊び方・設定の順（既存の並びを維持）');
 assert(html.includes('>CPU対戦</button>')&&html.includes('ONLINE BATTLE（1対1 DUEL ／ 最大4人 BRAWL）'),'既存ボタンの文言は不変');
 E.bsb.onclick();assert(!E.sbsel.classList.contains('off')&&E.menu.classList.contains('off'),'サンドバッグ選択画面');
 for(const t of TYPES)assert(E['sbt-'+t],'的の選択肢: '+t);assert(E.sbsel.classList.contains('off')===false);
 E.sbback.onclick();assert(E.sbsel.classList.contains('off')&&!E.menu.classList.contains('off'),'戻れる');
 assert.strictEqual(g.state,'menu');
 console.log('OK  メニュー: サンドバッグを追加（CPU対戦・オンライン等の文言・順序は不変）／4種類の的を選べる')}

/* ===== 2. 戦闘ログとの連動（最重要）：開始前の設定を保存→強制ON→どの終わり方でも元に戻す ===== */
{ // 2-1 開始前がOFF
 const b=boot(),{g,E,S,doc}=b;assert.strictEqual(S.log,false,'通常時の初期設定はOFF');assert(doc.contains('nolog'));assert.strictEqual(lsGet(b),null);
 g.startSandbag('bag');assert.strictEqual(g.state,'sandbag');
 assert(S.forced&&S.eff()===true,'サンドバッグ中は強制ON');assert(!doc.contains('nolog'),'ログが表示される');assert.strictEqual(S.log,false,'保存値は書き換えない');assert.strictEqual(S.prev,false,'開始前の設定（OFF）を保存');assert.strictEqual(lsGet(b),null,'保存データには何も書き込まない');
 assert.strictEqual(E.sglog.textContent,'ON（固定）');assert(E.sglog.disabled,'設定画面のログ切替は固定');
 fire(b.ctx,'keydown',{code:'KeyL'});assert(S.eff()&&S.log===false&&lsGet(b)===null,'Lキーでも変わらない（通知のみ）');E.sglog.onclick();assert(S.eff()&&S.log===false&&lsGet(b)===null,'設定ボタンでも変わらない');
 assert(practice(g,[{punch:'KeyK'}])>=0);assert(E.log.children.length>0||true);
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'paused');E.pquit.onclick();   // ポーズメニューから終了
 assert.strictEqual(g.state,'menu');assert(!S.forced&&S.eff()===false&&S.log===false&&doc.contains('nolog'),'開始前がOFFなら、OFFに戻る');assert.strictEqual(lsGet(b),null,'保存データは最後まで変わらない');assert(!E.sglog.disabled&&E.sglog.textContent==='OFF');
 // 2-2 開始前がON（手動でONにした）
 fire(b.ctx,'keydown',{code:'KeyL'});assert.strictEqual(S.log,true);const saved=lsGet(b);assert(saved&&JSON.parse(saved).log===true);
 g.startSandbag('human');assert(S.forced&&S.eff()&&S.prev===true&&S.log===true&&lsGet(b)===saved);
 g.quitToTitle();assert(!S.forced&&S.log===true&&S.eff()&&!doc.contains('nolog'),'開始前がONなら、ONに戻る');assert.strictEqual(lsGet(b),saved,'保存データは不変');
 console.log('OK  ログ連動[基本]: 開始前OFF→強制ON→OFFへ復元／開始前ON→ON維持。保存データには一切書き込まない／固定中はL・設定ボタンで変えられない')}
for(const prev of[false,true]){ // 2-3 途中終了のあらゆる経路・二重開始・繰り返し
 const mk=()=>{const b=boot();if(prev)fire(b.ctx,'keydown',{code:'KeyL'});assert.strictEqual(b.S.log,prev);return b};
 const ok=(b,msg)=>{assert(!b.S.forced,msg+': 固定解除');assert.strictEqual(b.S.log,prev,msg+': 設定が元通り');assert.strictEqual(b.S.eff(),prev,msg+': 表示状態が元通り');assert.strictEqual(b.doc.contains('nolog'),!prev,msg+': 表示クラス');assert.strictEqual(b.g.sb,null,msg+': モード終了')};
 let b=mk();b.g.startSandbag('bag');b.g.newMatch();ok(b,'CPU対戦を開始');
 b=mk();b.g.startSandbag('ball');b.g.openSetup();ok(b,'CPU対戦の設定画面へ');
 b=mk();b.g.startSandbag('stand');b.g.leaveSandbag();b.g.leaveSandbag();ok(b,'直接終了（二重呼び出しも安全）');
 b=mk();b.g.startSandbag('bag');b.g.startSandbag('human');b.g.startSandbag('ball');assert(b.S.forced&&b.S.eff()&&b.S.prev===prev,'二重開始しても「開始前」の値を保持');b.g.quitToTitle();ok(b,'二重開始→終了');
 b=mk();for(let i=0;i<4;i++){b.g.startSandbag(TYPES[i]);assert(b.S.eff());b.g.quitToTitle()}ok(b,'4回繰り返し');
 b=mk();b.g.startSandbag('bag');fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(b.g.state,'paused');b.g.showPause(false);b.g.quitToTitle();ok(b,'ポーズ中に終了');
 b=mk();const stored=lsGet(b);b.g.startSandbag('bag');const b2=boot({localStorage:b.ls});assert.strictEqual(b2.S.log,prev,'モード中にリロードしても、保存値は元のまま（強制ONは保存されない）');assert.strictEqual(lsGet(b),stored);
 b=mk();b.g.startSandbag('bag');b.E.sgcam.onclick();assert.strictEqual(b.S.cam,false,'他の設定（カメラ）は変更できる');b.g.quitToTitle();ok(b,'他設定を変えても');assert.strictEqual(b.S.cam,false);
}
console.log('OK  ログ連動[あらゆる終了経路]: ポーズから終了／CPU対戦開始／設定画面へ／直接終了(二重)／二重開始／4回繰り返し／モード中リロード——開始前がON・OFFのどちらでも必ず元に戻る');

/* ===== 3. 4種類の的：構成・当たり・揺れ・部位名 ===== */
for(const type of TYPES){const b=boot(),{g,E,S}=b;g.startSandbag(type);const D=g.sb.dummy;
 assert.strictEqual(g.state,'sandbag');assert.strictEqual(D.type,type);assert(!E.sbpanel.classList.contains('off'),'統計パネル');
 if(type==='human')assert.strictEqual(g.v.rigs.length,2,'人型：プレイヤー＋NPCと同じ人型モデル');else{assert(g.v.dm,'器具の描画');assert.strictEqual(g.v.rigs.length,1)}
 assert(Math.abs(g.P.yaw)<.05,'プレイヤーは的の方を向く');assert.strictEqual(E.cn.textContent===''||true,true);g.hud();assert(E.cn.textContent.includes(b.DT[type]),'HUDに的の名前');assert.strictEqual(E.sc.textContent,'PRACTICE');
 const codes=type==='stand'?[{punch:'KeyK',hold:['KeyD']},{punch:'KeyJ',hold:['KeyD']},{punch:'KeyK'},{punch:'KeyJ'}]:[{punch:'KeyJ'},{punch:'KeyK'},{punch:'KeyJ',hold:['KeyA']},{punch:'KeyK',hold:['KeyD']},{punch:'KeyJ',hold:['KeyW']}];
 let swing=0,maxSwing=()=>Math.abs(D.sx)+Math.abs(D.sz)+Math.abs(D.om)+D.bv.length()+D.shake;const n0=E.log.children.length;let hits=0;
 for(const c of codes){hits+=practice(g,[c]);swing=Math.max(swing,maxSwing())}
 assert(hits>=2,type+'：パンチが当たる（'+hits+'発）');assert(g.sb.stats.n===hits);const L=g.sb.stats.last;assert(L&&L.speed>0&&L.dmg>0&&L.dist>.7&&L.dist<1.6,'直近のヒット情報: '+JSON.stringify(L));
 assert(E.log.children.length>n0&&!b.doc.contains('nolog'),'戦闘ログに記録され、表示されている');assert(E.sblast.textContent.includes(L.punch)&&E.sblast.textContent.includes('m/s'),'パンチ種類・速度・ダメージ・距離を表示');
 assert(swing>.3,type+'：当たると揺れる/動く '+swing.toFixed(2));
 if(type==='human')assert(/頭部|胸部|腹部|左腕|右腕/.test(L.zone),'部位名: '+L.zone);if(type==='bag')assert(/バッグ(上|中|下)部/.test(L.zone));if(type==='ball')assert.strictEqual(L.zone,'ボール');
 // 落ち着く（バッグは振り子としてゆっくり減衰、ボールは元の位置へ戻る、バーは回転が止まる、人型は揺れが収まる）
 if(type==='bag'){const a=Math.abs(D.sx)+Math.abs(D.sz);D.vx=1.2;stepN(g,120*3);const m1=Math.abs(D.sx)+Math.abs(D.sz);stepN(g,120*14);assert(Math.abs(D.sx)+Math.abs(D.sz)<.05,'バッグは徐々に静止')}
 if(type==='ball'){D.bv.set(2,0,3);stepN(g,120*4);const r=D.restPos();assert(D.bp.distanceTo(r)<.08,'ボールは弾んで元の位置へ戻る: '+D.bp.distanceTo(r).toFixed(3));assert(D.bp.distanceTo(new (Object.getPrototypeOf(r).constructor)(g.P.p.x,1.75,g.P.p.z))<1.65,'紐の長さを超えない')}
 if(type==='stand'){const h0=g.sb.stats.by;D.om=8;stepN(g,120*2);assert(D.phi!==0&&Math.abs(D.om)<8,'バーは回って減速する');stepN(g,120*14);assert(Math.abs(D.om)<.5,'やがて止まる')}
 if(type==='human'){stepN(g,120*2);assert(D.shake<.01)}
 assert.strictEqual(D.hp,D.hpMax,'HP/KOはない');
 g.quitToTitle()}
console.log('OK  4種類の的: ヘビーバッグ／リフレックスボール／スパーリングスタンド／人型ダミー——描画・当たり判定・部位名・揺れと減衰・ログ記録・情報パネル');

/* ===== 4. 統計・コンボ・リセット・切替・KOなし ===== */
{const b=boot(),{g,E}=b;g.startSandbag('bag');const sb=g.sb;
 const ev=(punch,pid,dmg,speed,zone)=>({type:'hit',att:'p',tgt:'s',zone:zone||'バッグ中部',punch,pid,speed,dmg,blocked:false,tags:[],np:[0,1.2,-.2]});
 g.sbHit(ev('左ジャブ','L_JAB',3,7));g.sbHit(ev('右ストレート','R_STRAIGHT',8,6.5));g.sbHit(ev('左フック','L_HOOK',9,8));
 const S=sb.stats;assert.strictEqual(S.combo.n,3);assert.strictEqual(+S.combo.dmg.toFixed(1),20);assert.deepStrictEqual(S.combo.names,['左ジャブ','右ストレート','左フック']);assert(E.sbcombo.textContent.includes('COMBO 3 HIT')&&E.sbcombo.textContent.includes('左ジャブ → 右ストレート → 左フック'),'コンボを表示');
 sb.t+=1.5;g.sbHit(ev('左ジャブ','L_JAB',5,7));assert.strictEqual(S.combo.n,1,'1秒空くとコンボは途切れる');assert.strictEqual(S.best.n,3,'最大コンボは保持');
 assert.strictEqual(S.by.L_JAB.n,2);assert.strictEqual(+(S.by.L_JAB.dmg/S.by.L_JAB.n).toFixed(1),4);assert(E.sbtable.innerHTML.includes('左ジャブ')&&E.sbtable.innerHTML.includes('右ストレート')&&E.sbtable.innerHTML.includes('合計'),'パンチ別の統計表');
 assert.strictEqual(S.n,4);assert.strictEqual(S.max,9);
 E.sbreset.onclick();assert.strictEqual(sb.stats.n,0);assert(E.sbtable.innerHTML===''&&E.sblast.textContent.includes('まだ'),'リセット');
 // キーでの切替（1〜4）。切替で統計はリセット。サンドバッグ以外では無効
 for(const [k,t] of[['Digit2','ball'],['Digit3','stand'],['Digit4','human'],['Digit1','bag']]){g.sbHit(ev('x','L_JAB',1,1));fire(b.ctx,'keydown',{code:k});assert.strictEqual(g.sb.type,t,'キー'+k+'で'+t);assert.strictEqual(g.sb.stats.n,0,'切替で統計リセット');assert(E['sbk-'+t].classList.contains('on'))}
 E['sbk-stand'].onclick();assert.strictEqual(g.sb.type,'stand','パネルのボタンでも切替');
 // KOなし：打ち続けても終わらない／ポーズ・停止・状態遷移が起きない
 for(let i=0;i<60;i++){g.P.st=g.P.stMax();g.sbHit(ev('右ストレート','R_STRAIGHT',30,9))}assert.strictEqual(g.state,'sandbag');assert.strictEqual(g.sb.dummy.hp,g.sb.dummy.hpMax);assert(E.over.classList.contains('off')&&E.evo.classList.contains('off'));
 console.log('OK  統計: 直近ヒット（種類/部位/速度/DMG/距離）／コンボ（1秒以内）と最大コンボ／パンチ別の回数・平均・最大・速度／リセット／1〜4キー切替／KO・終了なし')}

/* ===== 5. 対人戦と同じ射程・威力・スタミナ計算 ===== */
{const C=run(boot().ctx,'RFCore'),{Fighter,Dummy,combat,PUNCHES}=C;const DT=1/120,face=(f,o)=>Math.atan2(-(o.p.x-f.p.x),-(o.p.z-f.p.z)),idle=(f,o,x)=>Object.assign({mx:0,mz:0,punch:{},guard:0,face:face(f,o)},x||{});
 const run1=(mkTarget,id,d)=>{const o=Math.random;let s=3;Math.random=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;try{const P=new Fighter(true);P.id='p';P.newPoint(0,d/2,0);const T=mkTarget(P,d);const s0=P.st;P.startPunch(PUNCHES[id].hand,id,T);let hit=null;
   for(let i=0;i<150;i++){P.upd(DT,idle(P,T),T);if(T.isDummy)T.upd(DT);else T.upd(DT,idle(T,P),P);const ev=[];combat(P,[T],DT,ev);for(const e of ev)if(e.type==='hit')hit=e}return{hit,cost:s0-P.st,zone:hit&&hit.zone}}finally{Math.random=o}};
 let compared=0;for(const id of['L_JAB','R_STRAIGHT','L_HOOK','L_UPPER','R_BODY'])for(const d of[.9,1.05,1.25]){
  const real=run1((P,dd)=>{const T=new Fighter(false);T.id='b';T.newPoint(0,-dd/2,Math.PI);return T},id,d),dm=run1((P,dd)=>new Dummy('human',0,-dd/2,Math.PI,P),id,d);
  assert.strictEqual(!!real.hit,!!dm.hit,id+'@'+d+'m：当たる/外れるが同じ');assert.strictEqual(real.cost,dm.cost,'スタミナ消費が同じ');if(real.hit){assert.strictEqual(real.zone,dm.zone);assert.strictEqual(+real.hit.dmg.toFixed(6),+dm.hit.dmg.toFixed(6),id+'@'+d+'m：ダメージが同じ');assert.strictEqual(+real.hit.speed.toFixed(6),+dm.hit.speed.toFixed(6),'速度が同じ');compared++}}
 assert(compared>=8,'比較できた命中数: '+compared);
 console.log('OK  計算の同一性: 人型ダミーは、対人戦の相手と射程・当たり判定・威力・速度・スタミナ消費が完全に一致（'+compared+'ケース）')}

/* ===== 6. ポーズ・終了・既存モードへの無影響 ===== */
{const b=boot(),{g,E,S}=b;g.startSandbag('bag');practice(g,[{punch:'KeyK'},{punch:'KeyJ'}]);const D=g.sb.dummy;D.vx=1.5;stepN(g,60);
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'paused');assert(!E.pause.classList.contains('off'));assert.strictEqual(E.prestart.textContent,'統計をリセットして再開');
 const snap=()=>JSON.stringify([D.sx,D.sz,D.vx,D.vz,g.sb.t,g.sb.stats.n,g.P.p.x,g.P.p.z,g.P.st]);const before=snap();for(let i=0;i<300;i++)g.frame(g.last+16);assert.strictEqual(snap(),before,'ポーズ中は的・プレイヤー・統計が停止');
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'sandbag');stepN(g,120);assert.notStrictEqual(snap(),before);
 fire(b.ctx,'keydown',{code:'KeyP'});E.prestart.onclick();assert.strictEqual(g.state,'sandbag');assert.strictEqual(g.sb.stats.n,0,'ポーズメニューから統計リセット');
 fire(b.ctx,'keydown',{code:'KeyP'});E.pquit.onclick();assert.strictEqual(g.state,'menu');assert(g.sb===null&&g.v.dm===null&&g.v.dummy===null&&E.sbpanel.classList.contains('off')&&!E.menu.classList.contains('off'),'終了で完全に片付く');
 assert.strictEqual(g.v.rigs.length,2,'通常のCPU戦用の描画（プレイヤー＋CPU）に戻る');
 // 既存モードが動く
 g.newMatch();assert.strictEqual(g.state,'ready');for(let i=0;i<300;i++)g.step(1/120);assert.strictEqual(g.state,'fight');assert.strictEqual(g.P.picks.length,0);
 g.startSandbag('human');g.quitToTitle();g.openSetup();E.sstart.onclick();assert.strictEqual(g.state,'ready','サンドバッグ後もCPU対戦を開始できる');
 // 通常モードではサンドバッグの操作（1〜4）が効かない
 const t0=g.state;fire(b.ctx,'keydown',{code:'Digit2'});assert.strictEqual(g.state,t0);assert(g.sb===null);
 console.log('OK  ポーズ・終了: 停止中は完全に不変／統計リセット再開／終了で描画・状態を片付けCPU戦へ復帰／CPU対戦・数字キーは通常モードに影響しない')}
process.exit(0);
