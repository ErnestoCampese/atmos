/* αtmos — a composition: its shape in memory and in the saved file, opening and leaving its screen,
   the browser's Back button, auto-save and saving. */

/* ---------- a composition ---------- */
const blank = () => ({ file: null, name: '', description: '', cover: null, coverUrl: null, coverPending: null, coverBg: false, volume: 0.8, tracks: [], dirty: false,
  archived: false, savedAt: 0,
  effect: 'fireflies', background: null, bgUrl: null, bgPending: null, pixel: false, fill: false });
const FILTER_KEYS = ['reverb', 'echo', 'muffled', 'thin', 'waves', 'movement', 'trajectory'];
const MODES = { loop: 'Continuous', interval: 'At intervals', random: 'At random' };
const defaults = (file, name) => ({ uid: uid(), file, name: name || niceName(file),
  volume: 0.7, pan: 0, mode: 'loop', crossfade: true, fade: 3, every: 10, count: 3, per: 60, varyPitch: false, varyVol: false, hitFade: 0,
  fx: { reverb: 0, echo: 0, muffled: 0, thin: 0, waves: 0, movement: 0, trajectory: 0 }, revType: 'cathedral', echoType: 'valley', trajDir: 'lr', trajRand: false,
  muted: false, solo: false, seamless: false, loopBuf: null, buffer: null, missing: false, img: null, ownMix: null });
// only images you chose yourself (a file in the folder, or a pasted link)
const cleanImg = i => !i || typeof i !== 'object' || i.id ? null : typeof i.local === 'string' && i.local ? { local: i.local }
  : typeof i.url === 'string' && /^https?:\/\/\S+$/i.test(i.url) ? { url: i.url } : null;
const cleanFx = f => Object.fromEntries(FILTER_KEYS.map(k => [k, Math.round(num((f || {})[k], 0, 0, 100))]));
const toJson = t => ({ file: t.file, name: t.name, volume: r2(t.volume), pan: r2(t.pan), mode: t.mode, crossfade: t.crossfade, crossfadeSeconds: t.fade,
  everySeconds: t.every, times: t.count, periodSeconds: t.per, varyPitch: t.varyPitch, varyVolume: t.varyVol, hitFade: t.hitFade, filters: { ...t.fx },
  reverbType: t.revType, echoType: t.echoType, trajectoryDirection: t.trajDir, trajectoryRandom: t.trajRand, seamlessLoop: t.seamless,
  image: t.img && (t.img.local ? { local: t.img.local } : { url: t.img.url }), muted: t.muted, solo: t.solo,
  ...(t.ownMix ? { ownMix: { filters: { ...t.ownMix.fx }, reverbType: t.ownMix.revType, echoType: t.ownMix.echoType } } : {}) });
// Saved files can be shared between people, so every value is checked and brought within its limits before use.
const fromJson = j => Object.assign(defaults(String(j.file), typeof j.name === 'string' ? j.name : ''), {
  volume: num(j.volume, 0.7, 0, 1), pan: num(j.pan, 0, -1, 1), mode: pick(j.mode, MODES, 'loop'),
  crossfade: !!(j.crossfade ?? true), fade: num(j.crossfadeSeconds, 3, 0.5, 10), every: num(j.everySeconds, 10, 0.5, 3600),
  count: Math.round(num(j.times, 3, 1, 600)), per: Math.round(num(j.periodSeconds, 60, 1, 3596400)),
  varyPitch: !!j.varyPitch, varyVol: !!j.varyVolume, hitFade: num(j.hitFade, 0, 0, 5),
  fx: cleanFx(j.filters), revType: pick(j.reverbType, SPACES, 'cathedral'), echoType: pick(j.echoType, ECHOES, 'valley'),
  trajDir: pick(j.trajectoryDirection, TRAJ, 'lr'), trajRand: !!j.trajectoryRandom, seamless: !!j.seamlessLoop,
  img: cleanImg(j.image), muted: !!j.muted, solo: !!j.solo,
  // optional and new: the effects as set by hand, kept while a ready-made place is chosen
  ownMix: j.ownMix && typeof j.ownMix === 'object' ? { fx: cleanFx(j.ownMix.filters), revType: pick(j.ownMix.reverbType, SPACES, 'cathedral'), echoType: pick(j.ownMix.echoType, ECHOES, 'valley') } : null });
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
  setLib(false);
  $('exStatus').textContent = '';   // a message about another composition must not follow you here
  $('exBusy').hidden = true;
  cur.ready = 0;
  renderLibrary(); updateEmpty(); updateSaveUI(); setPlayUI(); updateSoloNote();
  clearInterval(agoT);
  agoT = setInterval(() => { if (cur && !saveFail && cur.file) updateSaveUI(); }, 30000);
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
/* Opening a composition. Its screen is made complete while it is still hidden: every sound read and
   ready to play, its length known, the cover and the sounds' pictures drawn, the immersion picture read.
   Until then the screen you came from stays where it is: the line you chose keeps its light, and if
   it takes more than a moment the gold line at the top draws as the sounds arrive, and the line says
   how many are ready, with a way to stop. Only when everything is there does the screen change. */
let opening = null;   // { c, from, row, me, t } while a composition is being made ready
async function openComp(c, noPush) {
  if (opening || !root) return;
  // 'boot': reopened from the address at start-up, before any screen is on view
  const from = VIEWS.find(id => !$(id).hidden) || 'boot';
  const op = opening = { c, from, row: from === 'vHome' ? rowOf(c) : null };
  holdScreen(op);
  loadline.start(0);
  // the step in the browser's history is taken at once, so Back while it opens simply stops it
  if (!noPush) { pushView(compId(c)); op.pushed = true; }
  try {
    // the chosen line lights up at once, before the work of building the screen begins
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    await prepareComp(op);
  }
  catch (e) { if (opening === op) { cancelOpen(); toast('Couldn’t open it. Check that the folder is still there.', { kind: 'warn' }); } }
}
async function prepareComp(op) {
  const c = op.c, from = op.from, d = c.data;
  cur = Object.assign(blank(), { file: c.file, name: d.name, description: d.description || '', cover: d.cover, coverUrl: c.coverUrl, coverBg: !!d.coverAsBackground, volume: d.masterVolume,
    archived: !!d.archived, savedAt: c.mod,
    effect: d.immersion.effect, background: d.immersion.background, pixel: d.immersion.pixelArt, fill: d.immersion.fill });
  enterEditor();
  const me = op.me = cur;
  // the picture behind immersion is read now too, so immersion never opens on an empty frame
  const bgReady = !cur.background ? null : readFile(cur.background)
    .then(f => { if (cur !== me) return; cur.bgUrl = URL.createObjectURL(f); const im = new Image(); im.src = cur.bgUrl; return im.decode(); }).catch(() => {});
  // First every sound goes into the list, then the audio is loaded (three files at a time).
  // This way a save made while files are still loading can never drop a sound.
  const tracks = d.tracks.map(fromJson);
  tracks.forEach(attachTrack);
  let i = 0, got = 0;
  const n = tracks.length;
  setReady(0, n);
  openingSay(op, 0, n);
  const worker = async () => { while (i < n && cur === me) { await loadTrack(tracks[i++]); if (cur === me) { loadline.set(++got / n); setReady(got, n); openingSay(op, got, n); } } };
  await Promise.all([worker(), worker(), worker()]);
  if (opening !== op) return;
  // what is drawn on the screen: the type, the cover, each sound's picture (a picture from a link is not waited on for long)
  const cover = $('coverImg');
  await Promise.race([Promise.all([
    document.fonts.load('italic 400 44px Alegreya'), document.fonts.load('400 20px Alegreya'), document.fonts.load('500 14px "Hanken Grotesk"'),
    cover && cover.decode ? cover.decode() : null,
    ...tracks.map(t => t.imgReady), bgReady
  ].map(p => Promise.resolve(p).catch(() => {}))), wait(4000)]);
  if (opening !== op) return;
  if (from === 'boot') bootSay.end();
  await loadline.done();
  if (opening !== op) return;
  setReady(n, n);
  const focusWasThere = !document.activeElement || document.activeElement === document.body || ($(from) && $(from).contains(document.activeElement));
  opening = null; releaseScreen(op);
  cascadeRows(tracks);
  show('vEditor'); reveal();
  // the keyboard arrives with you, on the one control used most
  if (focusWasThere) try { $('playBtn').focus({ preventScroll: true }); } catch (e) {}
}
/* While a composition is being made ready, the screen you came from stays but does nothing else:
   a click or a key goes nowhere, except Cancel (or Escape), which puts everything back as it was. */
function holdScreen(op) {
  document.documentElement.classList.add('opening');
  if ($(op.from)) $(op.from).setAttribute('aria-busy', 'true');
  if (op.row) op.row.classList.add('opening');
  // the words and the way to stop appear with the gold line, only if it takes more than a moment
  op.t = setTimeout(() => {
    if (opening !== op) return;
    const acts = op.row && op.row.querySelector('.c-acts');
    if (op.from === 'boot') { $('bootCancel').hidden = false; $('bootCancel').onclick = () => cancelOpen(); }
    if (acts) {
      acts.insertAdjacentHTML('afterbegin', '<span class="opening-say" role="status"></span><button class="a open-cancel" title="Stop opening it (Esc)">Cancel</button>');
      acts.querySelector('.open-cancel').onclick = e => { e.stopPropagation(); cancelOpen(); };
    }
    openingSay(op);
  }, 200);
}
function releaseScreen(op) {
  clearTimeout(op.t);
  document.documentElement.classList.remove('opening');
  if ($(op.from)) $(op.from).removeAttribute('aria-busy');
  if (op.row) {
    op.row.classList.remove('opening');
    op.row.querySelectorAll('.opening-say, .open-cancel').forEach(x => x.remove());
  }
}
function openingSay(op, got, n) {
  if (got != null) { op.got = got; op.n = n; }
  if (!op.n) return;
  const count = `${op.got} of ${plural(op.n, 'sound', 'sounds')}`;
  if (op.row) { const say = op.row.querySelector('.opening-say'); if (say) say.textContent = `Opening… ${count}`; }
  else if (op.from === 'vWelcome' || op.from === 'boot') readingLabel(`Opening ${op.c.data.name || 'Untitled'}… ${count}`);
}
function cancelOpen(fromBack) {
  const op = opening;
  if (!op) return;
  opening = null;
  if (op.pushed && !fromBack) history.back();   // the step taken for it is taken back
  if (cur === op.me) dropComp();
  loadline.done();
  releaseScreen(op);
  if (op.from === 'vWelcome' || op.from === 'boot') {
    // the address no longer names it, so a reload brings back the list
    if (!op.pushed && (location.hash || '').length > 1) { navLock = true; try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {} navLock = false; }
    renderHome(true); show('vHome'); reveal();
  }
  else if (op.row && op.row.isConnected) { const b = op.row.querySelector('.open'); if (b) b.focus(); }
}
// nothing reaches the waiting screen but Cancel, Escape and moving between controls
document.addEventListener('click', e => {
  if (!opening || e.target.closest('.open-cancel')) return;
  e.preventDefault(); e.stopPropagation();
}, true);
document.addEventListener('contextmenu', e => { if (opening) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('keydown', e => {
  if (!opening) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelOpen(); return; }
  if (e.key === 'Tab') return;
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.open-cancel')) return;
  // the browser's own keys (reload, zoom, find, developer tools) are left alone
  const k = e.key.toLowerCase();
  if ((/^f\d+$/.test(k) && k !== 'f2') || ((e.ctrlKey || e.metaKey) && !['d', 's', 'z'].includes(k))) return;
  e.preventDefault(); e.stopPropagation();
}, true);
/* the words under the clock: what the tape is doing */
function setReady(got, n) { if (!cur) return; cur.ready = got < n ? `Getting the sounds ready… ${got} of ${n}` : 0; setPlayState(); }
function setPlayState() {
  if (!cur) return;
  $('playState').textContent = playing ? 'Playing' : cur.ready ? cur.ready : cur.tracks.some(t => t.buffer) ? 'Ready' : cur.tracks.length ? 'Its sound files are missing' : 'Add a sound to play';
}
function newComposition() { cur = blank(); pushView('new'); enterEditor(); show('vEditor'); $('title').focus(); }
function goBack() { if ((location.hash || '').length > 1) history.back(); else leaveEditor(); }
window.addEventListener('popstate', async () => {
  if (navLock || !root) return;
  const inEditor = !$('vEditor').hidden;
  const want = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (opening) { if (!want) cancelOpen(true); return; }
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
  dropComp();
  if ((location.hash || '').length > 1) { navLock = true; try { history.replaceState({}, '', location.pathname + location.search); } catch (e) {} navLock = false; }
  // the list is read again before it is shown; meanwhile this screen stays, out of reach
  $('vEditor').inert = true;
  loadline.start();
  await scanLibrary(); await loadComps();
  await loadline.done();
  renderHome(); show('vHome');
}
/* Closing the composition in memory: its sound stopped, its audio released. */
function dropComp() {
  closeImmersion();
  if (cur) cur.tracks.forEach(stopTrackTest);
  if (playing) hardStop();
  stopPreview();
  if (cur) cur.tracks.forEach(t => { stopSources(t); try { disposeChain(t.nodes); } catch (e) {} });
  if (cur && cur.bgUrl) URL.revokeObjectURL(cur.bgUrl);
  cur = null;
  undoRemove = null;
  clearInterval(agoT); agoT = null;
  buffers.clear();   // decoded audio takes a lot of memory: release it when the composition is closed
}
let autoT = null, changeN = 0, saving = null, saveFail = null, agoT = null, slowSave = false, slowT = null;
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
   never depends on reading alone, and it rides in the bar that stays pinned while you scroll.
   It stays calm while you work: a change about to be saved keeps the last "Saved"; "Saving…" shows
   only when writing takes longer than a moment; a button appears only after a failure. It speaks to a
   screen reader only when something went wrong, and once more when it is put right. */
let failSaid = false;
function updateSaveUI() {
  if (!cur) return;
  const p = $('savePlate'), b = $('saveBtn');
  p.classList.remove('saving', 'err');
  let mark, words, when = '';
  if (saveFail) { p.classList.add('err'); mark = `<span class="alert">${ICO.alert}</span>`; words = 'Could not save'; when = saveFail; }
  else if (slowSave) { p.classList.add('saving'); mark = '<span class="ring"></span>'; words = 'Saving…'; }
  else if (!cur.file) { mark = '<span class="ring"></span>'; words = 'Not in your folder yet'; }
  else { mark = '<span class="tick"></span>'; words = 'Saved in your folder'; when = agoText(cur.savedAt); }
  const html = mark + `<span>${esc(words)}</span>` + (when ? `<span class="when">${esc(when)}</span>` : '');
  if (p.innerHTML !== html) p.innerHTML = html;
  b.hidden = !saveFail;
  if (saveFail && !failSaid) { failSaid = true; $('saveAlert').textContent = 'Could not save your latest changes. The folder can’t be reached.'; }
  else if (!saveFail && failSaid) { failSaid = false; $('saveAlert').textContent = ''; $('saveSay').textContent = 'Saved again'; }
}
// only a real picture may be used as a cover, a sound's image or an immersion backdrop
const isImage = f => !!f && /^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(f.type);
const notAPicture = () => toast('That file is not a picture. Choose a JPG, PNG or WebP image.', { ms: 5000, kind: 'warn' });
function setCover(url) {
  let img = $('coverImg');
  if (url) {
    if (!img) { img = document.createElement('img'); img.id = 'coverImg'; img.alt = ''; $('coverBtn').prepend(img); }
    img.src = url;
  } else if (img) img.remove();
  $('coverPh').hidden = !!url;
  $('coverBtn').classList.toggle('has', !!url);
  $('coverActs').hidden = !url;
  $('coverBg').hidden = !url;
  setWash();
}
/* The cover, blurred, behind the whole composition: only where the writer asked for it, with the small button
   on the cover. The picture is dimmed by its own brightest part, so a pale cover is held back more than a
   dark one and the words set on the night keep their contrast over any picture. */
const WASH_TOP = 0.05;   // the most light the blurred picture may give off (relative luminance, 0 to 1)
function washDim(im) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data, lin = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    let top = 0;
    for (let i = 0; i < d.length; i += 4) top = Math.max(top, .2126 * lin(d[i]) + .7152 * lin(d[i + 1]) + .0722 * lin(d[i + 2]));
    return Math.min(1, (WASH_TOP / Math.max(top, 1e-4)) ** (1 / 2.2));
  } catch (e) { return .2; }
}
function setWash() {
  const w = $('wash'), b = $('coverBg'), on = !!(cur && cur.coverBg);
  b.setAttribute('aria-pressed', on);
  b.title = on ? 'Take the cover away from behind the page' : 'Show the cover, blurred, behind the whole page';
  const want = () => cur && cur.coverBg && !$('vEditor').hidden ? cur.coverUrl : null;
  const url = want();
  if (!url) { w.classList.remove('on'); return; }
  if (w.dataset.url === url) { w.classList.add('on'); return; }
  // decoded and measured before it is drawn, so it appears whole and already at its own strength
  const im = new Image(); im.src = url;
  im.decode().then(() => {
    if (want() !== url) return;
    w.dataset.url = url; w.style.setProperty('--dim', washDim(im).toFixed(3)); w.style.backgroundImage = cssUrl(url);
    w.classList.add('on');
  }, () => {});
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
  clearTimeout(slowT); slowT = setTimeout(() => { slowSave = true; updateSaveUI(); }, 600);
  saving = doSave(manual); await saving; saving = null;
  clearTimeout(slowT); if (slowSave) { slowSave = false; updateSaveUI(); }
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
    if (c.coverBg && c.cover) data.coverAsBackground = true;
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
