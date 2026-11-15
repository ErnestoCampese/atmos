/* αtmos — the sounds of a composition: the sliding segmented controls, each line of the tracklist
   and its drawer, their order, the picture of each sound, and adding and removing sounds. */

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
watchSeg($('homeTabs')); watchSeg($('libTabs'));

/* ---------- sounds in the composition: the tracklist ----------
   Each sound is one line of the insert. At rest it keeps only what a listener touches: its number
   (which is also the handle that reorders it), its picture (which is also "listen to it alone"), its
   name in the writer's type with a line of status, a silence switch with its volume, and an opener
   that says in words what is inside. Everything else lives in the drawer under the line, opened by
   the opener and by nothing else: a click on the line itself does nothing. */
/* which side, in words like the effects: nobody has to know what "Left 40" sounds like */
const panLabel = v => {
  const n = Math.round(Math.abs(v) * 100), side = v < 0 ? 'left' : 'right';
  return n < 5 ? 'Centre' : n < 35 ? 'Slightly ' + side : n < 85 ? side.charAt(0).toUpperCase() + side.slice(1) : 'Far ' + side;
};
const missingLine = t => `<p class="warn"><b>File not found:</b> <span>${esc(t.file.split('/').pop())} is no longer in your sounds folder.</span>
       <button class="ghost sm relink">Find the file</button>
       <button class="quiet sm dropit">Remove</button></p>`;
function wireMissing(t, el) {
  el.querySelector('.relink').onclick = () => { relinkTarget = t; $('relinkIn').click(); };
  el.querySelector('.dropit').onclick = () => removeTrack(t);
}
const num2 = i => String(i + 1).padStart(2, '0');
const OWN_MIX = 'Your own place';
/* under the name, in words: how it plays, then the place it is in or how many effects it has */
function fxWords(t) {
  const w = placeOf(t), n = fxCount(t);
  return w && w !== 'none' ? PLACES.find(p => p[0] === w)[1] : n ? plural(n, 'effect', 'effects') : '';
}
const openerText = t => MODES[t.mode] + (fxWords(t) ? ' · ' + fxWords(t) : '');
const muteIcon = on => on ? ICO.volX : ICO.vol;
/* How much of an effect, chosen among its words: each word is a set amount. An amount saved earlier
   that lies between two words shows the nearer one and keeps sounding as it is until another is chosen. */
const AMOUNTS = [[0, 'Off'], [22, 'A little'], [50, 'Medium'], [80, 'Strong']];
const PASSING = [[0, 'Off'], [20, 'Slight'], [50, 'Halfway'], [100, 'Side to side']];
const amountsOf = k => k === 'trajectory' ? PASSING : AMOUNTS;
const amountAt = (k, v) => !v ? 0 : k === 'trajectory' ? (v < 35 ? 1 : v < 75 ? 2 : 3) : (v < 34 ? 1 : v < 67 ? 2 : 3);
/* What each effect does. Where an effect has a choice of its own (which space, how far, which way), the sentence
   ends in that choice once the effect is on; while it is off the sentence ends in plain words: [start, on, off] */
const FX_SAY = {
  reverb: ['Lingers after it stops, as in', '', ' a hall or a cave'],
  echo: ['Repeats that bounce left and right and slowly die away', ', as from', ''],
  trajectory: ['Each time it plays, it moves across like something passing', ',', '']
};
const FX_TEXT = { muffled: 'Takes the brightness away: far off, behind a window' };
const ECHO_FROM = { near: 'nearby walls', valley: 'a valley', mountain: 'a mountain' };
/* which side: a listener seen from the front under half a circle, the sound a dot on it. The dot is dragged along
   the arc; the same setting is a slider for the keyboard and for screen readers, kept out of sight */
const SIDE_FIG = `<svg class="side-fig" viewBox="0 0 200 112" width="200" height="112" aria-hidden="true" focusable="false">
  <rect class="sf-hit" width="200" height="112"/>
  <path class="sf-arc" d="M18 96A82 82 0 0 1 182 96"/>
  <text class="sf-lr" x="2" y="100">L</text><text class="sf-lr" x="198" y="100" text-anchor="end">R</text>
  <g class="sf-l"><path d="M80 51a11 11 0 0 0 0 15"/><path d="M74 46a17 17 0 0 0 0 25"/></g>
  <g class="sf-r"><path d="M120 51a11 11 0 0 1 0 15"/><path d="M126 46a17 17 0 0 1 0 25"/></g>
  <path class="sf-body" d="M86 53a4 6 0 0 0 0 11M114 53a4 6 0 0 1 0 11M70 96c1-8 12-12 24-14v-8M130 96c-1-8-12-12-24-14v-8"/>
  <ellipse class="sf-body" cx="100" cy="58" rx="14" ry="17"/>
  <g class="sf-dot"><circle r="8"/><circle r="3.5"/></g>
</svg>`;
function paintSide(t, el = t.el) {
  const fig = el && el.querySelector('.side-fig'); if (!fig) return;
  const p = Math.max(-1, Math.min(1, t.pan)), a = p * Math.PI / 2;
  fig.querySelector('.sf-dot').setAttribute('transform', `translate(${(100 + 82 * Math.sin(a)).toFixed(1)} ${(96 - 82 * Math.cos(a)).toFixed(1)})`);
  fig.querySelector('.sf-l').style.opacity = (0.3 + 0.7 * (1 - p) / 2).toFixed(2);
  fig.querySelector('.sf-r').style.opacity = (0.3 + 0.7 * (1 + p) / 2).toFixed(2);
}
function renderTrack(t) {
  const el = document.createElement('div');
  el.className = 'track' + (t.missing ? ' missing' : '') + (t.fxOpen && !t.missing ? ' is-open' : '');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', t.name);
  const dur = baseDur(t);
  const at = cur ? Math.max(0, cur.tracks.indexOf(t)) : 0;
  const did = 'd-' + t.uid;
  const loopOpts = t.seamless ? `
    <div class="opts">Fade <input type="range" class="fade" min="0.5" max="10" step="0.5" value="${t.fade}" aria-label="Length of the fade where it joins">
      <span class="val fv">${t.fade} s</span></div>` : `
    <div class="opts">
      <label class="check"><input type="checkbox" class="cf" ${t.crossfade ? 'checked' : ''}> Fade the end into the start</label>
    </div>
    <div class="opts">Length of the fade <input type="range" class="fade" min="0.5" max="10" step="0.5" value="${t.fade}" aria-label="Length of the fade" ${t.crossfade ? '' : 'disabled'}>
      <span class="val fv">${t.fade} s</span></div>`;
  const hfLabel = v => v ? v.toFixed(1).replace('.0', '') + ' s' : 'Off';
  const varyOpts = `
      <div class="opts">Fade in and out <input type="range" class="hfade" min="0" max="5" step="0.1" value="${t.hitFade}" aria-label="Fade in and out">
        <span class="val hfv">${hfLabel(t.hitFade)}</span></div>
      <div class="opts vary">
        <label class="check"><input type="checkbox" class="vpitch" ${t.varyPitch ? 'checked' : ''}> Vary the pitch a little</label>
        <label class="check"><input type="checkbox" class="vvol" ${t.varyVol ? 'checked' : ''}> Vary the volume a little</label>
      </div>`;
  const intOpts = `
    <div class="opts">Every <input type="number" class="every" min="0.5" max="3600" step="0.5" value="${t.every}" aria-label="Seconds between repeats"> seconds</div>
    ${varyOpts}`;
  const unit = t.per % 3600 === 0 ? 3600 : t.per % 60 === 0 ? 60 : 1;
  const rndOpts = `
    <div class="opts">
      About <input type="number" class="count" min="1" max="600" step="1" value="${t.count}" aria-label="How many times"> times
    </div>
    <div class="opts">
      every <input type="number" class="perN" min="1" max="999" step="1" value="${t.per / unit}" aria-label="Period">
      <select class="perU" aria-label="Unit">
        <option value="1" ${unit === 1 ? 'selected' : ''}>seconds</option>
        <option value="60" ${unit === 60 ? 'selected' : ''}>minutes</option>
        <option value="3600" ${unit === 3600 ? 'selected' : ''}>hours</option>
      </select>
    </div>
    ${varyOpts}`;
  const options = (obj, sel, label = v => v.label) => Object.entries(obj).map(([v, o]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label(o)}</option>`).join('');
  const kind = {
    reverb: `<select class="kind revtype" aria-label="Kind of space">${options(SPACES, t.revType, o => 'a ' + o.label.toLowerCase())}</select>`,
    echo: `<select class="kind echotype" aria-label="Where the echo comes from">${Object.keys(ECHOES).map(v => `<option value="${v}" ${t.echoType === v ? 'selected' : ''}>${ECHO_FROM[v] || ECHOES[v].label}</option>`).join('')}</select>`,
    trajectory: `<select class="kind trajdir" aria-label="Which way it passes">${Object.entries(TRAJ).map(([v, l]) => `<option value="${v}" ${!t.trajRand && t.trajDir === v ? 'selected' : ''}>${l.toLowerCase()}</option>`).join('')}<option value="rand" ${t.trajRand ? 'selected' : ''}>by chance</option></select>`
  };
  const fxRow = ([k, label, hint]) => {
    // "Passing by" has nothing to do in a seamless loop: it stands aside, saying why, and keeps its amount for later
    const idle = k === 'trajectory' && noPassing(t);
    const at = idle ? 0 : amountAt(k, t.fx[k] || 0), say = idle ? null : FX_SAY[k];
    if (idle) hint = 'A seamless loop never starts again, so nothing passes by. Movement makes it drift from side to side instead.';
    return `
            <div class="fx-row${at ? ' is-on' : ''}${idle ? ' is-idle' : ''}" data-fx="${k}">
              <span class="fx-name" id="${did}-${k}">${label}</span>
              <div class="seg fill fx-amt" role="radiogroup" aria-labelledby="${did}-${k}" data-k="${k}"${idle ? ' aria-disabled="true"' : ''}><span class="seg-pill" aria-hidden="true"></span>${amountsOf(k).map(([v, w], i) =>
                `<button type="button" role="radio" aria-checked="${i === at}" tabindex="${i === at ? 0 : -1}" data-v="${v}"${i === at ? ' class="on"' : ''}${idle ? ' disabled' : ''}>${w}</button>`).join('')}</div>
              <p class="fx-hint">${say ? `${esc(say[0])}<span class="fx-kind">${esc(say[1])} ${kind[k]}</span><span class="fx-rest">${esc(say[2])}</span>` : esc(idle ? hint : FX_TEXT[k] || hint)}</p>
            </div>`;
  };
  const where = placeOf(t);
  const nameAttr = esc(t.name);
  el.innerHTML = `
    <span class="tbg" aria-hidden="true"></span>
    <div class="trow">
      <span class="grip" tabindex="0" role="button" title="Drag to move it, or use the up and down arrow keys" aria-label="Move ${nameAttr}"><span class="num">${num2(at)}</span>${ICO.grip}</span>
      <button class="pic test${t.pv ? ' on' : ''}" aria-pressed="${!!t.pv}" ${t.buffer ? '' : 'disabled'}><span class="pimg"></span><span class="pglyph">${t.pv ? ICO.stop : ICO.play}</span></button>
      <div class="nmcol">
        <span class="nmw"><input class="name" value="${nameAttr}" title="${nameAttr} · file: ${esc(t.file)}" spellcheck="false" aria-label="Name of the sound"><span class="ink" aria-hidden="true">${nameAttr}</span></span>
        <span class="sub"><span class="dur">${dur}</span><span class="how">${MODES[t.mode]}</span><span class="fxn">${esc(fxWords(t))}</span><span class="why-off"></span><span class="next"></span></span>
      </div>
      ${t.missing ? missingLine(t) : `
      <div class="volw">
        <button class="mute" aria-pressed="${t.muted}" aria-label="Silence ${nameAttr}" title="${t.muted ? 'Let this sound be heard again' : 'Silence this sound'}">${muteIcon(t.muted)}</button>
        <input type="range" class="vol" min="0" max="100" value="${Math.round(t.volume * 100)}" aria-label="Volume of ${nameAttr}" aria-valuetext="${Math.round(t.volume * 100)}%">
        <span class="val vpct" aria-hidden="true">${Math.round(t.volume * 100)}%</span>
      </div>
      <button class="chip only" role="switch" aria-checked="${t.solo}" title="Silences every other sound while this one is on">Only this<span class="sr"> sound</span></button>
      <button class="opener" aria-expanded="${!!t.fxOpen}" aria-controls="${did}">${ICO.sliders}<span class="otext">Settings</span><span class="sr"> of ${nameAttr}</span>${ICO.chev}</button>`}
    </div>
    <div class="fxp" id="${did}" role="region" aria-label="Settings of ${nameAttr}">
      <div class="fxp-in">
        <div class="fx-body">
          <div class="fx-own">
            <div class="fx-cell fx-how">
              <h4>How it plays</h4>
              <select class="plays" aria-label="How ${nameAttr} plays">${Object.entries(MODES).map(([m, label]) => `<option value="${m}" ${t.mode === m ? 'selected' : ''}>${label}</option>`).join('')}</select>
              ${t.mode === 'loop' ? `<label class="check" title="Trims the silence and any fade at each end, and joins the sound where its end is most like its start, so you can’t hear it begin again"><input type="checkbox" class="seam" ${t.seamless ? 'checked' : ''} ${t.buffer ? '' : 'disabled'}> Loop seamlessly</label>` : ''}
              ${{ loop: loopOpts, interval: intOpts, random: rndOpts }[t.mode]}
            </div>
            <div class="fx-cell fx-side">
              <div class="fx-head"><h4>Which side</h4><span class="val pval">${panLabel(t.pan)}</span></div>
              <div class="side"><input type="range" class="pan" min="-100" max="100" value="${Math.round(t.pan * 100)}" aria-label="Which side ${nameAttr} is on" aria-valuetext="${panLabel(t.pan)}">${SIDE_FIG}</div>
              <p class="fx-note side-tip">Drag the dot along the arc</p>
            </div>
            <div class="fx-cell fx-pic">
              <h4>Picture</h4>
              <div class="pic-row"><span class="pthumb" aria-hidden="true"></span>
                <div class="pic-acts"><div class="row"><button class="ghost sm imgown">${t.img ? 'Change' : 'Choose a picture…'}</button><button class="quiet sm imgdel" ${t.img ? '' : 'hidden'}>Remove</button></div>
                  <p class="fx-note">Or drag one onto the sound, or paste with Ctrl+V</p></div></div>
            </div>
          </div>
          <div class="fx-eff">
            <div class="fx-row fx-where">
              <h4 id="${did}-where">Where it is</h4>
              <select class="where" aria-labelledby="${did}-where">${where && !t.ownMix ? '' : `<option value="" ${where ? '' : 'selected'}>${OWN_MIX}</option>`}${PLACES.map(([id, label]) => `<option value="${id}" ${where === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
              <p class="fx-note">A ready-made place sets the effects below for you. Change any of them and the place becomes your own.</p>
            </div>${FILTERS.map(fxRow).join('')}
          </div>
        </div>
        <div class="dfoot">
          <button class="ghost sm keep"></button>
          <button class="quiet sm del">Remove from this composition</button>
        </div>
      </div>
    </div>`;

  const q = s => el.querySelector(s);
  setTestBtn(t, el);
  setKeepBtn(t, el);
  q('.test').onclick = () => trackTest(t);
  q('.grip').onkeydown = e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const a = cur.tracks, i = a.indexOf(t), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= a.length) return;
    moveTrack(t, a[j], e.key === 'ArrowDown');
    t.el.querySelector('.grip').focus();
    toast(`“${t.name}” moved to ${j + 1} of ${a.length}`, { ms: 1800 });
  };
  const nm = q('.name'), ink = q('.ink');
  nm.oninput = () => { ink.textContent = nm.value; };
  nm.onkeydown = e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = t.name; ink.textContent = t.name; e.target.blur(); } };
  nm.onchange = e => {
    t.name = e.target.value.trim() || niceName(t.file);
    e.target.value = t.name; ink.textContent = t.name; el.setAttribute('aria-label', t.name);
    setKeepBtn(t); markDirty();
  };
  wireDrawerAndDrop(t, el);
  if (t.missing) { wireMissing(t, el); return finishRow(t, el); }
  q('.mute').onclick = e => {
    const b = e.currentTarget;
    t.muted = !t.muted; b.setAttribute('aria-pressed', t.muted); b.innerHTML = muteIcon(t.muted);
    b.title = t.muted ? 'Let this sound be heard again' : 'Silence this sound';
    refreshGains(); markDirty();
  };
  q('.only').onclick = e => { t.solo = !t.solo; e.currentTarget.setAttribute('aria-checked', t.solo); refreshGains(); markDirty(); };
  q('.keep').onclick = () => savePreset(t);
  q('.opener').onclick = () => setDrawer(t, !t.fxOpen);
  /* Where it is: a ready-made place moves the effect sliders. The settings made by hand are not lost:
     they are remembered on the sound, stay in the list as "As you set it", and the change can be undone. */
  q('.where').onchange = e => {
    const id = e.target.value;
    const before = { fx: { ...t.fx }, revType: t.revType, echoType: t.echoType, ownMix: t.ownMix || null };
    if (!id) {
      if (!t.ownMix) return;
      Object.assign(t.fx, t.ownMix.fx); t.revType = t.ownMix.revType; t.echoType = t.ownMix.echoType; t.ownMix = null;
    } else {
      if (!placeOf(t) && fxCount(t)) t.ownMix = { fx: { ...t.fx }, revType: t.revType, echoType: t.echoType };
      const p = PLACES.find(x => x[0] === id)[2];
      FILTER_KEYS.forEach(k => t.fx[k] = p.fx[k]);
      if (p.revType) t.revType = p.revType;
      if (p.echoType) t.echoType = p.echoType;
    }
    setReverbType(t); applyFx(t);
    replaceEl(t); markDirty();
    const sel = t.el.querySelector('.where'); if (sel) sel.focus();
    const label = id ? PLACES.find(x => x[0] === id)[1] : OWN_MIX;
    toast(`${t.name}: ${label}`, { action: 'Undo', onAction: () => {
      if (!cur || !cur.tracks.includes(t)) return;
      Object.assign(t.fx, before.fx); t.revType = before.revType; t.echoType = before.echoType; t.ownMix = before.ownMix;
      setReverbType(t); applyFx(t); replaceEl(t); markDirty();
    } });
  };
  q('.plays').onchange = e => {
    t.mode = e.target.value;
    if (t.mode === 'loop' && t.seamless && !t.loopBuf && t.buffer) t.loopBuf = makeSeamless(t.buffer, t.fade);
    if (playing) resetTrack(t, ctx.currentTime + 0.05);
    retest(t);
    replaceEl(t); markDirty();
    t.el.querySelector('.plays').focus();
  };
  q('.vol').oninput = e => {
    t.volume = e.target.value / 100; e.target.setAttribute('aria-valuetext', e.target.value + '%'); q('.vpct').textContent = e.target.value + '%';
    if (t.pv) t.pv.g.gain.setTargetAtTime(t.volume, ctx.currentTime, 0.05);
    refreshGains(); markDirty();
  };
  q('.pan').oninput = e => {
    t.pan = e.target.value / 100; e.target.setAttribute('aria-valuetext', panLabel(t.pan)); q('.pval').textContent = panLabel(t.pan);
    t.nodes.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.03); paintSide(t, el); markDirty();
  };
  q('.revtype').onchange = e => { t.revType = e.target.value; setReverbType(t); handMade(t); markDirty(); };
  q('.echotype').onchange = e => { t.echoType = e.target.value; applyFx(t); handMade(t); markDirty(); };
  if (q('.trajdir')) q('.trajdir').onchange = e => { t.trajRand = e.target.value === 'rand'; if (!t.trajRand) t.trajDir = e.target.value; markDirty(); };
  /* an amount is chosen like a word in a list: a click, or the arrow keys once it has the focus */
  el.querySelectorAll('.fx-amt').forEach(seg => {
    const k = seg.dataset.k, bs = [...seg.querySelectorAll('button')];
    const choose = (b, focus) => {
      bs.forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
      t.fx[k] = +b.dataset.v;
      seg.closest('.fx-row').classList.toggle('is-on', t.fx[k] > 0);
      placePill(seg, true);
      if (focus) b.focus();
      handMade(t); applyFx(t); markDirty();
    };
    bs.forEach(b => b.onclick = () => { if (!b.classList.contains('on')) choose(b); });
    seg.onkeydown = e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!step) return;
      e.preventDefault();
      const to = bs[bs.indexOf(seg.querySelector('button.on')) + step]; if (to) choose(to, true);
    };
    watchSeg(seg);
  });
  /* the drawing answers to the pointer too: press or drag along it and the sound goes there */
  const fig = q('.side-fig');
  const figTo = e => {
    const r = fig.getBoundingClientRect(), pan = q('.pan');
    const x = (e.clientX - r.left) / r.width * 200 - 100, y = 96 - (e.clientY - r.top) / r.height * 112;
    pan.value = Math.round(Math.max(-1, Math.min(1, Math.atan2(x, Math.max(y, 0)) / (Math.PI / 2))) * 100);
    pan.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // the press belongs to the drawing alone: no text selection, no browser drag of it as an image.
  // The hidden slider takes the focus, so the arrow keys carry on from where the pointer left the dot.
  fig.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault(); q('.pan').focus({ preventScroll: true });
    fig.setPointerCapture(e.pointerId); fig.classList.add('held'); figTo(e);
  };
  fig.onpointermove = e => { if (fig.hasPointerCapture(e.pointerId)) figTo(e); };
  fig.onlostpointercapture = () => fig.classList.remove('held');
  fig.ondragstart = e => e.preventDefault();
  if (q('.seam')) q('.seam').onchange = e => {
    t.seamless = e.target.checked;
    setTimeout(() => { applySeamless(t); replaceEl(t); markDirty(); }, 20);
  };
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
  return finishRow(t, el);
}
function finishRow(t, el) {
  if (effectiveGain(t) === 0) el.classList.add('off');
  t.imgReady = paintTrackImage(t, el);   // opening a composition waits for it, so no picture pops in later
  paintRanges(el); paintSide(t, el);
  return el;
}
/* A slider moved by hand: these settings are now the writer's own, and the remembered ones give way to them.
   The "where it is" choice follows: a place when the sliders match one, "As you set it" when not. */
function handMade(t) {
  t.ownMix = null;
  syncWhere(t); setOpener(t);
}
function syncWhere(t) {
  const sel = t.el && t.el.querySelector('.where');
  if (!sel) return;
  const w = placeOf(t);
  let own = sel.querySelector('option[value=""]');
  if ((!w || t.ownMix) && !own) { own = document.createElement('option'); own.value = ''; own.textContent = OWN_MIX; sel.prepend(own); }
  if (w && !t.ownMix && own) own.remove();
  sel.value = w || '';
}
function setOpener(t) {
  const s = t.el && t.el.querySelector('.sub .how'); if (!s) return;
  s.textContent = MODES[t.mode];
  t.el.querySelector('.sub .fxn').textContent = fxWords(t);
}
/* the drawer under a line: opened by its opener only, closed by the opener again or by Escape inside it */
function setDrawer(t, open) {
  t.fxOpen = open;
  const el = t.el; if (!el) return;
  el.classList.toggle('is-open', open);
  const b = el.querySelector('.opener');
  if (b) b.setAttribute('aria-expanded', open);
  if (open) paintRanges(el.querySelector('.fxp'));
}
function wireDrawerAndDrop(t, el) {
  const q = s => el.querySelector(s);
  q('.fxp').addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    setDrawer(t, false); const b = el.querySelector('.opener'); if (b) b.focus();
  });
  q('.del').onclick = () => removeTrack(t);
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
  // a picture dragged onto the line becomes its picture
  el.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) { e.preventDefault(); el.classList.add('imgdrop'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('imgdrop'); });
  el.addEventListener('drop', e => {
    el.classList.remove('imgdrop');
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); e.stopPropagation(); setOwnImage(t, f); }
  });
  // reordering: drag by the number
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
}
function replaceEl(t) {
  if (!t.el) return;
  const n = renderTrack(t);
  const ob = t.el.querySelector('.pimg'), nb = n.querySelector('.pimg');
  if (t.img && ob && nb && ob.classList.contains('show') && ob.dataset.url === t.img.url) {
    nb.style.backgroundImage = ob.style.backgroundImage; nb.dataset.url = ob.dataset.url; nb.classList.add('show');
    const wide = n.querySelector('.tbg'); if (wide) wide.style.backgroundImage = ob.style.backgroundImage;
    n.classList.add('has-pic'); n.classList.toggle('pic-light', !!t.img.light);
  }
  t.el.replaceWith(n); t.el = n;
  updateLive(); updateWhyOff(); applyFind();
}
/* the numbers follow the order */
function renumber() { if (cur) cur.tracks.forEach((t, i) => { const n = t.el && t.el.querySelector('.num'); if (n) n.textContent = num2(i); }); }

/* ---------- order of the sounds ---------- */
let dragT = null;
document.addEventListener('pointerup', () => { if (!dragT) document.querySelectorAll('.track[draggable="true"]').forEach(x => x.draggable = false); });
const clearDropMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
function clearShift() { $('list').classList.remove('sorting'); document.querySelectorAll('.track.shift, .track.shift-up').forEach(x => x.classList.remove('shift', 'shift-up')); }
// lines from the landing point onwards move down a little, the one before moves up slightly
function markShift(target, after) {
  const others = cur.tracks.filter(x => x !== dragT);
  const at = others.indexOf(target) + (after ? 1 : 0);
  $('list').classList.add('sorting');
  others.forEach((x, i) => { if (!x.el) return; x.el.classList.toggle('shift', i >= at); x.el.classList.toggle('shift-up', i === at - 1); });
}
$('list').addEventListener('dragleave', e => { if (dragT && !$('list').contains(e.relatedTarget)) { clearShift(); clearDropMarks(); } });
function dropAfter(el, e) {
  // measured from the "resting" position, so the line's own shift doesn't make the choice flicker
  const r = el.getBoundingClientRect();
  const off = el.classList.contains('shift') ? 10 : el.classList.contains('shift-up') ? -4 : 0;
  return e.clientY > r.top - off + r.height / 2;
}
function moveTrack(t, target, after) {
  const a = cur.tracks;
  a.splice(a.indexOf(t), 1);
  a.splice(a.indexOf(target) + (after ? 1 : 0), 0, t);
  if (after) target.el.after(t.el); else target.el.before(t.el);
  renumber();
  markDirty();
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !cur || $('vEditor').hidden || immOpen) return;
  if (!$('libPanel').hidden) { setLib(false); $('addSound').focus(); return; }
  const open = cur.tracks.find(t => t.fxOpen && t.el && t.el.contains(document.activeElement));
  if (open) { setDrawer(open, false); const b = open.el.querySelector('.opener'); if (b) b.focus(); }
});

function updateEmpty() {
  const n = cur ? cur.tracks.length : 0;
  $('empty').hidden = n > 0;
  $('exPanel').hidden = n === 0;         // nothing to export yet: do not offer it
  $('exGo').hidden = n === 0;
  $('findBox').hidden = n <= 8;
  // with nothing in it yet, adding a sound is the one thing to do here
  $('addSound').classList.toggle('primary', n === 0); $('addSound').classList.toggle('ghost', n > 0);
  if (n <= 8 && $('findSound').value) { $('findSound').value = ''; applyFind(); }
  updateMeta();
}
/* the line at the foot of the insert: how many sounds, how many are sounding, what is missing, when it last changed */
function updateMeta() {
  if (!cur) return;
  const n = cur.tracks.length, miss = cur.tracks.filter(t => t.missing).length;
  const now = playing ? cur.tracks.filter(t => t.el && (t.el.classList.contains('live') || t.el.classList.contains('hit'))).length : 0;
  const parts = [n ? esc(plural(n, 'sound', 'sounds')) : 'No sounds yet'];
  // how much sound the tape holds: the lengths of its recordings added up, said once every one has arrived
  const have = cur.tracks.filter(t => !t.missing);
  if (have.length && have.every(t => t.buffer)) parts.push(esc(soundLength(have.reduce((a, t) => a + t.buffer.duration, 0))));
  if (now) parts.push(`<span class="now">${now} sounding now</span>`);
  if (miss) parts.push(`<span class="warn-line">${miss} missing</span>`);
  if (cur.savedAt && cur.file) parts.push('last changed ' + esc(editedText(cur.savedAt)));
  // each part keeps its words together; on a narrow window the line breaks between parts, never inside one
  const html = parts.map(x => `<span class="part">${x}</span>`).join('<span class="sep">·</span><wbr>');
  if ($('compMeta').innerHTML !== html) $('compMeta').innerHTML = html;
}
/* "23 min of sound": rounded the way a person says it */
function soundLength(s) {
  if (s < 60) return `${Math.max(1, Math.round(s))} s of sound`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min of sound`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} h${r ? ' ' + r + ' min' : ''} of sound`;
}
/* with many sounds, a field to find one by name instead of scrolling */
function applyFind() {
  const q = $('findSound').value.trim().toLowerCase();
  if (!cur) return;
  cur.tracks.forEach(t => { if (t.el) t.el.hidden = !!q && !t.name.toLowerCase().includes(q); });
}
$('findSound').oninput = applyFind;

const isSavedSound = name => library.some(i => i.preset && i.name === (String(name).trim() || 'Sound'));
function setKeepBtn(t, el = t.el) {
  const b = el && el.querySelector('.keep');
  if (!b) return;
  const on = isSavedSound(t.name);
  b.classList.toggle('is-saved', on);
  b.innerHTML = (on ? ICO.keepOn : ICO.keep) + `<span>${on ? 'Kept in your sounds' : 'Keep in your sounds'}</span>`;
  b.title = on ? 'Already kept in your sounds: keep it again to replace it'
    : 'Keeps this sound in your sounds, with its picture, effects and settings, to use it in other compositions';
}
/* a silenced sound says why it is silent, instead of only looking faded */
function updateWhyOff() {
  if (!cur) return;
  const only = cur.tracks.filter(x => x.solo);
  const names = only.map(x => x.name).join(', ');
  cur.tracks.forEach(t => {
    if (!t.el) return;
    const s = t.el.querySelector('.why-off');
    if (!s) return;
    const txt = t.muted ? 'silenced' : (only.length && !t.solo) ? `silent while only ${names} plays` : '';
    if (s.textContent !== txt) s.textContent = txt;
  });
}
/* and the bar that is always on screen says which sound is playing alone */
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
    n.insertAdjacentHTML('beforeend', `<span>Only <b>${esc(names)}</b> ${solo.length > 1 ? 'play' : 'plays'}</span>`);
    const go = document.createElement('button');
    go.className = 'quiet sm'; go.textContent = 'Show';
    go.onclick = () => { const t = solo[0]; if (!t.el) return; setDrawer(t, true); t.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.el.querySelector('.only').focus({ preventScroll: true }); };
    const clr = document.createElement('button');
    clr.className = 'quiet sm'; clr.textContent = 'Play all';
    clr.onclick = () => { cur.tracks.forEach(t => { if (t.solo) { t.solo = false; const b = t.el && t.el.querySelector('.only'); if (b) { b.setAttribute('aria-checked', 'false'); b.classList.remove('sounding'); } } }); refreshGains(); markDirty(); };
    n.append(go, clr);
  }
  if (muted) n.insertAdjacentHTML('beforeend', `<span class="end">${esc(plural(muted, 'sound', 'sounds'))} silenced</span>`);
}

/* ---------- the picture of each sound: you choose it (file, drag and drop, or Ctrl+V) ---------- */
/* It returns a promise that settles once the picture is drawn (or turned out not to be there). */
function paintTrackImage(t, el = t.el) {
  if (!el) return Promise.resolve();
  const bg = el.querySelector('.pimg'), del = el.querySelector('.imgdel'), own = el.querySelector('.imgown');
  if (del) del.hidden = !t.img;
  if (own) own.textContent = t.img ? 'Change' : 'Choose a picture…';
  if (!bg) return Promise.resolve();
  const th = el.querySelector('.pthumb');
  if (th) th.style.backgroundImage = t.img && t.img.url ? cssUrl(t.img.url) : '';
  // the same picture, large, behind the whole line and its open settings
  const wide = el.querySelector('.tbg');
  const show = url => { bg.style.backgroundImage = cssUrl(url); bg.dataset.url = url; bg.classList.add('show');
    if (wide) wide.style.backgroundImage = cssUrl(url); el.classList.add('has-pic'); el.classList.toggle('pic-light', !!(t.img && t.img.light)); };
  const hide = () => { bg.classList.remove('show'); el.classList.remove('has-pic', 'pic-light'); };
  if (!t.img) { hide(); bg.style.backgroundImage = ''; bg.dataset.url = ''; return Promise.resolve(); }
  if (t.img.local && !t.img.url) {
    // your own image, saved in the folder: read it first, then show it
    const want = t.img;
    return readFile(want.local).then(f => { if (t.img === want) { want.url = URL.createObjectURL(f); return paintTrackImage(t, t.el || el); } })
      .catch(hide);
  }
  const url = t.img.url;
  if (bg.dataset.url === url) { show(url); return Promise.resolve(); }
  const im = new Image();
  im.src = url;
  // decoded before it is drawn, so it appears whole
  return im.decode().then(() => { if (t.img && t.img.url === url) { t.img.light = isLightPicture(im); show(url); } }, () => {});
}
/* Is this picture light on the whole? Read once, small, when it loads; the controls over it change their style.
   A picture from another site may not allow being read: it then counts as dark, and nothing else changes.
   Kept only in memory: the composition file stores the picture's place, never this. */
function isLightPicture(im) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) / 255;
    return sum / (d.length / 4) > .5;
  } catch (e) { return false; }
}
let imgTarget = null;
async function setOwnImage(t, file) {
  try {
    const ext = ((file.name || '').match(/\.[a-z0-9]+$/i) || ['.' + ((file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'))])[0].toLowerCase();
    const path = await freeName(DIR.trackImages, slug(t.name).slice(0, 40) + '-' + uid().slice(0, 5), ext);
    await writeFile(path, file);
    t.img = { local: path, url: URL.createObjectURL(file) };
    paintTrackImage(t); markDirty();
    toast('Picture added');
  } catch (e) { toast('Couldn\'t save the picture'); }
}
function setImageUrl(t, url) {
  // first make sure the link really leads to an image
  const im = new Image();
  im.onload = () => { if (!cur || !cur.tracks.includes(t)) return; t.img = { url }; paintTrackImage(t); markDirty(); toast('Picture added from the link'); };
  im.onerror = () => toast('That link doesn\'t lead to a picture', { kind: 'warn' });
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
  if (at == null || at >= cur.tracks.length) cur.tracks.push(t);
  else cur.tracks.splice(at, 0, t);
  t.el = renderTrack(t);
  const i = cur.tracks.indexOf(t), next = cur.tracks[i + 1];
  if (next && next.el && next.el.isConnected) next.el.before(t.el); else $('list').appendChild(t.el);
  renumber(); updateEmpty(); applyFind();
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
  refreshGains(); updateEmpty(); setPlayState();
  return true;
}
/* The audio of a sound has arrived (or turned out to be missing). The line is not rebuilt: its picture
   and any control the person is already using stay as they are; only the parts that depend on the
   audio change. A missing file changes the whole line, so that one is redrawn. */
function showLoaded(t) {
  const el = t.el;
  if (!el) return;
  if (t.missing && !el.classList.contains('missing')) { replaceEl(t); return; }
  const d = baseDur(t);
  el.querySelectorAll('.dur').forEach(x => x.textContent = d);
  el.querySelectorAll('.test, .seam').forEach(b => b.disabled = !t.buffer);
  setTestBtn(t);
  updateLive(); updateWhyOff(); applyFind();
}
/* Opening a composition: the lines appear one after another, from the top. Only then, never for a
   sound added later. The delay stops growing after a dozen lines, so a long list is not held back. */
function cascadeRows(tracks) {
  if (calm()) return;
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
  stopSources(t);
  try { disposeChain(t.nodes); } catch (e) {}
  cur.tracks = cur.tracks.filter(x => x !== t);
  t.el.remove(); t.el = null;
  renumber();
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
