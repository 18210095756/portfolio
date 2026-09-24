/* _me_v48.mjs — verify ime title change + capture */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + (process.pid % 300);
const VW = 1600, VH = 900;
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_v48`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
(async()=>{
  let target=null;
  for(let i=0;i<80;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target=l.find(t=>t.type==='page'); if(target)break; }catch(e){} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ ws.addEventListener('open',r); ws.addEventListener('error',j); });
  let id=0; const pend=new Map();
  ws.addEventListener('message',ev=>{ const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); } });
  const send=(method,params={})=>new Promise(res=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:VW,height:VH,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html'});
  await sleep(2000);
  for(let i=0;i<80;i++){ const r=await send('Runtime.evaluate',{expression:'typeof window.__scroll',returnByValue:true}); if(r.result?.result?.value==='object')break; await sleep(500); }
  await send('Runtime.evaluate',{expression:'window.scrollTo(0,900)',returnByValue:true});
  for(let i=0;i<40;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:450,button:'none',buttons:0}); await sleep(40); const st=await send('Runtime.evaluate',{expression:'scrollY',returnByValue:true}); if((st.result?.result?.value||0)>=899)break; }
  await sleep(1500);
  const r=await send('Runtime.evaluate',{expression:`(function(){
    var l1=document.querySelector('.ime__l1'); var l2=document.querySelector('.ime__l2');
    var b1=l1.getBoundingClientRect(), b2=l2.getBoundingClientRect();
    var me=document.querySelector('.ibox--me').getBoundingClientRect();
    return JSON.stringify({
      l1:{text:l1.textContent,w:Math.round(b1.width),h:Math.round(b1.height)},
      l2:{text:l2.textContent,w:Math.round(b2.width),h:Math.round(b2.height)},
      meW:Math.round(me.width), l2Fits:b2.right<=me.right,
      l2Overflow:Math.round(b2.right-me.right)
    });
  })()`,returnByValue:true});
  console.log('TITLE:', r.result?.result?.value);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('_in_me_v48.png',Buffer.from(shot.result.data,'base64'));
  console.log('shot saved _in_me_v48.png');
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
