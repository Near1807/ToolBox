import path from 'node:path';
import { app, dialog, Menu, Notification, nativeImage, Tray, type BrowserWindow } from 'electron';

// Desktop integration: notification-area icon, start with Windows (minimised),
// notifications that open a page of the UI. With « Lancer ToolBox au démarrage
// de Windows » on, closing the window keeps the app in the notification area,
// so reminders and scheduled tasks keep running (docs/decisions/0019).

// Windows shows notifications only for an app with an identity (same as the installer's appId).
if (process.platform === 'win32') app.setAppUserModelId('com.near1807.toolbox');

/** Started by Windows at login: no window until the user opens it from the tray. */
export const startedHidden = process.argv.includes('--hidden');

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let keepInTray = false;
let quitting = false;
let trayHintShown = false;

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', '..', 'resources', 'build', 'icon.png');
}

/** Shows the window (from the tray, a notification…) and opens a UI route if given. */
export function showWindow(target?: string): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (target) window.webContents.send('toolbox:navigate', target);
}

function updateTray(): void {
  if (keepInTray && !tray) {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
    tray.setToolTip('ToolBox');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir ToolBox', click: () => showWindow() },
        { type: 'separator' },
        { label: 'Quitter ToolBox', click: () => quitApp() },
      ]),
    );
    tray.on('click', () => showWindow());
  } else if (!keepInTray && tray) {
    tray.destroy();
    tray = null;
  }
}

export function quitApp(): void {
  quitting = true;
  app.quit();
}

/**
 * Wires the main window: closing it hides it in the tray while the option is
 * on. Without the tray, closing while tasks run (a YouTube upload…) asks first:
 * they stop with the app and resume at the next start.
 */
export function attachDesktop(main: BrowserWindow, busyJobs: () => string[] = () => []): void {
  window = main;
  app.on('before-quit', () => {
    quitting = true;
  });
  main.on('close', (event) => {
    if (!keepInTray && !quitting) {
      const busy = busyJobs();
      if (busy.length === 0) return;
      const choice = dialog.showMessageBoxSync(main, {
        type: 'warning',
        title: 'ToolBox',
        message: 'Une tâche est en cours : fermer quand même ?',
        detail: `${busy.slice(0, 5).join('\n')}${busy.length > 5 ? `\n… et ${busy.length - 5} autre(s)` : ''}\n\nUn envoi YouTube interrompu reprendra au prochain lancement, là où il s’était arrêté. Pour qu’il continue fenêtre fermée : Réglages › « Lancer ToolBox au démarrage de Windows » (ToolBox reste alors dans la zone de notification).`,
        buttons: ['Fermer quand même', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice === 1) event.preventDefault();
      return;
    }
    if (!keepInTray || quitting) return;
    event.preventDefault();
    main.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      notify({
        title: 'ToolBox reste ouvert',
        body: 'L’app continue dans la zone de notification pour tes rappels. Clic droit sur l’icône > Quitter pour la fermer.',
      });
    }
  });
}

export function setLaunchAtStartup(enabled: boolean): void {
  keepInTray = enabled;
  // In dev the login item would start the bare Electron binary: only when packaged.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
  }
  if (app.isReady()) updateTray();
  else void app.whenReady().then(updateTray);
}

export function notify(notification: { title: string; body: string; target?: string }): void {
  if (!Notification.isSupported()) return;
  const shown = new Notification({
    title: notification.title,
    body: notification.body,
    icon: nativeImage.createFromPath(iconPath()),
  });
  shown.on('click', () => showWindow(notification.target));
  shown.show();
}
