/* ============================================================
   scroll.js — 第二屏的滚动进度 + 顶栏状态

   ● 只干一件事：把滚动位置换算成 0..1，写进 .intro 上的 --intro-p

   位移全部由 intro.css 的 transform 消费：

     .intro__bg          calc(var(--intro-p) * -5vh)   scale(1 → 1.06)
     .intro__blobs       calc(var(--intro-p) * -9vh)
     .intro__stars       calc(var(--intro-p) * -14vh)
     .ihive              calc(var(--intro-p) * -4vh)
     .ipass__badge       calc(var(--intro-p) * -2.4vh)

   ⚠️ 写 CSS 变量而不是直接写元素样式：一圈 transform 都挂在同一个变量上，
   一次赋值驱动五个图层，省掉五次 style 写入；而且倍率这种"设计参数"留在
   CSS 里、和布局挨着看，比散在 JS 里好改。

   ⚠️ 变量写在 .intro 元素上，不是 :root。自定义属性一变，所有用到它的元素
   都要重算样式；挂在 :root 上等于每帧重算整页（含首页那几百个节点）。

   ● 缓动

   --intro-p 走一格 lerp。sticky 钉住本身就是 1:1 的，背景层再慢半拍才像
   "有厚度"；而且滚动是离散事件（滚轮一格一格跳），缓动把它抹平。
   差值小到看不见就停帧 —— 不然 rAF 会一直空转。

   ● 钉住段的进度怎么算

   文档结构是 .stage(fixed) + .nav(fixed) + .intro(margin-top:100vh, 190vh)。

     滚动  0 → 100vh   入场段：pin 还在视口下方，整屏 1× 往上走
     滚动 100vh → 190vh 钉住段：pin 咬住视口，内部各层错速位移

   所以 pin 段的行程是 90vh，进度 = (scrollY - vh) / (0.9 * vh)。
   ============================================================ */
(function () {
  'use strict';

  var intro = document.getElementById('intro');
  if (!intro) return;

  var docRoot = document.documentElement;
  var clockEl = document.getElementById('locClock');

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* 窄屏在 intro.css 里取消了 sticky 和所有联动位移，这里也没必要再算 */
  var narrow = window.matchMedia('(max-width: 900px)');

  var PIN_RATIO = 0.9;   /* 钉住段行程 = 0.9 × 视口高，与 .intro 的 190vh 配对 */
  var EASE = 0.14;       /* lerp 系数 */
  var SNAP = 0.0006;     /* 小于这个差值直接归位、停帧 */
  var INTRO_AT = 0.45;   /* 滚过入场段 45% 就切 is-intro（顶栏开始压暗） */

  var vh = window.innerHeight;
  var cur = -1;          /* -1 = 还没初始化过 */
  var target = 0;
  var running = false;
  var lastIntro = false;

  function measure() {
    vh = window.innerHeight || docRoot.clientHeight;
  }

  function computeTarget() {
    if (narrow.matches || reduce) return 0;
    var p = (window.pageYOffset - vh) / (PIN_RATIO * vh);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function apply(p) {
    intro.style.setProperty('--intro-p', p.toFixed(4));
  }

  function syncIntroClass() {
    var on = window.pageYOffset > INTRO_AT * vh;
    if (on !== lastIntro) {
      lastIntro = on;
      docRoot.classList.toggle('is-intro', on);
      if (on) measure();          /* 顶栏高度/视口可能刚变过，重新量一次 */
    }
  }

  /* 盖满之后首页三个画布（scene / warp / trail）再渲染就是纯浪费，
     scene 的 bloom 有 4 趟 mip pass 最贵。三个文件都监听 'introcover'，
     detail=true=被盖住。判定线是"第二屏顶边到达视口顶"= scrollY >= vh，
     比 is-intro 的 0.45vh 晚 —— 因为 0.45vh 时首页还看得见一半。 */
  var lastCover = false;
  function syncCover() {
    var cover = window.pageYOffset >= vh - 1;
    if (cover === lastCover) return;
    lastCover = cover;
    document.dispatchEvent(new CustomEvent('introcover', { detail: cover }));
  }

  function setActive(index) {
    var items = document.querySelectorAll('.pill-nav__item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', i === index);
    }
  }

  /* 首屏没进第二屏时高亮「首页」，进去之后高亮「关于我」。 */
  var wasIntro = null;
  function syncActive() {
    var on = lastIntro;
    if (on === wasIntro) return;
    wasIntro = on;
    setActive(on ? 1 : 0);
  }

  function frame() {
    /* -- 滚动进度 -- */
    var d = target - cur;
    var scrollDone;
    if (Math.abs(d) < SNAP) {
      cur = target;
      apply(cur);
      scrollDone = true;
    } else {
      cur += d * EASE;
      apply(cur);
      scrollDone = false;
    }

    /* -- 指针跟随（平移 + 倾斜 + 眩光位置，比滚动进度更软的一点系数） -- */
    var tiltDone = true;
    if (passCard) {
      var a = easePair(tilt);
      var b = easePair(shift);
      var c = easePair(pf);
      if (a !== false || b !== false || c !== false) applyPass();  /* 含本帧刚好落位的那一次 */
      if (a === true || b === true || c === true) tiltDone = false;
    }

    if (!scrollDone || !tiltDone) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function onScroll() {
    target = computeTarget();
    syncIntroClass();
    syncCover();
    syncActive();
    if (cur < 0) {              /* 首次：直接落位，不要从 0 缓动过去 */
      cur = target;
      apply(cur);
      return;
    }
    kick();
  }

  /* ---------------- 顶栏条目：点击滚到对应位置 ---------------- */

  var items = document.querySelectorAll('.pill-nav__item');
  for (var i = 0; i < items.length; i++) {
    (function (el, idx) {
      el.addEventListener('click', function (ev) {
        var href = el.getAttribute('href') || '';
        if (href.charAt(0) !== '#') return;
        ev.preventDefault();
        if (idx === 0) {
          window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        } else if (href.length > 1 && document.getElementById(href.slice(1))) {
          var el2 = document.getElementById(href.slice(1));
          window.scrollTo({
            top: el2.getBoundingClientRect().top + window.pageYOffset,
            behavior: reduce ? 'auto' : 'smooth'
          });
        }
      });
    })(items[i], i);
  }

  /* ---------------- 身份卡的指针跟随 ----------------

     第二十四轮按用户要求：卡不随滚动翻转了，照片面永远朝前。
     第二十五轮换成真照片并移植 reactbits ProfileCard 的效果后，指针
     扫过卡面驱动四组变量（全写在 .ibox--pass 上，卡内各层继承）：
       --tilt-x/y   小角度倾斜（±9°/±7°，翻不到背面）
       --shift-x/y  整卡朝指针方向轻微平移（±10/±8px）
       --pfx/pfy    指针在卡内的位置 0..1 —— 眩光圆心 + 照片/文字反向微视差
       --spot       眩光开关 0/1（不缓动，CSS transition 淡入淡出）
     这里只负责缓动到位，transform/渐变全在 intro.css 里。 */

  var passCard = document.querySelector('.ibox--pass');
  var tilt  = { gx: 0, gy: 0, x: 0, y: 0 };   /* 角度（deg），g = 目标值 */
  var shift = { gx: 0, gy: 0, x: 0, y: 0 };   /* 平移（px） */
  var pf    = { gx: 0.5, gy: 0.5, x: 0.5, y: 0.5 }; /* 指针在卡内的位置 0..1，驱动眩光和分层微视差 */
  var spotOn = false;
  var TILT_EASE = 0.09;

  /* 返回 true = 还在动（要续帧）；2 = 本帧落位（写最后一次样式，不续帧）；false = 没事 */
  function easePair(o) {
    var dx = o.gx - o.x;
    var dy = o.gy - o.y;
    if (Math.abs(dx) > 0.008 || Math.abs(dy) > 0.008) {
      o.x += dx * TILT_EASE;
      o.y += dy * TILT_EASE;
      return true;
    }
    if (o.x !== o.gx || o.y !== o.gy) {
      o.x = o.gx;
      o.y = o.gy;
      return 2;
    }
    return false;
  }

  function applyPass() {
    if (!passCard) return;
    passCard.style.setProperty('--tilt-x', tilt.x.toFixed(3));
    passCard.style.setProperty('--tilt-y', tilt.y.toFixed(3));
    passCard.style.setProperty('--shift-x', shift.x.toFixed(2));
    passCard.style.setProperty('--shift-y', shift.y.toFixed(2));
    passCard.style.setProperty('--pfx', pf.x.toFixed(4));
    passCard.style.setProperty('--pfy', pf.y.toFixed(4));
  }

  if (passCard && !reduce && !narrow.matches) {
    passCard.addEventListener('pointermove', function (e) {
      var r = passCard.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      var ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (nx > 1) nx = 1; else if (nx < -1) nx = -1;
      if (ny > 1) ny = 1; else if (ny < -1) ny = -1;
      tilt.gy = nx * 9;       /* 左右看 → 绕 Y 转（封顶 9°，离 90° 远） */
      tilt.gx = ny * -7;      /* 上下看 → 绕 X 转（方向反着才像"被推"） */
      shift.gx = nx * 10;     /* 轻微跟随：朝指针方向平移一点点 */
      shift.gy = ny * 8;
      pf.gx = (nx + 1) / 2;   /* 卡内位置 0..1：眩光圆心 + 照片/文字反向微视差 */
      pf.gy = (ny + 1) / 2;
      if (!spotOn) {          /* 眩光不缓动，交给 CSS transition 淡入 */
        spotOn = true;
        passCard.style.setProperty('--spot', '1');
      }
      kick();
    }, { passive: true });

    passCard.addEventListener('pointerleave', function () {
      tilt.gx = 0;
      tilt.gy = 0;
      shift.gx = 0;
      shift.gy = 0;
      pf.gx = 0.5;            /* 归中（ProfileCard 的 toCenter） */
      pf.gy = 0.5;
      spotOn = false;
      passCard.style.setProperty('--spot', '0');
      kick();
    }, { passive: true });
  }

  /* ---------------- 上海本地时间（GMT+8） ----------------
     不走 Intl 的 timeZone：手算偏移在任何环境下结果都一样，
     也不用担心某些精简版浏览器缺时区数据。签到秒级没必要，20s 一次。 */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function tickClock() {
    if (!clockEl) return;
    var d = new Date();
    var sh = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
    clockEl.textContent = pad(sh.getHours()) + ':' + pad(sh.getMinutes());
  }

  /* ---------------- 接线 ---------------- */

  measure();
  tickClock();
  if (clockEl) setInterval(tickClock, 20000);

  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; onScroll(); });
  }, { passive: true });

  window.addEventListener('resize', function () {
    measure();
    onScroll();
  });

  if (narrow.addEventListener) {
    narrow.addEventListener('change', function () {
      cur = -1;
      onScroll();
    });
  }

  /* Webfont 落地会改字号 → 视口高度不变，但顶栏高度可能变，重新量一次 */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measure(); onScroll(); }).catch(function () {});
  }

  onScroll();

  /* 无头验收用：跳过缓动，一次把进度落到位（rAF 在无头里被节流，
     否则探针要等好几秒才看到目标值）。 */
  window.__scroll = {
    at: function (p) {
      cur = target = p;
      apply(p);
      return cur;
    },
    info: function () {
      return JSON.stringify({
        y: Math.round(window.pageYOffset),
        vh: vh,
        target: +target.toFixed(4),
        cur: +cur.toFixed(4),
        intro: lastIntro,
        cover: lastCover,
        isIntro: docRoot.classList.contains('is-intro')
      });
    }
  };
})();
