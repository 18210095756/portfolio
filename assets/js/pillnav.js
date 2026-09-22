/* ============================================================
   pillnav.js — 胶囊导航（效果参考 reactbits.com/components/pill-nav）

   一颗圆从条目底边中心扩张成整颗胶囊，把条目"融进"外壳的奶油色；同时原
   label 向上滑出、深色 label 从下方升入 —— 读起来像条目自己变成了实心。
   鼠标进入 0.3s、离开 0.2s（参照实现的进慢出快）。

   ● 为什么几何必须算、不能写死

   参照实现把一颗圆放在条目底边，要求它同时过底边两个角、并与顶边相切。
   由条目的宽 w、高 h 解出半径：

       R = (w²/4 + h²) / (2h)

   直径 D = 2R，向下溢出的矢高 delta = R − √(R² − w²/4)，
   而"圆心在底边中点"这件事，直接给出了 transform-origin 该落的元素局部坐标
   y = D − delta。于是「从 scale(0) 张到 scale(1.2)」在任意文字长度下都恰好
   铺满整颗胶囊 —— 中文两字、三字、英文、换字号都不会露边角。

   ● 为什么不用 GSAP

   参照实现靠 GSAP timeline 做两套时长。这里零依赖：时长写进 --pn-dur，
   切换 class 让 CSS 过渡跑。项目是纯静态零构建、双击 index.html 就能开，
   引 React/GSAP 会破坏这个前提。
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('pillNav');
  if (!root) return;

  var list = root.querySelector('.pill-nav__list');
  var logo = root.querySelector('.pill-nav__logo');
  var logoSvg = logo ? logo.querySelector('svg') : null;
  var items = Array.prototype.slice.call(root.querySelectorAll('.pill-nav__item'));
  if (!items.length) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ENTER = 0.30;      // 进入
  var LEAVE = 0.20;      // 离开
  var GROW = 0.60;       // 载入时展开
  var animating = false; // 入场期间不量几何（那时条目被压扁，量出来是错的）

  /* ---------------- 1. 几何 ---------------- */

  function layout() {
    if (animating) return;

    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var circle = el.querySelector('.pill-nav__circle');
      if (!circle) continue;

      // 用 rect 而不是 clientWidth：clientWidth 取整，几十像素的胶囊上
      // 那零点几像素会被放大成圆与胶囊的错位
      var rect = el.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      if (w < 2 || h < 2) continue;          // 隐藏时跳过，不要写入 0

      var R = ((w * w) / 4 + h * h) / (2 * h);
      var D = Math.ceil(2 * R) + 2;
      var delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;

      circle.style.width = D + 'px';
      circle.style.height = D + 'px';
      circle.style.bottom = -delta + 'px';
      circle.style.transformOrigin = '50% ' + (D - delta) + 'px';

      // 两颗 label 的位移量都跟着条目高度走
      el.style.setProperty('--pn-pill-h', h + 'px');
    }
  }

  /* ---------------- 2. 进 / 出 ---------------- */

  function open(el) {
    el.style.setProperty('--pn-dur', (reduce ? 0.001 : ENTER) + 's');
    el.classList.add('is-open');
  }

  function close(el) {
    el.style.setProperty('--pn-dur', (reduce ? 0.001 : LEAVE) + 's');
    el.classList.remove('is-open');
  }

  items.forEach(function (el) {
    el.addEventListener('pointerenter', function () { open(el); });
    el.addEventListener('pointerleave', function () { close(el); });
    // 键盘 Tab 进来也要看得见反馈
    el.addEventListener('focus', function () { open(el); });
    el.addEventListener('blur', function () { close(el); });
  });

  /* ---------------- 3. logo：悬停转一圈 ---------------- */

  if (logo && logoSvg && !reduce) {
    logo.addEventListener('pointerenter', function () {
      logoSvg.style.transition = 'none';
      logoSvg.style.transform = 'rotate(0deg)';
      void logoSvg.offsetWidth;               // 强制回流，否则下面这趟过渡不会启动
      logoSvg.style.transition = 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
      logoSvg.style.transform = 'rotate(360deg)';
    });
  }

  /* ---------------- 4. 载入：logo 放大 + 列表从 0 展开 ---------------- */
  /* 参照实现的 initialLoadAnimation。先量出自然宽度再压到 0，
     否则 flex 会把条目挤扁、量不到真实尺寸。 */

  function entrance() {
    if (reduce || !list) return;

    var target = list.getBoundingClientRect().width;
    if (target < 4) return;

    animating = true;
    list.style.overflow = 'hidden';
    list.style.pointerEvents = 'none';        // 展开过程中不接悬停，避免量错半途的宽
    list.style.width = '0px';

    if (logo) {
      logo.style.transformOrigin = '50% 50%';
      logo.style.transform = 'scale(0)';
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        list.style.transition = 'width ' + GROW + 's cubic-bezier(0.22, 1, 0.36, 1)';
        list.style.width = target + 'px';
        if (logo) {
          logo.style.transition = 'transform ' + GROW + 's cubic-bezier(0.22, 1, 0.36, 1)';
          logo.style.transform = 'scale(1)';
        }
      });
    });

    setTimeout(function () {
      list.style.transition = '';
      list.style.width = '';
      list.style.overflow = '';
      list.style.pointerEvents = '';
      if (logo) {
        logo.style.transition = '';
        logo.style.transform = '';
      }
      animating = false;
      layout();                               // 宽度恢复自然值后重新量一次
    }, GROW * 1000 + 120);
  }

  /* ---------------- 5. 时机 ---------------- */

  layout();
  entrance();

  // 字体换掉、窗口缩放、旋转屏幕都会改变条目宽度 → 圆的直径也得跟着改。
  // 挂在 list 上就顺带覆盖了 webfont 落地引起的那一次宽度变化。
  if (window.ResizeObserver) {
    new ResizeObserver(function () { layout(); }).observe(list || root);
  } else {
    window.addEventListener('resize', function () { layout(); });
  }
  window.addEventListener('orientationchange', function () { layout(); });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      setTimeout(layout, GROW * 1000 + 160);
    }).catch(function () {});
  }
})();
