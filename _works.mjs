/* _works.mjs — verify the works-overview preview image card.
   usage: node _works.mjs <W> <H> <tag> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9800 + (process.pid % 300);
const VW = Number(process.argv[2] || 1600);
const VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'works';
const CWD = 'C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio';
const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const child = spawn(CHROME, ['--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${VW},${VH}`,`--remote-debugging-port=${PORT}`,`--user-data-dir=${CWD}/_cdpws_${process.pid}`, '--no-first-run','--no-default-browser-check','about:blank'], {stdio:'ignore'});
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
    var el=document.querySelector('.ibox--works'); var img=document.querySelector('.iwks__img');
    var b=el.getBoundingClientRect();
    if(b.top<0||b.bottom>innerHeight){ window.scrollTo({top:Math.max(0,b.top+scrollY-innerHeight*0.45),behavior:'instant'}); }
    b=el.getBoundingClientRect();
    var cs=getComputedStyle(img);
    return JSON.stringify({rect:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],
      bg:cs.backgroundImage.slice(0,70), pos:cs.backgroundPosition, size:cs.backgroundSize,
      imgOpacity:getComputedStyle(img).opacity, solidOpacity:getComputedStyle(document.querySelector('.iwks__solid')).opacity,
      ttlOpacity:getComputedStyle(document.querySelector('.iwks__ttl')).opacity});
  })()`,returnByValue:true});
  const info=JSON.parse(loc.result?.result?.value||'{}');
  // hover 看悬停效果
  const cx=info.rect[0]+info.rect[2]/2, cy=info.rect[1]+info.rect[3]/2;
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(cx),y:Math.round(cy),button:'none',buttons:0});
  await sleep(600);
  const aft=await send('Runtime.evaluate',{expression:`(function(){
    return JSON.stringify({imgOpacity:getComputedStyle(document.querySelector('.iwks__img')).opacity,
      solidOpacity:getComputedStyle(document.querySelector('.iwks__solid')).opacity,
      ttlOpacity:getComputedStyle(document.querySelector('.iwks__ttl')).opacity});
  })()`,returnByValue:true});
  const af=JSON.parse(aft.result?.result?.value||'{}');
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('_in_hov_'+TAG+'.png',Buffer.from(shot.result.data,'base64'));
  const lines=[
    `tag=${TAG} vp=${VW}x${VH} rect=[${info.rect.join(',')}]`,
    `bg=${info.bg} pos=${info.pos} size=${info.size}`,
    `REST img=${info.imgOpacity} solid=${info.solidOpacity} ttl=${info.ttlOpacity}`,
    `HOVER img=${af.imgOpacity} solid=${af.solidOpacity} ttl=${af.ttlOpacity}`,
    `VERDICT bg=${info.bg.includes('works-overview.jpg')?'OK':'⚠ not works-overview'} | hover-solid=${Number(af.solidOpacity)>0.9?'OK':'NOT'} | hover-img=${Number(af.imgOpacity)<0.1?'OK':'NOT'} | hover-ttl=${Number(af.ttlOpacity)>0.9?'OK':'NOT'}`,
    `logs=${logs.length?logs.join(' | '):'none'}`,
  ];
  fs.writeFileSync('_hx_'+TAG+'.txt',lines.join('\n'));
  console.log(lines.join('\n'));
})().catch(e=>{fs.writeFileSync('_hx_'+TAG+'.txt','FATAL: '+(e?.stack||e));console.error('FATAL',e?.message||e);process.exitCode=1;}).finally(()=>{try{ws?.close();}catch{} try{child.kill();}catch{} setTimeout(()=>process.exit(process.exitCode||0),300);});
