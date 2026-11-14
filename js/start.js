/* αtmos — start-up: the warning before leaving with unsaved work, the pinned play bar, the skip link,
   the version in the footer, the service worker, and boot(), which starts the app. index.html must
   load this file last. */

window.addEventListener('beforeunload', e => { if (cur && (cur.dirty || saveFail)) { e.preventDefault(); e.returnValue = ''; } });

/* The play bar is pinned while you scroll. When it is, it gets a solid strip behind it so the
   page does not show through the one control you use most. */
if ('IntersectionObserver' in window) {
  new IntersectionObserver(
    // while the composition screen is hidden the marker reads as "scrolled past": that must not
    // light the strip, or it flashes for a moment each time a composition opens
    // (a hidden marker has no size: only one that has really moved above the top counts)
    ([e]) => $('transport').classList.toggle('stuck',
      !e.isIntersecting && e.boundingClientRect.width > 0 && !!e.rootBounds && e.boundingClientRect.bottom <= e.rootBounds.top),
    { rootMargin: '-13px 0px 0px 0px', threshold: 0 }
  ).observe($('tSentinel'));
}
/* "Your sounds", docked, stays in view under the pinned bar: it needs to know how tall that bar is */
if ('ResizeObserver' in window) new ResizeObserver(([e]) => {
  const h = e.target.getBoundingClientRect().height;
  if (h) $('vEditor').style.setProperty('--tp-h', Math.round(h) + 'px');
}).observe($('transport'));
/* A link, reachable only by keyboard, that jumps past the long list of sounds. */
const skipTo = (el, focusSel) => {
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const f = el.querySelector(focusSel);
  if (f) f.focus({ preventScroll: true });
};
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
// the version in the footer is the one in sw.js, so a single number identifies a release
fetch('sw.js').then(r => r.ok ? r.text() : '').then(t => { const m = /VERSION = 'atmos-(v\d+)'/.exec(t); if (m) $('footVer').textContent = m[1]; }).catch(() => {});
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
