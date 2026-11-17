// v0.37.0 (Expérimental): Réglages › Agenda › Sources. Each imported
// calendar: its name, its categories, its number of events, its last import;
// rename it, change its mapping (applied to its events, except those whose
// category was changed by hand), re-import it, delete it (after a
// confirmation: it and its events become tombstones, « Annuler » brings
// them back).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, ErrorMessage, errorMessage, UndoToast, useModule } from '@hub/sdk/frontend';
import type { AgendaSourceDto } from '../shared/types';

const FORMATS: Record<string, string> = { ics: 'ICS', csv: 'CSV', xlsx: 'Excel' };

function when(iso: string | null): string {
  if (!iso) return 'jamais';
  const d = new Date(iso);
  return d.toLocaleString('fr-BE', { dateStyle: 'medium', timeStyle: 'short' });
}

function SourceRow(props: {
  source: AgendaSourceDto;
  onChanged: () => void;
  onDeleted: (s: AgendaSourceDto) => void;
}) {
  const module = useModule();
  const s = props.source;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [mapping, setMapping] = useState<Record<string, string>>(s.mapping);
  const [defaultCategory, setDefaultCategory] = useState(s.defaultCategory);
  const [error, setError] = useState<string | null>(null);
  const values = Object.keys(s.mapping);

  const save = async () => {
    setError(null);
    try {
      await module.api.patch(`/sources/${s.id}`, {
        ...(name.trim() !== s.name ? { name: name.trim() } : {}),
        mapping,
        defaultCategory,
      });
      setEditing(false);
      props.onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <li className="list__item list__item--top ag-sources__item">
      <div>
        <strong>{s.name}</strong>{' '}
        <span className="muted small">
          {FORMATS[s.format] ?? s.format} · {s.events} événement{s.events > 1 ? 's' : ''} · dernier
          import : {when(s.lastImportAt)}
        </span>
        <p className="small">
          Catégories : {s.categories.length ? s.categories.join(', ') : 'aucune'}
          {values.length > 0 && (
            <span className="muted">
              {' '}
              ({values.map((v) => `${v || '(aucune)'} → ${s.mapping[v]}`).join(' ; ')} ; le reste →{' '}
              {s.defaultCategory})
            </span>
          )}
        </p>
        {editing && (
          <div className="ag-form">
            <label className="small">
              Nom
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {values.map((v) => (
              <label key={v} className="small">
                {v || '(aucune)'} →
                <input
                  className="input"
                  value={mapping[v] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [v]: e.target.value })}
                />
              </label>
            ))}
            <label className="small">
              Le reste →
              <input
                className="input"
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
              />
            </label>
            <p className="small muted">
              Le changement s’applique aux événements de la source, sauf à ceux dont tu as changé la
              catégorie à la main.
            </p>
            <div className="ui-actions">
              <Button small onClick={() => void save()}>
                Enregistrer
              </Button>
              <Button small variant="secondary" onClick={() => setEditing(false)}>
                Fermer
              </Button>
            </div>
          </div>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
      <div className="ui-actions">
        {!editing && (
          <Button small variant="secondary" onClick={() => setEditing(true)}>
            Renommer / catégories
          </Button>
        )}
        <Link
          className="button button--secondary button--small"
          to={`/m/agenda/import?source=${s.id}`}
        >
          Réimporter
        </Link>
        {s.format === 'ics' && (
          <Link
            className="button button--secondary button--small"
            to={`/m/agenda/import?recompute=${s.id}`}
            title="Les titres refaits à partir du texte gardé à l’import (ligne « Act: »…), sans le fichier : aperçu d’abord, rien n’est écrit avant « Appliquer »."
          >
            Recalculer les titres
          </Link>
        )}
        <Button
          small
          variant="danger"
          onClick={() => {
            if (
              !window.confirm(
                `Supprimer la source « ${s.name} » et ses ${s.events} événement(s) de l’agenda ? Ils restent restaurables.`,
              )
            )
              return;
            void module.api.delete(`/sources/${s.id}`).then(
              () => props.onDeleted(s),
              (e: unknown) => setError(errorMessage(e)),
            );
          }}
        >
          Supprimer
        </Button>
      </div>
    </li>
  );
}

export function SourcesPanel() {
  const module = useModule();
  const [sources, setSources] = useState<AgendaSourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<AgendaSourceDto | null>(null);
  const load = useCallback(() => {
    void module.api
      .get<AgendaSourceDto[]>('/sources')
      .then(setSources, (e: unknown) => setError(errorMessage(e)));
  }, [module.api]);
  useEffect(load, [load]);

  return (
    <div className="ag-sources">
      <h3>
        Sources (calendriers importés){' '}
        <span className="badge badge--warning" title="Pas encore validé à l’usage">
          Expérimental
        </span>
      </h3>
      <p className="small muted">
        Un horaire importé (ICS, CSV, Excel) est une source : ses événements sont des événements
        ordinaires de l’Agenda, rangés dans les catégories que tu as choisies. Un nouvel import de
        la même source met à jour, sans doublon. L’import se fait sur le PC ; le téléphone reçoit
        les événements par la synchro.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {sources && sources.length === 0 && <p className="muted">Aucune source pour l’instant.</p>}
      {sources && sources.length > 0 && (
        <ul className="list">
          {sources.map((s) => (
            <SourceRow
              key={`${s.id}-${s.lastImportAt}-${s.name}`}
              source={s}
              onChanged={load}
              onDeleted={(x) => {
                setDeleted(x);
                load();
              }}
            />
          ))}
        </ul>
      )}
      <p>
        <Link to="/m/agenda/import">Importer un calendrier</Link>
      </p>
      {deleted && (
        <UndoToast
          message={`Source « ${deleted.name} » supprimée`}
          timeoutMs={15_000}
          onUndo={() => {
            void module.api
              .post(`/sources/${deleted.id}/restore`)
              .then(load, (e: unknown) => setError(errorMessage(e)));
          }}
          onDismiss={() => setDeleted(null)}
        />
      )}
    </div>
  );
}
