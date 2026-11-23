// v0.45.0 (ADR 0051): ctx.files for the user's files a module keeps — its
// library (<userData>/<id>/), the provenance of a downloaded file, and the
// refusal to run a program without a confirmation.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRunnable, parseZoneIdentifier } from '../packages/sdk/core';
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
    ])
      expect(isRunnable(name), name).toBe(true);
    for (const name of ['cours.pdf', 'main.py', 'photo.jpg', 'exe', 'notes.md'])
      expect(isRunnable(name), name).toBe(false);
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
