/* _gpt.mjs — verify the GPT single-line icon in the honeycomb card.
   Scrolls to the intro, hovers the GPT hex, full-viewport screenshot (1x,
   no clip) + reads computed styles. The PNG is then cropped via Python.
   usage: node _gpt.mjs <W> <H> <tag> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + (process.pid % 400);
const VW = Number(process.argv[2] || 1600);
const VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'gpt';

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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
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
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(VW * 0.5), y: Math.round(VH * 0.5), button: 'none', buttons: 0 });
    await sleep(40);
    const st = await send('Runtime.evaluate', { expression: 'scrollY', returnByValue: true });
    if ((st.result?.result?.value || 0) >= VH - 1) break;
  }
  await sleep(1200);

  // locate the GPT hex (aria-label="GPT")
  const loc = await send('Runtime.evaluate', {
    expression: `(function(){
      var lnk = document.querySelector('.ihx__lnk[aria-label="GPT"]');
      var r0 = lnk.getBoundingClientRect();
      if (r0.top < 0 || r0.bottom > innerHeight) {
        var docY = r0.top + scrollY;
        window.scrollTo({ top: Math.max(0, docY - innerHeight * 0.45), behavior: 'instant' });
      }
      var b = lnk.getBoundingClientRect();
      var hex = lnk.parentElement.querySelector('.ihx__hex');
      var hb = hex.getBoundingClientRect();
      var ico = lnk.querySelector('.ihx__ico');
      var svg = ico.outerHTML.slice(0, 260);
      return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
        icoW: Math.round(ico.getBoundingClientRect().width), icoH: Math.round(ico.getBoundingClientRect().height),
        hexFill: getComputedStyle(hex).fill, hexStroke: getComputedStyle(hex).stroke,
        icoT: getComputedStyle(ico).transform,
        tagO: getComputedStyle(lnk.parentElement.querySelector('.ihx__tag')).opacity,
        hexRect: [Math.round(hb.left), Math.round(hb.top), Math.round(hb.width), Math.round(hb.height)],
        svg: svg });
    })()`,
    returnByValue: true,
  });
  const before = JSON.parse(loc.result?.result?.value || '{}');

  // NOHOVER=1 → skip the hover step, capture the resting state instead
  if (!process.env.NOHOVER) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y, button: 'none', buttons: 0 });
    await sleep(450);
    for (let i = 0; i < 6; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y, button: 'none', buttons: 0 });
      await sleep(60);
    }
  }

  const after = await send('Runtime.evaluate', {
    expression: `(function(){
      var lnk = document.querySelector('.ihx__lnk[aria-label="GPT"]');
      var hex = lnk.parentElement.querySelector('.ihx__hex');
      return JSON.stringify({ hexFill: getComputedStyle(hex).fill, hexStroke: getComputedStyle(hex).stroke,
        icoT: getComputedStyle(lnk.querySelector('.ihx__ico')).transform,
        tagO: getComputedStyle(lnk.parentElement.querySelector('.ihx__tag')).opacity });
    })()`,
    returnByValue: true,
  });
  const aft = JSON.parse(after.result?.result?.value || '{}');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_in_hov_' + TAG + '.png', Buffer.from(shot.result.data, 'base64'));

  const lines = [
    `tag=${TAG} viewport=${VW}x${VH} GPT at ${before.x},${before.y} ico=${before.icoW}x${before.icoH}`,
    `BEFORE fill=${before.hexFill} stroke=${before.hexStroke} tagO=${before.tagO}`,
    `AFTER  fill=${aft.hexFill} stroke=${aft.hexStroke} tagO=${aft.tagO}`,
    `icoT before=${before.icoT}`,
    `icoT after =${aft.icoT}`,
    `hexRect=[${before.hexRect.join(',')}]`,
    `VERDICT fill: ${aft.hexFill !== before.hexFill ? 'hex lit OK' : '⚠ hex NOT lit'} | tag: ${Number(aft.tagO) > 0.9 ? 'visible OK' : 'NOT visible'} | ico: ${aft.icoT !== 'none' && aft.icoT !== before.icoT ? 'transformed OK' : 'NOT transformed'}`,
    `logs=${logs.length ? logs.join(' | ') : 'none'}`,
    `svg=${before.svg}`,
  ];
  fs.writeFileSync('_hx_' + TAG + '.txt', lines.join('\n'));
  console.log(lines.join('\n'));
}

main().catch((e) => {
  fs.writeFileSync('_hx_' + TAG + '.txt', 'FATAL: ' + (e?.stack || e));
  console.error('FATAL', e?.message || e);
  process.exitCode = 1;
}).finally(() => {
  try { ws?.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
});
