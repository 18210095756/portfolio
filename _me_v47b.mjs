/* _me_v47b.mjs — re-measure ibox--me after chips removal */
import { spawn } from 'node:child_process';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9500 + (process.pid % 300);
const VW = 1600, VH = 900;
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_v47b`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
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
    var sel={me:'.ibox--me',desc:'.ibox__desc',chips:'.ichips',loc:'.ibox--loc'};
    var out={};
    for(var k in sel){ var n=document.querySelector(sel[k]); if(!n){ out[k]={missing:true}; continue; }
      var b=n.getBoundingClientRect(); out[k]={t:Math.round(b.top),b:Math.round(b.bottom),h:Math.round(b.height),w:Math.round(b.width)}; }
    var me=document.querySelector('.ibox--me'); var desc=document.querySelector('.ibox__desc');
    var loc=document.querySelector('.ibox--loc');
    out.gap_desc_to_me_bottom=Math.round(me.getBoundingClientRect().bottom-desc.getBoundingClientRect().bottom);
    out.gap_me_to_loc=Math.round(loc.getBoundingClientRect().top-me.getBoundingClientRect().bottom);
    out.meScroll=me.scrollHeight>me.clientHeight;
    return JSON.stringify(out);
  })()`,returnByValue:true});
  console.log('RESULT:', r.result?.result?.value);
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
