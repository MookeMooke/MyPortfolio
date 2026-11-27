/* Desktop shell: serves the app from a private origin, puts the output fullscreen on the
   projector, and feeds the laptop's own sound output to the music-reactive effects. */
const { app, BrowserWindow, protocol, net, session, desktopCapturer, screen, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'app://local/';
const preload = path.join(__dirname, 'preload.js');
let editor = null, output = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
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
  editor.webContents.on('did-finish-load', () => {
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
    return net.fetch(pathToFileURL(file).toString());
  });
  // "PC sound": hand over the system audio output (loopback) without a picker.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(wc.getURL().startsWith(ORIGIN)));
  ipcMain.handle('pm:hasProjector', () => !!projector());
  createEditor();
});
app.on('window-all-closed', () => app.quit());
