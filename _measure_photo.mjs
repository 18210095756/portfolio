import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9600 + (process.pid % 300);
const VW = 1600, VH = 900;
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_meas`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  let target=null;
  for(let i=0;i<80;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target=l.find(t=>t.type==='page'); if(target)break; }catch(e){} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej);});
  let id=0; const pend=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
  const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:VW,height:VH,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html'});
  await sleep(2000);
  for(let i=0;i<80;i++){ const r=await send('Runtime.evaluate',{expression:'typeof window.__scroll',returnByValue:true}); if(r.result?.result?.value==='object')break; await sleep(500); }
  await send('Runtime.evaluate',{expression:'window.scrollTo(0,900)',returnByValue:true});
  await sleep(1500);
  const r = await send('Runtime.evaluate',{expression:`(function(){
    var p = document.querySelector('.ipass__photo');
    var c = p.closest('.ipass__card');
    var b = p.getBoundingClientRect();
    var cb = c.getBoundingClientRect();
    var cs = getComputedStyle(p);
    return JSON.stringify({photo: [Math.round(b.width), Math.round(b.height)], card: [Math.round(cb.width), Math.round(cb.height)],
      bg: cs.backgroundImage.slice(0,60), pos: cs.backgroundPosition, size: cs.backgroundSize, scale: cs.transform});
  })()`, returnByValue:true});
  console.log(JSON.parse(r.result.result.value));
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
