/**
 * لقطة شاشة عبر Chrome بلا واجهة مع وقت حقيقي (بدل --virtual-time-budget
 * الذي يجمّد IndexedDB).
 *
 * الاستعمال:
 *   node tools/shot-cdp.mjs --url http://127.0.0.1:8123/ --out shot.png --wait 3000
 *   node tools/shot-cdp.mjs --url "http://127.0.0.1:8123/?view=ads" --out ad.png --w 1920 --h 1080
 *   node tools/shot-cdp.mjs --url ... --eval "document.getElementById('gear').click()"
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { url: 'http://127.0.0.1:8123/', out: 'shot.png', w: 1920, h: 1080, wait: 3000, eval: '', after: 600 };
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  const value = args[i + 1];
  if (key === '--url') { opt.url = value; i += 1; }
  else if (key === '--out') { opt.out = value; i += 1; }
  else if (key === '--w') { opt.w = Number(value); i += 1; }
  else if (key === '--h') { opt.h = Number(value); i += 1; }
  else if (key === '--wait') { opt.wait = Number(value); i += 1; }
  else if (key === '--eval') { opt.eval = value; i += 1; }
  else if (key === '--after') { opt.after = Number(value); i += 1; }
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), 'shot-cdp-' + Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--window-size=${opt.w},${opt.h}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

async function waitFor(fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const result = await fn(); if (result) return result; } catch (e) { /* retry */ }
    await sleep(120);
  }
  throw new Error('timeout');
}

let ws;
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok);
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(opt.url)}`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: opt.w, height: opt.h, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(opt.wait);

  if (opt.eval) {
    const result = await send('Runtime.evaluate', { expression: opt.eval, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) console.error('eval:', result.exceptionDetails.text);
    else if (result.result && result.result.value !== undefined) console.log('eval:', JSON.stringify(result.result.value));
    if (opt.after) await sleep(opt.after);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  fs.writeFileSync(opt.out, Buffer.from(shot.data, 'base64'));
  console.log(opt.out + '  ' + fs.statSync(opt.out).size);
} finally {
  if (ws) ws.close();
  chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
