/* _click.mjs — 验证蜂窝格位「纯视觉、无点击跳转」：
   ① 卡内 <a> 数量应为 0，.ihx__lnk 已全是 span
   ② hover 仍能点亮六边形 / 浮出标签 / 触发 Dock --mag
   ③ 真实点一下：URL 的 hash 不出现、scrollY 不动 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + (process.pid % 400);
const VW = Number(process.argv[2] || 1600), VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'click';
const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${VW},${VH}`, `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.cwd()}/_cdpws_${process.pid}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 0;
const pending = new Map(), logs = [];
const send = (m, p = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });

async function main() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break; } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('no page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1800);
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__scroll', returnByValue: true });
    if (r.result?.result?.value === 'object') break;
    await sleep(500);
  }
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${VH})`, returnByValue: true });
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: VW >> 1, y: VH >> 1, button: 'none', buttons: 0 });
    await sleep(40);
    const st = await send('Runtime.evaluate', { expression: 'scrollY', returnByValue: true });
    if ((st.result?.result?.value || 0) >= VH - 1) break;
  }
  await sleep(1200);

  const shape = await send('Runtime.evaluate', { expression: `(function(){
    var card = document.querySelector('.ibox--social');
    var lnks = card.querySelectorAll('.ihx__lnk');
    return JSON.stringify({
      anchorsInCard: card.querySelectorAll('a').length,
      anchorsInDoc: document.querySelectorAll('a').length,
      lnkCount: lnks.length,
      tags: [].map.call(lnks, function(x){ return x.tagName + '/' + x.getAttribute('role'); }),
      firstHref: lnks[0].getAttribute('href'),
      cursor: getComputedStyle(lnks[0]).cursor
    });
  })()`, returnByValue: true });
  console.log('SHAPE:', shape.result?.result?.value);

  const loc = await send('Runtime.evaluate', { expression: `(function(){
    var el = document.querySelectorAll('.ihx__lnk')[0];
    var b = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2), scrollY: Math.round(scrollY) });
  })()`, returnByValue: true });
  const p = JSON.parse(loc.result?.result?.value || '{}');

  /* hover */
  for (let i = 0; i < 16; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
    await sleep(70);
  }
  const hov = await send('Runtime.evaluate', { expression: `(function(){
    var li = document.querySelectorAll('.ihx')[0];
    var hex = li.querySelector('.ihx__hex'), tag = li.querySelector('.ihx__tag'), ico = li.querySelector('.ihx__ico');
    return JSON.stringify({ hexFill: getComputedStyle(hex).fill, hexStroke: getComputedStyle(hex).stroke,
      tagO: getComputedStyle(tag).opacity, mag: li.style.getPropertyValue('--mag'),
      icoT: getComputedStyle(ico).transform });
  })()`, returnByValue: true });
  console.log('HOVER:', hov.result?.result?.value);

  /* 真实点击：按下 + 抬起 */
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  const after = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hash: location.hash, href: location.href.indexOf('#') >= 0, scrollY: Math.round(scrollY) })`, returnByValue: true });
  console.log('AFTER CLICK:', after.result?.result?.value, '| scrollY before =', p.scrollY);
  console.log('logs=', logs.length ? logs.join(' | ') : 'none');
}

main().catch((e) => { console.error('FATAL', e?.message || e); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} try { child.kill(); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 300); });
