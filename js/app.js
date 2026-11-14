(() => {
const $ = id => document.getElementById(id);
const AC = window.AudioContext || window.webkitAudioContext;
const ctx = new AC();
const master = ctx.createGain();
master.connect(ctx.destination);

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
function show(v) { ['vWelcome', 'vHome', 'vEditor'].forEach(id => $(id).hidden = id !== v); $('atmo').hidden = v !== 'vEditor'; $('sky').dataset.view = v; window.scrollTo(0, 0); }

/* icons */
const svg = (d, o = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"') => `<svg viewBox="0 0 24 24" ${o} aria-hidden="true">${d}</svg>`;
const ICO = {
  play: svg('<path d="M8 5.5v13l11-6.5z"/>', 'fill="currentColor"'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', 'fill="currentColor"'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>'),
  imageOff: svg('<path d="M3 5.4V20h14.6"/><path d="M7 4h14v14"/><path d="m21 16-5-5-3 3"/><path d="M3.5 3.5l17 17"/>'),
  keep: svg('<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>'),
  keepOn: svg('<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>', 'fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  link: svg('<path d="M8 16 16 8M9 8h7v7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  pencil: svg('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>'),
  box: svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>'),
  undo: svg('<path d="M4 9h11a5 5 0 0 1 0 10H9M4 9l4-4M4 9l4 4"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>', 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'),
  alert: svg('<path d="M12 4.5 2.8 20h18.4z"/><path d="M12 10v4M12 17.2v.3"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  loop: svg('<path d="M7.5 9.5a3.2 3.2 0 1 1 0 5 15 15 0 0 1-2-2.5 15 15 0 0 0-2-2.5 3.2 3.2 0 1 0 0 5"/><path d="M16.5 9.5a3.2 3.2 0 1 1 0 5 15 15 0 0 1-2-2.5 15 15 0 0 0-2-2.5 3.2 3.2 0 1 0 0 5" transform="translate(-4.5)"/>'),
  grip: '<svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>'
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
    const safe = scrim.querySelector('.acts button:not(.danger)') || scrim.querySelector('.acts button');
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
  const apply = () => { waiting = false; const s = $('sky').style; s.setProperty('--px', px.toFixed(3)); s.setProperty('--py', py.toFixed(3)); s.setProperty('--sy', String(Math.round(scrollY))); $('atmo').style.setProperty('--sy', String(Math.round(scrollY)));
    $('imm').style.setProperty('--px', px.toFixed(3)); $('imm').style.setProperty('--py', py.toFixed(3)); };
  const ask = () => { if (!waiting) { waiting = true; requestAnimationFrame(apply); } };
  window.addEventListener('pointermove', e => { px = e.clientX / innerWidth * 2 - 1; py = e.clientY / innerHeight * 2 - 1; ask(); }, { passive: true });
  window.addEventListener('scroll', ask, { passive: true });
}

/* curves for smooth (equal-power) fades */
const N = 64, CIN = new Float32Array(N), COUT = new Float32Array(N);
for (let i = 0; i < N; i++) { const x = i / (N - 1); CIN[i] = Math.sin(x * Math.PI / 2); COUT[i] = Math.cos(x * Math.PI / 2); }
const scaled = (base, k) => { if (k === 1) return base; const c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = base[i] * k; return c; };

/* ---------- browser storage: only remembers the folder and the Freesound key ---------- */
const kv = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('atmos', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  op(mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise(res => {
      try { const r = fn(this.db.transaction('kv', mode).objectStore('kv')); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
      catch (e) { res(null); }
    });
  },
  get(k) { return this.op('readonly', s => s.get(k)); },
  put(k, v) { return this.op('readwrite', s => s.put(v, k)); }
};

/* ---------- files in the folder ---------- */
async function dirAt(path, create = true) {
  let d = root;
  for (const p of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create });
  return d;
}
function split(path) { const parts = path.split('/'); const name = parts.pop(); return [parts.join('/'), name]; }
async function readFile(path) { const [d, n] = split(path); return (await (await dirAt(d, false)).getFileHandle(n)).getFile(); }
async function writeFile(path, data) {
  const [d, n] = split(path);
  const fh = await (await dirAt(d, true)).getFileHandle(n, { create: true });
  const w = await fh.createWritable(); await w.write(data); await w.close();
}
async function exists(path) { try { await readFile(path); return true; } catch (e) { return false; } }
async function freeName(dir, base, ext) { let p = `${dir}/${base}${ext}`, i = 2; while (await exists(p)) p = `${dir}/${base}-${i++}${ext}`; return p; }
function loadBuffer(path) {
  if (buffers.has(path)) return buffers.get(path);
  // keep the promise, so a file used by several sounds is decoded only once
  const p = readFile(path).then(f => f.arrayBuffer()).then(ab => ctx.decodeAudioData(ab));
  buffers.set(path, p);
  p.catch(() => { if (buffers.get(path) === p) buffers.delete(path); });
  return p;
}

/* ---------- libraries made with the earlier Italian version ----------
   That version used Italian folder names and Italian keys in its saved files.
   Such a folder is converted once, when it is opened; saved files written in the old
   format are still understood when read (upgradeComp / upgradeTrack). */
const LEGACY_DIRS = [['suoni', 'sounds'], ['copertine', 'covers'], ['preset', 'presets'], ['esportazioni', 'exports'], ['composizioni', 'compositions']];
const LEGACY_NAMES = { 'copertine/suoni': 'sounds', 'suoni/freesound/crediti.txt': 'credits.txt' };
const LEGACY_PATHS = [[/^copertine\/suoni\//, 'covers/sounds/'], [/^suoni\//, 'sounds/'], [/^copertine\//, 'covers/'], [/^preset\//, 'presets/'], [/^composizioni\//, 'compositions/'], [/^esportazioni\//, 'exports/']];
const legacyPath = p => { if (typeof p !== 'string') return p; for (const [re, to] of LEGACY_PATHS) if (re.test(p)) return p.replace(re, to); return p; };
const L_MODE = { continuo: 'loop', intervallo: 'interval', casuale: 'random' };
const L_FILTER = { riverbero: 'reverb', eco: 'echo', ovattato: 'muffled', sottile: 'thin', onde: 'waves', movimento: 'movement', traiettoria: 'trajectory' };
const L_SPACE = { stanza: 'room', sala: 'hall', cattedrale: 'cathedral', grotta: 'cave' };
const L_ECHO = { vicino: 'near', valle: 'valley', montagna: 'mountain' };
const L_EFFECT = { lucciole: 'fireflies', pioggia: 'rain', neve: 'snow', stelle: 'stars', nebbia: 'fog' };
function upgradeTrack(j) {
  if (!j || typeof j !== 'object' || !['nome', 'modo', 'filtri', 'posizione'].some(k => k in j)) return j;
  const filters = {};
  for (const [k, v] of Object.entries(j.filtri && typeof j.filtri === 'object' ? j.filtri : {})) filters[L_FILTER[k] || k] = v;
  const im = j.immagine && typeof j.immagine === 'object' ? j.immagine : null;
  return { file: legacyPath(j.file), name: j.nome, volume: j.volume, pan: j.posizione, mode: L_MODE[j.modo] || 'loop',
    crossfade: j.dissolvenza, crossfadeSeconds: j.secondiDissolvenza, everySeconds: j.ogniSecondi, times: j.volte, periodSeconds: j.periodoSecondi,
    varyPitch: j.variaTono, varyVolume: j.variaVolume ?? j.variaTono, hitFade: j.dissolvenzaColpo, filters,
    reverbType: L_SPACE[j.tipoRiverbero], echoType: L_ECHO[j.tipoEco], trajectoryDirection: j.direzioneTraiettoria, trajectoryRandom: j.traiettoriaCasuale,
    seamlessLoop: j.loopPerfetto, image: im && { id: im.id, local: legacyPath(im.local), url: im.url }, muted: j.muto, solo: j.solo };
}
function upgradeComp(d) {
  if (!d || typeof d !== 'object' || !['nome', 'tracce', 'versione', 'volumeGenerale'].some(k => k in d)) return d;
  const im = d.immersione && typeof d.immersione === 'object' ? d.immersione : {};
  return { version: 2, name: d.nome, cover: legacyPath(d.copertina), masterVolume: d.volumeGenerale,
    immersion: { effect: im.effetto in L_EFFECT ? L_EFFECT[im.effetto] : im.effetto, background: legacyPath(im.sfondo), pixelArt: im.pixelArt, fill: im.riempi },
    tracks: Array.isArray(d.tracce) ? d.tracce.map(upgradeTrack) : [] };
}
async function findLegacyDirs(h) {
  const out = [];
  for (const pair of LEGACY_DIRS) { try { await h.getDirectoryHandle(pair[0]); out.push(pair); } catch (e) {} }
  return out;
}
// Copies each Italian folder into its English one, checks every file, and only then removes the old folder.
// It is safe to run again if it gets interrupted.
async function convertLegacyFolder(h, dirs, onFile) {
  const rewrite = async (path, file) => {
    // saved files are rewritten in the current format; anything unreadable is copied as it is
    if (!/\.json$/i.test(path) || !/^(composizioni|preset)\//.test(path)) return file;
    try {
      const data = JSON.parse(await file.text());
      if (path.startsWith('preset/')) {
        const j = upgradeTrack(data);
        if (!validTrack(j)) return file;
        return new Blob([JSON.stringify(Object.assign(toJson(fromJson(j)), { name: String(j.name || ''), version: 2 }), null, 2)]);
      }
      const c = cleanComp(data);
      return c ? new Blob([JSON.stringify(Object.assign({}, c, { tracks: c.tracks.map(t => toJson(fromJson(t))) }), null, 2)]) : file;
    } catch (e) { return file; }
  };
  const copyTree = async (src, dst, rel) => {
    for await (const [name, entry] of src.entries()) {
      const path = rel + '/' + name, newName = LEGACY_NAMES[path] || name;
      if (entry.kind === 'directory') { await copyTree(entry, await dst.getDirectoryHandle(newName, { create: true }), path); continue; }
      const file = await entry.getFile(), data = await rewrite(path, file);
      const out = await dst.getFileHandle(newName, { create: true });
      const w = await out.createWritable(); await w.write(data); await w.close();
      if ((await out.getFile()).size !== data.size) throw new Error('copy check failed: ' + path);
      onFile();
    }
  };
  for (const [from, to] of dirs) {
    await copyTree(await h.getDirectoryHandle(from), await h.getDirectoryHandle(to, { create: true }), from);
    await h.removeEntry(from, { recursive: true });
  }
}
// One-time: carry over the folder and Freesound key remembered by the Italian version of the page.
async function importOldSettings() {
  try {
    if (!indexedDB.databases || !(await indexedDB.databases()).some(d => d.name === 'mixer-atmosfere-v2')) return;
    const old = await new Promise((res, rej) => { const r = indexedDB.open('mixer-atmosfere-v2'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const get = k => new Promise(res => { try { const r = old.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } });
    for (const k of ['root', 'fsKey']) { const v = await get(k); if (v != null) await kv.put(k, v); }
    old.close();
  } catch (e) {}
}

/* ---------- start-up and choosing the folder ---------- */
async function boot() {
  show('vWelcome');
  if (!('showDirectoryPicker' in window)) { $('unsupported').hidden = false; $('pickBtn').disabled = true; return; }
  await kv.open();
  if (await kv.get('root') == null && await kv.get('fsKey') == null) await importOldSettings();
  fsKey = await kv.get('fsKey'); updateFsUI();
  const h = await kv.get('root');
  if (h) {
    $('reopenName').textContent = h.name; $('reopenBtn').hidden = false;
    // a returning visitor should not be read the instructions for a first visit
    $('welcomeLead').innerHTML = `Welcome back. Your compositions are in the folder <b>${esc(h.name)}</b>.
      <br><br>For your privacy, the browser asks you to open that folder again each time you come here.`;
    $('welcomeFine').hidden = true;
    $('pickBtn').textContent = 'Choose another folder'; $('pickBtn').className = 'ghost lg';
    setTimeout(() => { try { $('reopenBtn').focus(); } catch (e) {} }, 0);
    $('reopenBtn').onclick = async () => {
      try { if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') await useFolder(h); }
      catch (e) { toast('Couldn\'t open that folder. Choose it again.'); }
    };
    // if the browser still remembers the permission, reopen the folder straight away
    try { if (h.queryPermission && await h.queryPermission({ mode: 'readwrite' }) === 'granted') await useFolder(h); } catch (e) {}
  }
}
async function pickFolder() {
  try { await useFolder(await window.showDirectoryPicker({ id: 'mixer', mode: 'readwrite' })); }
  catch (e) { if (e.name !== 'AbortError') toast('Couldn\'t open that folder'); }
}
async function useFolder(h) {
  const legacy = await findLegacyDirs(h);
  if (legacy.length) {
    const ok = await dialog({
      title: 'This folder was made with the earlier Italian version',
      body: `<p>To use it here, its folders need their English names (suoni → sounds, composizioni → compositions,
        copertine → covers…). All your sounds, compositions and images are kept.</p>`,
      actions: [{ label: 'Not now', kind: 'quiet', value: false }, { label: 'Convert this folder', kind: 'primary', value: true }]
    });
    if (!ok) { toast('Nothing was changed. Choose a different folder to continue.', { kind: 'warn' }); return; }
    show('vWelcome');
    let n = 0;
    const st = $('welcomeStatus'); st.hidden = false; st.textContent = 'Converting your library…';
    try { await convertLegacyFolder(h, legacy, () => { st.textContent = `Converting your library… ${plural(++n, 'file', 'files')} done`; }); }
    catch (e) { st.textContent = 'The conversion stopped part-way. No files were lost: open the folder again to finish it.'; return; }
    st.hidden = true;
  }
  root = h; buffers.clear();
  await kv.put('root', h);
  for (const d of [DIR.sounds, DIR.comps, DIR.covers, DIR.presets]) await root.getDirectoryHandle(d, { create: true });
  $('folderName').textContent = h.name;
  await scanLibrary(); await loadComps(); renderHome(); show('vHome');
  // coming back to an address that names a composition reopens it
  const want = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const c = want && comps.find(x => compId(x) === want);
  if (c) openComp(c, true);
}

// a name like "my recording.wav.mp3" should read "my recording", not "my recording.wav"
const stripExt = s => String(s).replace(/\.[^.]+$/, '').replace(/\.(wav|aiff?|mp3|flac|ogg|oga|m4a|aac|opus)$/i, '');
async function scanLibrary() {
  const out = [], fromFs = [];
  audioPaths = new Set();
  const walk = async (dir, prefix) => {
    for await (const [name, h] of dir.entries()) {
      const fsDir = prefix === DIR.sounds + '/' && name === 'freesound';
      if (h.kind === 'directory') { await walk(h, prefix + name + '/'); continue; }
      if (!AUDIO_RE.test(name)) continue;
      const path = prefix + name;
      audioPaths.add(path);
      // sounds fetched from Freesound are listed too, under their own heading, so one can be used again
      (prefix === DIR.freesound + '/' ? fromFs : out).push({ path, name: stripExt(name), fs: prefix === DIR.freesound + '/' });
    }
  };
  await walk(await dirAt(DIR.sounds), DIR.sounds + '/');
  out.sort((a, b) => a.path.localeCompare(b.path));
  fromFs.sort((a, b) => a.name.localeCompare(b.name));
  // saved sounds: one JSON file each, in the presets folder
  const pre = [];
  for await (const [name, h] of (await dirAt(DIR.presets)).entries()) {
    if (h.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
    try {
      const data = upgradeTrack(JSON.parse(await (await h.getFile()).text()));
      if (validTrack(data)) pre.push({ preset: true, path: DIR.presets + '/' + name, name: String(data.name || name.replace(/\.json$/i, '')), data });
    } catch (e) {}
  }
  pre.sort((a, b) => a.name.localeCompare(b.name));
  library = [...pre, ...out, ...fromFs];
}
const presetImgs = new Map();   // image path → address ready to display
function presetImage(item, row) {
  const img = cleanImg(item.data.image);
  if (!img) return;
  const bg = document.createElement('div'); bg.className = 'libg';
  row.classList.add('has-img'); row.prepend(bg);
  const paint = url => { bg.style.backgroundImage = cssUrl(url); };
  if (img.url) return paint(img.url);
  if (presetImgs.has(img.local)) return paint(presetImgs.get(img.local));
  readFile(img.local).then(f => { const u = URL.createObjectURL(f); presetImgs.set(img.local, u); paint(u); })
    .catch(() => { row.classList.remove('has-img'); bg.remove(); });
}

/* ---------- list of compositions ---------- */
// Brings a saved composition into a known shape (and into the current format, if it is an old one).
function cleanComp(raw) {
  const d = upgradeComp(raw);
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const im = d.immersion && typeof d.immersion === 'object' ? d.immersion : {};
  const str = v => typeof v === 'string' && v ? v : null;
  const out = { version: 2, name: typeof d.name === 'string' ? d.name : '', cover: str(d.cover), masterVolume: num(d.masterVolume, 0.8, 0, 1),
    // "archived" is optional and new: a file written before it existed simply counts as not archived
    archived: !!d.archived,
    immersion: { effect: typeof im.effect === 'string' ? im.effect : 'fireflies', background: str(im.background), pixelArt: !!im.pixelArt, fill: !!im.fill },
    tracks: (Array.isArray(d.tracks) ? d.tracks : []).map(upgradeTrack).filter(validTrack) };
  // "description" is optional too: a file without one has none
  const desc = typeof d.description === 'string' ? d.description.replace(/\s+/g, ' ').trim() : '';
  if (desc) out.description = desc;
  return out;
}
async function loadComps() {
  comps.forEach(c => { if (c.coverUrl) URL.revokeObjectURL(c.coverUrl); });   // release the covers of the previous list
  const list = [];
  for await (const [name, h] of (await dirAt(DIR.comps)).entries()) {
    if (h.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
    try {
      const f = await h.getFile();
      const data = cleanComp(JSON.parse(await f.text()));
      if (!data) continue;
      let coverUrl = null;
      if (data.cover) { try { coverUrl = URL.createObjectURL(await readFile(data.cover)); } catch (e) {} }
      list.push({ file: DIR.comps + '/' + name, data, coverUrl, mod: f.lastModified });
    } catch (e) {}
  }
  comps = list.sort((a, b) => b.mod - a.mod);
}
/* A composition with no picture of its own gets one of four inks, chosen from its name. */
const coverIdx = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 9973; return h % 4; };
function editedText(ms) {
  if (!ms) return '';
  const d = new Date(ms), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return 'edited today';
  if (diff === 1) return 'edited yesterday';
  if (diff < 7) return `edited ${diff} days ago`;
  return 'edited ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
const missingCount = c => c.data.tracks.filter(t => audioPaths.size && !audioPaths.has(t.file)).length;

function renderHome() {
  const el = $('cards'); el.innerHTML = '';
  const live = comps.filter(c => !c.data.archived), arch = comps.filter(c => c.data.archived);
  $('homeEmpty').hidden = live.length > 0;
  $('homeEmptyText').textContent = arch.length
    ? 'Everything you have is archived. Restore one below, or make a new composition.'
    : 'Nothing here yet. Make your first composition, give it a name, then add sounds to it.';
  live.forEach(c => el.appendChild(cardEl(c)));
  renderArchive(arch);
}
function cardEl(c) {
  const n = c.data.name || 'Untitled', k = c.data.tracks.length, miss = missingCount(c);
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.c = coverIdx(n);
  card.innerHTML = `<button class="open" aria-label="Open ${esc(n)}">
      <span class="frame"><span class="halo"></span><span class="art">${c.coverUrl ? `<img src="${c.coverUrl}" alt="">` : `<span>${esc(n.charAt(0).toUpperCase())}</span>`}</span></span>
    </button>
    <div class="meta">
      <button class="title-open" tabindex="-1">
        <strong class="${c.data.name ? '' : 'untitled'}" title="${esc(n)}">${esc(n)}</strong>
        <small>${plural(k, 'sound', 'sounds')}${c.mod ? ' · ' + esc(editedText(c.mod)) : ''}</small>
        ${miss ? `<small class="warn-line">${esc(plural(miss, 'sound', 'sounds'))} missing</small>` : ''}
      </button>
      <button class="more" aria-haspopup="true" aria-label="More actions for ${esc(n)}">${ICO.more}</button>
    </div>`;
  if (c.coverUrl) card.querySelector('.halo').style.setProperty('--img', cssUrl(c.coverUrl));
  card.querySelector('.open').onclick = () => openComp(c);
  card.querySelector('.title-open').onclick = () => openComp(c);
  const more = card.querySelector('.more');
  more.onclick = e => { e.stopPropagation(); openCardMenu(c, card, more); };
  card.oncontextmenu = e => { e.preventDefault(); openCardMenu(c, card, more); };
  card.addEventListener('keydown', e => {
    if (e.target.closest('input')) return;
    const k = e.key;
    if (k === 'F2') { e.preventDefault(); startRename(c, card); }
    else if (k === 'Delete' && e.shiftKey) { e.preventDefault(); deleteForever(c); }
    else if (k === 'Delete') { e.preventDefault(); setArchived(c, true); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); duplicateComp(c); }
    else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) { e.preventDefault(); openCardMenu(c, card, more); }
  });
  return card;
}
function renderArchive(arch) {
  const box = $('arch'), list = $('archList');
  box.hidden = !arch.length;
  if (!arch.length) return;
  $('archCount').textContent = arch.length;
  try { box.open = localStorage.getItem('atmos-archive-open') === '1'; } catch (e) {}
  box.ontoggle = () => { try { localStorage.setItem('atmos-archive-open', box.open ? '1' : '0'); } catch (e) {} };
  list.innerHTML = '';
  arch.forEach(c => {
    const n = c.data.name || 'Untitled';
    const row = document.createElement('div');
    row.className = 'arch-item';
    row.dataset.c = coverIdx(n);
    row.innerHTML = `<span class="thumb">${c.coverUrl ? `<img src="${c.coverUrl}" alt="">` : `<span>${esc(n.charAt(0).toUpperCase())}</span>`}</span>
      <span class="an"><strong title="${esc(n)}">${esc(n)}</strong><small>${plural(c.data.tracks.length, 'sound', 'sounds')}${c.mod ? ' · ' + esc(editedText(c.mod)) : ''}</small></span>
      <button class="ghost sm restore">${ICO.undo}<span>Restore</span></button>
      <button class="quiet sm del-forever" style="color:var(--warn)">Delete forever…</button>`;
    row.querySelector('.restore').onclick = () => setArchived(c, false);
    row.querySelector('.del-forever').onclick = () => deleteForever(c);
    list.appendChild(row);
  });
}

/* ---------- managing a composition from the list ---------- */
let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
document.addEventListener('pointerdown', e => { if (openMenu && !e.target.closest('.menu')) closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);
function openCardMenu(c, card, btn) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  const items = [
    { label: 'Rename', icon: ICO.pencil, key: 'F2', run: () => startRename(c, card) },
    { label: 'Duplicate', icon: ICO.copy, key: 'Ctrl+D', run: () => duplicateComp(c) },
    { label: c.data.archived ? 'Restore' : 'Archive', icon: c.data.archived ? ICO.undo : ICO.box, run: () => setArchived(c, !c.data.archived) },
    { sep: true },
    { label: 'Delete forever…', icon: ICO.trash, danger: true, run: () => deleteForever(c) }
  ];
  items.forEach(it => {
    if (it.sep) { m.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.className = it.danger ? 'danger-item' : '';
    b.innerHTML = it.icon + `<span>${esc(it.label)}</span>` + (it.key ? `<span class="key">${it.key}</span>` : '');
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), h = m.offsetHeight;
  const host = (card || btn).getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, Math.max(host.left, r.right - m.offsetWidth))) + 'px';
  m.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6) + 'px';
  openMenu = m;
  const btns = [...m.querySelectorAll('button')];
  btns[0].focus();
  m.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); btn.focus(); }
  });
}
/* the title becomes a field in place; the saved file follows the title, as it does in the editor */
function startRename(c, card) {
  if (card.classList.contains('renaming')) return;
  const holder = card.querySelector('.title-open');
  const old = holder.innerHTML;
  card.classList.add('renaming');
  holder.innerHTML = `<input class="rename-in" value="${esc(c.data.name || '')}" aria-label="Name of the composition" spellcheck="false">
    <span class="rename-hint">Enter to save · Esc to cancel</span>`;
  const inp = holder.querySelector('input');
  inp.focus(); inp.select();
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    const name = inp.value.trim();
    card.classList.remove('renaming');
    holder.innerHTML = old;
    if (!ok || !name || name === c.data.name) return;
    const twin = comps.find(x => x !== c && (x.data.name || '') === name);
    await renameComp(c, name);
    renderHome();
    toast(`Renamed to “${name}”`);
    if (twin) setTimeout(() => toast(`You already have a composition called “${name}”.`, { ms: 6000, kind: 'info' }), 600);
  };
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  inp.onblur = () => finish(true);
}
// writes the file under a name made from the new title, exactly as the editor does
async function renameComp(c, name) {
  try {
    const data = Object.assign({}, c.data, { name });
    const oldFile = c.file;
    const oldBase = oldFile.split('/').pop().replace(/\.json$/i, ''), want = slug(name);
    const keep = oldBase === want || (oldBase.replace(/-\d+$/, '') === want && await exists(`${DIR.comps}/${want}.json`));
    const file = keep ? oldFile : await freeName(DIR.comps, want, '.json');
    await writeFile(file, JSON.stringify(data, null, 2));
    if (file !== oldFile) { const [d, n] = split(oldFile); try { await (await dirAt(d, false)).removeEntry(n); } catch (e) {} }
    c.file = file; c.data = data; c.mod = Date.now();
  } catch (e) { toast('Couldn\'t rename it. Check that the folder is still there.'); }
}
async function writeComp(c, data) {
  await writeFile(c.file, JSON.stringify(data, null, 2));
  c.data = data; c.mod = Date.now();
}
/* Archiving moves nothing and deletes nothing: the file gains one small marker. */
async function setArchived(c, on) {
  try {
    await writeComp(c, Object.assign({}, c.data, { archived: on }));
    renderHome();
    toast(`“${c.data.name || 'Untitled'}” ${on ? 'archived' : 'restored'}`,
      { action: 'Undo', onAction: () => setArchived(c, !on) });
    if (on) { const a = $('arch'); if (a && !a.open) a.open = true; }
  } catch (e) { toast('Couldn\'t change it. Check that the folder is still there.'); }
}
async function duplicateComp(c) {
  try {
    const name = (c.data.name || 'Untitled') + ' copy';
    const file = await freeName(DIR.comps, slug(name), '.json');
    const base = file.split('/').pop().replace(/\.json$/i, '');
    const data = Object.assign({}, c.data, { name, archived: false });
    // the copy gets its own picture files: deleting one composition must never strip another's cover
    data.cover = await copyAsset(c.data.cover, base);
    data.immersion = Object.assign({}, c.data.immersion, { background: await copyAsset(c.data.immersion.background, base + '-background') });
    await writeFile(file, JSON.stringify(data, null, 2));
    let coverUrl = null;
    if (data.cover) { try { coverUrl = URL.createObjectURL(await readFile(data.cover)); } catch (e) {} }
    const copy = { file, data, coverUrl, mod: Date.now() };
    comps.unshift(copy);
    renderHome();
    const card = [...$('cards').children].find(el => el.querySelector('strong').textContent === name);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); startRename(copy, card); }
    toast('Copied. Give the copy a name.');
  } catch (e) { toast('Couldn\'t copy it. Check that the folder is still there.'); }
}
async function copyAsset(path, base) {
  if (!path) return null;
  try {
    const f = await readFile(path);
    const ext = (path.match(/\.[^.]+$/) || ['.jpg'])[0].toLowerCase();
    const p = await freeName(DIR.covers, base, ext);
    await writeFile(p, f);
    return p;
  } catch (e) { return null; }
}
/* Deleting for good names every file it will remove, and offers the gentler choice instead. */
async function deleteForever(c) {
  const name = c.data.name || 'Untitled';
  const others = comps.filter(x => x !== c);
  const used = p => !!p && others.some(x => x.data.cover === p || x.data.immersion.background === p);
  const files = [c.file];
  if (c.data.cover && !used(c.data.cover)) files.push(c.data.cover);
  if (c.data.immersion.background && c.data.immersion.background !== c.data.cover && !used(c.data.immersion.background)) files.push(c.data.immersion.background);
  const shared = [c.data.cover, c.data.immersion.background].filter(p => p && used(p));
  const actions = [];
  if (!c.data.archived) actions.push({ label: 'Archive instead', kind: 'ghost', icon: ICO.box, value: 'archive' });
  else actions.push({ label: 'Keep it archived', kind: 'ghost', value: null });
  actions.push({ label: 'Cancel', kind: 'quiet', value: null }, { spacer: true }, { label: 'Delete forever', kind: 'danger fill', value: 'delete' });
  const ans = await dialog({
    title: `Delete “${name}” forever?`,
    body: `<p>This removes ${files.length === 1 ? 'one file' : plural(files.length, 'file', 'files')} from your folder:</p>`,
    files,
    after: `<p>Your sounds, your saved sounds and anything you have exported are not touched.${
      shared.length ? ' The picture it shares with another composition is kept.' : ''}</p>`,
    danger: 'This cannot be undone. A browser cannot send files to the recycle bin.',
    actions
  });
  if (ans === 'archive') return setArchived(c, true);
  if (ans !== 'delete') return;
  try {
    for (const p of files) { const [d, n] = split(p); try { await (await dirAt(d, false)).removeEntry(n); } catch (e) {} }
    if (c.coverUrl) URL.revokeObjectURL(c.coverUrl);
    comps = comps.filter(x => x !== c);
    renderHome();
    toast(`“${name}” was deleted.`);
  } catch (e) { toast('Couldn\'t delete it. Check that the folder is still there.'); }
}

/* ---------- a composition ---------- */
const blank = () => ({ file: null, name: '', description: '', cover: null, coverUrl: null, coverPending: null, volume: 0.8, tracks: [], dirty: false,
  archived: false, savedAt: 0,
  effect: 'fireflies', background: null, bgUrl: null, bgPending: null, pixel: false, fill: false });
const FILTER_KEYS = ['reverb', 'echo', 'muffled', 'thin', 'waves', 'movement', 'trajectory'];
const MODES = { loop: 'Continuous', interval: 'At intervals', random: 'Random' };
const defaults = (file, name) => ({ uid: uid(), file, name: name || file.split('/').pop().replace(/\.[^.]+$/, ''),
  volume: 0.7, pan: 0, mode: 'loop', crossfade: true, fade: 3, every: 10, count: 3, per: 60, varyPitch: false, varyVol: false, hitFade: 0,
  fx: { reverb: 0, echo: 0, muffled: 0, thin: 0, waves: 0, movement: 0, trajectory: 0 }, revType: 'cathedral', echoType: 'valley', trajDir: 'lr', trajRand: false,
  muted: false, solo: false, seamless: false, loopBuf: null, buffer: null, missing: false, img: null });
// only images you chose yourself (a file in the folder, or a pasted link)
const cleanImg = i => !i || typeof i !== 'object' || i.id ? null : typeof i.local === 'string' && i.local ? { local: i.local }
  : typeof i.url === 'string' && /^https?:\/\/\S+$/i.test(i.url) ? { url: i.url } : null;
const cleanFx = f => Object.fromEntries(FILTER_KEYS.map(k => [k, Math.round(num((f || {})[k], 0, 0, 100))]));
const toJson = t => ({ file: t.file, name: t.name, volume: r2(t.volume), pan: r2(t.pan), mode: t.mode, crossfade: t.crossfade, crossfadeSeconds: t.fade,
  everySeconds: t.every, times: t.count, periodSeconds: t.per, varyPitch: t.varyPitch, varyVolume: t.varyVol, hitFade: t.hitFade, filters: { ...t.fx },
  reverbType: t.revType, echoType: t.echoType, trajectoryDirection: t.trajDir, trajectoryRandom: t.trajRand, seamlessLoop: t.seamless,
  image: t.img && (t.img.local ? { local: t.img.local } : { url: t.img.url }), muted: t.muted, solo: t.solo });
// Saved files can be shared between people, so every value is checked and brought within its limits before use.
const fromJson = j => Object.assign(defaults(String(j.file), typeof j.name === 'string' ? j.name : ''), {
  volume: num(j.volume, 0.7, 0, 1), pan: num(j.pan, 0, -1, 1), mode: pick(j.mode, MODES, 'loop'),
  crossfade: !!(j.crossfade ?? true), fade: num(j.crossfadeSeconds, 3, 0.5, 10), every: num(j.everySeconds, 10, 0.5, 3600),
  count: Math.round(num(j.times, 3, 1, 600)), per: Math.round(num(j.periodSeconds, 60, 1, 3596400)),
  varyPitch: !!j.varyPitch, varyVol: !!j.varyVolume, hitFade: num(j.hitFade, 0, 0, 5),
  fx: cleanFx(j.filters), revType: pick(j.reverbType, SPACES, 'cathedral'), echoType: pick(j.echoType, ECHOES, 'valley'),
  trajDir: pick(j.trajectoryDirection, TRAJ, 'lr'), trajRand: !!j.trajectoryRandom, seamless: !!j.seamlessLoop,
  img: cleanImg(j.image), muted: !!j.muted, solo: !!j.solo });
const validTrack = j => !!j && typeof j === 'object' && typeof j.file === 'string' && !!j.file;

function enterEditor() {
  saveFail = null;
  $('title').value = cur.name;
  sizeTitle();
  setDesc(cur.description);
  setMasterUI();
  master.gain.value = cur.volume;
  $('list').innerHTML = '';
  setCover(cur.coverUrl);
  $('search').value = '';
  $('findSound').value = '';
  $('exStatus').textContent = '';   // a message about another composition must not follow you here
  $('exBusy').hidden = true;
  renderLibrary(); updateEmpty(); updateSaveUI(); setPlayUI(); updateSoloNote();
  show('vEditor');
  clearInterval(agoT);
  agoT = setInterval(() => { if (cur && !cur.dirty && !saveFail && cur.file) updateSaveUI(); }, 30000);
}
/* Opening a composition is a step of its own in the browser's history, so the Back button
   returns to the list instead of leaving αtmos, and a reload comes back to the same composition. */
const compId = c => c.file.split('/').pop().replace(/\.json$/i, '');
let navLock = false;
function pushView(hash) {
  navLock = true;
  try { history.pushState({ atmos: hash }, '', hash ? '#' + encodeURIComponent(hash) : location.pathname + location.search); } catch (e) {}
  navLock = false;
}
async function openComp(c, noPush) {
  const d = c.data;
  cur = Object.assign(blank(), { file: c.file, name: d.name, description: d.description || '', cover: d.cover, coverUrl: c.coverUrl, volume: d.masterVolume,
    archived: !!d.archived, savedAt: c.mod,
    effect: d.immersion.effect, background: d.immersion.background, pixel: d.immersion.pixelArt, fill: d.immersion.fill });
  if (!noPush) pushView(compId(c));
  enterEditor();
  const me = cur;
  if (cur.background) readFile(cur.background).then(f => { if (cur === me) cur.bgUrl = URL.createObjectURL(f); }).catch(() => {});
  // First every sound goes into the list, then the audio is loaded (three files at a time).
  // This way a save made while files are still loading can never drop a sound.
  const tracks = d.tracks.map(fromJson);
  tracks.forEach(attachTrack);
  cascadeRows(tracks);
  let i = 0;
  const worker = async () => { while (i < tracks.length && cur === me) await loadTrack(tracks[i++]); };
  await Promise.all([worker(), worker(), worker()]);
}
function newComposition() { cur = blank(); pushView('new'); enterEditor(); $('title').focus(); }
function goBack() { if ((location.hash || '').length > 1) history.back(); else leaveEditor(); }
window.addEventListener('popstate', async () => {
  if (navLock || !root) return;
  const inEditor = !$('vEditor').hidden;
  const want = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (inEditor && !want) {
    await leaveEditor();
    // the person chose to stay (unsaved work): put the step back so Back still works
    if (!$('vEditor').hidden) pushView(cur && cur.file ? compId(cur) : 'new');
  } else if (!inEditor && want) {
    const c = comps.find(x => compId(x) === want);
    if (c) openComp(c, true);
  }
});
async function leaveEditor() {
  if (document.activeElement === $('desc')) $('desc').blur();   // a description being typed is kept
  if (cur && (cur.dirty || saving)) await saveComp(false);
  if (cur && saveFail) {
    const go = await dialog({
      title: 'Your latest changes could not be saved',
      body: `<p>αtmos could not write to your folder, so the newest changes to “${esc(cur.name || 'this composition')}” are
        only in this window. If you leave now, they are lost.</p>`,
      actions: [{ label: 'Stay here', kind: 'ghost', value: false }, { label: 'Try again', kind: 'primary', value: 'retry' },
        { spacer: true }, { label: 'Leave without saving', kind: 'danger', value: true }]
    });
    if (go === 'retry') { await saveComp(true); return leaveEditor(); }
    if (!go) return;
  }
  saveFail = null;
  closeImmersion();
  unfocusTrack();
  if (cur) cur.tracks.forEach(stopTrackTest);
  if (playing) hardStop();
  stopPreview();
  if (cur) cur.tracks.forEach(t => { stopSources(t); try { disposeChain(t.nodes); } catch (e) {} });
  if (cur && cur.bgUrl) URL.revokeObjectURL(cur.bgUrl);
  cur = null;
  undoRemove = null;
  clearInterval(agoT); agoT = null;
  buffers.clear();   // decoded audio takes a lot of memory: release it when the composition is closed
  if ((location.hash || '').length > 1) { navLock = true; try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {} navLock = false; }
  await scanLibrary(); await loadComps(); renderHome(); show('vHome');
}
let autoT = null, changeN = 0, saving = null, saveFail = null, agoT = null;
let knowsAutoSave = (() => { try { return !!localStorage.getItem('atmos-autosave-told'); } catch (e) { return true; } })();
function markDirty() {
  if (!cur) return;
  cur.dirty = true; changeN++; updateSaveUI();
  clearTimeout(autoT); autoT = setTimeout(() => saveComp(false), 900);
  // said once, the first time someone changes a composition, and never again
  if (!knowsAutoSave && cur.file) {
    knowsAutoSave = true;
    try { localStorage.setItem('atmos-autosave-told', '1'); } catch (e) {}
    toast('No need to save — every change is kept in your folder automatically.', { ms: 6000, kind: 'info' });
  }
}
const agoText = t => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 50) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return plural(m, 'min ago', 'min ago');
  const h = Math.round(m / 60);
  return plural(h, 'hour ago', 'hours ago');
};
/* The one place that answers "is my work safe?". It has a sign as well as words, so the state
   never depends on reading alone, and it rides in the bar that stays pinned while you scroll. */
function updateSaveUI() {
  if (!cur) return;
  const p = $('savePlate'), b = $('saveBtn');
  p.classList.remove('saving', 'err');
  let mark, words, when = '', btn = null;
  if (saveFail) { p.classList.add('err'); mark = `<span class="alert">${ICO.alert}</span>`; words = 'Could not save'; when = saveFail; btn = 'Try again'; }
  else if (saving && cur.dirty) { p.classList.add('saving'); mark = '<span class="ring"></span>'; words = 'Saving…'; }
  else if (cur.dirty) { mark = '<span class="ring"></span>'; words = 'Unsaved changes'; btn = 'Save now'; }
  else if (!cur.file) { mark = '<span class="ring"></span>'; words = 'Not saved yet'; btn = 'Save now'; }
  else { mark = `<span class="tick">${ICO.check}</span>`; words = 'Saved'; when = agoText(cur.savedAt); }
  p.innerHTML = mark + `<span>${esc(words)}</span>` + (when ? `<span class="when">${esc(when)}</span>` : '');
  b.textContent = btn || 'Save';
  b.className = btn ? 'primary' : 'ghost';
  b.title = btn === 'Try again' ? 'Try saving again'
    : 'Save now (Ctrl+S). αtmos also saves by itself about a second after every change.';
}
// only a real picture may be used as a cover, a sound's image or an immersion backdrop
const isImage = f => !!f && /^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(f.type);
const notAPicture = () => toast('That file is not a picture. Choose a JPG, PNG or WebP image.', { ms: 5000, kind: 'warn' });
function setCover(url) {
  $('coverImg').hidden = !url; $('coverPh').hidden = !!url;
  if (url) $('coverImg').src = url;
  $('coverBtn').classList.toggle('has', !!url);
  $('coverActs').hidden = !url;
  setAtmo(url);
}
/* The atmosphere behind the whole editor is the cover, blurred; without one, the palette's horizon.
   The blur is done once, on a small copy of the picture, which is then only scaled up. */
let atmoFor = null;
async function setAtmo(url) {
  const pic = $('atmoPic');
  atmoFor = url;
  $('atmo').classList.toggle('has', !!url);
  pic.classList.remove('on');
  if (!url) { pic.style.backgroundImage = ''; return; }
  try {
    // decoded and made small away from the page's own work, so opening a composition stays smooth
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { resizeWidth: 160, resizeQuality: 'medium' });
    // and only once the page is idle: the rows of a composition that is opening come first
    await new Promise(r => window.requestIdleCallback ? requestIdleCallback(r, { timeout: 800 }) : setTimeout(r, 300));
    if (atmoFor !== url) { bmp.close(); return; }
    const W = 128, H = Math.max(1, Math.round(W * bmp.height / bmp.width)), m = 6;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const canBlur = typeof g.filter === 'string';
    if (canBlur) g.filter = 'blur(2px) saturate(1.2)';
    g.drawImage(bmp, -m, -m, W + 2 * m, H + 2 * m);   // drawn a little larger, so the blur does not darken the edges
    bmp.close();
    pic.style.backgroundImage = cssUrl(c.toDataURL());
    pic.classList.toggle('css-blur', !canBlur);
    $('atmo').style.setProperty('--veil', Math.round(veilFor(c) * 100) + '%');
  } catch (e) {
    // the picture as it is, blurred by the browser, under the strongest veil
    if (atmoFor !== url) return;
    pic.style.backgroundImage = cssUrl(url);
    pic.classList.add('css-blur');
    $('atmo').style.setProperty('--veil', '92%');
  }
  requestAnimationFrame(() => { if (atmoFor === url) pic.classList.add('on'); });
}
/* How strongly to veil the cover so that text on the background stays readable: the weakest veil
   under which even the brighter parts of the cover come out dark enough for the warning colour to
   read at 4.5:1. A dark cover keeps more of its colour; a pale one is veiled more. */
function veilFor(src) {
  const N = 24, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  let px;
  try { g.drawImage(src, 0, 0, N, N); px = g.getImageData(0, 0, N, N).data; } catch (err) { return 0.8; }
  const bg = [13, 18, 34], lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const bright = a => {   // the luminance that 95 % of the veiled cover stays under
    const L = [];
    for (let i = 0; i < px.length; i += 4) {
      const mix = k => bg[k] * a + px[i + k] * (1 - a);
      L.push(0.2126 * lin(mix(0)) + 0.7152 * lin(mix(1)) + 0.0722 * lin(mix(2)));
    }
    return L.sort((x, y) => x - y)[Math.floor(L.length * 0.95)];
  };
  let lo = 0.55, hi = 0.92;
  if (bright(lo) <= 0.04) return lo;
  for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (bright(mid) <= 0.04) hi = mid; else lo = mid; }
  return hi;
}
function setMasterUI() {
  const v = Math.round(cur.volume * 100);
  $('master').value = v; $('immVol').value = v; $('masterVal').textContent = v + '%';
  paintRange($('master')); paintRange($('immVol'));
}
async function saveComp(manual = true) {
  if (!cur) return;
  clearTimeout(autoT);
  if (saving) { await saving; if (!cur || !cur.dirty) return; }
  if (!cur.dirty && cur.file && !saveFail) { if (manual) toast('Everything is already saved', { kind: 'info' }); return; }
  saving = doSave(manual); updateSaveUI(); await saving; saving = null;
}
async function doSave(manual) {
  const c = cur, startN = changeN;
  const name = $('title').value.trim() || 'Untitled';
  c.name = name;
  try {
    if (!c.file) c.file = await freeName(DIR.comps, slug(name), '.json');
    else {
      // the saved file follows the title: rename the composition and the file is renamed too
      // (a file keeps a number at the end, e.g. "rain-2", while another composition holds the plain name)
      const oldBase = c.file.split('/').pop().replace(/\.json$/i, ''), want = slug(name);
      const keep = oldBase === want || (oldBase.replace(/-\d+$/, '') === want && await exists(`${DIR.comps}/${want}.json`));
      if (!keep) {
        const old = c.file;
        c.file = await freeName(DIR.comps, slug(name), '.json');
        c.renamedFrom = old;
      }
    }
    const base = c.file.split('/').pop().replace(/\.json$/i, '');
    if (c.coverPending) {
      const ext = ((c.coverPending.name.match(/\.[^.]+$/) || ['.jpg'])[0]).toLowerCase();
      // never write over another composition's cover
      let p = `${DIR.covers}/${base}${ext}`;
      if (p !== c.cover && await exists(p)) p = await freeName(DIR.covers, base, ext);
      await writeFile(p, c.coverPending);
      c.cover = p; c.coverPending = null;
    }
    if (c.bgPending) {
      const ext = ((c.bgPending.name.match(/\.[^.]+$/) || ['.jpg'])[0]).toLowerCase();
      let p = `${DIR.covers}/${base}-background${ext}`;
      if (p !== c.background && await exists(p)) p = await freeName(DIR.covers, base + '-background', ext);
      await writeFile(p, c.bgPending);
      c.background = p; c.bgPending = null;
    }
    const data = { version: 2, name, cover: c.cover, masterVolume: r2(c.volume),
      immersion: { effect: c.effect, background: c.background, pixelArt: !!c.pixel, fill: !!c.fill }, tracks: c.tracks.map(toJson) };
    if (c.description) data.description = c.description;
    if (c.archived) data.archived = true;
    await writeFile(c.file, JSON.stringify(data, null, 2));
    if (c.renamedFrom) {
      const [d, n] = split(c.renamedFrom); c.renamedFrom = null;
      try { await (await dirAt(d, false)).removeEntry(n); } catch (e) {}
    }
    if (changeN === startN) c.dirty = false;
    c.savedAt = Date.now();
    saveFail = null;
    updateSaveUI();
    if (c === cur) { const p = $('savePlate'); p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 600); }
    if (manual) toast('Saved');
    if (c.dirty && c === cur) markDirty();
  } catch (e) {
    // A failed save must not fade away: it stays until it succeeds, and leaving asks first.
    saveFail = 'the folder can\'t be reached';
    updateSaveUI();
  }
}

/* ---------- audio: chain and scheduling ---------- */
function effectiveGain(t) {
  const anySolo = cur && cur.tracks.some(x => x.solo);
  if (t.muted || (anySolo && !t.solo)) return 0;
  return t.volume;
}
/* ---------- filters ---------- */
const FILTERS = [
  ['reverb', 'Reverb', 'Space around the sound, and a tail that fades — a hall, a cave'],
  ['echo', 'Echo', 'Repeats that bounce left and right and slowly die away'],
  ['muffled', 'Muffled', 'Takes the brightness away: far off, behind a window, under water'],
  ['thin', 'Thin', 'Takes the depth away: lighter, airier, further from you'],
  ['waves', 'Waves', 'The volume rises and falls on its own, like breathing'],
  ['movement', 'Movement', 'The sound drifts slowly from one side to the other'],
  ['trajectory', 'Trajectory', 'Each time it plays, the sound travels across: how far it goes is the setting']
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
    // gold means "this is sounding now": solo only wears it while the mix is actually playing
    const s = t.el.querySelector('.solo');
    if (s) s.classList.toggle('sounding', t.solo && playing);
  });
  updateSoloNote();
}
function fadeLen(t, d) {
  if (t.mode === 'loop') return t.crossfade ? Math.min(t.fade, d / 3) : 0;
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
  if (t.seamless && !t.loopBuf) { t.seamless = false; toast('This sound is too short for a seamless loop', { kind: 'warn' }); }
  if (playing && t.st) resetTrack(t, ctx.currentTime + 0.05);
}
// remembers when each repeat starts, to draw the progress bar
function noteHit(t, start, dur, loop) { (t.hits = t.hits || []).push({ start, dur, loop }); if (t.hits.length > 4) t.hits.shift(); }
/* Trajectory: on every repeat the sound travels across the stereo space */
const TRAJ = { lr: 'Left → Right', rl: 'Right → Left', pp: 'Ping-pong' };
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
    t.el.classList.add('hit');
    setTimeout(() => t.el && t.el.classList.remove('hit'), Math.min(1600, t.buffer ? t.buffer.duration * 1000 : 400));
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
/* progress bar under each sound */
let progRAF = null;
const baseDur = t => t.missing ? 'missing' : t.buffer ? fmt(t.buffer.duration) : '…';
function updateProg(t, now) {
  if (!t.el) return;
  const bar = t.el.querySelector('.prog i'), lab = t.el.querySelector('.dur');
  let f = 0, txt = baseDur(t);
  const h = t.pv || (playing ? (t.hits || []).filter(x => x.start <= now).pop() : null);
  if (h) {
    const e = now - h.start;
    if (e < 0) { /* about to start */ }
    else if (h.loop) { const pos = e % h.loop; f = pos / h.loop; txt = `${fmt(pos)} / ${fmt(h.loop)}`; }
    else if (e < h.dur) { f = e / h.dur; txt = `${fmt(e)} / ${fmt(h.dur)}`; }
  }
  bar.style.transform = `scaleX(${Math.min(1, f)})`;
  if (lab.textContent !== txt) lab.textContent = txt;
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
  $('playBtn').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('immIcoPlay').toggleAttribute('hidden', playing); $('immIcoStop').toggleAttribute('hidden', !playing);
  $('immPlay').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  if (!playing) $('clock').textContent = '0:00';
  updateLive();
}

/* ---------- previews ---------- */
let pv = null, pvTok = 0;   // preview in progress: { key, btn, stop }
function setPvBtn(b, on) { b.innerHTML = on ? ICO.stop : ICO.play; b.classList.toggle('on', on); b.title = on ? 'Stop' : 'Listen'; }
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
  a.play().catch(() => { toast('Preview not available', { kind: 'warn' }); stopPreview(); });
  pv = { key, btn, stop: () => { a.pause(); a.removeAttribute('src'); } }; setPvBtn(btn, true);
  a.onended = () => { if (pv && pv.key === key) stopPreview(); };
}
/* Preview of a single sound: the ▶ button lights up, press it again to stop.
   It goes through the sound's own volume, position and filters, so you can adjust them while listening
   (even when the sound is muted or another one is soloed). */
function setTestBtn(t) {
  const b = t.el && t.el.querySelector('.test');
  if (!b) return;
  b.classList.toggle('on', !!t.pv);
  b.innerHTML = t.pv ? ICO.stop : ICO.play;
  b.title = t.pv ? 'Stop' : 'Listen to this sound on its own, over and over, while you adjust it';
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

/* ---------- segmented controls: the selection slides ----------
   Each .seg holds one pill behind its choices. It is moved with a transform and takes the width
   of the choice it lands on. A changed size (fonts loading, a panel resizing, a hidden row shown)
   puts it in place without a slide; only a new choice slides it. */
const segPill = seg => seg.querySelector(':scope>.seg-pill');
function placePill(seg, slide) {
  const pill = segPill(seg), on = seg.querySelector(':scope>button.on');
  if (!pill || !on) return;
  const x = on.offsetLeft, w = on.offsetWidth;
  if (seg._x === x && seg._w === w) return;
  if (seg._x === undefined) slide = false;
  seg._x = x; seg._w = w;
  if (!slide) pill.style.transition = 'none';
  pill.style.width = w + 'px';
  pill.style.transform = `translateX(${x}px)`;
  if (!slide) { void pill.offsetWidth; pill.style.transition = ''; }
}
const segSizes = new ResizeObserver(es => es.forEach(e => placePill(e.target, false)));
const watchSeg = seg => { segSizes.observe(seg); placePill(seg, false); };
/* where a pill is on screen right now, mid-slide included, relative to its control */
const pillAt = seg => {
  const p = segPill(seg).getBoundingClientRect(), s = seg.getBoundingClientRect();
  return { x: p.left - s.left - seg.clientLeft, w: p.width };
};
/* a rebuilt control starts its pill where the old one was, then slides it to the new choice */
function slideFrom(seg, from) {
  const pill = segPill(seg);
  pill.style.transition = 'none';
  pill.style.width = from.w + 'px';
  pill.style.transform = `translateX(${from.x}px)`;
  void pill.offsetWidth;
  pill.style.transition = '';
  seg._x = from.x; seg._w = from.w;
  placePill(seg, true);
}
watchSeg($('viewSeg')); watchSeg($('libTabs'));

/* ---------- sounds in the composition ---------- */
const panLabel = v => { const n = Math.round(Math.abs(v) * 100); return n < 5 ? 'Centre' : (v < 0 ? 'Left ' : 'Right ') + n; };

const trackDot = t => t.missing ? `<span class="dot miss" title="The audio file is missing">${ICO.alert}</span>` : '<span class="dot"></span>';
const missingLine = t => `<p class="warn">${ICO.alert}<span>The audio file for this sound is missing (<b>${esc(t.file.split('/').pop())}</b>).</span>
       <button class="ghost sm relink">Choose the file…</button>
       <button class="quiet sm dropit">Remove this sound</button></p>`;
function wireMissing(t, el) {
  el.querySelector('.relink').onclick = () => { relinkTarget = t; $('relinkIn').click(); };
  el.querySelector('.dropit').onclick = () => removeTrack(t);
}
function renderTrack(t) {
  const el = document.createElement('div');
  el.className = 'track' + (t.missing ? ' missing' : '');
  const dur = baseDur(t);
  const loopOpts = t.seamless ? `
    <div class="opts">
      Blend <input type="range" class="fade" min="0.5" max="10" step="0.5" value="${t.fade}" aria-label="Blend length">
      <span class="val fv">${t.fade} s</span>
    </div>` : `
    <div class="opts">
      <label class="check"><input type="checkbox" class="cf" ${t.crossfade ? 'checked' : ''}> Blend</label>
      <input type="range" class="fade" min="0.5" max="10" step="0.5" value="${t.fade}" aria-label="Blend length" ${t.crossfade ? '' : 'disabled'}>
      <span class="val fv">${t.fade} s</span>
    </div>`;
  const hfLabel = v => v ? v.toFixed(1).replace('.0', '') + ' s' : 'none';
  const varyOpts = `
      Fade <input type="range" class="hfade" min="0" max="5" step="0.1" value="${t.hitFade}" aria-label="Fade in and out">
      <span class="val hfv">${hfLabel(t.hitFade)}</span>
      <label class="check"><input type="checkbox" class="vpitch" ${t.varyPitch ? 'checked' : ''}> Vary pitch</label>
      <label class="check"><input type="checkbox" class="vvol" ${t.varyVol ? 'checked' : ''}> Vary volume</label>`;
  const intOpts = `
    <div class="opts">
      Every <input type="number" class="every" min="0.5" max="3600" step="0.5" value="${t.every}" aria-label="Seconds between repeats"> seconds
    </div>
    <div class="opts">${varyOpts}</div>`;
  const unit = t.per % 3600 === 0 ? 3600 : t.per % 60 === 0 ? 60 : 1;
  const rndOpts = `
    <div class="opts">
      About <input type="number" class="count" min="1" max="600" step="1" value="${t.count}" aria-label="How many times"> times every
      <input type="number" class="perN" min="1" max="999" step="1" value="${t.per / unit}" aria-label="Period">
      <select class="perU" aria-label="Unit">
        <option value="1" ${unit === 1 ? 'selected' : ''}>seconds</option>
        <option value="60" ${unit === 60 ? 'selected' : ''}>minutes</option>
        <option value="3600" ${unit === 3600 ? 'selected' : ''}>hours</option>
      </select>
    </div>
    <div class="opts">${varyOpts}</div>`;
  const options = (obj, sel, label = v => v.label) => Object.entries(obj).map(([v, o]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label(o)}</option>`).join('');
  const extra = {
    reverb: `<select class="revtype" title="Kind of space" aria-label="Kind of space">${options(SPACES, t.revType)}</select>`,
    echo: `<select class="revtype echotype" title="How far the echo is" aria-label="How far the echo is">${options(ECHOES, t.echoType)}</select>`,
    trajectory: `<select class="revtype trajdir" title="Direction" aria-label="Direction">${options(TRAJ, t.trajDir, v => v)}</select><label class="fxcheck" title="Picks the direction by chance on every repeat"><input type="checkbox" class="trajrand" ${t.trajRand ? 'checked' : ''}> Random</label>`
  };
  const saved = isSavedSound(t.name);
  el.innerHTML = `
    <div class="tbg"></div>
    <button class="tclose" title="Close (Esc)">Done</button>
    <div class="top">
      <span class="grip" tabindex="0" role="button" title="Drag to reorder, or use the up and down arrows" aria-label="Move ${esc(t.name)}">${ICO.grip}</span>
      ${trackDot(t)}
      <input class="name" value="${esc(t.name)}" title="Click to rename · file: ${esc(t.file)}" spellcheck="false" aria-label="Name of the sound">
      <span class="tname">${esc(t.name)}</span>
      <div class="imgctl">
        <button class="icon imgown" title="${t.img ? 'Change the picture of this sound' : 'Add a picture to this sound (or drag one onto it, or paste it with Ctrl+V)'}" aria-label="Choose a picture for this sound">${ICO.image}</button>
        <button class="icon imgdel" title="Remove the picture" aria-label="Remove the picture from this sound" ${t.img ? '' : 'hidden'}>${ICO.imageOff}</button>
      </div>
      <span class="dur">${dur}</span><span class="tdur">${dur}</span>
      ${t.muted ? '<span class="why-off">silenced · muted</span>' : ''}
      <div class="btns">
        <button class="icon test ${t.pv ? 'on' : ''}" title="${t.pv ? 'Stop' : 'Listen to this sound on its own, over and over, while you adjust it'}" aria-pressed="${!!t.pv}" aria-label="${t.pv ? 'Stop listening to this sound on its own' : 'Listen to this sound on its own'}" ${t.buffer ? '' : 'disabled'}>${t.pv ? ICO.stop : ICO.play}</button>
        <button class="chip mute ${t.muted ? 'on' : ''}" title="Silence this sound" aria-label="Mute" aria-pressed="${t.muted}"><span class="w">Mute</span></button>
        <button class="chip solo ${t.solo ? 'on' : ''}" title="Play only this sound" aria-label="Solo" aria-pressed="${t.solo}"><span class="w">Solo</span></button>
        <button class="chip fxb ${t.fxOpen ? 'open' : ''}" title="Reverb, echo and more" aria-expanded="${!!t.fxOpen}">Effects${fxCount(t) ? `<span class="n">${fxCount(t)}</span>` : ''}</button>
        ${t.mode === 'loop' ? `<button class="chip seam ${t.seamless ? 'on' : ''}" aria-label="Seamless loop" aria-pressed="${!!t.seamless}" title="Seamless loop: joins the end to the start, with no gap" ${t.buffer ? '' : 'disabled'}><span class="w">Seamless</span></button>` : ''}
        <button class="icon keep ${saved ? 'is-saved' : ''}" title="${saved ? 'Already saved in your sounds — save again to replace it' : 'Save this sound to your sounds, with its picture, effects and settings'}" aria-label="Save to your sounds">${saved ? ICO.keepOn : ICO.keep}</button>
        <button class="icon del" title="Remove from this composition" aria-label="Remove ${esc(t.name)} from this composition">${ICO.x}</button>
      </div>
    </div>
    ${t.missing ? missingLine(t) : ''}
    <div class="grid">
      <div class="field"><label>Volume <span class="val vv">${Math.round(t.volume * 100)}%</span></label>
        <input type="range" class="vol" min="0" max="100" value="${Math.round(t.volume * 100)}" aria-label="Volume"></div>
      <div class="field"><label>Position <span class="val pv">${panLabel(t.pan)}</span></label>
        <input type="range" class="pan" min="-100" max="100" value="${Math.round(t.pan * 100)}" aria-label="Position between left and right"></div>
    </div>
    <div class="mode">
      <div class="seg" role="group" aria-label="How it plays"><i class="seg-pill" aria-hidden="true"></i>
        ${Object.entries(MODES).map(([m, label]) => `<button data-m="${m}" class="${t.mode === m ? 'on' : ''}"${m === 'random' ? ' title="Plays at random moments, as often as you choose"' : ''}>${label}</button>`).join('')}
      </div>
      ${{ loop: loopOpts, interval: intOpts, random: rndOpts }[t.mode]}
    </div>
    <div class="fxp" ${t.fxOpen ? '' : 'hidden'}>
      <div class="fx-places">
        <p>Put this sound…</p>
        <div class="chips">${PLACES.map(([id, label]) => `<button class="chip place${placeOf(t) === id ? ' on' : ''}" data-p="${id}">${esc(label)}</button>${id === 'none' ? '<span class="chips-sep" aria-hidden="true"></span>' : ''}`).join('')}</div>
      </div>
      <div class="grid">
        ${FILTERS.map(([k, label, hint]) => `
        <div class="field${k === 'trajectory' ? ' wide' : ''}"><div class="lab"><span>${label}</span>${extra[k] || ''}<span class="val" data-v="${k}">${fxValueText(t, k)}</span></div>
          <p class="fx-hint">${esc(hint)}</p>
          <input type="range" min="0" max="100" step="1" value="${t.fx[k]}" data-k="${k}" aria-label="${label}"></div>`).join('')}
      </div>
    </div>
    <div class="prog"><i></i></div>`;

  const q = s => el.querySelector(s);
  q('.test').onclick = () => trackTest(t);
  q('.mute').onclick = e => { t.muted = !t.muted; e.currentTarget.classList.toggle('on', t.muted); e.currentTarget.setAttribute('aria-pressed', t.muted); refreshGains(); markDirty(); };
  q('.solo').onclick = e => { t.solo = !t.solo; e.currentTarget.classList.toggle('on', t.solo); e.currentTarget.setAttribute('aria-pressed', t.solo); refreshGains(); markDirty(); };
  q('.del').onclick = () => removeTrack(t);
  q('.keep').onclick = () => savePreset(t);
  q('.tclose').onclick = () => unfocusTrack();
  if (t.missing) wireMissing(t, el);
  // the ready-made places simply move the sliders below
  el.querySelectorAll('.place').forEach(b => b.onclick = () => {
    const p = PLACES.find(x => x[0] === b.dataset.p)[2];
    FILTER_KEYS.forEach(k => t.fx[k] = p.fx[k]);
    if (p.revType) t.revType = p.revType;
    if (p.echoType) t.echoType = p.echoType;
    setReverbType(t); applyFx(t);
    replaceEl(t); markDirty();
  });
  // reordering without a mouse: the handle takes the arrow keys
  q('.grip').onkeydown = e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const a = cur.tracks, i = a.indexOf(t), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= a.length) return;
    moveTrack(t, a[j], e.key === 'ArrowDown');
    t.el.querySelector('.grip').focus();
    toast(`“${t.name}” moved to ${j + 1} of ${a.length}`, { ms: 1800 });
  };
  q('.name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = t.name; e.target.blur(); } };
  q('.name').onchange = e => {
    t.name = e.target.value.trim() || t.file.split('/').pop().replace(/\.[^.]+$/, '');
    e.target.value = t.name; markDirty();
  };
  // like every other destructive action, taking a picture away can be undone
  q('.imgdel').onclick = () => {
    const was = t.img;
    t.img = null; paintTrackImage(t); markDirty();
    toast('Picture removed', { action: 'Undo', onAction: () => {
      if (!cur || !cur.tracks.includes(t)) return;
      t.img = was; paintTrackImage(t); markDirty();
    } });
  };
  q('.imgown').onclick = () => { imgTarget = t; $('trackImgIn').click(); };
  el.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) { e.preventDefault(); el.classList.add('imgdrop'); } });
  // reordering: drag by the handle
  const grip = q('.grip');
  grip.addEventListener('pointerdown', () => { el.draggable = true; });
  el.addEventListener('dragstart', e => {
    if (!el.draggable) return;
    dragT = t; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mixer-track', t.uid);
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); dragT = null; clearDropMarks(); clearShift(); });
  el.addEventListener('dragover', e => {
    if (!dragT || dragT === t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const after = dropAfter(el, e);
    clearDropMarks(); el.classList.add(after ? 'drop-after' : 'drop-before');
    markShift(t, after);
  });
  el.addEventListener('drop', e => {
    if (!dragT || dragT === t) return;
    e.preventDefault();
    clearShift(); moveTrack(dragT, t, dropAfter(el, e)); clearDropMarks();
  });
  // tiles view: a click — or Enter on the tile itself — opens the tile large
  el.addEventListener('click', e => {
    if (!$('list').classList.contains('tiles') || el.classList.contains('focused')) return;
    if (e.target.closest('button, input, select, label, .grip')) return;
    focusTrack(t);
  });
  el.addEventListener('keydown', e => {
    if (e.target !== el || !$('list').classList.contains('tiles') || el.classList.contains('focused')) return;
    if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); focusTrack(t); }
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('imgdrop'); });
  el.addEventListener('drop', e => {
    el.classList.remove('imgdrop');
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); e.stopPropagation(); setOwnImage(t, f); }
  });
  paintTrackImage(t, el);
  q('.fxb').onclick = e => {
    t.fxOpen = !t.fxOpen;
    q('.fxp').hidden = !t.fxOpen;
    e.currentTarget.classList.toggle('open', t.fxOpen);
    e.currentTarget.setAttribute('aria-expanded', t.fxOpen);
  };
  q('.revtype:not(.echotype):not(.trajdir)').onchange = e => { t.revType = e.target.value; setReverbType(t); markDirty(); };
  q('.echotype').onchange = e => { t.echoType = e.target.value; applyFx(t); markDirty(); };
  q('.trajdir').onchange = e => { t.trajDir = e.target.value; markDirty(); };
  q('.trajrand').onchange = e => { t.trajRand = e.target.checked; q('.trajdir').disabled = t.trajRand; q('[data-v="trajectory"]').textContent = fxValueText(t, 'trajectory'); markDirty(); };
  q('.trajdir').disabled = t.trajRand;
  el.querySelectorAll('.fxp input[data-k]').forEach(inp => inp.oninput = () => {
    const k = inp.dataset.k; t.fx[k] = +inp.value;
    el.querySelector(`[data-v="${k}"]`).textContent = fxValueText(t, k);
    setFxCount(t);
    const now = placeOf(t);
    el.querySelectorAll('.place').forEach(b => b.classList.toggle('on', b.dataset.p === now));
    applyFx(t); markDirty();
  });
  if (q('.seam')) q('.seam').onclick = e => {
    const b = e.currentTarget;
    t.seamless = !t.seamless; b.classList.toggle('on', t.seamless);
    setTimeout(() => { applySeamless(t); replaceEl(t); markDirty(); }, 20);
  };
  q('.vol').oninput = e => {
    t.volume = e.target.value / 100; q('.vv').textContent = e.target.value + '%';
    if (t.pv) t.pv.g.gain.setTargetAtTime(t.volume, ctx.currentTime, 0.05);
    refreshGains(); markDirty();
  };
  q('.pan').oninput = e => { t.pan = e.target.value / 100; q('.pv').textContent = panLabel(t.pan); t.nodes.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.03); markDirty(); };
  el.querySelectorAll('.mode .seg button').forEach(b => b.onclick = () => {
    if (t.mode === b.dataset.m) return;
    t.mode = b.dataset.m;
    if (t.mode === 'loop' && t.seamless && !t.loopBuf && t.buffer) t.loopBuf = makeSeamless(t.buffer, t.fade);
    if (playing) resetTrack(t, ctx.currentTime + 0.05);
    // the row is rebuilt: the new pill starts where the old one is, so it slides instead of jumping
    const from = pillAt(t.el.querySelector('.mode .seg'));
    replaceEl(t); markDirty();
    slideFrom(t.el.querySelector('.mode .seg'), from);
  });
  if (t.mode === 'loop') {
    if (q('.cf')) q('.cf').onchange = e => { t.crossfade = e.target.checked; q('.fade').disabled = !t.crossfade; markDirty(); };
    q('.fade').oninput = e => { t.fade = +e.target.value; q('.fv').textContent = t.fade + ' s'; markDirty(); };
    q('.fade').onchange = () => { if (t.seamless) applySeamless(t); };
  } else if (t.mode === 'random') {
    const soon = () => { if (playing && t.st && t.buffer) t.st.next = Math.min(t.st.next, Math.max(ctx.currentTime, t.st.lastEnd || 0) + randomPause(t)); };
    // an impossible entry goes back to what was there before, never to some default
    q('.count').onchange = e => { t.count = Math.floor(num(parseFloat(e.target.value), t.count, 1, 600)); e.target.value = t.count; soon(); markDirty(); };
    const setPer = () => {
      const was = Math.max(1, Math.round(t.per / +q('.perU').value));
      const n = Math.floor(num(parseFloat(q('.perN').value), was, 1, 999));
      q('.perN').value = n; t.per = n * +q('.perU').value; soon(); markDirty();
    };
    q('.perN').onchange = setPer; q('.perU').onchange = setPer;
  } else {
    const soon = () => { if (playing && t.st) t.st.next = Math.min(t.st.next, ctx.currentTime + t.every); };
    q('.every').onchange = e => { t.every = num(parseFloat(e.target.value), t.every, 0.5, 3600); e.target.value = t.every; soon(); markDirty(); };
  }
  if (t.mode !== 'loop') {
    q('.vpitch').onchange = e => { t.varyPitch = e.target.checked; markDirty(); };
    q('.vvol').onchange = e => { t.varyVol = e.target.checked; markDirty(); };
    q('.hfade').oninput = e => { t.hitFade = +e.target.value; q('.hfv').textContent = hfLabel(t.hitFade); markDirty(); };
  }
  if (effectiveGain(t) === 0) el.classList.add('off');
  paintRanges(el);
  segSizes.observe(el.querySelector('.mode .seg'));
  return el;
}
function replaceEl(t) {
  if (!t.el) return;
  segSizes.unobserve(t.el.querySelector('.mode .seg'));
  const n = renderTrack(t);
  const ob = t.el.querySelector('.tbg'), nb = n.querySelector('.tbg');
  if (t.img && ob.classList.contains('show') && ob.dataset.url === t.img.url) {
    nb.style.backgroundImage = ob.style.backgroundImage; nb.dataset.url = ob.dataset.url; nb.classList.add('show');
  }
  if (focusT === t) { n.classList.add('focused'); t.el.removeEventListener('keydown', trapInTile); n.addEventListener('keydown', trapInTile); }
  t.el.replaceWith(n); t.el = n;
  setTileFocus(); updateLive(); updateWhyOff(); applyFind();
}

/* ---------- order of the sounds ---------- */
let dragT = null;
document.addEventListener('pointerup', () => { if (!dragT) document.querySelectorAll('.track[draggable="true"]').forEach(x => x.draggable = false); });
const clearDropMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
function clearShift() { $('list').classList.remove('sorting'); document.querySelectorAll('.track.shift, .track.shift-up').forEach(x => x.classList.remove('shift', 'shift-up')); }
// cards from the landing point onwards move down a little, the one before moves up slightly
function markShift(target, after) {
  const others = cur.tracks.filter(x => x !== dragT);
  const at = others.indexOf(target) + (after ? 1 : 0);
  $('list').classList.add('sorting');
  others.forEach((x, i) => { if (!x.el) return; x.el.classList.toggle('shift', i >= at); x.el.classList.toggle('shift-up', i === at - 1); });
}
$('list').addEventListener('dragleave', e => { if (dragT && !$('list').contains(e.relatedTarget)) { clearShift(); clearDropMarks(); } });
function dropAfter(el, e) {
  // measured from the "resting" position, so the card's own shift doesn't make the choice flicker
  const r = el.getBoundingClientRect(), tiles = $('list').classList.contains('tiles');
  const off = el.classList.contains('shift') ? (tiles ? 10 : 12) : el.classList.contains('shift-up') ? -4 : 0;
  return tiles ? e.clientX > r.left - off + r.width / 2 : e.clientY > r.top - off + r.height / 2;
}
function moveTrack(t, target, after) {
  const a = cur.tracks;
  a.splice(a.indexOf(t), 1);
  a.splice(a.indexOf(target) + (after ? 1 : 0), 0, t);
  if (after) target.el.after(t.el); else target.el.before(t.el);
  markDirty();
}

/* ---------- view: rows or tiles ---------- */
let focusT = null, focusPh = null, focusShade = null;
function setView(v) {
  unfocusTrack();
  $('list').classList.toggle('tiles', v === 'tiles');
  $('viewSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  placePill($('viewSeg'), true);
  setTileFocus();
  try { localStorage.setItem('atmos-view', v); } catch (e) {}
}
/* in tiles view a whole tile is one thing you can reach with Tab and open with Enter */
function setTileFocus() {
  const tiles = $('list').classList.contains('tiles');
  document.querySelectorAll('#list .track').forEach(el => {
    if (tiles && !el.classList.contains('focused')) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); }
    else { el.removeAttribute('tabindex'); el.removeAttribute('role'); }
  });
}
let focusPrev = null;
function focusTrack(t) {
  unfocusTrack();
  focusPrev = document.activeElement;
  focusPh = document.createElement('div'); focusPh.className = 'track-ph';
  focusPh.style.minHeight = t.el.offsetHeight + 'px';
  t.el.before(focusPh);
  focusShade = document.createElement('div'); focusShade.className = 'focus-shade';
  focusShade.onclick = unfocusTrack;
  document.body.appendChild(focusShade);
  t.el.classList.add('focused');
  focusT = t;
  setTileFocus();
  // an opened tile behaves like a panel: the keyboard stays inside it until it is closed
  const first = t.el.querySelector('button:not([disabled]), input:not([disabled])');
  if (first) first.focus();
  t.el.addEventListener('keydown', trapInTile);
}
function trapInTile(e) {
  if (e.key !== 'Tab' || !focusT || !focusT.el) return;
  const f = [...focusT.el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')]
    .filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  e.preventDefault();
  f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
}
function unfocusTrack() {
  if (!focusT) return;
  if (focusT.el) { focusT.el.classList.remove('focused'); focusT.el.removeEventListener('keydown', trapInTile); }
  if (focusPh) focusPh.remove();
  if (focusShade) focusShade.remove();
  const back = focusT.el, prev = focusPrev;
  focusT = focusPh = focusShade = focusPrev = null;
  setTileFocus();
  if (back && back.isConnected && $('list').classList.contains('tiles')) back.focus();
  else if (prev && prev.isConnected) try { prev.focus(); } catch (e) {}
}
$('viewSeg').querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.v));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && focusT) unfocusTrack(); });
setView((() => { try { return localStorage.getItem('atmos-view') || localStorage.getItem('mixer-vista') || 'rows'; } catch (e) { return 'rows'; } })());
function updateEmpty() {
  const n = cur ? cur.tracks.length : 0;
  $('empty').hidden = n > 0;
  $('exPanel').hidden = n === 0;         // nothing to export yet: do not offer it
  $('findSound').hidden = n <= 8;
  if (n <= 8 && $('findSound').value) { $('findSound').value = ''; applyFind(); }
  const miss = cur ? cur.tracks.filter(t => t.missing).length : 0;
  $('compMeta').innerHTML = n
    ? `<span class="sep">·</span>${n}` + (miss ? `<span class="sep">·</span><span class="warn-line">${miss} missing</span>` : '')
    : '';
}
/* with many sounds, a field to find one by name instead of scrolling */
function applyFind() {
  const q = $('findSound').value.trim().toLowerCase();
  if (!cur) return;
  cur.tracks.forEach(t => { if (t.el) t.el.hidden = !!q && !t.name.toLowerCase().includes(q); });
}
$('findSound').oninput = applyFind;

const isSavedSound = name => library.some(i => i.preset && i.name === (String(name).trim() || 'Sound'));
function setKeepBtn(t) {
  const b = t.el && t.el.querySelector('.keep');
  if (!b) return;
  const on = isSavedSound(t.name);
  b.classList.toggle('is-saved', on);
  b.innerHTML = on ? ICO.keepOn : ICO.keep;
  b.title = on ? 'Already saved in your sounds — save again to replace it'
    : 'Save this sound to your sounds, with its picture, effects and settings';
}
function setFxCount(t) {
  const b = t.el && t.el.querySelector('.fxb');
  if (!b) return;
  const n = fxCount(t);
  b.innerHTML = 'Effects' + (n ? `<span class="n">${n}</span>` : '');
}
/* a silenced sound says why it is silent, instead of only looking faded */
function updateWhyOff() {
  if (!cur) return;
  const anySolo = cur.tracks.some(x => x.solo);
  cur.tracks.forEach(t => {
    if (!t.el) return;
    const txt = t.muted ? 'silenced · muted' : (anySolo && !t.solo) ? 'silenced · solo' : '';
    let s = t.el.querySelector('.why-off');
    if (!txt) { if (s) s.remove(); return; }
    if (!s) { s = document.createElement('span'); s.className = 'why-off'; const d = t.el.querySelector('.tdur'); if (d) d.after(s); }
    s.textContent = txt;
  });
}
/* and the bar that is always on screen says which sound is holding the solo */
function updateSoloNote() {
  const n = $('soloNote');
  if (!cur) { n.hidden = true; return; }
  const solo = cur.tracks.filter(t => t.solo), muted = cur.tracks.filter(t => t.muted && !t.solo).length;
  if (!solo.length && !muted) { n.hidden = true; return; }
  n.hidden = false;
  n.innerHTML = '';
  // gold is spent only on what is sounding: while the mix is stopped the name is ordinary text
  n.classList.toggle('sounding', playing && solo.length > 0);
  if (solo.length) {
    const names = solo.map(t => t.name).join(', ');
    n.insertAdjacentHTML('beforeend', playing
      ? `<span>Playing only <b>${esc(names)}</b></span>`
      : `<span>Only <b>${esc(names)}</b> will play</span>`);
    const go = document.createElement('button');
    go.className = 'quiet sm'; go.textContent = 'Show';
    go.onclick = () => { if (solo[0].el) solo[0].el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const clr = document.createElement('button');
    clr.className = 'quiet sm'; clr.textContent = 'Clear solo';
    clr.onclick = () => { cur.tracks.forEach(t => { if (t.solo) { t.solo = false; if (t.el) { const b = t.el.querySelector('.solo'); b.classList.remove('on', 'sounding'); b.setAttribute('aria-pressed', 'false'); } } }); refreshGains(); markDirty(); };
    n.append(go, clr);
  }
  if (muted) n.insertAdjacentHTML('beforeend', `<span style="margin-left:auto">${esc(plural(muted, 'sound', 'sounds'))} muted</span>`);
}

/* ---------- the image under each sound: you choose it (file, drag and drop, or Ctrl+V) ---------- */
function paintTrackImage(t, el = t.el) {
  if (!el) return;
  const bg = el.querySelector('.tbg'), del = el.querySelector('.imgdel');
  if (del) del.hidden = !t.img;
  if (!bg) return;
  if (!t.img) { bg.classList.remove('show'); bg.style.backgroundImage = ''; bg.dataset.url = ''; return; }
  if (t.img.local && !t.img.url) {
    // your own image, saved in the folder: read it first, then show it
    const want = t.img;
    readFile(want.local).then(f => { if (t.img === want) { want.url = URL.createObjectURL(f); paintTrackImage(t); } })
      .catch(() => { bg.classList.remove('show'); });
    return;
  }
  const url = t.img.url;
  if (bg.dataset.url === url) { bg.classList.add('show'); return; }
  const im = new Image();
  im.onload = () => { if (t.img && t.img.url === url) { bg.style.backgroundImage = cssUrl(url); bg.dataset.url = url; bg.classList.add('show'); } };
  im.src = url;
}
let imgTarget = null;
async function setOwnImage(t, file) {
  try {
    const ext = ((file.name || '').match(/\.[a-z0-9]+$/i) || ['.' + ((file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'))])[0].toLowerCase();
    const path = await freeName(DIR.trackImages, slug(t.name).slice(0, 40) + '-' + uid().slice(0, 5), ext);
    await writeFile(path, file);
    t.img = { local: path, url: URL.createObjectURL(file) };
    paintTrackImage(t); markDirty();
    toast('Image added');
  } catch (e) { toast('Couldn\'t save the image'); }
}
function setImageUrl(t, url) {
  // first make sure the link really leads to an image
  const im = new Image();
  im.onload = () => { if (!cur || !cur.tracks.includes(t)) return; t.img = { url }; paintTrackImage(t); markDirty(); toast('Image added from the link'); };
  im.onerror = () => toast('That link doesn\'t lead to an image', { kind: 'warn' });
  im.src = url;
}
$('trackImgIn').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !imgTarget) return;
  if (!isImage(f)) return notAPicture();
  setOwnImage(imgTarget, f);
};
// Ctrl+V with the mouse over a sound: pastes a copied image (or the address of an image)
document.addEventListener('paste', e => {
  if (!cur || $('vEditor').hidden || !e.clipboardData) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const el = document.querySelector('.track:hover');
  const t = el && cur.tracks.find(x => x.el === el);
  if (!t) return;
  const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); setOwnImage(t, item.getAsFile()); return; }
  const text = (e.clipboardData.getData('text') || '').trim();
  if (/^https?:\/\/\S+$/i.test(text)) { e.preventDefault(); setImageUrl(t, text); }
});

/* adding a sound: it goes into the list first, then its audio is loaded */
function attachTrack(t, at) {
  t.nodes = buildChain(t, ctx, master);
  t.el = renderTrack(t);
  if (at == null || at >= cur.tracks.length) { cur.tracks.push(t); $('list').appendChild(t.el); }
  else { const ref = cur.tracks[at]; cur.tracks.splice(at, 0, t); if (ref.el) ref.el.before(t.el); else $('list').appendChild(t.el); }
  setTileFocus(); updateEmpty(); applyFind();
}
async function loadTrack(t) {
  const me = cur;
  try {
    t.buffer = await loadBuffer(t.file);
    if (t.seamless && t.mode === 'loop') t.loopBuf = makeSeamless(t.buffer, t.fade);
  } catch (e) { t.missing = true; }
  if (cur !== me || !cur.tracks.includes(t)) return false;
  showLoaded(t);
  if (playing && t.buffer) resetTrack(t, ctx.currentTime + 0.05);
  refreshGains(); updateEmpty();
  return true;
}
/* The audio of a sound has arrived (or turned out to be missing). The row is not rebuilt: its picture
   and any control the person is already using stay as they are; only the parts that depend on the
   audio change. */
function showLoaded(t) {
  const el = t.el;
  if (!el) return;
  const d = baseDur(t);
  el.querySelectorAll('.dur, .tdur').forEach(x => x.textContent = d);
  el.querySelectorAll('.test, .seam').forEach(b => b.disabled = !t.buffer);
  if (t.missing && !el.querySelector(':scope > .warn')) {
    el.classList.add('missing');
    el.querySelector('.dot').outerHTML = trackDot(t);
    el.querySelector(':scope > .top').insertAdjacentHTML('afterend', missingLine(t));
    wireMissing(t, el);
  }
  updateLive(); updateWhyOff(); applyFind();
}
/* Opening a composition: the rows appear one after another, from the top. Only then, never for a
   sound added later. The delay stops growing after a dozen rows, so a long list is not held back. */
function cascadeRows(tracks) {
  tracks.forEach((t, i) => {
    const el = t.el;
    el.style.setProperty('--i', Math.min(i, 12));
    el.classList.add('enter');
    el.addEventListener('animationend', e => {
      if (e.target === el && e.animationName === 'row-in') { el.classList.remove('enter'); el.style.removeProperty('--i'); }
    });
  });
}
async function addTrack(t, mark = true) {
  attachTrack(t);
  if (await loadTrack(t) && mark) markDirty();
}
async function addFromLibrary(item, quiet) {
  let buf;
  try { buf = await loadBuffer(item.path); } catch (e) { toast('Couldn\'t read this file'); return; }
  if (!cur) return;
  const t = defaults(item.path, item.name);
  if (buf.duration < 8) t.mode = 'interval';   // short sounds start out "at intervals"
  await addTrack(t);
  if (t.el) t.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (!quiet) toast(`“${t.name}” added to this composition`);
}
/* Removing a sound is instant, as it should be — but never final: the message offers it back,
   with every setting, for as long as it is on screen (or Ctrl+Z). */
let undoRemove = null;
function removeTrack(t) {
  const at = cur.tracks.indexOf(t), snap = toJson(t), name = t.name;
  stopTrackTest(t);
  if (focusT === t) unfocusTrack();
  stopSources(t);
  try { disposeChain(t.nodes); } catch (e) {}
  cur.tracks = cur.tracks.filter(x => x !== t);
  t.el.remove(); t.el = null;
  refreshGains(); updateEmpty(); markDirty();
  undoRemove = { snap, at, comp: cur };
  toast(`“${name}” removed`, { action: 'Undo', onAction: putBackTrack });
}
async function putBackTrack() {
  const u = undoRemove;
  if (!u || u.comp !== cur) return;
  undoRemove = null;
  const t = fromJson(u.snap);
  attachTrack(t, u.at);
  await loadTrack(t);
  markDirty();
  toast(`“${t.name}” is back`);
}

/* ---------- library ---------- */
const GROUPS = {
  preset: ['With your settings', 'Sounds you saved with the bookmark button, with their volume, effects and picture.'],
  own: ['Recordings', 'The audio files in your sounds folder.'],
  fs: ['From Freesound', 'Sounds you fetched while making a composition.']
};
const groupOf = i => i.preset ? 'preset' : i.fs ? 'fs' : 'own';
function renderLibrary() {
  const q = $('search').value.trim().toLowerCase(), el = $('libList');
  el.innerHTML = '';
  if (!library.length) {
    el.innerHTML = `<p class="hint">You have no sounds yet.<br><br>Look for some under <b>Freesound</b> above,
      or add your own files below.</p>`;
    return;
  }
  const items = library.filter(i => !q || (i.name + ' ' + i.path).toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = '<p class="hint">None of your sounds match that search.</p>'; return; }
  const many = new Set(items.map(groupOf)).size > 1;
  let group = null;
  items.forEach(i => {
    const g = groupOf(i);
    if (g !== group && many) {
      group = g;
      const h = document.createElement('div'); h.className = 'lib-group';
      h.innerHTML = `${esc(GROUPS[g][0])}<small>${esc(GROUPS[g][1])}</small>`;
      el.appendChild(h);
    }
    const audio = i.preset ? i.data.file : i.path;
    const sub = i.preset ? describePreset(i.data) : i.path.slice(DIR.sounds.length + 1, i.path.lastIndexOf('/') + 1);
    const row = document.createElement('div'); row.className = 'lib-item';
    const playingThis = pv && pv.key === 'lib:' + audio;
    row.innerHTML = `<button class="icon pv" title="Listen" aria-label="Listen to ${esc(i.name)}">${ICO.play}</button>
      <div class="li-name"><span title="${esc(audio)}">${esc(i.name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <button class="icon add" title="${i.preset ? 'Add with all its settings' : 'Add to this composition'}" aria-label="Add ${esc(i.name)} to this composition">${ICO.plus}</button>
      <button class="icon rm" title="Delete the file for good" aria-label="Delete ${esc(i.name)}">${ICO.trash}</button>`;
    const pb = row.querySelector('.pv');
    if (playingThis) { setPvBtn(pb, true); pv.btn = pb; }
    pb.onclick = () => togglePreview(audio, pb);
    row.querySelector('.add').onclick = () => i.preset ? addPreset(i) : addFromLibrary(i);
    row.querySelector('.rm').onclick = () => i.preset ? deletePreset(i) : deleteSound(i);
    if (i.preset) { row.querySelector('.rm').title = 'Forget these settings (the audio file stays)'; presetImage(i, row); }
    el.appendChild(row);
  });
}
/* ---------- saved sounds (presets) ---------- */
function describePreset(d) {
  const fx = Object.values(d.filters && typeof d.filters === 'object' ? d.filters : {}).filter(v => v > 0).length;
  return MODES[pick(d.mode, MODES, 'loop')] + (d.seamlessLoop ? ' · seamless' : '') + (fx ? ` · ${plural(fx, 'effect', 'effects')}` : '');
}
async function savePreset(t) {
  const name = t.name.trim() || 'Sound';
  const path = `${DIR.presets}/${slug(name)}.json`;
  if (await exists(path)) {
    const ok = await dialog({
      title: `Replace the saved sound “${name}”?`,
      body: `<p>You already have a saved sound with this name. Its volume, position, filters and picture will be
        replaced by the ones this sound has now.</p>`,
      actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Replace it', kind: 'primary', value: true }]
    });
    if (!ok) return;
  }
  try {
    const data = toJson(t); data.name = name; data.version = 2;
    await writeFile(path, JSON.stringify(data, null, 2));
    await scanLibrary(); renderLibrary();
    if (t.el) setKeepBtn(t);
    toast(`“${name}” saved to your sounds`);
  } catch (e) { toast('Couldn\'t save the sound'); }
}
async function addPreset(item) {
  if (!cur) return;
  const t = fromJson(item.data);
  await addTrack(t);
  if (t.el) t.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  toast(`“${item.name}” added to this composition`);
}
async function deletePreset(item) {
  const ok = await dialog({
    title: `Forget the settings saved as “${item.name}”?`,
    body: `<p>Only the saved settings are removed. The audio file stays in your sounds, and the compositions
      that already use it do not change.</p>`,
    actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Forget them', kind: 'danger fill', value: true }]
  });
  if (!ok) return;
  try {
    const [d, n] = split(item.path);
    await (await dirAt(d, false)).removeEntry(n);
    await scanLibrary(); renderLibrary(); toast('Saved sound deleted');
  } catch (e) { toast('Couldn\'t delete it'); }
}
async function deleteSound(item) {
  // where is this sound used?
  const used = comps.filter(c => c.file !== (cur && cur.file) && c.data.tracks.some(t => t.file === item.path)).map(c => c.data.name || 'Untitled');
  const inCur = cur && cur.tracks.some(t => t.file === item.path);
  if (inCur) used.unshift((cur.name || $('title').value.trim() || 'this composition') + ' (open now)');
  const ok = await dialog({
    title: `Delete “${item.name}” for good?`,
    body: `<p>This removes the audio file from your folder.</p>`,
    files: [item.path],
    after: used.length ? `<p>It is used in: <b>${esc(used.join(', '))}</b>. There it will show as a missing file.</p>` : '',
    danger: 'This cannot be undone. A browser cannot send files to the recycle bin.',
    actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { spacer: true }, { label: 'Delete forever', kind: 'danger fill', value: true }]
  });
  if (!ok) return;
  try {
    if (pv && pv.key === 'lib:' + item.path) stopPreview();
    const [d, n] = split(item.path);
    await (await dirAt(d, false)).removeEntry(n);
    buffers.delete(item.path);
    if (cur) cur.tracks.filter(t => t.file === item.path).forEach(t => {
      stopSources(t); t.st = null; t.buffer = null; t.missing = true; replaceEl(t);
    });
    await scanLibrary(); renderLibrary(); refreshGains();
    toast('Sound deleted');
  } catch (e) { toast('Couldn\'t delete the file'); }
}
async function importFiles(files) {
  let n = 0;
  for (const f of files) {
    if (!AUDIO_RE.test(f.name)) continue;
    const ext = f.name.match(/\.[^.]+$/)[0].toLowerCase();
    try { await writeFile(await freeName(DIR.sounds, f.name.slice(0, -ext.length), ext), f); n++; } catch (e) {}
  }
  if (n) { await scanLibrary(); renderLibrary(); toast(`${plural(n, 'sound', 'sounds')} added to your sounds`); }
  else toast('No audio files to add', { kind: 'info' });
}

/* ---------- Freesound ---------- */
const FS_API = 'https://freesound.org/apiv2/search/';
let fsKey = null, fsNext = null, fsResults = [], fsReq = 0, keyEditing = false;

function updateFsUI() { $('fsKeyBox').hidden = !!fsKey && !keyEditing; $('fsMain').hidden = !fsKey || keyEditing; }
function licLabel(u = '') {
  u = String(u).toLowerCase();
  if (u.includes('zero') || u.includes('creative commons 0')) return 'CC0';
  if (u.includes('by-nc') || u.includes('noncommercial')) return 'BY-NC';
  if (u.includes('sampling')) return 'Sampling+';
  if (u.includes('/by') || u.includes('attribution')) return 'BY';
  return 'Licence';
}
/* the licence in words, since "BY-NC" means nothing to most people */
const LIC_TEXT = { CC0: 'Free to use', BY: 'Credit the author', 'BY-NC': 'Credit, not for commercial use', 'Sampling+': 'Credit, some limits', Licence: 'See its licence' };
const licText = u => LIC_TEXT[licLabel(u)] || 'See its licence';
function withToken(u) { const x = new URL(u); x.protocol = 'https:'; x.searchParams.set('token', fsKey); return x.toString(); }
const nk = n => { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n); };
const fsFile = s => `${DIR.freesound}/${slug(s.name).slice(0, 60)}-${s.id}.mp3`;

async function fsSearch(more) {
  const list = $('fsList');
  let url;
  if (more) url = fsNext;
  else {
    const q = $('fsQ').value.trim();
    if (!q) return;
    const p = new URLSearchParams({ query: q, fields: 'id,name,username,duration,license,previews,url,num_downloads', page_size: '20', group_by_pack: '1', sort: $('fsSort').value, token: fsKey });
    const f = [$('fsDur').value && 'duration:' + $('fsDur').value, $('fsLic').value].filter(Boolean).join(' ');
    if (f) p.set('filter', f);
    url = FS_API + '?' + p;
    fsResults = [];
    list.innerHTML = '<p class="hint">Searching…</p>';
    $('fsMore').hidden = true;
  }
  const req = ++fsReq;   // if another search starts meanwhile, this answer is ignored
  try {
    const r = await fetch(url);
    if (req !== fsReq) return;
    if (r.status === 401) { list.innerHTML = '<p class="hint">Freesound didn\'t accept the key. Check it with “Change key”.</p>'; return; }
    if (r.status === 429) { toast('Too many searches in a row. Try again in a moment.', { kind: 'warn' }); return; }
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (req !== fsReq) return;
    fsResults = fsResults.concat(j.results || []);
    fsNext = j.next ? withToken(j.next) : null;
    renderFs();
  } catch (e) {
    if (req !== fsReq) return;
    if (!more) list.innerHTML = '<p class="hint">Couldn\'t reach Freesound. Check your internet connection.</p>';
    else toast('Couldn\'t load more results');
  }
}
function renderFs() {
  const el = $('fsList'); el.innerHTML = '';
  $('fsMore').hidden = !fsNext;
  if (!fsResults.length) { el.innerHTML = '<p class="hint">No sounds found. Try different words.</p>'; return; }
  fsResults.forEach(s => {
    const row = document.createElement('div'); row.className = 'lib-item';
    const have = audioPaths.has(fsFile(s));
    row.innerHTML = `<button class="icon pv" title="Listen" aria-label="Listen">${ICO.play}</button>
      <div class="li-name"><span title="${esc(s.name)}">${esc(stripExt(s.name))}</span>
        <small>${fmt(s.duration)} · <span class="lic">${esc(licText(s.license))}</span> · ${esc(s.username)}${s.n_from_same_pack ? ` · +${esc(s.n_from_same_pack)} similar in the pack` : ''}</small></div>
      <a class="icon" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open on Freesound" aria-label="Open on Freesound">${ICO.link}</a>
      <button class="icon add" title="${have ? 'Already in your sounds — add it to this composition' : 'Save to your folder and add to this composition'}" aria-label="Add to this composition">${have ? ICO.check : ICO.plus}</button>`;
    const pb = row.querySelector('.pv');
    if (pv && pv.key === 'fs:' + s.id) { setPvBtn(pb, true); pv.btn = pb; }
    pb.onclick = () => toggleFsPreview(s, pb);
    const ab = row.querySelector('.add');
    ab.onclick = () => fsAdd(s, ab);
    el.appendChild(row);
  });
}
async function addCredit(s, path) {
  let txt = '';
  try { txt = await (await readFile(CREDITS)).text(); } catch (e) {}
  if (txt.includes(s.url)) return;
  if (!txt) txt = 'Sounds downloaded from Freesound.org\nSounds with a BY or BY-NC licence require crediting the author; BY-NC sounds cannot be used commercially.\n\n';
  txt += `${path.split('/').pop()}\n  “${s.name}” by ${s.username} · ${licLabel(s.license)} · ${s.url}\n\n`;
  await writeFile(CREDITS, txt);
}
/* downloads while showing the percentage; if nothing arrives for 20 seconds it gives up */
async function downloadWithProgress(url, onPct) {
  const ac = new AbortController();
  let stall = setTimeout(() => ac.abort(), 20000);
  const poke = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(), 20000); };
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !r.body.getReader) { const b = await r.blob(); return b; }
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length; poke();
      onPct(total ? Math.min(99, Math.floor(got / total * 100)) + '%' : Math.round(got / 1048576) + ' MB');
    }
    return new Blob(parts, { type: r.headers.get('content-type') || 'audio/mpeg' });
  } finally { clearTimeout(stall); }
}
async function fsAdd(s, btn) {
  if (!cur || btn.disabled) return;
  const p = fsFile(s);
  const already = await exists(p);
  if (!already && s.duration > 600) {
    const ok = await dialog({
      title: 'This is a long sound',
      body: `<p>“${esc(s.name)}” lasts ${fmt(s.duration)}. Fetching it will download about
        ${Math.round(s.duration * 128 / 8 / 1024)} MB and may take a while.</p>`,
      actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Fetch it anyway', kind: 'primary', value: true }]
    });
    if (!ok) return;
  }
  btn.disabled = true; btn.textContent = '…';
  try {
    if (!already) {
      const blob = await downloadWithProgress(s.previews['preview-hq-mp3'], pct => { btn.textContent = pct; });
      btn.textContent = '…';
      await writeFile(p, blob);
      await addCredit(s, p);
    }
    if (!cur) { btn.disabled = false; btn.innerHTML = ICO.plus; return; }   // the composition was closed meanwhile: the file stays saved
    await addFromLibrary({ path: p, name: stripExt(s.name) }, true);
    btn.innerHTML = ICO.check;
    await scanLibrary(); renderLibrary();   // it now has a home in "From Freesound"
    toast(`“${stripExt(s.name)}” added to this composition`);
  } catch (e) {
    btn.disabled = false; btn.innerHTML = ICO.plus;
    toast(e.name === 'AbortError' ? 'The download stalled for 20 seconds and was stopped. Try again in a moment.' : 'The download failed. You can get the file from its Freesound page.', { kind: 'warn' });
  }
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
  const c = cur, title = $('title').value.trim() || 'new mix';
  const btn = $('exBtn'), st = $('exStatus'), busy = $('exBusy');
  btn.disabled = true; st.textContent = ''; busy.hidden = false;
  await new Promise(r => setTimeout(r, 30));
  try {
    const secs = +$('exDur').value * 60, sr = ctx.sampleRate, vol = c.volume;
    const off = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
    const m = off.createGain(); m.connect(off.destination);
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
    if (cur === c) st.textContent = where; else toast(`“${title}” was exported.`);
  } catch (e) {
    if (cur === c) st.textContent = 'The file couldn\'t be created. Try a shorter length.';
    else toast('The export of “' + title + '” failed.', { kind: 'warn' });
  }
  busy.hidden = true;
  btn.disabled = false;
}

/* ---------- wiring ---------- */
$('pickBtn').onclick = pickFolder;
$('changeFolder').onclick = pickFolder;
$('newComp').onclick = newComposition;
$('newComp2').onclick = newComposition;
// below 1024 the library drops under the list: this is the mouse's way to it
$('toLib').onclick = () => skipTo($('libPanel'), '#libTabs button');
// the four picture settings in immersion fold behind one pill, so the bar reads
// as weather, settings, close
$('immSetBtn').onclick = e => {
  const open = $('immSet').hidden;
  $('immSet').hidden = !open;
  e.currentTarget.classList.toggle('on', open);
  e.currentTarget.setAttribute('aria-expanded', open);
};
$('backBtn').onclick = goBack;
$('saveBtn').onclick = () => saveComp(true);
$('playBtn').onclick = () => playing ? stop() : start();
$('master').oninput = e => { cur.volume = e.target.value / 100; master.gain.setTargetAtTime(cur.volume, ctx.currentTime, 0.05); setMasterUI(); markDirty(); };
$('title').oninput = () => { sizeTitle(); markDirty(); };
$('coverBtn').onclick = () => $('coverIn').click();
$('coverChange').onclick = () => $('coverIn').click();
$('coverRemove').onclick = () => {
  if (!cur) return;
  const was = { cover: cur.cover, pending: cur.coverPending, url: cur.coverUrl }, c = cur;
  cur.cover = null; cur.coverPending = null; cur.coverUrl = null;
  setCover(null); markDirty();
  toast('Cover removed — the picture file stays in your folder', { action: 'Undo', onAction: () => {
    if (cur !== c) return;
    cur.cover = was.cover; cur.coverPending = was.pending; cur.coverUrl = was.url;
    setCover(cur.coverUrl); markDirty();
  } });
};
$('coverIn').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !cur) return;
  if (!isImage(f)) return notAPicture();
  cur.coverPending = f; cur.coverUrl = URL.createObjectURL(f);
  setCover(cur.coverUrl); markDirty();
};
/* a sound whose file has gone can be pointed at the file again, keeping all its settings */
let relinkTarget = null;
$('relinkIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  const t = relinkTarget; relinkTarget = null;
  if (!f || !t || !cur || !cur.tracks.includes(t)) return;
  if (!AUDIO_RE.test(f.name)) { toast('That is not an audio file.', { kind: 'warn' }); return; }
  try {
    const ext = f.name.match(/\.[^.]+$/)[0].toLowerCase();
    const path = await freeName(DIR.sounds, f.name.slice(0, -ext.length), ext);
    await writeFile(path, f);
    t.file = path; t.missing = false; t.buffer = null;
    await loadTrack(t);
    await scanLibrary(); renderLibrary();
    updateEmpty(); markDirty();
    toast('Found it. The sound keeps all its settings.');
  } catch (e2) { toast('Couldn\'t copy that file into your folder.'); }
};
/* A long title is made smaller rather than cut off mid-word, and the full text is always
   there as a tooltip. */
function sizeTitle() {
  const el = $('title'), n = el.value.length;
  el.classList.toggle('t-long', n > 38 && n <= 56);
  el.classList.toggle('t-xlong', n > 56 && n <= 72);
  el.classList.toggle('t-xxlong', n > 72);
  el.title = el.value;
}
/* The description: Enter or clicking away keeps it, Escape puts back what was there. It is one
   paragraph, so line breaks become spaces. */
let descWas = '';
function setDesc(text) {
  const d = $('desc');
  d.textContent = text || '';
  d.title = text || '';
}
(() => {
  const d = $('desc');
  if (d.contentEditable !== 'plaintext-only') {    // browsers without plain-text editing: paste the text only
    d.contentEditable = 'true';
    d.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  }
  d.addEventListener('focus', () => { descWas = cur ? cur.description : ''; });
  d.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); d.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.textContent = descWas; d.blur(); }
  });
  d.addEventListener('input', () => { if (!d.textContent) d.textContent = ''; });   // keeps it truly empty, so the sample can show
  d.addEventListener('blur', () => {
    if (!cur) return;
    const v = d.textContent.replace(/\s+/g, ' ').trim();
    setDesc(v);
    if (v !== cur.description) { cur.description = v; markDirty(); }
  });
})();
$('search').oninput = renderLibrary;
$('rescan').onclick = async () => { await scanLibrary(); renderLibrary(); toast('Your sounds refreshed', { kind: 'info' }); };
$('exBtn').onclick = exportMix;
document.querySelectorAll('#libTabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#libTabs button').forEach(x => x.classList.toggle('on', x === b));
  placePill($('libTabs'), true);
  $('paneMine').hidden = b.dataset.tab !== 'mine';
  $('paneFs').hidden = b.dataset.tab !== 'fs';
  if (b.dataset.tab === 'fs' && fsKey) $('fsQ').focus();
});
/* The key is checked straight away, so nobody is left wondering whether the hardest step worked.
   "Change key" keeps the old one until a new one is accepted. */
$('fsKeySave').onclick = async () => {
  const k = $('fsKeyIn').value.trim(), msg = $('fsKeyMsg'), btn = $('fsKeySave');
  msg.hidden = false;
  if (!k) { msg.textContent = 'Paste your key first.'; return; }
  msg.textContent = 'Checking…'; btn.disabled = true;
  let ok = false;
  try {
    const r = await fetch(FS_API + '?' + new URLSearchParams({ query: 'rain', page_size: '1', fields: 'id', token: k }));
    ok = r.ok;
    if (r.status === 401) msg.textContent = 'Freesound didn\'t accept that key. Copy the code shown under “Client secret/Api key” and try again.';
    else if (!r.ok) msg.textContent = 'Couldn\'t reach Freesound. Check your internet connection and try again.';
  } catch (e) { msg.textContent = 'Couldn\'t reach Freesound. Check your internet connection and try again.'; }
  btn.disabled = false;
  if (!ok) return;
  fsKey = k; await kv.put('fsKey', k);
  keyEditing = false; msg.hidden = true; $('fsKeyCancel').hidden = true;
  updateFsUI(); $('fsQ').focus();
  toast('Key accepted — you can search Freesound now');
};
$('fsKeyReset').onclick = () => {
  keyEditing = true; $('fsKeyIn').value = ''; $('fsKeyCancel').hidden = false; $('fsKeyMsg').hidden = true;
  updateFsUI(); $('fsKeyIn').focus();
};
$('fsKeyCancel').onclick = () => { keyEditing = false; $('fsKeyCancel').hidden = true; $('fsKeyMsg').hidden = true; updateFsUI(); };
$('fsForm').onsubmit = e => { e.preventDefault(); clearTimeout(fsTypeT); fsSearch(false); };
let fsTypeT = null;
$('fsQ').oninput = () => { clearTimeout(fsTypeT); fsTypeT = setTimeout(() => { if ($('fsQ').value.trim()) fsSearch(false); }, 600); };
$('fsSort').onchange = $('fsDur').onchange = $('fsLic').onchange = () => { if ($('fsQ').value.trim()) fsSearch(false); };
$('fsMore').onclick = () => fsSearch(true);
$('fileIn').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => importFiles([...e.dataTransfer.files]));
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if ($('vEditor').hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveComp(true); return; }
  // undo the last removal, for as long as its message is on screen
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undoRemove && $('toast').classList.contains('show')) {
    e.preventDefault(); hideToast(); putBackTrack(); return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  // in immersion the space bar always starts and stops; F switches to full screen
  if (immOpen && e.code === 'Space') { e.preventDefault(); playing ? stop() : start(); return; }
  if (immOpen && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); return; }
  const typing = document.activeElement && document.activeElement.isContentEditable;
  if (e.code === 'Space' && !typing && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) {
    e.preventDefault(); playing ? stop() : start();
  }
});

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
  fxRAF = requestAnimationFrame(fxLoop);
}
function fxLoop(t) {
  const dt = Math.min(0.05, (t - fxLast) / 1000); fxLast = t;
  const c = fxCtx();
  c.clearRect(0, 0, fxW, fxH);
  c.globalCompositeOperation = fxDef.blend || 'source-over';
  for (const p of fxParts) { if (!fxDef.step(p, dt)) fxDef.init(p, fxW, fxH, false); fxDef.draw(c, p); }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  fxRAF = requestAnimationFrame(fxLoop);
}
function renderFxChips() {
  const el = $('fxChips'); el.innerHTML = '';
  [['', 'None'], ...Object.entries(FX).map(([k, v]) => [k, v.label])].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'imm-btn' + ((cur.effect || '') === k ? ' on' : '');
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
function setImmBg() {
  const url = cur.bgUrl || cur.coverUrl, bg = $('immBg'), blur = $('immBlur');
  bg.hidden = !url;
  if (url && bg.getAttribute('src') !== url) {
    bg.src = url; blur.src = url;
    bg.onload = () => $('imm').classList.toggle('pale', immPale(bg));
  }
  if (!url) $('imm').classList.remove('pale');
  bg.classList.toggle('fill', !!cur.fill);
  blur.hidden = !url || !!cur.fill;
  $('immFillBtn').classList.toggle('on', !!cur.fill);
  bg.classList.toggle('pixel', !!cur.pixel);
  $('immPixelBtn').classList.toggle('on', !!cur.pixel);
  $('immCoverBtn').hidden = !(cur.bgUrl && cur.coverUrl);
}
function wake() {
  $('imm').classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (immOpen) $('imm').classList.add('idle'); }, 2800);
}
async function openImmersion() {
  if (!cur || immOpen) return;
  immOpen = true;
  const el = $('imm');
  $('immTitle').textContent = $('title').value.trim() || 'Untitled';
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
document.addEventListener('fullscreenchange', () => $('immFsBtn').classList.toggle('on', !!document.fullscreenElement));
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
  if (e.key === 'Escape') { closeImmersion(); return; }
  if (e.key !== 'Tab') return;
  const f = immFocusables();
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  e.preventDefault();
  f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
}, true);
if ('ResizeObserver' in window) new ResizeObserver(() => { if (immOpen && fxDef) startFx(cur.effect); }).observe($('imm'));
else window.addEventListener('resize', () => { if (immOpen && fxDef) startFx(cur.effect); });

window.addEventListener('beforeunload', e => { if (cur && (cur.dirty || saveFail)) { e.preventDefault(); e.returnValue = ''; } });

/* The play bar is pinned while you scroll. When it is, it gets a solid strip behind it so the
   page does not show through the one control you use most. */
if ('IntersectionObserver' in window) {
  new IntersectionObserver(
    ([e]) => $('transport').classList.toggle('stuck', !e.isIntersecting),
    { rootMargin: '-13px 0px 0px 0px', threshold: 0 }
  ).observe($('tSentinel'));
}
/* Two links, reachable only by keyboard, that jump past the long list of sounds. */
const skipTo = (el, focusSel) => {
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const f = el.querySelector(focusSel);
  if (f) f.focus({ preventScroll: true });
};
$('skipLib').onclick = () => skipTo($('libPanel'), '#libTabs button');
$('skipEx').onclick = () => skipTo($('exPanel'), 'select, button');

/* Double-clicking the position slider puts the sound back in the centre. */
document.addEventListener('dblclick', e => {
  const r = e.target.closest('input[type=range].pan');
  if (!r) return;
  r.value = 0; paintRange(r); r.dispatchEvent(new Event('input', { bubbles: true }));
});

/* Keeps a copy of the app's own files so it opens without a connection, and lets it be
   installed like an ordinary program. Only where the browser allows it: never from a page
   opened straight off the disk. */
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
})();
