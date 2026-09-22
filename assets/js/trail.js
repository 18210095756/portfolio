/* ============================================================
   trail.js — cursor dust (鼠标拖尾)

   The pointer does not draw a line here, it disturbs the air. A puff of
   fine warm grains is lifted off the page wherever the cursor travels:
   each grain gets its own launch speed, its own slow rise and its own
   sideways wander, hangs for a moment and settles out. Think pollen
   shaken loose, not a comet with a tail.

   Emitted by DISTANCE, not by time — and that is the whole trick:

     1. Each frame we measure the segment the pointer actually covered.
        Grains are scattered ALONG that segment (rate proportional to its
        length), so a fast sweep lays a trail instead of stacking a clump
        wherever the cursor happened to land. A pointer that has stopped
        trickles one grain every 55 ms, so the air still breathes while
        you rest, and a press throws a handful hard enough to be a reply.

     2. Nothing is ever smeared with destination-out. Each grain stores
        its origin, velocity and birth stamp, and its position is
        integrated analytically at draw time —
        p = origin + v·age·(1 − 0.34u) + wander + rise
        The canvas is cleared and redrawn from state every frame, so the
        dust fades to genuinely zero and leaves no 8-bit ghosts on a dark
        background.

     3. It all goes down in ONE additive pass onto the visible canvas.
        A dust cloud is additive by nature: where grains pile up they
        brighten. Because every grain is a few pixels of the same cream
        sprite, that accumulation stays inside one colour family rather
        than drifting to white.

   The canvas sits at z-index 3: above the 3D scene, below the haze, UI,
   vignette and grain, so the room's own lighting still acts on it.
   ============================================================ */
(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('trail');
  if (!stage || !canvas) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Motion-sensitive users get no dust at all.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---------------------------------------------------------------
     Tuning.

     The effect this follows lives on a plane 240 units in front of a
     camera parked at 1400, with an fov solved so that the plane at the
     camera distance maps 1:1 onto the viewport. One of its units is
     therefore 1400 / 1640 = 0.854 CSS px down here, and its grain
     formula — uSize 13 against uScale 440 at that depth — comes out at
     3.5 px. That is a mote of pollen, not a spark, and the constants
     below are that same conversion kept in the open, so the motion can
     be reasoned about instead of guessed at.
     --------------------------------------------------------------- */
  var U = 1400 / 1640;
  /* The reference's own grain is 3.5 px at full size and reads as a tiny mote
     against a soft daylight photograph. Ours has to hold up on a near-black
     stage crossed by bright cream lettering, so the mote is opened up to 9 px
     and the cloud around it widened: the motion is the reference's, the
     presence is set for this page. */
  var MOTE = 13 * (440 / 1640) * 2.6;

  var N          = 620;      // grains in the ring buffer
  var LIFE       = 1.6;      // s a grain stays airborne
  var ALPHA      = 0.92;     // peak alpha of a single grain
  var SPREAD     = 20 * U;   // spawn jitter around the emission point, px
  var VEL_X      = 46 * U;   // launch speed, sideways, px/s
  var VEL_UP0    = 2 * U;    // launch speed, upward, px/s — floor
  var VEL_UP1    = 64 * U;   // launch speed, upward, px/s — ceiling
  var VEL_BOOST  = 22 * U;   // extra lift per unit of click boost
  var DRAG       = 0.34;     // share of the launch speed spent by end of life
  var RISE       = 46 * U;   // steady lift, px/s, independent of launch speed
  var WANDER     = 30 * U;   // lateral sine drift over a full life, px
  var STEP       = 6 * U;    // px of pointer travel per grain
  var PER_FRAME  = 16;       // grains a single frame may lay down
  var REST_GAP   = 0.055;    // s between grains once the pointer has stopped
  var CLICK_N    = 52;       // grains thrown by a press
  var CLICK_K    = 2.5;      // and how much harder they go

  /* ---------------- pre-rendered grain ---------------- */

  var SPRITE = 64;
  var sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE;
  (function () {
    var s = sprite.getContext('2d');
    var g = s.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    // the reference grain is white with a pale green halo; ours is the
    // room's own cream with a lilac edge, so the dust belongs to this page
    g.addColorStop(0.00, 'rgba(255, 252, 244, 1)');
    g.addColorStop(0.18, 'rgba(246, 240, 226, 0.62)');
    g.addColorStop(0.46, 'rgba(203, 183, 243, 0.20)');
    g.addColorStop(1.00, 'rgba(203, 183, 243, 0)');
    s.fillStyle = g;
    s.fillRect(0, 0, SPRITE, SPRITE);
  })();

  /* ---------------- sizing ---------------- */

  var DPR = 1, W = 1, H = 1;

  /* ---------------- the pool ----------------
     Flat typed arrays in a ring buffer: respawning a grain is six stores,
     and the draw loop walks memory instead of chasing objects. */

  var px = new Float32Array(N);      // spawn origin, x
  var py = new Float32Array(N);      // spawn origin, y
  var vx = new Float32Array(N);      // launch velocity, x
  var vy = new Float32Array(N);      // launch velocity, y (negative = upward on screen)
  var born = new Float32Array(N);    // birth stamp, seconds
  var sizeK = new Float32Array(N);   // per-grain size multiplier
  var phase = new Float32Array(N);   // per-grain wander phase

  for (var i0 = 0; i0 < N; i0++) born[i0] = -1e4;

  var cursor = 0;        // next ring slot
  var t = 0;             // seconds since boot
  var newest = -1e4;     // birth stamp of the most recent grain

  function spawn(x, y, k) {
    var i = cursor; cursor = (cursor + 1) % N;
    px[i] = x + (Math.random() * 2 - 1) * SPREAD * k;
    py[i] = y + (Math.random() * 2 - 1) * SPREAD * k;
    vx[i] = (Math.random() * 2 - 1) * VEL_X * k;
    // screen y grows downward, so the reference's upward velocity is negated here
    vy[i] = -(VEL_UP0 + Math.random() * (VEL_UP1 - VEL_UP0) + VEL_BOOST * (k - 1)) * k;
    born[i] = t;
    newest = t;
    sizeK[i] = 0.50 + Math.random() * 0.65;
    phase[i] = Math.random();
  }

  /* ---------------- pointer ---------------- */

  var ptr = { x: 0, y: 0, live: false };
  var mark = { x: 0, y: 0, has: false };   // last emission point
  var rest = 0;                            // s the pointer has not moved far enough to emit

  function place(e) {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.live = true;
  }

  function away() {
    // re-entering the window must not lay a line across everything the
    // pointer skipped over while it was outside
    ptr.live = false;
    mark.has = false;
  }

  window.addEventListener('pointermove', place, { passive: true });

  window.addEventListener('pointerdown', function (e) {
    place(e);
    mark.has = false;                      // a press never streaks in from the last position
    for (var i = 0; i < CLICK_N; i++) spawn(e.clientX, e.clientY, CLICK_K);
  }, { passive: true });

  document.addEventListener('pointerleave', away);
  window.addEventListener('blur', away);
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget) away();
  });

  /* ---------------- emission ---------------- */

  function emit(dt) {
    if (!ptr.live) { mark.has = false; return; }

    // first sighting only records where we are; there is no segment yet
    if (!mark.has) { mark.x = ptr.x; mark.y = ptr.y; mark.has = true; return; }

    var dx = ptr.x - mark.x;
    var dy = ptr.y - mark.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var n = Math.min(PER_FRAME, Math.floor(d / STEP));

    for (var k = 1; k <= n; k++) {
      var f = k / n;
      spawn(mark.x + dx * f, mark.y + dy * f, 1);
    }

    if (n > 0) {
      mark.x = ptr.x;
      mark.y = ptr.y;
      rest = 0;
    } else {
      // barely moving: keep the mark where it is so the next frame measures
      // a longer segment and the trail stays continuous, but trickle a
      // grain out anyway so a parked cursor is not a dead one
      rest += dt;
      if (rest > REST_GAP) { spawn(ptr.x, ptr.y, 1); rest = 0; }
    }
  }

  /* ---------------- drawing ---------------- */

  function smoothstep(a, b, x) {
    var s = (x - a) / (b - a);
    s = s < 0 ? 0 : (s > 1 ? 1 : s);
    return s * s * (3 - 2 * s);
  }

  var lit = false;   // something was on the canvas last frame

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // the newest grain outlives all the others, so this settles the whole pool
    if (t - newest > LIFE) {
      if (lit) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, W, H);
        lit = false;
      }
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);          // redrawn from state, never smeared
    ctx.globalCompositeOperation = 'lighter';
    lit = true;

    for (var i = 0; i < N; i++) {
      var age = t - born[i];
      if (age < 0 || age > LIFE) continue;

      var u = age / LIFE;
      var decay = 1 - DRAG * u;

      var x = px[i] + vx[i] * age * decay
            + Math.sin(phase[i] * 6.283185 + age * 2.6) * WANDER * u;
      var y = py[i] + vy[i] * age * decay - RISE * age;

      // pop in fast, hold, then a long fade — the reference's own envelope
      var a = smoothstep(0, 0.09, u) * (1 - smoothstep(0.40, 1.0, u));
      var s = MOTE * sizeK[i] * (0.45 + 0.55 * (1 - u));

      ctx.globalAlpha = a * ALPHA;
      ctx.drawImage(sprite, x - s * 0.5, y - s * 0.5, s, s);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- resize ---------------- */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, stage.clientWidth);
    H = Math.max(1, stage.clientHeight);

    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // the grains live in viewport px, so a resize invalidates every one
    for (var i = 0; i < N; i++) born[i] = -1e4;
    newest = -1e4;
    lit = false;
    ctx.clearRect(0, 0, W, H);
  }

  /* ---------------- loop ---------------- */

  var lastT = 0;
  var running = true;

  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) lastT = 0;
  });

  /* 第二十二轮：第二屏完全盖住首页之后继续渲染就是纯浪费（scene 的 bloom
     有四趟 mip pass 最贵，这层拖尾其实会自己停帧，这里一并接上保持一致）。
     scroll.js 在盖满时派发 'introcover'。恢复时 lastT 归零。 */
  document.addEventListener('introcover', function (e) {
    running = !document.hidden && !e.detail;
    if (running) lastT = 0;
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;

    if (!lastT) { lastT = now; return; }
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt <= 0) return;
    if (dt > 0.05) dt = 0.05;

    t += dt;
    emit(dt);
    draw();
  }

  /* ---------------- boot ---------------- */

  // a small window into the pool for verification; costs nothing at runtime
  window.__tdbg = function () {
    var live = 0;
    for (var i = 0; i < N; i++) {
      var age = t - born[i];
      if (age >= 0 && age <= LIFE) live++;
    }
    return 'dust live=' + live + '/' + N + ' t=' + t.toFixed(2) +
      ' ptr=' + (ptr.live ? 'live' : 'away');
  };

  var ro = window.ResizeObserver;
  if (ro) {
    new ResizeObserver(function () { resize(); }).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }

  resize();
  requestAnimationFrame(frame);
})();
