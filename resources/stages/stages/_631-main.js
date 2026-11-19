
/* 631 星轨跟拍 —— 世界坐标歌词 + 追拍镜头 + 分层视差星空 */
(function () {
  "use strict";

  /* ================= 0. 自检状态 ================= */
  var S = { lines: [], idx: -1, t: 0, playing: true, frames: 0, js: 0, err: "" };
  var RM = false;
  try { RM = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
  var GL_OK = false;
  var W = 1440, H = 900;

  window.__stage = function () {
    var i = S.idx, L = S.lines, tx = "";
    if (i >= 0 && L[i] && L[i].text != null) tx = String(L[i].text);
    return {
      lines: L.length, idx: i, t: S.t, playing: !!S.playing,
      frames: S.frames, js: Math.round(S.js * 100) / 100, err: S.err,
      text: tx, gl: GL_OK, rm: RM
    };
  };

  var lastErrAt = 0;
  function logErr(e) {
    try { S.err = String((e && e.message) || e); } catch (_) { S.err = "error"; }
    var now = (window.performance && performance.now()) || Date.now();
    if (now - lastErrAt > 1000) {
      lastErrAt = now;
      try { console.error(e); } catch (_) {}
    }
  }

  /* ================= 1. ready：第一个 rAF 无条件、只一次 ================= */
  var readySent = false;
  function sendReady() {
    if (readySent) return;
    readySent = true;
    try { parent.postMessage({ __c100: 1, type: "ready" }, "*"); } catch (e) { logErr(e); }
  }
  var booted = false;
  function start() {
    if (booted) return;
    booted = true;
    setTimeout(boot, 0);
  }
  requestAnimationFrame(function () { sendReady(); start(); });
  setTimeout(function () { sendReady(); start(); }, 800);

  /* ================= 2. 常量与工具 ================= */
  var FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Source Han Sans SC",sans-serif';
  var FOV = 40;
  var TAN = Math.tan(FOV * Math.PI / 360);
  var D0 = 8.2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / ((e1 - e0) || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function damp(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  }
  function safeSize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (!isFinite(w) || w <= 0) w = 1440;
    if (!isFinite(h) || h <= 0) h = 900;
    return { w: w, h: h };
  }
  function normAccent(a) {
    if (!Array.isArray(a) || a.length < 3) return [150, 168, 255];
    var r = Number(a[0]), g = Number(a[1]), b = Number(a[2]);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return [150, 168, 255];
    r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255);
    if (r + g + b < 30) return [150, 168, 255];
    return [r, g, b];
  }

  /* ================= 3. 歌词数据 ================= */
  function charTimes(line) {
    var chars = Array.from(line.text || ""), n = chars.length, out = new Array(n);
    var cs = line.chars, i, j, rec, ct;
    if (cs && cs.length) {
      var rel = cs[0] && isFinite(cs[0].t) && cs[0].t < line.t - 0.08;
      for (i = 0; i < n; i++) {
        j = cs.length === n ? i : Math.min(cs.length - 1, Math.floor(i * cs.length / n));
        rec = cs[j];
        ct = rec && rec.t;
        out[i] = isFinite(ct) ? (rel ? line.t + ct : ct) : null;
      }
      return out;
    }
    var d = line.dur > 0 ? line.dur : 3.4;
    for (i = 0; i < n; i++) out[i] = line.t + d * 0.88 * i / Math.max(1, n);
    return out;
  }

  function buildLines(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (!l || typeof l !== "object") continue;
      var text = (l.text == null) ? "" : String(l.text);
      if (!text.trim()) continue;
      var t = Number(l.t); if (!isFinite(t) || t < 0) t = 0;
      var dur = Number(l.dur); if (!isFinite(dur) || dur < 0) dur = 0;
      var line = {
        t: t, dur: dur, text: text,
        chars: (Array.isArray(l.chars) && l.chars.length) ? l.chars : null
      };
      line.times = charTimes(line);
      out.push(line);
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function idxAt(t) {
    var a = S.lines, lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (a[m].t <= t + 0.02) { best = m; lo = m + 1; } else hi = m - 1;
    }
    return best;
  }

  /* ================= 4. 分词与排版 ================= */
  var measureCv = document.createElement("canvas");
  var measureCtx = measureCv.getContext("2d");

  function isWordChar(ch) { return /[A-Za-z0-9'’\-–—_.&/+]/.test(ch); }

  function tokenize(text) {
    var arr = Array.from(text || ""), out = [], buf = "";
    function flush() { if (buf) { out.push({ text: buf, chars: buf.length, sp: false }); buf = ""; } }
    for (var i = 0; i < arr.length; i++) {
      var ch = arr[i];
      if (/\s/.test(ch)) { flush(); out.push({ text: " ", chars: 1, sp: true }); }
      else if (isWordChar(ch)) { buf += ch; }
      else { flush(); out.push({ text: ch, chars: 1, sp: false }); }
    }
    flush();
    return out;
  }

  function maxWorldWidth() {
    var aspect = W / (H || 1);
    var visW = 2 * (D0 + 1.2) * TAN * aspect;
    return clamp(visW * 0.80, 2.1, 9.4);
  }

  function layoutLine(line) {
    var sizes = [0.74, 0.66, 0.58, 0.51, 0.45, 0.40, 0.35];
    var maxRows = (W / (H || 1) < 0.95) ? 4 : 2;
    var maxW = maxWorldWidth();
    var chosen = null;
    for (var s = 0; s < sizes.length; s++) {
      var fw = sizes[s];
      var toks = tokenize(line.text);
      measureCtx.font = "700 100px " + FONT;
      var i, t;
      for (i = 0; i < toks.length; i++) t = toks[i], t.w100 = measureCtx.measureText(t.text).width;
      var ci = 0;
      for (i = 0; i < toks.length; i++) {
        t = toks[i];
        t.ci = ci;
        ci += t.chars;
        t.time = (line.times[t.ci] != null) ? line.times[t.ci] : line.t;
      }
      var maxWpx = maxW * 100 / fw;
      var rows = [], cur = [], cw = 0;
      for (i = 0; i < toks.length; i++) {
        t = toks[i];
        if (t.sp && cur.length === 0) continue;
        if (!t.sp && cur.length && cw + t.w100 > maxWpx) {
          rows.push(cur); cur = []; cw = 0;
        }
        cur.push(t); cw += t.w100;
      }
      if (cur.length) rows.push(cur);
      chosen = { fontWorld: fw, lineH: fw * 1.26, rows: rows, toks: toks };
      if (rows.length <= maxRows) break;
    }
    if (!chosen) {
      var toks2 = tokenize(line.text);
      chosen = { fontWorld: 0.35, lineH: 0.44, rows: [[{ text: line.text, w100: 100, time: line.t, sp: false }]], toks: toks2 };
    }
    return chosen;
  }

  /* ================= 5. 文字纹理 ================= */
  function makeGlyphTex(text, texFont, glow) {
    var pad = glow ? 30 : 12;
    measureCtx.font = "700 " + texFont + "px " + FONT;
    var tw = measureCtx.measureText(text).width;
    var w = Math.max(8, Math.ceil(tw) + pad * 2);
    var h = Math.ceil(texFont * 1.5);
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var g = cv.getContext("2d");
    g.font = "700 " + texFont + "px " + FONT;
    g.textBaseline = "middle";
    g.textAlign = "left";
    try {
      if (glow) {
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.shadowColor = "rgba(185,205,255,0.95)";
        g.shadowBlur = Math.round(texFont * 0.17);
        g.fillText(text, pad, h * 0.5);
      } else {
        g.fillStyle = "#ffffff";
        g.fillText(text, pad, h * 0.5);
      }
    } catch (e) { logErr(e); }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    try { tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (_) {}
    return { tex: tex, w: w, h: h, pad: pad, pxToWorldScale: 1 };
  }

  /* ================= 6. 场景 ================= */
  var renderer = null, scene = null, camera = null;
  var UNIT_GEO = null;
  var lockMarker = null;
  var rt = null, rtScene = null, rtCam = null, blurMat = null;
  var blurStr = 0, blurSwirl = 0, blurOverride = -1;
  var prevCamPos = null, prevFov = FOV, prevRoll = 0, prevValid = false;
  var starLayers = [], starMats = [], dust = null, dustMat = null, dustSpd = null;
  var farRot = null;
  var mode = "none";
  var starTime = 0;

  var LIT_COLOR = null, DIM_COLOR = null, GLOW_COLOR = null;
  var AC = [150, 168, 255];

  function applyColors(accent) {
    AC = normAccent(accent);
    var tint = new THREE.Color(AC[0] / 255, AC[1] / 255, AC[2] / 255);
    LIT_COLOR = new THREE.Color(0.96, 0.97, 1.0).lerp(tint, 0.10);
    DIM_COLOR = new THREE.Color(0.46, 0.52, 0.68).lerp(tint, 0.06);
    GLOW_COLOR = new THREE.Color(0.70, 0.80, 1.0).lerp(tint, 0.46);
  }

  var STAR_VERT = [
    "attribute float aSize;",
    "attribute float aBright;",
    "attribute vec3 aColor;",
    "attribute float aPhase;",
    "attribute float aSpeed;",
    "attribute float aSpike;",
    "uniform float uTime;",
    "uniform float uProj;",
    "uniform float uPR;",
    "uniform float uRM;",
    "varying vec3 vColor;",
    "varying float vBright;",
    "varying float vSpike;",
    "void main(){",
    "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mv;",
    "  float tw = mix(0.86 + 0.14 * sin(uTime * aSpeed + aPhase), 1.0, uRM * 0.82);",
    "  float sz = aSize * uProj * uPR / max(0.5, -mv.z);",
    "  gl_PointSize = clamp(sz * (0.92 + 0.16 * tw), 1.0, 72.0);",
    "  vColor = aColor;",
    "  vBright = aBright * tw;",
    "  vSpike = aSpike;",
    "}"
  ].join("\n");

  var STAR_FRAG = [
    "varying vec3 vColor;",
    "varying float vBright;",
    "varying float vSpike;",
    "void main(){",
    "  vec2 p = gl_PointCoord * 2.0 - 1.0;",
    "  float d = length(p);",
    "  if (d > 1.0) discard;",
    "  float core = exp(-d * d * 7.5);",
    "  float halo = pow(max(0.0, 1.0 - d), 3.0) * 0.30;",
    "  float sp = 0.0;",
    "  if (vSpike > 0.01) {",
    "    sp = (exp(-abs(p.x) * 22.0) * exp(-abs(p.y) * 3.0) + exp(-abs(p.y) * 22.0) * exp(-abs(p.x) * 3.0)) * vSpike;",
    "  }",
    "  float a = clamp((core + halo + sp * 0.45) * vBright, 0.0, 1.0);",
    "  gl_FragColor = vec4(vColor * (1.0 + sp * 0.8), a);",
    "}"
  ].join("\n");

  function makeStarMat() {
    var m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProj: { value: (H * 0.5) / TAN },
        uPR: { value: 1 },
        uRM: { value: RM ? 1 : 0 }
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    starMats.push(m);
    return m;
  }

  var BAND_N = null, BAND_U = null, BAND_V = null;
  function initBand() {
    BAND_N = new THREE.Vector3(0.30, 0.95, 0.03).normalize();
    var tmp = new THREE.Vector3(0.17, 0.11, 1);
    BAND_U = new THREE.Vector3().crossVectors(BAND_N, tmp).normalize();
    BAND_V = new THREE.Vector3().crossVectors(BAND_N, BAND_U).normalize();
  }

  function makeStarLayer(n, r0, r1, opts) {
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    var size = new Float32Array(n), br = new Float32Array(n);
    var ph = new Float32Array(n), sp = new Float32Array(n), spike = new Float32Array(n);
    var scale = opts.sizeMul;
    for (var i = 0; i < n; i++) {
      var x, y, z;
      if (Math.random() < opts.band) {
        var ang = Math.random() * Math.PI * 2;
        var thick = (Math.random() + Math.random() + Math.random() - 1.5) * 0.13;
        var dx = BAND_U.x * Math.cos(ang) + BAND_V.x * Math.sin(ang) + BAND_N.x * thick;
        var dy = BAND_U.y * Math.cos(ang) + BAND_V.y * Math.sin(ang) + BAND_N.y * thick;
        var dz = BAND_U.z * Math.cos(ang) + BAND_V.z * Math.sin(ang) + BAND_N.z * thick;
        var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        x = dx / dl; y = dy / dl; z = dz / dl;
      } else {
        var u = Math.random() * 2 - 1;
        var a = Math.random() * Math.PI * 2;
        var s = Math.sqrt(Math.max(0, 1 - u * u));
        x = s * Math.cos(a); y = u; z = s * Math.sin(a);
      }
      var r = r0 + Math.pow(Math.random(), 0.72) * (r1 - r0);
      pos[i * 3] = x * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = z * r;

      var warm = Math.random();
      if (warm > 0.935) { col[i * 3] = 1.0; col[i * 3 + 1] = 0.92; col[i * 3 + 2] = 0.82; }
      else if (warm > 0.70) { col[i * 3] = 0.90; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 1.0; }
      else { col[i * 3] = 0.97; col[i * 3 + 1] = 0.98; col[i * 3 + 2] = 1.0; }

      var lum = Math.pow(Math.random(), 2.25);
      br[i] = 0.34 + lum * 0.66;
      size[i] = (0.35 + Math.pow(Math.random(), 3.2) * 1.65) * scale;
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.5 + Math.random() * 2.4;
      spike[i] = br[i] > 0.90 ? 0.7 + Math.random() * 0.3 : 0;
      if (Math.random() < 0.00045) { size[i] *= 3.4; br[i] = 1.0; spike[i] = 1.0; }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aBright", new THREE.BufferAttribute(br, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(sp, 1));
    geo.setAttribute("aSpike", new THREE.BufferAttribute(spike, 1));

    var pts = new THREE.Points(geo, makeStarMat());
    pts.frustumCulled = false;
    pts.renderOrder = 0;
    scene.add(pts);
    return pts;
  }

  function softTexture(inner) {
    var c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    var g = c.getContext("2d");
    try {
      var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255," + inner + ")");
      gr.addColorStop(0.35, "rgba(255,255,255," + (inner * 0.5) + ")");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
    } catch (e) { g.fillStyle = "rgba(255,255,255,.3)"; }
    g.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeMilky(n, sizeWorld, opacity, color) {
    var pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2;
      var thick = (Math.random() + Math.random() + Math.random() - 1.5) * 0.09;
      var dx = BAND_U.x * Math.cos(ang) + BAND_V.x * Math.sin(ang) + BAND_N.x * thick;
      var dy = BAND_U.y * Math.cos(ang) + BAND_V.y * Math.sin(ang) + BAND_N.y * thick;
      var dz = BAND_U.z * Math.cos(ang) + BAND_V.z * Math.sin(ang) + BAND_N.z * thick;
      var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var r = 108 + Math.random() * 38;
      pos[i * 3] = dx / dl * r; pos[i * 3 + 1] = dy / dl * r; pos[i * 3 + 2] = dz / dl * r;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      size: sizeWorld, map: softTexture(0.55), color: color,
      transparent: true, opacity: opacity, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 0;
    scene.add(pts);
    return pts;
  }

  function buildStars() {
    initBand();
    starLayers.push(makeStarLayer(95000, 72, 152, { band: 0.50, sizeMul: 0.20 }));
    starLayers.push(makeStarLayer(26000, 30, 64, { band: 0.20, sizeMul: 0.095 }));
    starLayers.push(makeStarLayer(3600, 12, 25, { band: 0.05, sizeMul: 0.040 }));

    farRot = new THREE.Group();
    // 银河的极淡尘埃带（两层大小不同的软点）
    makeMilky(320, 7.0, 0.090, 0x93a9d6);
    makeMilky(120, 15.0, 0.048, 0xcbbfae);

    var N = 1500;
    var pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    var size = new Float32Array(N), br = new Float32Array(N);
    var ph = new Float32Array(N), sp = new Float32Array(N), spike = new Float32Array(N);
    dustSpd = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 14;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * 9;
      pos[i * 3 + 2] = 2 - Math.random() * 42;
      col[i * 3] = 0.72; col[i * 3 + 1] = 0.80; col[i * 3 + 2] = 1.0;
      br[i] = 0.20 + Math.random() * 0.35;
      size[i] = 0.016 + Math.random() * 0.045;
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.4 + Math.random();
      spike[i] = 0;
      dustSpd[i] = 0.12 + Math.random() * 0.5;
    }
    var dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dg.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    dg.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    dg.setAttribute("aBright", new THREE.BufferAttribute(br, 1));
    dg.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    dg.setAttribute("aSpeed", new THREE.BufferAttribute(sp, 1));
    dg.setAttribute("aSpike", new THREE.BufferAttribute(spike, 1));
    dustMat = makeStarMat();
    dust = new THREE.Points(dg, dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 1;
    scene.add(dust);
  }

  function updateStars(dt, now) {
    starTime += dt * (RM ? 0.3 : 1);
    for (var i = 0; i < starMats.length; i++) starMats[i].uniforms.uTime.value = starTime;
    if (starLayers[0] && !RM) starLayers[0].rotation.y += dt * 0.0035;
    if (starLayers[1] && !RM) starLayers[1].rotation.y += dt * 0.0060;
    if (dust) {
      var arr = dust.geometry.attributes.position.array;
      var mul = RM ? 0.25 : 1;
      for (var k = 0; k < dustSpd.length; k++) {
        arr[k * 3 + 2] += dustSpd[k] * dt * mul;
        arr[k * 3] += Math.sin(starTime * 0.2 + k) * dt * 0.01 * mul;
        if (arr[k * 3 + 2] > 3) {
          arr[k * 3 + 2] = -40;
          arr[k * 3] = (Math.random() * 2 - 1) * 14;
          arr[k * 3 + 1] = (Math.random() * 2 - 1) * 9;
        }
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ================= 7. 歌词对象 ================= */
  var lineObjs = [], curLineObj = null;
  var cam = { pos: null, look: null, roll: 0, init: false, kick: 0 };
  var curIdx = -2;
  var pointer = { x: 0, y: 0 };
  var beatPulse = 0, liveLevel = 0, liveSmoothed = 0;
  var clockSec = 0;

  function anchorFor(i) {
    var a = Math.max(0, i);
    return {
      x: Math.sin(a * 1.37) * 0.55,
      y: Math.cos(a * 0.91) * 0.26,
      z: -8.0 + Math.sin(a * 0.73) * 0.9
    };
  }
  var defaultAnchor = { x: 0, y: 0, z: -8.0 };
  var CA = { x: 0, y: 0, z: -8.0 };
  function currentAnchor() {
    if (S.idx >= 0 && S.lines[S.idx]) {
      var a = anchorFor(S.idx);
      CA.x = a.x; CA.y = a.y; CA.z = a.z;
    } else {
      CA.x = 0; CA.y = 0; CA.z = -8.0;
    }
    return CA;
  }

  function disposeLine(o) {
    if (!o) return;
    try {
      if (o.group && o.group.parent) o.group.parent.remove(o.group);
      for (var i = 0; i < o.tokens.length; i++) {
        var t = o.tokens[i];
        try { t.mat.dispose(); } catch (_) {}
        try { t.gmat.dispose(); } catch (_) {}
        try { t.tex.dispose(); } catch (_) {}
        try { t.gtex.dispose(); } catch (_) {}
      }
    } catch (e) { logErr(e); }
  }

  function disposeAllLines() {
    for (var i = 0; i < lineObjs.length; i++) disposeLine(lineObjs[i]);
    lineObjs = []; curLineObj = null;
  }

  function buildLineObj(idx, age0) {
    var line = S.lines[idx];
    var lay = layoutLine(line);
    var a = anchorFor(idx);
    var group = new THREE.Group();
    group.position.set(a.x, a.y, a.z);
    group.renderOrder = 3;

    var tokens = [];
    var texFont = 192;
    var s = lay.fontWorld / texFont;
    var nRows = lay.rows.length;

    for (var r = 0; r < nRows; r++) {
      var row = lay.rows[r];
      var rowW = 0, i;
      for (i = 0; i < row.length; i++) rowW += row[i].w100;
      rowW *= lay.fontWorld / 100;
      var cursor = -rowW / 2;
      var y = ((nRows - 1) / 2 - r) * lay.lineH;

      for (i = 0; i < row.length; i++) {
        var tk = row[i];
        var adv = tk.w100 * lay.fontWorld / 100;
        if (!tk.sp) {
          var m = makeGlyphTex(tk.text, texFont, false);
          var gg = makeGlyphTex(tk.text, texFont, true);
          var pw = m.w * s, phh = m.h * s;
          var mat = new THREE.MeshBasicMaterial({
            map: m.tex, transparent: true, depthWrite: false, depthTest: false,
            opacity: 0, color: 0xffffff, side: THREE.DoubleSide
          });
          var mesh = new THREE.Mesh(UNIT_GEO, mat);
          mesh.scale.set(pw, phh, 1);
          mesh.renderOrder = 4;
          mesh.frustumCulled = false;

          var gmat = new THREE.MeshBasicMaterial({
            map: gg.tex, transparent: true, depthWrite: false, depthTest: false,
            opacity: 0, color: 0xffffff, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
          });
          var glowMesh = new THREE.Mesh(UNIT_GEO, gmat);
          glowMesh.scale.set(pw * 1.16, phh * 1.16, 1);
          glowMesh.renderOrder = 3;
          glowMesh.frustumCulled = false;

          var root = new THREE.Group();
          root.position.set(cursor + adv / 2, y, 0);
          root.add(glowMesh);
          root.add(mesh);

          tokens.push({
            root: root, mat: mat, gmat: gmat, mesh: mesh, glowMesh: glowMesh,
            tex: m.tex, gtex: gg.tex, baseY: y, baseZ: 0, phase: Math.random() * Math.PI * 2,
            time: tk.time, ci: tk.ci, k: 0, delay: tokens.length * 0.022,
            wasLit: (S.t >= tk.time) ? 1 : 0, litAt: -99
          });
          group.add(root);
        }
        cursor += adv;
      }
    }

    scene.add(group);
    var o = {
      idx: idx, group: group, tokens: tokens, age: (age0 || 0),
      out: false, outAge: 0, op: (age0 ? 1 : 0)
    };
    return o;
  }

  function switchLine(i, instant) {
    for (var k = 0; k < lineObjs.length; k++) {
      if (!lineObjs[k].out) { lineObjs[k].out = true; lineObjs[k].outAge = 0; }
    }
    curLineObj = null;
    if (i < 0 || i >= S.lines.length) { cam.kick = 0.6; return; }
    var o = buildLineObj(i, instant ? 2.0 : 0);
    lineObjs.push(o);
    curLineObj = o;
    cam.kick = 1.0;
  }

  function rebuildCurrent() {
    if (mode !== "gl") return;
    var age = curLineObj ? Math.min(2, curLineObj.age) : 0;
    var idx = S.idx;
    disposeAllLines();
    if (idx >= 0 && S.lines[idx]) {
      var o = buildLineObj(idx, Math.max(1.3, age));
      lineObjs.push(o);
      curLineObj = o;
    }
  }

  function updateLine(o, dt, now) {
    var ts = clockSec;
    var parentY = 0, parentRot = 0, lineOp;

    if (o.out) {
      o.outAge += dt;
      var e = smoothstep(0, 0.62, o.outAge);
      lineOp = 1 - e;
      parentY = e * 0.72;
      parentRot = e * 0.035;
    } else {
      o.age += dt;
      var ein = smoothstep(0, 0.5, o.age);
      lineOp = ein;
      parentY = -(1 - ein) * 0.5 + Math.sin(ts * 0.95 + o.idx * 1.7) * 0.13;
      parentRot = Math.sin(ts * 0.7 + o.idx) * 0.020 - (1 - ein) * 0.03;
    }
    o.op = lineOp;
    var a = anchorFor(o.idx);
    o.group.position.set(
      a.x + Math.sin(ts * 0.33 + o.idx * 0.6) * 0.05,
      a.y + parentY,
      a.z + (o.out ? smoothstep(0, 0.7, o.outAge) * 0.8 : 0)
    );
    o.group.rotation.z = parentRot;
    o.group.rotation.y = 0.055 + Math.sin(ts * 0.78 + o.idx) * 0.030 + (o.out ? 0 : (1 - smoothstep(0, 0.55, o.age)) * 0.09);

    var amp = RM ? 0.22 : 1;
    var lastLit = -1;
    for (var i = 0; i < o.tokens.length; i++) {
      var tk = o.tokens[i];
      if (!o.out && S.t >= tk.time) lastLit = i;
    }

    for (var j = 0; j < o.tokens.length; j++) {
      var t = o.tokens[j];
      var lit = (!o.out && S.t >= t.time) ? 1 : 0;
      if (lit && !t.wasLit) { t.wasLit = 1; t.litAt = ts; }
      else if (!lit) { t.wasLit = 0; }
      t.k = damp(t.k, lit, 12, dt);

      var te = o.out ? 1 : smoothstep(t.delay, t.delay + 0.55, o.age);
      var entry = (1 - te) * 0.46;
      var ph = t.phase;
      var litAge = t.wasLit ? Math.max(0, ts - t.litAt) : 99;
      var shake = Math.sin(litAge * 31 + ph) * Math.exp(-litAge * 7.5) * 0.55 * amp;
      var pop = 1 + Math.exp(-litAge * 11) * 0.14 * amp;
      var swayY = Math.sin(ts * 1.9 + ph) * 0.022 * amp;
      var swayZ = Math.sin(ts * 1.25 + ph * 0.9) * 0.030 * amp;
      var swayR = Math.sin(ts * 1.7 + ph) * 0.030 * amp;
      var isCur = (j === lastLit) ? 1 : 0;
      var pulse = (1 + isCur * (0.022 + beatPulse * 0.06) * amp) * pop;

      t.root.position.y = t.baseY + entry + swayY + shake * 0.012;
      t.root.position.z = t.baseZ + swayZ;
      t.root.rotation.z = swayR + shake * 0.18 + (1 - te) * 0.10;
      t.root.rotation.y = Math.sin(ts * 1.2 + ph * 1.3) * 0.065 * amp + shake;
      t.root.scale.setScalar(pulse);

      var op = o.op * (0.24 + 0.76 * t.k);
      t.mat.opacity = op;
      t.mat.color.copy(DIM_COLOR).lerp(LIT_COLOR, t.k);
      var gop = o.op * t.k * (0.10 + isCur * 0.16 + beatPulse * 0.10);
      t.gmat.opacity = gop;
      t.gmat.color.copy(GLOW_COLOR);
    }
  }

  function updateLines(dt, now) {
    for (var i = lineObjs.length - 1; i >= 0; i--) {
      var o = lineObjs[i];
      if (o.out && o.outAge > 0.85) {
        disposeLine(o);
        lineObjs.splice(i, 1);
        continue;
      }
      updateLine(o, dt, now);
    }
  }

  /* ================= 8. 镜头 ================= */
  function lineProgress() {
    if (S.idx < 0 || !S.lines[S.idx]) return 0.5;
    var l = S.lines[S.idx];
    var next = S.lines[S.idx + 1];
    var d = l.dur > 0 ? l.dur : Math.max(1.8, next ? (next.t - l.t) : 4);
    return clamp((S.t - l.t) / d, 0, 1.4);
  }

  function updateCamera(dt, now) {
    if (!camera) return;
    var a = currentAnchor();
    var ts = clockSec;
    var amp = RM ? 0.22 : 1;
    var i = Math.max(0, S.idx);
    var prog = lineProgress();

    // 广角 / 长焦循环：广角时相机同步贴近，做真正的滑动变焦
    var zc = 0.5 - 0.5 * Math.cos(ts * 0.72);
    var fov = 38 + zc * 20;
    var halfTan = Math.tan(fov * Math.PI / 360);
    var comp = halfTan / TAN;
    camera.fov = fov;
    camera.updateProjectionMatrix();

    var distBase = D0
      + Math.sin(ts * 0.33) * 1.05
      + (i % 2 ? -0.65 : 0.55)
      + (0.75 - 1.55 * clamp(prog, 0, 1)) * 0.45
      - beatPulse * 0.50;
    var dist = distBase * (1 / comp) * (0.84 + 0.34 * zc);

    var tx = a.x + (Math.sin(ts * 0.21) * 0.32 + pointer.x * 0.16) * amp;
    var ty = a.y + 0.03 + (Math.sin(ts * 0.29) * 0.46 + pointer.y * 0.12) * amp;
    var tz = a.z + dist;
    var lx = a.x + Math.sin(ts * 0.17) * 0.025 * amp;
    var ly = a.y + Math.sin(ts * 0.27) * 0.035 * amp;
    var lz = a.z;

    if (!cam.pos) { cam.pos = new THREE.Vector3(); cam.look = new THREE.Vector3(); }
    if (!cam.init) {
      cam.pos.set(tx, ty, tz);
      cam.look.set(lx, ly, lz);
      cam.roll = -0.145;
      cam.init = true;
    } else {
      var kp = 1 - Math.exp(-dt * 2.4);
      cam.pos.x += (tx - cam.pos.x) * kp;
      cam.pos.y += (ty - cam.pos.y) * kp;
      cam.pos.z += (tz - cam.pos.z) * kp;
      var kl = 1 - Math.exp(-dt * 2.2);
      cam.look.x += (lx - cam.look.x) * kl;
      cam.look.y += (ly - cam.look.y) * kl;
      cam.look.z += (lz - cam.look.z) * kl;
    }

    var rollT = (-0.145 + Math.sin(ts * 0.22) * 0.055 - cam.kick * 0.075 - beatPulse * 0.020) * amp;
    cam.roll += (rollT - cam.roll) * (1 - Math.exp(-dt * 2.0));
    cam.roll = clamp(cam.roll, -0.34, 0.06);
    cam.kick *= Math.exp(-dt * 1.5);

    camera.position.copy(cam.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
    camera.rotateZ(cam.roll);
    camera.updateMatrixWorld();

    if (blurMat) {
      var pv = new THREE.Vector3(a.x, a.y, a.z).project(camera);
      blurMat.uniforms.uCenter.value.set(pv.x * 0.5 + 0.5, pv.y * 0.5 + 0.5);
    }

    var proj = (H * 0.5) / halfTan;
    for (var sm = 0; sm < starMats.length; sm++) starMats[sm].uniforms.uProj.value = proj;

    // 锁定点：歌词中心的一枚极淡光点，镜头始终瞄准它
    if (lockMarker) {
      lockMarker.position.set(a.x, a.y, a.z - 0.05);
      var lm = (S.idx >= 0 ? 1 : 0) * (0.07 + cam.kick * 0.26 + beatPulse * 0.07);
      lockMarker.material.opacity = lm * (RM ? 0.55 : 1);
      lockMarker.scale.setScalar(0.11 + cam.kick * 0.11);
      lockMarker.rotation.z += dt * 0.5;
    }

    // 动态模糊：由变焦速度、推拉速度、压弯角速度驱动
    if (!prevCamPos) { prevCamPos = new THREE.Vector3(); prevValid = false; }
    var speed = 0, dFovS = 0, dRollS = 0;
    if (prevValid) {
      speed = camera.position.distanceTo(prevCamPos) / Math.max(dt, 1e-3);
      dFovS = Math.abs(camera.fov - prevFov) / Math.max(dt, 1e-3);
      dRollS = Math.abs(cam.roll - prevRoll) / Math.max(dt, 1e-3);
    }
    if (!prevValid) {
      prevCamPos.copy(camera.position); prevFov = camera.fov; prevRoll = cam.roll; prevValid = true;
    } else {
      var bt = blurOverride >= 0 ? blurOverride
        : (RM ? 0 : clamp(dFovS * 0.0028 + speed * 0.0055 + dRollS * 0.10, 0, 0.055));
      blurStr = damp(blurStr, bt, 8, dt);
      blurSwirl = damp(blurSwirl, clamp((cam.roll - prevRoll) * 5.0, -0.09, 0.09), 10, dt);
      prevCamPos.copy(camera.position);
      prevFov = camera.fov;
      prevRoll = cam.roll;
    }
  }

  /* ================= 9. 主循环 ================= */
  var lastNow = 0;
  function frame(now) {
    var js0 = performance.now();
    try {
      if (!lastNow) lastNow = now;
      var dt = (now - lastNow) / 1000;
      lastNow = now;
      if (!(dt > 0) || dt > 0.2) dt = 0.016;
      clockSec += dt;
      if (S.playing) S.t += dt;
      if (!isFinite(S.t) || S.t < 0) S.t = 0;
      beatPulse *= Math.exp(-dt * 3.1);
      liveSmoothed += (liveLevel - liveSmoothed) * Math.min(1, dt * 3);

      updateIdx();

      if (mode === "gl") {
        updateLines(dt, now);
        updateCamera(dt, now);
        updateStars(dt, now);
        if (blurStr > 0.0018 && rt && blurMat) {
          renderer.setRenderTarget(rt);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          blurMat.uniforms.uStr.value = blurStr;
          blurMat.uniforms.uSwirl.value = blurSwirl;
          renderer.render(rtScene, rtCam);
        } else {
          renderer.setRenderTarget(null);
          renderer.render(scene, camera);
        }
      } else if (mode === "dom") {
        updateFallback(dt);
      }
      S.frames++;
    } catch (e) { logErr(e); }
    S.js = performance.now() - js0;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function updateIdx() {
    if (!S.lines.length) {
      if (curIdx !== -1) {
        curIdx = -1; S.idx = -1;
        if (mode === "gl") { disposeAllLines(); }
        if (mode === "dom") fbIdx = -9;
      }
      return;
    }
    var i = idxAt(S.t);
    if (i !== curIdx) {
      curIdx = i; S.idx = i;
      if (mode === "gl") switchLine(i, false);
      if (mode === "dom") fbIdx = -9;
    }
  }

  /* ================= 10. 消息 ================= */
  function linesSignature(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].text !== b[i].text || a[i].t !== b[i].t || a[i].dur !== b[i].dur) return false;
    }
    return true;
  }

  function applyInit(p) {
    var lines = buildLines(p.lines);
    var same = linesSignature(lines, S.lines);
    S.lines = lines;
    S.playing = (typeof p.playing === "boolean") ? p.playing : true;
    if (Array.isArray(p.accent)) applyColors(p.accent);

    if (!same) {
      curIdx = -2; S.idx = -1;
      if (mode === "gl") disposeAllLines();
      if (mode === "dom") { fbIdx = -9; }
    } else if (mode === "gl") {
      for (var i = 0; i < lineObjs.length; i++) {
        var o = lineObjs[i];
        if (o.idx >= 0 && S.lines[o.idx]) {
          var tk = o.tokens;
          var line = S.lines[o.idx];
          for (var j = 0; j < tk.length; j++) {
            tk[j].time = (line.times[tk[j].ci] != null) ? line.times[tk[j].ci] : line.t;
          }
        }
      }
    }
  }

  function onBeat(p) {
    var lv = Number(p.level);
    var idx = Number(p.index);
    var v = isFinite(lv) ? clamp(lv, 0, 1) : 0.5;
    if (idx === 0) beatPulse = Math.max(beatPulse, 0.7 + v * 0.3);
    else beatPulse = Math.max(beatPulse, 0.25 + v * 0.35);
  }

  addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.__c100 !== 1) return;
    var p = d.payload || {};
    try {
      if (d.type === "init") applyInit(p);
      else if (d.type === "tick") {
        var t = Number(p.time);
        if (isFinite(t)) S.t = t;
        if (typeof p.playing === "boolean") S.playing = p.playing;
      } else if (d.type === "beat") onBeat(p);
      else if (d.type === "live") {
        var lv = Number(p.level);
        if (isFinite(lv)) liveLevel = clamp(lv, 0, 1);
        if (typeof p.playing === "boolean") S.playing = p.playing;
      }
    } catch (e) { logErr(e); }
  });

  var lastAct = 0;
  function activity() {
    var n = performance.now();
    if (n - lastAct < 90) return;
    lastAct = n;
    try { parent.postMessage({ __c100: 1, type: "activity" }, "*"); } catch (_) {}
  }
  addEventListener("mousemove", function (e) {
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    pointer.x = clamp((e.clientX / w) * 2 - 1, -1, 1);
    pointer.y = clamp((e.clientY / h) * 2 - 1, -1, 1);
    activity();
  }, { passive: true });
  addEventListener("pointerdown", activity, { passive: true });
  addEventListener("touchstart", activity, { passive: true });
  addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      try { parent.postMessage({ __c100: 1, type: "key", payload: { key: "Space" } }, "*"); } catch (_) {}
    }
  });

  /* ================= 11. 2D 兜底 ================= */
  var fbMode = false, fbCv = null, fbg = null, fbLyr = null, fbStars = [], fbIdx = -9, fbSpans = [];

  function resizeFallback() {
    if (!fbCv) return;
    var sz = safeSize(); W = sz.w; H = sz.h;
    fbCv.width = Math.round(W); fbCv.height = Math.round(H);
  }

  function buildFallback() {
    var fb = document.getElementById("fb");
    if (!fb) return;
    fb.classList.add("on");
    fbCv = document.getElementById("fbgl");
    fbg = fbCv.getContext("2d");
    fbLyr = document.getElementById("fblyr");
    resizeFallback();
    addEventListener("resize", resizeFallback);
    for (var i = 0; i < 460; i++) {
      fbStars.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: 0.12 + Math.random() * 0.88,
        r: 0.4 + Math.random() * 1.5,
        p: Math.random() * Math.PI * 2
      });
    }
    fbMode = true;
  }

  function fbRenderLine() {
    if (!fbLyr) return;
    fbLyr.innerHTML = "";
    fbSpans = [];
    var i = S.idx;
    if (i < 0 || !S.lines[i]) return;
    var line = S.lines[i];
    var chars = Array.from(line.text);
    for (var k = 0; k < chars.length; k++) {
      var sp = document.createElement("span");
      sp.textContent = chars[k] === " " ? " " : chars[k];
      fbLyr.appendChild(sp);
      fbSpans.push({ el: sp, t: line.times[k], on: false });
    }
  }

  function updateFallback(dt) {
    if (!fbg) return;
    fbg.fillStyle = "#02030a";
    fbg.fillRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    for (var i = 0; i < fbStars.length; i++) {
      var s = fbStars[i];
      s.z -= dt * 0.012;
      if (s.z < 0.08) { s.z = 1; s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; }
      var sx = cx + (s.x / s.z) * cx * 0.92;
      var sy = cy + (s.y / s.z) * cy * 0.92;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      var tw = 0.65 + 0.35 * Math.sin(clockSec * 1.4 + s.p);
      fbg.fillStyle = "rgba(225,235,255," + (0.75 * tw * (1.05 - s.z * 0.55)).toFixed(3) + ")";
      fbg.fillRect(sx, sy, s.r, s.r);
    }
    if (S.idx !== fbIdx) { fbIdx = S.idx; fbRenderLine(); }
    for (var j = 0; j < fbSpans.length; j++) {
      var on = fbSpans[j].t != null && S.t >= fbSpans[j].t;
      if (on !== fbSpans[j].on) {
        fbSpans[j].on = on;
        fbSpans[j].el.className = on ? "on" : "";
      }
    }
  }

  /* ================= 12. 锁定点与动态模糊 ================= */
  function buildLockMarker() {
    var mat = new THREE.MeshBasicMaterial({
      map: softTexture(1.0), color: 0x9fb7ff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
    });
    lockMarker = new THREE.Mesh(UNIT_GEO, mat);
    lockMarker.scale.set(0.14, 0.14, 1);
    lockMarker.renderOrder = 2;
    lockMarker.frustumCulled = false;
    scene.add(lockMarker);
  }

  function initPost() {
    rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: false, stencilBuffer: false
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rtScene = new THREE.Scene();
    rtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uStr: { value: 0 },
        uSwirl: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) }
      },
      vertexShader: [
        "varying vec2 vUv;",
        "void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D tDiffuse;",
        "uniform float uStr;",
        "uniform float uSwirl;",
        "uniform vec2 uRes;",
        "uniform vec2 uCenter;",
        "varying vec2 vUv;",
        "void main(){",
        "  vec2 c = uCenter;",
        "  float aspect = uRes.x / max(1.0, uRes.y);",
        "  vec3 sum = vec3(0.0);",
        "  float wsum = 0.0;",
        "  for (int i = 0; i < 14; i++) {",
        "    float f = float(i) / 13.0;",
        "    vec2 uv = c + (vUv - c) * (1.0 - uStr * f);",
        "    vec2 p = (uv - c) * vec2(aspect, 1.0);",
        "    float a = uSwirl * f;",
        "    float ca = cos(a), sa = sin(a);",
        "    p = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);",
        "    uv = c + p / vec2(aspect, 1.0);",
        "    uv = clamp(uv, vec2(0.0), vec2(1.0));",
        "    float w = 1.0 - f * 0.72;",
        "    sum += texture2D(tDiffuse, uv).rgb * w;",
        "    wsum += w;",
        "  }",
        "  gl_FragColor = vec4(sum / wsum, 1.0);",
        "  #include <colorspace_fragment>",
        "}"
      ].join("\n"),
      depthTest: false,
      depthWrite: false
    });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
    quad.frustumCulled = false;
    rtScene.add(quad);
    resizePost();
  }

  function resizePost() {
    if (!rt || !renderer || !blurMat) return;
    var v = new THREE.Vector2();
    renderer.getDrawingBufferSize(v);
    rt.setSize(Math.max(2, v.x), Math.max(2, v.y));
    blurMat.uniforms.uRes.value.set(v.x, v.y);
  }

  /* ================= 13. 布局与启动 ================= */
  function layout() {
    var sz = safeSize(); W = sz.w; H = sz.h;
    if (renderer) {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H, false);
    }
    if (camera) {
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
    var pr = renderer ? renderer.getPixelRatio() : 1;
    var tanNow = camera ? Math.tan(camera.fov * Math.PI / 360) : TAN;
    for (var i = 0; i < starMats.length; i++) {
      starMats[i].uniforms.uProj.value = (H * 0.5) / tanNow;
      starMats[i].uniforms.uPR.value = pr;
    }
    resizePost();
  }

  function boot() {
    if (mode !== "none") return;
    try {
      if (typeof THREE === "undefined") throw new Error("THREE 未加载");
      var cvs = document.getElementById("gl");
      renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x02030a, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 420);
      camera.position.set(0, 0, 0);
      UNIT_GEO = new THREE.PlaneGeometry(1, 1);
      applyColors(AC);
      buildStars();
      buildLockMarker();
      initPost();
      layout();
      GL_OK = true;
      mode = "gl";
      if (S.lines.length) {
        var i = idxAt(S.t);
        curIdx = i; S.idx = i;
        switchLine(i, true);
      }
    } catch (e) {
      logErr(e);
      GL_OK = false;
      mode = "dom";
      buildFallback();
    }
  }

  addEventListener("resize", function () {
    if (mode === "gl") { layout(); rebuildCurrent(); }
    else if (mode === "dom") resizeFallback();
  });

  /* 开发者自检口（不暴露成用户设置） */
  window.__631 = function () {
    return {
      mode: mode, gl: GL_OK, idx: S.idx, lines: S.lines.length,
      cam: cam.pos ? [+cam.pos.x.toFixed(2), +cam.pos.y.toFixed(2), +cam.pos.z.toFixed(2)] : null,
      roll: +cam.roll.toFixed(3),
      fov: camera ? +camera.fov.toFixed(1) : 0,
      blur: +blurStr.toFixed(4),
      lock: lockMarker ? +lockMarker.material.opacity.toFixed(3) : -1,
      tokens: curLineObj ? curLineObj.tokens.length : 0,
      objects: lineObjs.length,
      beat: +beatPulse.toFixed(2)
    };
  };

  window.__631Blur = function (v) {
    blurOverride = (typeof v === "number" && isFinite(v)) ? clamp(v, 0, 0.08) : -1;
    return blurOverride;
  };
})();
