/* ============================================================================
   镜面高光胶囊 —— reactbits SpecularButton 的零依赖移植
   ----------------------------------------------------------------------------
   参考 https://www.reactbits.dev/components/specular-button （原版用 React + ogl）。
   本站是纯静态零构建、file:// 直开，所以不引 React / ogl，改成裸 WebGL2 ——
   着色器逐行保留，React 那套 useEffect / useRef 换成普通函数与一个共享的 rAF 循环。

   原版的机制（读源码提炼，不是抄它的 CSS）：

     SpecularButton 画的既不是填充也不是描边，而是**贴着圆角矩形边缘的一道高斯亮线**：

       · 先用 SDF（sdRoundedRect）拿到"到边的距离" d；
       · 亮线 = gaussianLine(d, thickness) —— 只有 |d| ≲ 一两个像素处才有值，
         于是它严格贴着边，胶囊内部完全透明；
       · 再乘一个**角度窗**：把 d 的梯度换成"椭圆法线" nEll（用椭圆近似圆角矩形，
         才能让直边上的夹角连续变化），与光源方向 L 求夹角 φ，
         φ 落在 shineSize ± shineFade 之外就熄灭。
         => 正对光的那段边和背对光的那段边**同时**亮，两段亮弧之间是暗的，
            读起来就是"光从某个方向打过来"。这是它跟普通描边最本质的区别。
       · 另有一圈更暗的贴边描边（base）用来交代"厚度"，参考站是 #525252。

     光源方向追光标：光标在胶囊上时锁到对角线（并随光标在胶囊内的位置轻微摇摆），
     在胶囊外则指向光标方向；亮度随光标距离 smoothstep 渐入（proximity，默认 250px）。
     没有光标时只剩一圈极淡的底描边，角度按 speed 慢慢自转。

   本站的两处适配：
     a. 配色。lineColor 取本页的奶油色；baseColor 从参考的 #525252 换成一支更暗的
        暖灰 —— 参考站底是浅色，"深色描边"才成立；本站底近黑，深色描边等于没有，
        所以它只负责把 CSS 那 1px 边框稍稍加实，不在本页凭空多出一圈亮边。
     b. 尺度。参考按钮 56px 高、thickness=1 设备像素；本站胶囊只有 33px 高，
        同样的线相对更细、几乎看不见，故 thickness 略加粗到 1.3。

   依赖：WebGL2。没有 WebGL2 时画布保持空，胶囊回落到 .btn-ghost 原本的外观。
   ============================================================================ */
(function () {
  'use strict';

  var els = document.querySelectorAll('.btn-specular');
  if (!els.length) return;

  /* 画布相对胶囊四周的外扩量，必须与 CSS 里 .btn-specular__fx 的定位口径一致。
     着色器里 uThickness / uBaseWidth / uPx 都是"设备像素"，画布按 (w + 2*PAD) 起算，
     胶囊中心才落在画布正中。 */
  var PAD = 20;

  var VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position, 0., 1.); }`;

  var FRAG = `#version 300 es
precision highp float;
out vec4 o;

uniform vec2  uCenter, uHalfSize;
uniform float uRadius, uAngle, uPx;
uniform vec3  uLineColor, uBaseColor;
uniform float uIntensity, uShineSize, uShineFade, uThickness, uBaseWidth;

float sdRoundedRect(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}

/* 边缘处的窄高斯。sigma 越小越像一条"刻线"；
   k 随 x 变大（1 → 1.6）让它在 d 的正侧衰减更快一点，高光才贴着边、不糊进胶囊内部。 */
float gaussianLine(float d, float sigma){
  float x = d / (sigma + 1e-6);
  float k = mix(1., 1.6, smoothstep(0., 1.5, x));
  return exp(-k * x * x);
}

void main(){
  vec2  p = gl_FragCoord.xy - uCenter;
  float d = sdRoundedRect(p, uHalfSize, uRadius);
  vec2  L = vec2(cos(uAngle), sin(uAngle));

  // 贴边的底描边（"厚度"），只在 |d| < 一像素处有值
  float base = (1. - smoothstep(0., uBaseWidth, abs(d))) * 0.45;

  // 椭圆法线。圆角矩形的真法线是分段的（直边上处处相同），直接拿去求夹角会让
  // 整条直边同时亮/同时灭，变成色块；用椭圆近似才让夹角沿边连续变化，
  // 高光才会"流动"。
  vec2  nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi  = acos(clamp(abs(dot(nEll, L)), 0., 1.));
  float rim  = 1. - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);

  float line      = gaussianLine(d, uThickness);
  float edgeClamp = 1. - smoothstep(0.5 * uPx, 3. * uPx, abs(d));
  float hi        = line * rim * edgeClamp * uIntensity;

  vec3  col = uBaseColor * base + uLineColor * hi;
  float a   = clamp(base + hi, 0., 1.);
  o = vec4(col, a);         // 预乘输出，配 blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
}`;

  /* ------------------------------------------------------------ 可调参数 */

  var CFG = {
    radius:    999,        // 胶囊：着色器里会 clamp 到 min(w,h)/2
    lineColor: '#f2ebdc',  // 高光颜色 = 本页奶油色
    baseColor: '#3a3835',  // 底描边：极淡暖灰，只把 CSS 边框稍稍加实（见文件头说明 b）
    intensity: 1.5,        // 参考默认 1.0；本站从 .ui-layer 搬到 z6 后画面亮度恢复，
                           // 但参考图里的光弧要更"明显"，再 +50% 才够看。
    shineSize: 14,         // 度：亮弧的半张角。参考默认 10°，本站 +4° 让弧段更宽、好读。
    shineFade: 32,         // 度：亮弧的软边。参考默认 40°，本站 -8° 让"最亮那一段"更锐，
                           // 不至于把整个半圈都软成一团。
    thickness: 1.3,        // 设备像素：亮线粗细（参考站 1.0，本站胶囊更矮故加粗）
    speed:     0.35,       // 弧度/秒：无光标时光源自转
    proximity: 250         // px：光标多近开始点亮
  };

  function hex2rgb(h){
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h);
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  /* --------------------------------------------------------------- 装配 */

  function sh(gl, type, src){
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.error('[specular-btn] shader compile failed\n' + gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function program(gl, fs){
    var p = gl.createProgram();
    var v = sh(gl, gl.VERTEX_SHADER, VERT), f = sh(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'position');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
      console.error('[specular-btn] link failed\n' + gl.getProgramInfoLog(p));
      return null;
    }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++){
      var info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  var LINE = hex2rgb(CFG.lineColor), BASE = hex2rgb(CFG.baseColor);
  var items = [];

  for (var e = 0; e < els.length; e++){
    var el = els[e];
    var cv = el.querySelector('.btn-specular__fx');
    if (!cv) continue;

    var gl = cv.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: true   // 空闲时我们会停掉 rAF，不保留的话底描边会被清掉
    });
    if (!gl) continue;              // 没有 WebGL2：画布留空，回落到 CSS 外观

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var P = program(gl, FRAG);
    if (!P) continue;

    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    items.push({
      el: el, cv: cv, gl: gl, P: P,
      dpr: 1, w: 1, h: 1,
      angle: 2.4,          // 与参考的初值一致
      targetAngle: null,   // null = 还没有光标 → 用自转角度
      prox: 0, bright: 0,
      needResize: true
    });
  }

  if (!items.length) return;

  /* ------------------------------------------------------------- 几何对齐 */

  /* 画布是"绝对定位的子元素"，它的包含块是胶囊的 padding box（边框内侧），
     而着色器描述的是**边框盒**。于是 left/top 必须再减掉边框宽度，
     否则那圈 1px 高光会整体偏出 1px 贴在边框外面。 */
  function resize(it){
    var r = it.el.getBoundingClientRect();
    var w = r.width, h = r.height;
    if (w < 1 || h < 1) return;

    var cs = getComputedStyle(it.el);
    var bx = parseFloat(cs.borderLeftWidth) || 0;
    var by = parseFloat(cs.borderTopWidth) || 0;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    it.dpr = dpr; it.w = w; it.h = h;

    var cw = Math.max(2, Math.round((w + PAD * 2) * dpr));
    var ch = Math.max(2, Math.round((h + PAD * 2) * dpr));
    if (it.cv.width !== cw || it.cv.height !== ch){ it.cv.width = cw; it.cv.height = ch; }

    it.cv.style.width  = (w + PAD * 2) + 'px';
    it.cv.style.height = (h + PAD * 2) + 'px';
    it.cv.style.left   = (-PAD - bx) + 'px';
    it.cv.style.top    = (-PAD - by) + 'px';

    var gl = it.gl;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(it.P.p);
    gl.uniform2f(it.P.u.uCenter, (PAD + w / 2) * dpr, (PAD + h / 2) * dpr);
    gl.uniform2f(it.P.u.uHalfSize, (w / 2) * dpr, (h / 2) * dpr);
    gl.uniform1f(it.P.u.uPx, dpr);
    gl.uniform1f(it.P.u.uBaseWidth, dpr);
    it.radiusPx = Math.min(CFG.radius, Math.min(w, h) / 2) * dpr;

    it.needResize = false;
    it.dirty = true;
  }

  /* --------------------------------------------------------------- 绘制 */

  function draw(it){
    if (it.needResize) resize(it);
    var gl = it.gl, P = it.P;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.p);
    gl.uniform1f(P.u.uAngle, it.angle);
    gl.uniform1f(P.u.uRadius, it.radiusPx);
    gl.uniform3f(P.u.uLineColor, LINE[0], LINE[1], LINE[2]);
    gl.uniform3f(P.u.uBaseColor, BASE[0], BASE[1], BASE[2]);
    gl.uniform1f(P.u.uIntensity, CFG.intensity * it.bright);
    gl.uniform1f(P.u.uShineSize, CFG.shineSize * Math.PI / 180);
    gl.uniform1f(P.u.uShineFade, CFG.shineFade * Math.PI / 180);
    gl.uniform1f(P.u.uThickness, CFG.thickness * it.dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    it.dirty = false;
  }

  /* --------------------------------------------------------------- 状态 */

  var px = -1e5, py = -1e5;          // 光标（视口坐标）
  var raf = 0, last = 0;
  var idleAngle = 2.4;
  var calm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // 光源方向与"接近度"。两段都取自参考实现，包括那个"在胶囊上锁对角线"的特例。
  function steer(it){
    var r = it.el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = Math.max(r.left - px, 0, px - r.right);
    var dy = Math.max(r.top - py, 0, py - r.bottom);
    var dist = Math.hypot(dx, dy);

    if (dist === 0){
      // 光标就在胶囊上：锁到对角线（正好框住两个对角），再随光标在胶囊内的位置轻摇
      var nx = (px - cx) / (r.width / 2);
      var ny = (cy - py) / (r.height / 2);
      it.targetAngle = Math.atan2(2 / r.height, -2 / r.width) + nx * 0.3 + ny * 0.15;
    } else {
      it.targetAngle = Math.atan2(cy - py, px - cx);
    }

    var t = Math.max(0, 1 - dist / Math.max(CFG.proximity, 1));
    it.prox = t * t * (3 - 2 * t);
  }

  function frame(now){
    raf = 0;
    if (!last) last = now;
    var dtRaw = (now - last) / 1000; last = now;
    var dt = Math.max(0, Math.min(dtRaw, 0.05));

    if (!calm.matches) idleAngle += CFG.speed * dt;

    var live = 0;
    for (var i = 0; i < items.length; i++){
      var it = items[i];
      var target = (it.targetAngle === null) ? idleAngle : it.targetAngle;
      var diff = ((target - it.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      it.angle += diff * (1 - Math.exp(-dt * 7));
      it.bright += (it.prox - it.bright) * (1 - Math.exp(-dt * 8));
      if (it.bright > 0.0015) live++;
      draw(it);
    }

    // 全灭（光标离得远）时只剩一圈静态底描边 —— 没必要继续每帧重画。
    // 停止后由 pointermove / resize 重新唤起，这也是本站相对原版多做的一层克制：
    // 页面里已经有 three.js + 变形标题 + 撒尘拖尾 + 液金按钮在跑了。
    if (live > 0 || items.some(function (o){ return o.needResize || o.dirty; })){
      raf = requestAnimationFrame(frame);
    } else {
      last = 0;
    }
  }

  function start(){
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function onMove(ev){
    px = ev.clientX; py = ev.clientY;
    for (var i = 0; i < items.length; i++) steer(items[i]);
    if (calm.matches){                 // 减弱动效：不跑循环，直接落一帧终态
      for (i = 0; i < items.length; i++){
        var it = items[i];
        it.bright = it.prox;
        it.angle = it.targetAngle === null ? it.angle : it.targetAngle;
        draw(it);
      }
      return;
    }
    start();
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  // 指针离开文档（relatedTarget 为 null）时把光熄掉，别让它停在最后的位置
  window.addEventListener('pointerout', function (ev){
    if (ev.relatedTarget) return;
    px = -1e5; py = -1e5;
    for (var i = 0; i < items.length; i++){ items[i].prox = 0; }
    start();
  }, { passive: true });

  if (window.ResizeObserver){
    var ro = new ResizeObserver(function (){
      for (var i = 0; i < items.length; i++) items[i].needResize = true;
      start();
    });
    for (var k = 0; k < items.length; k++) ro.observe(items[k].el);
  }
  window.addEventListener('resize', function (){
    for (var i = 0; i < items.length; i++) items[i].needResize = true;
    start();
  }, { passive: true });
  if (document.fonts && document.fonts.ready){
    // 字体落地后胶囊宽度会变一次（中文字面差异），量出来再对齐
    document.fonts.ready.then(function (){
      for (var i = 0; i < items.length; i++) items[i].needResize = true;
      start();
    });
  }
  document.addEventListener('visibilitychange', function (){
    if (document.hidden){
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
    } else {
      start();
    }
  });

  // 首帧：先把底描边画出来（此时 bright=0，只有那圈极淡的边）
  for (var m = 0; m < items.length; m++){ resize(items[m]); draw(items[m]); }

  /* 调参口子 / 验收钩子。 */
  window.__sb = {
    CFG: CFG, items: items,
    colors: function (line, base){
      if (line) CFG.lineColor = line;
      if (base) CFG.baseColor = base;
      LINE = hex2rgb(CFG.lineColor); BASE = hex2rgb(CFG.baseColor);
      for (var i = 0; i < items.length; i++) draw(items[i]);
    },
    /* at(x,y)：假装光标在视口 (x,y)，把光源角度与接近度一次算到位（无头验收用，
       免得依赖被节流的 rAF） */
    at: function (x, y){
      px = x; py = y;
      for (var i = 0; i < items.length; i++){
        var it = items[i];
        steer(it);
        it.bright = it.prox;
        it.angle = it.targetAngle;
        draw(it);
      }
      return items.map(function (o){ return { bright: +o.bright.toFixed(3), angle: +o.angle.toFixed(3) }; });
    },
    info: function (){
      return items.map(function (o){
        var r = o.el.getBoundingClientRect(), c = o.cv.getBoundingClientRect();
        return {
          label: (o.el.textContent || '').trim(),
          btn: [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
          canvas: [+c.left.toFixed(1), +c.top.toFixed(1), +c.width.toFixed(1), +c.height.toFixed(1)],
          backing: [o.cv.width, o.cv.height],
          angle: +o.angle.toFixed(3), bright: +o.bright.toFixed(3), prox: +o.prox.toFixed(3)
        };
      });
    }
  };
})();
