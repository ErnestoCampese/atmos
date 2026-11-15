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
/* ---------- filters ---------- */
const FILTERS = [
  ['reverb', 'Space', 'The sound fills a space and lingers after it stops, as in a hall or a cave'],
  ['echo', 'Echo', 'Repeats that bounce left and right and slowly die away'],
  ['muffled', 'Muffled', 'Takes the brightness away: far off, behind a window, under water'],
  ['thin', 'Thin', 'Takes the weight away: lighter, airier, further from you'],
  ['waves', 'Rise and fall', 'Slowly louder and softer on its own, like breathing'],
  ['movement', 'Movement', 'Drifts slowly from side to side, all the time'],
  ['trajectory', 'Passing by', 'Each time it plays, it moves across like something passing; the slider sets how far']
];
/* Words instead of percentages: you do not have to know what 42% of a reverb sounds like. */
const fxWord = v => v === 0 ? 'Off' : v < 34 ? 'A little' : v < 67 ? 'Medium' : 'Strong';
/* Ready-made places. Each one simply sets the sliders below, so nothing new happens to the sound —
   it is the same seven effects, chosen for you. */
const noFx = () => ({ reverb: 0, echo: 0, muffled: 0, thin: 0, waves: 0, movement: 0, trajectory: 0 });
const place = (fx, revType, echoType) => ({ fx: Object.assign(noFx(), fx), revType: revType || 'cathedral', echoType: echoType || 'valley' });
/* The first is not a place but the way back: every effect off, the reverb and echo types left as they are. */
const PLACES = [
  ['none', 'No effects', { fx: noFx() }],
  ['near', 'A step away', place({ reverb: 22, muffled: 12 }, 'room')],
  // distance and height are told by tone, as the ear tells them: far is duller, lighter and more in the air than
  // near; what is above has lost its weight; what is below has lost its brightness and rings in the space under you
  ['far', 'Far away', place({ muffled: 44, thin: 40, reverb: 46 }, 'hall')],
  ['above', 'High above', place({ thin: 58, reverb: 26 }, 'hall')],
  ['below', 'Down below', place({ muffled: 58, reverb: 38 }, 'hall')],
  ['window', 'Behind a window', place({ muffled: 66, reverb: 20, thin: 12 }, 'room')],
  ['hall', 'In a big room', place({ reverb: 48 }, 'hall')],
  ['cathedral', 'In a cathedral', place({ reverb: 76 }, 'cathedral')],
  ['cave', 'In a cave', place({ reverb: 60, muffled: 26, echo: 16 }, 'cave', 'near')],
  ['valley', 'Across a valley', place({ echo: 46, reverb: 34, muffled: 38 }, 'hall', 'valley')],
  ['water', 'Under water', place({ muffled: 86, waves: 28, reverb: 24 }, 'cave')],
  ['around', 'Drifting around you', place({ movement: 56, waves: 24, reverb: 20 }, 'hall')]
];
const placeOf = t => {
  const hit = PLACES.find(([, , p]) =>
    FILTER_KEYS.every(k => (t.fx[k] || 0) === p.fx[k]) && (!p.fx.reverb || t.revType === p.revType) && (!p.fx.echo || t.echoType === p.echoType));
  return hit ? hit[0] : null;
};
/* Reverb spaces. rt = seconds for the tail to die away completely,
   pre = delay before the tail, dark = how much sooner the highs die away (rock walls),
   er = close early reflections (nearby walls). */
const ECHOES = { near: { label: 'Near', time: 0.18 }, valley: { label: 'Valley', time: 0.42 }, mountain: { label: 'Mountain', time: 0.85 } };
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
  n.revSend.connect(conv); conv.connect(n.pan);
  const old = n.conv; n.conv = conv;
  if (old) { try { n.revSend.disconnect(old); } catch (e) {} setTimeout(() => { try { old.disconnect(); } catch (e) {} }, 300); }
}
function buildChain(t, context, dest) {
  const n = {};
  n.gain = context.createGain(); n.gain.gain.value = effectiveGain(t);
  n.lp = context.createBiquadFilter(); n.lp.type = 'lowpass'; n.lp.Q.value = 0.5;
  n.hp = context.createBiquadFilter(); n.hp.type = 'highpass'; n.hp.Q.value = 0.5;
  n.trem = context.createGain();
  n.dry = context.createGain();
  n.revSend = context.createGain();
  n.dlSend = context.createGain();
  n.dL = context.createDelay(3); n.dR = context.createDelay(3);
  n.dampL = context.createBiquadFilter(); n.dampL.type = 'lowpass'; n.dampL.frequency.value = 3200;
  n.dampR = context.createBiquadFilter(); n.dampR.type = 'lowpass'; n.dampR.frequency.value = 3200;
  n.fbL = context.createGain(); n.fbR = context.createGain();
  n.echoMerge = context.createChannelMerger(2);
  n.pan = context.createStereoPanner(); n.pan.pan.value = t.pan;
  n.gain.connect(n.lp); n.lp.connect(n.hp); n.hp.connect(n.trem);
  n.trem.connect(n.dry); n.dry.connect(n.pan);
  n.trem.connect(n.revSend); setReverbType(t, n, context);
  // "ping-pong" echo: left → right → left…, each repeat a little darker and quieter
  n.trem.connect(n.dlSend); n.dlSend.connect(n.dL);
  n.dL.connect(n.dampL); n.dampL.connect(n.fbL); n.fbL.connect(n.dR);
  n.dR.connect(n.dampR); n.dampR.connect(n.fbR); n.fbR.connect(n.dL);
  n.dL.connect(n.echoMerge, 0, 0); n.dR.connect(n.echoMerge, 0, 1); n.echoMerge.connect(n.pan);
  n.pan.connect(dest);
  // slow oscillators for "Waves" (volume) and "Movement" (stereo)
  n.tremLfo = context.createOscillator(); n.tremLfo.frequency.value = 0.11; n.tremDepth = context.createGain();
  n.tremLfo.connect(n.tremDepth); n.tremDepth.connect(n.trem.gain); n.tremLfo.start();
  n.panLfo = context.createOscillator(); n.panLfo.frequency.value = 0.06; n.panDepth = context.createGain();
  n.panLfo.connect(n.panDepth); n.panDepth.connect(n.pan.pan); n.panLfo.start();
  n.fxIn = n.lp;
  applyFx(t, n, context, true);
  return n;
}
function applyFx(t, n = t.nodes, context = ctx, now) {
  const f = k => (t.fx[k] || 0) / 100;
  const set = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, context.currentTime, 0.08); };
  set(n.lp.frequency, 20000 * Math.pow(250 / 20000, f('muffled')));
  set(n.hp.frequency, 20 * Math.pow(1500 / 20, f('thin')));
  set(n.revSend.gain, f('reverb') * 1.6);
  set(n.dry.gain, 1 - f('reverb') * 0.65);
  const ed = (ECHOES[t.echoType] || ECHOES.valley).time;
  set(n.dL.delayTime, ed); set(n.dR.delayTime, ed);
  set(n.dlSend.gain, f('echo') * 1.3);
  set(n.fbL.gain, 0.45 + f('echo') * 0.25); set(n.fbR.gain, 0.45 + f('echo') * 0.25);
  set(n.trem.gain, 1 - f('waves') * 0.45);
  set(n.tremDepth.gain, f('waves') * 0.45);
  set(n.panDepth.gain, f('movement') * 0.9);
}
function disposeChain(n) {
  try { n.tremLfo.stop(); n.panLfo.stop(); } catch (e) {}
  try { n.pan.disconnect(); } catch (e) {}
}
function fxValueText(t, k) {
  const v = t.fx[k] || 0;
  if (k !== 'trajectory') return fxWord(v);
  if (!v) return 'Off';
  const how = v >= 100 ? 'Side to side' : v >= 70 ? 'Wide' : v >= 35 ? 'Halfway' : 'Slight';
  return how + (t.trajRand ? ', random' : '');
}
const fxCount = t => Object.values(t.fx).filter(v => v > 0).length;
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
/* Trajectory: on every repeat the sound travels across the stereo space */
const TRAJ = { lr: 'Left to right', rl: 'Right to left', pp: 'Back and forth' };
function trajectory(t) {
  const w = (t.fx.trajectory || 0) / 100;
  if (!w) return null;
  let dir = t.trajDir, k = 1;
  if (t.trajRand) { dir = Math.random() < 0.5 ? 'lr' : 'rl'; k = 0.6 + Math.random() * 0.4; }
  else if (dir === 'pp') { t.ppFlip = !t.ppFlip; dir = t.ppFlip ? 'lr' : 'rl'; }
  return dir === 'lr' ? { from: -w * k, to: w * k } : { from: w * k, to: -w * k };
}
// connects the source to its destination, going (if needed) through a pan that moves while the sound plays
function trajConnect(t, context, node, dest, when, d, loopLen) {
  const tr = trajectory(t);
  if (!tr) { node.connect(dest); return null; }
  const p = context.createStereoPanner();
  if (loopLen) {
    // seamless loop (∞): sways gently back and forth, one crossing per lap
    const osc = context.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 1 / (2 * loopLen);
    const depth = context.createGain(); depth.gain.value = tr.to;
    osc.connect(depth); depth.connect(p.pan); osc.start(when);
    p.osc = osc;
  } else {
    p.pan.setValueAtTime(tr.from, when);
    p.pan.linearRampToValueAtTime(tr.to, when + d);
  }
  node.connect(p); p.connect(dest);
  return p;
}
function playOne(t, context, dest, when, sources) {
  if (isSeamless(t)) {
    const src = context.createBufferSource(); src.buffer = t.loopBuf; src.loop = true;
    const tp = trajConnect(t, context, src, dest, when, 0, t.loopBuf.duration);
    src.start(when);
    if (sources) { sources.add(src); src.onended = () => { sources.delete(src); if (tp && tp.osc) try { tp.osc.stop(); } catch (e) {} }; noteHit(t, when, Infinity, t.loopBuf.duration); }
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
// Random: the sound never overlaps itself. After it ends there is always a pause
// (at least 1–5 s) of unpredictable length that, on average, respects the chosen frequency.
function randomPause(t) {
  const a = avgGap(t), minP = Math.max(1, Math.min(5, a * 0.2));
  const mean = Math.max(minP, a - (t.buffer ? t.buffer.duration : 0));
  return Math.min(mean * 4, Math.max(minP, -Math.log(1 - Math.random()) * mean));
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
    if (c) c.tracks.forEach(t => { stopSources(t); t.st = null; });
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
  const tp = trajConnect(t, ctx, src, g, when, buf.duration, buf.duration);
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
