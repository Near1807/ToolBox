// Worker of the probe app (ADR 0044, step 3a): SQLite in WebAssembly with the
// OPFS « opfs-sahpool » VFS, exactly what the phone version will use. One
// database, two tables: `lancements` (one row per start of the app) and
// `lignes` (the 1 000-row write test). No fallback: when OPFS is missing, the
// page is told so, with what is missing, and nothing is stored anywhere else.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const POOL = 'toolbox-probe';
const DB_FILE = '/probe.sqlite3';

let db = null;
let pool = null;
let vfsName = null;

const reply = (id, ok, payload) => postMessage({ id, ok, ...payload });

/** What the Worker can see of OPFS, before trying anything. */
async function opfsCapabilities() {
  const caps = {
    secureContext: self.isSecureContext === true,
    storageGetDirectory: typeof navigator.storage?.getDirectory === 'function',
    syncAccessHandle:
      typeof self.FileSystemFileHandle !== 'undefined' &&
      typeof self.FileSystemFileHandle.prototype.createSyncAccessHandle === 'function',
    syncAccessHandleWorks: false,
    error: null,
  };
  if (!caps.storageGetDirectory) return caps;
  // Really open one: some WebViews declare the method but refuse it.
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('.probe-sah-test', { create: true });
    const sah = await handle.createSyncAccessHandle();
    sah.close();
    await root.removeEntry('.probe-sah-test');
    caps.syncAccessHandleWorks = true;
  } catch (error) {
    caps.error = `${error?.name ?? 'Erreur'} : ${error?.message ?? String(error)}`;
  }
  return caps;
}

async function open() {
  const caps = await opfsCapabilities();
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const missing = [];
  if (!caps.secureContext) missing.push('contexte sécurisé (isSecureContext)');
  if (!caps.storageGetDirectory) missing.push('navigator.storage.getDirectory (OPFS)');
  if (!caps.syncAccessHandle) missing.push('FileSystemFileHandle.createSyncAccessHandle');
  else if (!caps.syncAccessHandleWorks)
    missing.push(`createSyncAccessHandle refusé (${caps.error ?? 'raison inconnue'})`);
  if (missing.length)
    return { opfs: false, missing, caps, sqliteVersion: sqlite3.version.libVersion };
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: POOL, initialCapacity: 6 });
  } catch (error) {
    return {
      opfs: false,
      missing: [`installation de la VFS opfs-sahpool : ${error?.message ?? String(error)}`],
      caps,
      sqliteVersion: sqlite3.version.libVersion,
    };
  }
  db = new pool.OpfsSAHPoolDb(DB_FILE);
  vfsName = (typeof db.dbVfsName === 'function' && db.dbVfsName()) || pool.vfsName;
  db.exec(`
    CREATE TABLE IF NOT EXISTS lancements (numero INTEGER PRIMARY KEY, date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lignes (id INTEGER PRIMARY KEY, texte TEXT NOT NULL, date TEXT NOT NULL);
  `);
  return { opfs: true, caps, sqliteVersion: sqlite3.version.libVersion };
}

const scalar = (sql) => db.selectValue(sql);

function state() {
  return {
    launches: scalar('SELECT COUNT(*) FROM lancements'),
    firstLaunch: scalar('SELECT date FROM lancements ORDER BY numero LIMIT 1') ?? null,
    lastLaunch: scalar('SELECT date FROM lancements ORDER BY numero DESC LIMIT 1') ?? null,
    rows: scalar('SELECT COUNT(*) FROM lignes'),
    vfs: vfsName,
    // opfs-sahpool keeps the database in OPFS: persistent. Anything else
    // (memdb, :memory:) would not be, and is never used here.
    persistent: vfsName === POOL || /sahpool/i.test(String(vfsName)),
    poolFiles: pool.getFileNames(),
    poolCapacity: pool.getCapacity(),
  };
}

const handlers = {
  async start() {
    const opened = await open();
    if (!opened.opfs) return opened;
    db.exec({ sql: 'INSERT INTO lancements (date) VALUES (?)', bind: [new Date().toISOString()] });
    return { ...opened, state: state() };
  },
  write1000() {
    const started = performance.now();
    const now = new Date().toISOString();
    db.transaction(() => {
      const stmt = db.prepare('INSERT INTO lignes (texte, date) VALUES (?, ?)');
      try {
        for (let i = 1; i <= 1000; i++) {
          stmt.bind([`Ligne d’essai ${i}`, now]).stepReset();
        }
      } finally {
        stmt.finalize();
      }
    });
    return { ms: performance.now() - started, state: state() };
  },
  readAll() {
    const started = performance.now();
    let count = 0;
    let length = 0;
    db.exec({
      sql: 'SELECT id, texte, date FROM lignes ORDER BY id',
      rowMode: 'array',
      callback: (row) => {
        count++;
        length += String(row[1]).length;
      },
    });
    return { ms: performance.now() - started, count, length, state: state() };
  },
};

onmessage = async (event) => {
  const { id, action } = event.data;
  try {
    const handler = handlers[action];
    if (!handler) throw new Error(`Action inconnue : ${action}`);
    if (action !== 'start' && !db)
      throw new Error('La base n’est pas ouverte (OPFS indisponible).');
    reply(id, true, { result: await handler() });
  } catch (error) {
    reply(id, false, { error: `${error?.name ?? 'Erreur'} : ${error?.message ?? String(error)}` });
  }
};
