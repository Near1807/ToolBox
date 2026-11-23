// v0.45.0: what an extension says about a file — its nature, its language,
// the application it belongs to — for the deductions (always « deviné »,
// always changeable). Pure.

export interface KindHint {
  nature: string;
  language?: string;
  application?: string;
}

const CODE: Record<string, string> = {
  py: 'Python',
  pyw: 'Python',
  ipynb: 'Python',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  rs: 'Rust',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  hpp: 'C++',
  cs: 'C#',
  java: 'Java',
  kt: 'Kotlin',
  go: 'Go',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  lua: 'Lua',
  r: 'R',
  m: 'MATLAB',
  jl: 'Julia',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
  ps1: 'PowerShell',
  bat: 'Batch',
  cmd: 'Batch',
  css: 'CSS',
  scss: 'CSS',
  vhd: 'VHDL',
  vhdl: 'VHDL',
  v: 'Verilog',
  asm: 'Assembleur',
  s: 'Assembleur',
  tex: 'LaTeX',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
};

const APPLICATIONS: Record<string, string> = {
  flp: 'FL Studio',
  pkt: 'Packet Tracer',
  pka: 'Packet Tracer',
  psd: 'Photoshop',
  ai: 'Illustrator',
  blend: 'Blender',
  als: 'Ableton Live',
  sldprt: 'SolidWorks',
  sldasm: 'SolidWorks',
  dwg: 'AutoCAD',
  fig: 'Figma',
  xcf: 'GIMP',
  kicad_pcb: 'KiCad',
  slx: 'Simulink',
  mlx: 'MATLAB',
  vsdx: 'Visio',
  pbix: 'Power BI',
  accdb: 'Access',
};

const NATURES: [string, string[]][] = [
  ['document', ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages']],
  ['présentation', ['ppt', 'pptx', 'odp', 'key']],
  ['tableur', ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'numbers']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico']],
  ['vidéo', ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'wmv']],
  ['son', ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'aiff']],
  ['texte', ['txt', 'log']],
  ['note', ['md', 'markdown']],
  ['page web', ['html', 'htm']],
  ['archive', ['zip', '7z', 'rar', 'tar', 'tar.gz', 'tgz', 'gz']],
  ['programme', ['exe', 'msi', 'appx', 'msix']],
];

/** « .PY » → « py ». */
export const extOf = (name: string): string => {
  const lower = name.toLowerCase();
  if (/\.tar\.(gz|bz2|xz|zst)$/.test(lower)) return lower.slice(lower.lastIndexOf('.tar.') + 1);
  const at = lower.lastIndexOf('.');
  return at > 0 ? lower.slice(at + 1) : '';
};

/** What the extension says (null: nothing known). */
export function kindOf(name: string): KindHint | null {
  const ext = extOf(name);
  if (!ext) return null;
  const application = APPLICATIONS[ext];
  if (application) return { nature: "fichier d'application", application };
  const language = CODE[ext];
  if (language) return { nature: 'code', language };
  for (const [nature, list] of NATURES) if (list.includes(ext)) return { nature };
  return null;
}

/** The natures offered in the sheet (Thomas may write others). */
export const NATURE_CHOICES = [
  'support du prof',
  'synthèse',
  'rapport',
  'code',
  'examen',
  'exercices',
  'contrat',
  'facture',
  "fichier d'application",
  'document',
  'présentation',
  'tableur',
  'image',
  'vidéo',
  'son',
  'note',
  'page web',
  'archive',
  'texte',
];

export const ORIGIN_CHOICES = ['donné par le prof', 'fait par moi', 'téléchargé'];
