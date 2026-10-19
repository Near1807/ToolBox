import path from 'node:path';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import discoveredModules from 'virtual:toolbox-modules';
import { toUnpackedPath } from '../backend/core/ffmpeg-binaries';
import { mediaTokenFromUrl } from '../backend/core/media';
import { generateToken } from '../backend/core/security';
import { startServer, type RunningServer } from '../backend/server';
import { createElectronHost } from './host';
import { runSmokeTest } from './smoke-test';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = !app.isPackaged && Boolean(devServerUrl);
const smokeTestArg = process.argv.find((arg) => arg.startsWith('--smoke-test='));
const smokeTestFile = smokeTestArg?.slice('--smoke-test='.length);

// Lets CI and tests run against an isolated profile instead of the user's real data.
if (process.env.TOOLBOX_USER_DATA_DIR) app.setPath('userData', process.env.TOOLBOX_USER_DATA_DIR);

// In dev, scripts/dev.mjs chooses the token and port so the Vite proxy can use them.
const token = (isDev && process.env.TOOLBOX_DEV_TOKEN) || generateToken();
const apiPort = isDev ? Number(process.env.TOOLBOX_API_PORT ?? 47321) : 0;
// Example modules (modules/_*) are loaded on demand: smoke test, or TOOLBOX_LOAD_EXAMPLES=1.
const loadExamples = Boolean(smokeTestFile) || process.env.TOOLBOX_LOAD_EXAMPLES === '1';

// A bug anywhere must not take the whole hub down: log it and keep running.
process.on('uncaughtException', (error) => {
  server?.hub.logger.error('Exception non gérée', error);
  console.error(error);
});
process.on('unhandledRejection', (reason) => {
  server?.hub.logger.error('Promesse rejetée non gérée', reason);
  console.error(reason);
});

let server: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;

ipcMain.on('toolbox:get-config', (event) => {
  event.returnValue = { token };
});

// Drag a generated file out of the window (to a browser, the Explorer…). Only
// files with a valid signed media URL can be dragged (backend/core/media.ts).
ipcMain.on('toolbox:start-drag', (event, mediaUrl: unknown) => {
  if (typeof mediaUrl !== 'string' || !server) return;
  const mediaToken = mediaTokenFromUrl(mediaUrl);
  const file = mediaToken ? server.hub.media.resolve(mediaToken) : null;
  if (!file || !existsSync(file)) return;
  const sender = event.sender;
  const isImage = /\.(jpe?g|png)$/i.test(file);
  const iconPromise = isImage
    ? Promise.resolve(nativeImage.createFromPath(file).resize({ width: 96 }))
    : app.getFileIcon(file, { size: 'normal' });
  void iconPromise.then((icon) => sender.startDrag({ file, icon }));
});

function createWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ToolBox',
    backgroundColor: '#0f1115',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => {
    if (!smokeTestFile) window.show();
  });

  // Links to external sites open in the default browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) event.preventDefault();
  });

  void window.loadURL(appUrl);
  return window;
}

async function bootstrap(): Promise<void> {
  server = await startServer({
    dataDir: app.getPath('userData'),
    token,
    appVersion: app.getVersion(),
    host: createElectronHost(),
    modules: discoveredModules,
    loadExamples,
    // Module assets are copied to build/modules at build time and unpacked from
    // app.asar (external tools such as FFmpeg must be able to read them).
    assetsRoot: toUnpackedPath(path.join(__dirname, '..', 'modules')),
    echoLogs: isDev,
    port: apiPort,
    rendererDir: isDev ? undefined : path.join(__dirname, '..', 'renderer'),
    extraOrigins: isDev && devServerUrl ? [new URL(devServerUrl).origin] : [],
  });

  const appUrl = isDev && devServerUrl ? devServerUrl : `${server.url}/`;
  mainWindow = createWindow(appUrl);

  if (smokeTestFile) {
    const window = mainWindow;
    const uiLoaded = new Promise<void>((resolve, reject) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.once('did-fail-load', (_e, code, description) =>
        reject(new Error(`UI load failed: ${code} ${description}`)),
      );
    });
    const ok = await runSmokeTest(smokeTestFile, server.url, token, window, uiLoaded);
    app.exit(ok ? 0 : 1);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      dialog.showErrorBox('ToolBox', `Démarrage impossible : ${String(error)}`);
      app.exit(1);
    });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', (event) => {
    if (!server) return;
    event.preventDefault();
    const closing = server;
    server = null;
    // Never hang on exit: give the hub 5 s to stop cleanly.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    // app.quit() is ignored once will-quit was prevented: exit explicitly.
    void Promise.race([closing.close(), timeout]).finally(() => app.exit(0));
  });
}
