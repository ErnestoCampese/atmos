/* αtmos — the audio engine: the audio context and the limiter on the master output, the fade curves,
   decoding a sound, each sound's chain of effects, scheduling and looping, playing and stopping,
   previews, and the WAV export. Moved here from the single app.js line for line, without changes. */

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC();
const master = ctx.createGain();
limitTo(ctx, master);
/* A gentle limiter between the master volume and the output, for playback and for exported files
   alike. With many sounds at once their levels add up and the peaks would crackle; this holds down
   only what goes above -3 dB and leaves everything below as it is. The browser's compressor adds
   some loudness of its own to make up for what it takes away; the gain after it removes exactly
   that, so a quiet mix comes out at the level it went in. */
function limitTo(context, from) {
  const THRESHOLD = -3, RATIO = 20;
  const lim = context.createDynamicsCompressor();
  lim.threshold.value = THRESHOLD; lim.knee.value = 0; lim.ratio.value = RATIO;
  lim.attack.value = 0.003; lim.release.value = 0.25;
  const trim = context.createGain();
  trim.gain.value = Math.pow(10, THRESHOLD * (1 - 1 / RATIO) * 0.6 / 20);
  from.connect(lim); lim.connect(trim); trim.connect(context.destination);
}

/* curves for smooth (equal-power) fades */
const N = 64, CIN = new Float32Array(N), COUT = new Float32Array(N);
for (let i = 0; i < N; i++) { const x = i / (N - 1); CIN[i] = Math.sin(x * Math.PI / 2); COUT[i] = Math.cos(x * Math.PI / 2); }
const scaled = (base, k) => { if (k === 1) return base; const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = base[i] * k; return c; };

function loadBuffer(path) {
  if (buffers.has(path)) return buffers.get(path);
  // keep the promise, so a file used by several sounds is decoded only once
  const p = readFile(path).then(f => f.arrayBuffer()).then(ab => ctx.decodeAudioData(ab));
  buffers.set(path, p);
  p.catch(() => { if (buffers.get(path) === p) buffers.delete(path); });
  return p;
}

/* ---------- audio: chain and scheduling ---------- */
function effectiveGain(t) {
  const anySolo = cur && cur.tracks.some(x => x.solo);
  if (t.muted || (anySolo && !t.solo)) return 0;
  return t.volume;
}
/* ---------- effects ---------- */
/* The lines of the table. "How it moves" holds two saved amounts: `movement` (it wanders around its place, all the
   time) and `trajectory` (it passes by, each time it plays); only one of them is ever at work. */
const FILTERS = [
  ['reverb', 'Space'],
  ['echo', 'Echo'],
  ['muffled', 'Heard through'],
  ['thin', 'Played on'],
  ['waves', 'Rise and fall'],
  ['movement', 'How it moves']
];
/* Words instead of percentages: you do not have to know what 42% of a reverb sounds like. */
const fxWord = v => v === 0 ? 'Off' : v < 34 ? 'A little' : v < 67 ? 'Medium' : 'Strong';
/* Reverb spaces. rt = seconds for the tail to die away completely,
   pre = delay before the tail, dark = how much sooner the highs die away (rock walls),
   er = close early reflections (nearby walls). */
// the three kinds of echo are no longer offered: every echo comes back after the same time. The names stay, for the files that carry them
const ECHOES = { near: 1, valley: 1, mountain: 1 }, ECHO_TIME = 0.42;
const SPACES = {
  room:      { label: 'Room',      rt: 1.2, pre: 0.008, dark: 0.45, er: 6 },
  hall:      { label: 'Hall',      rt: 2.6, pre: 0.025, dark: 0.35, er: 4 },
  cathedral: { label: 'Cathedral', rt: 6.5, pre: 0.060, dark: 0.25, er: 3 },
  cave:      { label: 'Cave',      rt: 4.5, pre: 0.012, dark: 0.75, er: 14 }
};
const irCache = new Map();
function impulse(context, type = 'cathedral') {
  const sp = SPACES[type] || SPACES.cathedral, sr = context.sampleRate, key = sr + type;
  if (irCache.has(key)) return irCache.get(key);
  const pre = Math.round(sp.pre * sr), len = pre + Math.round(sp.rt * 1.05 * sr);
  const b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let y = 0, energy = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / sr;
      const env = Math.exp(-6.9 * x / sp.rt);                       // -60 dB at the end of the tail
      const k = Math.max(0.04, 0.9 - sp.dark * 0.85 * (x / sp.rt) - sp.dark * 0.1); // highs die away before lows
      y += k * ((Math.random() * 2 - 1) - y);
      d[i] = y * env;
    }
    // early reflections: small "taps" off the walls in the first ~80 ms
    for (let r = 0; r < sp.er; r++) {
      const at = pre + Math.round((0.004 + Math.random() * 0.075) * sr);
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5) * (1 - r / (sp.er + 1));
    }
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const norm = 1 / Math.sqrt(energy || 1);                         // predictable tail volume
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  irCache.set(key, b); return b;
}
function setReverbType(t, n = t.nodes, context = ctx) {
  // a new convolver for the new space, then the old one is unplugged
  const conv = context.createConvolver(); conv.normalize = false; conv.buffer = impulse(context, t.revType);
  n.revSend.connect(conv); conv.connect(n.tail);
  const old = n.conv; n.conv = conv;
  if (old) { try { n.revSend.disconnect(old); } catch (e) {} setTimeout(() => { try { old.disconnect(); } catch (e) {} }, 300); }
}
// "ping-pong" echo: left → right → left…, each repeat a little darker and quieter
function wireEcho(n, context) {
  n.dL = context.createDelay(3); n.dR = context.createDelay(3);
  n.dampL = context.createBiquadFilter(); n.dampL.type = 'lowpass'; n.dampL.frequency.value = 3200;
  n.dampR = context.createBiquadFilter(); n.dampR.type = 'lowpass'; n.dampR.frequency.value = 3200;
  n.fbL = context.createGain(); n.fbR = context.createGain();
  n.echoMerge = context.createChannelMerger(2);
  n.dlSend.connect(n.dL);
  n.dL.connect(n.dampL); n.dampL.connect(n.fbL); n.fbL.connect(n.dR);
  n.dR.connect(n.dampR); n.dampR.connect(n.fbR); n.fbR.connect(n.dL);
  n.dL.connect(n.echoMerge, 0, 0); n.dR.connect(n.echoMerge, 0, 1); n.echoMerge.connect(n.tail);
}
/* Stopping by hand means silence: the echo still travelling and the space still ringing are cut short too.
   Only where the writer presses stop (the composition's button, or a sound's own): a sound that ends by itself
   keeps its echo and its tail, which is the whole point of them. The old lines are thrown away and new, empty
   ones take their place, so nothing of what was cut comes back at the next play. `silent`: nothing can be heard
   at this moment (the whole mix has already faded), so the old lines go at once; otherwise they fade for an instant. */
function cutTails(t, silent) {
  const n = t.nodes; if (!n || !n.tail) return;
  const old = { tail: n.tail, conv: n.conv, fbL: n.fbL, fbR: n.fbR };
  try { n.revSend.disconnect(n.conv); n.dlSend.disconnect(n.dL); } catch (e) {}
  const drop = () => { try { old.tail.disconnect(); old.conv.disconnect(); old.fbL.disconnect(); old.fbR.disconnect(); } catch (e) {} };
  if (silent) drop(); else { old.tail.gain.setTargetAtTime(0, ctx.currentTime, 0.012); setTimeout(drop, 150); }
  n.tail = ctx.createGain(); n.tail.connect(n.out);
  n.conv = null; setReverbType(t);
  wireEcho(n, ctx); applyFx(t, n, ctx, true);
}
/* ---------- where a sound is ----------
   A sound is placed around the listener's head: to the left or right, ahead or behind, near or far, above or below.
   It is done the way the ear does it (the browser's binaural panner, "HRTF"): each ear gets the sound a little later,
   quieter and duller than the other, as a head in the way would make it. It needs headphones to be heard fully.
   To that are added what tells distance, height and front from back: a far sound is quieter, duller, and more of its
   space than of itself; a sound above is brighter, one below is darker; one behind is duller than one ahead, as the
   ear's own shape makes it. And every placed sound has the first few reflections of a room around it, too short to
   be heard as a room: they are what puts a sound out there, not inside the head.
   In the middle of the grid a sound is not a point at all: it is "all around you", the recording as it is, in stereo.
   Anywhere else it is wholly a point, however near.
   The measures behind these numbers: .dev/hrtf-probe.js */
const FIELD = 10;        // metres from the listener to the edge of the grid
const NEAR = 3;          // nearer than this, a sound is no louder: the first third of the grid is "close"
const CLOSE = 1.5;       // and nothing comes nearer than this to the middle of the head
const ROLLOFF = 0.93;    // the edge of the grid is 10 dB quieter than close by, its corners 13
const HRTF_GAIN = 2;     // the binaural panner comes out about 5 dB quieter than the sound that went in, more for a wide recording
const ELEV = 55 * Math.PI / 180;
const LAP = 1 / 12;      // a sound that wanders goes and comes back in 12 seconds, or goes once round
const PASS = 12;         // a long sound passes by again and again, each crossing about this many seconds
const EDGE = 1.2;        // and fades in and out at the far ends of each crossing, where it turns back unheard
const distGain = d => NEAR / (NEAR + ROLLOFF * (Math.max(d, NEAR) - NEAR));
/* "Passing by" moves the sound across each time it plays. A seamless loop never plays again, so there is nothing
   to pass: the effect is left out of it, its amount kept for when the loop is no longer seamless. */
const noPassing = t => t.mode === 'loop' && t.seamless;
const passing = t => (t.fx.trajectory || 0) > 0 && !noPassing(t);
const wandering = t => passing(t) ? 0 : (t.fx.movement || 0);
const fxCount = t => ['reverb', 'echo', 'muffled', 'thin', 'waves'].filter(k => t.fx[k] > 0).length + (passing(t) || wandering(t) ? 1 : 0);
/* where the sound is, in metres around the head: x to the right, y up, z behind (the browser's own axes).
   `s` is how much of a point it is: 0 all around you, 1 a point in a place. */
function placeOf(t) {
  let x = t.pos.x, y = t.pos.y, r = Math.hypot(x, y);
  const h = t.height || 0, wander = wandering(t);
  // a sound that wanders has to be somewhere to wander from: left on the listener, it starts three metres ahead
  if (wander && r < 0.3) { if (r < 0.01) { x = 0; y = 0.3; } else { x *= 0.3 / r; y *= 0.3 / r; } r = 0.3; }
  const over = r < 0.05, s = passing(t) || (over && !h) ? 0 : 1;
  const d = Math.max(CLOSE, r * FIELD), el = over ? h * Math.PI / 2 : h * ELEV;
  const th = over ? 0 : Math.atan2(x, y), rh = d * Math.cos(el);
  // `back`: -1 straight ahead, 0 to the side or overhead, 1 straight behind
  return { s, d, th, rh, back: over ? 0 : -Math.cos(th), x: rh * Math.sin(th), y: d * Math.sin(el), z: -rh * Math.cos(th) };
}
const binaural = context => {
  const p = context.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = NEAR; p.rolloffFactor = ROLLOFF;
  return p;
};
/* front from back, in tone: above 3 kHz a sound ahead is a little brighter, one behind a good deal duller (in dB: +3 to -8) */
const rearGain = b => b < 0 ? -3 * b : -8 * b;
/* the first reflections of a room, for both ears: a few short taps in the first 60 ms, each from its own side (the
   far ear gets it a moment later and weaker), each a little duller than the one before */
const roomCache = new Map();
function firstReflections(context) {
  const sr = context.sampleRate;
  if (roomCache.has(sr)) return roomCache.get(sr);
  const b = new AudioBuffer({ length: Math.round(0.07 * sr), numberOfChannels: 2, sampleRate: sr });
  const taps = [[7, .5, -1], [11, .42, 1], [17, -.36, -.6], [23, .3, .7], [31, -.24, -1], [39, .2, 1], [47, -.15, -.4], [58, .12, .5]];
  taps.forEach(([ms, g, side], i) => {
    for (let c = 0; c < 2; c++) {
      const far = (side < 0) === (c === 1), d = b.getChannelData(c);
      const at = Math.round((ms / 1000 + (far ? 0.0006 * Math.abs(side) : 0)) * sr), k = g * (far ? 1 - 0.6 * Math.abs(side) : 1);
      // each tap is smeared over a few samples, more for the later ones: that is its dullness
      const w = 2 + i; for (let j = 0; j < w; j++) d[at + j] += k * (1 - j / w) / (w / 2 + 0.5);
    }
  });
  roomCache.set(sr, b); return b;
}
// the ear's data is read the first time a binaural panner is made: have it ready before the first sound needs it
binaural(ctx);
// one channel out of two, as a point in space has: left and right are mixed before the sound is placed
const toPoint = (context, level) => { const g = context.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.gain.value = level; return g; };
function buildChain(t, context, dest) {
  const n = {};
  n.gain = context.createGain(); n.gain.gain.value = effectiveGain(t);
  n.lp = context.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.Q.value = 0.5;
  n.hp = context.createBiquadFilter(); n.hp.type = 'highpass'; n.hp.Q.value = 0.5;
  n.trem = context.createGain();
  n.dry = context.createGain();
  n.revSend = context.createGain();
  n.dlSend = context.createGain();
  n.out = context.createGain();
  // what rings on after the sound (its space and its echo) leaves through one gate, so it can be cut short.
  // It is not placed: a space is all around, and that is what makes the placed sound seem to be out there in it
  n.tail = context.createGain(); n.tail.connect(n.out);
  n.gain.connect(n.lp); n.lp.connect(n.hp); n.hp.connect(n.trem);
  n.trem.connect(n.dry);
  // the sound itself goes two ways, mixed by where it is: as it is (all around you), and as a point in a place
  n.wide = context.createGain(); n.dry.connect(n.wide); n.wide.connect(n.out);
  n.point = toPoint(context, 0);
  n.air = context.createBiquadFilter(); n.air.type = 'lowpass'; n.air.Q.value = 0.5;
  n.elev = context.createBiquadFilter(); n.elev.type = 'highshelf'; n.elev.frequency.value = 7000;
  n.rear = context.createBiquadFilter(); n.rear.type = 'highshelf'; n.rear.frequency.value = 3000;
  n.panner = binaural(context);
  n.point.connect(n.air); n.air.connect(n.elev); n.elev.connect(n.rear); n.rear.connect(n.panner); n.panner.connect(n.out);
  n.room = context.createGain(); n.roomConv = context.createConvolver(); n.roomConv.normalize = false; n.roomConv.buffer = firstReflections(context);
  n.rear.connect(n.room); n.room.connect(n.roomConv); n.roomConv.connect(n.out);
  n.trem.connect(n.revSend); setReverbType(t, n, context);
  n.trem.connect(n.dlSend); wireEcho(n, context);
  n.out.connect(dest);
  // a slow oscillator for "Rise and fall" (volume)
  n.tremLfo = context.createOscillator(); n.tremLfo.frequency.value = 0.11; n.tremDepth = context.createGain();
  n.tremLfo.connect(n.tremDepth); n.tremDepth.connect(n.trem.gain); n.tremLfo.start();
  n.fxIn = n.lp;
  applyFx(t, n, context, true);
  return n;
}
/* A sound that wanders turns around the listener, at the distance it was put: a little or widely to either side of
   its place, or all the way round. The place is an angle; two slow waves give its sine and cosine, which four gains
   turn into the left-right and ahead-behind of the panner. Built only for a sound that wanders. */
const SWAY = { little: 40 * Math.PI / 180, wide: 85 * Math.PI / 180 };
function wanderRig(n, context) {
  if (n.mv) return n.mv;
  const m = { src: {}, on: null }, g = () => { const x = context.createGain(); x.gain.value = 0; return x; };
  m.sin = context.createOscillator(); m.sin.frequency.value = LAP;
  m.cos = context.createOscillator(); m.cos.frequency.value = LAP;
  m.cos.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
  // all the way round: the angle keeps growing, so its sine and cosine are the two waves themselves
  m.src.round = [m.sin, m.cos];
  // to either side: the angle swings, and its sine and cosine are read off a curve
  for (const [k, a] of Object.entries(SWAY)) {
    const S = context.createWaveShaper(), C = context.createWaveShaper(), N = 257, cs = new Float32Array(N), cc = new Float32Array(N);
    for (let i = 0; i < N; i++) { const v = a * (i / (N - 1) * 2 - 1); cs[i] = Math.sin(v); cc[i] = Math.cos(v); }
    S.curve = cs; C.curve = cc; m.sin.connect(S); m.sin.connect(C);
    m.src[k] = [S, C];
  }
  m.busS = context.createGain(); m.busC = context.createGain();
  m.xS = g(); m.xC = g(); m.zS = g(); m.zC = g();
  m.busS.connect(m.xS); m.busS.connect(m.zS); m.busC.connect(m.xC); m.busC.connect(m.zC);
  m.xS.connect(n.panner.positionX); m.xC.connect(n.panner.positionX);
  m.zS.connect(n.panner.positionZ); m.zC.connect(n.panner.positionZ);
  // how far behind it is at each moment, read off a curve as the tone that tells front from back
  m.bS = g(); m.bC = g(); m.busS.connect(m.bS); m.busC.connect(m.bC);
  m.rear = context.createWaveShaper(); { const N = 257, c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = rearGain(i / (N - 1) * 2 - 1); m.rear.curve = c; }
  m.bS.connect(m.rear); m.bC.connect(m.rear); m.rear.connect(n.rear.gain);
  m.sin.start(); m.cos.start();
  return n.mv = m;
}
const wanderKind = v => !v ? null : v < 34 ? 'little' : v < 67 ? 'wide' : 'round';
function applyFx(t, n = t.nodes, context = ctx, now) {
  const f = k => (t.fx[k] || 0) / 100;
  const set = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, context.currentTime, 0.08); };
  // where it is
  const p = placeOf(t), kind = wanderKind(wandering(t));
  if (p.s > 0 && !n.placed) { n.dry.connect(n.point); n.placed = true; }
  set(n.wide.gain, Math.cos(p.s * Math.PI / 2));
  set(n.point.gain, Math.sin(p.s * Math.PI / 2) * HRTF_GAIN);
  set(n.air.frequency, 20000 * Math.pow(4500 / 20000, Math.max(0, Math.min(1, (p.d - NEAR) / (FIELD * 1.41 - NEAR)))));
  set(n.elev.gain, (t.height || 0) > 0 ? 5 : (t.height || 0) < 0 ? -8 : 0);
  set(n.panner.positionY, p.y);
  if (kind || n.mv) {
    const m = wanderRig(n, context);
    if (m.on !== kind) {
      if (m.on) { try { m.src[m.on][0].disconnect(m.busS); m.src[m.on][1].disconnect(m.busC); } catch (e) {} }
      if (kind) { m.src[kind][0].connect(m.busS); m.src[kind][1].connect(m.busC); }
      m.on = kind;
    }
    const a = kind ? p.rh : 0;
    set(m.xS.gain, a * Math.cos(p.th)); set(m.xC.gain, a * Math.sin(p.th));
    set(m.zS.gain, a * Math.sin(p.th)); set(m.zC.gain, -a * Math.cos(p.th));
    set(m.bS.gain, kind ? Math.sin(p.th) : 0); set(m.bC.gain, kind ? -Math.cos(p.th) : 0);
  }
  set(n.panner.positionX, kind ? 0 : p.x); set(n.panner.positionZ, kind ? 0 : p.z);
  set(n.rear.gain, kind ? 0 : rearGain(p.back));
  set(n.room.gain, 0.2 * Math.sqrt(distGain(p.d)));
  // the further a sound is, the more of what reaches you is its space and its echo
  const wet = passing(t) ? 0.8 : 1 - p.s + p.s * Math.sqrt(distGain(p.d));
  // "Played on" a small speaker loses its weight, and some of its brightness with it; "Heard through" loses the brightness
  set(n.lp.frequency, Math.min(20000 * Math.pow(250 / 20000, f('muffled')), 20000 * Math.pow(3400 / 20000, f('thin'))));
  set(n.hp.frequency, 20 * Math.pow(1500 / 20, f('thin')));
  set(n.revSend.gain, f('reverb') * 1.6 * wet);
  set(n.dry.gain, 1 - f('reverb') * 0.65);
  set(n.dL.delayTime, ECHO_TIME); set(n.dR.delayTime, ECHO_TIME);
  set(n.dlSend.gain, f('echo') * 1.3 * wet);
  set(n.fbL.gain, 0.45 + f('echo') * 0.25); set(n.fbR.gain, 0.45 + f('echo') * 0.25);
  set(n.trem.gain, 1 - f('waves') * 0.45);
  set(n.tremDepth.gain, f('waves') * 0.45);
}
function disposeChain(n) {
  try { n.tremLfo.stop(); if (n.mv) { n.mv.sin.stop(); n.mv.cos.stop(); } } catch (e) {}
  try { n.out.disconnect(); } catch (e) {}
}
function refreshGains() {
  if (!cur) return;
  cur.tracks.forEach(t => {
    t.nodes.gain.gain.setTargetAtTime(effectiveGain(t), ctx.currentTime, 0.05);
    if (t.el) t.el.classList.toggle('off', effectiveGain(t) === 0);
  });
  updateWhyOff(); updateLive();
}
function updateLive() {
  if (!cur) return;
  cur.tracks.forEach(t => {
    if (!t.el) return;
    t.el.classList.toggle('live', playing && t.mode === 'loop' && !!t.buffer && effectiveGain(t) > 0);
    if (!playing) t.el.classList.remove('hit');
    // gold means "this is sounding now": "only this" wears it only while the mix is actually playing
    const s = t.el.querySelector('.only');
    if (s) s.classList.toggle('sounding', t.solo && playing);
  });
  updateSoloNote(); updateMeta();
}
function fadeLen(t, d) {
  // Continuous: the chosen fade, or else a 10 ms join so the jump from the last sample to the first one does not click
  if (t.mode === 'loop') return Math.min(t.crossfade ? Math.max(0.01, t.fade) : 0.01, d / 3);
  // At intervals / Random: soft start and end (at least 20 ms, to avoid clicks)
  return Math.min(Math.max(0.02, t.hitFade || 0), d / 2.05);
}
/* Seamless loop: trims the silence, picks the cut point that sounds most like the start
   and blends the tail into the start, so the end of the sound flows exactly into its beginning. */
function makeSeamless(buf, fadeSec) {
  const sr = buf.sampleRate, C = buf.numberOfChannels, len = buf.length;
  const ch = []; for (let c = 0; c < C; c++) ch.push(buf.getChannelData(c));
  const thr = 0.003;
  const loud = i => { for (let c = 0; c < C; c++) if (Math.abs(ch[c][i]) > thr) return true; return false; };
  let a = 0, b = len - 1;
  while (a < len && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  /* A recording often fades in and out on its own. Left in, a short join falls inside those fades and the loop
     sinks and comes back. So each end is trimmed further, for as long as the sound keeps rising towards its usual
     level (within 3 dB of the middle one): a fade, not a quiet moment between two events, which is left alone.
     Never more than a fifth of the sound or 5 seconds at either end, and only if enough is left. */
  const win = Math.round(0.2 * sr), nW = Math.floor((b - a + 1) / win);
  if (nW >= 10) {
    const lv = new Float32Array(nW);
    for (let w = 0; w < nW; w++) { let e = 0; for (let c = 0; c < C; c++) { const d = ch[c]; for (let i = a + w * win, n = i + win; i < n; i++) e += d[i] * d[i]; } lv[w] = e; }
    const usual = Float32Array.from(lv).sort()[nW >> 1] / 2, most = Math.min(Math.floor(nW / 5), 25);
    let i = 0, j = nW - 1;
    while (i < most && lv[i] < usual && lv[i + 1] > lv[i]) i++;
    while (nW - 1 - j < most && lv[j] < usual && lv[j - 1] > lv[j]) j--;
    const a2 = a + i * win, b2 = j < nW - 1 ? a + (j + 1) * win - 1 : b;
    if (b2 - a2 + 1 >= sr * 1.5) { a = a2; b = b2; }
  }
  const L = b - a + 1;
  if (L < sr * 1.5) return null;
  const X = Math.max(Math.round(0.05 * sr), Math.round(Math.min(fadeSec, L / sr / 4) * sr));
  const mono = new Float32Array(L);
  for (let i = 0; i < L; i++) { let v = 0; for (let c = 0; c < C; c++) v += ch[c][a + i]; mono[i] = v / C; }
  const W = Math.min(4096, X);
  let headE = 0; for (let k = 0; k < W; k++) headE += mono[k] * mono[k];
  const S = Math.min(Math.round(3 * sr), Math.round(L * 0.2), L - 2 * X - 1);
  let E = L, best = -Infinity;
  for (let e = L - Math.max(0, S); S > 0 && e <= L; e += 128) {
    const o = e - X; let dot = 0, en = 0;
    for (let k = 0; k < W; k++) { const v = mono[o + k]; dot += v * mono[k]; en += v * v; }
    const corr = dot / Math.sqrt(en * headE + 1e-12);
    const sameLoudness = 1 - Math.min(1, Math.abs(Math.log((en + 1e-9) / (headE + 1e-9))) / 4);
    const score = corr * 0.6 + sameLoudness * 0.4;
    if (score > best) { best = score; E = e; }
  }
  const N = E - X;
  const out = new AudioBuffer({ length: N, numberOfChannels: C, sampleRate: sr });
  for (let c = 0; c < C; c++) {
    const src = ch[c], dst = out.getChannelData(c), base = E - 2 * X;
    dst.set(src.subarray(a + X, a + E - X), 0);
    for (let k = 0; k < X; k++) {
      const x = (k / X) * Math.PI / 2;
      dst[base + k] = src[a + E - X + k] * Math.cos(x) + src[a + k] * Math.sin(x);
    }
  }
  return out;
}
const isSeamless = t => t.mode === 'loop' && t.seamless && t.loopBuf;
function applySeamless(t) {
  if (!t.buffer) return;
  t.loopBuf = t.seamless ? makeSeamless(t.buffer, t.fade) : null;
  if (t.seamless && !t.loopBuf) { t.seamless = false; toast('This sound is too short to loop seamlessly. It needs at least 1.5 seconds without silence.', { kind: 'warn', ms: 5000 }); }
  if (playing && t.st) resetTrack(t, ctx.currentTime + 0.05);
  retest(t);
}
// a sound being listened to on its own starts again, so what is heard is the sound as it has just been set
function retest(t) { if (t.pv) { stopTrackTest(t); trackTest(t); } }
// remembers when each repeat starts, to draw the progress bar
function noteHit(t, start, dur, loop) { (t.hits = t.hits || []).push({ start, dur, loop }); if (t.hits.length > 4) t.hits.shift(); }
/* Passing by: on every repeat the sound travels past the listener, from far on one side to far on the other, along a
   line through the place it was given (ahead or behind, near or far, above or below). It swells as it comes and
   fades as it goes, as anything passing does. */
const TRAJ = { lr: 'Left to right', rl: 'Right to left', pp: 'Back and forth' };
function trajectory(t) {
  if (!passing(t)) return null;
  let dir = t.trajDir, k = 1;
  if (t.trajRand) { dir = Math.random() < 0.5 ? 'lr' : 'rl'; k = 0.6 + Math.random() * 0.4; }
  else if (dir === 'pp') { t.ppFlip = !t.ppFlip; dir = t.ppFlip ? 'lr' : 'rl'; }
  const w = 1.3 * FIELD * k;
  return dir === 'lr' ? { from: -w, to: w } : { from: w, to: -w };
}
/* connects the source to its destination, going (if needed) through a place that moves while the sound plays.
   A short sound crosses once, in the time it lasts. A long one would take minutes and never seem to move: it passes
   again and again instead, each crossing about PASS seconds, fading in as it comes and out as it goes. A sound
   listened to on its own repeats without end: half an hour of crossings is laid out for it. */
function trajConnect(t, context, node, dest, when, d, loopLen) {
  if (!passing(t)) { node.connect(dest); return null; }
  // never through the head: a line left on the listener passes just ahead
  const depth = Math.abs(t.pos.y) * FIELD < CLOSE ? (t.pos.y < 0 ? -CLOSE : CLOSE) : t.pos.y * FIELD;
  const m = toPoint(context, HRTF_GAIN), p = binaural(context);
  const tone = context.createBiquadFilter(); tone.type = 'highshelf'; tone.frequency.value = 3000; tone.gain.value = depth < 0 ? -8 : 2;
  p.positionZ.value = -depth; p.positionY.value = (t.height || 0) * Math.abs(depth) * 0.9;
  const whole = loopLen || d, long = whole > PASS * 1.5, each = long ? whole / Math.round(whole / PASS) : whole;
  const times = loopLen ? Math.ceil(1800 / each) : Math.round(whole / each);
  let from = node;
  if (long) { from = context.createGain(); from.gain.setValueAtTime(0, when); node.connect(from); }
  for (let i = 0; i < times; i++) {
    const a = when + i * each, tr = trajectory(t);
    p.positionX.setValueAtTime(tr.from, a); p.positionX.linearRampToValueAtTime(tr.to, a + each);
    if (long) { from.gain.setValueAtTime(0, a); from.gain.linearRampToValueAtTime(1, a + EDGE); from.gain.setValueAtTime(1, a + each - EDGE); from.gain.linearRampToValueAtTime(0, a + each); }
  }
  from.connect(m); m.connect(tone); tone.connect(p); p.connect(dest);
  return p;
}
function playOne(t, context, dest, when, sources) {
  if (isSeamless(t)) {
    const src = context.createBufferSource(); src.buffer = t.loopBuf; src.loop = true;
    src.connect(dest);
    src.start(when);
    if (sources) { sources.add(src); src.onended = () => sources.delete(src); noteHit(t, when, Infinity, t.loopBuf.duration); }
    return;
  }
  let rate = 1, level = 1;
  if (t.mode !== 'loop' && t.varyPitch) rate = 1 + (Math.random() * 2 - 1) * 0.07;
  if (t.mode !== 'loop' && t.varyVol) level = 0.65 + Math.random() * 0.35;
  const d = t.buffer.duration / rate, F = fadeLen(t, d);
  const src = context.createBufferSource(); src.buffer = t.buffer; src.playbackRate.value = rate;
  const env = context.createGain();
  if (F > 0) {
    env.gain.setValueAtTime(0, when);
    env.gain.setValueCurveAtTime(scaled(CIN, level), when, F);
    env.gain.setValueCurveAtTime(scaled(COUT, level), when + d - F, F);
  } else env.gain.value = level;
  src.connect(env); trajConnect(t, context, env, dest, when, d, 0);
  src.start(when);
  if (sources) { sources.add(src); src.onended = () => { sources.delete(src); try { env.disconnect(); } catch (e) {} }; noteHit(t, when, d, 0); }
  return d;
}
const avgGap = t => t.per / Math.max(1, t.count);
/* Random: the sound never overlaps itself. The chosen frequency is the silence between one play and the next,
   counted from the moment the sound ends: on average period / times, whatever the length of the sound.
   The pause is never shorter than 0.4 of that (so the sound does not come straight back) nor longer than 3 times it,
   and it is drawn from two throws instead of one, which makes very short pauses rare. */
function randomPause(t) {
  const a = avgGap(t), g = -(Math.log(1 - Math.random()) + Math.log(1 - Math.random())) / 2;
  return Math.max(1, a * Math.min(3, 0.4 + 0.6 * g));
}
function firstTime(t, now) {
  if (t.mode === 'loop') return now;
  if (t.mode === 'random') return now + Math.random() * avgGap(t);
  return now;
}
function nextAfter(t, when, d) {
  if (isSeamless(t)) return Infinity;
  if (t.mode === 'loop') { const D = t.buffer.duration; return when + Math.max(0.05, D - fadeLen(t, D)); }
  if (t.mode === 'random') return when + d + randomPause(t);
  return when + Math.max(0.1, t.every);
}
function pump(t, st, context, dest, until, live) {
  // if the computer was asleep, don't catch up on the missed repeats (they would all fire at once): carry on from now
  if (live && st.next < context.currentTime) st.next = context.currentTime + 0.05;
  while (st.next < until) {
    const when = st.next;
    const d = playOne(t, context, dest, when, st.sources) || t.buffer.duration;
    if (live && t.mode !== 'loop') flash(t, when);
    st.lastEnd = when + d;
    st.next = nextAfter(t, when, d);
  }
}
function flash(t, when) {
  setTimeout(() => {
    if (!t.el) return;
    t.el.classList.add('hit'); updateMeta();
    // the stroke stays while the sound is heard, then lifts
    setTimeout(() => { if (t.el) { t.el.classList.remove('hit'); updateMeta(); } }, Math.max(900, Math.min(12000, t.buffer ? t.buffer.duration * 1000 : 400)));
  }, Math.max(0, (when - ctx.currentTime) * 1000));
}
function stopSources(t) { if (t.st) t.st.sources.forEach(s => { try { s.stop(); } catch (e) {} }); }
function resetTrack(t, now) { stopSources(t); t.hits = []; t.st = t.buffer ? { next: firstTime(t, now), sources: new Set() } : null; }
function tick() {
  if (!cur) return;
  const until = ctx.currentTime + LOOKAHEAD;
  cur.tracks.forEach(t => {
    if (!t.st || !t.buffer) return;
    // a hiccup on one sound must not stop the others
    try { pump(t, t.st, ctx, t.nodes.gain, until, true); } catch (e) { t.st.next = ctx.currentTime + 1; }
  });
  $('clock').textContent = fmt(ctx.currentTime - startedAt);
}
async function start() {
  if (!cur || !cur.tracks.some(t => t.buffer)) { toast('Add a sound first', { kind: 'info' }); return; }
  cur.tracks.forEach(stopTrackTest);   // stop the previews, or they would play over the mix
  stopPreview();
  setLib(false);
  stopToken++;
  await ctx.resume();
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(cur.volume, ctx.currentTime);
  const now = ctx.currentTime + 0.1;
  startedAt = now;
  cur.tracks.forEach(t => resetTrack(t, now));
  playing = true;
  clearInterval(timer); timer = setInterval(tick, 250); tick();
  setPlayUI();
}
function stop() {
  playing = false; clearInterval(timer);
  const token = ++stopToken, c = cur;
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  setTimeout(() => {
    if (token !== stopToken) return;
    if (c) c.tracks.forEach(t => { stopSources(t); t.st = null; cutTails(t, true); });
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(c ? c.volume : 0.8, ctx.currentTime);
  }, 450);
  setPlayUI();
}
function hardStop() {
  playing = false; clearInterval(timer); stopToken++;
  if (cur) cur.tracks.forEach(t => { stopSources(t); t.st = null; });
  setPlayUI();
}
/* where each sound is in its own time, said under its name */
let progRAF = null;
const baseDur = t => t.missing ? 'missing' : t.buffer ? fmt(t.buffer.duration) : '…';
function updateProg(t, now) {
  if (!t.el) return;
  const lab = t.el.querySelector('.dur');
  let txt = baseDur(t);
  const h = t.pv || (playing ? (t.hits || []).filter(x => x.start <= now).pop() : null);
  if (h) {
    const e = now - h.start;
    if (e < 0) { /* about to start */ }
    else if (h.loop) { const pos = e % h.loop; txt = `${fmt(pos)} / ${fmt(h.loop)}`; }
    else if (e < h.dur) { txt = `${fmt(e)} / ${fmt(h.dur)}`; }
  }
  if (lab.textContent !== txt) lab.textContent = txt;
  // a sound that comes back now and then says when it is next due
  const nx = t.el.querySelector('.next');
  if (!nx) return;
  let when = '';
  if (playing && !t.pv && t.mode !== 'loop' && t.st && effectiveGain(t) > 0 && !(h && now - h.start < h.dur)) {
    const s = t.st.next - now;
    if (s > 1.5 && s < 36000) when = s < 60 ? `next in about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `next in about ${plural(Math.round(s / 60), 'minute', 'minutes')}`;
  }
  if (nx.textContent !== when) nx.textContent = when;
}
function progLoop() {
  if (cur) { const now = ctx.currentTime; cur.tracks.forEach(t => updateProg(t, now)); }
  progRAF = (playing || (cur && cur.tracks.some(x => x.pv))) ? requestAnimationFrame(progLoop) : null;
}
function setPlayUI() {
  if (playing && !progRAF) progRAF = requestAnimationFrame(progLoop);
  if (!playing && cur) cur.tracks.forEach(t => updateProg(t, ctx.currentTime));
  // the icons are SVGs: the attribute has to change, not the property
  $('icoPlay').toggleAttribute('hidden', playing); $('icoStop').toggleAttribute('hidden', !playing);
  $('playBtn').classList.toggle('playing', playing);
  $('immPlay').classList.toggle('playing', playing);
  $('vEditor').classList.toggle('playing', playing);
  $('imm').classList.toggle('playing', playing);
  setPlayState();
  $('playBtn').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('immIcoPlay').toggleAttribute('hidden', playing); $('immIcoStop').toggleAttribute('hidden', !playing);
  $('immPlay').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  if (!playing) $('clock').textContent = '0:00';
  updateLive();
}

/* ---------- previews ---------- */
let pv = null, pvTok = 0;   // preview in progress: { key, btn, stop }
function setPvBtn(b, on) { const g = b.querySelector('.pglyph') || b; g.innerHTML = on ? ICO.stop : ICO.play; b.classList.toggle('on', on); b.title = on ? 'Stop' : 'Listen'; b.setAttribute('aria-pressed', on); }
function stopPreview() {
  pvTok++;
  if (!pv) return;
  const p = pv; pv = null;
  try { p.stop(); } catch (e) {}
  if (p.btn) setPvBtn(p.btn, false);
}
// Library previews use a lightweight player: it starts at once, even with long files,
// and doesn't keep the decoded audio in memory.
async function togglePreview(path, btn) {
  const key = 'lib:' + path;
  if (pv && pv.key === key) { stopPreview(); return; }
  stopPreview();
  const tok = pvTok;
  let url;
  try { url = URL.createObjectURL(await readFile(path)); } catch (e) { toast('Couldn\'t read this file'); return; }
  if (tok !== pvTok) { URL.revokeObjectURL(url); return; }   // something else was chosen meanwhile
  const a = new Audio(url); a.volume = 0.8;
  pv = { key, btn, stop: () => { a.pause(); a.removeAttribute('src'); URL.revokeObjectURL(url); } }; setPvBtn(btn, true);
  a.onended = () => { if (pv && pv.key === key) stopPreview(); };
  a.play().catch(() => { if (pv && pv.key === key) { stopPreview(); toast('Couldn\'t play this file'); } });
}
function toggleFsPreview(s, btn) {
  const key = 'fs:' + s.id;
  if (pv && pv.key === key) { stopPreview(); return; }
  stopPreview();
  const a = new Audio(s.previews['preview-hq-mp3']); a.volume = 0.8;
  a.play().catch(() => { toast('Couldn\'t play this sound from Freesound. Check your internet connection.', { kind: 'warn' }); stopPreview(); });
  pv = { key, btn, stop: () => { a.pause(); a.removeAttribute('src'); } }; setPvBtn(btn, true);
  a.onended = () => { if (pv && pv.key === key) stopPreview(); };
}
/* Preview of a single sound: the ▶ button lights up, press it again to stop.
   It goes through the sound's own volume, position and filters, so you can adjust them while listening
   (even when the sound is muted or another one is soloed). */
function setTestBtn(t, el = t.el) {
  const b = el && el.querySelector('.test');
  if (!b) return;
  b.classList.toggle('on', !!t.pv);
  b.querySelector('.pglyph').innerHTML = t.pv ? ICO.stop : ICO.play;
  b.title = t.pv ? 'Stop' : t.buffer ? 'Listen to this sound on its own, over and over, while you adjust it' : t.missing ? 'The file is missing' : 'Getting it ready…';
  // said out loud as well as shown, for anyone listening to the page rather than looking at it
  b.setAttribute('aria-pressed', !!t.pv);
  b.setAttribute('aria-label', t.pv ? 'Stop listening to this sound on its own' : 'Listen to this sound on its own');
}
function stopTrackTest(t) {
  if (!t.pv) return;
  const p = t.pv; t.pv = null;
  try { p.src.stop(); } catch (e) {}
  setTimeout(() => { try { p.g.disconnect(); } catch (e) {} }, 100);
  // its echo and its space stop with it, unless the composition is playing and the same lines carry its sound there
  if (!playing) cutTails(t);
  setTestBtn(t);
  updateProg(t, ctx.currentTime);
}
function trackTest(t) {
  if (t.pv) { stopTrackTest(t); return; }
  if (!t.buffer || !cur) return;
  cur.tracks.forEach(x => { if (x !== t) stopTrackTest(x); });
  ctx.resume();
  const g = ctx.createGain(); g.gain.value = t.volume;
  g.connect(t.nodes.fxIn);
  const seam = isSeamless(t), buf = seam ? t.loopBuf : t.buffer;
  const src = ctx.createBufferSource(), when = ctx.currentTime + 0.02;
  src.buffer = buf;
  // The preview repeats until you stop it. While you are adjusting volume, position or an effect,
  // the sound has to still be there — otherwise every change means pressing play again.
  src.loop = true;
  const tp = seam ? (src.connect(g), null) : trajConnect(t, ctx, src, g, when, buf.duration, buf.duration);
  src.start(when);
  t.pv = { src, g, start: when, dur: Infinity, loop: buf.duration };
  src.onended = () => { if (tp && tp.osc) try { tp.osc.stop(); } catch (e) {} if (t.pv && t.pv.src === src) stopTrackTest(t); };
  setTestBtn(t);
  if (!progRAF) progRAF = requestAnimationFrame(progLoop);
}

/* ---------- WAV export ---------- */
function encodeWav(ab) {
  const ch = ab.numberOfChannels, len = ab.length, sr = ab.sampleRate, bytes = len * ch * 2;
  const v = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([v], { type: 'audio/wav' });
}
async function exportMix() {
  if (!cur || !cur.tracks.some(t => t.buffer)) { toast('Add a sound first', { kind: 'info' }); return; }
  const c = cur, title = $('title').value.trim() || 'Untitled';
  const btn = $('exBtn'), st = $('exStatus'), busy = $('exBusy');
  btn.disabled = true; st.textContent = ''; busy.hidden = false;
  await new Promise(r => setTimeout(r, 30));
  try {
    const secs = +$('exDur').value * 60, sr = ctx.sampleRate, vol = c.volume;
    const off = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
    const m = off.createGain(); limitTo(off, m);
    if ($('exFade').checked) {
      const f = Math.min(4, secs / 4);
      m.gain.setValueAtTime(0, 0); m.gain.linearRampToValueAtTime(vol, f);
      m.gain.setValueAtTime(vol, secs - f); m.gain.linearRampToValueAtTime(0, secs);
    } else m.gain.value = vol;
    c.tracks.forEach(t => {
      if (!t.buffer) return;
      const ch = buildChain(t, off, m);
      pump(t, { next: firstTime(t, 0), sources: null }, off, ch.gain, secs, false);
    });
    const rendered = await off.startRendering();
    const p = await freeName(DIR.exports, slug(title), '.wav');
    await writeFile(p, encodeWav(rendered));
    const where = `Saved in your folder: exports › ${p.split('/').pop()}`;
    // it may have finished after you left the composition: say so wherever you are now
    if (cur === c) st.textContent = where; else toast(`“${title}” exported to your exports folder`);
  } catch (e) {
    if (cur === c) st.textContent = 'Couldn\'t create the file. Try a shorter length.';
    else toast(`Couldn't export “${title}”. Open it and try a shorter length.`, { kind: 'warn' });
  }
  busy.hidden = true;
  btn.disabled = false;
}
