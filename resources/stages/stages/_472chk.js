
/* ============ 472 · neon leopard ============ */
var cvs = document.getElementById('stage-cv');
var g2d = cvs.getContext('2d', { alpha: false });
var VW = 1440, VH = 900, DPR = 1;
var ST = { lines: [], idx: -1, t: 0, dur: 0, playing: true, frames: 0, js: 0, err: '', text: '' };
var LIVE = { bpm: 0, level: 0, bass: 0, mid: 0, treble: 0 };
var BEAT = { index: 0, level: 0, pulse: 0 };
var RM = false, READY_SENT = false, ERR_COUNT = 0, PULSE = 0, TICK_SEEN = false;
var COVER = { img: null, ok: false, url: '' };
var LAYOUT = { key: '', rows: null, fs: 0, maxW: 0 };
var BG = { dirty: true, confetti: [] };

function logErr(where, e) {
  if (ERR_COUNT++ < 6) console.error('[472]', where, e);
  ST.err = String((e && e.message) || e || where);
}
function sendReady() {
  if (READY_SENT) return;
  READY_SENT = true;
  try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (e) { logErr('ready', e); }
}
function resize() {
  var w = window.innerWidth, h = window.innerHeight;
  if (!isFinite(w) || !isFinite(h) || w < 2 || h < 2) { w = 1440; h = 900; }
  VW = Math.max(2, Math.round(w));
  VH = Math.max(2, Math.round(h));
  DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.6);
  cvs.width = Math.max(1, Math.round(VW * DPR));
  cvs.height = Math.max(1, Math.round(VH * DPR));
  cvs.style.width = VW + 'px';
  cvs.style.height = VH + 'px';
  g2d.setTransform(DPR, 0, 0, DPR, 0, 0);
  LAYOUT.key = '';
  BG.dirty = true;
  try { buildScene(); } catch (e) { logErr('scene', e); }
}

/* ---------- payload ---------- */
function normLines(raw) {
  var out = [], n = raw && raw.length ? Math.min(raw.length, 500) : 0;
  for (var i = 0; i < n; i++) {
    var L = raw[i] || {};
    var txt = L.text == null ? '' : String(L.text);
    var t = Number(L.t); if (!isFinite(t) || t < 0) t = 0;
    var dur = Number(L.dur);
    if (!isFinite(dur) || dur <= 0) dur = Math.max(1.6, Math.min(9, txt.length * 0.22));
    var chars = null;
    if (L.chars && L.chars.length) {
      var m = Math.min(L.chars.length, 600), arr = [];
      for (var j = 0; j < m; j++) {
        var c = L.chars[j] || {};
        var ct = Number(c.t);
        arr.push({ c: c.c == null ? '' : String(c.c), t: isFinite(ct) ? ct : t });
      }
      chars = arr;
    }
    out.push({ t: t, dur: dur, text: txt, chars: chars, units: null });
  }
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}
function onInit(p) {
  ST.lines = p && p.lines ? normLines(p.lines) : [];
  ST.idx = -1; ST.text = '';
  var d0 = Number(p && p.duration);
  ST.dur = isFinite(d0) && d0 > 0 ? d0 : 0;
  if (!ST.dur && ST.lines.length) {
    var last = ST.lines[ST.lines.length - 1];
    ST.dur = Math.max(1, last.t + last.dur);
  }
  LAYOUT.key = '';
  var cov = p && p.song ? p.song.cover : '';
  if (cov && cov !== COVER.url && typeof cov === 'string') {
    COVER.url = cov; COVER.ok = false; COVER.img = null;
    var im = new Image();
    im.onload = function () { COVER.ok = true; COVER.img = im; };
    im.onerror = function () { COVER.ok = false; COVER.img = null; };
    im.src = cov;
  }
  ST.playing = p && typeof p.playing === 'boolean' ? p.playing : true;
  computeIdx();
}
function computeIdx() {
  var ls = ST.lines, i = -1;
  for (var k = 0; k < ls.length; k++) { if (ls[k].t <= ST.t + 0.001) i = k; else break; }
  ST.idx = i;
  ST.text = i >= 0 ? ls[i].text : '';
}

/* ---------- media ---------- */
document.addEventListener('message', onMsg, false);
window.addEventListener('message', onMsg, false);
function onMsg(ev) {
  var d = ev.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
  if (!d || d.__c100 !== 1) return;
  try {
    if (d.type === 'init') onInit(d.payload || {});
    else if (d.type === 'tick') {
      TICK_SEEN = true;
      var t = Number(d.payload && d.payload.time);
      ST.t = isFinite(t) ? t : 0;
      ST.playing = !!(d.payload && d.payload.playing);
      computeIdx();
    } else if (d.type === 'beat') {
      BEAT.index = Number(d.payload && d.payload.index) || 0;
      BEAT.level = Math.min(1, Math.max(0, Number(d.payload && d.payload.level) || 0));
      BEAT.pulse = 1;
    } else if (d.type === 'live') {
      var l = d.payload || {};
      LIVE.bpm = Number(l.bpm) || 0;
      LIVE.level = Number(l.level) || 0;
      LIVE.bass = Number(l.bass) || 0;
      LIVE.mid = Number(l.mid) || 0;
      LIVE.treble = Number(l.treble) || 0;
    }
  } catch (e) { logErr('msg', e); }
}

/* ---------- palette + helpers ---------- */
var INK = '#2B0018';
var PINK = '#FF2E93';
var NEON = '#FFE93A';
var CREAM = '#FFF6EC';
var TNOW = 0;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function mk(w, h) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
var SEED = 4721;
function rnd() { SEED = (SEED * 1664525 + 1013904223) % 4294967296; return SEED / 4294967296; }
function mixCol(a, b, k) {
  var pa = [parseInt(a.substr(1, 2), 16), parseInt(a.substr(3, 2), 16), parseInt(a.substr(5, 2), 16)];
  var pb = [parseInt(b.substr(1, 2), 16), parseInt(b.substr(3, 2), 16), parseInt(b.substr(5, 2), 16)];
  var s = '#';
  for (var i = 0; i < 3; i++) {
    var v = Math.round(pa[i] + (pb[i] - pa[i]) * k);
    s += ('0' + clamp(v, 0, 255).toString(16)).slice(-2);
  }
  return s;
}
function fontOf(fs) { return '900 ' + fs.toFixed(1) + 'px "Arial Black","Helvetica Neue",system-ui,sans-serif'; }

var SCENE = { w: 0, h: 0, bg: null, star: null, spark: null, ribbon: null, ribbonW: 0, ready: false };

function drawRosette(x, cx, cy, s) {
  var i, a, lobes = 4 + (rnd() > 0.55 ? 1 : 0);
  x.save();
  x.translate(cx, cy);
  x.rotate(rnd() * 6.2832);
  x.fillStyle = 'rgba(88,0,52,0.90)';
  x.beginPath();
  for (i = 0; i < lobes; i++) {
    a = i / lobes * Math.PI * 2 + 0.4;
    x.moveTo(Math.cos(a) * s * 0.95 + s * 0.5, Math.sin(a) * s * 0.95);
    x.arc(Math.cos(a) * s * 0.95, Math.sin(a) * s * 0.95, s * 0.52, 0, 6.2832);
  }
  x.moveTo(s * 0.55, 0);
  x.arc(0, 0, s * 0.55, 0, 6.2832);
  x.fill();
  x.fillStyle = 'rgba(255,203,227,0.80)';
  x.beginPath();
  if (x.ellipse) x.ellipse(0, 0, s * 0.5, s * 0.44, 0.2, 0, 6.2832);
  else x.arc(0, 0, s * 0.47, 0, 6.2832);
  x.fill();
  x.restore();
}

function buildBG() {
  var W = VW + 160, H = VH + 160;
  var c = mk(W, H), x = c.getContext('2d');
  var gr = x.createLinearGradient(0, 0, W * 0.55, H);
  gr.addColorStop(0, '#ff5cab');
  gr.addColorStop(0.45, '#ff2e93');
  gr.addColorStop(1, '#cf0068');
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);

  /* zebra ribbon sweeping top-left */
  x.save();
  x.translate(W * 0.12, H * 0.04);
  x.rotate(-0.42);
  var bw = W * 0.62, bh = H * 0.20, sw = Math.max(18, bh * 0.30);
  x.beginPath();
  x.rect(-bw * 0.1, -bh / 2, bw, bh);
  x.clip();
  x.fillStyle = '#fff3f8';
  x.fillRect(-bw * 0.1, -bh / 2, bw, bh);
  x.fillStyle = 'rgba(43,0,24,0.92)';
  var n = Math.ceil(bw / (sw * 1.6)) + 3, i2;
  for (i2 = 0; i2 < n; i2++) {
    var bx = -bw * 0.1 + i2 * sw * 1.6;
    x.beginPath();
    x.moveTo(bx, -bh / 2);
    x.lineTo(bx + sw, -bh / 2);
    x.lineTo(bx + sw * 1.9, bh / 2);
    x.lineTo(bx + sw * 0.9, bh / 2);
    x.closePath();
    x.fill();
  }
  x.restore();

  /* leopard rosettes */
  SEED = 90210;
  var step = Math.max(112, Math.round(Math.min(W, H) / 6.2));
  var gy, gx;
  for (gy = -step; gy < H + step; gy += step) {
    var rowEven = Math.abs(Math.round(gy / step)) % 2 === 0;
    for (gx = -step; gx < W + step; gx += step) {
      var ox = gx + (rowEven ? 0 : step * 0.5) + (rnd() - 0.5) * step * 0.42;
      var oy = gy + (rnd() - 0.5) * step * 0.42;
      drawRosette(x, ox, oy, step * (0.20 + rnd() * 0.11));
    }
  }

  /* neon confetti dots */
  SEED = 3377;
  for (var k = 0; k < 110; k++) {
    var px = rnd() * W, py = rnd() * H, pr = 1.5 + rnd() * 4.5;
    x.beginPath();
    x.arc(px, py, pr, 0, 6.2832);
    x.fillStyle = rnd() > 0.5 ? 'rgba(255,233,58,0.55)' : 'rgba(255,255,255,0.42)';
    x.fill();
  }

  /* soft neon glows (static, pre-lit once) */
  var glows = [
    [W * 0.14, H * 0.22, Math.min(W, H) * 0.66],
    [W * 0.88, H * 0.36, Math.min(W, H) * 0.58],
    [W * 0.46, H * 0.74, Math.min(W, H) * 0.62]
  ];
  for (var g = 0; g < glows.length; g++) {
    var gl = glows[g];
    if (!isFinite(gl[2]) || gl[2] <= 8) continue;
    var rg = x.createRadialGradient(gl[0], gl[1], 0, gl[0], gl[1], gl[2]);
    rg.addColorStop(0, 'rgba(255,36,140,0.32)');
    rg.addColorStop(0.55, 'rgba(206,0,104,0.16)');
    rg.addColorStop(1, 'rgba(206,0,104,0)');
    x.fillStyle = rg;
    x.fillRect(0, 0, W, H);
  }

  /* ink band behind the lyric zone (keeps cream text readable on hot pink) */
  var bandY = H * 0.60, bandH = H * 0.34;
  var band = x.createLinearGradient(0, bandY - bandH / 2, 0, bandY + bandH / 2);
  band.addColorStop(0, 'rgba(38,0,22,0)');
  band.addColorStop(0.5, 'rgba(38,0,22,0.36)');
  band.addColorStop(1, 'rgba(38,0,22,0)');
  x.fillStyle = band;
  x.fillRect(0, bandY - bandH / 2, W, bandH);

  /* bottom marquee strip baked in */
  var rb = SCENE.ribbon;
  if (rb) {
    x.save();
    x.translate(-rb.h * 0.08, VH - rb.h * 0.52);
    x.rotate(-0.032);
    x.drawImage(rb.cv, 0, 0, rb.w, rb.h);
    x.drawImage(rb.cv, rb.w, 0, rb.w, rb.h);
    x.restore();
  }

  /* vignette */
  var vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.80);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(58,0,34,0.40)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);

  return c;
}

function makeStar(R, edge) {
  var S = Math.ceil(R * 2 + 26);
  var c = mk(S, S), x = c.getContext('2d');
  x.translate(S / 2, S / 2);
  x.beginPath();
  var i, a, rr, px, py;
  for (i = 0; i < 10; i++) {
    a = -Math.PI / 2 + i * Math.PI / 5;
    rr = (i % 2 ? R * 0.46 : R);
    px = Math.cos(a) * rr; py = Math.sin(a) * rr;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.closePath();
  var g = x.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, '#FFF6C2');
  g.addColorStop(0.45, '#FFCF1F');
  g.addColorStop(1, '#FFA400');
  x.fillStyle = g;
  x.lineJoin = 'round';
  x.lineWidth = R * 0.10;
  x.strokeStyle = edge;
  x.stroke();
  x.fill();
  x.globalAlpha = 0.45;
  x.strokeStyle = '#FFF8D0';
  x.lineWidth = R * 0.035;
  x.beginPath();
  for (i = 0; i < 10; i++) {
    a = -Math.PI / 2 + i * Math.PI / 5;
    rr = (i % 2 ? R * 0.30 : R * 0.66);
    px = Math.cos(a) * rr; py = Math.sin(a) * rr;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.closePath();
  x.stroke();
  return c;
}

function makeSpark(size) {
  var S = Math.ceil(size * 2 + 8);
  var c = mk(S, S), x = c.getContext('2d');
  x.translate(S / 2, S / 2);
  x.beginPath();
  x.moveTo(0, -size); x.lineTo(size * 0.22, -size * 0.22);
  x.lineTo(size, 0); x.lineTo(size * 0.22, size * 0.22);
  x.lineTo(0, size); x.lineTo(-size * 0.22, size * 0.22);
  x.lineTo(-size, 0); x.lineTo(-size * 0.22, -size * 0.22);
  x.closePath();
  x.fillStyle = NEON;
  x.fill();
  x.strokeStyle = 'rgba(43,0,24,0.85)';
  x.lineWidth = Math.max(1.4, size * 0.10);
  x.lineJoin = 'round';
  x.stroke();
  return c;
}

function buildRibbon() {
  var h = clamp(VH * 0.055, 24, 46);
  var fs = Math.round(h * 0.52);
  var txt = '★ SHIBUYA 109 ★ EUROBEAT ★ PARA PARA ★ GAL ★ ';
  var c = mk(10, h), x = c.getContext('2d');
  x.font = '900 ' + fs + 'px "Arial Black",system-ui,sans-serif';
  var unit = Math.ceil(x.measureText(txt).width) + 4;
  var reps = Math.min(14, Math.ceil((VW * 2) / Math.max(40, unit)) + 2);
  var W2 = unit * reps;
  x = null;
  c.width = Math.max(2, W2); c.height = Math.max(2, Math.ceil(h));
  var y2 = c.getContext('2d');
  y2.fillStyle = CREAM; y2.fillRect(0, 0, W2, h);
  y2.fillStyle = '#FF1F86';
  y2.font = '900 ' + fs + 'px "Arial Black",system-ui,sans-serif';
  y2.textBaseline = 'middle';
  for (var i = 0; i < reps; i++) y2.fillText(txt, i * unit, h * 0.54);
  y2.fillStyle = INK;
  y2.fillRect(0, 0, W2, Math.max(3, h * 0.10));
  y2.fillRect(0, h - Math.max(3, h * 0.10), W2, Math.max(3, h * 0.10));
  return { cv: c, w: W2, h: h };
}

function buildScene() {
  SCENE.w = VW; SCENE.h = VH;
  SCENE.ready = false;
  try { SCENE.ribbon = buildRibbon(); } catch (e) { logErr('ribbon', e); SCENE.ribbon = null; }
  try { SCENE.bg = buildBG(); } catch (e) { logErr('bg', e); SCENE.bg = null; }
  try { SCENE.star = makeStar(Math.round(Math.min(VW, VH) * 0.36), '#7A3B00'); } catch (e) { logErr('star', e); SCENE.star = null; }
  try { SCENE.spark = makeSpark(Math.round(clamp(Math.min(VW, VH) * 0.022, 6, 26))); } catch (e) { logErr('spark', e); SCENE.spark = null; }
  SCENE.sparks = [];
  SEED = 5150;
  for (var i = 0; i < 22; i++) {
    SCENE.sparks.push({ x: rnd(), y: rnd(), s: 0.4 + rnd() * 1.1, ph: rnd() * 6.2832, sp: 0.5 + rnd() });
  }
  SCENE.ready = true;
}

function drawScene() {
  if (!SCENE.ready) {
    g2d.fillStyle = PINK;
    g2d.fillRect(0, 0, VW, VH);
    return;
  }
  var drift = Math.sin(TNOW * 0.00013) * 18;
  var driftY = Math.cos(TNOW * 0.00011) * 15;
  if (SCENE.bg) {
    g2d.drawImage(SCENE.bg, -80 + drift, -80 + driftY, VW + 160, VH + 160);
  } else {
    g2d.fillStyle = PINK;
    g2d.fillRect(0, 0, VW, VH);
  }

  var portrait = VW < VH;
  var cx = portrait ? VW * 0.5 : VW * 0.52;
  var cy = portrait ? VH * 0.42 : VH * 0.47;

  /* hero star */
  if (SCENE.star) {
    var R = Math.min(VW, VH) * (portrait ? 0.55 : 0.48);
    var sc = (R * 2) / Math.max(1, SCENE.star.width) * (1 + PULSE * 0.022);
    g2d.save();
    g2d.globalAlpha = 0.92;
    g2d.translate(cx, cy);
    g2d.rotate(TNOW * 0.00005 + PULSE * 0.006);
    g2d.drawImage(SCENE.star, -SCENE.star.width * sc / 2, -SCENE.star.height * sc / 2, SCENE.star.width * sc, SCENE.star.height * sc);
    g2d.restore();
  }

  /* sparkles */
  if (SCENE.spark && SCENE.sparks.length) {
    var sw = SCENE.spark.width;
    for (var i = 0; i < SCENE.sparks.length; i++) {
      var s = SCENE.sparks[i];
      var tw = 0.55 + 0.45 * Math.sin(TNOW * 0.0018 * s.sp + s.ph);
      var px = s.x * VW + Math.sin(TNOW * 0.0004 + s.ph) * 14;
      var py = s.y * VH + Math.cos(TNOW * 0.0005 + s.ph) * 18;
      var ss = s.s * (0.85 + PULSE * 0.35);
      g2d.globalAlpha = 0.35 + 0.6 * tw;
      g2d.drawImage(SCENE.spark, px - sw * ss / 2, py - sw * ss / 2, sw * ss, sw * ss);
    }
    g2d.globalAlpha = 1;
  }

  drawCover(portrait);
  drawStickers(portrait);
  drawRibbon();
}

/* ---------- cover polaroid ---------- */
function drawCover(portrait) {
  var s = Math.min(VW, VH) * (portrait ? 0.30 : 0.235);
  if (s < 26) return;
  var cw = s, ch = s * 1.06;
  var x = portrait ? VW * 0.5 - cw / 2 : VW * 0.80 - cw / 2;
  var y = portrait ? VH * 0.115 - ch / 2 + ch * 0.5 : VH * 0.245 - ch / 2;
  var rot = Math.sin(TNOW * 0.00037) * 0.045 + (portrait ? -0.03 : 0.05);
  g2d.save();
  g2d.translate(x + cw / 2, y + ch / 2);
  g2d.rotate(rot);
  g2d.translate(-(cw / 2), -(ch / 2));

  var pad = Math.max(4, s * 0.055);
  g2d.fillStyle = 'rgba(43,0,24,0.34)';
  g2d.fillRect(pad * 0.9, pad * 1.2, cw, ch);
  g2d.fillStyle = CREAM;
  g2d.fillRect(0, 0, cw, ch);
  g2d.strokeStyle = 'rgba(43,0,24,0.55)';
  g2d.lineWidth = Math.max(2, s * 0.016);
  g2d.strokeRect(g2d.lineWidth / 2, g2d.lineWidth / 2, cw - g2d.lineWidth, ch - g2d.lineWidth);

  var iw = cw - pad * 2, ih = iw;
  g2d.save();
  g2d.beginPath();
  g2d.rect(pad, pad, iw, ih);
  g2d.clip();
  if (COVER.ok && COVER.img && COVER.img.width) {
    var im = COVER.img, sc = Math.max(iw / im.width, ih / im.height);
    g2d.drawImage(im, pad + (iw - im.width * sc) / 2, pad + (ih - im.height * sc) / 2, im.width * sc, im.height * sc);
  } else {
    var pg = g2d.createLinearGradient(pad, pad, pad + iw, pad + ih);
    pg.addColorStop(0, '#5A0B46');
    pg.addColorStop(0.5, '#B6117C');
    pg.addColorStop(1, '#3A0030');
    g2d.fillStyle = pg;
    g2d.fillRect(pad, pad, iw, ih);
    g2d.fillStyle = 'rgba(255,233,58,0.90)';
    g2d.font = '900 ' + Math.round(iw * 0.30) + 'px "Arial Black",system-ui,sans-serif';
    g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
    g2d.fillText('109', pad + iw / 2, pad + ih * 0.44);
    g2d.fillStyle = 'rgba(255,243,248,0.85)';
    g2d.font = '900 ' + Math.round(iw * 0.13) + 'px "Arial Black",system-ui,sans-serif';
    g2d.fillText('NO MUSIC?', pad + iw / 2, pad + ih * 0.74);
  }
  g2d.restore();

  g2d.fillStyle = '#FF1F86';
  g2d.font = '900 ' + Math.round(s * 0.13) + 'px "Arial Black",system-ui,sans-serif';
  g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
  g2d.fillText('109 \u2605 GAL', cw / 2, pad + ih + (ch - pad - ih) * 0.55);
  g2d.restore();
}

/* ---------- stickers ---------- */
function bubble(x, y, txt, fs, fill, ring, rot) {
  g2d.save();
  g2d.translate(x, y);
  g2d.rotate(rot);
  g2d.font = fontOf(fs);
  g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
  g2d.lineJoin = 'round';
  g2d.lineWidth = fs * 0.26;
  g2d.strokeStyle = ring;
  g2d.strokeText(txt, fs * 0.05, fs * 0.07);
  g2d.lineWidth = fs * 0.13;
  g2d.strokeStyle = INK;
  g2d.strokeText(txt, 0, 0);
  g2d.fillStyle = fill;
  g2d.fillText(txt, 0, 0);
  g2d.restore();
}
function drawStickers(portrait) {
  var u = Math.min(VW, VH);
  var bob = Math.sin(TNOW * 0.0009) * u * 0.006 + PULSE * u * 0.004;
  var fs = clamp(u * 0.052, 15, 62);
  if (portrait) {
    bubble(VW * 0.17, VH * 0.075 + bob, 'PARA', fs * 0.9, NEON, '#8A0B58', -0.16);
    bubble(VW * 0.84, VH * 0.045 - bob, '\u2605', fs * 1.5, CREAM, '#FF1F86', 0.12);
    bubble(VW * 0.15, VH * 0.925 + bob, 'EUROBEAT', fs * 0.72, CREAM, '#FF1F86', -0.10);
  } else {
    bubble(VW * 0.075, VH * 0.155 + bob, 'PARA', fs, NEON, '#8A0B58', -0.14);
    bubble(VW * 0.075, VH * 0.255 - bob, 'PARA', fs * 0.82, CREAM, '#FF1F86', 0.10);
    bubble(VW * 0.30, VH * 0.075 - bob, '\u2605', fs * 1.4, CREAM, '#FF1F86', 0.14);
    bubble(VW * 0.62, VH * 0.115 + bob, '109', fs * 1.15, NEON, '#8A0B58', -0.08);
  }
  /* lyric-side heart */
  var hx = portrait ? VW * 0.88 : VW * 0.925, hy = portrait ? VH * 0.80 : VH * 0.735;
  bubble(hx, hy + bob * 1.4, '\u2665', fs * 1.7, '#FF1F86', CREAM, Math.sin(TNOW * 0.0007) * 0.12);
}

/* ---------- marquee ribbon ---------- */
function drawRibbon() {
  var rb = SCENE.ribbon;
  if (!rb) return;
  var h = rb.h;
  var y = VH - h;
  g2d.save();
  g2d.translate(0, y);
  g2d.fillStyle = 'rgba(43,0,24,0.30)';
  g2d.fillRect(0, -h * 0.12, VW, h);
  g2d.rotate(-0.012);
  var off = -((TNOW * 0.055) % rb.w);
  if (!isFinite(off)) off = 0;
  var x = off;
  var guard = 0;
  while (x < VW && guard++ < 24) {
    g2d.drawImage(rb.cv, x, -h * 0.05, rb.w, h);
    x += rb.w;
  }
  g2d.restore();
}

/* ---------- lyric ---------- */
function unitsOf(L) {
  var txt = L.text || '', out = [], i;
  if (!txt.length) return out;
  if (L.chars && L.chars.length) {
    if (L.chars.length === txt.length) {
      for (i = 0; i < txt.length; i++) out.push({ c: txt.charAt(i), t: L.chars[i].t });
    } else {
      var m = L.chars.length;
      for (i = 0; i < m; i++) {
        var seg = Math.max(1, Math.round(txt.length / m));
        var take = txt.substr(i * seg, seg);
        for (var k = 0; k < take.length; k++) out.push({ c: take.charAt(k), t: L.chars[i].t + k * 0.045 });
      }
      if (out.length !== txt.length) {
        out = [];
        for (i = 0; i < txt.length; i++) out.push({ c: txt.charAt(i), t: L.t + (i / txt.length) * L.dur });
      }
    }
  } else {
    var n = Math.max(1, txt.length);
    for (i = 0; i < n; i++) out.push({ c: txt.charAt(i), t: L.t + (i / n) * L.dur * 0.92 });
  }
  return out;
}
function wrapUnits(units, maxW, fs) {
  g2d.font = fontOf(fs);
  var rows = [], row = [], w = 0, i, c, cw;
  for (i = 0; i < units.length; i++) {
    c = units[i].c;
    cw = g2d.measureText(c).width;
    if (c === ' ' && !row.length) continue;
    if (row.length && w + cw > maxW) {
      rows.push({ items: row, w: w });
      row = []; w = 0;
      if (c === ' ') continue;
    }
    row.push({ c: c, t: units[i].t, w: cw });
    w += cw;
    if (row.length > 220) break;
  }
  if (row.length) rows.push({ items: row, w: w });
  return rows;
}
function buildLayout(L) {
  var portrait = VW < VH;
  var maxW = Math.min(VW * (portrait ? 0.90 : 0.84), 1180);
  var fs = clamp(Math.min(VW * 0.084, VH * 0.115), 18, 132);
  var maxRows = portrait ? 4 : 2;
  var units = unitsOf(L);
  var rows = [], guard = 0;
  while (guard++ < 26) {
    rows = wrapUnits(units, maxW, fs);
    if (rows.length <= maxRows) break;
    fs *= 0.88;
    if (fs < 15) { fs = 15; break; }
  }
  rows = wrapUnits(units, maxW, fs);
  if (rows.length > 6) rows = rows.slice(0, 6);
  LAYOUT.fs = fs; LAYOUT.rows = rows; LAYOUT.maxW = maxW;
  LAYOUT.key = L.text + '|' + Math.round(VW) + 'x' + Math.round(VH);
  return rows;
}
function drawLyric() {
  var ls = ST.lines;
  var portrait = VW < VH;

  /* progress strip above ribbon */
  var rbH = SCENE.ribbon ? SCENE.ribbon.h : clamp(VH * 0.055, 24, 46);
  var pw = Math.min(VW * 0.62, 760), px = (VW - pw) / 2, py = VH - rbH - clamp(VH * 0.028, 12, 30);
  var prog = ST.dur > 0 ? clamp(ST.t / ST.dur, 0, 1) : 0;

  if (!ls.length) {
    var fsz = clamp(Math.min(VW, VH) * 0.048, 16, 54);
    g2d.font = fontOf(fsz);
    g2d.textAlign = 'center'; g2d.textBaseline = 'middle';
    g2d.lineJoin = 'round';
    g2d.lineWidth = fsz * 0.16;
    g2d.strokeStyle = INK;
    g2d.strokeText('\u2014\u2014 \u7eaf\u97f3\u4e50 \u00b7 \u6ca1\u6709\u6b4c\u8bcd \u2014\u2014', VW / 2, VH * 0.66);
    g2d.fillStyle = CREAM;
    g2d.fillText('\u2014\u2014 \u7eaf\u97f3\u4e50 \u00b7 \u6ca1\u6709\u6b4c\u8bcd \u2014\u2014', VW / 2, VH * 0.66);
    g2d.font = fontOf(fsz * 0.36);
    g2d.fillStyle = 'rgba(255,243,248,0.80)';
    g2d.lineWidth = fsz * 0.08;
    g2d.strokeText('\u2605 ENJOY THE RIDE \u2605', VW / 2, VH * 0.66 + fsz * 1.25);
    g2d.fillText('\u2605 ENJOY THE RIDE \u2605', VW / 2, VH * 0.66 + fsz * 1.25);
    return;
  }

  var i = ST.idx;
  var L = ls[i];
  if (!L) {
    return;
  }
  if (LAYOUT.key !== L.text + '|' + Math.round(VW) + 'x' + Math.round(VH) || !LAYOUT.rows) {
    buildLayout(L);
  }
  var rows = LAYOUT.rows || [];
  if (!rows.length) return;

  var fs = LAYOUT.fs;
  var lh = fs * 1.24;
  var centerY = portrait ? VH * 0.585 : VH * 0.66;
  var topY = centerY - (rows.length * lh) / 2 + lh / 2;
  var now = ST.t;
  var sung = L.t + Math.max(0.4, L.dur * 0.55);

  g2d.textAlign = 'left'; g2d.textBaseline = 'middle';
  g2d.lineJoin = 'round'; g2d.miterLimit = 2;
  var r, it, k, row, x0, cx2, ch, isSung, isCur, curPos = null;
  for (r = 0; r < rows.length; r++) {
    row = rows[r];
    x0 = (VW - row.w) / 2;
    var y = topY + r * lh;
    for (k = 0; k < row.items.length; k++) {
      it = row.items[k];
      ch = it.c;
      if (ch === ' ' || ch === '\u3000') { x0 += it.w; continue; }
      isSung = now >= it.t + 0.04;
      isCur = now >= it.t - 0.02 && now < it.t + 0.42;
      cx2 = x0 + it.w / 2;
      if (isSung) {
        g2d.font = fontOf(fs);
        g2d.lineWidth = fs * 0.30;
        g2d.strokeStyle = '#FF8A2A';
        g2d.strokeText(ch, cx2, y);
      }
      var cf = fs * (isCur && !RM ? 1.10 : 1);
      g2d.font = fontOf(cf);
      g2d.lineWidth = cf * 0.13;
      g2d.strokeStyle = INK;
      g2d.strokeText(ch, cx2, y);
      g2d.fillStyle = isCur ? '#FFFDF0' : (isSung ? CREAM : '#EEB6D2');
      g2d.fillText(ch, cx2, y);
      if (isCur) curPos = { x: cx2 + it.w * 0.60, y: y - fs * 0.62 };
      x0 += it.w;
    }
  }
  g2d.textAlign = 'center';
  g2d.font = fontOf(fs);

  /* next line ghost */
  var nx = ls[i + 1];
  if (nx && nx.text && !portrait) {
    var nf = clamp(fs * 0.42, 12, 42);
    g2d.font = fontOf(nf);
    g2d.lineWidth = nf * 0.22;
    g2d.strokeStyle = 'rgba(43,0,24,0.55)';
    g2d.strokeText(nx.text.slice(0, 46), VW / 2, topY + rows.length * lh + nf * 1.5);
    g2d.fillStyle = 'rgba(255,243,248,0.58)';
    g2d.fillText(nx.text.slice(0, 46), VW / 2, topY + rows.length * lh + nf * 1.5);
  }

  /* sparkle trailing the current syllable */
  if (curPos && SCENE.spark && now < sung) {
    var ss = clamp(minOf(fs * 0.42, 26), 6, 26);
    g2d.globalAlpha = 0.55 + 0.45 * Math.sin(TNOW * 0.004);
    g2d.drawImage(SCENE.spark, curPos.x, curPos.y - ss * 0.6, ss, ss);
    g2d.globalAlpha = 1;
  }

  /* progress capsule */
  g2d.fillStyle = 'rgba(43,0,24,0.28)';
  roundRect(px, py, pw, 5, 3);
  g2d.fillStyle = NEON;
  if (prog > 0) roundRect(px, py, Math.max(3, pw * prog), 5, 3);
}
function minOf(a, b) { return a < b ? a : b; }
function roundRect(x, y, w, h, r) {
  var rr = Math.min(r, h / 2, w / 2);
  g2d.beginPath();
  g2d.moveTo(x + rr, y);
  g2d.lineTo(x + w - rr, y);
  g2d.arc(x + w - rr, y + rr, rr, -1.5708, 0);
  g2d.lineTo(x + w, y + h - rr);
  g2d.arc(x + w - rr, y + h - rr, rr, 0, 1.5708);
  g2d.lineTo(x + rr, y + h);
  g2d.arc(x + rr, y + h - rr, rr, 1.5708, 3.1416);
  g2d.lineTo(x, y + rr);
  g2d.arc(x + rr, y + rr, rr, 3.1416, 4.7124);
  g2d.closePath();
  g2d.fill();
}

/* ---------- loop ---------- */
function step() {
  drawScene();
  drawLyric();
}
function frame(ts) {
  var t0 = performance.now();
  ST.frames++;
  TNOW = ts;
  BEAT.pulse *= 0.885;
  PULSE = Math.min(1.35, BEAT.pulse * 0.8 + LIVE.bass * 0.45 + LIVE.level * 0.22);
  if (!isFinite(PULSE) || PULSE < 0) PULSE = 0;
  try { step(); } catch (e) { logErr('frame', e); }
  ST.js = performance.now() - t0;
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
try {
  RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  resize();
  window.addEventListener('resize', function () { try { resize(); } catch (e) { logErr('resize', e); } }, false);
  requestAnimationFrame(function (ts) { sendReady(); frame(ts); });
  setTimeout(sendReady, 1000);
  setTimeout(sendReady, 2500);
} catch (e) { logErr('boot', e); }

window.__stage = function () {
  return {
    lines: ST.lines.length,
    idx: ST.idx,
    t: ST.t,
    playing: !!ST.playing,
    frames: ST.frames,
    js: ST.js,
    err: ST.err,
    text: ST.text,
    gl: false,
    rm: RM
  };
};

