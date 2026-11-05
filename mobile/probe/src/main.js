// Page of the probe app (ADR 0044, step 3a): starts the SQLite Worker, counts
// this launch, and shows what the phone's WebView really offers. Everything
// shown is also in « Copier le rapport », to paste back to Claude.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './style.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map();
worker.onmessage = (event) => {
  const { id, ok, result, error } = event.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (ok) p.resolve(result);
  else p.reject(new Error(error));
};
worker.onerror = (event) => {
  for (const p of pending.values()) p.reject(new Error(event.message || 'Erreur du Worker'));
  pending.clear();
};
const call = (action) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action });
  });

const $ = (id) => document.getElementById(id);
const info = {
  appVersion: null,
  versionCode: null,
  platform: Capacitor.getPlatform(),
  userAgent: navigator.userAgent,
  android: /Android\s+([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'inconnue',
  webView: /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'inconnue',
  persistRequested: null,
  persisted: null,
  estimate: null,
  start: null,
  lastWrite: null,
  lastRead: null,
  error: null,
};

const yesNo = (v) => (v === null || v === undefined ? 'inconnu' : v ? 'oui' : 'non');
const dateFr = (iso) => (iso ? new Date(iso).toLocaleString('fr-BE') : '—');
const ms = (n) => `${n.toLocaleString('fr-BE', { maximumFractionDigits: 1 })} ms`;
const mb = (n) => `${(n / (1024 * 1024)).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Mo`;

/** Every line of the page, as label → value (shown and copied). */
function lines() {
  const s = info.start;
  const st = info.lastRead?.state ?? info.lastWrite?.state ?? s?.state;
  const out = [
    ['Appli d’essai', `${info.appVersion ?? '?'} (versionCode ${info.versionCode ?? '?'})`],
    ['Plateforme', info.platform],
    ['Android', info.android],
    ['WebView (Chrome)', info.webView],
  ];
  if (s?.opfs) {
    out.push(
      ['Lancements enregistrés', String(st.launches)],
      ['Premier lancement', dateFr(st.firstLaunch)],
      ['Ce lancement', dateFr(st.lastLaunch)],
      ['Lignes enregistrées', String(st.rows)],
      ['VFS utilisée', String(st.vfs)],
      ['Base persistante (OPFS)', yesNo(st.persistent)],
      ['Fichiers du pool', `${st.poolFiles.length} sur ${st.poolCapacity}`],
    );
  } else if (s) {
    out.push(
      ['OPFS', 'INDISPONIBLE — rien n’est enregistré'],
      ['Ce qui manque', s.missing.join(' ; ')],
    );
  }
  if (s) {
    out.push(
      ['createSyncAccessHandle (Worker)', yesNo(s.caps.syncAccessHandle)],
      ['createSyncAccessHandle utilisable', yesNo(s.caps.syncAccessHandleWorks)],
      ['Contexte sécurisé (Worker)', yesNo(s.caps.secureContext)],
      ['SQLite', s.sqliteVersion],
    );
  }
  out.push(
    ['storage.persist()', info.persistRequested ?? 'inconnu'],
    ['storage.persisted()', info.persisted ?? 'inconnu'],
    [
      'Espace (utilisé / quota)',
      info.estimate
        ? `${mb(info.estimate.usage ?? 0)} / ${mb(info.estimate.quota ?? 0)}`
        : 'inconnu',
    ],
  );
  if (info.lastWrite) out.push(['Écrire 1 000 lignes', ms(info.lastWrite.ms)]);
  if (info.lastRead)
    out.push(['Tout relire', `${ms(info.lastRead.ms)} — ${info.lastRead.count} lignes`]);
  if (info.error) out.push(['Erreur', info.error]);
  out.push(['userAgent', info.userAgent]);
  return out;
}

function render() {
  const ok = info.start?.opfs === true;
  const status = $('status');
  status.className = `status ${info.start ? (ok ? 'ok' : 'bad') : ''}`;
  status.textContent = !info.start
    ? 'Ouverture de la base…'
    : ok
      ? `OPFS disponible : ${info.start.state.launches} lancement(s) enregistré(s).`
      : 'OPFS INDISPONIBLE : rien n’est enregistré. Voir « Ce qui manque ».';
  if (ok)
    $('launches').textContent = String(
      (info.lastRead ?? info.lastWrite ?? info.start).state.launches,
    );
  $('write').disabled = !ok;
  $('read').disabled = !ok;
  const table = $('details');
  table.replaceChildren(
    ...lines().map(([label, value]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(th, td);
      return tr;
    }),
  );
}

function reportText() {
  return [`Rapport de l’appli d’essai ToolBox (${new Date().toLocaleString('fr-BE')})`]
    .concat(lines().map(([label, value]) => `${label} : ${value}`))
    .join('\n');
}

async function copyReport() {
  const text = reportText();
  $('report').value = text;
  $('report').hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    $('copied').textContent = 'Rapport copié.';
  } catch {
    // Some WebViews refuse the clipboard API: select the text for a manual copy.
    $('report').select();
    const done = document.execCommand?.('copy');
    $('copied').textContent = done
      ? 'Rapport copié.'
      : 'Copie automatique refusée : sélectionne le texte ci-dessous et copie-le.';
  }
}

async function busy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    info.error = error.message;
  } finally {
    button.disabled = false;
    render();
  }
}

$('write').addEventListener('click', () =>
  busy($('write'), async () => {
    info.lastWrite = await call('write1000');
  }),
);
$('read').addEventListener('click', () =>
  busy($('read'), async () => {
    info.lastRead = await call('readAll');
  }),
);
$('copy').addEventListener('click', () => void copyReport());

async function main() {
  render();
  try {
    const app = await App.getInfo();
    info.appVersion = app.version;
    info.versionCode = app.build;
  } catch {
    // In a browser (not the APK): the version set at build time.
    info.appVersion = import.meta.env.VITE_PROBE_VERSION_NAME ?? 'navigateur';
    info.versionCode = import.meta.env.VITE_PROBE_VERSION_CODE ?? '?';
  }
  try {
    info.persistRequested = navigator.storage?.persist
      ? yesNo(await navigator.storage.persist())
      : 'non disponible';
    info.persisted = navigator.storage?.persisted
      ? yesNo(await navigator.storage.persisted())
      : 'non disponible';
    info.estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch (error) {
    info.persistRequested = `erreur : ${error.message}`;
  }
  try {
    info.start = await call('start');
  } catch (error) {
    info.error = error.message;
  }
  render();
}

void main();
