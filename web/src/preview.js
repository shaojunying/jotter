import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';

// ---------------- path helpers (Windows paths) ----------------

export function dirname(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i >= 0 ? p.slice(0, i) : '';
}

export function basename(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** Resolve a link target written in a Markdown file against that file's folder. */
export function resolvePath(baseDir, rel) {
  rel = rel.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch { /* keep as written */ }
  rel = rel.replace(/\//g, '\\');
  if (isAbsolutePath(rel)) return rel;
  const parts = baseDir.split('\\');
  for (const seg of rel.split('\\')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length > 1) parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('\\');
}

/** Local images are served by the host from https://localfile.jotter/?p=<path>. */
function assetUrl(src, baseDir) {
  if (!src || /^(https?:|data:)/i.test(src)) return src;
  if (/^file:/i.test(src)) src = decodeURI(src.replace(/^file:\/+/i, ''));
  let path;
  if (isAbsolutePath(src.replace(/\//g, '\\'))) path = src.replace(/\//g, '\\');
  else if (baseDir) path = resolvePath(baseDir, src);
  else return src;
  return 'https://localfile.jotter/?p=' + encodeURIComponent(path);
}

// ---------------- markdown-it setup ----------------

const md = new MarkdownIt({
  html: false, // previews run next to the host bridge: never execute markup from files
  linkify: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
      catch { /* fall through */ }
    }
    return '';
  },
});
md.use(taskLists, { label: true });

function slugify(text) {
  return text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

// Tag every block with its source line (for scroll sync) and give headings ids.
md.core.ruler.push('jotter_source_lines', state => {
  const seen = new Map();
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.map && tok.nesting >= 0 && tok.type !== 'inline') {
      tok.attrSet('data-line', String(tok.map[0]));
    }
    if (tok.type === 'heading_open' && toks[i + 1]?.type === 'inline') {
      const base = slugify(toks[i + 1].content) || 'section';
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      tok.attrSet('id', n ? `${base}-${n}` : base);
    }
  }
});

const renderImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const tok = tokens[idx];
  tok.attrSet('src', assetUrl(tok.attrGet('src'), env.baseDir));
  return renderImage(tokens, idx, opts, env, self);
};

export function renderMarkdown(src, baseDir) {
  return md.render(src, { baseDir });
}
