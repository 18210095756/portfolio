/* _gap.mjs — verify the nav↔panel gap introduced for the intro screen.
   Measures rects at the pinned scroll position, plus the me-content fit.
   usage: node _gap.mjs <W> <H> <tag> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + (process.pid % 400);

const VW = Number(process.argv[2] || 1600);
const VH = Number(process.argv[3] || 900);
const TAG = process.argv[4] || 'gap';

const url = 'file:///C:/Users/admin/WorkBuddy/2026-09-21-17-41-08/portfolio/index.html';
const out = `_in_${TAG}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILE = path.join(path.resolve('.'), '_cdpws_' + process.pid);

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${VW},${VH}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 0;
const pending = new Map(), logs = [];

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
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
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m); pending.delete(m.id); return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW, height: VH, deviceScaleFactor: 1, mobile: false,
  });

  const loaded = new Promise((res) => {
    const timer = setTimeout(() => res(), 25000);
    const check = (m) => { if (m === 'Page.loadEventFired') { clearTimeout(timer); res(); } };
    // simpler: just sleep enough below
  });

  await send('Page.navigate', { url });
  await sleep(1800);

  // wait for the scroll hook (Google Fonts link may block scripts offline)
  let hook = false;
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', {
      expression: 'typeof window.__scroll', returnByValue: true,
    });
    if (r.result?.result?.value === 'object') { hook = true; break; }
    await sleep(500);
  }
  if (!hook) throw new Error('scroll hook never appeared (fonts blocked scripts?)');

  // settle fonts, then measure
  await send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true });
  await sleep(300);

  // measure at TWO positions: home (0) and pinned intro (1x vh).
  // After the scroll we wait 1.2s so the nav's 0.5s height transition is done
  // (CSS transitions are frame-driven; headless throttles frames).
  const snapshot = async (label) =>
    await send('Runtime.evaluate', {
      expression: `(function(){
        function R(sel){ var e=document.querySelector(sel); if(!e) return null;
          var b=e.getBoundingClientRect();
          return {sel:sel, t:+b.top.toFixed(1), b:+b.bottom.toFixed(1),
                  l:+b.left.toFixed(1), r:+b.right.toFixed(1),
                  w:+b.width.toFixed(1), h:+b.height.toFixed(1)}; }
        var out = { vw: innerWidth, vh: innerHeight, scrollY: Math.round(scrollY),
                    isIntro: document.documentElement.classList.contains('is-intro'),
                    htmlClass: document.documentElement.className,
                    navComputedH: getComputedStyle(document.querySelector('.nav')).height };
        out.nav = R('.nav');
        out.panel = R('.intro__panel');
        out.me = R('.ibox--me');
        out.loc = R('.ibox--loc');
        // home page only: nav layout sanity (flex row, children on one line)
        var label = ${JSON.stringify(label)};
        if (label === 'home') {
          var nl = R('.pill-nav'), nc = R('.brand'), nr = R('.nav-right');
          out.navRow = { left: nl, center: nc, right: nr };
        }
        // me content fit: deepest element bottom vs box bottom
        var me = document.querySelector('.ibox--me');
        if (me) {
          var box = me.getBoundingClientRect();
          var maxBottom = 0;
          me.querySelectorAll('*').forEach(function(x){
            var b = x.getBoundingClientRect();
            if (b.bottom > maxBottom) maxBottom = b.bottom;
          });
          out.meFit = { contentBottom: +maxBottom.toFixed(1), boxBottom: +box.bottom.toFixed(1),
                        overflow: +(maxBottom - box.bottom).toFixed(1) };
        }
        return JSON.stringify(out);
      })()`,
      returnByValue: true,
    });
  const label = TAG.replace(/[0-9]+$/, '') || 'pos';

  // --- position 0: home ---
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)', returnByValue: true });
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(VW * 0.5), y: Math.round(VH * 0.4),
      button: 'none', buttons: 0,
    });
    await sleep(40);
    const st = await send('Runtime.evaluate', {
      expression: 'scrollY', returnByValue: true,
    });
    if ((st.result?.result?.value || 0) <= 1) break;
  }
  await sleep(1200);
  const home = JSON.parse((await snapshot('home')).result?.result?.value || '{}');
  const shotHome = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_in_home_' + TAG + '.png', Buffer.from(shotHome.result.data, 'base64'));

  // --- position 1: pinned intro ---
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${VH})`, returnByValue: true });
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(VW * 0.5), y: Math.round(VH * 0.4),
      button: 'none', buttons: 0,
    });
    await sleep(40);
    const st = await send('Runtime.evaluate', {
      expression: 'scrollY', returnByValue: true,
    });
    if ((st.result?.result?.value || 0) >= VH - 1) break;
  }
  await sleep(1200);
  const data = JSON.parse((await snapshot('intro')).result?.result?.value || '{}');
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: VW <= 900,  // narrow screens: full page
  });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));

  const navGap = data.nav && data.panel ? (data.panel.t - data.nav.b).toFixed(1) : 'n/a';

  const lines = [
    `tag=${TAG} viewport=${VW}x${VH}`,
    `--- home (scrollY=${home.scrollY}) ---`,
    `nav      t=${home.nav?.t} b=${home.nav?.b} h=${home.nav?.h}`,
  ];
  if (home.navRow) {
    const r = home.navRow;
    const oneLine = r.left && r.center && r.right &&
      r.left.t === r.center.t && r.center.t === r.right.t;
    lines.push(`navRow   left t=${r.left?.t} l=${r.left?.l} | center t=${r.center?.t} l=${r.center?.l} | right t=${r.right?.t} l=${r.right?.l} => ${oneLine ? 'one row OK' : '⚠ NOT one row'}`);
  }
  lines.push(
    `--- intro (scrollY=${data.scrollY} isIntro=${data.isIntro}) ---`,
    `htmlClass=${data.htmlClass} navComputedH=${data.navComputedH}`,
    `nav      t=${data.nav?.t} b=${data.nav?.b} h=${data.nav?.h}`,
    `panel    t=${data.panel?.t} l=${data.panel?.l} r=${data.panel?.r} b=${data.panel?.b} w=${data.panel?.w} h=${data.panel?.h}`,
    `GAP nav.bottom->panel.top = ${navGap}px`,
    `me       t=${data.me?.t} b=${data.me?.b} w=${data.me?.w} h=${data.me?.h}`,
    `loc      t=${data.loc?.t} b=${data.loc?.b} w=${data.loc?.w} h=${data.loc?.h}`,
  );
  if (data.meFit) {
    const ov = data.meFit.overflow;
    lines.push(`me content=${data.meFit.contentBottom}/${data.meFit.boxBottom} ${ov > 2 ? '⚠ OVERFLOW ' + ov + 'px' : 'ok (fits)'}`);
  }
  lines.push(`shots=${out} + _in_home_${TAG}.png`);
  lines.push(`logs=${logs.length ? logs.join(' | ') : 'none'}`);

  const report = '_gap_' + TAG + '.txt';
  fs.writeFileSync(report, lines.join('\n'));
  console.log(lines.join('\n'));
}

main().catch((e) => {
  fs.writeFileSync('_gap_' + TAG + '.txt', 'FATAL: ' + (e?.stack || e) + '\nlogs=' + logs.join(' | '));
  console.error('FATAL', e?.message || e);
  process.exitCode = 1;
}).finally(() => {
  try { ws?.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(process.exitCode || 0), 300);
});
