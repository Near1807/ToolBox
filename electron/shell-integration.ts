import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { RECEIVE_SWITCH } from '../backend/core/received-files';

// v0.47.0 (Expérimental): « Ranger dans ToolBox » in the Explorer's right
// click and in « Envoyer vers » (ADR 0059). Per user (HKCU): no administrator.
// The installer adds them and its uninstaller removes them
// (resources/build/installer.nsh, the SAME names); Réglages › Général can
// remove them or put them back (here). Windows only.

/** The registry keys (files and folders), the same as the installer's. */
export const MENU_KEYS = [
  'HKCU\\Software\\Classes\\*\\shell\\ToolBox.Ranger',
  'HKCU\\Software\\Classes\\Directory\\shell\\ToolBox.Ranger',
];
export const MENU_LABEL = 'Ranger dans ToolBox';
/** Thomas's choice (« off »: removed in Réglages): an update of ToolBox does not put them back. */
const CHOICE_KEY = 'HKCU\\Software\\ToolBox';
const SENDTO_NAME = 'Ranger dans ToolBox.lnk';

const sendToFile = () =>
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', SENDTO_NAME);
/** The program to start: the installed ToolBox.exe (the portable one: its own file). */
const exe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

function reg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (error) => resolve(!error));
  });
}

export async function getShellIntegration(): Promise<{ menu: boolean; sendTo: boolean }> {
  if (process.platform !== 'win32') return { menu: false, sendTo: false };
  const menu = (await Promise.all(MENU_KEYS.map((k) => reg(['query', `${k}\\command`])))).every(
    Boolean,
  );
  return { menu, sendTo: existsSync(sendToFile()) };
}

export async function setShellIntegration(
  enabled: boolean,
): Promise<{ menu: boolean; sendTo: boolean }> {
  if (process.platform !== 'win32') return { menu: false, sendTo: false };
  const program = exe();
  for (const key of MENU_KEYS) {
    if (enabled) {
      await reg(['add', key, '/ve', '/d', MENU_LABEL, '/f']);
      await reg(['add', key, '/v', 'Icon', '/d', `${program},0`, '/f']);
      // Several files selected: one launch each, gathered into one window by ToolBox.
      await reg(['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
      await reg([
        'add',
        `${key}\\command`,
        '/ve',
        '/d',
        `"${program}" ${RECEIVE_SWITCH} "%1"`,
        '/f',
      ]);
    } else await reg(['delete', key, '/f']);
  }
  await reg(['add', CHOICE_KEY, '/v', 'ShellMenu', '/d', enabled ? 'on' : 'off', '/f']);
  const link = sendToFile();
  if (enabled)
    shell.writeShortcutLink(link, 'create', {
      target: program,
      args: RECEIVE_SWITCH,
      description: MENU_LABEL,
      icon: program,
      iconIndex: 0,
    });
  else if (existsSync(link)) unlinkSync(link);
  return getShellIntegration();
}
