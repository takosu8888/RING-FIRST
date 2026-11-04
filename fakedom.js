'use strict';
// テスト用の偽DOM＋偽THREE。index.html のスクリプトをNode上で実行して、画面なしで挙動を検証するための部品。
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),coreSrc=fs.readFileSync(path.join(root,'game-core.js'),'utf8');
assert(html.indexOf('three.min.js')<html.indexOf('src="game-core.js"')&&html.indexOf('src="game-core.js"')<html.lastIndexOf('<script>'),'読み込み順: THREE → game-core.js → 本体');
const stub=(()=>{const f=function(){};const p=new Proxy(f,{get:(t,k)=>k===Symbol.toPrimitive?()=>0:(k==='length'?0:p),set:()=>true,apply:()=>p,construct:()=>p,has:()=>true});return p})();
class El{constructor(id,cls){this.id=id;this.cl=new Set((cls||'').split(/\s+/).filter(Boolean));this.style={};this.children=[];this._t='';this.innerHTML='';this.value='';this.scrollTop=0;this.scrollHeight=0;this.clientHeight=0;this.L={};this.onclick=null;
 this.classList={add:(...c)=>c.forEach(x=>this.cl.add(x)),remove:(...c)=>c.forEach(x=>this.cl.delete(x)),contains:c=>this.cl.has(c),toggle:(c,on)=>{const w=on===undefined?!this.cl.has(c):!!on;w?this.cl.add(c):this.cl.delete(c);return w}}}
 get textContent(){return this._t}set textContent(v){this._t=String(v);this.children=[]}
 appendChild(c){this.children.push(c);return c}removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1)}get firstChild(){return this.children[0]}
 remove(){}setAttribute(k,v){this.attrs=this.attrs||{};this.attrs[k]=v}querySelectorAll(){return[]}addEventListener(t,f){(this.L[t]=this.L[t]||[]).push(f)}focus(){}blur(){}select(){}getContext(){return stub}closest(){return null}
 set className(v){this.cl=new Set(String(v).split(/\s+/).filter(Boolean))}get className(){return[...this.cl].join(' ')}}
function makeCtx(shared){
 const els={};for(const m of html.matchAll(/<[a-z0-9]+\b[^>]*\bid="([^"]+)"[^>]*>/gi)){const c=/class="([^"]*)"/.exec(m[0]);els[m[1]]=new El(m[1],c?c[1]:'')}
 const doc={getElementById:id=>els[id]||(els[id]=new El(id)),createElement:()=>new El(''),addEventListener(t,f){(ctx.__L[t]=ctx.__L[t]||[]).push(f)},body:{appendChild(){},insertAdjacentHTML(p,h){console.log('INIT-ERROR:',h.replace(/<[^>]+>/g,' '))},cl:new Set(),classList:{add(c){doc.body.cl.add(c)},remove(c){doc.body.cl.delete(c)},contains:c=>doc.body.cl.has(c),toggle(c,on){(on===undefined?!doc.body.cl.has(c):on)?doc.body.cl.add(c):doc.body.cl.delete(c)}}},hidden:false};
 const store=()=>{const s={};return{getItem:k=>(k in s?s[k]:null),setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]}}};
 class FakeWS{constructor(u){this.url=u;this.readyState=0;this.sent=[];ctx.__ws.push(this)}send(s){this.sent.push(JSON.parse(s))}close(){this.readyState=3}}
 const ctx={THREE:stub,document:doc,console,Math,Date,JSON,Object,Array,Set,Map,Promise,Number,String,Symbol,RegExp,Error,URLSearchParams,AbortController,
  setTimeout,clearTimeout,setInterval,clearInterval,performance,innerWidth:1280,innerHeight:720,devicePixelRatio:1,
  requestAnimationFrame(){},addEventListener(t,f){(ctx.__L[t]=ctx.__L[t]||[]).push(f)},__L:{},location:{search:''},sessionStorage:store(),localStorage:(shared&&shared.localStorage)||store(),navigator:{},
  fetch:()=>Promise.reject(new Error('offline')),WebSocket:FakeWS,__ws:[],__els:els};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(coreSrc,ctx);
 const a=html.lastIndexOf('<script>\n"use strict"');vm.runInContext(html.slice(a+8,html.lastIndexOf('</script>')),ctx);return ctx}
const run=(ctx,code)=>vm.runInContext(code,ctx);
const fire=(ctx,type,ev)=>{for(const f of (ctx.__L[type]||[]))f(Object.assign({repeat:false,target:{tagName:'BODY'},preventDefault(){}},ev))};
const endCine=(g)=>{let n=0;while(g.state==='cine'&&n++<50){g.v.skipCine();g.v.render(.016,1)}};


module.exports={makeCtx,run,fire,endCine,html,coreSrc,stub,El};
