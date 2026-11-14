/* αtmos — your sounds: the library panel, saved sounds (presets), and adding files to the folder. */

/* ---------- library ---------- */
const GROUPS = {
  preset: ['Sounds you kept', 'With their volume, effects and picture.'],
  own: ['Recordings', 'The audio files in your sounds folder.'],
  fs: ['From Freesound', 'Saved in your folder, with their authors listed in credits.txt.']
};
const groupOf = i => i.preset ? 'preset' : i.fs ? 'fs' : 'own';
function renderLibrary() {
  const q = $('search').value.trim().toLowerCase(), el = $('libList');
  el.innerHTML = '';
  if (!library.length) {
    el.innerHTML = `<div class="lib-empty"><p>No sounds in your folder yet. Freesound has thousands of free sounds, shared by
      people around the world, and any you add are saved in your folder.</p>
      <button class="ghost sm" data-go="fs">Find sounds on Freesound</button>
      <p>Or drop your own audio files below.</p></div>`;
    el.querySelector('[data-go]').onclick = () => libTab('fs', true);
    return;
  }
  const items = library.filter(i => !q || (i.name + ' ' + i.path).toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = `<p class="hint">None of your sounds matches “${esc($('search').value.trim())}”. Try part of a word, or look on Freesound.</p>`; return; }
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
    row.innerHTML = `<button class="pic pv" title="Listen" aria-label="Listen to ${esc(i.name)}"><span class="pimg"></span><span class="pglyph">${ICO.play}</span></button>
      <div class="li-name"><span title="${esc(audio)}">${esc(i.name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <button class="add" title="${i.preset ? 'Add with all its settings' : 'Add to this composition'}" aria-label="Add ${esc(i.name)} to this composition">Add</button>
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
  const mode = pick(d.mode, MODES, 'loop');
  return MODES[mode] + (d.seamlessLoop && mode === 'loop' ? ' · join hidden' : '') + (fx ? ` · ${plural(fx, 'effect', 'effects')}` : '');
}
async function savePreset(t) {
  const name = t.name.trim() || 'Sound';
  const path = `${DIR.presets}/${slug(name)}.json`;
  if (await exists(path)) {
    const ok = await dialog({
      title: `“${name}” is already in your sounds`,
      body: `<p>Keeping it again replaces the volume, side, effects and picture kept under this name with the
        ones this sound has now.</p>`,
      actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Replace it', kind: 'primary', value: true }]
    });
    if (!ok) return;
  }
  try {
    const data = toJson(t); data.name = name; data.version = 2;
    await writeFile(path, JSON.stringify(data, null, 2));
    await scanLibrary(); renderLibrary();
    if (t.el) setKeepBtn(t);
    toast(`“${name}” kept in your sounds`);
  } catch (e) { toast(`Couldn't keep “${name}” in your sounds. Check that the folder is still there.`); }
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
    title: `Forget the settings kept as “${item.name}”?`,
    body: `<p>Only the kept settings are removed. The audio file stays in your sounds, and the compositions
      that already use it do not change.</p>`,
    actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Forget them', kind: 'danger fill', value: true }]
  });
  if (!ok) return;
  try {
    const [d, n] = split(item.path);
    await (await dirAt(d, false)).removeEntry(n);
    await scanLibrary(); renderLibrary(); toast(`Settings for “${item.name}” forgotten. The audio file stays.`);
  } catch (e) { toast('Couldn\'t forget them. Check that the folder is still there.'); }
}
async function deleteSound(item) {
  // where is this sound used?
  const used = comps.filter(c => c.file !== (cur && cur.file) && c.data.tracks.some(t => t.file === item.path)).map(c => c.data.name || 'Untitled');
  const inCur = cur && cur.tracks.some(t => t.file === item.path);
  if (inCur) used.unshift((cur.name || $('title').value.trim() || 'this composition') + ' (open now)');
  const ok = await dialog({
    title: `Delete “${item.name}” forever?`,
    body: `<p>This removes the audio file from your folder:</p>`,
    files: [item.path],
    after: used.length ? `<p>It is used in <b>${esc(used.join(', '))}</b>, where it will show as missing.</p>` : '',
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
    toast(`“${item.name}” deleted`);
  } catch (e) { toast('Couldn\'t delete the file. Check that the folder is still there.'); }
}
async function importFiles(files) {
  let n = 0;
  for (const f of files) {
    if (!AUDIO_RE.test(f.name)) continue;
    const ext = f.name.match(/\.[^.]+$/)[0].toLowerCase();
    try { await writeFile(await freeName(DIR.sounds, f.name.slice(0, -ext.length), ext), f); n++; } catch (e) {}
  }
  if (n) { await scanLibrary(); renderLibrary(); toast(`${plural(n, 'sound', 'sounds')} added to your sounds`); }
  else toast('Those files aren’t sounds αtmos can play. Use MP3, WAV, OGG, FLAC or M4A files.', { kind: 'warn', ms: 5000 });
}
