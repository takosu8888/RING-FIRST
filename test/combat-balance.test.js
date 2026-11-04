'use strict';
// 戦闘バランス（読み合い）とフック移動の検証。乱数は固定シードで再現可能。数値は表示される。
const assert=require('assert');const C=require('../game-core.js');const {Fighter,combat,CFG,PUNCHES,AI,DIFF}=C;
const DT=1/120,face=(f,o)=>Math.atan2(-(o.p.x-f.p.x),-(o.p.z-f.p.z));
function seeded(seed){let s=seed>>>0||1;return()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
function withSeed(seed,fn){const o=Math.random;Math.random=seeded(seed);try{return fn()}finally{Math.random=o}}
const mkPair=(d)=>{const A=new Fighter(true),B=new Fighter(false);A.id='a';B.id='b';A.newPoint(0,d/2,0);B.newPoint(0,-d/2,Math.PI);return[A,B]};
const idle=(f,o,x)=>Object.assign({mx:0,mz:0,punch:{},guard:0,face:face(f,o)},x||{});

/* ===== 1. フック：入力方向へ動かず、命中する。他のパンチの操作感は変えない ===== */
function hookTrial(id,dist,lock){CFG.rules.hookLock.on=lock;const [A,B]=mkPair(dist),d=PUNCHES[id],mv={w:[0,1],s:[0,-1],a:[-1,0],d:[1,0]}[d.mod]||[0,0];let hit=false;
  for(let i=0;i<120;i++){A.upd(DT,idle(A,B,{mx:mv[0],mz:mv[1],punch:i===0?{[d.hand]:id}:{}}),B);B.upd(DT,idle(B,A),A);const ev=[];combat(A,[B],DT,ev);if(ev.some(e=>e.type==='hit'))hit=true}
  CFG.rules.hookLock.on=true;return{hit,end:[A.p.x,A.p.z]}}
const rate=(id,lock)=>{let h=0,n=0;for(const D of[.95,1.05,1.15,1.25])for(let k=0;k<4;k++){h+=hookTrial(id,D,lock).hit?1:0;n++}return h/n};
const rows=[];
for(const id of['L_HOOK','L_HOOK_REV','R_HOOK','R_BODYHOOK','L_BODY','R_BODY']){const a=rate(id,false),b=rate(id,true);rows.push(`${id} ${(a*100)|0}%→${(b*100)|0}%`);assert(b>=.5,id+'は新方式で十分に当たる: '+b);assert(b-a>=.25,id+'は従来より明確に当たりやすい: '+a+'→'+b)}
for(const id of['L_JAB','R_STRAIGHT','L_UPPER','R_UPPER']){const a=rate(id,false),b=rate(id,true);assert(b>=a&&b>=.9,id+'は従来から変わらず当たる: '+a+'→'+b)}
for(const id of['L_JAB','R_STRAIGHT']){   // ジャブ/ストレート中の移動は従来と完全に同じ（操作感を変えない）
  const p1=hookTrial(id,1.2,false).end,p2=hookTrial(id,1.2,true).end;assert.deepStrictEqual(p1,p2,id+'の移動は不変')}
{const [A,B]=mkPair(1.3);A.upd(DT,idle(A,B,{mx:-1,punch:{L:'L_HOOK'}}),B);for(let i=0;i<30;i++)A.upd(DT,idle(A,B,{mx:-1}),B);   // 攻撃が終わったら通常の移動へ戻る
  for(let i=0;i<120;i++)A.upd(DT,idle(A,B,{mx:-1}),B);assert(A.v.length()>2,'攻撃終了後は通常移動に戻る: '+A.v.length())}
console.log('OK  フック: 命中率（従来→新）'+rows.join(' / ')+'。ジャブ・ストレート・アッパーは不変、攻撃後は通常移動へ復帰');

/* ===== 2. ルールの単体確認（連打・空振り・同一パンチ・距離・ガード） ===== */
const hitDmg=(id,dist,pre)=>{const [A,B]=mkPair(dist),d=PUNCHES[id];if(pre)pre(A,B);A.startPunch(d.hand,id,B);let dmg=0,tags=[];
  for(let i=0;i<150;i++){A.upd(DT,idle(A,B),B);B.upd(DT,idle(B,A),A);const ev=[];combat(A,[B],DT,ev);for(const e of ev)if(e.type==='hit'){dmg=e.dmg;tags=e.tags}}return{dmg,A,B,tags}};
{CFG.rules.on=true;
 const j1=hitDmg('L_JAB',1.15).dmg,j2=hitDmg('L_JAB',.8).dmg;assert(j2<j1*.7,'近すぎるジャブは威力が落ちる: '+j2+' vs '+j1);
 const h1=hitDmg('L_HOOK',.95).dmg,h2=hitDmg('L_HOOK',.8).dmg;assert(h2>h1*.8,'フックは近距離でも威力を保つ: '+h2+' vs '+h1);
 assert(hitDmg('L_HOOK',1.4).dmg===0,'フックは遠いと届かない');assert(hitDmg('R_STRAIGHT',1.4).dmg>0,'ストレートは遠くまで届く');
 // 連打：直前から0.9秒以内に打つとスタミナ消費が増え、3連打目以降は攻撃後の隙が増える
 const [A,B]=mkPair(3);const costs=[];for(let i=0;i<5;i++){const s0=A.st;A.startPunch('L','L_JAB',B);costs.push(s0-A.st);A.h.L.act=false;for(let k=0;k<12;k++)A.upd(DT,idle(A,B),B)}
 assert(costs.every((c,i)=>i===0||c>costs[i-1]),'連打ほど消費増: '+costs.map(c=>c.toFixed(1)));assert(costs[4]>costs[0]*1.6);
 const [A2]=mkPair(3);A2.chain=4;A2.chainT=1;A2.h.L.act=true;A2.h.L.def=PUNCHES.L_JAB;A2.h.L.hit=true;A2.endPunch(A2.h.L);assert(A2.lock>.1,'連打の後は隙: '+A2.lock);
 // 空振り：パンチごとの硬直＋スタミナを追加消費（ジャブ<ストレート<アッパー）
 const whiff=id=>{const [X,Y]=mkPair(3),d=PUNCHES[id];X.startPunch(d.hand,id,Y);const s0=X.st;for(let i=0;i<150;i++){X.upd(DT,idle(X,Y),Y);}return{lock:X.lock,spent:s0-X.st}};
 // 終了時点のlockを直接検証（endPunch）
 const lk=id=>{const [X]=mkPair(3);X.h.L.act=true;X.h.L.def=PUNCHES[id];X.h.L.hit=false;const s0=X.st;X.endPunch(X.h.L);return{lock:X.lock,spent:s0-X.st}};
 assert(lk('L_JAB').lock<lk('R_STRAIGHT').lock&&lk('R_STRAIGHT').lock<lk('L_UPPER').lock,'空振りの隙：ジャブ<ストレート<アッパー');assert(lk('R_STRAIGHT').spent>0,'空振りはスタミナも追加で失う');
 // 同じパンチの連続：3回目以降は威力が下がる
 const seq=[];{const [X,Y]=mkPair(1.15);for(let r=0;r<5;r++){Y.hp=Y.hpMax;X.st=X.stMax();X.startPunch('L','L_JAB',Y);let d=0;for(let i=0;i<150;i++){X.upd(DT,idle(X,Y),Y);Y.upd(DT,idle(Y,X),X);const ev=[];combat(X,[Y],DT,ev);for(const e of ev)if(e.type==='hit')d=e.dmg}seq.push(d);for(let k=0;k<400;k++)X.upd(DT,idle(X,Y),Y)}}
 assert(seq[2]<seq[0]&&seq[4]<seq[2],'同一パンチの連続で威力低下: '+seq.map(x=>x.toFixed(1)));
 // ガード：成功すると防いだ側に反撃チャンス、攻めた側に隙。スタミナ切れでガードブレイク
 const [P,Q]=mkPair(1.15);Q.gb=1;Q.gh=0;P.startPunch('L','L_JAB',Q);let blocked=null;for(let i=0;i<120;i++){P.upd(DT,idle(P,Q),Q);Q.gb=1;Q.upd(DT,idle(Q,P,{guard:1}),P);const ev=[];combat(P,[Q],DT,ev);for(const e of ev)if(e.type==='hit')blocked=e}
 assert(blocked&&blocked.blocked,'ガードされる');assert(Q.gcT>0,'ガード成功で反撃チャンス');assert(P.lock>=CFG.rules.blockLock-.01||P.lock>0,'攻撃側に隙');
 const cdmg=hitDmg('R_STRAIGHT',1.3,(a,b)=>{a.gcT=.7}).dmg,ndmg=hitDmg('R_STRAIGHT',1.3).dmg;assert(cdmg>ndmg,'反撃チャンス中は威力が上がる: '+cdmg+' vs '+ndmg);
 const g1=hitDmg('L_JAB',1.15,(a,b)=>{b.gb=1}).dmg,g0=hitDmg('L_JAB',1.15).dmg;assert(g1<g0*.5,'ガードで大きく軽減');
 const up=hitDmg('L_UPPER',.9,(a,b)=>{b.gb=1}),upN=hitDmg('L_UPPER',.9);const jb=hitDmg('L_JAB',1.15,(a,b)=>{b.gb=1}),jbN=hitDmg('L_JAB',1.15);assert(up.dmg/upN.dmg>jb.dmg/jbN.dmg+.1,'アッパーはガードを貫く: '+(up.dmg/upN.dmg).toFixed(2)+' vs '+(jb.dmg/jbN.dmg).toFixed(2));
 const [T,U]=mkPair(3);T.gb=1;const st0=T.st;for(let i=0;i<120*5;i++){T.gb=1;T.upd(DT,idle(T,U,{guard:1}),U)}assert(T.st<st0-8,'ガード維持はスタミナを消費し続ける: '+(st0-T.st).toFixed(1));
 let gbreak=false;{const [X,Y]=mkPair(1.15);Y.st=1;Y.gb=1;X.startPunch('R','R_STRAIGHT',Y);for(let i=0;i<150;i++){X.upd(DT,idle(X,Y),Y);Y.gb=1;Y.upd(DT,idle(Y,X,{guard:1}),X);const ev=[];combat(X,[Y],DT,ev);for(const e of ev)if(e.type==='hit'&&e.tags.includes('GUARD BREAK'))gbreak=true}}assert(gbreak,'スタミナ切れでガードブレイク');
 console.log('OK  戦闘ルール: 距離で威力が変わる／連打は消費増＋隙／空振りは役割別の隙／同一パンチは威力低下／ガードで反撃チャンス・アッパー貫通・維持で消耗・ガードブレイク')}

/* ===== 3. 連打の強みは残るが、単純な連打だけでは不利になる（新旧ルール比較） ===== */
const pickW=(L)=>{let r=Math.random(),a=0;for(const [id,w] of L){a+=w;if(r<=a)return id}return L[0][0]};
const RUSH=[['L_JAB',.35],['R_STRAIGHT',.25],['L_HOOK',.15],['R_HOOK',.1],['L_UPPER',.1],['R_BODY',.05]],MIX=[['L_JAB',.3],['R_STRAIGHT',.25],['L_HOOK',.15],['R_HOOK',.1],['L_UPPER',.1],['R_BODY',.1]];
function botInput(kind,P,Cc,st){const dist=Math.hypot(P.p.x-Cc.p.x,P.p.z-Cc.p.z),I=idle(P,Cc);
  if(kind==='rush'){I.mz=dist>1.0?1:0;if(!P.punching()||P.h.L.act!==P.h.R.act){const id=pickW(RUSH);I.punch[PUNCHES[id].hand]=id}}
  else{I.mz=dist>1.35?1:dist<1.05?-1:0;I.mx=Math.sin(st.t*1.3)*.5;st.c-=DT;for(const k of['L','R']){const h=Cc.h[k];if(h.act&&h.id!==st.seen&&h.ph==='w'){st.seen=h.id;if(Math.random()<.5)st.g=.45}}
   if(st.g>0){st.g-=DT;I.guard=1}if(!I.guard&&st.c<=0&&dist<1.5&&!P.punching()){const id=pickW(MIX);I.punch[PUNCHES[id].hand]=id;st.c=.55}}st.t+=DT;return I}
function match(kind,diff,style,seed){return withSeed(seed,()=>{const P=new Fighter(true),Cc=new Fighter(false);P.id='p';Cc.id='c';Cc.bonus=DIFF[diff].bonus||null;Cc.newMatch();P.newPoint(0,2,0);Cc.newPoint(0,-1.6,Math.PI);
  const ai=new AI(style,diff),st={t:0,c:.5,seen:0,g:0};let dP=0,dC=0;
  for(let i=0;i<120*60;i++){const IP=botInput(kind,P,Cc,st),IC=ai.think(Cc,P,DT);IC.face=face(Cc,P);P.upd(DT,IP,Cc);Cc.upd(DT,IC,P);const ev=[];combat(P,[Cc],DT,ev);combat(Cc,[P],DT,ev);
   for(const e of ev)if(e.type==='hit'){if(e.att==='p')dP+=e.dmg;else dC+=e.dmg}if(P.hp<=0||Cc.hp<=0)break}
  const rp=P.hp/P.hpMax,rc=Cc.hp/Cc.hpMax;return{cWin:rc>rp?1:rc<rp?0:.5,dP,dC}})}
const STY=['combo','power','counter','guard'];
const bulk=(kind,diff,n)=>{let w=0,dP=0,dC=0,c=0;for(const s of STY)for(let k=1;k<=n;k++){const r=match(kind,diff,s,k*104729+s.length);w+=r.cWin;dP+=r.dP;dC+=r.dC;c++}return{win:w/c,dP:dP/c,dC:dC/c}};
{const res={};for(const on of[false,true]){CFG.rules.on=on;res[on]=bulk('rush','hard',6)}CFG.rules.on=true;
 assert(res.true.win>=res.false.win,'つよいCPUは新ルールで連打に強くなる: '+res.false.win+'→'+res.true.win);assert(res.true.dP<res.false.dP,'連打側の与ダメージが下がる: '+res.false.dP.toFixed(0)+'→'+res.true.dP.toFixed(0));
 // 何もしない相手には連打がまだ十分に効く（連打そのものを弱くしすぎない）
 const idleRun=(on)=>{CFG.rules.on=on;return withSeed(7,()=>{const R=new Fighter(true),X=new Fighter(true);R.id='r';X.id='x';R.newPoint(0,2,0);X.newPoint(0,-2,Math.PI);let d=0;
  for(let i=0;i<120*30;i++){const dist=Math.hypot(R.p.x-X.p.x,R.p.z-X.p.z),I=idle(R,X,{mz:dist>1?1:0});if(!R.punching()||R.h.L.act!==R.h.R.act){const id=pickW(RUSH);I.punch[PUNCHES[id].hand]=id}R.upd(DT,I,X);X.upd(DT,idle(X,R),R);const ev=[];combat(R,[X],DT,ev);for(const e of ev)if(e.type==='hit')d+=e.dmg}return d})};
 const d0=idleRun(false),d1=idleRun(true);CFG.rules.on=true;assert(d1>=d0*.7&&d1<d0,'連打は今も有効（30秒で'+d1.toFixed(0)+'ダメージ。従来'+d0.toFixed(0)+'の'+((d1/d0)*100|0)+'%）');
 console.log(`OK  連打: つよいCPU戦で連打側の与ダメ ${res.false.dP.toFixed(0)}→${res.true.dP.toFixed(0)}、CPU勝率 ${(res.false.win*100)|0}%→${(res.true.win*100)|0}%。無抵抗の相手へは従来の${((d1/d0)*100|0)}%の火力を維持`)}

/* ===== 4. 難易度：強さが段階的に上がり、激ムズだけ能力補正。判断力はつよい＝激ムズ ===== */
{CFG.rules.on=true;const W={};for(const d of['easy','normal','hard','insane'])W[d]=bulk('mix',d,6).win;
 console.log('    難易度別 CPU勝率（標準的なプレイヤーBot相手）: よわい',(W.easy*100)|0,'% / ふつう',(W.normal*100)|0,'% / つよい',(W.hard*100)|0,'% / 激ムズ',(W.insane*100)|0,'%');
 assert(W.easy+.08<W.hard,'よわい < つよい');assert(W.easy<=W.normal+.02&&W.normal<=W.hard+.1,'よわい ≤ ふつう ≤ つよい');assert(W.hard+.08<W.insane,'激ムズ > つよい（能力補正の分）');
 const S=['easy','normal','hard','insane'],rt=S.map(d=>DIFF[d].rt[0]),atk=S.map(d=>DIFF[d].cool);assert(rt[0]>rt[1]&&rt[1]>rt[2]&&rt[2]===rt[3],'反応時間');assert(atk[0]>atk[1]&&atk[1]>=atk[2],'攻撃間隔');
 for(const k of['rt','miss','ev','gp','cool','cp','learn','punish','space','tired','pick'])assert.deepStrictEqual(DIFF.hard[k],DIFF.insane[k],'激ムズの判断パラメータは「つよい」と同一: '+k);
 assert(!DIFF.easy.bonus&&!DIFF.normal.bonus&&!DIFF.hard.bonus&&DIFF.insane.bonus&&DIFF.insane.bonusText,'補正は激ムズのみ・説明文あり');
 const b=DIFF.insane.bonus;assert(b.pw<=.15&&b.ps<=.1&&b.mv<=.1&&b.hp<=15,'補正は控えめ（理不尽にしない）');
 console.log('OK  難易度: 強さが段階的／反応・攻撃間隔・ミスが難易度で違う／激ムズ＝つよい＋小さな能力補正')}

/* ===== 5. CPU AIの観察・反撃・使い分け ===== */
{CFG.rules.on=true;
 // 観察：連打頻度・同じ技の繰り返し・ガード率
 withSeed(11,()=>{const [Cc,P]=mkPair(1.2);Cc.id='c';P.id='p';const ai=new AI('combo','hard');
  for(let i=0;i<120*6;i++){const I=idle(P,Cc);if(i%36===0)I.punch.L='L_JAB';P.upd(DT,I,Cc);Cc.upd(DT,idle(Cc,P),P);ai.think(Cc,P,DT)}
  assert(ai.ob.rate>1.2,'相手の攻撃頻度を観察: '+ai.ob.rate.toFixed(2)+'/s');assert(ai.ob.rep>=3,'同じ技の繰り返しを検知: '+ai.ob.rep);
  const ai2=new AI('combo','hard');for(let i=0;i<120*5;i++){P.gb=1;ai2.observe(Cc,P,DT,1.2)}assert(ai2.ob.guard>.5,'ガードの多さを検知: '+ai2.ob.guard.toFixed(2))});
 // ガードの多い相手には、ボディ/アッパー系を選びやすくなる
 withSeed(12,()=>{const [Cc,P]=mkPair(1.0);const body=(g)=>{const ai=new AI('combo','hard');ai.ob.guard=g;let n=0;for(let i=0;i<400;i++){const id=ai.pickPunch(Cc,P,1.0);if(PUNCHES[id].mod==='d'||id.includes('UPPER')||id.includes('BODY'))n++}return n/400};
  const lo=body(0),hi=body(.8);assert(hi>lo+.15,'ガードが多い相手にはボディ/アッパーを選ぶ: '+lo.toFixed(2)+'→'+hi.toFixed(2))});
 // 距離に応じた技の選択（遠い→ストレート/ジャブ、近い→フック/アッパー/ボディ）
 withSeed(13,()=>{const [Cc,P]=mkPair(1.0),ai=new AI('power','hard'),cnt=d=>{const m={};for(let i=0;i<300;i++){const id=ai.pickPunch(Cc,P,d);m[id]=(m[id]||0)+1}return m};
  const far=cnt(1.4),near=cnt(.85);const sFar=(far.R_STRAIGHT||0)+(far.L_JAB||0),hNear=(near.L_HOOK||0)+(near.R_HOOK||0)+(near.L_UPPER||0)+(near.R_UPPER||0)+(near.R_BODY||0)+(near.L_BODY||0)+(near.R_BODYHOOK||0);
  assert(sFar>200,'遠距離はストレート/ジャブ中心: '+sFar+'/300');assert(hNear>180,'近距離はフック/アッパー/ボディ中心: '+hNear+'/300')});
 // 空振り・隙への反撃：よわい=しない、つよい>ふつう
 const punishRate=(diff)=>{let n=0,T=60;withSeed(21,()=>{for(let t=0;t<T;t++){const [Cc,P]=mkPair(1.2);Cc.id='c';P.id='p';const ai=new AI('combo',diff);ai.cool=2;ai.t=5;
   P.startPunch('L','L_JAB',Cc);let went=false;for(let i=0;i<120*3;i++){const I=idle(P,Cc);P.upd(DT,I,Cc);const ic=ai.think(Cc,P,DT);ic.face=face(Cc,P);Cc.upd(DT,ic,P);if(i>120*.4&&(Cc.h.L.act||Cc.h.R.act))went=true;
    if(i===30)P.p.z+=1.2}   // ジャブは空振り（相手から離れる）
   if(went)n++}});return n/T};
 const pe=punishRate('easy'),pn=punishRate('normal'),ph=punishRate('hard');assert(ph>pe,'つよい>よわい：空振りへの反撃 '+pe.toFixed(2)+'/'+pn.toFixed(2)+'/'+ph.toFixed(2));
 // 同じ技の連発を避ける
 withSeed(14,()=>{const [Cc,P]=mkPair(1.1),ai=new AI('combo','hard');let rep=0,prev=null;for(let i=0;i<300;i++){const id=ai.pickPunch(Cc,P,1.1);ai.mine.push(id);if(ai.mine.length>6)ai.mine.shift();if(id===prev)rep++;prev=id}assert(rep<300*.35,'同じ技の連続を避ける: '+rep+'/300')});
 // CPUにもプレイヤーと同じルール（スタミナ・隙）が適用される：スタミナが少ないと攻撃しない
 withSeed(15,()=>{const [Cc,P]=mkPair(1.1);Cc.id='c';const ai=new AI('combo','hard');Cc.st=5;let went=false;for(let i=0;i<120*4;i++){const ic=ai.think(Cc,P,DT);ic.face=face(Cc,P);if(ic.punch.L||ic.punch.R)went=true;Cc.upd(DT,ic,P);Cc.st=5}assert(!went,'スタミナ切れでは攻撃しない（同じルール）')});
 console.log('OK  CPU AI: 攻撃頻度・繰り返し・ガード率を観察／ガードにはボディ・アッパー／距離で技を選ぶ／空振りに反撃（よわい<つよい）／同じ技を避ける／スタミナのルールは共通')}
