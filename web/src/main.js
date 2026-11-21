import { EditorState, EditorSelection, Compartment, Text, Transaction } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, lineNumbers, rectangularSelection, crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import {
  syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap,
  LanguageDescription,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';

import { host, isMock } from './host.js';
import { renderMarkdown, resolvePath, dirname, basename } from './preview.js';
import { showDialog, showMenu, toast, modalOpen } from './ui.js';

// ============================================================ settings

const DEFAULTS = { fontSize: 14, preview: true, wrap: true, lineNumbers: false, split: 0.5 };
// Only values the user changed are stored, so new defaults reach existing installs.
const settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('jotter.settings.v2') || '{}') };
localStorage.removeItem('jotter.settings');
function saveSettings() {
  const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k] !== v));
  localStorage.setItem('jotter.settings.v2', JSON.stringify(changed));
}

// ============================================================ DOM

const $ = id => document.getElementById(id);
const tabsEl = $('tabs');
const mainEl = $('main');
const editorEl = $('editor');
const previewEl = $('preview');
const dividerEl = $('divider');
const bannerEl = $('banner');
const st = {
  pos: $('st-pos'), count: $('st-count'), enc: $('st-enc'), eol: $('st-eol'),
  preview: $('st-preview'), zoom: $('st-zoom'),
};

// ============================================================ editor setup

const themeConf = new Compartment();
const langConf = new Compartment();
const wrapConf = new Compartment();
const gutterConf = new Compartment();
const fontConf = new Compartment();

// Colours follow VS Code's default "Dark Modern" theme (Dark+ token colours).
const vscodeHighlight = HighlightStyle.define([
  // Markdown: like VS Code, headings are bold and coloured, not enlarged.
  { tag: t.heading, fontWeight: '700', color: '#569cd6' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#ce9178' },
  { tag: t.url, color: '#ce9178', textDecoration: 'underline' },
  { tag: t.monospace, color: '#ce9178' },
  { tag: t.quote, color: '#6a9955' },
  { tag: [t.processingInstruction, t.contentSeparator], color: '#6796e6' },
  // Code (fenced blocks and non-Markdown files)
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: '#569cd6' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.string, t.special(t.string)], color: '#ce9178' },
  { tag: t.regexp, color: '#d16969' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6a9955' },
  { tag: t.number, color: '#b5cea8' },
  { tag: [t.bool, t.atom, t.null, t.self], color: '#569cd6' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
  { tag: [t.typeName, t.className, t.namespace], color: '#4ec9b0' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: '#9cdcfe' },
  { tag: t.tagName, color: '#569cd6' },
  { tag: [t.meta, t.annotation], color: '#d4d4d4' },
  { tag: t.invalid, color: '#f44747' },
]);

const vscodeTheme = EditorView.theme({
  '&': { backgroundColor: '#1f1f1f', color: '#cccccc' },
  '.cm-content': { caretColor: '#aeafad' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#aeafad', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: '#264f78' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  '.cm-gutters': { backgroundColor: '#1f1f1f', color: '#6e7681', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#cccccc' },
  '.cm-searchMatch': { backgroundColor: '#623315', outline: '1px solid #9e6a03' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#9e6a03' },
  '.cm-selectionMatch': { backgroundColor: '#add6ff26' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: '#0064001a', outline: '1px solid #888888' },
  // Find/replace panel in the same rounded, capsule style as the rest of the app.
  '.cm-panels': { backgroundColor: '#1f1f1f', color: '#d4d4d4' },
  '.cm-panels.cm-panels-top': { borderBottom: '0.5px solid rgba(255, 255, 255, 0.08)' },
  '.cm-panel input[type=text], .cm-textfield': {
    height: '28px', padding: '0 10px', margin: '3px 4px 3px 0', border: 'none', borderRadius: '8px',
    backgroundColor: 'rgba(120, 120, 128, 0.24)', color: '#f5f5f7', outline: 'none', fontSize: '13px',
  },
  '.cm-textfield:focus': { boxShadow: '0 0 0 2px #0a84ff' },
  '.cm-panel button, .cm-button': {
    height: '26px', padding: '0 12px', margin: '3px 4px 3px 0', border: 'none', borderRadius: '13px',
    backgroundImage: 'none', backgroundColor: 'rgba(120, 120, 128, 0.24)', color: '#f5f5f7', fontSize: '12px',
  },
  '.cm-panel button:hover, .cm-button:hover': { backgroundColor: 'rgba(120, 120, 128, 0.34)' },
  '.cm-panel.cm-search label': {
    display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '10px', fontSize: '12px', color: '#98989f',
  },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: '#0a84ff', margin: '0' },
  '.cm-panel.cm-search [name=close]': {
    top: '10px', right: '10px', width: '24px', height: '24px', padding: '0', borderRadius: '12px',
    fontSize: '18px', lineHeight: '22px', color: '#98989f', backgroundColor: 'transparent',
  },
  '.cm-panel.cm-search [name=close]:hover': { backgroundColor: 'rgba(120, 120, 128, 0.24)', color: '#f5f5f7' },
  '.cm-foldPlaceholder': { backgroundColor: 'rgba(120, 120, 128, 0.24)', border: 'none', borderRadius: '6px', color: '#d4d4d4' },
  '.cm-tooltip': {
    backgroundColor: 'rgba(44, 44, 47, 0.92)', border: 'none', borderRadius: '10px',
    boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.4)',
  },
}, { dark: true });

const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.4' },
  '.cm-content': { padding: '6px 0 40vh' },
  '.cm-line': { padding: '0 14px' },
  '.cm-panel.cm-search': { fontFamily: 'var(--ui)', padding: '8px 44px 8px 12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--ui)' },
});

const zhPhrases = EditorState.phrases.of({
  'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全部',
  'match case': '区分大小写', 'regexp': '正则', 'by word': '全字匹配', 'replace': '替换',
  'replace all': '全部替换', 'close': '关闭', 'current match': '当前匹配', 'on line': '在行',
  'replaced match on line $': '已替换第 $ 行的匹配', 'replaced $ matches': '已替换 $ 处匹配',
  'Go to line': '跳到行', 'go': '跳转', 'Folded lines': '已折叠', 'Unfold line': '展开', 'Fold line': '折叠',
});

const markdownSupport = markdown({ base: markdownLanguage, codeLanguages: languages });

function themeExt() {
  return [vscodeTheme, syntaxHighlighting(vscodeHighlight)];
}
const fontExt = () => EditorView.theme({ '&': { fontSize: `${settings.fontSize}px` } });
const wrapExt = () => (settings.wrap ? EditorView.lineWrapping : []);
const gutterExt = () => (settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : []);

// --- Markdown editing commands ---

function toggleWrap(mark) {
  return view => {
    if (!isMarkdown(active)) return false;
    const n = mark.length;
    view.dispatch(view.state.changeByRange(range => {
      const before = view.state.sliceDoc(range.from - n, range.from);
      const after = view.state.sliceDoc(range.to, range.to + n);
      if (before === mark && after === mark) {
        return {
          changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      return {
        changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    }));
    return true;
  };
}

function insertLink(view) {
  if (!isMarkdown(active)) return false;
  view.dispatch(view.state.changeByRange(range => {
    const text = view.state.sliceDoc(range.from, range.to);
    const insert = `[${text}](url)`;
    const urlFrom = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text ? EditorSelection.range(urlFrom, urlFrom + 3) : EditorSelection.cursor(range.from + 1),
    };
  }));
  return true;
}

const editKeymap = [
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-h', run: openSearchPanel },
];

function editorExtensions() {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...editKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
      ...historyKeymap, ...foldKeymap, indentWithTab,
    ]),
    baseTheme,
    zhPhrases,
    themeConf.of(themeExt()),
    fontConf.of(fontExt()),
    wrapConf.of(wrapExt()),
    gutterConf.of(gutterExt()),
    langConf.of([]),
    EditorView.updateListener.of(onUpdate),
  ];
}

// ============================================================ tabs

/** @type {EditorView} */
let view;
const tabs = [];
let active = null;
let tabSeq = 0;
let untitledNo = 1;
const closedPaths = [];

const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i;
function isMarkdown(tab) {
  return !!tab && (!tab.path || MD_EXT.test(tab.path));
}

function makeTab({ path = null, name = null, content = '', encoding = 'UTF-8', eol = 'CRLF', mtime = null } = {}) {
  const tab = {
    id: ++tabSeq,
    path,
    name: name || (path ? basename(path) : `未命名 ${untitledNo++}`),
    encoding,
    eol,
    mtime,
    state: EditorState.create({ doc: content, extensions: editorExtensions() }),
    lang: [],
    dirty: false,
    metaDirty: false,
    scroll: 0,
    external: null, // 'modified' | 'deleted'
    externalMtime: null,
  };
  tab.savedDoc = tab.state.doc;
  loadLanguage(tab);
  return tab;
}

const stateOf = tab => (tab === active ? view.state : tab.state);

async function loadLanguage(tab) {
  let lang = [];
  if (isMarkdown(tab)) lang = markdownSupport;
  else {
    const desc = LanguageDescription.matchFilename(languages, tab.name);
    if (desc) {
      try { lang = await desc.load(); } catch { lang = []; }
    }
  }
  tab.lang = lang;
  if (tab === active) applyConfig();
}

function applyConfig() {
  if (!active) return;
  view.dispatch({
    effects: [
      themeConf.reconfigure(themeExt()),
      fontConf.reconfigure(fontExt()),
      wrapConf.reconfigure(wrapExt()),
      gutterConf.reconfigure(gutterExt()),
      langConf.reconfigure(active.lang),
    ],
  });
}

function activate(tab) {
  if (!tab) return;
  if (active && active !== tab && tabs.includes(active)) {
    active.state = view.state;
    active.scroll = view.scrollDOM.scrollTop;
  }
  const switching = active !== tab;
  active = tab;
  if (switching) {
    view.setState(tab.state);
    applyConfig();
    const top = tab.scroll;
    requestAnimationFrame(() => { view.scrollDOM.scrollTop = top; });
  }
  renderTabs();
  updateStatus();
  updateTitle();
  updateBanner();
  updatePreview();
  view.focus();
}

function recomputeDirty(tab, state = stateOf(tab)) {
  const doc = state.doc;
  const dirty = tab.metaDirty || doc.length !== tab.savedDoc.length || !doc.eq(tab.savedDoc);
  if (dirty !== tab.dirty) {
    tab.dirty = dirty;
    renderTabs();
    updateTitle();
  }
}

function onUpdate(u) {
  if (!active || u.view !== view) return;
  if (u.docChanged) {
    recomputeDirty(active, u.state);
    schedulePreview();
    scheduleSession();
  }
  if (u.docChanged || u.selectionSet) updateStatus(u.state);
}

let dragTabId = null;

function renderTabs() {
  tabsEl.replaceChildren(...tabs.map(tab => {
    const el = document.createElement('div');
    el.className = `tab${tab === active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;
    el.title = tab.path || tab.name;
    el.draggable = true;
    el.setAttribute('role', 'tab');

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.name;

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = '关闭 (Ctrl+W)';
    close.addEventListener('mousedown', e => e.stopPropagation());
    close.addEventListener('click', e => { e.stopPropagation(); closeTab(tab); });

    el.append(label, close);
    el.addEventListener('mousedown', e => { if (e.button === 0) activate(tab); });
    el.addEventListener('auxclick', e => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab); }
    });
    el.addEventListener('dragstart', e => {
      dragTabId = tab.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-jotter-tab', String(tab.id));
    });
    el.addEventListener('dragend', () => { dragTabId = null; });
    el.addEventListener('dragover', e => {
      if (dragTabId == null) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      el.classList.toggle('drop-before', e.clientX < r.left + r.width / 2);
      el.classList.toggle('drop-after', e.clientX >= r.left + r.width / 2);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', e => {
      if (dragTabId == null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = tabs.findIndex(x => x.id === dragTabId);
      const moving = tabs[from];
      if (!moving || moving === tab) { renderTabs(); return; }
      const r = el.getBoundingClientRect();
      tabs.splice(from, 1);
      let to = tabs.indexOf(tab);
      if (e.clientX >= r.left + r.width / 2) to++;
      tabs.splice(to, 0, moving);
      renderTabs();
      scheduleSession();
    });
    return el;
  }));
  tabsEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function newTab() {
  const tab = makeTab();
  const i = tabs.indexOf(active);
  tabs.splice(i + 1, 0, tab);
  activate(tab);
  scheduleSession();
}

function isBlankUntitled(tab) {
  return tab && !tab.path && !tab.dirty && stateOf(tab).doc.length === 0;
}

/** Add an opened file as a tab (or focus it if it is already open). */
function addFileTab(file, { focus = true } = {}) {
  const existing = tabs.find(x => x.path && x.path.toLowerCase() === file.path.toLowerCase());
  if (existing) {
    if (focus) activate(existing);
    return existing;
  }
  const tab = makeTab(file);
  if (focus && isBlankUntitled(active)) {
    if (active.name === `未命名 ${untitledNo - 1}`) untitledNo--;
    const i = tabs.indexOf(active);
    tabs.splice(i, 1, tab);
    active = null;
  } else {
    const i = active ? tabs.indexOf(active) + 1 : tabs.length;
    tabs.splice(i, 0, tab);
  }
  if (focus) activate(tab); else renderTabs();
  scheduleSession();
  return tab;
}

async function openPaths(paths) {
  for (const path of paths) {
    const existing = tabs.find(x => x.path && x.path.toLowerCase() === path.toLowerCase());
    if (existing) { activate(existing); continue; }
    try {
      addFileTab(await host.call('readFile', { path }));
    } catch (e) {
      toast(`打不开 ${basename(path)}：${e.message}`);
    }
  }
}

async function openDialog() {
  const r = await host.call('openDialog', { dir: active?.path ? dirname(active.path) : null });
  if (!r) return;
  for (const f of r.files) addFileTab(f);
  for (const err of r.errors || []) toast(err);
}

function cycleTab(delta) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  activate(tabs[(i + delta + tabs.length) % tabs.length]);
}

async function closeTab(tab) {
  if (!tab) return false;
  if (tab.dirty) {
    activate(tab);
    const r = await showDialog(`要保存对“${tab.name}”的修改吗？`, ['保存', '不保存', '取消'], {
      detail: '不保存的话，这些修改会丢失。',
    });
    if (r === 2 || r === -1) return false;
    if (r === 0 && !(await save(tab))) return false;
  }
  const i = tabs.indexOf(tab);
  if (i < 0) return true;
  if (tab.path) closedPaths.push(tab.path);
  tabs.splice(i, 1);
  if (tab === active) {
    active = null;
    if (!tabs.length) tabs.push(makeTab());
    activate(tabs[Math.min(i, tabs.length - 1)]);
  } else {
    renderTabs();
  }
  scheduleSession();
  return true;
}

function reopenClosed() {
  const path = closedPaths.pop();
  if (path) openPaths([path]);
}

// ============================================================ saving

function suggestName(state) {
  const first = state.doc.line(1).text.replace(/^#+\s*/, '').trim()
    .replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim();
  return `${first || '未命名'}.md`;
}

async function save(tab, saveAs = false) {
  if (!tab) return false;
  const state = stateOf(tab);
  const content = state.doc.toString();
  try {
    if (!tab.path || saveAs) {
      const r = await host.call('saveAs', {
        suggestedName: tab.path ? basename(tab.path) : suggestName(state),
        dir: tab.path ? dirname(tab.path) : null,
        content, encoding: tab.encoding, eol: tab.eol,
      });
      if (!r) return false;
      const wasMd = isMarkdown(tab);
      tab.path = r.path;
      tab.name = r.name;
      tab.mtime = r.mtime;
      if (wasMd !== isMarkdown(tab) || !wasMd) loadLanguage(tab);
    } else {
      const r = await host.call('saveFile', { path: tab.path, content, encoding: tab.encoding, eol: tab.eol });
      tab.mtime = r.mtime;
    }
  } catch (e) {
    await showDialog(`保存“${tab.name}”失败`, ['确定'], { detail: e.message });
    return false;
  }
  tab.savedDoc = state.doc;
  tab.metaDirty = false;
  tab.dirty = false;
  tab.external = null;
  renderTabs();
  updateTitle();
  updateStatus();
  updateBanner();
  updatePreview();
  scheduleSession();
  return true;
}

// ============================================================ external changes

async function reloadTab(tab, { quiet = false } = {}) {
  let f;
  try {
    f = await host.call('readFile', { path: tab.path });
  } catch (e) {
    toast(`重新加载失败：${e.message}`);
    return;
  }
  const newDoc = Text.of(f.content.split('\n'));
  const state = stateOf(tab);
  const head = Math.min(state.selection.main.head, newDoc.length);
  tab.savedDoc = newDoc;
  tab.mtime = f.mtime;
  tab.encoding = f.encoding;
  tab.eol = f.eol;
  tab.metaDirty = false;
  tab.external = null;
  const spec = {
    changes: { from: 0, to: state.doc.length, insert: newDoc },
    selection: EditorSelection.cursor(head),
    annotations: Transaction.addToHistory.of(false),
  };
  if (tab === active) view.dispatch(spec);
  else tab.state = tab.state.update(spec).state;
  tab.dirty = false;
  renderTabs();
  updateTitle();
  updateStatus();
  updateBanner();
  if (tab === active) updatePreview();
  if (quiet) toast(`已重新加载：${tab.name}（文件在外部被修改）`);
}

let checking = false;
async function checkExternalChanges() {
  if (checking) return;
  const withPath = tabs.filter(x => x.path);
  if (!withPath.length) return;
  checking = true;
  try {
    const stats = await host.call('stat', { paths: withPath.map(x => x.path) });
    for (const tab of withPath) {
      if (!tabs.includes(tab)) continue;
      const m = stats[tab.path];
      if (m == null) {
        if (tab.external !== 'deleted' && !tab.missingAck) {
          tab.external = 'deleted';
          tab.metaDirty = true;
          recomputeDirty(tab);
        }
        continue;
      }
      tab.missingAck = false;
      if (tab.external === 'deleted') tab.external = null;
      if (tab.mtime == null || m === tab.mtime || m === tab.externalMtime) continue;
      if (!tab.dirty) await reloadTab(tab, { quiet: true });
      else { tab.external = 'modified'; tab.externalMtime = m; }
    }
  } catch (e) {
    console.error(e);
  } finally {
    checking = false;
  }
  updateBanner();
}

function updateBanner() {
  const tab = active;
  const text = $('banner-text');
  const actions = $('banner-actions');
  if (!tab || !tab.external) { bannerEl.hidden = true; return; }
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  if (tab.external === 'modified') {
    text.textContent = `“${tab.name}”在外部被修改了，而这里也有未保存的修改。`;
    actions.replaceChildren(
      btn('用磁盘上的版本', () => reloadTab(tab)),
      btn('保留我的修改', () => { tab.external = null; updateBanner(); }),
    );
  } else {
    text.textContent = `“${tab.name}”已在磁盘上被删除或移动。保存会重新创建它。`;
    actions.replaceChildren(
      btn('关闭标签', () => { tab.dirty = false; closeTab(tab); }),
      btn('知道了', () => { tab.external = null; tab.missingAck = true; updateBanner(); }),
    );
  }
  bannerEl.hidden = false;
}

// ============================================================ preview

let previewTimer = null;
const previewVisible = () => settings.preview && isMarkdown(active);

function layout() {
  const show = previewVisible();
  mainEl.classList.toggle('with-preview', show);
  editorEl.style.flexBasis = show ? `${settings.split * 100}%` : '100%';
  st.preview.hidden = !isMarkdown(active);
  st.preview.classList.toggle('on', settings.preview);
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { updatePreview(); updateCount(); }, 150);
}

function updatePreview() {
  layout();
  if (!previewVisible()) { previewEl.replaceChildren(); return; }
  const src = view.state.doc.toString();
  previewEl.innerHTML = renderMarkdown(src, active.path ? dirname(active.path) : null);
  syncPreview();
}

function syncPreview() {
  if (!previewVisible()) return;
  const sd = view.scrollDOM;
  if (sd.scrollTop + sd.clientHeight >= sd.scrollHeight - 4 && sd.scrollTop > 0) {
    previewEl.scrollTop = previewEl.scrollHeight;
    return;
  }
  const h = Math.max(0, sd.getBoundingClientRect().top - view.documentTop);
  const block = view.lineBlockAtHeight(h);
  const line = view.state.doc.lineAt(block.from).number - 1;
  const frac = block.height ? Math.min(1, Math.max(0, (h - block.top) / block.height)) : 0;
  const pos = line + frac;
  let before = null;
  let after = null;
  for (const el of previewEl.querySelectorAll('[data-line]')) {
    if (+el.dataset.line <= line) before = el;
    else { after = el; break; }
  }
  const pr = previewEl.getBoundingClientRect();
  const top = el => el.getBoundingClientRect().top - pr.top + previewEl.scrollTop;
  let y = 0;
  if (before && after) {
    const lb = +before.dataset.line;
    const la = +after.dataset.line;
    y = top(before) + ((pos - lb) / (la - lb)) * (top(after) - top(before));
  } else if (before) {
    y = top(before);
  }
  previewEl.scrollTop = Math.max(0, y - 12);
}

function togglePreview() {
  settings.preview = !settings.preview;
  saveSettings();
  updatePreview();
}

previewEl.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    previewEl.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    host.call('openExternal', { url: href });
  } else if (active?.path && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    openPaths([resolvePath(dirname(active.path), href)]);
  }
});

// Drag the divider to resize editor / preview.
dividerEl.addEventListener('mousedown', e => {
  e.preventDefault();
  const rect = mainEl.getBoundingClientRect();
  document.body.classList.add('resizing');
  const move = ev => {
    settings.split = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
    editorEl.style.flexBasis = `${settings.split * 100}%`;
  };
  const up = () => {
    document.body.classList.remove('resizing');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    saveSettings();
    view.requestMeasure();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ============================================================ status bar & title

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
function countWords(text) {
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(/[A-Za-z0-9_'’-]+/g) || []).length;
  return cjk + words;
}

function updateCount(state = view.state) {
  const sel = state.selection.main;
  if (!sel.empty) st.count.textContent = `已选 ${countWords(state.sliceDoc(sel.from, sel.to))} 字`;
  else st.count.textContent = `${countWords(state.doc.toString())} 字`;
}

let countTimer = null;
function updateStatus(state = view.state) {
  if (!active) return;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  st.pos.textContent = `行 ${line.number}，列 ${head - line.from + 1}`;
  clearTimeout(countTimer);
  countTimer = setTimeout(() => updateCount(), state.doc.length > 200000 ? 400 : 60);
  st.enc.textContent = active.encoding;
  st.eol.textContent = active.eol;
  st.zoom.textContent = `${settings.fontSize}px`;
  layout();
}

function updateTitle() {
  if (!active) return;
  const title = `${active.dirty ? '● ' : ''}${active.name} - Jotter`;
  document.title = title;
  host.call('setTitle', { title }).catch(() => {});
}

function setEncoding(enc) {
  if (!active || active.encoding === enc) return;
  active.encoding = enc;
  active.metaDirty = true;
  recomputeDirty(active);
  updateStatus();
  scheduleSession();
}

st.enc.addEventListener('click', () => {
  showMenu(st.enc, ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'GBK'].map(enc => ({
    label: `保存为 ${enc}`, checked: active.encoding === enc, action: () => setEncoding(enc),
  })), { alignRight: true, above: true });
});
st.eol.addEventListener('click', () => {
  active.eol = active.eol === 'CRLF' ? 'LF' : 'CRLF';
  active.metaDirty = true;
  recomputeDirty(active);
  updateStatus();
  scheduleSession();
});
st.preview.addEventListener('click', togglePreview);
st.zoom.addEventListener('click', () => {
  showMenu(st.zoom, [
    { label: '放大', shortcut: 'Ctrl+=', action: () => zoom(1) },
    { label: '缩小', shortcut: 'Ctrl+-', action: () => zoom(-1) },
    { label: '重置', shortcut: 'Ctrl+0', action: () => zoom(0) },
  ], { alignRight: true, above: true });
});

function zoom(delta) {
  settings.fontSize = delta === 0 ? DEFAULTS.fontSize : Math.min(32, Math.max(10, settings.fontSize + delta));
  saveSettings();
  document.documentElement.style.setProperty('--preview-size', `${settings.fontSize}px`);
  applyConfig();
  updateStatus();
}

function toggleSetting(key) {
  settings[key] = !settings[key];
  saveSettings();
  applyConfig();
  updatePreview();
}

// ============================================================ menu & keys

function appMenu() {
  showMenu($('menu-btn'), [
    { label: '新建标签', shortcut: 'Ctrl+N', action: newTab },
    { label: '新建窗口', shortcut: 'Ctrl+Shift+N', action: () => host.call('newWindow') },
    { label: '打开…', shortcut: 'Ctrl+O', action: openDialog },
    { label: '重新打开关闭的标签', shortcut: 'Ctrl+Shift+T', action: reopenClosed },
    '-',
    { label: '保存', shortcut: 'Ctrl+S', action: () => save(active) },
    { label: '另存为…', shortcut: 'Ctrl+Shift+S', action: () => save(active, true) },
    {
      label: '在资源管理器中显示',
      action: () => (active?.path ? host.call('reveal', { path: active.path }) : toast('还没有保存成文件')),
    },
    '-',
    { label: '查找 / 替换', shortcut: 'Ctrl+F', action: () => openSearchPanel(view) },
    { label: '预览', shortcut: 'Ctrl+\\', checked: settings.preview, action: togglePreview },
    { label: '自动换行', shortcut: 'Alt+Z', checked: settings.wrap, action: () => toggleSetting('wrap') },
    { label: '行号', checked: settings.lineNumbers, action: () => toggleSetting('lineNumbers') },
    '-',
    { label: '快捷键一览', action: showShortcuts },
  ], { alignRight: true });
}

function showShortcuts() {
  showDialog('快捷键', ['好的'], {
    detail: [
      'Ctrl+N 新建标签　Ctrl+Shift+N 新建窗口　Ctrl+O 打开',
      'Ctrl+S 保存　Ctrl+Shift+S 另存为　Ctrl+W 关闭标签',
      'Ctrl+Tab / Ctrl+PgDn 下一个标签　Ctrl+1…9 跳到第几个标签',
      'Ctrl+Shift+T 重新打开关闭的标签',
      'Ctrl+F 查找　Ctrl+H 替换　Ctrl+D 选中下一个相同词',
      'Ctrl+B 加粗　Ctrl+I 斜体　Ctrl+K 插入链接',
      'Alt+↑/↓ 移动行　Ctrl+Shift+K 删除行　Ctrl+/ 注释',
      'Ctrl+\\ 预览　Alt+Z 自动换行　Ctrl+= / Ctrl+- 字号',
      '把文件拖进窗口即可打开',
    ].join('\n'),
  });
}

window.addEventListener('keydown', e => {
  if (modalOpen()) return;
  const ctrl = e.ctrlKey && !e.metaKey;
  const { shiftKey: shift, altKey: alt } = e;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  let handled = true;
  if (ctrl && !alt && !shift && (k === 'n' || k === 't')) newTab();
  else if (ctrl && shift && k === 'n') host.call('newWindow');
  else if (ctrl && shift && k === 't') reopenClosed();
  else if (ctrl && !shift && k === 'o') openDialog();
  else if (ctrl && k === 's') save(active, shift);
  else if (ctrl && (k === 'w' || k === 'F4')) closeTab(active);
  else if (ctrl && k === 'Tab') cycleTab(shift ? -1 : 1);
  else if (ctrl && k === 'PageDown') cycleTab(1);
  else if (ctrl && k === 'PageUp') cycleTab(-1);
  else if (ctrl && !shift && /^[1-9]$/.test(k)) {
    const i = k === '9' ? tabs.length - 1 : +k - 1;
    if (tabs[i]) activate(tabs[i]);
  } else if (ctrl && k === '\\') togglePreview();
  else if (ctrl && (k === '=' || k === '+')) zoom(1);
  else if (ctrl && k === '-') zoom(-1);
  else if (ctrl && k === '0') zoom(0);
  else if (alt && !ctrl && k === 'z') toggleSetting('wrap');
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Wheel + Ctrl zooms the text instead of the page.
window.addEventListener('wheel', e => {
  if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }
}, { passive: false });

// Files dropped from Explorer.
window.addEventListener('dragover', e => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}, true);
window.addEventListener('drop', e => {
  if (e.dataTransfer?.files.length) {
    e.preventDefault();
    e.stopPropagation();
    host.sendFiles(e.dataTransfer.files);
  }
}, true);

$('new-tab').addEventListener('click', newTab);
$('menu-btn').addEventListener('click', appMenu);
$('tabbar-space').addEventListener('dblclick', newTab);

// ============================================================ session (hot exit)

let sessionTimer = null;
let closing = false;

function snapshot() {
  return {
    version: 1,
    activeIndex: Math.max(0, tabs.indexOf(active)),
    tabs: tabs.map(tab => {
      const state = stateOf(tab);
      const sel = state.selection.main;
      const s = {
        path: tab.path,
        name: tab.name,
        encoding: tab.encoding,
        eol: tab.eol,
        anchor: sel.anchor,
        head: sel.head,
        scroll: tab === active ? view.scrollDOM.scrollTop : tab.scroll,
      };
      if (!tab.path || tab.dirty) s.content = state.doc.toString();
      return s;
    }),
  };
}

function scheduleSession() {
  if (closing) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 500);
}

async function saveSession() {
  clearTimeout(sessionTimer);
  if (closing) return;
  try {
    await host.call('saveSession', { session: snapshot() });
  } catch (e) {
    console.error('saveSession', e);
  }
}

async function restore(session) {
  for (const s of session.tabs || []) {
    let tab;
    if (s.path) {
      let f = null;
      try { f = await host.call('readFile', { path: s.path }); } catch { /* missing */ }
      if (!f && s.content == null) { toast(`找不到文件：${s.path}`); continue; }
      tab = makeTab(f || { path: s.path, content: '', encoding: s.encoding, eol: s.eol });
      if (!f) { tab.external = 'deleted'; tab.metaDirty = true; }
      if (s.content != null && (!f || s.content !== f.content)) {
        tab.state = tab.state.update({
          changes: { from: 0, to: tab.state.doc.length, insert: s.content },
          annotations: Transaction.addToHistory.of(false),
        }).state;
      }
      if (f) {
        // Keep encoding / line-ending choices the user made but had not saved yet.
        if (s.encoding && s.encoding !== f.encoding) { tab.encoding = s.encoding; tab.metaDirty = true; }
        if (s.eol && s.eol !== f.eol) { tab.eol = s.eol; tab.metaDirty = true; }
      }
    } else {
      tab = makeTab({ name: s.name, content: s.content || '', encoding: s.encoding, eol: s.eol });
      tab.savedDoc = Text.empty;
    }
    const len = tab.state.doc.length;
    tab.state = tab.state.update({
      selection: EditorSelection.single(Math.min(s.anchor || 0, len), Math.min(s.head || 0, len)),
    }).state;
    tab.scroll = s.scroll || 0;
    tab.dirty = tab.metaDirty || !tab.state.doc.eq(tab.savedDoc);
    tabs.push(tab);
  }
  for (const tab of tabs) {
    const m = /^未命名 (\d+)$/.exec(tab.name);
    if (m) untitledNo = Math.max(untitledNo, +m[1] + 1);
  }
}

host.on('openFiles', ({ files = [], errors = [] } = {}) => {
  files.forEach((f, i) => addFileTab(f, { focus: i === files.length - 1 }));
  errors.forEach(err => toast(err));
});

host.on('activated', () => {
  focusEditorIfIdle();
  checkExternalChanges();
});

// When the window gets focus, typing should go to the editor, not the page body.
function focusEditorIfIdle() {
  if (view && !modalOpen() && (document.activeElement === document.body || !document.activeElement)) view.focus();
}
window.addEventListener('focus', focusEditorIfIdle);

host.on('closeRequested', async ({ isLast } = {}) => {
  host.call('closeAck').catch(() => {});
  if (isLast) {
    // Hot exit: keep unsaved work in the session, no questions asked.
    await saveSession();
    const keep = tabs.some(x => x.path || stateOf(x).doc.length > 0);
    closing = true;
    host.call('closeWindow', { keepSession: keep });
    return;
  }
  for (const tab of [...tabs]) {
    if (!tab.dirty) continue;
    activate(tab);
    const r = await showDialog(`关闭窗口前，要保存对“${tab.name}”的修改吗？`, ['保存', '不保存', '取消']);
    if (r === 2 || r === -1 || (r === 0 && !(await save(tab)))) {
      host.call('closeCancelled').catch(() => {});
      return;
    }
  }
  closing = true;
  clearTimeout(sessionTimer);
  host.call('closeWindow', { keepSession: false });
});

// ============================================================ boot

async function boot() {
  view = new EditorView({
    parent: editorEl,
    state: EditorState.create({ extensions: editorExtensions() }),
  });
  view.scrollDOM.addEventListener('scroll', () => requestAnimationFrame(syncPreview));
  document.documentElement.style.setProperty('--preview-size', `${settings.fontSize}px`);

  let init = {};
  try {
    init = (await host.call('init')) || {};
  } catch (e) {
    toast(`初始化失败：${e.message}`);
  }
  if (init.session?.tabs?.length) await restore(init.session);
  const files = init.files || [];
  for (const f of files) addFileTab(f, { focus: false });
  for (const err of init.errors || []) toast(err);
  if (!tabs.length) tabs.push(makeTab());

  let idx = init.session?.activeIndex ?? 0;
  if (files.length) idx = tabs.findIndex(x => x.path?.toLowerCase() === files.at(-1).path.toLowerCase());
  document.body.classList.add('ready');
  activate(tabs[Math.min(Math.max(idx, 0), tabs.length - 1)]);
  // Read-only handle for debugging and automated tests (DevTools / tools/cdp.mjs).
  window.__jotter = { tabs, view: () => view, settings, isMock };
}

boot();
