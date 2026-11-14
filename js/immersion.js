/* αtmos — immersion: the full-window picture, its weather of particles, and its controls. */

/* ---------- immersion mode ---------- */
function sprite(r, g, b, soft) {
  const s = document.createElement('canvas'); s.width = s.height = 64;
  const c = s.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  if (!soft) gr.addColorStop(0.22, `rgba(${r},${g},${b},.55)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  return s;
}
const SPR_WARM = sprite(255, 214, 150), SPR_WHITE = sprite(255, 255, 255), SPR_FOG = sprite(225, 230, 235, true);
const rnd = (a, b) => a + Math.random() * (b - a);

const FX = {
  fireflies: { label: 'Fireflies', n: 45, blend: 'lighter',
    init(p, w, h, first) { p.x0 = rnd(0, w); p.y = first ? rnd(0, h) : h + 20; p.v = rnd(10, 32); p.r = rnd(5, 13); p.ph = rnd(0, 6.3); p.amp = rnd(10, 40); p.t = 0; p.h = h; },
    step(p, dt) { p.t += dt; p.y -= p.v * dt; p.x = p.x0 + Math.sin(p.t * 0.45 + p.ph) * p.amp; return p.y > -30; },
    draw(c, p) { const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.t * 1.4 + p.ph * 2)); c.globalAlpha = tw * Math.min(1, p.y / (p.h * 0.3)); c.drawImage(SPR_WARM, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); } },
  rain: { label: 'Rain', n: 170,
    init(p, w, h, first) { p.x = rnd(-w * 0.1, w * 1.05); p.y = first ? rnd(0, h) : rnd(-60, -10); p.l = rnd(10, 26); p.v = rnd(520, 860); p.a = rnd(0.1, 0.3); p.h = h; },
    step(p, dt) { p.y += p.v * dt; p.x += p.v * 0.12 * dt; return p.y < p.h + 30; },
    draw(c, p) { c.globalAlpha = p.a; c.strokeStyle = '#d6e2f0'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.l * 0.12, p.y - p.l); c.stroke(); } },
  snow: { label: 'Snow', n: 110,
    init(p, w, h, first) { p.x0 = rnd(0, w); p.y = first ? rnd(0, h) : -10; p.v = rnd(16, 48); p.r = rnd(2.5, 7); p.ph = rnd(0, 6.3); p.amp = rnd(12, 40); p.a = rnd(0.45, 0.9); p.t = 0; p.h = h; },
    step(p, dt) { p.t += dt; p.y += p.v * dt; p.x = p.x0 + Math.sin(p.t * 0.6 + p.ph) * p.amp; return p.y < p.h + 10; },
    draw(c, p) { c.globalAlpha = p.a; c.drawImage(SPR_WHITE, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); } },
  stars: { label: 'Stars', n: 130, blend: 'lighter',
    init(p, w, h, first) { p.x = rnd(0, w); p.y = first ? rnd(0, h) : h + 10; p.r = rnd(2, 6); p.sp = rnd(0.4, 1.4); p.ph = rnd(0, 6.3); p.v = rnd(2, 7); p.t = 0; },
    step(p, dt) { p.t += dt; p.y -= p.v * dt; return p.y > -10; },
    draw(c, p) { c.globalAlpha = 0.12 + 0.88 * Math.pow(0.5 + 0.5 * Math.sin(p.t * p.sp + p.ph), 3); c.drawImage(SPR_WHITE, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); } },
  fog: { label: 'Fog', n: 7,
    init(p, w, h, first) { p.r = w * rnd(0.25, 0.5); p.x = first ? rnd(-p.r, w) : -p.r; p.y = h * rnd(0.3, 1); p.v = rnd(6, 16); p.a = rnd(0.06, 0.12); p.w = w; },
    step(p, dt) { p.x += p.v * dt; return p.x - p.r < p.w; },
    draw(c, p) { c.globalAlpha = p.a; c.drawImage(SPR_FOG, p.x - p.r, p.y - p.r * 0.6, p.r * 2, p.r * 1.2); } }
};

let fxRAF = null, fxParts = [], fxDef = null, fxLast = 0, fxW = 0, fxH = 0, immOpen = false, idleT = null;
function fxCtx() { return $('immFx').getContext('2d'); }
// sized from the immersion layer itself (not the window, which includes a scrollbar), plus the
// parallax margin on every side
function sizeFx() {
  const c = $('immFx'), d = Math.min(2, window.devicePixelRatio || 1), el = $('imm');
  const pad = parseFloat(getComputedStyle(el).getPropertyValue('--fx-pad')) || 0;
  fxW = el.clientWidth + 2 * pad; fxH = el.clientHeight + 2 * pad;
  c.width = Math.round(fxW * d); c.height = Math.round(fxH * d);
  fxCtx().setTransform(d, 0, 0, d, 0, 0);
}
function stopFx() { cancelAnimationFrame(fxRAF); fxRAF = null; }
function startFx(name) {
  stopFx(); sizeFx();
  const c = fxCtx(); c.clearRect(0, 0, fxW, fxH);
  fxDef = Object.prototype.hasOwnProperty.call(FX, name) ? FX[name] : null;
  if (!fxDef) return;
  const k = Math.min(1.6, Math.max(0.5, fxW * fxH / (1440 * 900)));
  fxParts = Array.from({ length: Math.round(fxDef.n * k) }, () => { const p = {}; fxDef.init(p, fxW, fxH, true); return p; });
  fxLast = performance.now();
  if (calm() && STILL_FX.has(name)) { drawFx(c, 0); return; }
  fxRAF = requestAnimationFrame(fxLoop);
}
/* With reduced motion: rain, snow and fireflies are one still frame; fog and stars move at a tenth of their speed. */
const STILL_FX = new Set(['rain', 'snow', 'fireflies']);
function drawFx(c, dt) {
  c.clearRect(0, 0, fxW, fxH);
  c.globalCompositeOperation = fxDef.blend || 'source-over';
  for (const p of fxParts) { if (!fxDef.step(p, dt)) fxDef.init(p, fxW, fxH, false); fxDef.draw(c, p); }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
}
function fxLoop(t) {
  const dt = Math.min(0.05, (t - fxLast) / 1000) * (calm() ? 0.1 : 1); fxLast = t;
  drawFx(fxCtx(), dt);
  fxRAF = requestAnimationFrame(fxLoop);
}
function renderFxChips() {
  const el = $('fxChips'); el.innerHTML = '';
  [['', 'None'], ...Object.entries(FX).map(([k, v]) => [k, v.label])].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', (cur.effect || '') === k);
    b.textContent = label;
    b.onclick = () => { cur.effect = k; renderFxChips(); startFx(k); markDirty(); };
    el.appendChild(b);
  });
}
/* A pale picture would swallow the title and the play button: the scrim deepens for one. */
function immPale(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const g = c.getContext('2d');
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return false;
    g.drawImage(img, w * 0.25, h * 0.25, w * 0.5, h * 0.5, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    return s / (d.length / 4) > 140;
  } catch (e) { return false; }
}
/* The picture and its blurred backdrop are made only when there is a picture to show. */
function immImg(id, slot, cls) {
  let im = $(id);
  if (!im) { im = document.createElement('img'); im.id = id; im.className = cls; im.alt = ''; im.decoding = 'async'; $(slot).appendChild(im); }
  return im;
}
function setImmBg() {
  const url = cur.bgUrl || cur.coverUrl;
  if (!url) { ['immBg', 'immBlur'].forEach(id => { const x = $(id); if (x) x.remove(); }); $('imm').classList.remove('pale'); }
  else {
    const bg = immImg('immBg', 'immBgSlot', 'imm-bg'), blur = immImg('immBlur', 'immBlurSlot', 'imm-blur');
    if (bg.getAttribute('src') !== url) {
      bg.onload = () => $('imm').classList.toggle('pale', immPale(bg));
      bg.src = url; blur.src = url;
    }
    bg.classList.toggle('fill', !!cur.fill);
    bg.classList.toggle('pixel', !!cur.pixel);
    blur.hidden = !!cur.fill;
  }
  $('immFillBtn').setAttribute('aria-pressed', !!cur.fill);
  $('immPixelBtn').setAttribute('aria-pressed', !!cur.pixel);
  $('immCoverBtn').hidden = !(cur.bgUrl && cur.coverUrl);
}
function wake() {
  $('imm').classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (immOpen) $('imm').classList.add('idle'); }, 2800);
}
let immWaiting = false;
async function openImmersion() {
  if (!cur || immOpen || immWaiting) return;
  // the picture is drawn before immersion fades in, so it never opens on an empty frame;
  // a picture that takes a while shows the gold line, and is not waited on for ever
  const me = cur;
  setImmBg();
  const bg = $('immBg');
  if (bg && !(bg.complete && bg.naturalWidth)) {
    immWaiting = true;
    loadline.start();
    await Promise.race([bg.decode().catch(() => {}), wait(3000)]);
    await loadline.done();
    immWaiting = false;
    if (cur !== me || immOpen || $('vEditor').hidden) return;
    $('imm').classList.toggle('pale', immPale(bg));
  }
  immOpen = true;
  const el = $('imm');
  $('immTitle').textContent = $('title').value.trim() || 'Untitled';
  el.setAttribute('aria-label', 'Immersion: ' + ($('title').value.trim() || 'Untitled'));
  document.querySelector('.wrap').inert = true;     // the page behind is out of reach while immersion is open
  $('immDesc').textContent = cur.description || '';
  setImmMenu(false);
  setMasterUI();
  setImmBg(); renderFxChips();
  immScroll = scrollY;
  document.documentElement.classList.add('imm-lock');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  startFx(cur.effect);
  wake();
  // the keyboard comes with you: focus lands on play and stays inside until you leave
  immReturn = document.activeElement;
  setTimeout(() => { try { $('immPlay').focus(); } catch (e) {} }, 60);
  if (!playing) start();
}
let immReturn = null, immScroll = 0;
function immFocusables() {
  return [...$('imm').querySelectorAll('button:not([hidden]):not([disabled]), input:not([disabled])')]
    .filter(x => x.offsetParent !== null || x === document.activeElement);
}
function closeImmersion() {
  if (!immOpen) return;
  immOpen = false;
  const el = $('imm');
  el.classList.remove('show', 'idle');
  document.querySelector('.wrap').inert = false;
  clearTimeout(idleT);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.documentElement.classList.remove('imm-lock');
  window.scrollTo(0, immScroll);            // the editor is exactly where it was left
  if (immReturn && immReturn.isConnected) try { immReturn.focus(); } catch (e) {}
  immReturn = null;
  setTimeout(() => { if (!immOpen) { el.hidden = true; stopFx(); } }, 700);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Full screen isn\'t available here', { kind: 'warn' }));
}
// a library preview stops as soon as you click outside the list of results
document.addEventListener('pointerdown', e => { if (pv && !e.target.closest('.libList')) stopPreview(); });
$('immBtn').onclick = openImmersion;
$('immExit').onclick = closeImmersion;
$('immPlay').onclick = () => playing ? stop() : start();
$('immVol').oninput = e => {
  cur.volume = e.target.value / 100;
  master.gain.setTargetAtTime(cur.volume, ctx.currentTime, 0.05); setMasterUI(); markDirty();
};
$('immFsBtn').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', () => { const on = !!document.fullscreenElement; $('immFsBtn').querySelector('span').textContent = on ? 'Leave full screen' : 'Full screen'; });
$('immBgBtn').onclick = () => $('immBgIn').click();
$('immFillBtn').onclick = () => { cur.fill = !cur.fill; setImmBg(); markDirty(); };
$('immPixelBtn').onclick = () => { cur.pixel = !cur.pixel; setImmBg(); markDirty(); };
$('immBgIn').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !cur) return;
  if (!isImage(f)) return notAPicture();
  if (cur.bgUrl) URL.revokeObjectURL(cur.bgUrl);
  cur.bgPending = f; cur.bgUrl = URL.createObjectURL(f);
  setImmBg(); markDirty();
};
$('immCoverBtn').onclick = () => { cur.bgUrl = null; cur.bgPending = null; cur.background = null; setImmBg(); markDirty(); };
['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach(ev => $('imm').addEventListener(ev, wake, { passive: true }));
document.addEventListener('keydown', e => {
  if (!immOpen) return;
  wake();                                   // any key brings the controls back, as moving the mouse does
  if (e.key === 'Escape') { if (!$('immSet').hidden) { setImmMenu(false); $('immSetBtn').focus(); return; } closeImmersion(); return; }
  if (e.key !== 'Tab') return;
  const f = immFocusables();
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  e.preventDefault();
  f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
}, true);
if ('ResizeObserver' in window) new ResizeObserver(() => { if (immOpen && fxDef) startFx(cur.effect); }).observe($('imm'));
else window.addEventListener('resize', () => { if (immOpen && fxDef) startFx(cur.effect); });
