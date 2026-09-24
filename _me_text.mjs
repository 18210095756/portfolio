/* _me_text.mjs — measure the ibox--me intro text block after content change.
   usage: node _me_text.mjs <W> <H> <tag> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9600 + (process.pid % 300);
const VW = Number(process.argv[2] || 1600);
const VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'metext';
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_${TAG}`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
let ws, nextId=0; const pending=new Map(), logs=[];
const send=(method,params={})=>new Promise(res=>{const id=++nextId;pending.set(id,res);ws.send(JSON.stringify({id,method,params}));});
(async()=>{
  let target=null;
  for(let i=0;i<80;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target=l.find(t=>t.type==='page'); if(target)break; }catch(e){} await sleep(250); }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej);});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} if(m.method==='Runtime.exceptionThrown'){logs.push('EXC: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));}});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:VW,height:VH,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url}); await sleep(2000);
  for(let i=0;i<80;i++){ const r=await send('Runtime.evaluate',{expression:'typeof window.__scroll',returnByValue:true}); if(r.result?.result?.value==='object')break; await sleep(500); }
  await send('Runtime.evaluate',{expression:`window.scrollTo(0,${VH})`,returnByValue:true});
  for(let i=0;i<40;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(VW*0.5),y:Math.round(VH*0.5),button:'none',buttons:0}); await sleep(40); const st=await send('Runtime.evaluate',{expression:'scrollY',returnByValue:true}); if((st.result?.result?.value||0)>=VH-1)break; }
  await sleep(1500);
  const loc = await send('Runtime.evaluate',{expression:`(function(){
    var box=document.querySelector('.ibox--me');
    var el=box.getBoundingClientRect();
    var out={};
    var selectors={me:'.ibox--me',handle:'.ibox__handle',ime:'.ime',air:'.ime__air',desc:'.ibox__desc',chips:'.ichips',loc:'.ibox--loc'};
    for(var k in selectors){var n=document.querySelector(selectors[k]); if(!n){out[k]='MISSING';continue;} var r=n.getBoundingClientRect();
      out[k]={t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)};
    }
    // 溢出检查：desc 底部 vs chips 顶部
    var desc=document.querySelector('.ibox__desc').getBoundingClientRect();
    var chips=document.querySelector('.ichips').getBoundingClientRect();
    var loc=document.querySelector('.ibox--loc').getBoundingClientRect();
    return JSON.stringify({vp:{w:innerWidth,h:innerHeight},els:out,
      descToChipsGap:Math.round(chips.top-desc.bottom),
      chipsToLocGap:Math.round(loc.top-chips.bottom),
      overflowBottom:document.querySelector('.ibox--me').scrollHeight>document.querySelector('.ibox--me').clientHeight,
      docH:document.documentElement.scrollHeight});
  })()`,returnByValue:true});
  console.log('ME', loc.result?.result?.value);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('_in_me_'+TAG+'.png',Buffer.from(shot.result.data,'base64'));
  console.log('shot saved _in_me_'+TAG+'.png  logs='+(logs.length?logs.join('|'):'none'));
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
