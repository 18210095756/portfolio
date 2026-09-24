/* _iconshot.mjs — screenshot an arbitrary local page.
   usage: node _iconshot.mjs <file> <W> <H> <outPng> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + (process.pid % 400);
const FILE = process.argv[2] || '_icons/_test.html';
const VW = Number(process.argv[3] || 900);
const VH = Number(process.argv[4] || 900);
const OUT = process.argv[5] || '_icons/_test.png';

const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/' + FILE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${VW},${VH}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${process.cwd()}/_cdpws_${process.pid}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 0;
const pending = new Map();
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1500);
  const h = await send('Runtime.evaluate', {
    expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true });
  const H = Math.max(VH, h.result?.result?.value || VH);
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', OUT, VW + 'x' + H);
}

main().catch((e) => { console.error('FATAL', e?.message || e); process.exitCode = 1; })
  .finally(() => {
    try { ws?.close(); } catch {}
    try { child.kill(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  });
