/* αtmos — Freesound: the key, searching, licences, downloading a sound and recording its author. */

/* ---------- Freesound ---------- */
const FS_API = 'https://freesound.org/apiv2/search/';
let fsKey = null, fsNext = null, fsResults = [], fsReq = 0, keyEditing = false;

function updateFsUI() { $('fsKeyBox').hidden = !!fsKey && !keyEditing; $('fsMain').hidden = !fsKey || keyEditing; if (!fsResults.length) fsHint(); }
/* before the first search: a few words to start from, one press each */
const FS_TRY = ['rain', 'wind', 'fireplace', 'birds', 'coffee shop', 'footsteps', 'bells', 'sea'];
function fsHint() {
  const el = $('fsList');
  el.innerHTML = `<div class="try"><p>Every sound you add is saved in your sounds folder, with its author’s name for the
    credits. Try:</p>${FS_TRY.map(w => `<button type="button">${w}</button>`).join('')}</div>`;
  el.querySelectorAll('.try button').forEach(b => b.onclick = () => { $('fsQ').value = b.textContent; fsSearch(false); });
}
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
    if (r.status === 401) { list.innerHTML = '<p class="hint">Freesound no longer accepts your key. Paste it again with Change key, below.</p>'; return; }
    if (r.status === 429) { toast('Freesound asks for a pause after many searches. Try again in a minute.', { kind: 'warn' }); return; }
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
  if (!fsResults.length) { el.innerHTML = `<p class="hint">Nothing on Freesound for “${esc($('fsQ').value.trim())}”. Try another word, or a wider length or licence.</p>`; return; }
  fsResults.forEach(s => {
    const row = document.createElement('div'); row.className = 'lib-item';
    const have = audioPaths.has(fsFile(s));
    row.innerHTML = `<button class="pic pv" title="Listen" aria-label="Listen to ${esc(niceName(s.name))}"><span class="pglyph">${ICO.play}</span></button>
      <div class="li-name"><span title="${esc(s.name)}">${esc(niceName(s.name))}</span>
        <small>${fmt(s.duration)} · <span class="lic">${esc(licText(s.license))}</span> · ${esc(s.username)}</small></div>
      <a class="icon" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open on Freesound" aria-label="Open on Freesound">${ICO.link}</a>
      <button class="add" title="${have ? 'Already in your sounds: add it to this composition' : 'Save to your folder and add to this composition'}" aria-label="Add ${esc(niceName(s.name))} to this composition">${have ? ICO.check + 'Add' : 'Add'}</button>`;
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
      body: `<p>“${esc(niceName(s.name))}” lasts ${fmt(s.duration)}. Adding it downloads about
        ${Math.round(s.duration * 128 / 8 / 1024)} MB, which may take a while.</p>`,
      actions: [{ label: 'Cancel', kind: 'quiet', value: false }, { label: 'Add it anyway', kind: 'primary', value: true }]
    });
    if (!ok) return;
  }
  btn.disabled = true; btn.textContent = 'Getting it…';
  try {
    if (!already) {
      const blob = await downloadWithProgress(s.previews['preview-hq-mp3'], pct => { btn.textContent = pct; });
      btn.textContent = 'Saving…';
      await writeFile(p, blob);
      await addCredit(s, p);
    }
    if (!cur) { btn.disabled = false; btn.textContent = 'Add'; return; }   // the composition was closed meanwhile: the file stays saved
    await addFromLibrary({ path: p, name: niceName(s.name) }, true);
    btn.disabled = false; btn.innerHTML = ICO.check + 'Added';
    await scanLibrary(); renderLibrary();   // it now has a home in "From Freesound"
    toast(`“${niceName(s.name)}” added to this composition`);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Add';
    toast(e.name === 'AbortError' ? `Couldn't add “${niceName(s.name)}”: nothing arrived for 20 seconds. Try again in a moment.`
      : `Couldn't download “${niceName(s.name)}”. Try again, or download it from its Freesound page and drop it into Your sounds.`, { kind: 'warn', ms: 6000 });
  }
}
