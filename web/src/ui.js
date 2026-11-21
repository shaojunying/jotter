// Small in-page dialogs, menus and toasts (Chinese buttons, themed with the app).

let modalDepth = 0;
export const modalOpen = () => modalDepth > 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Show a modal with buttons; resolves to the clicked index, or -1 for Escape.
 * The first button is the default (focused, Enter).
 */
export function showDialog(message, buttons, { detail } = {}) {
  closeMenu();
  return new Promise(resolve => {
    modalDepth++;
    const prevFocus = document.activeElement;
    const overlay = el('div', 'modal-overlay');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.append(el('div', 'modal-msg', message));
    if (detail) box.append(el('div', 'modal-detail', detail));
    const row = el('div', 'modal-buttons');
    const done = i => {
      overlay.remove();
      modalDepth--;
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(i);
    };
    buttons.forEach((label, i) => {
      const b = el('button', i === 0 ? 'primary' : '', label);
      b.addEventListener('click', () => done(i));
      row.append(b);
    });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(-1); }
    };
    document.addEventListener('keydown', onKey, true);
    box.append(row);
    overlay.append(box);
    document.getElementById('modal-root').append(overlay);
    row.firstChild.focus();
  });
}

let openMenuEl = null;
function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}

/**
 * Popup menu under an anchor. items: {label, shortcut?, checked?, action} or '-'.
 */
export function showMenu(anchor, items, { alignRight = false, above = false } = {}) {
  closeMenu();
  const menu = el('div', 'menu');
  for (const item of items) {
    if (item === '-') { menu.append(el('div', 'menu-sep')); continue; }
    const row = el('button', 'menu-item');
    row.append(el('span', 'menu-check', item.checked ? '✓' : ''));
    row.append(el('span', 'menu-label', item.label));
    row.append(el('span', 'menu-key', item.shortcut || ''));
    row.addEventListener('click', () => { closeMenu(); item.action(); });
    menu.append(row);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let left = alignRight ? r.right - mr.width : r.left;
  left = Math.max(4, Math.min(left, innerWidth - mr.width - 4));
  const top = above ? r.top - mr.height - 4 : r.bottom + 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  openMenuEl = menu;
  setTimeout(() => {
    const off = e => {
      if (!menu.contains(e.target)) { closeMenu(); cleanup(); }
    };
    const esc = e => { if (e.key === 'Escape') { closeMenu(); cleanup(); } };
    const cleanup = () => {
      document.removeEventListener('mousedown', off, true);
      document.removeEventListener('keydown', esc, true);
    };
    document.addEventListener('mousedown', off, true);
    document.addEventListener('keydown', esc, true);
  });
}

export function toast(message, ms = 3500) {
  const t = el('div', 'toast', message);
  document.getElementById('toast-root').append(t);
  setTimeout(() => t.classList.add('fade'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
