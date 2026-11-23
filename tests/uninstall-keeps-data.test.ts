// v0.45.0: uninstalling ToolBox never deletes the user's data (the Coffre keeps
// Thomas's files there). The installer's setting, and the Windows CI step that
// really installs, writes a marker, uninstalls and checks it (scripts/uninstall-keeps-data.ps1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('désinstallation : les données restent', () => {
  it('l’installateur ne supprime pas le dossier de données', () => {
    expect(read('electron-builder.yml')).toMatch(/^\s*deleteAppDataOnUninstall:\s*false\s*$/m);
  });

  it('la CI Windows installe, désinstalle et vérifie un fichier du Coffre', () => {
    const workflow = read('.github/workflows/build-windows.yml');
    expect(workflow).toContain('scripts/uninstall-keeps-data.ps1');
    const script = read('scripts/uninstall-keeps-data.ps1');
    expect(script).toContain("'coffre\\Cours\\marqueur-desinstallation.txt'");
    expect(script).toMatch(/ÉCHEC : la désinstallation a effacé les données/);
  });
});
