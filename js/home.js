/* αtmos — the list of compositions: reading them from the folder, the catalogue (In use and
   Archived, find, sort), and managing a composition from the list (rename, archive, duplicate,
   delete). */

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
  // optional and new as well: the cover shown, blurred, behind the composition's page
  if (d.coverAsBackground === true && out.cover) out.coverAsBackground = true;
  return out;
}
let brokenComps = [];   // files in the compositions folder that could not be read: shown, never skipped
async function loadComps() {
  // release the covers of the previous list, once the screen that still shows them has faded away
  const old = comps.map(c => c.coverUrl).filter(Boolean);
  if (old.length) setTimeout(() => old.forEach(u => URL.revokeObjectURL(u)), 3000);
  const list = [], broken = [];
  for await (const [name, h] of (await dirAt(DIR.comps)).entries()) {
    if (h.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
    try {
      const f = await h.getFile();
      const data = cleanComp(JSON.parse(await f.text()));
      if (!data) { broken.push(name); continue; }
      let coverUrl = null;
      if (data.cover) { try { coverUrl = URL.createObjectURL(await readFile(data.cover)); } catch (e) {} }
      list.push({ file: DIR.comps + '/' + name, data, coverUrl, mod: f.lastModified });
    } catch (e) { broken.push(name); }
  }
  comps = list.sort((a, b) => b.mod - a.mod);
  brokenComps = broken.sort();
  // the list appears only once its covers are ready to draw, so nothing pops in after it
  await Promise.race([
    Promise.all(comps.filter(c => c.coverUrl).map(c => { const im = new Image(); im.src = c.coverUrl; return im.decode().catch(() => {}); })),
    new Promise(r => setTimeout(r, 1500))
  ]);
}
/* A composition with no picture of its own gets one of four inks, chosen from its name. */
const coverIdx = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 9973; return h % 4; };
function editedText(ms) {
  if (!ms) return '';
  const d = new Date(ms), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
const missingCount = c => c.data.tracks.filter(t => audioPaths.size && !audioPaths.has(t.file)).length;
/* the sounds of a composition by name: "Waterfall · Seagull · Hawk and 9 more" says which scene it is */
const soundNames = c => {
  const n = c.data.tracks.map(t => t.name || t.file.split('/').pop().replace(/\.[^.]+$/, ''));
  if (!n.length) return 'No sounds yet';
  return n.slice(0, 3).join(' · ') + (n.length > 3 ? ` and ${n.length - 3} more` : '');
};

/* ---------- the catalogue: In use and Archived, find, sort ---------- */
let homeTab = 'live', homeSort = { key: 'mod', dir: -1 };
const compName = c => c.data.name || 'Untitled';
function renderHome(arrive) {
  const live = comps.filter(c => !c.data.archived), arch = comps.filter(c => c.data.archived);
  const none = !comps.length && !brokenComps.length;
  // the very first time there is nothing at all: one sentence, one button, nothing else
  $('homeEmpty').hidden = !none;
  $('homeTools').hidden = none; $('catalogue').hidden = none; $('newComp').hidden = none;
  $('archCount').textContent = arch.length ? String(arch.length) : '';
  document.querySelectorAll('#homeTabs button').forEach(b => {
    const on = b.dataset.tab === homeTab;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
  });
  placePill($('homeTabs'), false);
  if (none) { $('comps').innerHTML = ''; return; }
  const q = $('findComp').value.trim().toLowerCase();
  const pool = homeTab === 'arch' ? arch : live;
  const rows = pool.filter(c => !q || (compName(c) + ' ' + (c.data.description || '')).toLowerCase().includes(q));
  const k = homeSort.key, dir = homeSort.dir;
  rows.sort((a, b) => k === 'name' ? dir * compName(a).localeCompare(compName(b), undefined, { sensitivity: 'base' }) : dir * (a.mod - b.mod));
  document.querySelectorAll('#catalogue th[aria-sort]').forEach(th => {
    const key = th.querySelector('button').dataset.sort;
    th.setAttribute('aria-sort', key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none');
  });
  const body = $('comps'); body.innerHTML = '';
  rows.forEach((c, i) => {
    const tr = compRow(c);
    if (arrive && !calm()) { tr.classList.add('enter'); tr.style.setProperty('--i', Math.min(i, 12)); tr.addEventListener('animationend', () => tr.classList.remove('enter'), { once: true }); }
    body.appendChild(tr);
  });
  const showBroken = homeTab === 'live' && !q && brokenComps.length > 0;
  if (showBroken) brokenComps.forEach(n => {
    const tr = document.createElement('tr');
    tr.className = 'comp broken';
    tr.innerHTML = `<td colspan="3">Couldn’t read <b>${esc(n)}</b>. It is still in your compositions folder, untouched.</td>`;
    body.appendChild(tr);
  });
  // the states of an empty shelf, each with its own sentence
  let msg = '';
  if (!rows.length) {
    if (q) msg = `Nothing called “${$('findComp').value.trim()}”. Try part of a word${homeTab === 'live' ? ', or look in Archived' : ''}.`;
    else if (homeTab === 'arch') msg = 'Nothing archived. Archive a composition to put it out of the way: nothing is moved or deleted.';
    else msg = 'Everything you have is archived. Restore one from Archived, or make a new composition.';
  }
  $('catEmpty').hidden = !msg; $('catEmptyText').textContent = msg;
  $('findClear').hidden = !q;
  $('catalogue').querySelector('table').hidden = !rows.length && !showBroken;
}
function compRow(c) {
  const n = compName(c), miss = missingCount(c);
  const tr = document.createElement('tr');
  tr.className = 'comp';
  tr.dataset.c = coverIdx(n);
  tr._comp = c;
  const arch = !!c.data.archived;
  tr.innerHTML = `<td class="c-who"><div class="who">
      <span class="cv">${c.coverUrl ? `<img src="${c.coverUrl}" alt="">` : `<span>${esc(n.charAt(0).toUpperCase())}</span>`}</span>
      <div class="nm">
        <button class="open${c.data.name ? '' : ' untitled'}" title="Open ${esc(n)}">${esc(n)}</button>
        ${c.data.description ? `<span class="d">${esc(c.data.description)}</span>` : `<span class="snd">${esc(soundNames(c))}</span>`}
        ${miss ? `<span class="warn">${esc(plural(miss, 'sound', 'sounds'))} missing · open to find ${miss === 1 ? 'it' : 'them'}</span>` : ''}
      </div></div></td>
    <td class="c-when">${esc(editedText(c.mod))}</td>
    <td class="c-acts">${arch
      ? `<button class="a restore">Restore</button><button class="a del-forever">Delete forever…</button>`
      : `<button class="a rename" title="Rename (F2)">Rename</button><button class="a dup" title="Duplicate (Ctrl+D)">Duplicate</button><button class="a archive" title="Archive (Delete)">Archive</button>`}</td>`;
  if (c.coverUrl) tr.querySelector('.cv').style.setProperty('--glow-img', cssUrl(c.coverUrl));
  const q = s => tr.querySelector(s);
  q('.open').onclick = e => { e.stopPropagation(); openComp(c); };
  if (arch) {
    q('.restore').onclick = e => { e.stopPropagation(); setArchived(c, false); };
    q('.del-forever').onclick = e => { e.stopPropagation(); deleteForever(c); };
  } else {
    q('.rename').onclick = e => { e.stopPropagation(); startRename(c, tr); };
    q('.dup').onclick = e => { e.stopPropagation(); duplicateComp(c); };
    q('.archive').onclick = e => { e.stopPropagation(); setArchived(c, true); };
  }
  // the whole row opens it; the words on it do what they say
  tr.addEventListener('click', e => { if (!e.target.closest('button, input') && !tr.classList.contains('renaming')) openComp(c); });
  tr.oncontextmenu = e => { e.preventDefault(); openCardMenu(c, tr, tr.querySelector('.open') || tr); };
  tr.addEventListener('keydown', e => {
    if (e.target.closest('input')) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const sib = k === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      const to = sib && sib.querySelector('.open');
      if (to) { e.preventDefault(); to.focus(); }
    }
    else if (k === 'F2' && !arch) { e.preventDefault(); startRename(c, tr); }
    else if (k === 'Delete' && e.shiftKey) { e.preventDefault(); deleteForever(c); }
    else if (k === 'Delete') { e.preventDefault(); setArchived(c, !arch); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); duplicateComp(c); }
    else if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) { e.preventDefault(); openCardMenu(c, tr, tr.querySelector('.open') || tr); }
  });
  return tr;
}
$('findComp').addEventListener('input', () => renderHome());
$('findComp').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; renderHome(); } });
$('findClear').onclick = () => { $('findComp').value = ''; renderHome(); $('findComp').focus(); };
document.querySelectorAll('#homeTabs button').forEach(b => b.onclick = () => {
  if (homeTab === b.dataset.tab) return;
  homeTab = b.dataset.tab; renderHome(); placePill($('homeTabs'), true);
});
$('homeTabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const bs = [...$('homeTabs').querySelectorAll('button')], i = bs.indexOf(document.activeElement);
  const to = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length];
  e.preventDefault(); to.focus(); to.click();
});
document.querySelectorAll('#catalogue th button').forEach(b => b.onclick = () => {
  const key = b.dataset.sort;
  homeSort = homeSort.key === key ? { key, dir: -homeSort.dir } : { key, dir: key === 'name' ? 1 : -1 };
  renderHome();
});
const rowOf = c => [...$('comps').children].find(tr => tr._comp === c) || null;

/* ---------- managing a composition from the list ---------- */
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  if (openMenu._from && openMenu._from.hasAttribute('aria-haspopup')) openMenu._from.setAttribute('aria-expanded', 'false');
  openMenu.remove(); openMenu = null;
}
// a press on the button that opened the menu is left to that button, which closes it again
document.addEventListener('pointerdown', e => { if (openMenu && !e.target.closest('.menu') && !(openMenu._from && openMenu._from.hasAttribute('aria-haspopup') && openMenu._from.contains(e.target))) closeMenu(); });
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);
/* every action is a word on its row; this menu is the same list, for the context-menu key and a right click */
function openCardMenu(c, card, btn) {
  const items = c.data.archived ? [
    { label: 'Restore', key: 'Delete', run: () => setArchived(c, false) },
    { sep: true },
    { label: 'Delete forever…', key: 'Shift+Delete', danger: true, run: () => deleteForever(c) }
  ] : [
    { label: 'Open', run: () => openComp(c) },
    { label: 'Rename', key: 'F2', run: () => startRename(c, card) },
    { label: 'Duplicate', key: 'Ctrl+D', run: () => duplicateComp(c) },
    { label: 'Archive', key: 'Delete', run: () => setArchived(c, true) }
  ];
  showMenu(btn, items);
}
/* a short list of actions under the button that opened it; arrows move, Escape and Tab close it.
   With { end: true } it lines up with the button's right edge (for a button at the end of a bar). */
function showMenu(btn, items, opts) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  items.forEach(it => {
    if (it.sep) { m.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.className = it.danger ? 'danger-item' : '';
    b.innerHTML = `<span>${esc(it.label)}</span>` + (it.key ? `<span class="key">${it.key}</span>` : '');
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), h = m.offsetHeight;
  const x = opts && opts.end ? r.right - m.offsetWidth : r.left;
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, x)) + 'px';
  m.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6) + 'px';
  openMenu = m; m._from = btn;
  if (btn.hasAttribute('aria-haspopup')) btn.setAttribute('aria-expanded', 'true');
  const btns = [...m.querySelectorAll('button')];
  btns[0].focus();
  m.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(); btn.focus(); }
  });
}
/* the title becomes a field in place; the saved file follows the title, as it does in the editor */
function startRename(c, row) {
  if (!row || row.classList.contains('renaming')) return;
  const holder = row.querySelector('.open');
  if (!holder) return;
  row.classList.add('renaming');
  const box = document.createElement('span');
  box.className = 'rename-box';
  box.innerHTML = `<input class="rename-in" value="${esc(c.data.name || '')}" aria-label="Name of the composition" spellcheck="false">
    <span class="rename-hint">Enter to save · Esc to cancel</span>`;
  holder.replaceWith(box);
  const inp = box.querySelector('input');
  inp.focus(); inp.select();
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    const name = inp.value.trim();
    row.classList.remove('renaming');
    box.replaceWith(holder);
    if (!ok || !name || name === c.data.name) { holder.focus(); return; }
    const twin = comps.find(x => x !== c && (x.data.name || '') === name);
    await renameComp(c, name);
    renderHome();
    const again = rowOf(c); if (again) again.querySelector('.open').focus();
    toast(`Renamed to “${name}”`);
    if (twin) setTimeout(() => toast(`You already have a composition called “${name}”.`, { ms: 6000, kind: 'info' }), 600);
  };
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
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
    // the copy is shown where it can be seen, already being renamed
    if (homeTab !== 'live' || $('findComp').value) { homeTab = 'live'; $('findComp').value = ''; renderHome(); }
    const row = rowOf(copy);
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); startRename(copy, row); }
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
    body: `<p>This removes ${files.length === 1 ? 'this file' : 'these files'} from your folder:</p>`,
    files,
    after: `<p>Your sounds, the sounds you kept and anything you exported stay as they are.${
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
    toast(`“${name}” deleted`);
  } catch (e) { toast('Couldn\'t delete it. Check that the folder is still there.'); }
}
