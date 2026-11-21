// Drive a running Jotter window over the Chrome DevTools Protocol (for testing).
// Start Jotter with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>, then:
//   node cdp.mjs <port> eval "<js expression>"     (awaits promises, prints JSON)
//   node cdp.mjs <port> shot <out.png> [index]     (screenshot of window #index, default 0)
//   node cdp.mjs <port> list
const [port, cmd, arg, idxArg] = process.argv.slice(2);

const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
  .filter(t => t.type === 'page' && t.url.startsWith('https://app.jotter/'));

if (cmd === 'list') {
  console.log(JSON.stringify(targets.map(t => ({ title: t.title, url: t.url })), null, 2));
  process.exit(0);
}

const target = targets[Number(idxArg ?? 0)];
if (!target) {
  console.error('no Jotter page found');
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const waiting = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq;
  waiting.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    console.error(JSON.stringify(r.result.exceptionDetails, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(r.result?.result?.value, null, 2));
} else if (cmd === 'type') {
  await send('Input.insertText', { text: arg });
  console.log('typed');
} else if (cmd === 'key') {
  // e.g. "ctrl+s", "ctrl+shift+n", "End", "ctrl+End"
  const parts = arg.split('+');
  const key = parts.pop();
  const mods = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const modifiers = parts.reduce((m, p) => m | (mods[p.toLowerCase()] || 0), 0);
  const named = { End: 35, Home: 36, Enter: 13, Tab: 9, Escape: 27, PageDown: 34, PageUp: 33, F4: 115 };
  const vk = named[key] ?? key.toUpperCase().charCodeAt(0);
  const code = named[key] ? key : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key;
  const k = key.length === 1 && !(modifiers & 8) ? key.toLowerCase() : key;
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, modifiers, key: k, code, windowsVirtualKeyCode: vk });
  }
  console.log('pressed', arg);
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
}
ws.close();
