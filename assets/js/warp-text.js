/* ============================================================
   warp-text.js — glass-warp headline (reactbits "Warp Text" style)

   The two headline lines are rasterised into a texture, then read back
   through a fragment shader that adds three things:
     · a slow ambient "glass" undulation, so the letters never sit still;
     · a cursor LENS that bends, magnifies and ripples the type where the
       pointer is;
     · a faint RGB split along the lens edge, the give-away of real glass.

   It lives on its own canvas placed exactly where the <h1> is (inside the
   hero-title layer, still underneath the 3D canvas) so the cube keeps
   passing in front of the letters. If WebGL is unavailable the class is
   never added and the plain CSS headline simply stays visible.
   ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('warp');
  if (!stage || !canvas) return;

  var gl = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power'
    }) || canvas.getContext('experimental-webgl');
  } catch (e) { gl = null; }
  if (!gl) return;                       // fall back to the CSS headline

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- shaders ---------------- */

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform sampler2D uTex;',
    'uniform vec2  uRes;',
    'uniform vec2  uMouse;',
    'uniform float uTime;',
    'uniform float uWarp;',
    'uniform float uScale;',
    'uniform float uSpeed;',
    'uniform float uLens;',
    'uniform float uBend;',
    'uniform float uRefract;',
    'varying vec2 vUv;',
    '',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    '',
    'void main() {',
    '  vec2 asp = vec2(uRes.x / uRes.y, 1.0);',
    '  vec2 p = (vUv - 0.5) * asp;',
    '  float t = uTime * uSpeed;',
    '',
    '  // ambient glass: two drifting noise fields displace the sample',
    '  float n1 = noise(p * uScale + vec2(t, -t * 0.7));',
    '  float n2 = noise(p * uScale * 1.9 - vec2(t * 0.8, t * 0.6));',
    '  vec2 off = (vec2(n1, n2) - 0.5) * uWarp;',
    '',
    '  // cursor lens',
    '  vec2 m = (uMouse - 0.5) * asp;',
    '  vec2 d = p - m;',
    '  float dist = length(d);',
    '  float lens = 1.0 - smoothstep(0.0, uLens, dist);',
    '  lens = pow(lens, 1.35);',
    '  vec2 dir = dist > 1e-4 ? d / dist : vec2(0.0);',
    '  // cursor lens: displacement proportional to the distance from the',
    '  // pointer, i.e. a pure local magnification. An absolute offset would',
    '  // fold the glyphs back over themselves at the centre and read as a',
    '  // smear instead of a lens.',
    '  float ripple = 0.5 + 0.5 * sin(dist * 20.0 - uTime * 4.0);',
    '  off -= d * uBend * lens * (0.72 + 0.28 * ripple);',
    '',
    '  vec2 uv = vUv + off / asp;',
    '  vec2 ca = dir * uRefract * lens / asp;',
    '',
    '  vec4 sR = texture2D(uTex, clamp(uv + ca, 0.0, 1.0));',
    '  vec4 sG = texture2D(uTex, clamp(uv,      0.0, 1.0));',
    '  vec4 sB = texture2D(uTex, clamp(uv - ca, 0.0, 1.0));',
    '  float a = max(sG.a, max(sR.a, sB.a) * 0.9);',
    '  vec3 col = vec3(sR.r * sR.a, sG.g * sG.a, sB.b * sB.a);',
    '  gl_FragColor = vec4(col, a);',        // premultiplied
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      if (window.console) window.console.warn('[warp]', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    if (window.console) window.console.warn('[warp]', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  // one oversized triangle covers the whole clip space
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uTex', 'uRes', 'uMouse', 'uTime', 'uWarp', 'uScale', 'uSpeed', 'uLens', 'uBend', 'uRefract']
    .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  /* ---------------- headline texture ---------------- */

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  var tc = document.createElement('canvas');
  var tx = tc.getContext('2d');

  var CREAM = '#f2ebdc';
  var DISPLAY = 'Anton, "Archivo Black", Impact, "Arial Narrow", sans-serif';
  var LINE1 = 'WORK PORTFOLIO';
  var LINE2 = 'EXHIBITION \u00B7 LIU YIRAN';

  /* Mirrors the CSS layout of .hero-title so the swap is invisible:
     font-size clamp(38px, 11.4vw, 315px), line-height 0.91, gap 0.03em,
     letter-spacing -0.014em, the second line at 0.955em, block shifted
     up by 1.5vh.  这三个数与 style.css 的 .hero-title 必须一起改 ——
     0.84 行高时 Anton 的大写字面会完全贴死，两行之间留不出缝。 */
  function rasterize() {
    var W = Math.max(1, stage.clientWidth);
    var H = Math.max(1, stage.clientHeight);
    var dpr = DPR;

    tc.width = Math.round(W * dpr);
    tc.height = Math.round(H * dpr);
    tx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tx.clearRect(0, 0, W, H);

    var fs1 = Math.min(Math.max(38, 0.114 * W), 315);
    var fs2 = fs1 * 0.955;
    var lh1 = 0.91 * fs1;
    var lh2 = 0.91 * fs2;
    var gap = 0.03 * fs1;
    var total = lh1 + gap + lh2;
    var cy = H / 2 - 0.015 * H;
    var y1 = cy - total / 2 + lh1 / 2;
    var y2 = cy - total / 2 + lh1 + gap + lh2 / 2;

    tx.textAlign = 'center';
    tx.textBaseline = 'middle';
    tx.shadowColor = 'rgba(242, 235, 220, 0.10)';
    tx.shadowBlur = 60;

    function line(text, size, y, alpha) {
      if ('letterSpacing' in tx) tx.letterSpacing = (-0.014 * size).toFixed(2) + 'px';
      tx.font = '400 ' + size + 'px ' + DISPLAY;
      tx.globalAlpha = alpha;
      tx.fillStyle = CREAM;
      tx.fillText(text, W / 2, y);
    }

    line(LINE1, fs1, y1, 0.93);
    line(LINE2, fs2, y2, 1);
    tx.globalAlpha = 1;
    if ('letterSpacing' in tx) tx.letterSpacing = '0px';

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
  }

  /* ---------------- sizing ---------------- */

  var DPR = 1, W = 1, H = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, stage.clientWidth);
    H = Math.max(1, stage.clientHeight);

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);

    gl.viewport(0, 0, canvas.width, canvas.height);
    rasterize();
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
  }

  /* ---------------- pointer ---------------- */

  var ptr = { tx: 0.5, ty: 0.5, x: 0.5, y: 0.5, seen: false };

  function onMove(e) {
    ptr.tx = e.clientX / W;
    ptr.ty = 1 - e.clientY / H;      // texture is flipped, so uv.y runs upward
    ptr.seen = true;
  }

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length) onMove(e.touches[0]);
  }, { passive: true });

  /* ---------------- render loop ---------------- */

  var time = 0;
  var last = 0;
  var running = true;
  var lensAmt = 0;                       // cursor lens fades in on first move

  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    last = 0;
  });

  /* 第二十二轮：第二屏完全盖住首页之后继续渲染就是纯浪费。scroll.js 在盖满时
     派发 'introcover'（detail=true=被盖住）。恢复时 last 归零，否则累积的
     dt 会让动画跳一大段。 */
  document.addEventListener('introcover', function (e) {
    running = !document.hidden && !e.detail;
    last = 0;
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;

    if (!last) last = now;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;

    var k = 1 - Math.exp(-6 * dt);
    ptr.x += (ptr.tx - ptr.x) * k;
    ptr.y += (ptr.ty - ptr.y) * k;

    // no pointer yet → no lens parked in the middle of the screen
    lensAmt += ((ptr.seen ? 1 : 0) - lensAmt) * (1 - Math.exp(-2.6 * dt));

    gl.uniform1f(U.uTime, time);
    gl.uniform2f(U.uMouse, ptr.x, ptr.y);
    gl.uniform1f(U.uWarp, 0.030);        // ambient glass amount
    gl.uniform1f(U.uScale, 1.7);         // ambient cell size
    gl.uniform1f(U.uSpeed, prefersReduced ? 0.12 : 0.55);
    gl.uniform1f(U.uLens, 0.30);         // pointer lens radius — kept tight
    gl.uniform1f(U.uBend, (prefersReduced ? 0.05 : 0.15) * lensAmt);  // peak magnification
    gl.uniform1f(U.uRefract, 0.0020 * lensAmt);  // rgb split

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uTex, 0);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------------- boot ---------------- */

  var ro = window.ResizeObserver;
  if (ro) {
    new ResizeObserver(function () { resize(); }).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }

  resize();
  stage.classList.add('is-warped');
  requestAnimationFrame(frame);

  // if the context is ever lost the canvas would go blank, so hand the
  // headline back to the plain CSS <h1> instead of leaving a hole
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    stage.classList.remove('is-warped');
  });

  // the webfont arrives asynchronously — re-rasterise once it is really there
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { resize(); });
  }
})();
