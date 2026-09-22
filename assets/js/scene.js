/* ============================================================
   scene.js — Liu Yiran Work Portfolio hero
   Near-black stage · gummy macaron 3D geometry · lavender
   TRUE CUBE (slow idle turn, accelerates & follows the cursor)
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  if (!canvas || typeof THREE === 'undefined') return;

  /* r147 defaults to legacy colour mode, which treats sRGB hex values as if
     they were already linear — that is what makes pastel colours look washed
     out and grey. Enable proper colour management instead. */
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DEG = Math.PI / 180;

  /* ---------------- Global exposure — the ONE brightness knob ----------------
     The scene runs with NoToneMapping (a filmic curve would desaturate the
     macaron palette), so `renderer.toneMappingExposure` is a no-op and exposure
     has to be a real multiplier on every light-emitting term.

     EXPOSURE scales together, by the same factor:
       · every light's intensity
       · the environment contribution (envMapIntensity)
       · the material self-emissive
       · the halo sprite opacities

     It deliberately does NOT scale the lens bloom. The bloom is fed by the
     rendered scene, so its input already dims when the lights dim — scaling the
     amount as well dims the glow twice, which stops reading as "darker" and
     starts reading as "the glow got tighter". Left alone, the glow tracks the
     exposure on its own. (Measured, E from 1.00: without the extra bloom term the
     whole scene dims evenly; with it the mid-tones lost 23% against the
     highlights' 3%.) See the note at BLOOM_AMOUNT.

     Mind the non-linearity: the renderer encodes to sRGB *after* lighting, so a
     linear-light factor of E lands on screen at roughly E^0.45.
     E = 0.68 reads as about -15% on the lit parts of the scene. */
  var EXPOSURE = 0.68;

  /* ---------------- Renderer ---------------- */

  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  // no filmic curve: it desaturates the vivid macaron palette
  renderer.toneMapping = THREE.NoToneMapping;

  var scene = new THREE.Scene();

  var CAM_Z = 9.2;
  var FOV = 42;
  var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  /* ============================================================
     GLOW

     A composer is still not an option — its additive composite drives the
     canvas alpha to 1 every frame and swallows the headline behind it. So the
     glow is assembled from two alpha-safe additive layers:

       1. a real LENS BLOOM. The scene is rendered a second time into a
          half-resolution target and then pushed down a mip chain
          (1/2 → 1/4 → 1/8 → 1/16). Every level is blurred with a separable
          Gaussian and reads the previous level's *blurred* result, and all
          four levels are finally added back on top of the scene. Reading the
          previous level is what gives the glow its wide, smooth spread: a
          single wide kernel at one resolution undersamples and bands, whereas
          a chain of small kernels compounds into a very wide, very smooth
          falloff. Because every pass is purely additive the alpha channel can
          only ever grow where light actually is, so the background stays
          transparent and the headline keeps showing through.

       2. a soft ambient HALO sprite for the far, misty spread beyond what the
          blur reaches.

     Deliberately NO fresnel rim shell. A shell whose alpha peaks at grazing
     angles paints a bright line exactly on the silhouette — that is a hard
     outline, not light. Light has to bleed OUT of the surface and dissolve
     into the background, never sit on the edge.
     ============================================================ */

  /* one wide, very soft radial falloff used by every halo. The exponent keeps
     the derivative at 1 continuous, so the disc dissolves instead of stopping
     at a visible radius. */
  function makeGlowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (var i = 0; i <= 24; i++) {
      var t = i / 24;
      var a = Math.pow(1 - t, 2.35) * 0.9;
      g.addColorStop(t, 'rgba(255,255,255,' + a.toFixed(4) + ')');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var GLOW_TEX = makeGlowTexture();

  /* soft ambient bleed around an object.
     Sizing note: the sprite is a radial gradient that is brightest at its
     centre — which sits BEHIND the object and is depth-culled. So the sprite
     has to be several times the object's diameter for the gradient to still
     carry any value out at the silhouette; sized too close to the object it
     contributes literally nothing where you can see it. */
  function addHalo(target, color, size, opacity) {
    opacity *= EXPOSURE;   // halos are additive, so they are exposure too
    var group = new THREE.Group();
    var layers = [
      { s: size,       o: opacity * 1.00 },
      { s: size * 2.6, o: opacity * 0.42 }
    ];
    layers.forEach(function (L) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW_TEX,
        color: color,
        transparent: true,
        opacity: L.o,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      }));
      sp.scale.setScalar(L.s);
      group.add(sp);
    });
    group.position.z = -0.45;
    target.add(group);
    return group;
  }

  /* ---------------- hand-rolled lens bloom ---------------- */

  var QUAD_VERT = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* 9-tap separable Gaussian (the 5-sample form, folding pairs through the
     linear filter). uStep is one source texel, so the same shader works at
     every level of the chain. */
  var BLUR_FRAG = [
    'precision highp float;',
    'uniform sampler2D uTex;',
    'uniform vec2 uStep;',
    'uniform float uThresh;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 c  = texture2D(uTex, vUv) * 0.2270270270;',
    '  c += texture2D(uTex, vUv + uStep * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv - uStep * 1.3846153846) * 0.3162162162;',
    '  c += texture2D(uTex, vUv + uStep * 3.2307692308) * 0.0702702703;',
    '  c += texture2D(uTex, vUv - uStep * 3.2307692308) * 0.0702702703;',
    '  if (uThresh > 0.0) {',
    '    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));',
    '    c *= smoothstep(uThresh, uThresh + 0.22, l);',
    '  }',
    '  gl_FragColor = c;',
    '}'
  ].join('\n');

  var ADD_FRAG = [
    'precision highp float;',
    'uniform sampler2D uTex;',
    'uniform float uAmount;',
    'varying vec2 vUv;',
    'void main() {',
    '  gl_FragColor = texture2D(uTex, vUv) * uAmount;',
    '}'
  ].join('\n');

  var quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var quadScene = new THREE.Scene();
  var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  var blurMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null },
      uStep: { value: new THREE.Vector2() },
      uThresh: { value: 0 }
    },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending
  });

  /* pure additive on RGB *and* alpha, so the glow never punches a hole in the
     canvas's transparency (which would hide the headline) */
  var addMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null },
      uAmount: { value: 1 }
    },
    vertexShader: QUAD_VERT,
    fragmentShader: ADD_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor
  });

  var BLOOM_DIVS = [2, 4, 8, 16];
  /* the widest levels get a wider kernel step: they are already heavily
     pre-blurred by the levels above, so a big step costs nothing in quality
     and is what buys the long, misty tail that reaches out into the dark */
  var BLOOM_STEP = [1.0, 1.6, 2.4, 3.4];
  /* each level is a normalised blur (its kernel sums to 1), so the weights are
     literally "how much of the scene's light this level adds back". Keep the
     total well under 1 — past about 0.6 the shapes saturate to white and lose
     their macaron colour entirely. */
  /* NOTE — these amounts are deliberately NOT tied to EXPOSURE, and neither is
     the blur's brightness knee. The bloom is fed by the *rendered scene*, so its
     input already dims when the lights dim; the half-res source passes through
     the same sRGB-ish response as any lit surface, which means the glow ends up
     dimming by very nearly the same factor as the objects. Multiplying the
     amount by EXPOSURE as well dims the glow twice (measured: the mid-tones lost
     23% against the highlights' 3%, i.e. it stopped reading as "darker" and
     started reading as "the glow got tighter"). And scaling the knee instead
     *widens* the gate and makes parts of the glow brighter than before.
     So: leave the bloom alone and it tracks the exposure on its own. */
  var BLOOM_AMOUNT = [0.10, 0.13, 0.18, 0.24];

  var rtHalf = null;      // the scene at half resolution
  var bloomLevels = [];   // [{ a, b }] per level — a = blurred, b = scratch

  function rtOptions() {
    return {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      // half float keeps the very dim tail of the bloom free of 8-bit banding
      type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    };
  }

  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)), rtOptions());
  }

  function disposeBloom() {
    if (rtHalf) { rtHalf.dispose(); rtHalf = null; }
    bloomLevels.forEach(function (L) { L.a.dispose(); L.b.dispose(); });
    bloomLevels = [];
  }

  function buildBloom(w, h) {
    disposeBloom();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var bw = Math.max(8, w * dpr);
    var bh = Math.max(8, h * dpr);

    rtHalf = makeRT(bw / 2, bh / 2);
    BLOOM_DIVS.forEach(function (d) {
      bloomLevels.push({ a: makeRT(bw / d, bh / d), b: makeRT(bw / d, bh / d) });
    });
  }

  function drawPass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target || null);
    renderer.render(quadScene, quadCam);
  }

  /* scene → half-res target → mip chain. Never touches the visible canvas. */
  function renderBloom() {
    if (!rtHalf || !bloomLevels.length) return;

    renderer.setRenderTarget(rtHalf);
    renderer.render(scene, camera);

    var src = rtHalf;
    for (var i = 0; i < bloomLevels.length; i++) {
      var L = bloomLevels[i];
      var k = BLOOM_STEP[i] || 1;

      // horizontal — doubles as the downsample when the destination is smaller
      blurMat.uniforms.uTex.value = src.texture;
      blurMat.uniforms.uStep.value.set(k / src.width, 0);
      blurMat.uniforms.uThresh.value = i === 0 ? 0.06 : 0;
      drawPass(blurMat, L.a);

      // vertical
      blurMat.uniforms.uTex.value = L.a.texture;
      blurMat.uniforms.uStep.value.set(0, k / L.a.height);
      blurMat.uniforms.uThresh.value = 0;
      drawPass(blurMat, L.b);

      src = L.b;
    }
  }

  function compositeBloom() {
    if (!bloomLevels.length) return;
    renderer.autoClear = false;
    for (var i = 0; i < bloomLevels.length; i++) {
      addMat.uniforms.uTex.value = bloomLevels[i].b.texture;
      addMat.uniforms.uAmount.value = BLOOM_AMOUNT[i];
      drawPass(addMat, null);
    }
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
  }

  /* ---------------- Studio environment (procedural, offline) ---------------- */

  function buildEnvironment() {
    var c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0.00, '#f2eefb');
    g.addColorStop(0.18, '#9d97b8');
    g.addColorStop(0.40, '#454056');
    g.addColorStop(0.62, '#1d1c26');
    g.addColorStop(1.00, '#0a0a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);

    var warm = ctx.createRadialGradient(34, 16, 0, 34, 16, 30);
    warm.addColorStop(0, 'rgba(255, 246, 228, 0.55)');
    warm.addColorStop(1, 'rgba(255, 246, 228, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, 128, 64);

    var cool = ctx.createRadialGradient(100, 40, 0, 100, 40, 34);
    cool.addColorStop(0, 'rgba(198, 178, 255, 0.46)');
    cool.addColorStop(1, 'rgba(198, 178, 255, 0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, 128, 64);

    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;

    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    var env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return env;
  }

  try {
    scene.environment = buildEnvironment();
  } catch (e) {
    scene.environment = null;
  }

  /* ---------------- Soft studio lighting (no harsh shadows) ----------------
     NoToneMapping means toneMappingExposure is a no-op, so the intensities below
     are authored values that get scaled by EXPOSURE — see the knob at the top.
     To brighten or dim the whole scene, change EXPOSURE, not these numbers. */

  scene.add(new THREE.HemisphereLight(0xfaf5ff, 0x1b1826, 0.39 * EXPOSURE));
  scene.add(new THREE.AmbientLight(0xcdbdf0, 0.13 * EXPOSURE));

  var key = new THREE.DirectionalLight(0xfff4e8, 1.28 * EXPOSURE);
  key.position.set(-2.8, 7.4, 5.6);
  scene.add(key);

  var front = new THREE.DirectionalLight(0xffffff, 0.26 * EXPOSURE);
  front.position.set(0.6, 2.0, 7.5);
  scene.add(front);

  var fill = new THREE.DirectionalLight(0xa9c8f5, 0.19 * EXPOSURE);
  fill.position.set(5.4, -1.6, 3.2);
  scene.add(fill);

  var rimPink = new THREE.PointLight(0xf687b0, 0.29 * EXPOSURE, 24, 2);
  rimPink.position.set(3.4, 2.4, -3.4);
  scene.add(rimPink);

  var rimBlue = new THREE.PointLight(0x7aa9f0, 0.27 * EXPOSURE, 24, 2);
  rimBlue.position.set(-3.4, -2.2, -3.0);
  scene.add(rimBlue);

  /* ---------------- Palette ---------------- */

  /* sampled from the reference artwork — vivid, not desaturated pastel */
  var MACARON = [
    0xf1489a, // magenta gem
    0x9fe8dd, // aqua mint
    0xbfaef0, // pale lavender
    0x8fa2e8, // periwinkle
    0xf3a63f, // amber orange
    0x7ed957, // vivid green
    0x5590e8, // cornflower blue
    0xf5dc3a, // lemon yellow
    0x7fd8d0, // teal
    0xea5a2a, // tangerine
    0xf5c470, // soft peach
    0x9b7be0, // violet
    0xf07aa8, // rose pink
    0xf0c288  // peach tan
  ];

  /* ---------------- Material: gummy candy / soft rubber ----------------
     Smooth, softly lit, no hard specular; a whisper of clearcoat gives the
     thin candy skin, a strong sheen gives the velvety rim, and a faint
     self-emissive tint of its own hue is what makes it read as translucent
     gummy rather than painted plastic. */

  function gummyMaterial(color, opts) {
    opts = opts || {};
    var c = new THREE.Color(color);
    return new THREE.MeshPhysicalMaterial({
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.74,
      metalness: 0.0,
      clearcoat: opts.clearcoat !== undefined ? opts.clearcoat : 0.22,
      clearcoatRoughness: 0.52,
      sheen: opts.sheen !== undefined ? opts.sheen : 0.72,
      sheenRoughness: 0.62,
      sheenColor: new THREE.Color(0xffffff),
      specularIntensity: 0.42,
      envMapIntensity: (opts.env !== undefined ? opts.env : 0.95) * EXPOSURE,
      emissive: c.clone().multiplyScalar(
        (opts.emissive !== undefined ? opts.emissive : 0.22) * EXPOSURE),
      flatShading: !!opts.flat,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true
    });
  }

  var frostedMaterial = gummyMaterial;   // alias kept for call sites

  /* ---------------- Geometry factory ---------------- */

  function roundedRect(w, h, r) {
    var s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return s;
  }

  /* every corner of a polygon gets an arc, so nothing is left sharp */
  function roundedPolygon(pts, radius) {
    var s = new THREE.Shape(), n = pts.length;
    for (var i = 0; i < n; i++) {
      var p = pts[(i - 1 + n) % n], v = pts[i], q = pts[(i + 1) % n];
      var v1x = p[0] - v[0], v1y = p[1] - v[1];
      var v2x = q[0] - v[0], v2y = q[1] - v[1];
      var l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      var r = Math.min(radius, l1 * 0.5, l2 * 0.5);
      var t1x = v[0] + v1x / l1 * r, t1y = v[1] + v1y / l1 * r;
      var t2x = v[0] + v2x / l2 * r, t2y = v[1] + v2y / l2 * r;
      if (i === 0) s.moveTo(t1x, t1y);
      else s.lineTo(t1x, t1y);
      s.quadraticCurveTo(v[0], v[1], t2x, t2y);
    }
    s.closePath();
    return s;
  }

  /* generous bevel + high curve resolution = soft, rounded solid */
  function extrude(shape, depth, bevel) {
    var d = depth || 0.46;
    var b = bevel || Math.min(d * 0.42, 0.2);
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.02, d - b * 2),
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: 0,
      bevelSegments: 7,
      curveSegments: 26
    });
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }

  /* polar outline; powers > 1 give a zero derivative at the extremes, so the
     tips come out naturally rounded instead of cusped */
  function mapShape(points, k) {
    var s = new THREE.Shape();
    for (var i = 0; i <= points; i++) {
      var t = (i / points) * Math.PI * 2;
      var r = k(t);
      var x = Math.cos(t) * r, y = Math.sin(t) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }

  /* 4-point sparkle with fat rounded arms */
  function makeStar4() {
    var s = mapShape(120, function (t) {
      return 1.18 * (0.30 + 0.70 * Math.pow(Math.abs(Math.cos(2 * t)), 2.0));
    });
    return extrude(s, 0.52, 0.22);
  }

  /* plump 4-lobe cloud / "butterfly" blob */
  function makeClover() {
    var s = mapShape(140, function (t) {
      return 1.02 * (0.66 + 0.34 * Math.pow(Math.abs(Math.cos(2 * t)), 1.25));
    });
    var g = extrude(s, 0.56, 0.26);
    g.scale(1.06, 0.94, 1);
    return g;
  }

  /* rectangular plus, all twelve corners arced */
  function makePlus() {
    var a = 0.335, b = 0.99;
    var pts = [
      [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a],
      [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]
    ];
    return extrude(roundedPolygon(pts, 0.20), 0.56, 0.22);
  }

  function makeStar() {
    var s = new THREE.Shape();
    var spikes = 5, outer = 1.9, inner = 0.90;
    for (var i = 0; i < spikes * 2; i++) {
      var rad = (i % 2 === 0) ? outer : inner;
      var a2 = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a2) * rad, y = Math.sin(a2) * rad;
      if (i === 0) s.moveTo(x, y);
      else s.quadraticCurveTo(x * 0.70, y * 0.70, x, y);
    }
    s.closePath();
    return extrude(s, 0.54, 0.22);
  }

  var GEOMETRY = {
    plus: makePlus,
    star: makeStar,
    star4: makeStar4,
    clover: makeClover,
    gem: function () { return new THREE.IcosahedronGeometry(0.90, 0); },
    dodeca: function () { return new THREE.DodecahedronGeometry(0.86, 0); },
    gemSmooth: function () { return new THREE.IcosahedronGeometry(0.94, 2); },
    ball: function () { return new THREE.SphereGeometry(0.78, 44, 32); },
    blob: function () {
      var g = new THREE.SphereGeometry(0.82, 44, 32);
      g.scale(1.28, 0.86, 0.94);
      return g;
    },
    torus: function () { return new THREE.TorusGeometry(0.64, 0.30, 28, 56); },
    /* cylinder / cone both had sharp rims and a sharp apex — replaced by
       fully rounded solids of roughly the same silhouette */
    puck: function () {                       // rounded pellet
      var g = new THREE.SphereGeometry(0.80, 44, 32);
      g.scale(1.0, 0.46, 1.0);
      return g;
    },
    drop: function () {                       // gumdrop / egg
      var g = new THREE.SphereGeometry(0.70, 44, 32);
      g.scale(1.0, 1.30, 1.0);
      return g;
    },
    pill: function () { return new THREE.CapsuleGeometry(0.38, 0.94, 14, 30); }
  };

  /* ---------------- Layout: anchors in normalized screen space ---------------- */
  /* nx / ny are fractions of the half-viewport (-1 = left/bottom edge)          */

  var ANCHORS = [
    // ---------- left cluster ----------
    { nx: -0.60, ny:  0.27, type: 'star4',   s: 0.62, z:  0.6, c: 1 },  // aqua star
    { nx: -0.73, ny:  0.42, type: 'gem',     s: 0.40, z:  0.2, c: 0 },  // magenta gem
    { nx: -0.43, ny: -0.09, type: 'gem',     s: 0.46, z:  0.9, c: 3 },  // periwinkle gem
    { nx: -0.69, ny: -0.17, type: 'dodeca',  s: 0.60, z:  0.8, c: 4 },  // big amber gem
    { nx: -0.64, ny:  0.05, type: 'plus',    s: 0.36, z:  0.5, c: 5 },  // green cross
    { nx: -0.56, ny: -0.55, type: 'star4',   s: 0.46, z:  0.7, c: 6 },  // blue star
    { nx: -0.74, ny: -0.40, type: 'gem',     s: 0.34, z: -0.6, c: 7 },  // lemon gem
    { nx: -0.82, ny: -0.20, type: 'torus',   s: 0.40, z:  1.2, c: 8 },  // teal ring
    { nx: -0.34, ny:  0.47, type: 'plus',    s: 0.36, z: -1.4, c: 2 },  // lavender cross
    { nx: -0.25, ny: -0.42, type: 'pill',    s: 0.28, z: -1.6, c: 6 },

    // ---------- right cluster ----------
    { nx:  0.49, ny:  0.20, type: 'gem',     s: 0.52, z:  0.5, c: 0 },  // magenta gem
    { nx:  0.70, ny:  0.50, type: 'plus',    s: 0.42, z: -0.2, c: 9 },  // tangerine cross
    { nx:  0.64, ny:  0.30, type: 'clover',  s: 0.46, z:  0.3, c: 10 }, // peach butterfly
    { nx:  0.80, ny:  0.12, type: 'plus',    s: 0.30, z: -0.8, c: 11 }, // violet cross
    { nx:  0.59, ny: -0.14, type: 'gem',     s: 0.33, z:  1.0, c: 7 },  // lemon gem
    { nx:  0.74, ny: -0.08, type: 'blob',    s: 0.30, z:  0.9, c: 3 },  // periwinkle blob
    { nx:  0.45, ny: -0.42, type: 'plus',    s: 0.38, z:  0.8, c: 5 },  // green cross
    { nx:  0.29, ny: -0.58, type: 'pill',    s: 0.44, z:  0.6, c: 6 },  // blue capsule
    { nx:  0.60, ny: -0.46, type: 'star4',   s: 0.42, z:  0.7, c: 13 }, // peach star
    { nx:  0.87, ny:  0.30, type: 'drop',    s: 0.38, z: -1.0, c: 4 },
    { nx:  0.90, ny: -0.30, type: 'plus',    s: 0.40, z:  1.7, c: 12 },

    // ---------- small far accents ----------
    { nx: -0.17, ny:  0.66, type: 'ball',    s: 0.26, z: -2.4, c: 1 },
    { nx:  0.24, ny:  0.73, type: 'gem',     s: 0.24, z: -2.6, c: 7 },
    { nx: -0.46, ny: -0.58, type: 'torus',   s: 0.26, z: -2.2, c: 8 },
    { nx: -0.51, ny:  0.22, type: 'gem',     s: 0.22, z: -1.9, c: 12 }
  ];

  /* ---------------- Build floating shapes ---------------- */

  var shapeGroup = new THREE.Group();
  scene.add(shapeGroup);

  var shapes = [];
  var halfH = Math.tan((FOV * DEG) / 2) * CAM_Z;
  var halfW = halfH * (window.innerWidth / window.innerHeight || 1.78);

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* extruded silhouettes must stay front-facing like the reference; faceted
     and round solids are free to tumble */
  var FLAT_SHAPES = { plus: 1, star: 1, star4: 1, clover: 1 };

  /* pulled toward the centre a little, with both sides still left open */
  var FIELD_X = 0.85;
  var FIELD_Y = 0.90;

  /* every shape is normalised to the same on-screen size, then nudged inside a
     narrow band — the reference keeps its elements close in scale */
  var TARGET_R = 0.355;
  var SIZE_MIN = 0.92, SIZE_MAX = 1.13;

  ANCHORS.forEach(function (a, i) {
    var geo = GEOMETRY[a.type]();
    geo.computeBoundingSphere();
    var r = (geo.boundingSphere && geo.boundingSphere.radius) || 1;

    var mat = gummyMaterial(MACARON[a.c % MACARON.length], {
      flat: a.type === 'gem' || a.type === 'dodeca'
    });
    var mesh = new THREE.Mesh(geo, mat);

    var x = a.nx * FIELD_X * halfW;
    var y = a.ny * FIELD_Y * halfH;

    mesh.position.set(x, y, a.z);

    var flat = !!FLAT_SHAPES[a.type];
    var rotX, rotY, rotZ;
    if (flat) {
      rotX = rand(-0.26, 0.26);
      rotY = rand(-0.30, 0.30);
      rotZ = rand(0, Math.PI * 2);
    } else {
      rotX = rand(0, Math.PI * 2);
      rotY = rand(0, Math.PI * 2);
      rotZ = rand(0, Math.PI * 2);
    }
    mesh.rotation.set(rotX, rotY, rotZ);

    var far = a.z < -1.5;
    var jitter = rand(SIZE_MIN, SIZE_MAX) * (far ? 0.72 : 1);
    var baseScale = (TARGET_R * jitter) / r;
    mesh.scale.setScalar(0.0001);

    /* gummy glow: a soft ambient halo only. No fresnel rim — a rim shell
       draws a hard line on the silhouette, which is exactly what we do not
       want. The surface-hugging part of the glow comes from the bloom pass.
       (the halo is a child of the mesh, so its size is in local units)
       Opacities look high because three encodes the fragment to sRGB BEFORE
       blending, so an additive sprite actually contributes only
       alpha × sRGB(colour) — low alphas get squashed hard. */
    addHalo(mesh, mat.color, r * 4.5, 0.40);

    shapeGroup.add(mesh);
    shapes.push({
      mesh: mesh,
      base: new THREE.Vector3(x, y, a.z),
      baseScale: baseScale,
      flat: flat,
      rotBase: new THREE.Vector3(rotX, rotY, rotZ),
      ampY: rand(0.13, 0.30),
      ampX: rand(0.05, 0.15),
      spd: rand(0.32, 0.68),
      phase: rand(0, Math.PI * 2),
      rot: new THREE.Vector3(rand(-0.16, 0.16), rand(-0.2, 0.2), rand(-0.12, 0.12)),
      depth: 0.18 + Math.abs(a.z + 2) * 0.11,
      entry: -i * 0.055
    });
  });

  /* ============================================================
     Central lavender cube — a TRUE cube.

     Every beam is the same length and the same square cross-section, and the
     group is NOT scaled, so the three edge lengths are identical by
     construction. (An earlier pass scaled the group to 0.78 vertically to
     force a squarer silhouette; that is precisely what made it read as a
     rectangular box.)

     Measured off the reference:
       · beams are flat-faced bars with only lightly rounded edges,
         about 11.8% of the cube edge wide;
       · every beam overshoots its corners a little, so the joints read as
         mitred crossings rather than flush butt joints;
       · the view is TRUE isometric — azimuth 45°, tilt atan(1/√2) ≈ 35.264°.

     That tilt is not cosmetic: it is the only angle at which the nearest and
     the farthest corner of a cube project onto the SAME point, so the three
     beams leaving the near corner and the three leaving the far corner become
     three collinear pairs. Offsetting one tripod backwards and the other
     forwards along the view axis then does not move them in the picture at
     all — it only flips which one passes in front, which is the illusion.
     ============================================================ */

  var CUBE_SIZE = 2.00;          // edge length
  var BW = CUBE_SIZE * 0.138;    // beam width  (measured off the reference)
  var BT = CUBE_SIZE * 0.138;    // beam thickness — equal, so the cross-section is square
  var EDGE_R = BW * 0.20;        // light edge rounding — flat faces stay flat
  var OVERSHOOT = BT * 0.35;     // small nub past each corner
  var WEAVE = CUBE_SIZE * 0.034; // depth flip, along the view axis

  var TILT_X = Math.atan(1 / Math.SQRT2);   // true isometric tilt (35.264°)
  var YAW_Y = 45 * DEG;                     // true isometric azimuth

  var beamMat = gummyMaterial(0x9d7adb, {
    roughness: 0.62, clearcoat: 0.30, emissive: 0.02, env: 0.42
  });
  var cubeRoot = new THREE.Group();
  scene.add(cubeRoot);

  var hl = CUBE_SIZE / 2;
  var beamLen = CUBE_SIZE + OVERSHOOT * 2;

  function beamGeo(len, w, t, r) {
    var shape = roundedRect(w, t, Math.min(r, Math.min(w, t) / 2 - 0.001));
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: len,
      bevelEnabled: true,
      bevelThickness: t * 0.10,
      bevelSize: Math.min(t * 0.10, w * 0.14),
      bevelSegments: 4,
      curveSegments: 14
    });
    g.translate(0, 0, -len / 2);
    g.computeVertexNormals();
    return g;
  }

  var geoBeamX = beamGeo(beamLen, BW, BT, EDGE_R);
  var geoBeamY = beamGeo(beamLen, BW, BT, EDGE_R);
  var geoBeamZ = beamGeo(beamLen, BW, BT, EDGE_R);

  /* the local direction whose world image is "towards the camera" at rest.
     world = R · local, so local = R⁻¹ · ẑ. At the isometric angles this comes
     out as the body diagonal (-1, 1, 1)/√3 — exactly the near corner. */
  var viewAxis = new THREE.Vector3(
    -Math.sin(YAW_Y) * Math.cos(TILT_X),
    Math.sin(TILT_X),
    Math.cos(YAW_Y) * Math.cos(TILT_X)
  ).normalize();

  var NEAR = { x: -1, y: 1, z: 1 };
  var FAR = { x: 1, y: -1, z: -1 };

  function isNear(x, y, z) { return x === NEAR.x && y === NEAR.y && z === NEAR.z; }
  function isFar(x, y, z) { return x === FAR.x && y === FAR.y && z === FAR.z; }

  function addBeam(axis, sx, sy, sz) {
    var mesh, geo;
    if (axis === 'x') {
      geo = geoBeamX;
      mesh = new THREE.Mesh(geo, beamMat);
      mesh.rotation.y = -Math.PI / 2;            // length → world X, width → Z
      mesh.position.set(sx * hl, sy * hl, sz * hl);
    } else if (axis === 'z') {
      geo = geoBeamZ;
      mesh = new THREE.Mesh(geo, beamMat);
      mesh.position.set(sx * hl, sy * hl, sz * hl);
    } else {
      geo = geoBeamY;
      mesh = new THREE.Mesh(geo, beamMat);
      mesh.rotation.x = Math.PI / 2;             // length → world Y
      mesh.position.set(sx * hl, sy * hl, sz * hl);
    }
    /* the weave: only the two corner tripods move, and only along the view
       axis, so the picture is unchanged while the depth order inverts */
    if (isNear(sx, sy, sz)) mesh.position.addScaledVector(viewAxis, -WEAVE);
    else if (isFar(sx, sy, sz)) mesh.position.addScaledVector(viewAxis, WEAVE);
    cubeRoot.add(mesh);
  }

  // the beam coordinates are the corner each beam passes through
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (p) {
    addBeam('x', 0, p[0], p[1]);
    addBeam('y', p[0], 0, p[1]);
    addBeam('z', p[0], p[1], 0);
  });

  cubeRoot.rotation.set(TILT_X, YAW_Y, 0);

  // the lavender bleed lives in scene space so it never inherits the spin
  var cubeHalo = addHalo(scene, 0xb49cf0, CUBE_SIZE * 3.0, 0.34);
  cubeHalo.position.set(0, 0, -1.3);

  /* ---------------- Pointer state ---------------- */

  var ptr = {
    tx: 0, ty: 0, sx: 0, sy: 0,
    px: 0, py: 0,
    vel: 0, boost: 0, active: false, down: false
  };

  function onMove(e) {
    var w = window.innerWidth || 1;
    var h = window.innerHeight || 1;
    var cx = e.clientX, cy = e.clientY;
    if (!ptr.active) { ptr.px = cx; ptr.py = cy; ptr.active = true; }
    var dx = cx - ptr.px, dy = cy - ptr.py;
    ptr.px = cx; ptr.py = cy;
    ptr.vel = Math.min(Math.sqrt(dx * dx + dy * dy), 140);
    ptr.tx = (cx / w) * 2 - 1;
    ptr.ty = (cy / h) * 2 - 1;
  }

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length) onMove(e.touches[0]);
  }, { passive: true });

  window.addEventListener('mousedown', function () { ptr.down = true; });
  window.addEventListener('mouseup', function () { ptr.down = false; });

  /* ---------------- Resize ---------------- */

  function resize() {
    var w = window.innerWidth || 1;
    var h = window.innerHeight || 1;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    buildBloom(w, h);

    halfH = Math.tan((FOV * DEG) / 2) * CAM_Z;
    halfW = halfH * camera.aspect;

    for (var i = 0; i < shapes.length; i++) {
      var a = ANCHORS[i];
      if (!a) continue;
      shapes[i].base.x = a.nx * FIELD_X * halfW;
      shapes[i].base.y = a.ny * FIELD_Y * halfH;
    }
  }

  window.addEventListener('resize', resize);
  resize();

  /* ---------------- Animation loop ---------------- */

  var clock = new THREE.Clock();
  var yawOffset = 0;
  var spinExtra = 0;
  var idleSpin = 0;
  var elapsed = 0;
  var running = true;

  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) clock.getDelta();
  });

  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }

  var motionScale = prefersReduced ? 0.45 : 1;

  /* idle: a slow, calm turn — clearly rotating, never hurried. Kept low so the
     cube spends a good while near the isometric pose, which is the only angle
     at which the impossible weave reads. */
  var IDLE_SPIN = 0.13 * motionScale;
  /* a small breathing sway layered on top so the turn never feels mechanical */
  var SWAY = 0.055 * motionScale;

  function frame() {
    requestAnimationFrame(frame);
    if (!running) return;

    var dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    /* -- pointer smoothing -- */
    ptr.sx = damp(ptr.sx, ptr.tx, 4.6, dt);
    ptr.sy = damp(ptr.sy, ptr.ty, 4.6, dt);

    /* -- cursor speed → extra spin. Deliberately eager: moving the mouse is
          meant to visibly wind the cube up. -- */
    var target = Math.min((ptr.vel / 12) * motionScale, 4.0);
    if (ptr.down) target = Math.min(target + 1.6, 5.6);
    ptr.boost = damp(ptr.boost, target, 5.0, dt);
    ptr.vel = damp(ptr.vel, 0, 1.7, dt);

    spinExtra += ptr.boost * dt;
    spinExtra = damp(spinExtra, 0, 0.50, dt);

    /* -- idle turn + pointer follow on yaw -- */
    idleSpin += IDLE_SPIN * dt;
    yawOffset = damp(yawOffset, ptr.sx * 0.85, 4.2, dt);

    cubeRoot.rotation.y = YAW_Y + idleSpin + spinExtra
      + Math.sin(elapsed * 0.42) * SWAY + yawOffset;
    cubeRoot.rotation.x = damp(cubeRoot.rotation.x,
      TILT_X + Math.sin(elapsed * 0.33) * 0.05 * motionScale + ptr.sy * 0.30, 3.0, dt);
    cubeRoot.rotation.z = damp(cubeRoot.rotation.z, -ptr.sx * 0.10, 2.6, dt);

    cubeRoot.position.x = damp(cubeRoot.position.x, ptr.sx * 0.26, 3.0, dt);
    cubeRoot.position.y = damp(cubeRoot.position.y, Math.sin(elapsed * 0.5) * 0.085 - ptr.sy * 0.15, 3.0, dt);

    /* -- floating macaron shapes -- */
    var px = -ptr.sx * 0.52;
    var py = ptr.sy * 0.34;

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var m = s.mesh;
      var ph = elapsed * s.spd + s.phase;

      m.position.x = s.base.x + Math.cos(ph * 0.78) * s.ampX + px * s.depth;
      m.position.y = s.base.y + Math.sin(ph) * s.ampY + py * s.depth;
      m.position.z = s.base.z + Math.sin(ph * 0.55 + 1.2) * 0.22;

      if (s.flat) {
        m.rotation.x = s.rotBase.x + Math.sin(ph * 0.55) * 0.11;
        m.rotation.y = s.rotBase.y + Math.cos(ph * 0.46) * 0.13;
        m.rotation.z = s.rotBase.z + Math.sin(ph * 0.36) * 0.08;
      } else {
        m.rotation.x += s.rot.x * dt * motionScale;
        m.rotation.y += s.rot.y * dt * motionScale;
        m.rotation.z += s.rot.z * dt * motionScale;
      }

      var p = Math.max(0, Math.min(1, (elapsed - s.entry) / 0.9));
      m.scale.setScalar(s.baseScale * easeOutCubic(p));
    }

    /* -- gentle drift of the whole field -- */
    shapeGroup.position.x = damp(shapeGroup.position.x, ptr.sx * 0.12, 1.8, dt);
    shapeGroup.position.y = damp(shapeGroup.position.y, -ptr.sy * 0.08, 1.8, dt);

    camera.position.x = damp(camera.position.x, ptr.sx * 0.16, 1.6, dt);
    camera.position.y = damp(camera.position.y, -ptr.sy * 0.12, 1.6, dt);
    camera.lookAt(0, 0, 0);

    cubeHalo.position.x = cubeRoot.position.x;
    cubeHalo.position.y = cubeRoot.position.y;

    /* -- draw: bloom first (into its own targets), then the scene on the
          canvas, then add the bloom on top -- */
    renderBloom();

    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.render(scene, camera);

    compositeBloom();
  }

  frame();
})();
