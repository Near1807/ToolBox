// v0.47.1: a file of code is never handed to Windows' associated application
// (which may RUN it): a double-click opens VS Code when it is installed, else
// ToolBox's preview; a script is never launched without the question that
// names it — checked by the page AND by the server.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHost } from '@hub/sdk/testing';
import { openPlan } from '../frontend/logic';
import { API, deposit, diskWorld, ok, type DiskWorld } from './disk-helpers';

const file = (name: string) => ({
  kind: 'file' as const,
  name,
  ext: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
});

describe('double-clic sur un fichier de code', () => {
  it('VS Code installé : VS Code ; sinon l’aperçu ; jamais l’application de Windows', () => {
    for (const name of [
      'main.py',
      'outil.pyw',
      'app.js',
      'install.ps1',
      'run.sh',
      'go.bat',
      'x.cmd',
    ])
      expect(openPlan(file(name), { vscode: true }), name).toEqual({ kind: 'vscode' });
    for (const name of ['main.py', 'app.js', 'install.ps1', 'run.sh', 'go.bat'])
      expect(openPlan(file(name), { vscode: false }), name).toEqual({ kind: 'preview' });
    // Not code: its application (a program only after the question).
    expect(openPlan(file('cours.pdf'), { vscode: true })).toEqual({ kind: 'app', confirm: false });
    expect(openPlan(file('setup.exe'), { vscode: true })).toEqual({ kind: 'app', confirm: true });
    expect(openPlan(file('win.iso'), { vscode: true })).toEqual({ kind: 'app', confirm: true });
    expect(openPlan({ kind: 'project', name: 'robot', ext: '' }, { vscode: false })).toEqual({
      kind: 'folder',
    });
  });
});

let w: DiskWorld;
afterEach(async () => {
  await w?.close();
});

describe('le serveur refuse de lancer un script sans confirmation', () => {
  it('.py, .pyw, .js, .ps1 : refusés dans l’application, rien d’ouvert ; avec la confirmation : ouverts', async () => {
    const opened: string[] = [];
    w = await diskWorld({
      host: createTestHost({ openPath: async (p: string) => void opened.push(p) }),
    });
    const items = await deposit(w, {
      'main.py': 'import os\nos.system("echo pirate")',
      'gui.pyw': 'print(1)',
      'app.js': 'WScript.Echo(1)',
      'install.ps1': 'Remove-Item C:\\',
    });
    for (const it of items) {
      const r = await w.hub.request('POST', `${API}/files/${it.id}/open`, { how: 'app' });
      expect(r.status, it.name).toBe(409);
      expect(JSON.stringify(r.body)).toMatch(/lance un programme : confirmation nécessaire/);
    }
    expect(opened).toEqual([]);
    await ok(w, 'POST', `${API}/files/${items[0]!.id}/open`, { how: 'app', runnable: true });
    expect(opened).toHaveLength(1);
    // « Afficher dans l'explorateur » runs nothing: allowed.
    await ok(w, 'POST', `${API}/files/${items[3]!.id}/open`, { how: 'folder' });
  });
});
