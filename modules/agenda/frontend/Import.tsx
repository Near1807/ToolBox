// v0.37.0 (Expérimental): « Importer » a calendar into a source (PC only).
// 1. The file (.ics, .csv, .xlsx) is read here, nothing goes online. 2. The
// choices: new source or update of one (proposed when its name or its UIDs
// match), the columns of a table, the file's categories → Agenda categories
// (with their counts), the period, the title. 3. The preview, nothing
// written: to add / same / changed (with the differences) / gone / ignored /
// errors, each line with its box. 4. « Importer »: backup, one transaction,
// the summary, « Annuler l'import » for a while.
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  Page,
  UndoToast,
  useModule,
} from '@hub/sdk/frontend';
import { OWN_CATEGORIES } from '../shared/categories';
import type { ImportPreview, PreviewLine } from '../shared/importing';
import { eventWhen } from '../shared/time';
import type { AgendaSourceDto } from '../shared/types';

/** What the page sends for the file: the text (ICS, CSV) or the rows of the sheet (Excel). */
type FilePart = { format: 'ics' | 'csv'; text: string } | { format: 'xlsx'; rows: string[][] };

interface Analysis {
  format: string;
  calendarName: string | null;
  total: number;
  future: number;
  errors: number;
  categories: { value: string; count: number }[];
  headers: string[] | null;
  columns: Record<string, number> | null;
  fields: { field: string; label: string }[];
  matches: { id: string; name: string; byName: boolean; shared: number }[];
  codes: boolean;
}

interface Applied {
  importId: string | null;
  backup: string | null;
  source: AgendaSourceDto | null;
  added: number;
  updated: number;
  removed: number;
  same: number;
  left: { add: number; modified: number; gone: number };
  errors: number;
  ignored: number;
}

type Preview = ImportPreview & { sourceId: string | null };

const MAX_BYTES = 8 * 1024 * 1024;
const NEW = 'new';

/** The chosen file, read locally: Excel through xlsx.ts (loaded only then). */
async function readChosen(file: File): Promise<FilePart> {
  if (file.size > MAX_BYTES) throw new Error('Fichier trop gros (8 Mo au plus).');
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith('.xlsx')) {
    const { readXlsx } = await import('../shared/xlsx');
    return { format: 'xlsx', rows: readXlsx(bytes) };
  }
  if (name.endsWith('.xls'))
    throw new Error('Ancien format Excel (.xls) : enregistre-le en .xlsx ou en .csv dans Excel.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // An Excel CSV saved in Windows' encoding.
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  const ics = name.endsWith('.ics') || /^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text);
  return { format: ics ? 'ics' : 'csv', text };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function LineText(props: { line: PreviewLine; today: string }) {
  const l = props.line;
  return (
    <>
      <span className="ag-import__when">{eventWhen(l, props.today)}</span>{' '}
      <strong>{l.title}</strong>
      <span className="muted">
        {' '}
        · {l.category}
        {l.location ? ` · ${l.location}` : ''}
      </span>
    </>
  );
}

/** A list of lines with their boxes (« tout cocher » / « tout décocher » above). */
function Checklist<T extends PreviewLine>(props: {
  lines: T[];
  checked: Set<string>;
  onChange: (next: Set<string>) => void;
  today: string;
  extra?: (line: T) => ReactNode;
}) {
  const set = (keys: string[], on: boolean) => {
    const next = new Set(props.checked);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    props.onChange(next);
  };
  return (
    <>
      {props.lines.length > 5 && (
        <div className="ui-actions">
          <Button
            small
            variant="secondary"
            onClick={() =>
              set(
                props.lines.map((l) => l.key),
                true,
              )
            }
          >
            Tout cocher
          </Button>
          <Button
            small
            variant="secondary"
            onClick={() =>
              set(
                props.lines.map((l) => l.key),
                false,
              )
            }
          >
            Tout décocher
          </Button>
        </div>
      )}
      <ul className="ag-import__list">
        {props.lines.map((l) => (
          <li key={l.key}>
            <label className="ag-check">
              <input
                type="checkbox"
                checked={props.checked.has(l.key)}
                onChange={(e) => set([l.key], e.target.checked)}
              />{' '}
              <span>
                <LineText line={l} today={props.today} />
                {props.extra?.(l)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ImportPage() {
  const module = useModule();
  const [params] = useSearchParams();
  const [sources, setSources] = useState<AgendaSourceDto[]>([]);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<FilePart | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [target, setTarget] = useState(NEW);
  const [name, setName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultCategory, setDefaultCategory] = useState('');
  const [period, setPeriod] = useState<'future' | 'all'>('future');
  const [titleStyle, setTitleStyle] = useState<'short' | 'code'>('short');
  const [columns, setColumns] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accept, setAccept] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Applied | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    void module.api.get<AgendaSourceDto[]>('/sources').then(setSources, () => setSources([]));
  }, [module.api, done]);

  const categories = useMemo(
    () =>
      [
        ...new Set([
          ...OWN_CATEGORIES,
          'Cours',
          'Examens',
          ...sources.flatMap((s) => s.categories),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [sources],
  );

  const reset = () => {
    setInfo(null);
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const choose = async (f: File | undefined) => {
    reset();
    setAnalysis(null);
    setFile(null);
    if (!f) return;
    setFileName(f.name);
    setBusy(true);
    try {
      const part = await readChosen(f);
      const a = await module.api.post<Analysis>('/import/analyze', part);
      setFile(part);
      setAnalysis(a);
      setColumns(a.columns ?? {});
      // An update of a source when one matches (or the one asked for), else a new source.
      const wanted = params.get('source');
      const first = wanted && sources.some((s) => s.id === wanted) ? wanted : a.matches[0]?.id;
      pickTarget(first ?? NEW, a, f.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pickTarget = (id: string, a = analysis, file = fileName) => {
    setTarget(id);
    setPreview(null);
    const s = sources.find((x) => x.id === id);
    if (s) {
      setMapping(s.mapping);
      setDefaultCategory(s.defaultCategory);
      setTitleStyle(s.titleStyle);
      if (s.columns && a?.headers) setColumns(s.columns as Record<string, number>);
    } else {
      const base = a?.calendarName ?? file.replace(/\.[^.]+$/, '');
      setName(base);
      setMapping({});
      setDefaultCategory('');
      setTitleStyle('short');
    }
  };

  const choices = () => ({
    ...file!,
    ...(target === NEW ? { name: name.trim() } : { sourceId: target }),
    mapping,
    defaultCategory: defaultCategory.trim() || (target === NEW ? name.trim() : ''),
    period,
    titleStyle,
    ...(analysis?.headers ? { columns } : {}),
  });

  const showPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await module.api.post<Preview>('/import/preview', choices());
      setPreview(p);
      // The defaults: added and modified checked, except « supprimé avant » and « modifié par toi »; gone unchecked.
      setAccept(
        new Set([
          ...p.add.filter((l) => !l.deletedBefore).map((l) => l.key),
          ...p.modified.filter((l) => !l.mine).map((l) => l.key),
        ]),
      );
      setRemove(new Set());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await module.api.post<Applied>('/import/apply', {
        ...choices(),
        accept: [...accept],
        remove: [...remove],
      });
      setDone(r);
      setUndo(r.importId);
      setPreview(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const template = async (format: 'csv' | 'xlsx') => {
    try {
      await module.api.post('/import/template', { format });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const changes = preview
    ? preview.add.filter((l) => accept.has(l.key)).length +
      preview.modified.filter((l) => accept.has(l.key)).length +
      preview.gone.filter((l) => remove.has(l.key)).length
    : 0;
  const tableReady =
    !analysis?.headers || (columns.title !== undefined && columns.date !== undefined);

  return (
    <Page
      title="Agenda : importer un calendrier"
      subtitle={
        <span className="ag-subtitle">
          <span className="badge badge--warning" title="Pas encore validé à l’usage">
            Expérimental
          </span>{' '}
          <Link to="/m/agenda">← Retour à l’agenda</Link> ·{' '}
          <Link to="/settings?s=agenda">Gérer les sources</Link>
        </span>
      }
    >
      <Card title="1. Le fichier">
        <p>
          Un calendrier <strong>.ics</strong> (export d’un horaire, d’Outlook, de Google Agenda…),
          ou un tableau <strong>.csv</strong> ou <strong>.xlsx</strong>. Le fichier est lu sur ce PC
          : rien n’est envoyé en ligne, rien n’est écrit avant que tu valides l’aperçu.
        </p>
        <input
          className="input"
          type="file"
          accept=".ics,.csv,.xlsx,text/calendar,text/csv"
          aria-label="Choisir le fichier à importer"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <p className="small muted">
          Un tableau à remplir : modèle{' '}
          <Button small variant="secondary" onClick={() => void template('csv')}>
            CSV
          </Button>{' '}
          <Button small variant="secondary" onClick={() => void template('xlsx')}>
            Excel
          </Button>{' '}
          (colonnes : titre, date, début, fin ou durée, toute la journée, lieu, note, catégorie,
          identifiant).
        </p>
        {busy && <p className="muted">Lecture…</p>}
      </Card>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {info && <p className="ag-import__info">{info}</p>}

      {analysis && file && !done && (
        <Card title="2. Les choix">
          <p>
            {analysis.calendarName ? `« ${analysis.calendarName} » : ` : `${fileName} : `}
            {plural(analysis.total, 'événement')} ({analysis.future} à venir)
            {analysis.errors > 0 && `, ${plural(analysis.errors, 'erreur')} (détail dans l’aperçu)`}
            .
          </p>
          <fieldset className="ag-import__group">
            <legend>Dans quelle source ?</legend>
            {analysis.matches.map((m) => (
              <label key={m.id} className="ag-check">
                <input type="radio" checked={target === m.id} onChange={() => pickTarget(m.id)} />{' '}
                Mettre à jour « {m.name} »
                <span className="muted">
                  {' '}
                  ({m.shared > 0 ? `${plural(m.shared, 'identifiant')} en commun` : 'même nom'})
                </span>
              </label>
            ))}
            {sources
              .filter((s) => !analysis.matches.some((m) => m.id === s.id))
              .map((s) => (
                <label key={s.id} className="ag-check">
                  <input type="radio" checked={target === s.id} onChange={() => pickTarget(s.id)} />{' '}
                  Mettre à jour « {s.name} »{' '}
                  <span className="muted">(aucun élément en commun)</span>
                </label>
              ))}
            <label className="ag-check">
              <input type="radio" checked={target === NEW} onChange={() => pickTarget(NEW)} /> Une
              nouvelle source :
            </label>
            {target === NEW && (
              <input
                className="input"
                value={name}
                aria-label="Nom de la nouvelle source"
                placeholder="Horaire ECAM"
                onChange={(e) => {
                  setName(e.target.value);
                  setPreview(null);
                }}
              />
            )}
          </fieldset>

          {analysis.headers && (
            <fieldset className="ag-import__group">
              <legend>Les colonnes</legend>
              <p className="small muted">
                Quelle colonne du fichier donne quoi ? Le titre et la date sont obligatoires ; sans
                heure de début, c’est un événement sur la journée. Ce choix est gardé pour la
                source.
              </p>
              <div className="ag-import__columns">
                {analysis.fields.map((f) => (
                  <label key={f.field} className="small">
                    {f.label}
                    <select
                      className="input"
                      value={columns[f.field] ?? ''}
                      onChange={(e) => {
                        const next = { ...columns };
                        if (e.target.value === '') delete next[f.field];
                        else next[f.field] = Number(e.target.value);
                        setColumns(next);
                        setPreview(null);
                      }}
                    >
                      <option value="">—</option>
                      {analysis.headers!.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `colonne ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="ag-import__group">
            <legend>Les catégories</legend>
            <p className="small muted">
              Chaque valeur du fichier va dans une catégorie de l’Agenda (existante ou nouvelle) :
              les interrupteurs de catégorie les montrent ou les cachent. Une valeur laissée vide va
              dans la catégorie « pour le reste ».
            </p>
            <datalist id="ag-import-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <table className="ag-import__map">
              <tbody>
                {analysis.categories.map((c) => (
                  <tr key={c.value}>
                    <td>
                      <strong>{c.value || '(aucune)'}</strong>
                    </td>
                    <td className="muted small">{plural(c.count, 'événement')}</td>
                    <td>
                      →{' '}
                      <input
                        className="input"
                        list="ag-import-categories"
                        value={mapping[c.value] ?? ''}
                        aria-label={`Catégorie de l’Agenda pour « ${c.value || 'aucune'} »`}
                        placeholder={defaultCategory || name || 'Catégorie'}
                        onChange={(e) => {
                          setMapping({ ...mapping, [c.value]: e.target.value });
                          setPreview(null);
                        }}
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2} className="small">
                    Pour le reste
                  </td>
                  <td>
                    →{' '}
                    <input
                      className="input"
                      list="ag-import-categories"
                      value={defaultCategory}
                      aria-label="Catégorie pour le reste"
                      placeholder={name || 'Catégorie'}
                      onChange={(e) => {
                        setDefaultCategory(e.target.value);
                        setPreview(null);
                      }}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </fieldset>

          <fieldset className="ag-import__group">
            <legend>La période</legend>
            <label className="ag-check">
              <input
                type="radio"
                checked={period === 'future'}
                onChange={() => {
                  setPeriod('future');
                  setPreview(null);
                }}
              />{' '}
              À partir d’aujourd’hui (le passé est ignoré)
            </label>
            <label className="ag-check">
              <input
                type="radio"
                checked={period === 'all'}
                onChange={() => {
                  setPeriod('all');
                  setPreview(null);
                }}
              />{' '}
              Tout, le passé compris
            </label>
          </fieldset>

          {analysis.codes && (
            <fieldset className="ag-import__group">
              <legend>Le titre</legend>
              <label className="ag-check">
                <input
                  type="radio"
                  checked={titleStyle === 'short'}
                  onChange={() => {
                    setTitleStyle('short');
                    setPreview(null);
                  }}
                />{' '}
                Sans le code : « Thermo »
              </label>
              <label className="ag-check">
                <input
                  type="radio"
                  checked={titleStyle === 'code'}
                  onChange={() => {
                    setTitleStyle('code');
                    setPreview(null);
                  }}
                />{' '}
                Avec le code : « TH2C · Thermo »
              </label>
            </fieldset>
          )}
          <div className="ui-actions">
            <Button
              disabled={busy || !tableReady || (target === NEW && !name.trim())}
              onClick={() => void showPreview()}
            >
              Voir l’aperçu
            </Button>
            {!tableReady && (
              <span className="small muted">Choisis la colonne du titre et celle de la date.</span>
            )}
          </div>
        </Card>
      )}

      {preview && (
        <Card title="3. L’aperçu (rien n’est encore écrit)">
          <p>
            {[
              `${preview.add.length} à ajouter`,
              `${preview.same} identique${preview.same > 1 ? 's' : ''}`,
              `${preview.modified.length} modifié${preview.modified.length > 1 ? 's' : ''}`,
              `${preview.gone.length} disparu${preview.gone.length > 1 ? 's' : ''}`,
              `${preview.ignored.length} ignoré${preview.ignored.length > 1 ? 's' : ''}`,
              plural(preview.errors.length, 'erreur'),
            ].join(' · ')}
          </p>
          {preview.add.length > 0 && (
            <details className="ag-import__section" open>
              <summary>À ajouter ({preview.add.length})</summary>
              <Checklist
                lines={preview.add}
                checked={accept}
                onChange={setAccept}
                today={today}
                extra={(l) =>
                  l.deletedBefore && (
                    <span className="badge badge--warning"> supprimé ici avant : décoché</span>
                  )
                }
              />
            </details>
          )}
          {preview.modified.length > 0 && (
            <details className="ag-import__section" open>
              <summary>Modifiés dans le fichier ({preview.modified.length})</summary>
              <Checklist
                lines={preview.modified}
                checked={accept}
                onChange={setAccept}
                today={today}
                extra={(l) => (
                  <>
                    {l.mine && (
                      <span
                        className="badge badge--warning"
                        title="Tu as changé cet événement depuis le dernier import : décoché, tes changements sont gardés."
                      >
                        {' '}
                        modifié par toi
                      </span>
                    )}
                    <ul className="ag-import__changes small">
                      {l.changes.map((c) => (
                        <li key={c.field}>
                          {c.label} : <s>{c.before ?? 'vide'}</s> → {c.after ?? 'vide'}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              />
            </details>
          )}
          {preview.gone.length > 0 && (
            <details className="ag-import__section" open>
              <summary>Disparus du fichier ({preview.gone.length})</summary>
              <p className="small muted">
                Ils ne sont plus dans le fichier. Rien n’est supprimé sans ta coche : coché,
                l’événement est supprimé (restaurable).
              </p>
              <Checklist
                lines={preview.gone}
                checked={remove}
                onChange={setRemove}
                today={today}
                extra={(l) =>
                  l.mine && <span className="badge badge--warning"> modifié par toi</span>
                }
              />
            </details>
          )}
          {preview.ignored.length > 0 && (
            <details className="ag-import__section">
              <summary>Ignorés : passés ({preview.ignored.length})</summary>
              <ul className="ag-import__list small">
                {preview.ignored.slice(0, 300).map((l) => (
                  <li key={l.key}>
                    <LineText line={l} today={today} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.errors.length > 0 && (
            <details className="ag-import__section" open>
              <summary>Erreurs ({preview.errors.length}) : rien n’est importé pour elles</summary>
              <ul className="ag-import__list small">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    Ligne {e.line} : {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="ui-actions">
            <Button disabled={busy || changes === 0} onClick={() => void apply()}>
              {changes === 0 ? 'Rien à écrire' : `Importer (${plural(changes, 'changement')})`}
            </Button>
            {changes > 0 && <span className="small muted">Une sauvegarde est faite avant.</span>}
          </div>
        </Card>
      )}

      {done && (
        <Card title="Import terminé">
          <p>
            {done.source && <>« {done.source.name} » : </>}
            {plural(done.added, 'ajouté')}, {plural(done.updated, 'mis à jour', 'mis à jour')},{' '}
            {plural(done.removed, 'supprimé')} (restaurables), {done.same} identiques.
            {done.left.add + done.left.modified + done.left.gone > 0 &&
              ` Laissés tels quels : ${done.left.add + done.left.modified + done.left.gone}.`}
          </p>
          {done.backup && <p className="small muted">Sauvegarde : {done.backup}</p>}
          <div className="ui-actions">
            <Link className="button" to="/m/agenda">
              Voir l’agenda
            </Link>
          </div>
        </Card>
      )}
      {undo && (
        <UndoToast
          message="Import terminé : tu peux encore l’annuler"
          timeoutMs={20_000}
          onUndo={() => {
            const id = undo;
            setUndo(null);
            void module.api.post('/import/undo', { importId: id }).then(
              () => {
                setDone(null);
                setError(null);
                setInfo('Import annulé : l’agenda est revenu à son état d’avant.');
              },
              (e: unknown) => setError(errorMessage(e)),
            );
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
    </Page>
  );
}
