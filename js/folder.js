/* αtmos — the folder: what the browser remembers (the folder and the Freesound key), reading and
   writing files in the chosen folder, converting a folder made with the earlier Italian version, the
   welcome screen and choosing the folder, and reading the sounds it holds. */

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
/* The welcome has a few states; each says only what is true now.
   first      no folder remembered: one action, Choose a folder, and the three steps
   returning  a folder is remembered but the browser asks again: Reopen it, or choose another
   reading    a folder is being read: the action gives way to a line and an honest label
   unsupported a browser that cannot keep work in a folder: no action, a way to carry the address */
let welcomeFolder = null;
function welcomeState(state, name) {
  const first = state === 'first', ret = state === 'returning', reading = state === 'reading', un = state === 'unsupported';
  $('welcomeActions').hidden = reading || un;
  $('reopenBtn').hidden = !ret;
  $('pickBtn').textContent = ret ? 'Choose another folder' : 'Choose a folder';
  $('pickBtn').className = ret ? 'ghost lg' : 'primary lg';
  if (name) $('reopenName').textContent = name;
  $('welcomeSteps').hidden = !first;
  $('welcomeFine').hidden = !first;
  $('unsupported').hidden = !un;
  $('welcomeLead').innerHTML = ret || (reading && welcomeFolder)
    ? `Welcome back. Your compositions are in <b>${esc(name || welcomeFolder || '')}</b>.`
    : 'Layer rain, wind, voices and distant bells into a soundscape for the scene you are writing, then leave it playing while you write.';
  const note = $('welcomeNote');
  note.classList.remove('warn');
  note.hidden = !ret;
  if (ret) note.textContent = 'Your browser asks you to open it again on each visit, to keep your files private.';
  const r = $('welcomeReading');
  clearTimeout(welcomeState.t);
  r.hidden = !reading; r.classList.remove('show');
  // the line appears only if reading takes longer than a moment
  if (reading) welcomeState.t = setTimeout(() => r.classList.add('show'), 300);
}
function welcomeProblem(text) {
  const note = $('welcomeNote');
  note.hidden = false; note.classList.add('warn'); note.textContent = text;
}
const readingLabel = t => { $('welcomeStatus').textContent = t; $('bootSayText').textContent = t; };
async function boot() {
  if (!('showDirectoryPicker' in window)) { show('vWelcome'); welcomeState('unsupported'); reveal(); return; }
  await kv.open();
  if (await kv.get('root') == null && await kv.get('fsKey') == null) await importOldSettings();
  fsKey = await kv.get('fsKey'); updateFsUI();
  const h = await kv.get('root');
  if (!h) { show('vWelcome'); welcomeState('first'); reveal(); return; }
  welcomeFolder = h.name;
  // if the browser still remembers the permission, the folder is reopened straight away: no buttons at all
  let granted = false;
  try { granted = !!h.queryPermission && await h.queryPermission({ mode: 'readwrite' }) === 'granted'; } catch (e) {}
  const returning = () => {
    welcomeState('returning', h.name);
    setTimeout(() => { try { $('reopenBtn').focus(); } catch (e) {} }, 0);
  };
  $('reopenBtn').onclick = async () => {
    let p;
    try { p = await h.requestPermission({ mode: 'readwrite' }); }
    catch (e) { return welcomeProblem(e.name === 'NotFoundError' ? missingText(h.name) : `Couldn’t read ${h.name}. Your files are untouched. Try again, or choose another folder.`); }
    if (p === 'granted') await useFolder(h);
    else welcomeProblem(`αtmos can’t work without permission to change files in ${h.name}. Reopen it and say yes when your browser asks.`);
  };
  // the folder is still open to αtmos: no welcome at all; the list (or the composition in the address)
  // is read out of sight and shown once it is complete
  if (granted) {
    bootSay.start(`Opening ${h.name}…`); loadline.start();
    if (await useFolder(h)) return;
    bootSay.end(); loadline.done();
    if ($('vWelcome').hidden) { show('vWelcome'); returning(); }
    reveal();
    return;
  }
  show('vWelcome');
  returning();
  reveal();
}
const missingText = name => `${name} can’t be found. It may have been moved, renamed or deleted. Choose it again where it is now.`;
async function pickFolder() {
  let h;
  try { h = await window.showDirectoryPicker({ id: 'mixer', mode: 'readwrite' }); }
  catch (e) {
    // closing the picker without a choice changes nothing and says nothing
    if (e.name === 'AbortError') return;
    if (!$('vWelcome').hidden) welcomeProblem('Couldn’t open that folder. Choose it again, or choose another one.');
    else toast('Couldn\'t open that folder');
    return;
  }
  await useFolder(h);
}
/* Names a folder may hold without being "someone else's": αtmos's own folders, and the files a system leaves. */
const OURS = new Set(['sounds', 'compositions', 'covers', 'presets', 'exports']);
const SYSTEM_FILE = n => /^\./.test(n) || /^(desktop\.ini|thumbs\.db)$/i.test(n);
/* Opens a folder and shows the list once everything in it has been read. Returns false if it could not. */
async function useFolder(h) {
  // at start-up no screen is on view yet: the folder is read behind the night (see boot)
  const atBoot = !VIEWS.some(id => !$(id).hidden);
  let onWelcome = !$('vWelcome').hidden;
  // a question asked at start-up is asked over the welcome, never over an empty night
  const toWelcome = () => { if (onWelcome) return; loadline.done(); show('vWelcome'); welcomeState('reading', h.name); reveal(); onWelcome = true; };
  const back = () => { if (onWelcome && welcomeFolder && $('welcomeActions').hidden) welcomeState($('reopenBtn').onclick ? 'returning' : 'first', welcomeFolder); };
  try {
    const legacy = await findLegacyDirs(h);
    if (legacy.length) {
      if (atBoot) toWelcome();
      const ok = await dialog({
        title: 'This folder was made with the earlier Italian version',
        body: `<p>To use it here, its folders need their English names (suoni → sounds, composizioni → compositions,
          copertine → covers…). All your sounds, compositions and images are kept.</p>`,
        actions: [{ label: 'Not now', kind: 'quiet', value: false }, { label: 'Convert this folder', kind: 'primary', value: true }]
      });
      if (!ok) { back(); toast('Nothing was changed. Choose a different folder to continue.', { kind: 'warn' }); return false; }
      show('vWelcome');
      welcomeState('reading', h.name);
      let n = 0;
      readingLabel('Converting your folder…');
      try { await convertLegacyFolder(h, legacy, () => readingLabel(`Converting your folder… ${plural(++n, 'file', 'files')} done`)); }
      catch (e) {
        welcomeState('first');
        welcomeProblem('The conversion stopped part-way. No files were lost: open the folder again to finish it.');
        return false;
      }
    } else {
      // A folder that already holds other things is checked before αtmos writes anything into it.
      const names = [];
      for await (const [name] of h.entries()) { if (!SYSTEM_FILE(name)) names.push(name); if (names.length > 40) break; }
      if (names.length && !names.some(n => OURS.has(n))) {
        if (atBoot) toWelcome();
        const ans = await dialog({
          title: `${h.name} already holds other files`,
          body: `<p>αtmos would add its own folders beside them: sounds, compositions, covers and presets. A new, empty folder keeps them apart.</p>`,
          actions: [{ label: `Use ${h.name} anyway`, kind: 'quiet', value: 'use' }, { spacer: true }, { label: 'Choose another folder', kind: 'primary', value: 'other' }],
          focus: 'other'
        });
        if (ans !== 'use') { back(); if (ans === 'other') setTimeout(pickFolder, 0); return false; }
      }
    }
    if (onWelcome) { welcomeState('reading', h.name); readingLabel(`Opening ${h.name}…`); }
    root = h; buffers.clear();
    await kv.put('root', h);
    for (const d of [DIR.sounds, DIR.comps, DIR.covers, DIR.presets]) await root.getDirectoryHandle(d, { create: true });
    $('folderName').textContent = h.name;
    if (onWelcome || atBoot) readingLabel('Reading your sounds…');
    await scanLibrary();
    if (onWelcome || atBoot) readingLabel('Reading your compositions…');
    await loadComps();
    homeTab = 'live'; $('findComp').value = '';
    // coming back to an address that names a composition reopens it: the screen you are on stays,
    // saying how far it has got, until the composition is complete
    const want = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    const c = want && comps.find(x => compId(x) === want);
    if (c) { renderHome(); if (!onWelcome && !atBoot) show('vHome'); openComp(c, true); return true; }
    if (atBoot && !onWelcome) { bootSay.end(); await loadline.done(); }
    renderHome(true); show('vHome'); reveal();
    return true;
  } catch (e) {
    root = null;
    if (atBoot && !onWelcome) toWelcome();
    if (onWelcome) {
      welcomeState($('reopenBtn').onclick ? 'returning' : 'first', welcomeFolder || h.name);
      welcomeProblem(e.name === 'NotFoundError' ? missingText(h.name) : `Couldn’t read ${h.name}. Your files are untouched. Try again, or choose another folder.`);
    } else toast('Couldn\'t read that folder. Your files are untouched.', { kind: 'warn' });
    return false;
  }
}

// a name like "my recording.wav.mp3" should read "my recording", not "my recording.wav"
const stripExt = s => String(s).replace(/\.[^.]+$/, '').replace(/\.(wav|aiff?|mp3|flac|ogg|oga|m4a|aac|opus)$/i, '');
/* A sound is named for a writer, not for a disk: "230221_2364_FR_KidsPlaying.wav" reads "FR KidsPlaying",
   "Binaural Birds LOOP 1.wav" reads "Binaural Birds LOOP 1". The file keeps its own name. */
const niceName = s => {
  const n = stripExt(String(s).split('/').pop()).replace(/_+/g, ' ').replace(/^(\d[\d-]{3,}\s+)+/, '').replace(/\s+/g, ' ').trim();
  return n || stripExt(String(s).split('/').pop());
};
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
      (prefix === DIR.freesound + '/' ? fromFs : out).push({ path, name: niceName(name), fs: prefix === DIR.freesound + '/' });
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
  const bg = row.querySelector('.pimg');
  if (!bg) return;
  row.classList.add('has-img');
  const paint = url => { bg.style.backgroundImage = cssUrl(url); bg.classList.add('show'); };
  if (img.url) return paint(img.url);
  if (presetImgs.has(img.local)) return paint(presetImgs.get(img.local));
  readFile(img.local).then(f => { const u = URL.createObjectURL(f); presetImgs.set(img.local, u); paint(u); })
    .catch(() => { row.classList.remove('has-img'); });
}
