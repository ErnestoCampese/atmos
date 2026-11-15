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
/* where it is, in words like the effects: nobody has to know what "x 40, y -70" sounds like */
const DIRS = ['Ahead', 'Ahead right', 'Right', 'Behind right', 'Behind', 'Behind left', 'Left', 'Ahead left'];
const posLabel = t => {
  const r = Math.hypot(t.pos.x, t.pos.y);
  // a sound that rises or comes down past you goes through every height: it has none of its own to say
  const h = passing(t) && (t.trajDir === 'up' || t.trajDir === 'down') && !t.trajRand ? 0 : t.height || 0;
  const up = h > 0 ? 'above' : h < 0 ? 'below' : '';
  // left on the listener, a sound that moves still has a path: the one drawn on the grid, close by
  if (r < 0.05) return wandering(t) ? ['Close around you', up].filter(Boolean).join(' · ') : passing(t) ? ['Close by', up].filter(Boolean).join(' · ')
    : h > 0 ? 'Right above you' : h < 0 ? 'Right below you' : 'All around you';
  const dir = DIRS[(Math.round(Math.atan2(t.pos.x, t.pos.y) / (Math.PI / 4)) + 8) % 8];
  return [dir, r < 0.35 ? 'close' : r < 0.8 ? '' : 'far', up].filter(Boolean).join(' · ');
};
const missingLine = t => `<p class="warn"><b>File not found:</b> <span>${esc(t.file.split('/').pop())} is no longer in your sounds folder.</span>
       <button class="ghost sm relink">Find the file</button>
       <button class="quiet sm dropit">Remove</button></p>`;
function wireMissing(t, el) {
  el.querySelector('.relink').onclick = () => { relinkTarget = t; $('relinkIn').click(); };
  el.querySelector('.dropit').onclick = () => removeTrack(t);
}
const num2 = i => String(i + 1).padStart(2, '0');
/* under the name, in words: how it plays, then how many effects it has */
const fxWords = t => { const n = fxCount(t); return n ? plural(n, 'effect', 'effects') : ''; };
const openerText = t => MODES[t.mode] + (fxWords(t) ? ' · ' + fxWords(t) : '');
const muteIcon = on => on ? ICO.volX : ICO.vol;
/* How much of an effect, chosen among its words: each word is a set amount. An amount saved earlier
   that lies between two words shows the nearer one and keeps sounding as it is until another is chosen. */
const AMOUNTS = [[0, 'Off'], [22, 'A little'], [50, 'Medium'], [80, 'Strong']];
/* One effect is told by what it resembles, not by how much: what stands between you and the sound */
const THROUGH = [[0, 'Off'], [30, 'Curtain'], [62, 'Window'], [78, 'Wall'], [90, 'Underwater']];
const amountsOf = k => k === 'muffled' ? THROUGH : AMOUNTS;
const amountAt = (k, v) => { if (!v) return 0; const a = amountsOf(k); let at = 1; for (let i = 2; i < a.length; i++) if (Math.abs(a[i][0] - v) < Math.abs(a[at][0] - v)) at = i; return at; };
/* What each effect does. The space has a choice of its own (which place): its sentence is that choice, there whether
   the effect is on or off, and then what the chosen place sounds like and the scenes it is for; choosing one turns
   the effect on */
const FX_SAY = { reverb: 'As in' };
const FX_TEXT = {
  muffled: 'Dulled, as when something stands between you and the sound',
  under: 'Dull and ringing, swaying slowly, as with your head underwater',
  waves: 'Slowly louder and softer on its own, like breathing'
};
/* How it moves: it stays, it wanders around its place all the time, or it passes by each time it plays */
const MOVES = [['still', 'Stays where it is'], ['little', 'Wanders a little'], ['wide', 'Wanders widely'], ['round', 'Circles around you'],
  ['lr', 'Passes by, left to right'], ['rl', 'Passes by, right to left'], ['pp', 'Passes by, back and forth'], ['rand', 'Passes by, either way'],
  ['up', 'Passes by, from below to above'], ['down', 'Passes by, from above to below']];
const WANDER = { little: 22, wide: 50, round: 80 };
const moveOf = t => passing(t) ? (t.trajRand ? 'rand' : t.trajDir) : wanderKind(wandering(t)) || 'still';
const moveSay = t => {
  const m = moveOf(t);
  const say = m === 'still' ? 'It keeps to the place you gave it' : m === 'little' ? 'Drifts slowly to either side of its place, all the time'
    : m === 'wide' ? 'Drifts slowly, far to either side of its place' : m === 'round' ? 'Goes slowly all the way around you, again and again'
    : m === 'up' ? 'Each time it plays it rises past you: under you as it starts, over you as it ends'
    : m === 'down' ? 'Each time it plays it comes down past you: over you as it starts, under you as it ends'
    : m === 'pp' ? 'Each time it plays it goes around you from one side to the other, then back the next time'
    : m === 'rand' ? 'Each time it plays it goes around you from one side to the other, whichever way it happens'
    : `Each time it plays it goes around you: on your ${m === 'lr' ? 'left' : 'right'} as it starts, on your ${m === 'lr' ? 'right' : 'left'} as it ends`;
  return say;
};
/* where it is: the listener in the middle of a grid, seen from behind, the sound a dot dragged around them. Ahead is
   up. What the sound does on its own (wandering, passing by) is drawn as the path it takes. */
const PAD = 240, PAD_R = 104, PAD_C = PAD / 2;
const PAD_FIG = `<svg class="pad-fig" viewBox="0 0 ${PAD} ${PAD}" aria-hidden="true" focusable="false">
  <path class="pf-grid" d="${[30, 60, 90, 150, 180, 210].map(v => `M${v} 0V${PAD}M0 ${v}H${PAD}`).join('')}"/>
  <path class="pf-axis" d="M${PAD_C} 24V96M${PAD_C} 148V${PAD - 24}M24 ${PAD_C}H96M144 ${PAD_C}H${PAD - 24}"/>
  <text class="pf-w" x="${PAD_C}" y="16" text-anchor="middle">ahead</text><text class="pf-w" x="${PAD_C}" y="${PAD - 8}" text-anchor="middle">behind</text>
  <text class="pf-w" x="8" y="${PAD_C + 4}">L</text><text class="pf-w" x="${PAD - 8}" y="${PAD_C + 4}" text-anchor="end">R</text>
  <circle class="pf-all" cx="${PAD_C}" cy="${PAD_C}" r="30"/>
  <path class="pf-move" d=""/><path class="pf-head" d=""/>
  <g class="pf-you" transform="translate(${PAD_C} ${PAD_C}) scale(.64) translate(-100 -62)"><path d="M86 53a4 6 0 0 0 0 11M114 53a4 6 0 0 1 0 11M70 96c1-8 12-12 24-14v-8M130 96c-1-8-12-12-24-14v-8"/><ellipse cx="100" cy="58" rx="14" ry="17"/></g>
  <g class="pf-dot"><circle r="8"/><circle r="3.5"/></g>
  <circle class="pf-live" r="4"/>
</svg>`;
const HEIGHTS = [[-1, 'Below'], [0, 'Level'], [1, 'Above']];
/* A sound that moves is shown where it is at this moment, while it is heard: a small gold point travelling along the
   path drawn on the grid (gold, because it is what is sounding now). The dot stays where it was put: it is the place
   the writer chose, and still the thing to drag. `h` is the play being heard now, if any. */
function paintLive(t, now, h) {
  const el = t.el, live = t.fxOpen && el && el.querySelector('.pf-live'); if (!live) return;
  const x = t.pos.x, y = t.pos.y, r = Math.hypot(x, y), m = moveOf(t);
  let at = null;
  if (h && (t.pv || effectiveGain(t) > 0) && m !== 'still') {
    if (m in WANDER) {
      // it turns around the listener: the same slow wave the engine runs, read at this moment
      const mv = t.nodes && t.nodes.mv;
      if (mv && mv.on) {
        const ph = 2 * Math.PI * LAP * (now - mv.t0), a = (r < 0.01 ? 0 : Math.atan2(x, y)) + (m === 'round' ? ph : SWAY[m] * Math.sin(ph));
        const R = Math.max(r, 0.3) * PAD_R; at = [PAD_C + R * Math.sin(a), PAD_C - R * Math.cos(a)];
      }
    } else if (h.pass) {
      // it passes by: how far along this crossing it is, by the clock of the sound itself
      const ps = h.pass, i = Math.floor((now - ps.when) / ps.each), c = ps.list[i];
      if (c) {
        const v = (((now - ps.when) / ps.each - i) * 2 - 1) * c.k;
        if (c.dir === 'up' || c.dir === 'down') at = [PAD_C + x * PAD_R, PAD_C - y * PAD_R - (c.dir === 'up' ? v : -v) * 18];
        else { const a = (c.dir === 'lr' ? v : -v) * Math.PI / 2, R = Math.min(PAD_C - 10, Math.max(r, 0.15) * PAD_R); at = [PAD_C + R * Math.sin(a), PAD_C - (y >= 0 ? 1 : -1) * R * Math.cos(a)]; }
      }
    }
  }
  if (at) live.setAttribute('transform', `translate(${at[0].toFixed(1)} ${at[1].toFixed(1)})`);
  live.classList.toggle('on', !!at);
}
function paintPad(t, el = t.el) {
  const pad = el && el.querySelector('.pad'); if (!pad) return;
  const X = v => (PAD_C + v * PAD_R).toFixed(1), Y = v => (PAD_C - v * PAD_R).toFixed(1);
  const x = t.pos.x, y = t.pos.y, r = Math.hypot(x, y), m = moveOf(t), say = posLabel(t);
  pad.querySelector('.pf-dot').setAttribute('transform', `translate(${X(x)} ${Y(y)})`);
  pad.classList.toggle('is-all', r < 0.05 && !t.height && m === 'still');
  let d = '', heads = '';
  if (m in WANDER) {
    // the arc it wanders along, at the distance the sound itself keeps (never nearer than three metres)
    const R = Math.max(r, 0.3) * PAD_R, th = r < 0.01 ? 0 : Math.atan2(x, y), A = m === 'round' ? Math.PI : SWAY[m];
    const at = a => `${(PAD_C + R * Math.sin(a)).toFixed(1)} ${(PAD_C - R * Math.cos(a)).toFixed(1)}`;
    d = m === 'round' ? `M${at(0)}A${R} ${R} 0 1 1 ${at(Math.PI)}A${R} ${R} 0 1 1 ${at(0)}` : `M${at(th - A)}A${R} ${R} 0 0 1 ${at(th + A)}`;
  } else if (m === 'up' || m === 'down') {
    // rising or coming down cannot be drawn from above: an arrow through the dot says which
    const px = +X(x), py = +Y(y), a = py + 18, b = py - 18;
    d = `M${px} ${a}V${b}`; heads = m === 'up' ? `M${px - 4} ${b + 6}l4-6 4 6` : `M${px - 4} ${a - 6}l4 6 4-6`;
  } else if (m !== 'still') {
    // the half circle it goes along, ahead of the listener or behind, with a head at each end it travels to
    const R = Math.min(PAD_C - 10, Math.max(r, 0.15) * PAD_R), a = PAD_C - R, b = PAD_C + R, up = y >= 0, k = up ? 6 : -6;
    d = `M${a} ${PAD_C}A${R} ${R} 0 0 ${up ? 1 : 0} ${b} ${PAD_C}`;
    heads = (m !== 'rl' ? `M${b - 4} ${PAD_C - k}l4 ${k} 4 ${-k}` : '') + (m !== 'lr' ? `M${a - 4} ${PAD_C - k}l4 ${k} 4 ${-k}` : '');
  }
  pad.querySelector('.pf-move').setAttribute('d', d); pad.querySelector('.pf-head').setAttribute('d', heads);
  // and its height stands aside, like any control that has nothing to set
  const hgt = el.querySelector('.hgt'), idle = m === 'up' || m === 'down';
  hgt.classList.toggle('is-idle', idle); hgt.querySelectorAll('button').forEach(b => { b.disabled = idle; });
  pad.setAttribute('aria-valuetext', say);
  el.querySelector('.pos-say').textContent = say;
}
function renderTrack(t) {
  const el = document.createElement('div');
  el.className = 'track' + (t.missing ? ' missing' : '') + (t.fxOpen && !t.missing ? ' is-open' : '');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', t.name);
  const dur = baseDur(t);
  const at = cur ? Math.max(0, cur.tracks.indexOf(t)) : 0;
  const did = 'd-' + t.uid;
  // a seamless loop joins its end to its start by itself: there is no fade to set, so none is offered
  const loopOpts = t.seamless ? '' : `
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
  const revKind = `<select class="kind revtype" aria-label="Which place">${Object.entries(SPACE_GROUPS).map(([g, name]) =>
    `<optgroup label="${name}">${Object.entries(SPACES).filter(([, o]) => o.group === g).map(([v, o]) => `<option value="${v}" ${t.revType === v ? 'selected' : ''}>${o.label}</option>`).join('')}</optgroup>`).join('')}</select>`;
  /* a line of the table: the name, the control right beside it, then what it does. Most effects are an amount in
     words; how it moves is a choice among sentences */
  const fxRow = ([k, label]) => {
    const v = t.fx[k] || 0, by = `aria-labelledby="${did}-${k}"`;
    let on = v > 0, ctl, hint = esc(FX_TEXT[k === 'muffled' && v / 100 >= UNDERWATER ? 'under' : k] || '');
    if (k === 'movement') {
      const m = moveOf(t); on = m !== 'still';
      // a seamless loop never starts again, so it cannot pass by: those ways stay in the list, set aside under the reason
      const opt = ([id, l]) => `<option value="${id}" ${m === id ? 'selected' : ''}>${l}</option>`, idle = noPassing(t);
      ctl = `<select class="moves" ${by}>${MOVES.slice(0, 4).map(opt).join('')}${idle ? '<optgroup label="Not for a seamless loop" disabled>' : ''}${MOVES.slice(4).map(opt).join('')}${idle ? '</optgroup>' : ''}</select>`;
      hint = esc(moveSay(t));
    } else {
      const at = amountAt(k, v), say = FX_SAY[k];
      ctl = `<div class="seg fill fx-amt" role="radiogroup" ${by} data-k="${k}"><span class="seg-pill" aria-hidden="true"></span>${amountsOf(k).map(([a, w], i) =>
        `<button type="button" role="radio" aria-checked="${i === at}" tabindex="${i === at ? 0 : -1}" data-v="${a}"${i === at ? ' class="on"' : ''}>${w}</button>`).join('')}</div>`;
      if (say) hint = `${esc(say)} ${revKind} <span class="sp-say">${esc((SPACES[t.revType] || SPACES.cathedral).say)}</span>`;
    }
    return `
            <div class="fx-row${on ? ' is-on' : ''}" data-fx="${k}">
              <span class="fx-name" id="${did}-${k}">${label}</span>
              ${ctl}
              <p class="fx-hint">${hint}</p>
            </div>`;
  };
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
          <div class="fx-cell fx-how">
            <h4>How it plays</h4>
            <select class="plays" aria-label="How ${nameAttr} plays">${Object.entries(MODES).map(([m, label]) => `<option value="${m}" ${t.mode === m ? 'selected' : ''}>${label}</option>`).join('')}</select>
            ${t.mode === 'loop' ? `<label class="check" title="Trims the silence and any fade at each end, and joins the sound where its end is most like its start, so you can’t hear it begin again"><input type="checkbox" class="seam" ${t.seamless ? 'checked' : ''} ${t.buffer ? '' : 'disabled'}> Loop seamlessly</label>` : ''}
            ${{ loop: loopOpts, interval: intOpts, random: rndOpts }[t.mode]}
          </div>
          <div class="fx-cell fx-place">
            <h4 id="${did}-pos">Where it is</h4>
            <div class="pad" tabindex="0" role="slider" aria-labelledby="${did}-pos" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, Math.hypot(t.pos.x, t.pos.y)) * 100)}" aria-valuetext="${posLabel(t)}" aria-describedby="${did}-tip">${PAD_FIG}</div>
            <div class="seg fill hgt" role="radiogroup" aria-label="Height of ${nameAttr}"><span class="seg-pill" aria-hidden="true"></span>${HEIGHTS.map(([v, w]) =>
              `<button type="button" role="radio" aria-checked="${v === (t.height || 0)}" tabindex="${v === (t.height || 0) ? 0 : -1}" data-v="${v}"${v === (t.height || 0) ? ' class="on"' : ''}>${w}</button>`).join('')}</div>
            <p class="pos-say">${posLabel(t)}</p>
            <p class="fx-note" id="${did}-tip">Drag the dot around the listener. Best heard with headphones.</p>
          </div>
          <div class="fx-eff">${FILTERS.map(fxRow).join('')}
            <div class="fx-row fx-pic">
              <span class="fx-name">Picture</span>
              <div class="pic-row"><span class="pthumb" aria-hidden="true"></span><button class="ghost sm imgown">${t.img ? 'Change' : 'Choose a picture…'}</button><button class="quiet sm imgdel" ${t.img ? '' : 'hidden'}>Remove</button></div>
              <p class="fx-hint">Or drag one onto the sound, or paste with Ctrl+V</p>
            </div>
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
  q('.plays').onchange = e => {
    t.mode = e.target.value;
    if (t.mode === 'loop' && t.seamless && !t.loopBuf && t.buffer) t.loopBuf = makeSeamless(t.buffer, SEAM_JOIN);
    if (playing) resetTrack(t, ctx.currentTime + 0.05);
    applyFx(t); retest(t);
    replaceEl(t); markDirty();
    t.el.querySelector('.plays').focus();
  };
  q('.vol').oninput = e => {
    t.volume = e.target.value / 100; e.target.setAttribute('aria-valuetext', e.target.value + '%'); q('.vpct').textContent = e.target.value + '%';
    if (t.pv) t.pv.g.gain.setTargetAtTime(t.volume, ctx.currentTime, 0.05);
    refreshGains(); markDirty();
  };
  // choosing a place means wanting to hear it: an effect that was off comes on, at its middle amount
  q('.revtype').onchange = e => {
    t.revType = e.target.value; setReverbType(t); markDirty();
    q('.sp-say').textContent = SPACES[t.revType].say;
    if (!t.fx.reverb) { t.fx.reverb = 50; applyFx(t); replaceEl(t); t.el.querySelector('.revtype').focus(); }
  };
  const rowOn = (k, on) => q(`.fx-row[data-fx="${k}"]`).classList.toggle('is-on', on);
  /* how it moves: one choice sets the two amounts behind it. The sound starts again, on its own or in the
     composition, so the new way of moving is heard at once and nothing still playing keeps the old one */
  q('.moves').onchange = e => {
    const m = e.target.value, pass = !(m in WANDER) && m !== 'still';
    t.fx.movement = WANDER[m] || 0; t.fx.trajectory = pass ? 100 : 0;
    if (pass) { t.trajRand = m === 'rand'; if (!t.trajRand) t.trajDir = m; }
    rowOn('movement', m !== 'still'); q('.fx-row[data-fx="movement"] .fx-hint').textContent = moveSay(t);
    applyFx(t); paintPad(t, el); retest(t); setOpener(t); markDirty();
    if (playing) resetTrack(t, ctx.currentTime + 0.05);
  };
  /* an amount is chosen like a word in a list: a click, or the arrow keys once it has the focus */
  el.querySelectorAll('.fx-amt').forEach(seg => {
    const k = seg.dataset.k, bs = [...seg.querySelectorAll('button')];
    const choose = (b, focus) => {
      bs.forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
      t.fx[k] = +b.dataset.v;
      seg.closest('.fx-row').classList.toggle('is-on', t.fx[k] > 0);
      placePill(seg, true);
      if (focus) b.focus();
      // what the effect does is said again when the word chosen changes what it is (underwater is not a thicker wall)
      if (k === 'muffled') seg.closest('.fx-row').querySelector('.fx-hint').textContent = FX_TEXT[t.fx[k] / 100 >= UNDERWATER ? 'under' : k];
      applyFx(t); setOpener(t); markDirty();
    };
    bs.forEach(b => b.onclick = () => { if (!b.classList.contains('on')) choose(b); });
    seg.onkeydown = e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!step) return;
      e.preventDefault();
      const to = bs[bs.indexOf(seg.querySelector('button.on')) + step]; if (to) choose(to, true);
    };
    watchSeg(seg);
  });
  /* where it is: press or drag on the grid and the sound goes there; the arrow keys move it a step, Home (or a
     double click) puts it back all around you. Right on the listener it is all around, so the dot catches there. */
  const pad = q('.pad');
  const moveTo = (x, y) => {
    x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
    if (Math.hypot(x, y) < 0.08) x = y = 0;
    t.pos = { x: r2(x), y: r2(y) };
    pad.setAttribute('aria-valuenow', Math.round(Math.min(1, Math.hypot(x, y)) * 100));
    applyFx(t); paintPad(t, el); markDirty();
  };
  const padTo = e => { const r = pad.getBoundingClientRect(); moveTo(((e.clientX - r.left) / r.width * PAD - PAD_C) / PAD_R, (PAD_C - (e.clientY - r.top) / r.height * PAD) / PAD_R); };
  // the press belongs to the grid alone: no text selection, no browser drag of the drawing as an image
  pad.onpointerdown = e => {
    if (e.button !== 0) return;
    e.preventDefault(); pad.focus({ preventScroll: true });
    pad.setPointerCapture(e.pointerId); pad.classList.add('held'); padTo(e);
  };
  pad.onpointermove = e => { if (pad.hasPointerCapture(e.pointerId)) padTo(e); };
  pad.onlostpointercapture = () => pad.classList.remove('held');
  pad.ondragstart = e => e.preventDefault();
  pad.ondblclick = () => moveTo(0, 0);
  pad.onkeydown = e => {
    if (e.key === 'Home') { e.preventDefault(); moveTo(0, 0); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (!d) return;
    e.preventDefault();
    // a step out of the middle clears the catch around the listener
    const k = e.shiftKey ? 0.25 : 0.05, x = t.pos.x + d[0] * k, y = t.pos.y + d[1] * k, at0 = !t.pos.x && !t.pos.y;
    moveTo(at0 ? d[0] * Math.max(k, 0.1) : x, at0 ? d[1] * Math.max(k, 0.1) : y);
  };
  const hgt = q('.hgt'), hs = [...hgt.querySelectorAll('button')];
  const setHeight = (b, focus) => {
    hs.forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
    t.height = +b.dataset.v; placePill(hgt, true); if (focus) b.focus();
    applyFx(t); paintPad(t, el); markDirty();
  };
  hs.forEach(b => b.onclick = () => { if (!b.classList.contains('on')) setHeight(b); });
  hgt.onkeydown = e => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!step) return;
    e.preventDefault();
    const to = hs[hs.indexOf(hgt.querySelector('button.on')) + step]; if (to) setHeight(to, true);
  };
  watchSeg(hgt);
  if (q('.seam')) q('.seam').onchange = e => {
    t.seamless = e.target.checked;
    setTimeout(() => { applySeamless(t); applyFx(t); replaceEl(t); markDirty(); }, 20);
  };
  if (t.mode === 'loop') {
    if (q('.cf')) q('.cf').onchange = e => { t.crossfade = e.target.checked; q('.fade').disabled = !t.crossfade; markDirty(); };
    if (q('.fade')) q('.fade').oninput = e => { t.fade = +e.target.value; q('.fv').textContent = t.fade + ' s'; markDirty(); };
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
  paintRanges(el); paintPad(t, el);
  return el;
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
    /* what is carried under the pointer is the line alone. Left to itself the browser cuts that picture out of the
       page over the box of the sound and everything inside it, and the folded settings, though out of sight, are
       some 500px tall: it would carry a faint copy of every line below as well */
    const row = el.querySelector('.trow'), rr = row.getBoundingClientRect();
    e.dataTransfer.setDragImage(row, e.clientX - rr.left, e.clientY - rr.top);
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
    if (t.seamless && t.mode === 'loop') t.loopBuf = makeSeamless(t.buffer, SEAM_JOIN);
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
