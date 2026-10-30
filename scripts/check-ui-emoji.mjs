// No emoji in the interface (docs/MODULES.md §7.1): icons come from the one
// lucide set of the SDK (packages/sdk/icons.tsx, <Icon name="…" />). This check
// fails on any emoji in the shell or module frontends (comments aside) and on
// a module manifest whose `icon` is not a name of that set. Text that goes
// out of the app (an Instagram caption, a Markdown export) is not interface.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const roots = [path.join(root, 'frontend/src'), path.join(root, 'packages/sdk')];
const modules = readdirSync(path.join(root, 'modules')).filter((name) =>
  statSync(path.join(root, 'modules', name)).isDirectory(),
);
for (const name of modules) roots.push(path.join(root, 'modules', name, 'frontend'));
const extensions = new Set(['.css', '.ts', '.tsx']);
const emoji = /\p{Extended_Pictographic}/u;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
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
      .forEach((line, i) => {
        const code = line
          .replace(/\/\*.*?\*\//g, '')
          .replace(/\/\/.*$/, '')
          .replace(/^\s*\*.*$/, '');
        if (emoji.test(code))
          problems.push(`${path.relative(root, file)}:${i + 1} : emoji → <Icon name="…" />`);
      });
  }
}

// The icon names of the set: the keys of `ICONS` in packages/sdk/icons.tsx.
const icons = readFileSync(path.join(root, 'packages/sdk/icons.tsx'), 'utf8');
const set = icons.slice(icons.indexOf('export const ICONS'), icons.indexOf('} satisfies'));
const names = new Set([...set.matchAll(/^\s*'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]));
for (const name of modules) {
  const file = path.join(root, 'modules', name, 'module.json');
  let icon;
  try {
    icon = JSON.parse(readFileSync(file, 'utf8')).icon;
  } catch {
    continue;
  }
  if (!names.has(icon))
    problems.push(
      `modules/${name}/module.json : icône « ${icon} » inconnue (packages/sdk/icons.tsx)`,
    );
}

if (problems.length) {
  console.error(`check:ui-emoji : ${problems.length} problème(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(
  `check:ui-emoji : aucun emoji dans l’interface, ${modules.length} icônes de module connues.`,
);
