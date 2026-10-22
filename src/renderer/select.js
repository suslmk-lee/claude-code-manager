'use strict';
/* global el */
// Themed dropdown for every <select>: the native popup is drawn by macOS and ignores the app theme. The <select> stays
// the source of truth (value, change event, form behaviour); we only replace the open list. Single selects only.
(function () {
  let pop = null, cur = null;
  const close = () => { if (!pop) return; pop.remove(); pop = null; cur = null; document.removeEventListener('mousedown', onDoc, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  const onDoc = (e) => { if (pop && !pop.contains(e.target) && e.target !== cur) close(); };
  const options = () => pop ? [...pop.querySelectorAll('.dd-opt:not(.dis)')] : [];
  const mark = (i) => { const o = options(); o.forEach((x, k) => x.classList.toggle('sel', k === i)); o[i]?.scrollIntoView({ block: 'nearest' }); };
  function choose(sel, i) { if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } close(); sel.focus(); }
  function open(sel) {
    close(); cur = sel;
    const r = sel.getBoundingClientRect();
    pop = el('div', { class: 'dd', role: 'listbox' }, ...[...sel.options].map((o, i) => el('div', { class: 'dd-opt' + (o.disabled ? ' dis' : '') + (i === sel.selectedIndex ? ' sel' : ''), role: 'option', text: o.text, title: o.text, onclick: () => !o.disabled && choose(sel, i) })));
    (sel.closest('dialog') || document.body).append(pop); // inside an open modal dialog nothing outside it is clickable
    pop.style.minWidth = `${Math.round(r.width)}px`;
    const h = pop.offsetHeight, below = innerHeight - r.bottom - 8;
    pop.style.left = `${Math.round(Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.round(h <= below || r.top < h ? r.bottom + 4 : r.top - h - 4)}px`; // flip up when it does not fit below
    const i = options().findIndex((x) => x.classList.contains('sel')); if (i >= 0) mark(i);
    document.addEventListener('mousedown', onDoc, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
  }
  const eligible = (s) => s && s.tagName === 'SELECT' && !s.disabled && !s.multiple && s.size <= 1;

  // combobox: <input list="…"> keeps its free text but gets the same themed list. The native datalist popup is light and
  // only lists entries matching the current text, so once a value is picked the other choices vanish.
  for (const inp of document.querySelectorAll('input[list]')) {
    const dl = document.getElementById(inp.getAttribute('list'));
    inp.__opts = dl ? [...dl.options].map((o) => ({ value: o.value, text: o.label || o.textContent.trim() || o.value })) : [];
    inp.removeAttribute('list'); inp.classList.add('combo');
  }
  const isCombo = (x) => x && x.classList?.contains('combo');
  function pickCombo(inp, v) { if (inp.value !== v) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } close(); inp.focus(); }
  function openCombo(inp, filter = '') {
    close(); cur = inp;
    const q = filter.trim().toLowerCase();
    let opts = inp.__opts.filter((o) => !q || o.value.toLowerCase().includes(q) || o.text.toLowerCase().includes(q));
    if (!opts.length) opts = inp.__opts; // nothing matches what was typed: show everything rather than an empty list
    const r = inp.getBoundingClientRect();
    pop = el('div', { class: 'dd', role: 'listbox' },
      el('div', { class: 'dd-opt dd-clear' + (inp.value ? '' : ' sel'), text: inp.placeholder ? `비우기 — ${inp.placeholder}` : '비우기', onclick: () => pickCombo(inp, '') }),
      ...opts.map((o) => el('div', { class: 'dd-opt' + (o.value === inp.value ? ' sel' : ''), role: 'option', text: o.text + (o.text !== o.value ? ` · ${o.value}` : ''), onclick: () => pickCombo(inp, o.value) })));
    (inp.closest('dialog') || document.body).append(pop);
    pop.style.minWidth = `${Math.round(r.width)}px`;
    const h = pop.offsetHeight, below = innerHeight - r.bottom - 8;
    pop.style.left = `${Math.round(Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.round(h <= below || r.top < h ? r.bottom + 4 : r.top - h - 4)}px`;
    const i = options().findIndex((x) => x.classList.contains('sel')); if (i >= 0) mark(i);
    document.addEventListener('mousedown', onDoc, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
  }
  document.addEventListener('input', (e) => { if (isCombo(e.target) && pop && cur === e.target) openCombo(e.target, e.target.value); }, true); // typing narrows the list
  document.addEventListener('mousedown', (e) => {
    const c = e.target.closest?.('input.combo');
    if (c) { if (!(pop && cur === c)) setTimeout(() => openCombo(c), 0); return; } // the caret still lands where it was clicked
    const s = e.target.closest?.('select');
    if (!eligible(s)) return;
    e.preventDefault(); // no native popup
    if (pop && cur === s) close(); else { s.focus(); open(s); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (pop) { // the list has the keyboard
      const o = options(); let i = o.findIndex((x) => x.classList.contains('sel'));
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, Math.min(o.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); }
      else if (isCombo(cur)) { if (e.key === 'Enter' && i >= 0 && o[i].matches(':hover, .sel')) { e.preventDefault(); e.stopPropagation(); o[i].click(); } } // other keys type into the input
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); mark(e.key === 'Home' ? 0 : o.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (i >= 0) o[i].click(); else close(); }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { const k = o.findIndex((x, n) => n > i && x.textContent.toLowerCase().startsWith(e.key.toLowerCase())); const j = k >= 0 ? k : o.findIndex((x) => x.textContent.toLowerCase().startsWith(e.key.toLowerCase())); if (j >= 0) mark(j); }
      return;
    }
    const s = document.activeElement;
    if (isCombo(s) && e.key === 'ArrowDown') { e.preventDefault(); openCombo(s); return; }
    if (eligible(s) && (e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')))) { e.preventDefault(); open(s); }
  }, true);
})();
