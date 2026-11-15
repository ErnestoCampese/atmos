/* αtmos — wiring: the controls of every screen connected to what they do (the folder, the list, the
   play bar, the cover, title and description, the "Your sounds" panel and its tabs, the Freesound key
   and search, dropping files) and the keyboard shortcuts. */

/* ---------- wiring ---------- */
$('pickBtn').onclick = pickFolder;
// a browser that cannot keep work in a folder: the one useful act is to carry the address to Chrome or Edge
$('copyAddr').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); $('copyDone').textContent = 'Address copied. Paste it into Chrome or Edge.'; }
  catch (e) { $('copyDone').textContent = 'Copy this address into Chrome or Edge: ' + location.href; }
};
$('changeFolder').onclick = pickFolder;
$('newComp').onclick = newComposition;
$('newComp2').onclick = newComposition;
/* Your sounds: a panel that opens from "Add a sound" and docks beside the list, pushing it aside, so
   the lines you are building keep their controls in view. Where the window is too narrow to dock, it is
   a sheet across the foot of the window, and the page makes room so any line can be scrolled above it.
   Either way it stays open while you add one sound after another and while you set them, and closes
   when you press play, press Escape or close it. With nothing in your folder yet it opens on Freesound,
   the gentlest way to a first sound. */
function setLib(open, focus) {
  const p = $('libPanel'), b = $('addSound');
  if (!open && p.hidden) return;
  p.hidden = !open;
  b.setAttribute('aria-expanded', open);
  if (open) {
    if (!library.length) libTab('fs'); else renderLibrary();
    placePill($('libTabs'), false);
    showListAboveSheet();
    if (focus) setTimeout(() => { const on = $('libTabs').querySelector('button.on'); if (on) on.focus({ preventScroll: true }); }, 0);
  } else stopPreview();
}
/* Below 760px "Your sounds" is a sheet across the foot of the window. As it opens, the page moves so the
   head of the list (find, Add a sound) sits whole under the pinned play bar, with the first lines of the
   list in view between it and the sheet: what you add stays in sight while the sheet is open. */
const libIsSheet = () => matchMedia('(max-width: 759px)').matches;
function showListAboveSheet() {
  if (!libIsSheet()) return;
  const tp = $('transport'), cs = getComputedStyle(tp);
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  // the bar once pinned: its contents plus the pinned padding (--s3 above and below)
  const s3 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s3')) || 12;
  const pinned = tp.getBoundingClientRect().height - pad + s3 * 2;
  // the bar stays in the flow while pinned, so its thinner padding also lifts the list by the difference
  const lift = pad - s3 * 2;
  const top = $('libPanel').closest('.ed-main').querySelector('.tracks').getBoundingClientRect().top + scrollY - lift - pinned - s3;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}
$('addSound').onclick = () => setLib($('libPanel').hidden, true);
$('libClose').onclick = () => { setLib(false); $('addSound').focus(); };
$('libPanel').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  setLib(false); $('addSound').focus();
});
// the four picture settings in immersion fold behind one pill, so the bar reads
// as weather, settings, close
/* the picture settings in immersion fold behind one button, so the corner reads as weather, picture, full screen */
function setImmMenu(open) {
  $('immSet').hidden = !open;
  $('immSetBtn').setAttribute('aria-expanded', open);
  if (open) { const f = $('immSet').querySelector('button:not([hidden])'); if (f) f.focus(); }
}
$('immSetBtn').onclick = () => setImmMenu($('immSet').hidden);
document.addEventListener('pointerdown', e => { if (!$('immSet').hidden && !e.target.closest('.imm-menu')) setImmMenu(false); });
$('exGo').onclick = () => skipTo($('exPanel'), 'select, button');
/* below 1200px, Immersion and Export are one "More" menu at the end of the play bar */
$('moreBtn').onclick = () => {
  if (openMenu && openMenu._from === $('moreBtn')) { closeMenu(); return; }
  const items = [{ label: 'Immersion', run: openImmersion }];
  if (!$('exGo').hidden) items.push({ label: 'Export as a file', run: () => skipTo($('exPanel'), 'select, button') });
  showMenu($('moreBtn'), items, { end: true });
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
  const was = { cover: cur.cover, pending: cur.coverPending, url: cur.coverUrl, bg: cur.coverBg }, c = cur;
  cur.cover = null; cur.coverPending = null; cur.coverUrl = null; cur.coverBg = false;
  setCover(null); markDirty();
  toast('Cover removed — the picture file stays in your folder', { action: 'Undo', onAction: () => {
    if (cur !== c) return;
    cur.cover = was.cover; cur.coverPending = was.pending; cur.coverUrl = was.url; cur.coverBg = was.bg;
    setCover(cur.coverUrl); markDirty();
  } });
};
$('coverBg').onclick = () => { if (!cur || !cur.coverUrl) return; cur.coverBg = !cur.coverBg; setWash(); markDirty(); };
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
  if (!AUDIO_RE.test(f.name)) { toast('That file isn’t a sound. Choose an MP3, WAV, OGG, FLAC or M4A file.', { kind: 'warn' }); return; }
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
  $('spineText').textContent = el.value.trim() || 'Untitled';
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
  $('spineDesc').textContent = text || '';
}
(() => {
  const d = $('desc');
  // the insert inks as many lines as the description has: it needs to know how tall it is
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (d.offsetHeight) d.parentElement.style.setProperty('--desc-h', d.offsetHeight + 'px'); }).observe(d);
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
/* the panel's two tabs: a real tablist, with the arrow keys moving between them */
function libTab(tab, focus) {
  document.querySelectorAll('#libTabs button').forEach(x => {
    const on = x.dataset.tab === tab;
    x.classList.toggle('on', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
  });
  placePill($('libTabs'), true);
  $('paneMine').hidden = tab !== 'mine';
  $('paneFs').hidden = tab !== 'fs';
  if (focus) { if (tab === 'fs' && fsKey) $('fsQ').focus(); else if (tab === 'fs') $('fsKeyIn').focus(); else $('tabMine').focus(); }
}
document.querySelectorAll('#libTabs button').forEach(b => b.onclick = () => libTab(b.dataset.tab, b.dataset.tab === 'fs'));
$('libTabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const bs = [...$('libTabs').querySelectorAll('button')], i = bs.indexOf(document.activeElement);
  const to = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
  e.preventDefault(); libTab(to.dataset.tab); to.focus();
});
/* The key is checked straight away, so nobody is left wondering whether the hardest step worked.
   "Change key" keeps the old one until a new one is accepted. */
$('fsKeySave').onclick = async () => {
  const k = $('fsKeyIn').value.trim(), msg = $('fsKeyMsg'), btn = $('fsKeySave');
  msg.hidden = false;
  if (!k) { msg.textContent = 'Paste your key first.'; return; }
  msg.textContent = 'Checking the key with Freesound…'; btn.disabled = true;
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
  toast('Key accepted. You can search Freesound now.');
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
  // F switches to full screen in immersion
  // in immersion the space bar plays and stops when nothing else has the focus; on another button it presses that button
  if (immOpen && e.code === 'Space') {
    const a = document.activeElement;
    if (!a || a === document.body || a === $('imm') || a === $('immPlay')) { e.preventDefault(); playing ? stop() : start(); }
    return;
  }
  if (immOpen && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); return; }
  const typing = document.activeElement && document.activeElement.isContentEditable;
  if (e.code === 'Space' && !typing && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) {
    e.preventDefault(); playing ? stop() : start();
  }
});
