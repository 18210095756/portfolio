/* ============================================================
   honeycomb-dock.js — 蜂窝社交卡的「放大镜」效果
   （reactbits.dev/components/dock 移植，用户参数 magnification=80）

   原版机制：mouseX 距每个图标中心的线性三角插值
     [-distance, 0, distance] → [base, magnification, base]
   再过一个快弹簧（mass 0.1 / stiffness 150 / damping 12）。
   本站没有 framer-motion，等价手写：二维欧氏距离 + 每帧 lerp
   （0.25 ≈ 那组弹簧参数的跟随速度），收敛后自动停 rAF。

   输出两个 CSS 变量挂在每个格位（.ihx）上，缩放交给 CSS：
     --mag   图标倍率（峰值 1.6 = 80/50，与 Dock 同比例）
     --hmag  六边形倍率（1.18 —— 跟着鼓一点，图标不撑出格子）
   悬停/键盘高亮（hex 亮、标签浮现）仍走 intro.css 的 :hover 规则。

   ⚠️ 不接 prefers-reduced-motion（见下方守卫处的说明）。 */
(function () {
  'use strict';
  var card = document.querySelector('.ibox--social');
  if (!card) return;
  /* ⚠️ 故意**不**看 prefers-reduced-motion。
     理由：这是 ~40px 图标上的「指针邻近」反馈（缩放幅度很小），不是视差/自动播放类的
     大范围动效；而且它是本卡的招牌交互（用户明确要的 reactbits Dock 效果）。
     曾经这里有 `if (reduce) return;`，结果**在报 reduce 的环境里整个效果静默消失**
     （无头 Chrome、部分内嵌 webview 都会报 reduce，排查了很久才定位）。
     如果以后要恢复无障碍策略：改成「reduce 下仍放大、但跳过 lerp 直接落位」比整体不启用好。 */

  var items = Array.prototype.slice.call(card.querySelectorAll('.ihx'));
  if (!items.length) return;

  /* 可调参数：DIST 是影响力半径（约 1.7 个格距），超出不放大 */
  var MAG = 1.6, HEXMAG = 1.18, DIST = 175, EASE = 0.25;

  var mx = -1e4, my = -1e4, raf = 0;
  var st = items.map(function () { return { m: 1, h: 1 }; });

  function tick() {
    var busy = false;
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      var d = Math.hypot(mx - (r.left + r.width / 2), my - (r.top + r.height / 2));
      var t = Math.max(0, 1 - d / DIST);          // 线性衰减，照抄 Dock 的三角插值
      var tm = 1 + (MAG - 1) * t;
      var th = 1 + (HEXMAG - 1) * t;
      var s = st[i];
      s.m += (tm - s.m) * EASE;
      s.h += (th - s.h) * EASE;
      if (Math.abs(tm - s.m) > 0.0015 || Math.abs(th - s.h) > 0.0015) busy = true;
      items[i].style.setProperty('--mag', s.m.toFixed(4));
      items[i].style.setProperty('--hmag', s.h.toFixed(4));
    }
    raf = busy ? requestAnimationFrame(tick) : 0; // 回落到位即停，平时零开销
  }

  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  card.addEventListener('pointermove', function (e) {
    mx = e.clientX; my = e.clientY; kick();
  });
  card.addEventListener('pointerleave', function () {
    mx = my = -1e4; kick();                       // 目标全部回落到 1，收敛后自停
  });
})();
