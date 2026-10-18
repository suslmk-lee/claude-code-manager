'use strict';
// Runs inside the browser pane's page (isolated world). Implements the element picker:
// hover highlight, click capture, and a description (selector, text, html, framework source hints) sent to the host.
const { ipcRenderer } = require('electron');

let picking = false, box = null, label = null, lastEl = null;

function ensureOverlay() {
  if (box) return;
  box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #d97757;background:rgba(217,119,87,.12);border-radius:3px;transition:all .04s;display:none';
  label = document.createElement('div');
  label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#d97757;color:#fff;font:11px/1.4 -apple-system,Helvetica,sans-serif;padding:1px 6px;border-radius:3px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none';
  document.documentElement.append(box, label);
}
function short(el) { return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join(''); }
function highlight(el) {
  const r = el.getBoundingClientRect();
  Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  Object.assign(label.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top > 22 ? r.top - 20 : r.bottom + 2) + 'px' });
  label.textContent = `${short(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
}
function cssPath(el) {
  const parts = [];
  for (let e = el, n = 0; e && e.nodeType === 1 && n < 8; e = e.parentElement, n++) {
    if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
    let p = e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
    const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : [];
    if (sib.length > 1) p += `:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`;
    parts.unshift(p);
    if (e.tagName === 'BODY') break;
  }
  return parts.join(' > ');
}
function sourceInfo(el) {
  for (const a of ['data-v-inspector', 'data-source', 'data-locator', 'data-loc', 'data-inspector-location', 'data-sourceloc']) {
    const host = el.closest(`[${a}]`);
    if (host) return { kind: a, loc: host.getAttribute(a), chain: [] };
  }
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (key) {
    const chain = []; let src = null; let f = el[key];
    for (let n = 0; f && n < 60; f = f.return, n++) {
      const t = f.type;
      const name = typeof t === 'function' ? (t.displayName || t.name) : t && typeof t === 'object' ? (t.displayName || t.render?.displayName || t.render?.name || t.type?.name) : null;
      if (name && !/^(Fragment|Suspense|Provider|Consumer)$/.test(name)) chain.push(name);
      if (!src && f._debugSource) src = `${f._debugSource.fileName}:${f._debugSource.lineNumber}`;
    }
    return { kind: 'react', chain: chain.slice(0, 6).reverse(), loc: src };
  }
  const v = el.__vueParentComponent || el.__vue__;
  if (v) {
    const chain = []; let c = v;
    for (let n = 0; c && n < 8; c = c.parent || c.$parent, n++) { const name = c.type?.name || c.type?.__name || c.$options?.name; if (name) chain.push(name); }
    return { kind: 'vue', chain: chain.reverse(), loc: v.type?.__file || v.$options?.__file || null };
  }
  return null;
}
function describe(el) {
  const r = el.getBoundingClientRect();
  return {
    url: location.href, title: document.title, selector: cssPath(el), tag: el.tagName.toLowerCase(), id: el.id || '',
    classes: [...el.classList].slice(0, 10), text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    html: el.outerHTML.slice(0, 1500), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, source: sourceInfo(el),
  };
}
function onMove(e) { const el = document.elementFromPoint(e.clientX, e.clientY); if (el && el !== lastEl && el !== box && el !== label) { lastEl = el; highlight(el); } }
function onClick(e) {
  if (!picking) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  const el = document.elementFromPoint(e.clientX, e.clientY) || lastEl;
  if (!el || el === box || el === label) return;
  ipcRenderer.sendToHost('picked', describe(el));
  if (!e.shiftKey) setPicking(false); // shift-click keeps picking for multiple elements
}
function onKey(e) { if (e.key === 'Escape' && picking) { setPicking(false); ipcRenderer.sendToHost('pick-cancel'); } }
function setPicking(on) {
  picking = on; ensureOverlay();
  if (on) { document.addEventListener('mousemove', onMove, true); document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true); document.documentElement.style.cursor = 'crosshair'; }
  else { document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); document.documentElement.style.cursor = ''; box.style.display = 'none'; label.style.display = 'none'; lastEl = null; }
  ipcRenderer.sendToHost('picking', on);
}
ipcRenderer.on('pick', (_e, on) => setPicking(!!on));
ipcRenderer.on('ping', () => ipcRenderer.sendToHost('ready'));
ipcRenderer.sendToHost('ready');
