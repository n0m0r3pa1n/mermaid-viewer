/* global mermaid, MermaidExtract, api */
'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  tabs: $('tabs'),
  workspace: $('workspace'),
  editorPane: $('editor-pane'),
  editor: $('editor'),
  gutter: $('gutter'),
  error: $('error'),
  splitter: $('splitter'),
  preview: $('preview-pane'),
  viewport: $('viewport'),
  canvas: $('canvas'),
  zoomLabel: $('btn-zoom-label'),
  empty: $('empty'),
  toast: $('toast'),
  drop: $('drop-overlay'),
  watch: $('chk-watch'),
  theme: $('sel-theme'),
  multi: $('sel-multi'),
  present: $('present'),
  presentStage: $('present-stage'),
};

const SAMPLE = `---
title: Order flow
---
flowchart LR
    A[Customer] -->|places order| B(Web shop)
    B --> C{In stock?}
    C -->|yes| D[Ship it]
    C -->|no| E[Back-order]
    D --> F([Done])
    E --> B
`;

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const state = {
  tabs: [],
  activeId: null,
  settings: {
    theme: 'auto',
    layout: 'side',
    editorVisible: true,
    watch: true,
    editorSize: null,
    multi: 'board', // several diagrams in one paste: 'board' | 'tabs'
  },
};
let nextId = 1;

// ============================================================ helpers

const basename = (p) => (p ? p.split(/[\\/]/).pop() : '');
const extname = (p) => (basename(p).match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
const norm = (s) => s.replace(/\r\n?/g, '\n').trim();
const active = () => state.tabs.find((t) => t.id === state.activeId) || null;
const isDirty = (t) => (t.path || t.doc ? t.code !== t.savedCode : false);

function debounce(fn, ms) {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  };
}

let toastTimer;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
}

// ============================================================ mermaid setup

function effectiveTheme() {
  const t = state.settings.theme;
  if (t === 'auto') return darkQuery.matches ? 'dark' : 'default';
  return t;
}

function configureMermaid(extra = {}) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: effectiveTheme(),
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif',
    ...extra,
  });
  // Light themes get a light canvas even when the app is dark, and vice versa
  const darkCanvas = effectiveTheme() === 'dark';
  els.preview.style.setProperty('--canvas', darkCanvas ? '#1e2024' : '#ffffff');
  els.preview.style.setProperty('--grid', darkCanvas ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)');
}

function canvasColor() {
  return effectiveTheme() === 'dark' ? '#1e2024' : '#ffffff';
}

let renderSeq = 0;

async function renderToSvg(code) {
  const id = 'mmd-' + ++renderSeq;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // Mermaid leaves its scratch element behind on errors
    document.getElementById(id)?.remove();
    document.getElementById('d' + id)?.remove();
  }
}

// Rendered SVG per (theme, code): boards re-render on every keystroke, but
// usually only one of their diagrams actually changed.
const svgCache = new Map();

async function renderCached(code) {
  const key = effectiveTheme() + '\n' + code;
  if (svgCache.has(key)) return svgCache.get(key);
  const svg = await renderToSvg(code);
  if (svgCache.size > 300) svgCache.clear();
  svgCache.set(key, svg);
  return svg;
}

const errorText = (err) => String(err?.message || err).trim();

// ============================================================ boards
// A board is a tab whose code is Markdown with several ```mermaid blocks;
// the preview shows all of them stacked vertically.

const fence = (code) => '```mermaid\n' + code.replace(/\s+$/, '') + '\n```';
const boardCode = (codes) => codes.map(fence).join('\n\n') + '\n';
const boardBlocks = (code) => MermaidExtract.extract(code, { dedupe: false }).filter((b) => b.range);

function appendToBoard(tab, diagrams) {
  const fresh = diagrams;
  if (!fresh.length) return 0;
  const base = tab.code.replace(/\s+$/, '');
  tab.code = (base ? base + '\n\n' : '') + boardCode(fresh.map((d) => d.code));
  if (tab.id === state.activeId) {
    els.editor.value = tab.code;
    els.editor.scrollTop = els.editor.scrollHeight;
    updateGutter();
    updateTitle();
    renderActive().then(() => scrollBoardToEnd(tab));
  }
  renderTabs();
  persist();
  return fresh.length;
}

function scrollBoardToEnd(tab) {
  if (tab.id !== state.activeId || !tab.view || !tab.svgSize) return;
  const vh = els.viewport.clientHeight;
  const h = tab.svgSize.h * tab.view.scale;
  if (h > vh) {
    tab.view.y = vh - h - 32;
    applyView();
  }
}

/**
 * A single-diagram tab whose text actually holds several diagrams (pasted
 * into the editor, or saved by an older version) becomes a board. Files are
 * left alone: a .mmd file must stay one diagram on disk.
 */
function splitIntoBoard(tab) {
  if (!tab || tab.stack || tab.path || tab.doc) return false;
  const found = MermaidExtract.extract(tab.code, { dedupe: false });
  if (found.length < 2) return false;
  tab.stack = true;
  tab.title = 'Board';
  tab.code = boardCode(found.map((d) => d.code));
  tab.savedCode = tab.code;
  tab.svg = null;
  tab.parts = null;
  tab.view = null;
  tab.error = null;
  if (tab.id === state.activeId) {
    els.editor.value = tab.code;
    updateGutter();
    updateTitle();
  }
  renderTabs();
  persist();
  toast(`Found ${found.length} diagrams: showing them as a board`);
  return true;
}

function newBoard(codes = []) {
  const tab = addTab(makeTab({ stack: true, title: 'Board', code: codes.length ? boardCode(codes) : '' }));
  if (!codes.length) toast('Empty board: paste diagrams (⌘/Ctrl+V) and they stack up here');
  return tab;
}

function combineTabs() {
  const codes = [];
  for (const t of state.tabs) {
    if (t.stack) boardBlocks(t.code).forEach((b) => codes.push(b.code));
    else if (t.code.trim()) codes.push(t.code);
  }
  const unique = [...new Map(codes.map((c) => [norm(c), c])).values()];
  if (unique.length < 2) return toast('Open at least two diagrams to combine');
  newBoard(unique);
  toast(`Combined ${unique.length} diagrams into a board`);
}

// ============================================================ tabs

function makeTab(props) {
  return {
    id: nextId++,
    title: 'Untitled',
    code: '',
    savedCode: '',
    path: null,
    doc: null, // markdown document this diagram belongs to
    blockIndex: -1,
    view: null, // {scale, x, y}
    svg: null,
    svgSize: null,
    error: null,
    stack: false, // board with several diagrams
    parts: null, // board render results: [{title, code, svg, error, line}]
    ...props,
  };
}

function addTab(tab, activate = true) {
  state.tabs.push(tab);
  if (activate) activateTab(tab.id);
  else renderTabs();
  persist();
  return tab;
}

function activateTab(id) {
  const prev = active();
  if (prev) prev.editorScroll = { top: els.editor.scrollTop, left: els.editor.scrollLeft };
  state.activeId = id;
  const tab = active();
  splitIntoBoard(tab);
  renderTabs();
  updateEmpty();
  if (!tab) return;
  els.editor.value = tab.code;
  els.editor.scrollTop = tab.editorScroll?.top || 0;
  els.editor.scrollLeft = tab.editorScroll?.left || 0;
  updateGutter();
  updateTitle();
  if (tab.stack ? tab.parts : tab.svg) {
    tab.stack ? mountBoard(tab) : mountSvg(tab);
    showError(tab.error);
  } else {
    els.canvas.innerHTML = '';
    renderActive();
  }
  persist();
}

async function closeTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (isDirty(tab)) {
    const choice = await api.confirmDiscard(`Save changes to “${tabLabel(tab)}” before closing?`);
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveTab(tab))) return;
  }
  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  if (state.activeId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    state.activeId = null;
    if (next) activateTab(next.id);
    else {
      els.canvas.innerHTML = '';
      els.editor.value = '';
      showError(null);
      updateTitle();
    }
  }
  renderTabs();
  updateEmpty();
  persist();
}

function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = state.tabs[(i + dir + state.tabs.length) % state.tabs.length];
  activateTab(next.id);
}

function tabLabel(tab) {
  if (tab.doc) {
    const siblings = state.tabs.filter((t) => t.doc === tab.doc);
    const name = basename(tab.doc.path);
    return siblings.length > 1 || tab.doc.blocks.length > 1 ? `${name} › ${tab.title}` : name;
  }
  if (tab.path) return basename(tab.path);
  if (tab.stack) return `${tab.title} · ${tab.parts ? tab.parts.length : boardBlocks(tab.code).length}`;
  return tab.title;
}

function renderTabs() {
  els.tabs.innerHTML = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.error ? ' error' : '');
    el.title = tab.doc?.path || tab.path || tab.title;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = tabLabel(tab);
    el.appendChild(name);
    if (isDirty(tab)) {
      const d = document.createElement('span');
      d.className = 'dirty';
      el.appendChild(d);
    }
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    el.appendChild(close);
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tab.id);
      }
    });
    el.addEventListener('click', () => activateTab(tab.id));
    els.tabs.appendChild(el);
    if (tab.id === state.activeId) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function updateEmpty() {
  els.empty.hidden = state.tabs.length > 0;
}

function updateTitle() {
  const tab = active();
  const title = tab ? `${tabLabel(tab)}${isDirty(tab) ? ' •' : ''} — Mermaid Viewer` : 'Mermaid Viewer';
  api.setTitle(title);
  api.setEdited(state.tabs.some(isDirty));
}

// ============================================================ rendering

async function renderActive() {
  const tab = active();
  if (!tab) return;
  if (tab.stack) return renderBoard(tab);
  const code = tab.code;
  if (!code.trim()) {
    tab.svg = null;
    tab.error = null;
    els.canvas.innerHTML = '';
    showError(null);
    return;
  }
  try {
    const svg = await renderCached(code);
    if (tab.code !== code) return; // edited meanwhile; a newer render is queued
    tab.svg = svg;
    tab.error = null;
    if (tab.id === state.activeId) {
      mountSvg(tab);
      showError(null);
    }
  } catch (err) {
    if (tab.code !== code) return;
    tab.error = errorText(err);
    if (tab.id === state.activeId) {
      showError(tab.error);
      els.canvas.classList.add('stale'); // keep last good render, dimmed
    }
  }
  renderTabs();
}

async function renderBoard(tab) {
  const code = tab.code;
  const parts = [];
  for (const b of boardBlocks(code)) {
    const line = code.slice(0, b.range.start).split('\n').length; // first line of the diagram
    try {
      parts.push({ title: b.title, code: b.code, line, svg: await renderCached(b.code) });
    } catch (err) {
      parts.push({ title: b.title, code: b.code, line, error: errorText(err) });
    }
    if (tab.code !== code) return; // edited meanwhile
  }
  tab.parts = parts;
  // Report errors with line numbers relative to the whole board
  const errors = parts
    .map((p, i) => {
      if (!p.error) return null;
      const local = +((p.error.match(/line (\d+)/i) || [])[1] || 1);
      return `Diagram ${i + 1}, line ${p.line + local - 1}:\n${p.error}`;
    })
    .filter(Boolean);
  tab.error = errors.length ? errors.join('\n\n') : null;
  if (tab.id === state.activeId) {
    mountBoard(tab);
    showError(tab.error);
  }
  renderTabs();
}

const renderDebounced = debounce(renderActive, 220);

function mountSvg(tab) {
  els.canvas.innerHTML = tab.svg;
  els.canvas.classList.remove('stale');
  const svg = els.canvas.querySelector('svg');
  if (!svg) return;
  const vb = svg.viewBox?.baseVal;
  let w = vb && vb.width ? vb.width : svg.getBBox().width;
  let h = vb && vb.height ? vb.height : svg.getBBox().height;
  svg.style.maxWidth = 'none';
  svg.removeAttribute('height');
  tab.svgSize = { w, h };
  if (!tab.view) fitView(tab);
  else applyView();
}

function mountBoard(tab) {
  const board = document.createElement('div');
  board.className = 'board';
  if (!tab.parts.length) {
    board.innerHTML = '<div class="board-empty">No diagrams yet. Paste text with Mermaid diagrams (⌘/Ctrl+V) to add them here.</div>';
  }
  tab.parts.forEach((p, i) => {
    const fig = document.createElement('figure');
    fig.className = 'board-item' + (p.error ? ' error' : '');
    const cap = document.createElement('figcaption');
    cap.textContent = `${i + 1}. ${p.title}`;
    fig.appendChild(cap);
    if (p.svg) {
      fig.insertAdjacentHTML('beforeend', p.svg);
      const svg = fig.querySelector('svg');
      const vb = svg.viewBox?.baseVal;
      if (vb?.width) {
        svg.setAttribute('width', vb.width);
        svg.setAttribute('height', vb.height);
      }
      svg.style.maxWidth = 'none';
    } else {
      const pre = document.createElement('pre');
      pre.textContent = p.error;
      fig.appendChild(pre);
    }
    board.appendChild(fig);
  });
  els.canvas.replaceChildren(board);
  els.canvas.classList.remove('stale');
  board.style.zoom = 1;
  tab.svgSize = { w: board.offsetWidth, h: board.offsetHeight };
  if (!tab.view) fitView(tab);
  else applyView();
}

function showError(msg) {
  els.error.hidden = !msg;
  els.error.textContent = msg || '';
  updateGutter();
}

// ============================================================ zoom & pan

function applyView() {
  const tab = active();
  if (!tab || !tab.view || !tab.svgSize) return;
  const { scale, x, y } = tab.view;
  if (tab.stack) {
    // CSS zoom re-lays-out the board, so the SVGs stay crisp
    const board = els.canvas.querySelector('.board');
    if (!board) return;
    board.style.zoom = scale;
  } else {
    // Resize the SVG itself (instead of CSS scale) so it stays crisp at any zoom
    const svg = els.canvas.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', tab.svgSize.w * scale);
    svg.setAttribute('height', tab.svgSize.h * scale);
  }
  els.canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  els.zoomLabel.textContent = Math.round(scale * 100) + '%';
}

function fitView(tab = active()) {
  if (!tab || !tab.svgSize) return;
  const pad = 32;
  const vw = els.viewport.clientWidth;
  const vh = els.viewport.clientHeight;
  const { w, h } = tab.svgSize;
  if (tab.stack) {
    // Boards fit to width and start at the top; scroll down through them
    const scale = Math.max(MIN_SCALE, Math.min((vw - pad * 2) / w, 1.25));
    const y = h * scale < vh ? (vh - h * scale) / 2 : pad;
    tab.view = { scale, x: (vw - w * scale) / 2, y };
    return applyView();
  }
  const scale = Math.max(MIN_SCALE, Math.min((vw - pad * 2) / w, (vh - pad * 2) / h, 2));
  tab.view = { scale, x: (vw - w * scale) / 2, y: (vh - h * scale) / 2 };
  applyView();
}

function zoomAt(factor, cx, cy) {
  const tab = active();
  if (!tab?.view) return;
  const v = tab.view;
  if (cx == null) {
    cx = els.viewport.clientWidth / 2;
    cy = els.viewport.clientHeight / 2;
  }
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  v.x = cx - (cx - v.x) * k;
  v.y = cy - (cy - v.y) * k;
  v.scale = scale;
  applyView();
}

function zoomTo(scale) {
  const tab = active();
  if (tab?.view) zoomAt(scale / tab.view.scale);
}

els.viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const tab = active();
    if (!tab?.view) return;
    const rect = els.viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // Pinch-zoom on trackpads arrives as ctrl+wheel with small deltas
      const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY));
      zoomAt(Math.exp(-d * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      const mult = e.deltaMode === 1 ? 20 : 1;
      tab.view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * mult;
      tab.view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * mult;
      applyView();
    }
  },
  { passive: false }
);

let pan = null;
els.viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const tab = active();
  if (!tab?.view) return;
  pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: tab.view.x, y: tab.view.y };
  els.viewport.setPointerCapture(e.pointerId);
  els.viewport.classList.add('panning');
});
els.viewport.addEventListener('pointermove', (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  const tab = active();
  tab.view.x = pan.x + (e.clientX - pan.sx);
  tab.view.y = pan.y + (e.clientY - pan.sy);
  applyView();
});
const endPan = () => {
  pan = null;
  els.viewport.classList.remove('panning');
};
els.viewport.addEventListener('pointerup', endPan);
els.viewport.addEventListener('pointercancel', endPan);
els.viewport.addEventListener('dblclick', () => fitView());

$('btn-zoom-in').onclick = () => zoomAt(1.25);
$('btn-zoom-out').onclick = () => zoomAt(0.8);
$('btn-zoom-fit').onclick = () => fitView();
els.zoomLabel.onclick = () => zoomTo(1);

new ResizeObserver(() => {
  // Keep the diagram centred-ish when panes resize
  const tab = active();
  if (tab?.view && tab.lastViewport) {
    tab.view.x += (els.viewport.clientWidth - tab.lastViewport.w) / 2;
    tab.view.y += (els.viewport.clientHeight - tab.lastViewport.h) / 2;
    applyView();
  }
  if (tab) tab.lastViewport = { w: els.viewport.clientWidth, h: els.viewport.clientHeight };
}).observe(els.viewport);

// ============================================================ editor

function updateGutter() {
  const n = els.editor.value.split('\n').length;
  const tab = active();
  const errLine = tab?.error ? +((tab.error.match(/line (\d+)/i) || [])[1] || 0) : 0;
  let html = '';
  for (let i = 1; i <= n; i++) html += i === errLine ? `<span class="err">${i}</span>\n` : i + '\n';
  els.gutter.innerHTML = html;
  els.gutter.scrollTop = els.editor.scrollTop;
}

els.editor.addEventListener('input', () => {
  const tab = active();
  if (!tab) return;
  const wasDirty = isDirty(tab);
  tab.code = els.editor.value;
  updateGutter();
  if (wasDirty !== isDirty(tab)) {
    renderTabs();
  }
  updateTitle();
  renderDebounced();
  persist();
});

els.editor.addEventListener('scroll', () => {
  els.gutter.scrollTop = els.editor.scrollTop;
});

els.editor.addEventListener('paste', () => {
  // After the pasted text lands: several diagrams in a single tab → board
  setTimeout(() => {
    const tab = active();
    if (splitIntoBoard(tab)) {
      els.editor.selectionStart = els.editor.selectionEnd = els.editor.value.length;
      renderActive();
    }
  }, 0);
});

els.editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  const ta = els.editor;
  const { selectionStart: s, selectionEnd: end, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  if (s === end && !e.shiftKey) {
    document.execCommand('insertText', false, '    ');
    return;
  }
  // Indent / outdent all selected lines
  const blockEnd = end > s && value[end - 1] === '\n' ? end - 1 : end;
  const lines = value.slice(lineStart, blockEnd).split('\n');
  const out = lines.map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l)).join('\n');
  ta.setSelectionRange(lineStart, blockEnd);
  document.execCommand('insertText', false, out);
  ta.setSelectionRange(lineStart, lineStart + out.length);
});

// ============================================================ import (paste / clipboard / drop)

let lastInternalCopy = 0;
document.addEventListener('copy', () => (lastInternalCopy = Date.now()));
document.addEventListener('cut', () => (lastInternalCopy = Date.now()));

/**
 * Extract diagrams from arbitrary text and open each as a tab.
 * Diagrams that are already open are focused instead of duplicated.
 */
// Text that auto-import already brought in, so pressing ⌘V on the same
// clipboard right afterwards doesn't add everything a second time
let lastAutoImport = null;

function importText(text, { strict = false, silent = false, from = 'clipboard', auto = false } = {}) {
  if (!auto && lastAutoImport && Date.now() - lastAutoImport.at < 120000 && norm(text || '') === lastAutoImport.text) {
    lastAutoImport = null;
    if (!silent) toast('Already imported from the clipboard');
    return 0;
  }
  // Keep repeated diagrams: pasting the same one twice means two copies
  const found = MermaidExtract.extract(text || '', { strict, dedupe: false });
  if (!found.length) {
    if (!silent) toast(text?.trim() ? `No Mermaid diagram found in ${from}` : `The ${from} is empty`);
    return 0;
  }
  // Pasting while a board is open adds to that board
  const board = active()?.stack ? active() : null;
  if (board) {
    const n = appendToBoard(board, found);
    toast(`Added ${n} diagram${n > 1 ? 's' : ''} to the board`);
    return n;
  }
  if (found.length > 1 && state.settings.multi === 'board') {
    newBoard(found.map((d) => d.code));
    toast(`Imported ${found.length} diagrams from ${from} as a board`);
    return found.length;
  }
  let firstId = null;
  let added = 0;
  for (const d of found) {
    const existing = state.tabs.find((t) => norm(t.code) === norm(d.code));
    if (existing) {
      firstId ??= existing.id;
      continue;
    }
    const tab = addTab(makeTab({ title: d.title, code: d.code }), false);
    firstId ??= tab.id;
    added++;
  }
  if (firstId != null) activateTab(firstId);
  if (added) toast(`Imported ${added} diagram${added > 1 ? 's' : ''} from ${from}`);
  else if (!silent) toast('Already open');
  return added;
}

async function importFromClipboard() {
  importText(await api.readClipboard(), { from: 'clipboard' });
}

// Cmd/Ctrl+V anywhere except the editor imports
document.addEventListener('paste', (e) => {
  if (e.target === els.editor || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  importText(e.clipboardData.getData('text/plain'), { from: 'clipboard' });
});

api.onClipboardChanged((text) => {
  if (!state.settings.watch) return;
  if (Date.now() - lastInternalCopy < 2000) return; // our own copy
  if (importText(text, { strict: true, silent: true, from: 'clipboard', auto: true })) {
    lastAutoImport = { text: norm(text), at: Date.now() };
  }
});

// ---- drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  els.drop.hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    els.drop.hidden = true;
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  const files = [...e.dataTransfer.files];
  if (files.length) {
    for (const f of files) {
      const p = api.pathForFile(f);
      if (p) openFileContent(p, await f.text());
      else importText(await f.text(), { from: f.name });
    }
    return;
  }
  const text = e.dataTransfer.getData('text/plain');
  if (text) importText(text, { from: 'dropped text' });
});

// ============================================================ files

function openFileContent(path, content) {
  const ext = extname(path);
  content = content.replace(/\r\n?/g, '\n');

  // Already open? Focus it (and refresh if unchanged locally)
  const open = state.tabs.filter((t) => (t.doc ? t.doc.path : t.path) === path);
  if (open.length) {
    if (!open.some(isDirty)) open.forEach((t) => state.tabs.splice(state.tabs.indexOf(t), 1));
    else {
      activateTab(open[0].id);
      toast('File is already open with unsaved changes');
      return;
    }
  }

  if (ext === 'md' || ext === 'markdown') {
    const blocks = MermaidExtract.extract(content).filter((b) => b.range);
    if (!blocks.length) {
      toast(`No \`\`\`mermaid blocks in ${basename(path)}`);
      renderTabs();
      return;
    }
    if (state.settings.multi === 'board') {
      addTab(makeTab({ stack: true, title: basename(path), code: content, savedCode: content, path }));
      return;
    }
    const doc = { path, text: content, blocks };
    let first = null;
    blocks.forEach((b, i) => {
      const titles = blocks.filter((x) => x.title === b.title).length > 1 ? `${b.title} ${i + 1}` : b.title;
      const tab = addTab(makeTab({ title: titles, code: b.code, savedCode: b.code, doc, blockIndex: i }), false);
      first ??= tab;
    });
    activateTab(first.id);
    if (blocks.length > 1) toast(`Opened ${blocks.length} diagrams from ${basename(path)}`);
    return;
  }

  if (ext === 'mmd' || ext === 'mermaid') {
    const tab = makeTab({ title: basename(path), code: content, savedCode: content, path });
    tab.title = MermaidExtract.titleFor(content);
    addTab(tab);
    return;
  }

  // Anything else (logs, .txt): import like a paste
  importText(content, { from: basename(path) });
}

api.onFileOpened(({ path, content }) => openFileContent(path, content));

async function openDialog() {
  const files = await api.openDialog();
  files.forEach((f) => openFileContent(f.path, f.content));
}

function docText(doc) {
  const codes = doc.blocks.map((b, i) => {
    const tab = state.tabs.find((t) => t.doc === doc && t.blockIndex === i);
    return tab ? tab.code : b.code;
  });
  return { text: MermaidExtract.replaceBlocks(doc.text, doc.blocks, codes), codes };
}

async function saveTab(tab = active(), saveAs = false) {
  if (!tab) return false;

  if (tab.doc) {
    const doc = tab.doc;
    const { text, codes } = docText(doc);
    const target = await api.saveFile({
      path: saveAs ? null : doc.path,
      content: text,
      defaultName: basename(doc.path),
    });
    if (!target) return false;
    // Re-index blocks against the new text so later saves land in the right place
    const blocks = MermaidExtract.extract(text).filter((b) => b.range);
    doc.path = target;
    doc.text = text;
    if (blocks.length === doc.blocks.length) doc.blocks = blocks;
    else doc.blocks.forEach((b, i) => (b.code = codes[i]));
    state.tabs.filter((t) => t.doc === doc).forEach((t) => (t.savedCode = t.code));
  } else {
    const slug = (tab.title || 'diagram').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    const content = tab.code.endsWith('\n') ? tab.code : tab.code + '\n';
    const target = await api.saveFile({
      path: saveAs ? null : tab.path,
      content,
      defaultName: tab.path ? basename(tab.path) : (slug || 'diagram') + (tab.stack ? '.md' : '.mmd'),
      wrapMarkdown: !tab.stack,
    });
    if (!target) return false;
    if (!tab.stack && /\.(md|markdown)$/i.test(target)) {
      // Saved as markdown: reopen as a markdown document so edits keep round-tripping
      const fenced = '```mermaid\n' + content + '```\n';
      const blocks = MermaidExtract.extract(fenced).filter((b) => b.range);
      tab.doc = { path: target, text: fenced, blocks };
      tab.blockIndex = 0;
      tab.path = null;
      tab.savedCode = tab.code;
    } else {
      tab.path = target;
      tab.savedCode = tab.code;
    }
  }
  renderTabs();
  updateTitle();
  persist();
  toast('Saved');
  return true;
}

// ============================================================ export

function exportableSvg(svgText, background) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb?.length === 4) {
    svg.setAttribute('width', vb[2]);
    svg.setAttribute('height', vb[3]);
  }
  svg.style.maxWidth = '';
  if (background) svg.style.backgroundColor = background;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { text: new XMLSerializer().serializeToString(svg), w: vb?.[2] || 800, h: vb?.[3] || 600 };
}

/** One SVG with every board diagram stacked, each with a caption. */
function boardSvg(parts, background) {
  const gap = 40;
  const pad = 24;
  const capH = 28;
  const items = parts.filter((p) => p.svg).map((p) => ({ ...exportableSvg(p.svg), title: p.title }));
  const W = Math.max(...items.map((i) => i.w)) + pad * 2;
  const NS = 'http://www.w3.org/2000/svg';
  const doc = document.implementation.createDocument(NS, 'svg', null);
  const root = doc.documentElement;
  const muted = effectiveTheme() === 'dark' ? '#8d95a0' : '#69717c';
  let y = pad;
  items.forEach((it, i) => {
    const t = doc.createElementNS(NS, 'text');
    t.setAttribute('x', pad);
    t.setAttribute('y', y + 16);
    t.setAttribute('fill', muted);
    t.setAttribute('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif');
    t.setAttribute('font-size', '14');
    t.setAttribute('font-weight', '600');
    t.textContent = `${i + 1}. ${it.title}`;
    root.appendChild(t);
    const el = doc.importNode(new DOMParser().parseFromString(it.text, 'image/svg+xml').documentElement, true);
    el.setAttribute('x', (W - it.w) / 2);
    el.setAttribute('y', y + capH);
    el.style.backgroundColor = '';
    root.appendChild(el);
    y += capH + it.h + gap;
  });
  const H = y - gap + pad;
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  root.setAttribute('width', W);
  root.setAttribute('height', H);
  if (background) root.setAttribute('style', `background-color: ${background}`);
  return new XMLSerializer().serializeToString(root);
}

async function svgToPngDataUrl(svgText, scale = 2) {
  const { text, w, h } = exportableSvg(svgText);
  const max = 16000;
  scale = Math.min(scale, max / w, max / h);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = canvasColor();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png'); // throws if the canvas got tainted
}

const hasOutput = (tab) => (tab?.stack ? tab.parts?.some((p) => p.svg) : !!tab?.svg);
const activeSvg = (tab, background) => (tab.stack ? boardSvg(tab.parts, background) : tab.svg);

async function pngForActive() {
  const tab = active();
  if (!hasOutput(tab)) {
    toast('Nothing to export');
    return null;
  }
  try {
    return await svgToPngDataUrl(activeSvg(tab));
  } catch {
    // HTML labels (foreignObject) can block rasterising: re-render with plain SVG text
    configureMermaid({ htmlLabels: false, flowchart: { htmlLabels: false } });
    try {
      if (tab.stack) {
        const parts = [];
        for (const p of tab.parts.filter((p) => p.svg)) parts.push({ ...p, svg: await renderToSvg(p.code) });
        return await svgToPngDataUrl(boardSvg(parts));
      }
      return await svgToPngDataUrl(await renderToSvg(tab.code));
    } catch (err) {
      toast('PNG export failed: ' + (err?.message || err));
      return null;
    } finally {
      configureMermaid();
    }
  }
}

function exportName(ext) {
  const tab = active();
  const base = tab.doc ? `${basename(tab.doc.path).replace(/\.\w+$/, '')}-${tab.blockIndex + 1}` : tab.path ? basename(tab.path).replace(/\.\w+$/, '') : tab.title;
  return (base || 'diagram').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.' + ext;
}

async function exportSvg() {
  const tab = active();
  if (!hasOutput(tab)) return toast('Nothing to export');
  const { text } = exportableSvg(activeSvg(tab), canvasColor());
  const p = await api.exportFile({ defaultName: exportName('svg'), data: '<?xml version="1.0" encoding="UTF-8"?>\n' + text, ext: 'svg' });
  if (p) toast('Exported ' + basename(p));
}

async function exportPng() {
  const url = await pngForActive();
  if (!url) return;
  const p = await api.exportFile({ defaultName: exportName('png'), data: url.split(',')[1], encoding: 'base64', ext: 'png' });
  if (p) toast('Exported ' + basename(p));
}

async function copyPng() {
  const url = await pngForActive();
  if (!url) return;
  await api.writeClipboardPng(url);
  lastInternalCopy = Date.now();
  toast('Diagram copied to clipboard as image');
}

// ============================================================ layout & settings

function applySettings() {
  const s = state.settings;
  els.workspace.classList.toggle('stacked', s.layout === 'stacked');
  els.workspace.classList.toggle('side', s.layout !== 'stacked');
  els.workspace.classList.toggle('no-editor', !s.editorVisible);
  $('btn-editor').classList.toggle('active', s.editorVisible);
  els.watch.checked = s.watch;
  els.theme.value = s.theme;
  els.multi.value = s.multi;
  const size = s.editorSize?.[s.layout];
  els.editorPane.style.width = s.layout === 'side' && size ? size + 'px' : '';
  els.editorPane.style.height = s.layout === 'stacked' && size ? size + 'px' : '';
}

function rerenderAll() {
  state.tabs.forEach((t) => {
    t.svg = null;
    t.parts = null;
  });
  configureMermaid();
  renderActive();
}

$('btn-editor').onclick = () => {
  state.settings.editorVisible = !state.settings.editorVisible;
  applySettings();
  persist();
};
$('btn-layout').onclick = () => {
  state.settings.layout = state.settings.layout === 'side' ? 'stacked' : 'side';
  applySettings();
  persist();
};
els.theme.onchange = () => {
  state.settings.theme = els.theme.value;
  rerenderAll();
  persist();
};
els.multi.onchange = () => {
  state.settings.multi = els.multi.value;
  persist();
};
darkQuery.addEventListener('change', () => state.settings.theme === 'auto' && rerenderAll());

els.watch.onchange = () => {
  state.settings.watch = els.watch.checked;
  api.setClipboardWatch(els.watch.checked);
  persist();
};
api.onClipboardWatchState((on) => {
  state.settings.watch = on;
  els.watch.checked = on;
  persist();
});

// Splitter
els.splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  els.splitter.setPointerCapture(e.pointerId);
  els.splitter.classList.add('dragging');
  const stacked = state.settings.layout === 'stacked';
  const rect = els.workspace.getBoundingClientRect();
  const move = (ev) => {
    const size = stacked ? ev.clientY - rect.top : ev.clientX - rect.left;
    const max = (stacked ? rect.height : rect.width) - 150;
    const v = Math.max(150, Math.min(max, size));
    state.settings.editorSize = { ...(state.settings.editorSize || {}), [state.settings.layout]: v };
    applySettings();
  };
  const up = () => {
    els.splitter.classList.remove('dragging');
    els.splitter.removeEventListener('pointermove', move);
    els.splitter.removeEventListener('pointerup', up);
    persist();
  };
  els.splitter.addEventListener('pointermove', move);
  els.splitter.addEventListener('pointerup', up);
});

// ============================================================ session persistence

function persistNow() {
  const tabs = [];
  const seenDocs = new Set();
  for (const t of state.tabs) {
    if (t.doc) {
      if (seenDocs.has(t.doc)) continue;
      seenDocs.add(t.doc);
      tabs.push({ path: t.doc.path });
    } else if (t.path && !isDirty(t)) tabs.push({ path: t.path });
    else tabs.push({ title: t.title, code: t.code, path: t.path, savedCode: t.savedCode, stack: t.stack });
  }
  const a = active();
  const activeIndex = a ? state.tabs.indexOf(a) : -1;
  try {
    localStorage.setItem('session', JSON.stringify({ settings: state.settings, tabs, activeIndex }));
  } catch {}
}
const persist = debounce(persistNow, 400);

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('session') || 'null');
    if (saved?.settings) Object.assign(state.settings, saved.settings);
    return saved;
  } catch {
    return null;
  }
}

async function restoreTabs(saved) {
  if (!saved) return;
  for (const t of saved.tabs || []) {
    if (t.code != null) {
      addTab(makeTab({ title: t.title, code: t.code, path: t.path, savedCode: t.savedCode ?? t.code, stack: !!t.stack }), false);
    } else if (t.path) {
      const content = await api.readFile(t.path);
      if (content != null) {
        const before = state.tabs.length;
        openFileContent(t.path, content);
        if (state.tabs.length === before) continue;
      }
    }
  }
  const target = state.tabs[Math.min(Math.max(saved.activeIndex, 0), state.tabs.length - 1)];
  if (target) activateTab(target.id);
}

// ============================================================ close handling

api.onRequestClose(async () => {
  const dirty = state.tabs.filter(isDirty);
  if (dirty.length) {
    const names = [...new Set(dirty.map((t) => basename(t.doc?.path || t.path)))];
    const choice = await api.confirmDiscard(
      names.length === 1 ? `Save changes to “${names[0]}” before quitting?` : `Save changes to ${names.length} files before quitting?`
    );
    if (choice === 'cancel') return api.closeCancelled();
    if (choice === 'save') {
      const savedDocs = new Set();
      for (const t of dirty) {
        if (t.doc && savedDocs.has(t.doc)) continue;
        if (t.doc) savedDocs.add(t.doc);
        if (!(await saveTab(t))) return api.closeCancelled();
      }
    }
  }
  persistNow();
  api.closeConfirmed();
});

// ============================================================ present mode

const present = { slides: [], index: 0, on: false };

async function collectSlides() {
  const tab = active();
  // A board presents its own diagrams; otherwise every open tab is a slide
  const sources = tab?.stack ? [tab] : state.tabs;
  const slides = [];
  for (const t of sources) {
    const codes = t.stack ? boardBlocks(t.code).map((b) => ({ code: b.code, title: b.title })) : [{ code: t.code, title: tabLabel(t) }];
    for (const c of codes) {
      if (!c.code.trim()) continue;
      try {
        slides.push({ title: c.title, svg: await renderCached(c.code), tabId: t.id });
      } catch {
        // skip diagrams with errors
      }
    }
  }
  return slides;
}

async function startPresent() {
  const slides = await collectSlides();
  if (!slides.length) return toast('Nothing to present');
  present.slides = slides;
  const tab = active();
  present.index = tab && !tab.stack ? Math.max(0, slides.findIndex((s) => s.tabId === tab.id)) : 0;
  present.on = true;
  document.activeElement?.blur();
  const dark = effectiveTheme() === 'dark';
  els.present.style.setProperty('--present-bg', canvasColor());
  els.present.style.setProperty('--present-fg', dark ? '#e3e6ea' : '#1d2125');
  els.present.hidden = false;
  api.setFullScreen(true);
  showSlide();
  // The full-screen transition resizes the window over a few hundred ms
  [250, 700, 1200].forEach((ms) => setTimeout(() => present.on && fitSlide(), ms));
}

function stopPresent() {
  if (!present.on) return;
  present.on = false;
  els.present.hidden = true;
  els.presentStage.innerHTML = '';
  api.setFullScreen(false);
}

function showSlide() {
  const s = present.slides[present.index];
  els.presentStage.innerHTML = s.svg;
  $('present-title').textContent = s.title;
  $('present-count').textContent = `${present.index + 1} / ${present.slides.length}`;
  $('present-prev').style.visibility = present.index > 0 ? '' : 'hidden';
  $('present-next').style.visibility = present.index < present.slides.length - 1 ? '' : 'hidden';
  fitSlide();
}

function fitSlide() {
  const svg = els.presentStage.querySelector('svg');
  if (!svg) return;
  const vb = svg.viewBox?.baseVal;
  if (!vb?.width) return;
  const W = els.presentStage.clientWidth * 0.9;
  const H = els.presentStage.clientHeight * 0.9;
  const scale = Math.min(W / vb.width, H / vb.height, 4);
  svg.style.maxWidth = 'none'; // Mermaid sets an inline max-width
  svg.setAttribute('width', vb.width * scale);
  svg.setAttribute('height', vb.height * scale);
}

function goSlide(delta) {
  const i = Math.min(present.slides.length - 1, Math.max(0, present.index + delta));
  if (i !== present.index) {
    present.index = i;
    showSlide();
  }
}

document.addEventListener('keydown', (e) => {
  if (!present.on) return;
  const keys = {
    ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, Enter: 1,
    ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1,
  };
  if (e.key === 'Escape') stopPresent();
  else if (e.key === 'Home') goSlide(-Infinity);
  else if (e.key === 'End') goSlide(Infinity);
  else if (keys[e.key]) goSlide(keys[e.key]);
  else return;
  e.preventDefault();
});
$('present-prev').onclick = () => goSlide(-1);
$('present-next').onclick = () => goSlide(1);
$('present-close').onclick = stopPresent;
window.addEventListener('resize', () => present.on && fitSlide());

// ============================================================ commands

function newDiagram(code = '') {
  addTab(makeTab({ title: code ? MermaidExtract.titleFor(code) : 'Untitled', code }));
  if (!code) els.editor.focus();
}

const commands = {
  new: () => newDiagram('flowchart TD\n    A[Start] --> B[End]\n'),
  open: openDialog,
  save: () => saveTab(),
  'save-as': () => saveTab(active(), true),
  'export-svg': exportSvg,
  'export-png': exportPng,
  'copy-png': copyPng,
  'close-tab': () => active() && closeTab(state.activeId),
  'import-clipboard': importFromClipboard,
  'zoom-in': () => zoomAt(1.25),
  'zoom-out': () => zoomAt(0.8),
  'zoom-reset': () => zoomTo(1),
  'zoom-fit': () => fitView(),
  'toggle-editor': () => $('btn-editor').click(),
  'toggle-layout': () => $('btn-layout').click(),
  'new-board': () => newBoard(),
  'combine-tabs': combineTabs,
  present: startPresent,
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
};
api.onMenu((cmd) => commands[cmd]?.());

$('btn-new').onclick = commands.new;
$('btn-open').onclick = commands.open;
$('btn-save').onclick = commands.save;
$('btn-paste').onclick = commands['import-clipboard'];
$('btn-export-svg').onclick = exportSvg;
$('btn-export-png').onclick = exportPng;
$('btn-copy-png').onclick = copyPng;
$('btn-board').onclick = commands['new-board'];
$('btn-present').onclick = startPresent;
$('empty-paste').onclick = commands['import-clipboard'];
$('empty-new').onclick = commands.new;
$('empty-open').onclick = commands.open;
$('empty-sample').onclick = () => newDiagram(SAMPLE);

// ============================================================ boot

(async function boot() {
  const saved = loadSession();
  configureMermaid();
  applySettings();
  await restoreTabs(saved);
  api.setClipboardWatch(state.settings.watch);
  updateEmpty();
  updateTitle();
  if (active()) renderActive();
  api.ready();
})();
