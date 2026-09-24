/* _dock.mjs — verify the honeycomb Dock magnification.
   Parks the pointer near ONE hex, waits for the lerp to converge, then reads
   --mag on every cell: the near one should be largest, far ones ~1.
   usage: node _dock.mjs <W> <H> <tag> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + (process.pid % 400);
const VW = Number(process.argv[2] || 1600);
const VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'dock';

const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${VW},${VH}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.cwd()}/_cdpws_${process.pid}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 0;
const pending = new Map(), logs = [];
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

async function main() {
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('no page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  /* 无头 Chrome 有时把 prefers-reduced-motion 报成 reduce。默认强制模拟成
     no-preference；设 NO_MEDIA_OVERRIDE=1 可关掉模拟，复现"报 reduce 的环境"
     来验证「效果是否已不再受该开关影响」。 */
  if (process.env.NO_MEDIA_OVERRIDE !== '1') {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1800);
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__scroll', returnByValue: true });
    if (r.result?.result?.value === 'object') break;
    await sleep(500);
  }
  // scroll to pinned intro
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${VH})`, returnByValue: true });
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(VW * 0.5), y: Math.round(VH * 0.5), button: 'none', buttons: 0 });
    await sleep(40);
    const st = await send('Runtime.evaluate', { expression: 'scrollY', returnByValue: true });
    if ((st.result?.result?.value || 0) >= VH - 1) break;
  }
  await sleep(1200);

  // pick the email hex (first .ihx__lnk) center as the park point;
  // scroll it into view ONLY if outside the viewport (narrow screens)
  const loc = await send('Runtime.evaluate', {
    expression: `(function(){
      var el = document.querySelector('.ihx__lnk');
      var docY = el.getBoundingClientRect().top + scrollY;
      var r0 = el.getBoundingClientRect();
      if (r0.top < 0 || r0.bottom > innerHeight) {
        window.scrollTo({ top: Math.max(0, docY - innerHeight * 0.45), behavior: 'instant' });
      }
      var b = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
    })()`,
    returnByValue: true,
  });
  const p = JSON.parse(loc.result?.result?.value || '{}');

  // park the pointer there and keep feeding events while the lerp converges
  for (let i = 0; i < 12; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
    await sleep(60);
  }
  await sleep(300);

  const mags = await send('Runtime.evaluate', {
    expression: `(function(){
      var out = [];
      document.querySelectorAll('.ihx').forEach(function(li){
        var ico = li.querySelector('.ihx__ico');   // orb cell has none
        out.push({ mag: li.style.getPropertyValue('--mag') || '1',
                   ico: ico ? getComputedStyle(ico).transform.slice(0, 40) : '(orb)' });
      });
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });
  const arr = JSON.parse(mags.result?.result?.value || '[]');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_in_dock_' + TAG + '.png', Buffer.from(shot.result.data, 'base64'));

  const magsArr = arr.map((x) => parseFloat(x.mag || '1'));
  const max = Math.max.apply(null, magsArr);
  const min = Math.min.apply(null, magsArr);
  const lines = [
    `tag=${TAG} viewport=${VW}x${VH} parkAt=${p.x},${p.y}`,
    `mags = ${magsArr.map((v) => v.toFixed(2)).join(', ')}`,
    `VERDICT: max=${max.toFixed(2)} (expect ~1.55-1.6 at center) | min=${min.toFixed(2)} (expect ~1.0 far) | ${max > 1.4 && min < 1.05 ? 'GRADIENT OK' : '⚠ gradient missing'}`,
    `logs=${logs.length ? logs.join(' | ') : 'none'}`,
  ];
  fs.writeFileSync('_dock_' + TAG + '.txt', lines.join('\n'));
  console.log(lines.join('\n'));
}

main().catch((e) => {
  fs.writeFileSync('_dock_' + TAG + '.txt', 'FATAL: ' + (e?.stack || e));
  console.error('FATAL', e?.message || e);
  process.exitCode = 1;
}).finally(() => {
  try { ws?.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
});
