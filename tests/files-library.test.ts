// v0.45.0 (ADR 0051): ctx.files for the user's files a module keeps — its
// library (<userData>/<id>/), the provenance of a downloaded file, and the
// refusal to run a program without a confirmation.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isRunnable,
  mountsDisk,
  parseZoneIdentifier,
  runnableQuestion,
} from '../packages/sdk/core';
import { createModuleFiles } from '../backend/core/files';
import { createNullHost } from '../backend/core/host';

describe('ctx.files: the user files kept by a module', () => {
  const setup = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'toolbox-lib-'));
    const opened: string[] = [];
    const files = createModuleFiles({
      moduleId: 'coffre',
      modulesDataDir: path.join(root, 'modules'),
      assetsDir: path.join(root, 'assets'),
      getOutputRoot: () => path.join(root, 'out'),
      host: createNullHost({ openPath: async (p) => void opened.push(p) }),
      mediaUrl: (p) => `media:${p}`,
    });
    return { root, files, opened };
  };

  it('the library is <userData>/<id>/, beside the modules’ data; nothing outside it', () => {
    const { root, files } = setup();
    expect(files.libraryDir).toBe(path.join(root, 'coffre'));
    expect(files.libraryPath('Cours', 'Thermo', 'a.pdf')).toBe(
      path.join(root, 'coffre', 'Cours', 'Thermo', 'a.pdf'),
    );
    expect(() => files.libraryPath('..', 'hub.db')).toThrow();
  });

  it('a program, a script or a shortcut is never opened without « runnable »', async () => {
    const { files, opened } = setup();
    for (const name of [
      'setup.exe',
      'x.MSI',
      'run.bat',
      'a.cmd',
      's.ps1',
      'v.vbs',
      'go.lnk',
      'z.scr',
      'c.com',
      'j.js',
      // v0.47.1: Python, AutoHotkey, help, ClickOnce, settings shortcuts, Windows Script, VB,
      // PowerShell data / formats, installer transforms, and disk images (mounted when opened).
      'main.py',
      'gui.PYW',
      'app.pyz',
      'macro.ahk',
      'aide.chm',
      'outil.appref-ms',
      'r.settingcontent-ms',
      'x.ws',
      'm.vb',
      'mod.psd1',
      'f.ps1xml',
      't.mst',
      'win.iso',
      'd.img',
      'v.vhd',
      'v.vhdx',
    ])
      expect(isRunnable(name), name).toBe(true);
    for (const name of ['cours.pdf', 'photo.jpg', 'exe', 'notes.md', 'data.json', 'main.c', 'py'])
      expect(isRunnable(name), name).toBe(false);
    expect(mountsDisk('win.ISO')).toBe(true);
    expect(mountsDisk('main.py')).toBe(false);
    expect(runnableQuestion('win.iso')).toMatch(
      /« win\.iso » est une image de disque : l’ouvrir la MONTE/,
    );
    expect(runnableQuestion('main.py')).toMatch(
      /« main\.py » est un programme ou un script : l’ouvrir le LANCE/,
    );
    for (const name of ['C:/x/main.py', 'C:/x/gui.pyw', 'C:/x/j.js', 'C:/x/s.ps1'])
      await expect(files.open(name)).rejects.toThrow(/lance un programme/);
    await expect(files.open('C:/x/win.iso')).rejects.toThrow(/monte une image de disque/);
    await expect(files.open('C:/x/setup.exe')).rejects.toThrow(/lance un programme/);
    expect(opened).toEqual([]);
    await files.open('C:/x/setup.exe', { runnable: true });
    await files.open('C:/x/cours.pdf');
    expect(opened).toEqual(['C:/x/setup.exe', 'C:/x/cours.pdf']);
  });

  it('the provenance: Windows’ Mark of the Web, or null', () => {
    const { root, files } = setup();
    const file = path.join(root, 'cours.pdf');
    writeFileSync(file, '%PDF');
    expect(files.provenance(file)).toBeNull();
    // On NTFS the stream « :Zone.Identifier » (elsewhere: a file of that name, read the same way).
    writeFileSync(
      `${file}:Zone.Identifier`,
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://moodle.ecam.be/f.pdf\r\n',
    );
    expect(files.provenance(file)).toEqual({
      zone: 3,
      hostUrl: 'https://moodle.ecam.be/f.pdf',
      referrerUrl: null,
    });
    expect(parseZoneIdentifier('[ZoneTransfer]\nZoneId=3\nReferrerUrl=about:internet')).toEqual({
      zone: 3,
      hostUrl: null,
      referrerUrl: 'about:internet',
    });
    expect(parseZoneIdentifier('nothing')).toBeNull();
  });
});
