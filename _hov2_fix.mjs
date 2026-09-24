import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9900 + (process.pid % 300);
const VW=1600, VH=900;
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_hov`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
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
  // 滚到第二屏钉住段
  await send('Runtime.evaluate',{expression:'window.scrollTo(0,900)',returnByValue:true});
  for(let i=0;i<40;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:450,button:'none',buttons:0}); await sleep(40); }
  await sleep(1800);
  // 量 works 卡中心（在视口内）
  const loc=await send('Runtime.evaluate',{expression:`(function(){
    var el=document.querySelector('.ibox--works'); var b=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2), rect:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]});
  })()`,returnByValue:true});
  const info=JSON.parse(loc.result.result.value);
  console.log('works center at', info.x, info.y, 'rect', info.rect);
  // 先移到旁边再进卡，触发 hover
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:50,y:50,button:'none',buttons:0});
  await sleep(300);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:info.x,y:info.y,button:'none',buttons:0});
  await sleep(700);
  const aft=await send('Runtime.evaluate',{expression:`(function(){
    return JSON.stringify({img:getComputedStyle(document.querySelector('.iwks__img')).opacity,
      solid:getComputedStyle(document.querySelector('.iwks__solid')).opacity,
      ttl:getComputedStyle(document.querySelector('.iwks__ttl')).opacity});
  })()`,returnByValue:true});
  const af=JSON.parse(aft.result.result.value);
  console.log('HOVER', JSON.stringify(af));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('_in_hov_works2.png',Buffer.from(shot.result.data,'base64'));
  console.log('shot saved');
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
