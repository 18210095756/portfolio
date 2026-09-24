import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 10100 + (process.pid % 300);
const VW=1600, VH=900;
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_rest`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
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
  // 鼠标停在空白处（不触发任何 hover）
  for(let i=0;i<40;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:20,button:'none',buttons:0}); await sleep(40); }
  await sleep(1800);
  const st=await send('Runtime.evaluate',{expression:`(function(){
    var img=document.querySelector('.iwks__img');
    return JSON.stringify({imgO:getComputedStyle(img).opacity, solidO:getComputedStyle(document.querySelector('.iwks__solid')).opacity,
      bg:getComputedStyle(img).backgroundImage.slice(0,60)});
  })()`,returnByValue:true});
  console.log('REST', JSON.parse(st.result.result.value));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('_in_works_rest.png',Buffer.from(shot.result.data,'base64'));
  console.log('shot saved');
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
