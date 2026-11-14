/* αtmos — shared ground. The app is a set of plain scripts that share one scope, loaded in order by
   index.html; this one comes first. It holds what every part uses: the state of the app (the chosen
   folder, the sounds, the compositions, the open one), the folders inside the chosen one, small
   helpers, messages at the foot of the window, changing screen, the stars, the icons, the app's own
   dialog, sliders, and the parallax of the sky. */

const $ = id => document.getElementById(id);

const AUDIO_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i;
const LOOKAHEAD = 3;
// Folders the mixer keeps inside the folder you choose.
const DIR = { sounds: 'sounds', freesound: 'sounds/freesound', comps: 'compositions', covers: 'covers', trackImages: 'covers/sounds', presets: 'presets', exports: 'exports' };
const CREDITS = DIR.freesound + '/credits.txt';

let root = null;        // the chosen folder
let library = [];       // [{path, name}]
let audioPaths = new Set();   // every audio file in the folder, to spot a sound whose file has gone
let comps = [];         // [{file, data, coverUrl, mod}]
let cur = null;         // the open composition
let playing = false, timer = null, startedAt = 0, stopToken = 0;
const buffers = new Map();

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = x => Math.round(x * 100) / 100;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const pick = (v, obj, d) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(obj, v) ? v : d;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cssUrl = u => `url("${String(u).replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")`;
/* A message at the bottom of the window. With an action (Undo…) it stays longer and can be clicked.
   Its kind picks the icon: done (the default), info, or warn. Every "Couldn't…" is a warning, and
   warnings are announced at once. A message replacing one still on screen cross-fades with it. */
let toastT = null;
function toast(msg, opts) {
  const o = opts || {}, t = $('toast'), act = $('toastAct');
  const kind = o.kind || (/^Couldn't/.test(msg) ? 'warn' : 'done');
  if (t.classList.contains('show')) {
    const ghost = t.cloneNode(true);
    ghost.removeAttribute('id'); ghost.removeAttribute('role'); ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    ghost.classList.remove('show'); ghost.classList.add('leave');
    ghost.addEventListener('animationend', () => ghost.remove());
    setTimeout(() => ghost.remove(), 400);
    t.after(ghost);
  }
  t.classList.remove('show', 'leave');
  t.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
  t.dataset.kind = kind;
  $('toastIco').innerHTML = ICO[kind === 'warn' ? 'alert' : kind === 'info' ? 'info' : 'check'];
  $('toastMsg').textContent = msg;
  act.hidden = !o.action;
  t.classList.toggle('has-act', !!o.action);
  if (o.action) { act.textContent = o.action; act.onclick = () => { hideToast(); o.onAction(); }; }
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, o.ms || (o.action ? 8000 : 3400));
}
function hideToast() {
  clearTimeout(toastT);
  const t = $('toast');
  if (!t.classList.contains('show')) return;
  t.classList.remove('show');
  t.classList.add('leave');
}
/* keep the action's padding while it fades, so the pill doesn't change shape on its way out */
$('toast').addEventListener('animationend', e => {
  if (e.animationName === 'toast-out') e.currentTarget.classList.remove('leave', 'has-act');
});
const VIEWS = ['vWelcome', 'vHome', 'vEditor'];
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Changing screen. A screen is made complete while it is still hidden (see openComp); only then does the
   one that leaves fade into the night, and the new one fades in after it, never over it, so two
   screens are never seen through each other. The new screen is in place at once, so focus and
   everything else can go straight to it. */
function show(v) {
  const prev = VIEWS.find(id => !$(id).hidden);
  const fade = prev && prev !== v && !calm() && !document.documentElement.classList.contains('booting');
  if (fade) ghostOut($(prev));
  VIEWS.forEach(id => { $(id).hidden = id !== v; $(id).inert = false; $(id).classList.remove('after'); });
  $('foot').hidden = v === 'vEditor'; $('sky').dataset.view = v; bootSay.end();
  if (prev !== v) { const el = $(v); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); if (fade) el.classList.add('after'); }
  window.scrollTo(0, 0);
}
VIEWS.forEach(id => $(id).addEventListener('animationend', e => { if (e.target.id === id && e.animationName === 'screen-in') e.target.classList.remove('enter'); }));
function ghostOut(sec) {
  const r = sec.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const g = sec.cloneNode(true);
  const from = sec.querySelectorAll('input, select'), to = g.querySelectorAll('input, select');
  from.forEach((s, i) => { if (!to[i]) return; if (s.type === 'checkbox') to[i].checked = s.checked; else if (s.type !== 'file') to[i].value = s.value; });
  g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  g.querySelectorAll('img[hidden]').forEach(n => n.removeAttribute('src'));   // a picture not on show is not fetched again
  g.querySelectorAll('[role="status"],[aria-live]').forEach(n => { n.removeAttribute('role'); n.removeAttribute('aria-live'); });
  g.querySelectorAll('.enter').forEach(n => n.classList.remove('enter'));   // rows still arriving stay where they are
  g.classList.remove('enter', 'after'); g.classList.add('ghost-screen');
  g.setAttribute('aria-hidden', 'true'); g.inert = true;
  Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
  document.body.appendChild(g);
  const end = () => g.remove();
  g.addEventListener('animationend', e => { if (e.target === g) end(); }); setTimeout(end, 500);
}
/* The thin gold line at the top of the window: the pen, drawing while something is being read.
   It appears only if reading takes longer than a moment, so a quick change never flickers; once it
   has appeared, done() lets it finish its stroke before the next screen shows. set(p) makes it
   fill (0–1); without a value, it sweeps. */
const loadline = {
  t: null,
  start(p) {
    const el = $('loadline');
    clearTimeout(this.t);
    el.classList.toggle('indet', p == null);
    el.style.setProperty('--p', p == null ? 0 : p);
    this.t = setTimeout(() => el.classList.add('show'), 200);
  },
  set(p) { const el = $('loadline'); el.classList.remove('indet'); el.style.setProperty('--p', Math.max(0, Math.min(1, p))); },
  get shown() { return $('loadline').classList.contains('show'); },
  // resolves once the stroke has reached the end (at once if the line never appeared)
  done() {
    clearTimeout(this.t);
    const el = $('loadline');
    el.classList.remove('indet');
    el.style.setProperty('--p', 1);
    if (!el.classList.contains('show')) return Promise.resolve();
    return new Promise(r => setTimeout(() => { el.classList.remove('show'); r(); }, calm() ? 0 : 340));
  }
};
/* Coming back to αtmos with the folder still open to it, nothing is shown until the screen it returns to is
   complete: the list, or the composition named in the address. Meanwhile there is only the night; if it
   takes more than a moment, the gold line draws along the top and a few words in the middle of the
   window say what is being read (with Cancel while a composition is being opened). */
const bootSay = {
  t: null,
  start(text) {
    $('bootSayText').textContent = text;
    clearTimeout(this.t);
    this.t = setTimeout(() => $('bootSay').classList.add('show'), 200);
  },
  // the words fade while the gold line finishes its stroke, so they are gone before the screen arrives
  end() { clearTimeout(this.t); $('bootSay').classList.remove('show'); $('bootCancel').hidden = true; }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
/* The first screen is shown only once it is complete and its type has arrived; then it fades in. */
let revealed = false;
async function reveal() {
  if (revealed) return;
  revealed = true;
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  requestAnimationFrame(() => document.documentElement.classList.remove('booting'));
}
/* The distant stars: drawn once into two tiles, which the sky and immersion repeat and drift.
   Mostly paper-white, a few warm, a few cool; the brighter ones carry a little bloom. */
function starTile(w, h, n, rMin, rMax, aMin, aMax, bloom) {
  const d = Math.min(2, window.devicePixelRatio || 1), c = document.createElement('canvas');
  c.width = Math.round(w * d); c.height = Math.round(h * d);
  const g = c.getContext('2d'); g.scale(d, d);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, k = Math.pow(Math.random(), 2.4);
    const r = rMin + k * (rMax - rMin), a = aMin + Math.random() * (aMax - aMin), pick = Math.random();
    const rgb = pick < 0.12 ? '243,214,150' : pick < 0.2 ? '196,200,236' : '240,234,222';
    if (bloom && k > 0.55) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 7);
      gr.addColorStop(0, `rgba(${rgb},${a * 0.32})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
    }
    g.fillStyle = `rgba(${rgb},${a})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c.toDataURL('image/png');
}
try {
  const s = document.documentElement.style;
  s.setProperty('--stars-far', `url(${starTile(900, 700, 150, 0.35, 0.9, 0.18, 0.55, false)})`);
  s.setProperty('--stars-near', `url(${starTile(1300, 1000, 46, 0.6, 1.45, 0.35, 0.85, true)})`);
} catch (e) {}

/* icons: Lucide 0.460.0 (lucide.dev), ISC licence, copied in so the app makes no request for them.
   Copyright (c) Lucide Contributors 2022, portions Cole Bemis 2013-2022 (Feather, MIT); the notice is in
   THIRD-PARTY-NOTICES.md. Drawn at a 1.5 stroke; play, stop and a kept sound are the same outlines filled. */
const svg = (d, o = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"') => `<svg viewBox="0 0 24 24" ${o} aria-hidden="true">${d}</svg>`;
const FILLED = 'fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const ICO = {
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>', FILLED),                              // play
  stop: svg('<rect width="18" height="18" x="3" y="3" rx="2"/>', FILLED + ' class="i-stop"'),  // square
  keep: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),              // bookmark
  keepOn: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>', FILLED),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'), // trash-2
  link: svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'),                                  // arrow-up-right
  box: svg('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'), // archive
  check: svg('<path d="M20 6 9 17l-5-5"/>'),                                                  // check
  alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'), // triangle-alert
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),     // info
  vol: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>'), // volume-2
  volX: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'), // volume-x
  sliders: svg('<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'), // sliders-horizontal
  chev: svg('<path d="m6 9 6 6 6-6"/>'),                                                       // chevron-down
  grip: svg('<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>') // grip-vertical
};

/* ---------- the app's own dialog ----------
   The browser's confirm() box cannot name the files, cannot offer a third, gentler choice, and
   confirms on Enter. Every question the app asks uses this instead.
   opts: { title, body (html), files:[], danger, actions:[{label, kind, value, icon}] }
   Resolves with the chosen action's value, or null if cancelled. */
function dialog(opts) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
      <h2>${esc(opts.title)}</h2>
      ${opts.body || ''}
      ${opts.files && opts.files.length ? `<div class="files">${opts.files.map(f => `<div>${ICO.trash}<span>${esc(f)}</span></div>`).join('')}</div>` : ''}
      ${opts.after || ''}
      ${opts.danger ? `<p class="danger-line">${ICO.alert}<span>${esc(opts.danger)}</span></p>` : ''}
      <div class="acts"></div></div>`;
    const acts = scrim.querySelector('.acts');
    (opts.actions || []).forEach(a => {
      if (a.spacer) { const s = document.createElement('span'); s.className = 'spacer'; acts.appendChild(s); return; }
      const b = document.createElement('button');
      b.className = a.kind || 'ghost';
      b.innerHTML = (a.icon ? a.icon : '') + `<span>${esc(a.label)}</span>`;
      b._value = a.value;
      b.onclick = () => done(a.value);
      acts.appendChild(b);
    });
    const done = v => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      if (prev && prev.isConnected) try { prev.focus(); } catch (e) {}
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key !== 'Tab') return;
      // the keyboard stays inside the dialog while it is open
      const f = [...scrim.querySelectorAll('button')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    };
    scrim.onclick = e => { if (e.target === scrim) done(null); };
    document.addEventListener('keydown', onKey, true);
    $('dialogs').appendChild(scrim);
    // the focus starts on the safe choice, so pressing Enter out of habit never destroys anything
    const want = opts.focus != null && [...scrim.querySelectorAll('.acts button')].find(b => b._value === opts.focus);
    const safe = want || scrim.querySelector('.acts button:not(.danger)') || scrim.querySelector('.acts button');
    if (safe) safe.focus();
  });
}
const confirmDlg = (title, body, okLabel, o) => dialog(Object.assign({
  title, body: body ? `<p>${body}</p>` : '',
  actions: [{ label: 'Cancel', kind: 'quiet', value: null }, { label: okLabel, kind: 'danger fill', value: true }]
}, o || {})).then(v => v === true);
/* sliders: the filled part shows the value; "position" fills outwards from the centre */
function paintRange(el) {
  const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, p = max > min ? (el.value - min) / (max - min) * 100 : 0;
  const center = el.classList.contains('pan');
  el.style.setProperty('--a', (center ? Math.min(50, p) : 0) + '%');
  el.style.setProperty('--b', (center ? Math.max(50, p) : p) + '%');
}
const paintRanges = (el = document) => el.querySelectorAll('input[type=range]').forEach(paintRange);
document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); }, true);

/* the width of the page's scrollbar, for anything that spans the window (0 where scrollbars take no room) */
{
  const root = document.documentElement;
  const sbw = () => root.style.setProperty('--sbw', Math.max(0, innerWidth - root.clientWidth) + 'px');
  sbw();
  if ('ResizeObserver' in window) new ResizeObserver(sbw).observe(root); else window.addEventListener('resize', sbw);
}
/* parallax: the lights in the sky shift a little with the pointer and with scrolling, each depth by a different amount */
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let waiting = false, px = 0, py = 0;
  const apply = () => { waiting = false; const s = $('sky').style; s.setProperty('--px', px.toFixed(3)); s.setProperty('--py', py.toFixed(3)); s.setProperty('--sy', String(Math.round(scrollY)));
    $('imm').style.setProperty('--px', px.toFixed(3)); $('imm').style.setProperty('--py', py.toFixed(3)); };
  const ask = () => { if (!waiting) { waiting = true; requestAnimationFrame(apply); } };
  window.addEventListener('pointermove', e => { px = e.clientX / innerWidth * 2 - 1; py = e.clientY / innerHeight * 2 - 1; ask(); }, { passive: true });
  window.addEventListener('scroll', ask, { passive: true });
}


/* Comets: now and then one glides down across the night, behind welcome, the catalogue and immersion (behind
   the picture there, under the weather), never on a composition, where the night stands still. One at a time,
   the first some seconds after the app opens, then one every half a minute to a minute; about one in four is
   a far one, fainter and slower. None with reduced motion, none while the tab is hidden, none while the
   picture fills the whole immersion window (there is no night to see). The look is in app.css (.comet). */
let cometLive = null;
function comet(far = Math.random() < 0.25) {
  if (cometLive || calm() || document.hidden || document.documentElement.classList.contains('booting')) return null;
  const imm = $('imm'), inImm = !imm.hidden;
  if (inImm) { const bg = $('immBg'); if (bg && bg.classList.contains('fill')) return null; }
  else if ($('sky').dataset.view === 'vEditor') return null;
  const box = inImm ? imm.querySelector('.imm-stars') : $('sky').querySelector(far ? '.far' : '.near');
  if (!box) return null;
  const W = innerWidth, H = innerHeight, r = box.getBoundingClientRect(), rnd = (a, b) => a + Math.random() * (b - a);
  // it keeps to open sky: never across words set straight on the night (the title card, the bar, the heading,
  // the caption), with 16px to spare; behind a printed panel it may pass, dimmed by the stock
  const words = [...document.querySelectorAll(inImm ? '.imm-caption, .imm-scene, .imm-close'
    : $('sky').dataset.view === 'vHome' ? '#vHome .bar > *, #vHome .home-head > *, #vHome .tools > *, .foot' : '.welcome > *, .welcome-foot .fine')]
    .map(e => e.getBoundingClientRect()).filter(q => q.width && q.height);
  const crosses = (x0, y0, x1, y1) => { for (let k = 0, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8); k <= n; k++) {
    const px = x0 + (x1 - x0) * k / n, py = y0 + (y1 - y0) * k / n;
    if (words.some(q => px > q.left - 16 && px < q.right + 16 && py > q.top - 16 && py < q.bottom + 16)) return true; } return false; };
  // in immersion it sets out from the night around the picture and may glide on behind it, never start hidden
  let pic = null;
  const bg = inImm && $('immBg');
  if (bg && bg.naturalWidth) {
    const q = bg.getBoundingClientRect(), k = Math.min(q.width / bg.naturalWidth, q.height / bg.naturalHeight), w = bg.naturalWidth * k, h = bg.naturalHeight * k;
    pic = { left: q.left + (q.width - w) / 2, top: q.top + (q.height - h) / 2, right: q.left + (q.width + w) / 2, bottom: q.top + (q.height + h) / 2 };
  }
  const hidden = (px, py) => pic && px > pic.left && px < pic.right && py > pic.top && py < pic.bottom;
  let left, tilt, len, tail, x, y, clear = false, tries = 0;
  do {
    if (++tries > 24) return null;                                       // no open sky this time: wait for the next
    left = Math.random() < 0.5; tilt = rnd(14, 30);                       // degrees under the horizon
    len = far ? rnd(150, 240) : rnd(280, 460); tail = far ? rnd(70, 110) : rnd(130, 210);
    x = left ? rnd(0.35, 0.95) * W : rnd(0.05, 0.65) * W; y = rnd(0.05, 0.45) * H;
    const dx = Math.cos(tilt * Math.PI / 180) * (left ? -1 : 1), dy = Math.sin(tilt * Math.PI / 180);
    clear = !crosses(x - dx * tail, y - dy * tail, x + dx * len, y + dy * len) && !hidden(x, y) && !hidden(x + dx * len * 0.4, y + dy * len * 0.4);
  } while (!clear);
  const c = document.createElement('span');
  c.className = 'comet' + (far ? ' far' : ''); c.setAttribute('aria-hidden', 'true'); c.appendChild(document.createElement('b'));
  const d = far ? rnd(2.6, 3.4) : rnd(1.8, 2.5);
  c.style.cssText = `left:${(x - r.left - tail).toFixed(1)}px;top:${(y - r.top - (far ? 0.5 : 1)).toFixed(1)}px;--tail:${tail.toFixed(0)}px;--len:${len.toFixed(0)}px;`
    + `--a:${(left ? 180 - tilt : tilt).toFixed(1)}deg;--d:${d.toFixed(2)}s;--o:${(far ? rnd(0.45, 0.6) : rnd(0.8, 1)).toFixed(2)}`;
  const done = () => { clearTimeout(t); c.remove(); if (cometLive === c) cometLive = null; };
  // also when it is cut short: hidden with its screen, its animations end without a word; one still held stays
  const sweep = () => { if (c.getAnimations({ subtree: true }).some(x => x.playState === 'paused')) t = setTimeout(sweep, 1000); else done(); };
  let t = setTimeout(sweep, d * 1000 + 400);
  c.addEventListener('animationend', e => { if (e.animationName === 'comet-light') done(); });
  box.appendChild(c); cometLive = c;
  return c;
}
(function nextComet(first) {
  setTimeout(() => { comet(); nextComet(false); }, (first ? 6 + Math.random() * 8 : 24 + Math.random() * 36) * 1000);
})(true);
