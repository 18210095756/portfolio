/* ============================================================================
   Liquid metal — 右上角「联系我」
   ----------------------------------------------------------------------------
   参考 vechooool.com/projects/living-green 的 "Explore the work" 按钮，把它移植
   到本站。原版是五个 WebGL2 pass 的色散（dispersion）着色器：

     1. 金属场   —— 显式构造一族近乎平行的"谷线"曲面 V = (y − valley(x)) · density(x)。
                    等值线是同一条谷线的上下平移，所以色带是层流的、近似平行的；
                    沿 x 变化的密度让它们在一端挤成细如刀锋的彩线、在另一端摊成
                    大片色晕。再用一个"软平台"函数对 V 上色，并且每个波长取在
                    略微不同的高度上采样一次 —— 于是每条色带的下沿先亮起暖色、
                    上沿先熄灭暖色，每条边都开成一枚棱镜，宽度 = dispersion / |∇V|。
     2. 描边     —— 沿胶囊周长跑的三团高光，按弧长匀速，单独一个 pass 以免被
                    后面的模糊磨钝；每通道在"跨描边"和"沿描边"两个方向都偏移，
                    于是边缘外侧偏暖、内侧偏冷，而且整条边的色相随高光滑动而漂移。
     3. 软化模糊 —— 半分辨率下采样 + 可分离高斯，把刻线感变成浇铸感。
     4. 辉光     —— 软化后的金属 + 锐利描边一起进模糊链（半径按按钮高度归一）。
     5. 合成     —— 归一化模糊（除以被模糊的覆盖度，边缘才不塌）、在标签区压一层
                    遮罩、再把辉光加回来（外面为主，允许少量漏回内部）。

   本站的改动只有三类，着色器的算法一行没动（HEAD / FRAG_RIM / FRAG_DOWN /
   FRAG_BLUR / FRAG_COMP 的结构与原版同构）：
     a. 配色。spec() 从"等能白光三峰"换成「奶油 → 丁香紫」的色散斜坡；描边从
        "塞进 R/G/B 的彩虹边"换成页面自己的暖/中/冷三支色 + RIM_NORM 归一化。
        金属依旧是金属（依旧有色散、依旧有冷边暖边），但读起来是本页的颜色，
        而不是把参考站的白铬搬过来。
     b. 尺度补偿。参考按钮 120px 高，本站这颗只有 33px，色带周期、软化半径、
        色散量都要按按钮高度重算，否则会糊成一片均匀的灰。
     c. 画布只比按钮大一圈（CSS 的 --lb-glow），不是整页 stage；另外原版在拿不到
        WebGL2 时会把 document.body 整个换掉，本站绝不能那么做 —— 暗玻璃底板在
        CSS 里已经把按钮画全了，这里安静退出即可。

   调参依据全部来自"同一相对条带"的实测量（见 _liq.mjs 的 measure / tune 模式）：
   参考按钮亮部平均色差 9.1、色差>25 占 13.6%、峰值 80；改之前本站是 4.6 / 1.8% / 47
   —— 也就是"亮倒是够亮，但亮成了一片纯白"。上面 disp / gain / chromA 的取值就是
   把这三个数往上抬的结果。

   依赖：WebGL2。无任何库，纯 canvas + 着色器，file:// 直接双击可用。
   ============================================================================ */
(function () {
  'use strict';

  var btn = document.getElementById('liquidBtn');
  if (!btn) return;
  var cv = btn.querySelector('.btn-liquid__fx');
  if (!cv) return;

  var gl = cv.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true      // 截图/合成时机不该决定这一帧还在不在
  });
  if (!gl) return;                   // 没有 WebGL2：CSS 底板兜住，不破坏整页

  /* ---------------------------------------------------------------- 着色器 */

  var VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position,0.,1.); }`;

  /* 公共头：胶囊有向距离场、按压水波、光标"井"。
     - ripple：以"按钮高度"为单位半径的扩张环。刻意不做成水波：波前是按角度
       调制的多边形（facet）、并且随传播旋转；波峰是 cusp 而非高斯 —— 于是它
       落在金属上是一道"折痕"，而不是一圈柔软的隆起。
     - pointerW / pointerWarp：光标是一个滞后的软坑，速度越快越深。移动的是
       *采样点* 而不是场值 —— 这才是"液体"的关键：色带会像透镜一样被光标
       推着鼓起、拉长，而不只是在光标下变亮。 */
  var HEAD = `#version 300 es
precision highp float;
out vec4 o;

uniform vec2  uC;        // 胶囊中心，设备像素
uniform vec2  uHalf;     // 胶囊半尺寸，设备像素
uniform float uT;        // 秒
uniform float uHover;    // 0..1
uniform float uPress;    // 0..1，做过缓动
uniform vec4  uRip[3];   // xy 圆心（按钮高度为单位，+y 向下），z 起始时刻，w 是否存活
uniform vec4  uRipK;     // 速度, 环宽, 衰减, 幅度
uniform vec4  uRipK2;    // facet 深度, facet 数量, 波峰锐度, 自发光
uniform vec4  uPtr;      // xy 滞后的光标, z 强度, w 归一化速度
uniform vec4  uPtrK;     // 半径, 基础幅度, 速度附加幅度, 描边提亮
uniform vec2  uVeil;     // 标签遮罩的起止（|y| / 半高），只有合成 pass 用

#define PI 3.14159265

float sdPill(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x,q.y),0.) + length(max(q,0.)) - r;
}

float ripple(vec2 p, float t){
  float sum = 0.;
  for(int i = 0; i < 3; i++){
    if(uRip[i].w < 0.5) continue;
    float age = t - uRip[i].z;
    if(age < 0. || age > 4.) continue;
    vec2  rp = p - uRip[i].xy;
    float facet = 1. + uRipK2.x * cos(uRipK2.y * atan(rp.y, rp.x) + age * 2.1 + float(i) * 2.4);
    float x = (length(rp) - age * uRipK.x * facet) / uRipK.y;
    sum += exp(-pow(abs(x) + 1e-4, uRipK2.z)) * exp(-age * uRipK.z);
  }
  return sum;
}

float pointerW(vec2 p){
  if(uPtr.z < 0.001) return 0.;
  float d = length(p - uPtr.xy) / uPtrK.x;
  return exp(-d*d) * uPtr.z;
}

vec2 pointerWarp(vec2 p){
  float w = pointerW(p);
  if(w <= 0.) return vec2(0.);
  return normalize(p - uPtr.xy + vec2(1e-5)) * w * (uPtrK.y + uPtrK.z * uPtr.w);
}
`;

  /* ---- 移动的描边，单独一个 pass，好让后面的模糊碰不到它 */
  var FRAG_RIM = HEAD + `
uniform float uBw;       // 描边半宽，设备像素
uniform float uE[9];     // base, hot, 跨描边色差, 沿描边色差, 速度,
                         // topBias, 按压抬升, 水波抬升, tint

/* ★ 本站改动的第二处：描边的配色。
   原版把三束互相错开的光带直接塞进 R / G / B 三个通道，于是描边两侧必然
   是纯红与纯蓝 —— 一条彩虹边。但"金属感"来自三束带子在弧长上彼此错开、
   且色相随高光滑动而漂移，跟颜色本身无关，所以这里换成页面自己的三支色：
     外侧一束（暖，最先亮）→ 蜜桃奶油   中线一束 → 近白   内侧一束 → 丁香紫
   uE[8] 是 tint：0 完全回到原版的纯 RGB 映射，1 = 全用页面调色板。 */
const vec3  RIM_WARM = vec3(1.00, 0.82, 0.60);
// 中线取本页的奶油色 #f2ebdc（而不是中性白）：静止时金属完全熄灭，整颗按钮
// 只剩这一圈描边在动，偏一点点暖才不会读成"灰边"。
const vec3  RIM_MID  = vec3(1.00, 0.96, 0.87);
const vec3  RIM_COOL = vec3(0.72, 0.60, 1.00);
/* 必须归一化。原版每束带子只落在一个通道上，总亮度 ≈ l0+l1+l2 的加权和（≈1）；
   换成三支色相后，每束带子都会同时点亮三个通道，总亮度变成 2.46 倍 ——
   描边会整体过曝，而这股光还会顺着辉光链灌回胶囊内部，把整张面板冲成一片白
   （第一版就是这样，量到的"下半片过曝比例"高达 0.47）。
   0.407 = 1 / (L(W)+L(M)+L(C))，把描边的总光通量拉回参考的水平。
   注意：换色相后要重算这个数，否则亮度会跟着配色一起漂。 */
const float RIM_NORM = 0.407;

/* 沿胶囊周长的弧长位置，0..1，从右侧极点起、逆时针。
   直段与两端半圆都按真实长度计，所以高光绕一圈是匀速的，不会在端头卡住。 */
float perim(vec2 d, float a, float r){
  float P = 4.*a + 2.*PI*r;
  float s;
  if(d.x >= a){                                   // 右端半圆
    float th = atan(d.y, d.x - a); if(th < 0.) th += 2.*PI;
    s = (th <= PI*0.5) ? r*th : P - r*(2.*PI - th);
  } else if(d.x <= -a){                           // 左端半圆
    float th = atan(d.y, d.x + a); if(th < 0.) th += 2.*PI;
    s = r*PI*0.5 + 2.*a + r*(th - PI*0.5);
  } else if(d.y >= 0.){                           // 上边直段
    s = r*PI*0.5 + (a - d.x);
  } else {                                        // 下边直段
    s = r*PI*1.5 + 2.*a + (d.x + a);
  }
  return s / P;
}
// 周期凸起，高光在 s = 0 处能干净地绕回去
float pb(float u, float w){ u = fract(u); float x = min(u, 1.-u); return exp(-(x*x)/(w*w)); }

// 三团速度与宽度都不同的高光，永远错开，于是光一直在重新汇聚
float rimHot(float s, float t){
  float v = uE[0];
  v += 0.62 * pb(s - t*uE[4],             0.075);
  v += 0.44 * pb(s + t*uE[4]*0.63 + 0.41, 0.135);
  v += 0.30 * pb(s - t*uE[4]*0.34 + 0.73, 0.200);
  return v;
}
// 贴着胶囊边缘的软带，逐通道偏移 → 跨描边方向出现色差
float rimBand(float sd, float off){ return 1. - smoothstep(0., uBw*1.05, abs(sd + uBw*0.55 + off)); }

void main(){
  vec2  d  = gl_FragCoord.xy - uC;
  float sd = sdPill(d, uHalf, uHalf.y);
  if(sd > uBw*2.5 || sd < -uBw*3.5){ o = vec4(0.); return; }

  float a = max(uHalf.x - uHalf.y, 0.);
  float s = perim(d, a, uHalf.y);
  float top = mix(1., 0.5 + 0.5 * (d.y / uHalf.y), uE[5]);

  // 按下会整体抬高描边亮度，每道水波扫过时再闪一次 —— 描边把"按压"报了两遍：
  // 一次是台阶，一次是沿边缘跑过去的波
  vec2  p   = vec2(d.x, -d.y) / (uHalf.y * 2.);
  float lift = 1. + uPress * uE[6] + ripple(p, uT) * uE[7]
             + pointerW(p) * uPtrK.w;

  vec3 lobes = vec3(
    rimBand(sd,  uE[2]) * rimHot(s + uE[3], uT),
    rimBand(sd,  0.   ) * rimHot(s,         uT),
    rimBand(sd, -uE[2]) * rimHot(s - uE[3], uT)
  );
  vec3 pal = (lobes.x * RIM_WARM + lobes.y * RIM_MID + lobes.z * RIM_COOL) * RIM_NORM;
  o = vec4(mix(lobes, pal, uE[8]) * uE[1] * top * lift, 1.);
}`;

  var FRAG_SCENE = HEAD + `
uniform float uP[21];    // tunables

float h21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  float a = h21(i), b = h21(i+vec2(1,0)), c = h21(i+vec2(0,1)), d = h21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y) * 2. - 1.;
}
// 归一到约 -1..1；低 gain 让第一倍频占主导，色带才会又大又顺而不是一团湍流
float fbm(vec2 p, float g){
  float s = 0., a = 1., n = 0.;
  for(int i=0;i<4;i++){ s += a*vn(p); n += a; p = p*2.03 + 11.7; a *= g; }
  return s / n;
}
float fbm(vec2 p){ return fbm(p, 0.5); }

// 缓慢漂移的一维平滑抖动
float wig(float x, float t, float seed){
  return vn(vec2(x,          t*0.150 + seed)) * 0.60
       + vn(vec2(x*2.07 + 4., t*0.105 + seed)) * 0.27
       + vn(vec2(x*4.30 - 7., t*0.080 + seed)) * 0.13;
}

float valleyAt(vec2 p, float t){ return wig(p.x*uP[0], t, 0.0) * uP[1]; }
float densAt  (vec2 p, float t){ return uP[2] * exp(uP[3] * wig(p.x*uP[4] + 9.0, t, 2.7)); }

float surface(vec2 p, float t){
  float V = (p.y - valleyAt(p,t)) * densAt(p,t);
  V += uP[5] * fbm(p*vec2(0.8, 1.7)*uP[6] + vec2(t*0.05, -t*0.03), uP[17]);
  return V - uP[7];
}
// V 每 1 个单位一条色带 —— 所以密度的字面含义就是"每按钮高度几条带"。
// 用平台而不是阶跃，才会在每条带的低沿留暖、高沿留冷。
float tone(float v){
  float u = fract(v);
  float e = uP[9], W = uP[10] * 0.5;
  return smoothstep(0.5-W-e, 0.5-W, u) * (1. - smoothstep(0.5+W, 0.5+W+e, u));
}

/* ★ 本站改动的唯一一处：色散斜坡。
   原版是等能白光三峰 clamp(vec3(1.5) - abs(4t - vec3(3,2,1)))，在近黑底上会亮成
   一支"外来的白铬"。这里换成页面自己的两支颜色：
     t = 0（低沿，暖，最先亮）  → 奶油 + 一抹蜜桃
     t = 1（高沿，冷，最先灭）  → 丁香紫
     t ≈ 0.5                    → 近白，保住"金属"的白热核心
   权重仍会做归一化，所以整体亮度与原版一致，只是色相换成了本页的语言。 */
vec3 spec(float t){
  float k = t * 2. - 1.;
  vec3 cream = vec3(1.00, 0.98, 0.93);
  vec3 peach = vec3(1.00, 0.76, 0.44);   // #ffc270
  vec3 lilac = vec3(0.60, 0.45, 1.00);   // #9973ff
  return k < 0. ? mix(cream, peach, -k) : mix(cream, lilac, k);
}

void main(){
  vec2  d  = gl_FragCoord.xy - uC;
  float sd = sdPill(d, uHalf, uHalf.y);
  float pill = 1. - smoothstep(-1., 1., sd);
  float S = uHalf.y * 2.;                 // 按钮高度，设备像素
  float t = uT;

  // rgb 预乘遮罩、alpha 携带遮罩，后面的模糊才能归一化并保住干净的边
  if(uHover <= 0.0015 || pill <= 0.0015){ o = vec4(0., 0., 0., pill); return; }

  vec2  p = vec2(d.x, -d.y) / S;          // gl_FragCoord 是 y 向上
  vec2  q = p + pointerWarp(p);           // 光标拖着这张"金属皮"

  // 自折射：沿场自身的梯度方向弯折采样点，等值线被挤成褶皱而不是均匀排列
  float h0 = surface(q, t);
  vec2  gp = vec2(dFdx(h0), -dFdy(h0)) * S;          // p 单位下的梯度
  float V  = surface(q - gp * uP[8] / max(uP[2], .001), t);

  // 顺梯度方向的丝缕：跨等值线变化快、沿线变化慢，细节才像拉长的光纤维
  vec2  gd = normalize(gp + vec2(1e-5));
  V += uP[13] * fbm(vec2(dot(q,gd)*uP[14], dot(q, vec2(-gd.y,gd.x))*uP[14]*0.04) + vec2(0., t*0.06));

  // 按压水波：位移场而不是叠加亮度，色带会自己向外弯出去 ——
  // 这才是"金属里的一道扰动"，而不是贴在上面的一张花纸
  float rip  = ripple(p, t);
  float well = pointerW(p);
  V += rip * uRipK.w;

  // 真实的色散对波长不是线性的：蓝端偏折远大于红端（Cauchy）。
  // 按同样方式歪斜采样偏移，才会有参考那样"宽冷晕 + 紧暖边"的对比。
  const int N = 21;
  float mid = 1. - pow(0.5, uP[12]);
  vec3 col = vec3(0.), wsum = vec3(0.);
  for(int i=0;i<N;i++){
    float k = float(i)/float(N-1);
    vec3  w = spec(k);
    col  += w * tone(V + ((1. - pow(1. - k, uP[12])) - mid) * uP[11]);
    wsum += w;
  }
  col /= wsum;
  col = pow(col, vec3(uP[15]));

  // 光照包络 —— 色带只存在于被照亮的那片金属上，暗的那道月牙由同一条谷线划出
  float lit = smoothstep(uP[18], uP[19], q.y - valleyAt(q, t));
  lit *= mix(1., lit, 0.55);                     // 加深未照亮的月牙
  col *= uP[16] * lit;

  // 波峰会烧得更亮，并且自带一点光，好让它在软化模糊之后、以及暗部仍然可读
  col = col * (1. + rip * 1.15 + well * 0.60);

  o = vec4(col * pill * uHover, pill);
}`;

  /* 下采样；可选叠加第二张源（用来把描边折进辉光的输入）。
     alpha 一路带着走，金属的覆盖遮罩才能活过整条模糊链。 */
  var FRAG_DOWN = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex, uTex2;
uniform vec2 uDstTexel;   // 1 / 目标尺寸
uniform vec2 uSrcTexel;   // 1 / 源尺寸
uniform float uAdd;       // 1 则把 uTex2 也算进来
void main(){
  vec2 uv = gl_FragCoord.xy * uDstTexel;
  // 采样点落在"目标"texel 的四分之一处：2 倍降采样时正好命中四个源 texel 的中心。
  // 若按整格源 texel 铺开，就会隔一个跳一个，场里的细节会折成低频摩尔纹，
  // 之后再怎么模糊都去不掉。
  vec2 e = uDstTexel * 0.25;
  vec4 s = texture(uTex, uv + vec2(-e.x,-e.y)) + texture(uTex, uv + vec2( e.x,-e.y))
         + texture(uTex, uv + vec2(-e.x, e.y)) + texture(uTex, uv + vec2( e.x, e.y));
  s *= 0.25;
  if(uAdd > 0.5){
    vec4 r = texture(uTex2, uv + vec2(-e.x,-e.y)) + texture(uTex2, uv + vec2( e.x,-e.y))
           + texture(uTex2, uv + vec2(-e.x, e.y)) + texture(uTex2, uv + vec2( e.x, e.y));
    s.rgb += r.rgb * 0.25;
  }
  o = s;
}`;

  var FRAG_BLUR = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform float uR;
void main(){
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 st = uTexel * uDir * uR;
  vec4 s = texture(uTex, uv) * 0.1964;
  s += (texture(uTex, uv + st*1.4118) + texture(uTex, uv - st*1.4118)) * 0.2969;
  s += (texture(uTex, uv + st*3.2941) + texture(uTex, uv - st*3.2941)) * 0.0944;
  s += (texture(uTex, uv + st*5.1765) + texture(uTex, uv - st*5.1765)) * 0.0104;
  o = s;
}`;

  var FRAG_COMP = HEAD + `
uniform sampler2D uSoft, uRim, uGlow;
uniform vec2  uRes;
uniform float uGlowGain, uGlowIn, uOccl, uDim, uPunch;

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 glow = texture(uGlow, uv).rgb;

  vec2  d    = gl_FragCoord.xy - uC;
  float sd   = sdPill(d, uHalf, uHalf.y);
  float pill = 1. - smoothstep(-1., 1., sd);

  // 归一化模糊：除以被模糊后的覆盖度，软化过的金属就能一路满强度顶到边缘，
  // 而不是在遮罩里慢慢淡出
  vec4 m = texture(uSoft, uv);

  // 遮罩放在模糊*之后*：把标签所在的中段压暗，上下两端保持全亮。
  // 若放在模糊之前，这层保护会被糊开、挡不住标签。
  // ★ 起止值本站单独调过。参考站是 (0.46, 0.88)：那是个 120px 高、单行大字
  //   的大按钮，中段本身就占了很大的绝对面积。本站的胶囊只有 33px 高，而金属
  //   最亮的一片（贴着下沿的那圈色带）正好落在 |y|/half ≈ 0.5~0.7 —— 沿用原值
  //   会把最该发光的地方压掉一半，实测峰值只有参考的 48%。收到 (0.38, 0.74)
  //   后，遮罩只盖住文字那一条，上下两端都能烧亮。
  float veil = 1. - smoothstep(uVeil.x, uVeil.y, abs(d.y) / uHalf.y);

  // 模糊会把色阶压成一片灰雾；在模糊之后补一条对比曲线（不额外牺牲柔和度），
  // 才会读成"浇铸的金属"而不是一坨柔光。高光保持原水平，中间调沉下去。
  vec3 metal = pow(max(m.rgb / max(m.a, 1e-3), 0.), vec3(uPunch));

  vec3 core = metal * pill * mix(1., uDim, veil) + texture(uRim, uv).rgb;

  // 水波自带的光在这里加 —— 在模糊之后，折痕才能保持锐利。
  // 它对场的位移仍留在软化过的金属里：金属皮鼓起，波峰在折痕上闪光。
  float rip = ripple(vec2(d.x, -d.y) / (uHalf.y * 2.), uT);
  core += vec3(rip * rip) * uRipK2.w * pill * mix(1., 0.42, veil);

  // 按钮用自己的阴影遮住自己的辉光，于是即使面板被打爆，投影依旧有对比
  float sdSh = sdPill(d + vec2(0., uHalf.y * 0.62), uHalf * 0.94, uHalf.y * 0.94);
  float occl = uOccl * exp(-max(sdSh, 0.) / (uHalf.y * 0.75));

  // 辉光在画布边缘必须已经归零：模糊链用 CLAMP_TO_EDGE，只要边缘还剩一点
  // 能量，就会在画布矩形上留下一条看得见的硬边 —— 近黑底上尤其明显（第一版
  // 就是靠这条矩形缝被发现的）。这里给辉光单独加一扇窗口，在距边 16% 处开始
  // 淡出，与模糊半径解耦：以后怎么改 glowR 都不会再跑出接缝。
  vec2 gwin = smoothstep(vec2(0.), vec2(0.16), uv) * (1. - smoothstep(vec2(0.84), vec2(1.), uv));
  float gmask = gwin.x * gwin.y;

  // 辉光主要向外溢；允许少量回到内部，让火热的描边在面板上洇开一圈，
  // 参考组件就是这个样子
  vec3 rgb = core + glow * uGlowGain * mix(1., uGlowIn, pill) * (1. - occl * (1. - pill)) * gmask;

  // 预乘输出：底下的环境光与按钮投影都是 CSS，这一层只负责往上加光
  float a = clamp(max(rgb.r, max(rgb.g, rgb.b)), 0., 1.);
  o = vec4(min(rgb, vec3(1.)), a);
}`;

  /* ------------------------------------------------------------ 可调参数 */

  // 金属场 —— uP[0..20]
  var P = {
    valFreq:   0.50,   // 0  谷线的 x 向频率
    valAmp:    0.55,   // 1  谷深（以按钮高度为单位；上限保证色带不会整个漂出胶囊）
    dens:      2.40,   // 2  带密度 —— 每按钮高度几条带
    densVar:   2.20,   // 3  密度沿 x 的摆动幅度（指数）
    densFreq:  0.32,   // 4  密度变化的 x 向频率
    wobAmp:    0.12,   // 5  有机二维抖动幅度（场单位）
    wobFreq:   1.60,   // 6  其频率
    lift:      0.05,   // 7  带族的相位偏移
    refract:   0.18,   // 8  自折射 —— 把等值线折起来
    edge:      0.04,   // 9  平台边缘的软度
    width:     0.46,   // 10 平台宽度（占一个带周期）
    /* 色散量（以带周期为单位）。参考站比这个大得多：它的按钮 120px 高、色带
       周期 25 texel，一条棱镜边就有好几个 texel 宽。本站胶囊只有 33px 高，
       沿用原值后"亮部几乎全是纯白"（实测亮部平均色差 4.6、色差>25 的只占
       1.8%，而参考是 9.1 / 13.6%）。0.52 让每条带边真正开成一枚棱镜，
       奶油端与丁香端才看得见。 */
    disp:      0.52,   // 11 色散量（以带周期为单位）
    /* 色散偏斜 —— >1 时冷端摊得更开（Cauchy：蓝端偏折远大于红端），
       于是"宽冷晕 + 紧暖边"的对比才出来。 */
    skew:      1.65,   // 12 色散偏斜
    // 丝缕原本是每按钮高度 20 个周期 —— 比软化缓冲能承载的更细，
    // 于是它会走样成条纹而不是纤维。在当前模糊量下它只贡献走样，故关闭。
    fineAmp:   0.0,    // 13 丝缕幅度
    fineFreq:  9.0,    // 14 丝缕跨等值线的频率
    gamma:     1.00,   // 15 色调 gamma
    /* 参考站 1.90。它的按钮 120px 高、色带周期 25 texel；本站的胶囊只有 33px 高，
       同样的软化量会把色带糊成一片均匀的灰，峰值只有参考的 48%。这里提到 2.15 ——
       但没有敢给到 2.6：增益越高，被照亮的那半片越接近整体过曝，色散边一起被
       冲成纯白（2.40 时亮部平均色差只剩 4.6，彩边基本没了）。2.15 是"够亮到成铬"
       与"彩边还活着"的折中。 */
    gain:      2.15,   // 16 总增益
    octGain:   0.32,   // 17 fbm 倍频增益 —— 低，抖动才大块
    litLo:    -0.26,   // 18 谷线往下多远开始见光
    litHi:     0.10,   // 19 …到哪算全亮
    dim:       0.44    // 20 标签底下把金属压暗多少
  };
  var PKEYS = Object.keys(P);

  // 移动的描边 —— uE[0..8]
  var E = {
    // 原版 0.20。本站的胶囊只有 33px 高、静止时没有任何金属，整颗按钮全靠这一圈
    // 描边撑着，底噪得高一点才不至于读成一条灰线。
    base:   0.24,      // 0 底噪亮度，整条轮廓始终有形
    // 原版 0.82；因为上面把配色归一化了，这里补回一点，静止态的辉光才有存在感。
    hot:    1.00,      // 1 移动高光的增益
    /* 跨描边的色差（设备像素）。参考按钮那条边在放大图上是"外侧暖金、内侧冷蓝"
       两条清晰分开的细线 —— 靠的就是这个偏移量。0.42 时三束光几乎叠在一起，
       合出来只是一条偏暖的白边；0.85 才真的分层。 */
    chromA: 0.85,      // 2 跨描边的色差（设备像素）
    chromS: 0.055,     // 3 沿描边的色差（圈数）
    // 参考站是 0.070。那是个 120px 高的大按钮，一圈 14 秒；
    // 本站这颗只有 33px 高，同样慢就会像卡住 —— 提到 0.10，一圈 10 秒。
    speed:  0.100,     // 4 领头高光的速度（圈/秒）
    top:    0.35,      // 5 描边偏向顶边的程度
    press:  0.85,      // 6 按住时轮廓提亮多少
    ripple: 1.60,      // 7 水波掠过轮廓时的额外闪光
    tint:   1.00       // 8 描边配色：1 = 页面调色板，0 = 原版纯 RGB 彩虹边
  };
  var EKEYS = Object.keys(E);

  // 合成 / 只在 JS 侧
  var C = {
    glow:   1.70,      // 外辉光增益
    glowR:  2.10,      // 外辉光半径（见 --lb-glow 的说明：辉光必须死在画布内）
    glowIn: 0.30,      // 允许多少辉光漏回胶囊内部
    occl:   0.62,      // 投影吃掉多少辉光
    soften: 0.16,      // 金属的模糊量（按钮高度为单位）—— "熔融"旋钮
                       //   太大 = 色带全糊成均匀灰；太小 = 刻线感、像蚀刻而不是浇铸
    punch:  1.38,      // 软化后金属的对比曲线；1 = 关闭。越高越容易整片过曝
    veil:   [0.40, 0.78]   // 标签遮罩的起止（见 FRAG_COMP 里的说明）
  };

  // 扰动 —— 距离一律以按钮高度为单位，时间以秒为单位
  var R = {
    speed:  1.85,      // 水波扩张速度
    width:  0.20,      // 环厚
    decay:  1.35,      // e 折衰减
    amp:    1.35,      // 对金属场的位移
    facet:  0.18,      // 波前的多边化深度
    lobes:  6.0,       // 几个棱面
    sharp:  1.15,      // 波峰形状：2 = 高斯隆起，约 1 = 硬折痕
    emit:   0.45,      // 波峰自带的光
    ptrRad:  0.55,     // 光标坑半径
    ptrAmp:  0.32,     // 光标静止时把金属皮拖多远
    ptrFast: 0.40,     // 全速时的额外拖拽
    ptrRim:  0.80,     // 最近的描边提亮多少
    ptrLag:  0.0016,   // 拖尾：1 秒后剩下的比例（越小越跟手）
    ptrVref: 4.5       // 视为"快"的光标速度（按钮高度/秒）
  };

  /* --------------------------------------------------------------- 装配 */

  function sh(type, src){
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      // 编译失败时不要静默：把日志打出来，同时保留 CSS 底板
      console.error('[liquid-btn] shader compile failed\n' + gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function prog(fs){
    var p = gl.createProgram();
    var v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'position');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[liquid-btn] program link failed\n' + gl.getProgramInfoLog(p));
      return null;
    }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++){
      var info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  var pScene = prog(FRAG_SCENE), pRim = prog(FRAG_RIM),
      pDown  = prog(FRAG_DOWN),  pBlur = prog(FRAG_BLUR), pComp = prog(FRAG_COMP);
  if (!pScene || !pRim || !pDown || !pBlur || !pComp) return;

  var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  var vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var hasFloat = !!gl.getExtension('EXT_color_buffer_half_float');
  function makeTarget(){
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex: tex, fbo: fbo, w: 0, h: 0 };
  }
  function sizeTarget(t, w, h){
    if (t.w === w && t.h === h) return;
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (hasFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8,   w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  var T_core = makeTarget(), T_rim = makeTarget(),   // 全分辨率
      T_s1   = makeTarget(), T_s2  = makeTarget(),   // 半分辨率：金属软化
      T_a    = makeTarget(), T_b   = makeTarget();   // 1/DOWN：辉光

  var W = 0, H = 0, DPR = 1, BW = 0, BH = 0, CX = 0, CY = 0;
  // 辉光缓冲降采样到让按钮约 129 texel 高，于是一组模糊半径在 52px 的按钮
  // 和一张大 hero 上给出同样*相对*范围的辉光。
  var DOWN = 1;
  var GLOW_TEX = 129;
  var needResize = true;

  function resize(){
    var r  = cv.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(2, Math.round(r.width  * DPR));
    var h = Math.max(2, Math.round(r.height * DPR));
    if (w !== W || h !== H){ W = w; H = h; cv.width = W; cv.height = H; }
    BW = br.width  * DPR; BH = br.height * DPR;
    CX = (br.left - r.left) * DPR + BW / 2;
    CY = H - ((br.top - r.top) * DPR + BH / 2);   // gl_FragCoord 是 y 向上
    sizeTarget(T_core, W, H); sizeTarget(T_rim, W, H);
    var hw = Math.max(2, Math.ceil(W / 2)), hh = Math.max(2, Math.ceil(H / 2));
    sizeTarget(T_s1, hw, hh); sizeTarget(T_s2, hw, hh);
    DOWN = Math.max(1, Math.min(4, Math.round(BH / GLOW_TEX)));
    var dw = Math.max(2, Math.ceil(W / DOWN)), dh = Math.max(2, Math.ceil(H / DOWN));
    sizeTarget(T_a, dw, dh); sizeTarget(T_b, dw, dh);
    needResize = false;
  }
  if (window.ResizeObserver) new ResizeObserver(function () { needResize = true; }).observe(btn);
  window.addEventListener('resize', function () { needResize = true; }, { passive: true });
  window.addEventListener('orientationchange', function () { needResize = true; }, { passive: true });
  if (document.fonts && document.fonts.ready) {
    // 字体落地后按钮宽度会变一次（中文字面差异），量出来再对齐
    document.fonts.ready.then(function () { needResize = true; });
  }

  function drawTo(t){
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : W, t ? t.h : H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------------------------------------------------------------- 状态 */

  var uArr = new Float32Array(PKEYS.length);
  var eArr = new Float32Array(EKEYS.length);
  var hover = 0, hoverTarget = 0, clock = 0;
  // 第一帧的 rAF 时间戳可能早于这里取到的 performance.now()（合成器给的
  // 时间戳是"本帧开始渲染"的时刻，未必晚于脚本执行的时刻）。若不设防，
  // dt 会是个负数一路灌进 clock，水波的 age 与抖动采样都会错乱。
  var last = 0;

  // 三个水波槽位轮流复用，连点才能叠而不是互相截断
  var RIP = [0,1,2].map(function () { return { x: 0, y: 0, t: -99, on: 0 }; });
  var ripArr = new Float32Array(12);
  var ripNext = 0, press = 0, pressTarget = 0;

  // 光标坑：金属追一个目标点，同时记录被拖动的速度
  var ptr = { x: 0, y: 0 }, ptrS = { x: 0, y: 0 };
  var ptrAmt = 0, ptrSpeed = 0;

  // 静止时金属场完全熄灭（与原版一致）：不悬停 = 只有一圈隐约流动的描边。
  // 如果哪天觉得太安静，把它抬到 0.1~0.2 就会让金属常驻。
  var IDLE_METAL = 0.0;

  function addRipple(x, y){
    var r = RIP[ripNext];
    ripNext = (ripNext + 1) % RIP.length;
    r.x = x; r.y = y; r.t = clock; r.on = 1;
  }
  // 指针位置 → 以胶囊中心为原点、按钮高度为单位，+y 向下
  function localPt(e){
    var b = btn.getBoundingClientRect(), s = b.height || 1;
    return [(e.clientX - (b.left + b.width / 2)) / s,
            (e.clientY - (b.top  + b.height / 2)) / s];
  }

  var calm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var drawn = null;                  // 上一帧真正画过的签名

  /* 静止帧率上限（移植自原版的 HOST ADAPTATION）。
     本站首页已经在跑 three.js 场景 + 变形大标题 + 撒尘拖尾，这颗按钮不该
     再每帧全速跑二十来个 draw call。原版实测两颗液金按钮会把整页从 92fps
     拉到 50fps —— 它给了 30Hz 上限。本站按钮小得多（画布约 154×73），开销
     低一个数量级，但仍沿用同样的克制：真正静止时 24Hz，只要有指针、按压、
     焦点或水波在飞，立刻回到每帧。 */
  var IDLE_HZ = 24;
  var lastDraw = 0;
  var raf = 0;

  function frame(now){
    if (!last) last = now;
    var dtRaw = (now - last) / 1000; last = now;
    var dt = Math.max(0, Math.min(dtRaw, 1 / 20));
    if (!calm.matches) clock += dt;

    // 非对称缓动：亮起快，熄灭更快一点
    var k = hoverTarget > hover ? 1 - Math.pow(0.0012, dt) : 1 - Math.pow(0.00012, dt);
    hover += (hoverTarget - hover) * k;
    if (Math.abs(hoverTarget - hover) < 0.0008) hover = hoverTarget;

    // 按压瞬间到位，松开慢慢走
    var pk = pressTarget > press ? 1 - Math.pow(1e-9, dt) : 1 - Math.pow(0.004, dt);
    press += (pressTarget - press) * pk;
    if (Math.abs(pressTarget - press) < 0.002) press = pressTarget;

    for (var i = 0; i < RIP.length; i++){
      var r = RIP[i];
      if (r.on && clock - r.t > 4) r.on = 0;
      ripArr[i*4] = r.x; ripArr[i*4+1] = r.y; ripArr[i*4+2] = r.t; ripArr[i*4+3] = r.on;
    }
    var ripLive = RIP.some(function (r) { return !!r.on; });

    // 坑追着光标走，速度越快越深
    var lag = 1 - Math.pow(R.ptrLag, dt);
    var dx = (ptr.x - ptrS.x) * lag, dy = (ptr.y - ptrS.y) * lag;
    ptrS.x += dx; ptrS.y += dy;
    var inst = Math.min(Math.hypot(dx, dy) / Math.max(dt, 1e-3) / R.ptrVref, 1);
    ptrSpeed += (inst - ptrSpeed) * (1 - Math.pow(inst > ptrSpeed ? 0.001 : 0.02, dt));
    var wantWell = (on.over || on.press) ? 1 : 0;
    ptrAmt += (wantWell - ptrAmt) * (1 - Math.pow(0.004, dt));
    if (Math.abs(wantWell - ptrAmt) < 0.002) ptrAmt = wantWell;

    if (needResize) resize();

    // 描边即使在静止时也在跑，所以真正静止的只有"减弱动效 + 无飞行中扰动"
    var sig = (calm.matches && !ripLive && ptrAmt < 0.002)
      ? hover + '|' + press + '|' + W + '|' + H : null;
    if (sig !== null && sig === drawn){ raf = requestAnimationFrame(frame); return; }
    drawn = sig;

    var idle = !on.over && !on.press && !on.focus && !ripLive
            && hover < 0.002 && press < 0.002 && ptrAmt < 0.002;
    if (idle && now - lastDraw < 1000 / IDLE_HZ){ raf = requestAnimationFrame(frame); return; }
    lastDraw = now;

    for (i = 0; i < uArr.length; i++) uArr[i] = P[PKEYS[i]];
    for (i = 0; i < eArr.length; i++) eArr[i] = E[EKEYS[i]];
    // 描边半宽（设备像素）。原式的 1.5 下限是"设备像素"口径，若不给它乘 DPR，
    // retina 上的描边会比 1x 屏幕细一半。
    var bw = Math.max(1.5 * DPR, 3.2 * (BH / 516));
    var hoverU = Math.max(hover, IDLE_METAL);

    // 1. 金属 + 移动的描边，遮罩到胶囊
    gl.useProgram(pScene.p);
    gl.uniform2f(pScene.u.uC, CX, CY);
    gl.uniform2f(pScene.u.uHalf, BW / 2, BH / 2);
    gl.uniform1f(pScene.u.uT, clock);
    gl.uniform1f(pScene.u.uHover, hoverU);
    gl.uniform1f(pScene.u.uPress, press);
    gl.uniform4fv(pScene.u.uRip, ripArr);
    gl.uniform4f(pScene.u.uRipK, R.speed, R.width, R.decay, R.amp);
    gl.uniform4f(pScene.u.uRipK2, R.facet, R.lobes, R.sharp, R.emit);
    gl.uniform4f(pScene.u.uPtr, ptrS.x, ptrS.y, ptrAmt, ptrSpeed);
    gl.uniform4f(pScene.u.uPtrK, R.ptrRad, R.ptrAmp, R.ptrFast, R.ptrRim);
    gl.uniform1fv(pScene.u.uP, uArr);
    drawTo(T_core);

    // 2. 描边，不进软化模糊，轮廓才能保持刀锋般细
    gl.useProgram(pRim.p);
    gl.uniform2f(pRim.u.uC, CX, CY);
    gl.uniform2f(pRim.u.uHalf, BW / 2, BH / 2);
    gl.uniform1f(pRim.u.uT, clock);
    gl.uniform1f(pRim.u.uBw, bw);
    gl.uniform1f(pRim.u.uPress, press);
    gl.uniform4fv(pRim.u.uRip, ripArr);
    gl.uniform4f(pRim.u.uRipK, R.speed, R.width, R.decay, R.amp);
    gl.uniform4f(pRim.u.uRipK2, R.facet, R.lobes, R.sharp, R.emit);
    gl.uniform4f(pRim.u.uPtr, ptrS.x, ptrS.y, ptrAmt, ptrSpeed);
    gl.uniform4f(pRim.u.uPtrK, R.ptrRad, R.ptrAmp, R.ptrFast, R.ptrRim);
    gl.uniform1fv(pRim.u.uE, eArr);
    drawTo(T_rim);

    // 3. 软化金属 —— 半分辨率降采样 + 两趟可分离高斯。正是这一步把棱镜般的
    //    色带变成"熔融"而不是"刻上去"的。
    gl.useProgram(pDown.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T_core.tex);
    gl.uniform1i(pDown.u.uTex, 0);
    gl.uniform1f(pDown.u.uAdd, 0);
    gl.uniform2f(pDown.u.uDstTexel, 1 / T_s1.w, 1 / T_s1.h);
    gl.uniform2f(pDown.u.uSrcTexel, 1 / W, 1 / H);
    drawTo(T_s1);

    gl.useProgram(pBlur.p);
    gl.uniform1i(pBlur.u.uTex, 0);
    gl.uniform2f(pBlur.u.uTexel, 1 / T_s1.w, 1 / T_s1.h);
    // 目标 sigma 以半分辨率 texel 计，且与按钮绑定，换任何尺寸都等比。
    // 一趟很宽的 9 tap 会留下明显的梳齿鬼影（tap 间距已经大于它所描述的
    // sigma），所以拆成若干趟，半径按平方和相加。
    var sigTex = C.soften * (BH * 0.5) * 0.95;
    if (sigTex > 0.1){
      var iters = Math.min(4, Math.max(1, Math.ceil(sigTex / 3.0)));
      gl.uniform1f(pBlur.u.uR, sigTex / Math.sqrt(iters) / 1.95);
      for (i = 0; i < iters; i++){
        gl.bindTexture(gl.TEXTURE_2D, T_s1.tex); gl.uniform2f(pBlur.u.uDir, 1, 0); drawTo(T_s2);
        gl.bindTexture(gl.TEXTURE_2D, T_s2.tex); gl.uniform2f(pBlur.u.uDir, 0, 1); drawTo(T_s1);
      }
    }

    // 4. 辉光，输入 = 软化后的金属 + 锐利的描边
    gl.useProgram(pDown.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T_s1.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T_rim.tex);
    gl.uniform1i(pDown.u.uTex, 0);
    gl.uniform1i(pDown.u.uTex2, 1);
    gl.uniform1f(pDown.u.uAdd, 1);
    gl.uniform2f(pDown.u.uDstTexel, 1 / T_a.w, 1 / T_a.h);
    gl.uniform2f(pDown.u.uSrcTexel, 1 / T_s1.w, 1 / T_s1.h);
    drawTo(T_a);

    gl.useProgram(pBlur.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(pBlur.u.uTex, 0);
    gl.uniform2f(pBlur.u.uTexel, 1 / T_a.w, 1 / T_a.h);
    var rs = C.glowR * (BH / DOWN) / GLOW_TEX;
    var RADII = [1.0, 2.3, 5.2, 9.0];
    for (var ri = 0; ri < RADII.length; ri++){
      gl.uniform1f(pBlur.u.uR, RADII[ri] * rs);
      gl.bindTexture(gl.TEXTURE_2D, T_a.tex); gl.uniform2f(pBlur.u.uDir, 1, 0); drawTo(T_b);
      gl.bindTexture(gl.TEXTURE_2D, T_b.tex); gl.uniform2f(pBlur.u.uDir, 0, 1); drawTo(T_a);
    }

    // 5. 合成
    gl.useProgram(pComp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T_s1.tex);  gl.uniform1i(pComp.u.uSoft, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T_rim.tex); gl.uniform1i(pComp.u.uRim, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T_a.tex);   gl.uniform1i(pComp.u.uGlow, 2);
    gl.uniform2f(pComp.u.uRes, W, H);
    gl.uniform2f(pComp.u.uC, CX, CY);
    gl.uniform2f(pComp.u.uHalf, BW / 2, BH / 2);
    gl.uniform1f(pComp.u.uT, clock);
    gl.uniform4fv(pComp.u.uRip, ripArr);
    gl.uniform4f(pComp.u.uRipK, R.speed, R.width, R.decay, R.amp);
    gl.uniform4f(pComp.u.uRipK2, R.facet, R.lobes, R.sharp, R.emit);
    gl.uniform1f(pComp.u.uGlowGain, C.glow);
    gl.uniform1f(pComp.u.uGlowIn, C.glowIn);
    gl.uniform2f(pComp.u.uVeil, C.veil[0], C.veil[1]);
    gl.uniform1f(pComp.u.uOccl, C.occl);
    gl.uniform1f(pComp.u.uDim, P.dim);
    gl.uniform1f(pComp.u.uPunch, C.punch);
    drawTo(null);

    raf = requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- 交互
     悬停、按压、键盘焦点都会点亮金属；按压还会从落点甩出一道水波。
     鼠标 / 触摸 / 键盘都能用。 */
  var on = { over: false, press: false, focus: false };
  function sync(){
    hoverTarget = (on.over || on.press || on.focus) ? 1 : 0;
    pressTarget = on.press ? 1 : 0;
    btn.classList.toggle('is-hot', hoverTarget > 0.5);
    btn.classList.toggle('is-press', on.press);
  }

  btn.addEventListener('pointerenter', function (e){
    if (e.pointerType !== 'mouse') return;
    // 把坑落在光标真正进入的位置，而不是它上次待着的地方
    var lp = localPt(e); ptr.x = lp[0]; ptr.y = lp[1];
    ptrS.x = ptr.x; ptrS.y = ptr.y; ptrSpeed = 0;
    on.over = true; sync();
  });
  btn.addEventListener('pointerleave', function (e){
    if (e.pointerType === 'mouse'){ on.over = false; sync(); }
  });

  // 光标拖着金属走；在 window 上监听，这样按住之后滑出按钮也还算数，
  // 但只在按钮确实被激活时才记录
  window.addEventListener('pointermove', function (e){
    if (!on.over && !on.press) return;
    var lp = localPt(e); ptr.x = lp[0]; ptr.y = lp[1];
  }, { passive: true });

  btn.addEventListener('pointerdown', function (e){
    var lp = localPt(e); ptr.x = lp[0]; ptr.y = lp[1];
    on.press = true; sync();
    addRipple(ptr.x, ptr.y);
  });
  window.addEventListener('pointerup',     function (){ on.press = false; sync(); });
  window.addEventListener('pointercancel', function (){ on.press = false; sync(); });

  // 只有键盘焦点保持点亮 —— 鼠标点完移开不该留着一颗发光的按钮
  btn.addEventListener('focus', function (){ on.focus = btn.matches(':focus-visible'); sync(); });
  btn.addEventListener('blur',  function (){ on.focus = false; sync(); });

  // 键盘激活同样对待，水波从中心甩出
  btn.addEventListener('keydown', function (e){
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    on.press = true; sync(); addRipple(0, 0);
  });
  btn.addEventListener('keyup', function (e){
    if (e.key !== 'Enter' && e.key !== ' ') return;
    on.press = false; sync();
  });

  // 标签页不可见时停掉循环，回来再续上（首页本来就有 three.js 在跑）
  document.addEventListener('visibilitychange', function (){
    if (document.hidden){
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else if (!raf){
      last = 0;                      // 让下一帧自己认时间，别把切走的这段时间算成 dt
      raf = requestAnimationFrame(frame);
    }
  });

  resize();
  raf = requestAnimationFrame(frame);

  /* 调参口子（也供无头 Chrome 验收用）。改完置 drawn = null 逼下一帧重画。 */
  window.__lb = {
    P: P, E: E, C: C, R: R,
    btn: btn,
    set: function (o, e, c, r){
      if (o) Object.assign(P, o);
      if (e) Object.assign(E, e);
      if (c) Object.assign(C, c);
      if (r) Object.assign(R, r);
      drawn = null;
    },
    hover: function (v){ on.over = !!v; sync(); },
    press: function (v){ on.press = !!v; sync(); if (v) addRipple(0, 0); },
    ripple: function (x, y){ addRipple(x || 0, y || 0); },
    seek: function (v){ clock = v; drawn = null; },
    info: function (){
      return {
        canvas: [W, H], button: [BW, BH], dpr: DPR, down: DOWN,
        hover: hover, hoverTarget: hoverTarget,
        press: press, pressTarget: pressTarget, clock: clock,
        center: [CX, CY], floatTargets: hasFloat
      };
    }
  };
})();
