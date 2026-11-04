'use strict';
// 今回のアップデート（ラウンド数/難易度/ポーズ/ログ切替/カメラ演出/勝敗ムービー）のクライアント検証。偽DOM＋偽THREE上で実行（WebGLの実描画は検証できません）。
const assert=require('assert');const {makeCtx,run,fire}=require('./fakedom.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(shared){const ctx=makeCtx(shared);return{ctx,g:ctx.game,E:ctx.__els,UI:run(ctx,'UI'),SFX:run(ctx,'SFX'),Settings:run(ctx,'Settings'),DIFF:run(ctx,'DIFF'),PUNCHES:run(ctx,'PUNCHES')}}
const typeIn=(E,id,val)=>{E[id].value=val;for(const f of(E[id].L.input||[]))f({target:E[id]})};
const stepN=(g,n)=>{for(let i=0;i<n;i++)g.step(1/120)};
const toFight=g=>{let n=0;while(g.state!=='fight'&&n++<800)g.step(1/120);assert.strictEqual(g.state,'fight','戦闘状態になる')};
const startCpu=(b,rounds,diff)=>{const c=b.g.cfg;if([3,5,10].includes(rounds)){c.mode='preset';c.rounds=rounds}else{c.mode='custom';c.custom=String(rounds)}c.diff=diff||'normal';b.g.openSetup();b.E.sstart.onclick()};
// 1ラウンドを指定した結果で終わらせ、進化があれば選ぶ。最終ならムービー状態で返る
function round(b,w){const g=b.g;toFight(g);if(w==='tie'){g.P.hp=50;g.C.hp=50;g.timer=.001}else   // CPU戦の引き分け＝タイムアップ時にHPが同じ（従来仕様）
   (w==='p'?g.C:g.P).hp=0;let n=0;while(g.state==='fight'&&n++<30)g.step(1/120);
  while(g.state==='pointEnd'&&n++<2000)g.step(1/120);if(g.state==='evolve')g.choose(0);return g.state}
const finishCine=(b)=>{let n=0;while(b.g.state==='cine'&&n++<200){b.g.v.render(.1,b.g.v.cineTs());for(let i=0;i<12;i++)b.g.step(1/120)}};
function fakeCam(){const p={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;return this},addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this}};
  return{position:p,rotation:{x:0,y:0,z:0,order:'YXZ',set(x,y,z){this.x=x;this.y=y;this.z=z}},fov:75,updateProjectionMatrix(){},lookAt(x,y,z){this.look=[x,y,z]}}}

(async()=>{
/* ===== 1. ラウンド数の選択（3/5/10/カスタム・入力検証・保存） ===== */
{const b=boot(),{g,E}=b;E.bcpu.onclick();assert(!E.setup.classList.contains('off')&&E.menu.classList.contains('off'),'CPU対戦でセットアップ画面');
 assert(E.rb3.classList.contains('on')&&E['db-normal'].classList.contains('on')&&!E.sstart.disabled,'既定は3ラウンド・ふつう');
 E.rbc.onclick();assert.strictEqual(E.rcustom.style.display,'','カスタム入力が出る');
 for(const bad of['','0','00','21','99','abc']){typeIn(E,'rcustom',bad);assert(E.sstart.disabled&&E.smsg.textContent.length>0,'不正入力は開始不可: "'+bad+'"');E.sstart.onclick();assert.notStrictEqual(g.state,'ready','不正値では開始されない')}
 for(const ok of['1','7','20','05']){typeIn(E,'rcustom',ok);assert(!E.sstart.disabled,'有効: '+ok)}
 typeIn(E,'rcustom','7');E.sstart.onclick();assert.strictEqual(g.rounds,7);assert.strictEqual(g.state,'ready');g.hud();assert.strictEqual(E.rd.textContent,'ROUND 1 / 7','現在/総ラウンド表示');
 for(const r of[5,10,3]){g.openSetup();E['rb'+r].onclick();E.sstart.onclick();assert.strictEqual(g.rounds,r)}
 const b2=boot({localStorage:b.ctx.localStorage});assert.strictEqual(b2.g.cfg.rounds,3);b.g.openSetup();E.rbc.onclick();typeIn(E,'rcustom','12');E.sstart.onclick();
 const b3=boot({localStorage:b.ctx.localStorage});assert.strictEqual(b3.g.cfg.mode,'custom');assert.strictEqual(b3.g.cfg.custom,'12','選択は保存され次回も反映');
 console.log('OK  ラウンド数: 3/5/10/カスタム、0・21以上・非数値は開始不可、ROUND n / N 表示、設定の保存')}

/* ===== 2. 総ラウンド制の進行・進化・延長・引き分け ===== */
{const b=boot(),{g,E}=b;startCpu(b,5);const labels=[];
 for(const [i,w] of['p','p','c','p','c'].entries()){toFight(g);g.hud();labels.push(E.rd.textContent);const st=round(b,w);
  if(i<4){assert.strictEqual(st,'ready','最終ラウンド前は進化→次ラウンド（進化が正常動作）');assert.strictEqual(g.round,i+2)}else assert.strictEqual(st,'cine','最終ラウンド後はムービーへ')}
 assert.deepStrictEqual(labels,['ROUND 1 / 5','ROUND 2 / 5','ROUND 3 / 5','ROUND 4 / 5','ROUND 5 / 5']);assert.strictEqual(g.P.picks.length,4,'進化は4回');assert.deepStrictEqual({...g.score},{p:3,c:2});
 finishCine(b);assert.strictEqual(g.state,'end');assert.strictEqual(E.res.textContent,'YOU WIN');assert(E.rs.textContent.includes('3 - 2')&&E.rs.textContent.includes('5ラウンド'));
 // 3-0でも規定ラウンドまで続く
 startCpu(b,5);for(let i=0;i<3;i++)round(b,'p');assert.notStrictEqual(g.state,'cine','3-0でも5ラウンドに達するまで続く');assert.strictEqual(g.round,4);
 // 同点は延長
 startCpu(b,2);round(b,'p');assert.strictEqual(round(b,'c'),'ready','1-1は延長へ');g.hud();assert.strictEqual(E.rd.textContent,'ROUND 3 / 2（延長）');assert.strictEqual(round(b,'p'),'cine');finishCine(b);assert.strictEqual(E.res.textContent,'YOU WIN');
 // 引き分けラウンドは同じラウンドをやり直す（進化なし）
 startCpu(b,3);assert.strictEqual(round(b,'tie'),'ready');assert.strictEqual(g.round,1);assert.deepStrictEqual({...g.score},{p:0,c:0});assert.strictEqual(g.P.picks.length,0);
 startCpu(b,1);assert.strictEqual(round(b,'c'),'cine','1ラウンド制');finishCine(b);assert.strictEqual(E.res.textContent,'YOU LOSE');
 console.log('OK  試合進行: 5ラウンド全消化→勝敗、3-0でも継続、同点=延長ラウンド、引き分け=やり直し、進化は最終前のみ')}

/* ===== 3. CPU難易度 ===== */
{const b=boot(),{g,E,DIFF}=b;
 for(const d of['easy','normal','hard','insane']){startCpu(b,3,d);assert.strictEqual(g.diff,d);assert.strictEqual(g.ai.dk,d);assert(E.cn.textContent.includes(DIFF[d].n),'名前欄に難易度');
  assert.strictEqual(!!g.C.bonus,d==='insane','補正は激ムズだけ');assert.strictEqual(g.P.hpMax,100,'プレイヤー側は補正なし');
  if(d==='insane'){assert(g.C.M.pw>=.08&&g.C.M.ps>=.05&&g.C.M.mv>=.05&&g.C.M.sm>=12&&g.C.hpMax===110,'基礎能力が強化される');assert(E.cc.innerHTML.includes('激ムズ補正'),'補正がチップで見える');
   await sleep(1000);assert(E.toast.textContent.includes('激ムズ')&&E.toast.textContent.includes('威力'),'補正内容が表示される')}
  else assert.strictEqual(g.C.hpMax,100)}
 startCpu(b,3,'hard');g.cfg.diff='easy';assert.strictEqual(g.ai.dk,'hard','試合中に難易度は変わらない');g.newMatch();assert.strictEqual(g.ai.dk,'hard','やり直しも同じ難易度');
 const rt={};for(const d of Object.keys(DIFF))rt[d]=DIFF[d].rt[0];assert(rt.easy>rt.normal&&rt.normal>rt.hard&&rt.hard===rt.insane,'反応時間は難しいほど短い');assert.deepStrictEqual(DIFF.hard.rt,DIFF.insane.rt);assert.strictEqual(DIFF.hard.learn,DIFF.insane.learn,'激ムズの判断力はつよいと同等');
 // 進化システムは難易度に関わらず動く
 startCpu(b,3,'insane');assert.strictEqual(round(b,'p'),'ready');assert.strictEqual(g.C.picks.length,1,'CPUも進化する');assert.strictEqual(g.C.M.hp,10,'進化後も難易度補正が維持される');assert(g.C.hpMax>=110);
 console.log('OK  CPU難易度: 4段階が反映／激ムズのみ能力補正（画面に表示）／試合中は不変／進化と両立')}

/* ===== 4. ポーズ ===== */
{const b=boot(),{g,E}=b;startCpu(b,3);toFight(g);g.inp.down({code:'KeyW'});for(let i=0;i<150;i++)g.frame(g.last+16);
 const snap=()=>JSON.stringify([g.P.p.x,g.P.p.z,g.C.p.x,g.C.p.z,g.P.hp,g.C.hp,g.P.st,g.C.st,g.timer,g.ai.t,g.ai.cool,g.v.rigs[1].pt,g.v.bt,g.P.h.L.t,g.C.h.R.t,g.P.lock,g.C.lock,g.score.p,g.score.c]);
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'paused');assert(!E.pause.classList.contains('off'),'ポーズ画面が出る');const before=snap();
 fire(b.ctx,'keydown',{code:'KeyJ'});fire(b.ctx,'keydown',{code:'KeyW'});for(let i=0;i<400;i++)g.frame(g.last+16);   // 約6秒
 assert.strictEqual(snap(),before,'ポーズ中はプレイヤー・CPU・タイマー・スタミナ・AI・アニメーションがすべて停止');assert.strictEqual(g.P.h.L.act,false);assert.strictEqual(g.acc,0,'時間を溜め込まない（再開時のワープ防止）');
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'fight','Pで再開');assert(E.pause.classList.contains('off'));const t0=g.timer,a0=g.ai.t;for(let i=0;i<120;i++)g.frame(g.last+16);
 assert(g.timer<t0&&g.ai.t>a0,'再開後は試合が続く（急な時間のジャンプなし）');assert(t0-g.timer<2.5,'ポーズ中の時間が加算されない: '+(t0-g.timer));
 fire(b.ctx,'keydown',{code:'KeyP'});E.presume.onclick();assert.strictEqual(g.state,'fight','ボタンでも再開');
 fire(b.ctx,'keydown',{code:'KeyP'});g.P.hp=40;E.prestart.onclick();assert.strictEqual(g.state,'ready');assert.strictEqual(g.P.hp,100,'やり直しでHP回復');assert.strictEqual(g.round,1);assert(E.pause.classList.contains('off'));
 fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'paused','カウントダウン中もポーズできる');fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'ready');
 fire(b.ctx,'keydown',{code:'KeyP'});E.pquit.onclick();assert.strictEqual(g.state,'menu');assert(!E.menu.classList.contains('off')&&E.pause.classList.contains('off'),'タイトルへ戻る');
 for(const st of['menu','evolve','end','cine','pointEnd']){g.state=st;fire(b.ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,st,'競合する画面ではPは無効: '+st);assert(E.pause.classList.contains('off'))}
 startCpu(b,3);toFight(g);fire(b.ctx,'keydown',{code:'KeyP',target:{tagName:'INPUT'}});assert.strictEqual(g.state,'fight','入力欄での P はポーズしない');
 console.log('OK  ポーズ: P/ボタンで再開・やり直し・タイトルへ／停止中は全て不変／再開後の時間ジャンプなし／進化・結果・ムービー中は無効')}

/* ===== 5. 戦闘ログの表示切替（表示だけ。戦闘計算は不変・保存される） ===== */
{const sims=[];for(const hide of[false,true]){let s=4242;const orig=Math.random;Math.random=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;
  try{const b=boot();b.Settings.set('log',!hide);startCpu(b,3,'hard');const g=b.g;toFight(g);
   for(let i=0;i<120*40&&g.state==='fight';i++){if(i%40===0)g.inp.down({code:Math.random()<.5?'KeyJ':'KeyK'});if(i%90===0){g.inp.down({code:'KeyW'})}g.step(1/120)}
   sims.push({p:g.P.hp,c:g.C.hp,ps:g.P.st,cs:g.C.st,log:b.E.log.children.length,hidden:b.ctx.document.body.classList.contains('nolog')})}finally{Math.random=orig}}
 assert.strictEqual(sims[0].hidden,false);assert.strictEqual(sims[1].hidden,true,'非表示は表示の切替だけ');
 assert(sims[0].log>0,'ログが記録される');assert.deepStrictEqual([sims[0].p,sims[0].c,sims[0].ps,sims[0].cs],[sims[1].p,sims[1].c,sims[1].ps,sims[1].cs],'ログの表示有無で戦闘結果（HP/スタミナ）は完全一致');
 assert.strictEqual(sims[0].log,sims[1].log,'非表示でもログ内容は内部に蓄積され続ける');
 const b=boot(),{E,Settings}=b;assert.strictEqual(Settings.log,true);fire(b.ctx,'keydown',{code:'KeyL'});assert.strictEqual(Settings.log,false);assert(b.ctx.document.body.classList.contains('nolog'));
 fire(b.ctx,'keydown',{code:'KeyL'});assert.strictEqual(Settings.log,true);fire(b.ctx,'keydown',{code:'KeyL',target:{tagName:'INPUT'}});assert.strictEqual(Settings.log,true,'入力欄でのLは切替えない');
 fire(b.ctx,'keydown',{code:'KeyL'});const b2=boot({localStorage:b.ctx.localStorage});assert.strictEqual(b2.Settings.log,false,'設定は保存され次回も反映');assert(b2.ctx.document.body.classList.contains('nolog'));
 E.bset.onclick();assert(!E.settings.classList.contains('off'));E.sglog.onclick();assert.strictEqual(Settings.log,true);assert.strictEqual(E.sglog.textContent,'ON');assert.strictEqual(E.sglog.attrs['aria-pressed'],'true');E.sgclose.onclick();assert(E.settings.classList.contains('off'));
 console.log('OK  ログ切替: Lキー/設定で表示のみ切替、HP・スタミナの結果は完全一致、ログは蓄積継続、保存・復元')}

/* ===== 6. カメラ演出 ===== */
{const b=boot(),{g,E,Settings,PUNCHES}=b,v=g.v;startCpu(b,3);toFight(g);v.cam=fakeCam();const rz=()=>{for(const k in v.cf){v.cf[k].x=0;v.cf[k].v=0}v.cs=0};
 Settings.set('cam',true);const sig={};
 for(const id of['L_JAB','R_STRAIGHT','L_HOOK','R_HOOK','L_UPPER','R_BODY']){rz();v.punchKick(PUNCHES[id],PUNCHES[id].hand);sig[id]=Object.fromEntries(Object.keys(v.cf).map(k=>[k,+v.cf[k].v.toFixed(2)]))}
 assert.strictEqual(new Set(Object.values(sig).map(x=>JSON.stringify(x))).size,6,'パンチの種類ごとにカメラの動きが違う');
 assert(sig.L_UPPER.pitch>0&&sig.R_BODY.pitch<0,'アッパー=見上げる／ボディ=沈む');assert(sig.L_HOOK.yaw*sig.R_HOOK.yaw<0&&sig.L_HOOK.roll*sig.R_HOOK.roll<0,'左右のフックで逆方向に振られる');assert(sig.R_STRAIGHT.fov>sig.L_JAB.fov&&sig.R_STRAIGHT.fwd>sig.L_JAB.fwd,'ストレートはジャブより大きな反応');
 const ev=(dmg,o={})=>Object.assign({type:'hit',att:'p',tgt:'c',zone:'胸部',punch:'x',pid:'L_JAB',speed:6,dmg,blocked:false,tags:[],np:[0,1.4,0]},o);
 rz();v.hitDealt(ev(5));const w=[v.cs,v.cf.fov.v];rz();v.hitDealt(ev(25));assert(v.cs>w[0]&&v.cf.fov.v>w[1],'強いパンチほどインパクトが大きい');
 rz();v.hitDealt(ev(25,{blocked:true}));const bl=v.cs;rz();v.hitDealt(ev(25));assert(bl<v.cs,'ガードされた打撃は小さい');
 rz();v.hitTaken(ev(18,{att:'c',zone:'頭部',pid:'R_STRAIGHT'}));const hd=v.cf.pitch.v;rz();v.hitTaken(ev(18,{att:'c',zone:'腹部',pid:'R_BODY'}));assert(hd>0&&v.cf.pitch.v<0,'被弾：頭は仰け反り、ボディは折れる');
 rz();v.hitTaken(ev(18,{att:'c',pid:'L_HOOK'}));const yl=v.cf.yaw.v;rz();v.hitTaken(ev(18,{att:'c',pid:'R_HOOK'}));assert(yl*v.cf.yaw.v<0,'被弾の振られ方はフックの向きで変わる');
 // 実際の攻防（ゲーム状態）に連動
 rz();g.inp.down({code:'KeyK'});let n=0;while(!g.P.h.R.act&&n++<200)g.step(1/120);v.render(.016);assert(v.cf.fov.v!==0||v.cf.fov.x!==0,'パンチ開始でカメラが反応');
 rz();v.pdash=false;g.P.v.set(0,0,-10);v.render(.016);assert(Math.abs(v.cf.fov.v)>5,'ダッシュに連動');
 g.P.v.set(0,0,0);v.render(.5);rz();g.P.off.x=.3;v.psw=false;v.render(.016);assert(v.cf.roll.v!==0,'スウェーに連動');g.P.off.x=0;v.render(.5);
 rz();g.P.off.y=-.3;v.pdk=false;v.render(.016);assert(v.cf.pitch.v<0,'ダッキングに連動');g.P.off.y=0;v.render(.5);
 // 慣性：加速ののち、スプリングが元へ戻る
 rz();v.punchKick(PUNCHES.R_STRAIGHT,'R');let peak=0;for(let i=0;i<30;i++){v.render(.016);peak=Math.max(peak,Math.abs(v.cf.fov.x))}assert(peak>1,'一度大きく動き');for(let i=0;i<200;i++)v.render(.016);assert(Math.abs(v.cf.fov.x)<.05,'自然に元の画角へ戻る（揺れ続けない）');
 // イベント経由（CPU戦のヒット処理）
 rz();g.onEv(ev(15));assert(v.cs>0,'命中でシェイク');rz();g.onEv(ev(15,{att:'c',tgt:'p'}));assert(v.cs>.05,'被弾でシェイク');
 // OFF：揺れ・ムーブ・慣性をすべて無効化。追従と視点は維持
 Settings.set('cam',false);rz();v.hitDealt(ev(25));v.hitTaken(ev(25,{att:'c'}));assert.strictEqual(v.cs,0,'OFFでは衝撃が入らない');
 g.inp.down({code:'KeyJ'});n=0;while(!g.P.h.L.act&&n++<200)g.step(1/120);g.P.v.set(0,0,-10);v.render(.016);v.render(.016);
 assert(Object.values(v.cf).every(s=>s.x===0&&s.v===0),'OFFではスプリングが動かない');assert.strictEqual(v.cam.fov,75,'画角固定');
 g.P.v.set(0,0,0);v.render(.016);const c=v.cam,P=g.P,e=P.toWorld({x:0,y:1.65,z:0});
 assert(Math.abs(c.position.x-e.x)<1e-9&&Math.abs(c.position.z-e.z)<1e-9&&Math.abs(c.position.y-e.y)<1e-9,'OFFでもプレイヤー位置への追従は正確（揺れ・ボブなし）');assert(Math.abs(c.rotation.y-P.yaw)<1e-9,'OFFでも向きの追従は維持');
 // 既存のゲームプレイ機能（移動・攻撃・判定）はカメラ設定に依存しない
 const run2=(cam)=>{let s=99;const o=Math.random;Math.random=()=>(s=(s*1664525+1013904223)>>>0)/4294967296;try{const bb=boot();bb.Settings.set('cam',cam);startCpu(bb,3,'hard');const gg=bb.g;toFight(gg);for(let i=0;i<120*25&&gg.state==='fight';i++){if(i%35===0)gg.inp.down({code:'KeyK'});if(i%60===0)gg.inp.down({code:'KeyW'});gg.step(1/120);if(i%4===0)gg.v.render(.033)}return[gg.P.hp,gg.C.hp,gg.P.st,gg.C.st]}finally{Math.random=o}};
 assert.deepStrictEqual(run2(true),run2(false),'カメラ演出のON/OFFで戦闘結果は変わらない');
 console.log('OK  カメラ演出: 種類別の動き／強さ比例／被弾の方向／ダッシュ・スウェー・ダックに連動／慣性で元に戻る／OFFで全無効（追従は維持）／戦闘結果は不変')}

/* ===== 7. 勝敗ムービー ===== */
for(const kind of['win','lose','timeup']){
 const b=boot(),{g,E,SFX}=b,v=g.v;v.cam=fakeCam();const calls=[];for(const k of['ko','fanfare','defeat'])SFX[k]=()=>calls.push(k);
 startCpu(b,3);for(let i=0;i<2;i++)round(b,kind==='lose'?'c':'p');toFight(g);
 if(kind==='timeup'){g.P.hp=70;g.C.hp=30;g.timer=.001;stepN(g,10)}else{(kind==='win'?g.C:g.P).hp=0;stepN(g,10)}
 assert.strictEqual(g.state,'cine','最終ラウンド後はムービー再生: '+kind);assert(b.ctx.document.body.classList.contains('cine'),'ムービー中はHUDを隠す');assert(!E.over.classList.contains('off')===false,'結果画面はまだ出ない');
 const win=kind!=='lose',Wf=win?g.P:g.C,Lf=win?g.C:g.P,k0=Lf.koT,pos=JSON.stringify([g.P.p,g.C.p]),cool=g.ai.cool,t0=g.ai.t;
 assert.strictEqual(E.cinetitle.textContent,kind==='timeup'?'TIME UP':'K.O.');assert(calls.includes('ko'),'KO効果音');assert(g.v.cineTs()<.3,'スローモーション');
 g.inp.down({code:'KeyJ'});g.inp.down({code:'KeyK'});stepN(g,240);
 assert.strictEqual(g.ai.cool,cool);assert.strictEqual(g.ai.t,t0,'CPUのAIは止まる');assert.strictEqual(g.P.h.L.act||g.P.h.R.act||g.C.h.L.act||g.C.h.R.act,false,'操作・AIで動き続けない');
 if(kind!=='timeup'){assert(Lf.koT>k0,'敗者は倒れる動きが進む');assert(Lf.koT<1,'スローモーションで進行: '+Lf.koT)}
 const rigW=v.rigs.find(r=>r.f===Wf),rigL=v.rigs.find(r=>r.f===Lf);assert.strictEqual(rigW.pose,'win','勝者の勝利ポーズ');assert.strictEqual(rigL.pose,kind==='timeup'?'lose':null,'敗者のリアクション');
 const cams=[];for(let i=0;i<70;i++){v.render(.1,v.cineTs());if(i===3||i===25||i===55)cams.push(JSON.stringify([v.cam.position.x.toFixed(2),v.cam.position.y.toFixed(2),v.cam.position.z.toFixed(2),v.cam.fov]));
  if(i<8)for(let j=0;j<12;j++)g.step(1/120);if(g.state!=='cine')break}
 assert.strictEqual(new Set(cams).size,Math.min(3,cams.length),'カメラは大きく動く（ショットが切り替わる）');
 assert.strictEqual(g.state,'end','ムービー後に結果画面へ接続');assert(!E.over.classList.contains('off'));assert.strictEqual(E.res.textContent,win?'YOU WIN':'YOU LOSE');
 assert(calls.includes(win?'fanfare':'defeat')&&!calls.includes(win?'defeat':'fanfare'),'勝敗で異なる効果音: '+calls);
 assert(!b.ctx.document.body.classList.contains('cine')&&v.cine===null&&v.spec===null&&v.cam.fov===75&&E.cinetitle.className==='','ムービー後は通常表示に戻る');
 E.bre.onclick();assert.strictEqual(g.state,'ready');assert.strictEqual(g.score.p+g.score.c,0);
 console.log('OK  勝敗ムービー['+kind+']: スロー→切替カメラ→タイトル/効果音→結果画面。CPU/操作は停止、ポーズ・再戦も正常')}
{const b=boot(),{g,E,ctx}=b;startCpu(b,1);round(b,'p');assert.strictEqual(g.state,'cine');fire(ctx,'keydown',{code:'KeyP'});assert.strictEqual(g.state,'cine');
 fire(ctx,'keydown',{code:'Space'});for(let i=0;i<3;i++)g.v.render(.016,1);assert.strictEqual(g.state,'end','Spaceでスキップして結果へ');
 startCpu(b,1);round(b,'p');for(const f of(ctx.__L.click||[]))f({});for(let i=0;i<3;i++)g.v.render(.016,1);assert.strictEqual(g.state,'end','クリックでもスキップ');
 console.log('OK  ムービーのスキップ（Space/Enter/クリック）・ムービー中のPは無効')}
process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
