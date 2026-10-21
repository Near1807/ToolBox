// Interface colours come only from theme tokens (docs/THEMES.md): this check
// fails on any colour literal (#hex, rgb(), hsl()) in the shell or module
// frontends. Theme files (frontend/src/themes/) are the only place for them.
// Generated visuals (backend renderers) are not concerned: they follow
// docs/DIRECTION-ARTISTIQUE.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const roots = [path.join(root, 'frontend/src'), path.join(root, 'packages/sdk')];
for (const name of readdirSync(path.join(root, 'modules'))) {
  const dir = path.join(root, 'modules', name, 'frontend');
  if (statSync(path.join(root, 'modules', name)).isDirectory()) roots.push(dir);
}
const skip = [path.join(root, 'frontend/src/themes')];
const extensions = new Set(['.css', '.ts', '.tsx']);
const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (skip.some((s) => full.startsWith(s))) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (extensions.has(path.extname(entry.name))) yield full;
  }
}

const problems = [];
for (const dir of roots) {
  for (const file of walk(dir)) {
    // packages/sdk: only its frontend files are interface code.
    if (file.includes(`${path.sep}packages${path.sep}sdk${path.sep}`) && !file.endsWith('.tsx')) {
      continue;
    }
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (line.includes('ui-colors-ignore')) return;
        // `&#…;` HTML entities and `#id` URL fragments are not colours.
        const cleaned = line.replace(/&#x?[0-9a-fA-F]+;/g, '').replace(/['"`]#\/[^'"`]*/g, '');
        for (const match of cleaned.matchAll(literal)) {
          problems.push(`${path.relative(root, file)}:${index + 1}  ${match[0]}  ${line.trim()}`);
        }
      });
  }
}

if (problems.length > 0) {
  console.error(
    'Couleurs écrites en dur dans l’interface (utiliser les variables du thème, docs/THEMES.md) :',
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('check:ui-colors : aucune couleur en dur dans l’interface.');
