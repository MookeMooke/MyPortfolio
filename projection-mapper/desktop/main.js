/* Desktop shell: serves the app from a private origin, puts the output fullscreen on the
   projector, and feeds the laptop's own sound output to the music-reactive effects. */
const { app, BrowserWindow, protocol, net, session, desktopCapturer, screen, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'app://local/';
const preload = path.join(__dirname, 'preload.js');
let editor = null, output = null;

/* A failed start must never be silent. PM_SELFTEST (a file path) makes the app check itself,
   write the result there and quit; the build uses it to prove the app starts on Windows. */
const SELFTEST = process.env.PM_SELFTEST || '';
const T0 = Date.now();
function selfTestDone(result) {
  try { fs.writeFileSync(SELFTEST, JSON.stringify(Object.assign({ ms: Date.now() - T0 }, result))); } catch (e) { /* ignore */ }
  app.exit(result.ok ? 0 : 1);
}
function fatal(err) {
  const text = String((err && err.stack) || err);
  if (SELFTEST) return selfTestDone({ ok: false, error: text });
  dialog.showErrorBox('Projection Mapper could not start', text);
  app.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// Sound analysis must start without waiting for a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const VERSION = 'V' + app.getVersion().split('.')[0];
// Another copy is already open (possibly an older version): say so instead of quietly handing over to it.
if (!app.requestSingleInstanceLock()) {
  if (!SELFTEST) {
    dialog.showErrorBox('Projection Mapper is already open',
      `You are opening ${VERSION}, but a copy of Projection Mapper is already running.\n\n` +
      'If you just downloaded a newer version, close the old one first (look in the taskbar, or end "Projection Mapper" in Task Manager), then open this one again.');
  }
  app.exit(0);
}
app.on('second-instance', () => { if (editor) { if (editor.isMinimized()) editor.restore(); editor.focus(); } });

/* The display the editor is not on. */
function projector() {
  const all = screen.getAllDisplays();
  if (all.length < 2) return null;
  const mine = editor ? screen.getDisplayMatching(editor.getBounds()) : screen.getPrimaryDisplay();
  return all.find((d) => d.id !== mine.id) || null;
}

function createEditor() {
  editor = new BrowserWindow({
    width: 1500, height: 900, minWidth: 1000, minHeight: 600, backgroundColor: '#121218', title: 'Projection Mapper',
    webPreferences: { preload, contextIsolation: true, backgroundThrottling: false },
  });
  editor.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN + 'output.html')) {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    }
    if (output) { output.focus(); return { action: 'deny' }; }
    const d = projector();
    const place = d
      ? { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, frame: false }
      : { width: 960, height: 540 };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: Object.assign(place, {
        backgroundColor: '#000000', title: 'Projector Output',
        webPreferences: { preload, contextIsolation: true, backgroundThrottling: false },
      }),
    };
  });
  editor.webContents.on('did-create-window', (win) => {
    output = win;
    win.setMenuBarVisibility(false);
    win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') win.close(); });
    win.on('closed', () => { output = null; });
  });
  editor.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) fatal(new Error('Page failed to load: ' + desc + ' ' + url)); });
  editor.webContents.on('render-process-gone', (e, d) => fatal(new Error('Window process stopped: ' + d.reason)));
  editor.webContents.on('did-finish-load', () => {
    if (SELFTEST) {
      const probe = `(async () => {
        const r = { pm: !!window.PM, desktop: !!window.pmDesktop, webgl: !!window.PMDebug, lists: document.querySelectorAll("#left h3").length, shownVersion: document.querySelector(".brand").textContent };
        try { await PM.audio.start('system'); r.audio = 'started'; r.audioContext = PM.audio.state(); } catch (e) { r.audio = 'failed: ' + (e && (e.name + ' ' + e.message)); }
        return r;
      })()`;
      editor.webContents.executeJavaScript(probe, true)
        .then((r) => selfTestDone(Object.assign({ version: VERSION, shown: r.shownVersion, ok: r.pm && r.desktop && r.lists === 4, visible: editor.isVisible(), remotePort: remote.port }, r)))
        .catch(fatal);
      return;
    }
    const info = JSON.stringify({ projector: !!projector() });
    // Run with a user gesture so sound capture and the output window may start by themselves.
    editor.webContents.executeJavaScript(`window.PMDesktopReady && window.PMDesktopReady(${info})`, true).catch(() => {});
  });
  editor.on('closed', () => { editor = null; if (output) output.close(); });
  editor.loadURL(ORIGIN + 'index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    // Never cache app files, so a new version can never show an old version's screens.
    return net.fetch(pathToFileURL(file).toString()).then((r) => new Response(r.body, {
      status: r.status, headers: { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' },
    }));
  });
  // "PC sound": hand over the system audio output (loopback) without a picker.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(wc.getURL().startsWith(ORIGIN)));
  ipcMain.handle('pm:hasProjector', () => !!projector());
  ipcMain.on('pm:version', (e) => { e.returnValue = VERSION; });
  session.defaultSession.clearCache().catch(() => {}).then(createEditor);
});
app.on('window-all-closed', () => app.quit());

/* ---------- Phone remote: a small web page served to phones on the local network ----------
   Reachable over Wi-Fi or a Bluetooth network link. The address carries a private key, so
   only someone who scanned the code can control the projection. */
const remote = { token: '', port: 0, state: null, clients: new Set() };
const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

function cleanCommand(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  if (typeof c.scene === 'string' && c.scene.length < 40) out.scene = c.scene;
  if (c.step === 1 || c.step === -1) out.step = c.step;
  if (typeof c.blackout === 'boolean') out.blackout = c.blackout;
  if (typeof c.brightness === 'number' && isFinite(c.brightness)) out.brightness = Math.max(0, Math.min(1, c.brightness));
  return out;
}
function startRemote() {
  const file = path.join(app.getPath('userData'), 'remote.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }
  if (!/^[a-f0-9]{16}$/.test(cfg.token || '')) {
    cfg = { token: crypto.randomBytes(8).toString('hex') };
    try { fs.writeFileSync(file, JSON.stringify(cfg)); } catch (e) { /* key just won't survive a restart */ }
  }
  remote.token = cfg.token;
  const page = fs.readFileSync(path.join(__dirname, 'remote.html'));
  const prefix = '/r/' + remote.token;
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith(prefix)) { res.writeHead(404, HEADERS); res.end(); return; }
    const route = url.slice(prefix.length);
    if ((route === '' || route === '/') && req.method === 'GET') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, HEADERS)); res.end(page);
    } else if (route === '/events' && req.method === 'GET') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }, HEADERS));
      res.write('retry: 2000\n\n');
      if (remote.state) res.write('data: ' + JSON.stringify(remote.state) + '\n\n');
      remote.clients.add(res);
      req.on('close', () => remote.clients.delete(res));
    } else if (route === '/cmd' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        let cmd = {};
        try { cmd = cleanCommand(JSON.parse(body)); } catch (e) { /* ignore bad input */ }
        if (editor && Object.keys(cmd).length) editor.webContents.send('pm:remote', cmd);
        res.writeHead(204, HEADERS); res.end();
      });
    } else { res.writeHead(404, HEADERS); res.end(); }
  });
  let port = 47800;
  server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < 47810) server.listen(++port, '0.0.0.0'); else remote.port = 0; });
  server.on('listening', () => { remote.port = port; });
  server.listen(port, '0.0.0.0');
  setInterval(() => { for (const c of remote.clients) c.write(': keep-alive\n\n'); }, 20000);

  ipcMain.on('pm:state', (e, state) => {
    if (!editor || e.sender !== editor.webContents) return;
    let json;
    try { json = JSON.stringify(state); } catch (err) { return; }
    if (json.length > 20000) return;
    remote.state = JSON.parse(json);
    for (const c of remote.clients) c.write('data: ' + json + '\n\n');
  });
  ipcMain.handle('pm:remoteInfo', async () => {
    if (!remote.port) return { links: [], error: 'The remote could not start on this computer.' };
    const links = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) for (const n of nets[name]) {
      if (n.family !== 'IPv4' || n.internal || n.address.startsWith('169.254.')) continue;
      links.push({ name, url: `http://${n.address}:${remote.port}${prefix}/` });
    }
    const rank = (l) => (/wi-?fi|wlan|wireless/i.test(l.name) ? 0 : /bluetooth/i.test(l.name) ? 1 : 2);
    links.sort((a, b) => rank(a) - rank(b));
    const QR = require('qrcode');
    for (const l of links) l.qr = await QR.toDataURL(l.url, { margin: 2, width: 320 });
    return { links };
  });
}
app.whenReady().then(startRemote);
