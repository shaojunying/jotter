// Bridge to the WPF host (WebView2). Requests are {id, method, params};
// the host answers {id, result} or {id, error}, and pushes {event, data}.
// Opened in a normal browser there is no host, so a small in-memory mock
// stands in for it (used to try the UI out during development).

const wv = window.chrome?.webview;
export const isMock = !wv;

const pending = new Map();
const listeners = {};
let nextId = 1;

function emit(event, data) {
  for (const fn of listeners[event] || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

if (wv) {
  wv.addEventListener('message', e => {
    const m = e.data;
    if (m && m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error != null) p.reject(new Error(m.error));
      else p.resolve(m.result);
    } else if (m && m.event) {
      emit(m.event, m.data);
    }
  });
}

export const host = {
  call(method, params = {}) {
    if (!wv) return mock(method, params);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      wv.postMessage({ id, method, params });
    });
  },
  notify(method, params = {}) {
    if (wv) wv.postMessage({ method, params });
    else mock(method, params);
  },
  on(event, fn) {
    (listeners[event] ||= []).push(fn);
  },
  // Files dropped from Explorer: WebView2 hands the host their real paths.
  sendFiles(fileList) {
    if (wv) wv.postMessageWithAdditionalObjects({ method: 'dropFiles', params: {} }, fileList);
    else toastMock(`(mock) dropped ${fileList.length} file(s)`);
  },
};

// ---------------- mock host (browser only) ----------------

const mockFiles = {
  'C:\\demo\\欢迎.md': [
    '# 欢迎使用 Jotter',
    '',
    '一个**轻量**的 Markdown 记事本。右边是*实时预览*。',
    '',
    '## 列表',
    '',
    '- [x] 多标签、多窗口',
    '- [x] Markdown 高亮和预览',
    '- [ ] 你的下一条笔记',
    '',
    '> 引用一段话。',
    '',
    '```js',
    'function hello(name) {',
    '  return `你好，${name}`;',
    '}',
    '```',
    '',
    '| 快捷键 | 作用 |',
    '| --- | --- |',
    '| Ctrl+N | 新建标签 |',
    '| Ctrl+\\ | 切换预览 |',
    '',
  ].join('\n'),
  'C:\\demo\\notes.txt': 'plain text file\nsecond line\n',
};
const mockMtime = {};

function fileData(path) {
  if (!(path in mockFiles)) throw new Error('文件不存在');
  mockMtime[path] ??= Date.now();
  return {
    path,
    name: path.split('\\').pop(),
    content: mockFiles[path],
    encoding: 'UTF-8',
    eol: 'LF',
    mtime: mockMtime[path],
  };
}

function toastMock(msg) { console.log('[mock]', msg); }

async function mock(method, p) {
  switch (method) {
    case 'init':
      return {
        windowId: 'mock',
        session: JSON.parse(localStorage.getItem('jotter.mock-session') || 'null'),
        files: [],
        errors: [],
      };
    case 'readFile':
      return fileData(p.path);
    case 'openDialog':
      return { files: Object.keys(mockFiles).map(fileData), errors: [] };
    case 'saveFile':
      mockFiles[p.path] = p.content;
      mockMtime[p.path] = Date.now();
      return { mtime: mockMtime[p.path] };
    case 'saveAs': {
      const path = `C:\\demo\\${p.suggestedName}`;
      mockFiles[path] = p.content;
      mockMtime[path] = Date.now();
      return { path, name: p.suggestedName, mtime: mockMtime[path] };
    }
    case 'stat': {
      const r = {};
      for (const path of p.paths) r[path] = path in mockFiles ? (mockMtime[path] ??= Date.now()) : null;
      return r;
    }
    case 'saveSession':
      localStorage.setItem('jotter.mock-session', JSON.stringify(p.session));
      return true;
    case 'setTitle':
      document.title = p.title;
      return null;
    default:
      toastMock(`${method} ${JSON.stringify(p)}`);
      return null;
  }
}

// For poking at the mock from devtools / tests.
if (isMock) window.__jotterMock = { files: mockFiles, mtime: mockMtime, emit };
