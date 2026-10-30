// The Boîte à idées: note an idea in a second (title, then text, tags, track
// if wanted), find it again (search without accents, several tags, sort),
// draw one at random, archive, delete with « Annuler », turn it into a task of
// the To-do, manage the tags (rename, merge, colour). Home card optional.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  confirmDelete,
  defineFrontendModule,
  EmptyState,
  ErrorMessage,
  errorMessage,
  Page,
  StateBadge,
  UndoToast,
  useApi,
  useModule,
  Icon,
} from '@hub/sdk/frontend';
import {
  cleanTags,
  formatText,
  type IdeaDto,
  type IdeaSort,
  type IdeasResponse,
  type Inline,
  type TagDto,
} from '../shared';
import './ideas.css';

const SORTS: { id: IdeaSort; label: string }[] = [
  { id: 'recent', label: 'Récentes d’abord' },
  { id: 'old', label: 'Anciennes d’abord' },
  { id: 'modified', label: 'Modifiées récemment' },
];

const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Text with the simple formatting: bold, italic, lists, links (never HTML). */
function Formatted(props: { text: string }) {
  const inline = (parts: Inline[]) =>
    parts.map((p, i) =>
      p.kind === 'bold' ? (
        <strong key={i}>{p.text}</strong>
      ) : p.kind === 'italic' ? (
        <em key={i}>{p.text}</em>
      ) : p.kind === 'link' ? (
        <a key={i} href={p.url} target="_blank" rel="noreferrer">
          {p.text}
        </a>
      ) : (
        <span key={i}>{p.text}</span>
      ),
    );
  return (
    <div className="ib-text">
      {formatText(props.text).map((b, i) =>
        b.kind === 'list' ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.parts)}</p>
        ),
      )}
    </div>
  );
}

function TagChip(props: {
  tag: string;
  color: number;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const className = `ib-tag ib-tag--c${props.color}${props.active ? ' ib-tag--active' : ''}`;
  if (!props.onClick) return <span className={className}>#{props.tag}</span>;
  return (
    <button type="button" className={className} aria-pressed={props.active} onClick={props.onClick}>
      #{props.tag}
      {props.children}
    </button>
  );
}

/** Tags of an idea: typed (Entrée or comma adds one), with the existing ones suggested. */
function TagInput(props: { value: string[]; onChange: (tags: string[]) => void; known: TagDto[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const next = cleanTags([...props.value, ...raw.split(',')]);
    props.onChange(next);
    setText('');
  };
  const wanted = text.trim().replace(/^#/, '').toLowerCase();
  const suggestions = props.known
    .filter((t) => !props.value.includes(t.name) && (!wanted || t.name.includes(wanted)))
    .slice(0, 8);
  return (
    <div className="ib-tags-input">
      <div className="ib-tags">
        {props.value.map((t) => (
          <span key={t} className="ib-tag ib-tag--c0">
            #{t}
            <button
              type="button"
              className="ib-tag__remove"
              aria-label={`Retirer le tag ${t}`}
              onClick={() => props.onChange(props.value.filter((x) => x !== t))}
            >
              <Icon name="close" />
            </button>
          </span>
        ))}
        <input
          className="input input--short"
          value={text}
          placeholder="#tag"
          aria-label="Ajouter un tag"
          onChange={(e) => {
            if (e.target.value.endsWith(',')) add(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && props.value.length)
              props.onChange(props.value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="ib-suggest" aria-label="Tags existants">
          {suggestions.map((t) => (
            <TagChip key={t.name} tag={t.name} color={t.color} onClick={() => add(t.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Draft {
  title: string;
  body: string;
  tags: string[];
  trackId: number | null;
}

/** The form of an idea (new or edited). */
function IdeaForm(props: {
  initial: Draft;
  data: IdeasResponse;
  submitLabel: string;
  compact?: boolean;
  onSubmit: (draft: Draft) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const [more, setMore] = useState(!props.compact);
  const submit = async () => {
    if (!draft.title.trim()) return;
    if (await props.onSubmit(draft)) {
      setDraft({ title: '', body: '', tags: [], trackId: null });
      if (props.compact) setMore(false);
    }
  };
  return (
    <form
      className="ib-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="ib-row">
        <input
          className="input ib-form__title"
          value={draft.title}
          placeholder="Une idée, en quelques mots…"
          aria-label="Titre de l’idée"
          maxLength={160}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <Button type="submit" disabled={!draft.title.trim()}>
          {props.submitLabel}
        </Button>
        {props.compact && (
          <Button variant="secondary" type="button" onClick={() => setMore(!more)}>
            {more ? 'Moins' : 'Texte, tags…'}
          </Button>
        )}
        {props.onCancel && (
          <Button variant="secondary" type="button" onClick={props.onCancel}>
            Annuler
          </Button>
        )}
      </div>
      {more && (
        <>
          <textarea
            className="input ib-form__body"
            value={draft.body}
            rows={5}
            placeholder="Texte libre (facultatif) : **gras**, *italique*, « - » pour une liste, liens https://…"
            aria-label="Texte de l’idée"
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div className="ib-row">
            <TagInput
              value={draft.tags}
              known={props.data.tags}
              onChange={(tags) => setDraft({ ...draft, tags })}
            />
            {props.data.library && (
              <label className="small">
                Morceau{' '}
                <select
                  className="input input--short"
                  value={draft.trackId ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, trackId: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">aucun</option>
                  {props.data.tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </>
      )}
    </form>
  );
}

function IdeaCard(props: {
  idea: IdeaDto;
  data: IdeasResponse;
  colors: Map<string, number>;
  highlight?: boolean;
  onTag: (tag: string) => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onDeleted: (idea: IdeaDto) => void;
}) {
  const module = useModule();
  const { idea } = props;
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li className="ib-idea ib-idea--editing">
        <IdeaForm
          data={props.data}
          initial={{
            title: idea.title,
            body: idea.body,
            tags: idea.tags,
            trackId: idea.track?.id ?? null,
          }}
          submitLabel="Enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            const ok = await props.run(() => module.api.patch(`/ideas/${idea.id}`, draft));
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  return (
    <li className={`ib-idea${props.highlight ? ' ib-idea--random' : ''}`}>
      <div className="ib-idea__head">
        <h3>{idea.title}</h3>
        {idea.task && <StateBadge tone="success">devenue une tâche</StateBadge>}
        {idea.archived && <StateBadge tone="neutral">archivée</StateBadge>}
      </div>
      {idea.body && <Formatted text={idea.body} />}
      <div className="ib-meta small muted">
        {idea.tags.map((t) => (
          <TagChip
            key={t}
            tag={t}
            color={props.colors.get(t) ?? 0}
            onClick={() => props.onTag(t)}
          />
        ))}
        <span>créée le {dateFr(idea.createdAt)}</span>
        {idea.updatedAt !== idea.createdAt && <span>· modifiée le {dateFr(idea.updatedAt)}</span>}
        {idea.track && (
          <span>
            · <Icon name="music" /> {idea.track.title}
          </span>
        )}
        {idea.task && (
          <span>
            · tâche « {idea.task.title} »{' '}
            <Link to="/m/todo" className="small">
              Voir la To-do
            </Link>
          </span>
        )}
      </div>
      <div className="ui-actions">
        <Button variant="secondary" small onClick={() => setEditing(true)}>
          Modifier
        </Button>
        {props.data.todo && !idea.task && (
          <Button
            variant="secondary"
            small
            onClick={() => void props.run(() => module.api.post(`/ideas/${idea.id}/to-task`))}
          >
            Transformer en tâche
          </Button>
        )}
        <Button
          variant="secondary"
          small
          onClick={() =>
            void props.run(() =>
              module.api.patch(`/ideas/${idea.id}`, { archived: !idea.archived }),
            )
          }
        >
          {idea.archived ? 'Désarchiver' : 'Archiver'}
        </Button>
        <Button
          variant="danger"
          small
          onClick={() => {
            if (!confirmDelete(`l’idée « ${idea.title} »`)) return;
            void props
              .run(() => module.api.delete(`/ideas/${idea.id}`))
              .then((ok) => ok && props.onDeleted(idea));
          }}
        >
          Supprimer
        </Button>
      </div>
    </li>
  );
}

/** Tags: number of ideas, colour, rename (into an existing tag = merge). */
function TagManager(props: {
  tags: TagDto[];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const module = useModule();
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  if (!props.tags.length) return <p className="small muted">Aucun tag pour l’instant.</p>;
  const put = (name: string, body: object) =>
    props.run(() => module.api.put(`/tags/${encodeURIComponent(name)}`, body));
  return (
    <ul className="ib-manage">
      {props.tags.map((t) => (
        <li key={t.name}>
          <TagChip tag={t.name} color={t.color} />
          <span className="small muted num">
            {t.count} idée{t.count > 1 ? 's' : ''}
          </span>
          <span className="ib-swatches" role="group" aria-label={`Couleur de #${t.name}`}>
            {Array.from({ length: 9 }, (_, c) => (
              <button
                key={c}
                type="button"
                className={`ib-swatch ib-tag--c${c}${t.color === c ? ' ib-swatch--on' : ''}`}
                aria-label={c === 0 ? 'Sans couleur' : `Couleur ${c}`}
                aria-pressed={t.color === c}
                onClick={() => void put(t.name, { color: c })}
              />
            ))}
          </span>
          {renaming?.from === t.name ? (
            <form
              className="ib-row"
              onSubmit={(e) => {
                e.preventDefault();
                const to = cleanTags([renaming.to])[0];
                if (!to || to === t.name) return setRenaming(null);
                const existing = props.tags.find((x) => x.name === to);
                if (
                  existing &&
                  !window.confirm(
                    `#${to} existe déjà : fusionner #${t.name} (${t.count}) dans #${to} (${existing.count}) ?`,
                  )
                )
                  return;
                void put(t.name, { name: to }).then(() => setRenaming(null));
              }}
            >
              <input
                className="input input--short"
                autoFocus
                value={renaming.to}
                aria-label="Nouveau nom du tag"
                onChange={(e) => setRenaming({ from: t.name, to: e.target.value })}
              />
              <Button small type="submit">
                OK
              </Button>
              <Button variant="secondary" small type="button" onClick={() => setRenaming(null)}>
                Annuler
              </Button>
            </form>
          ) : (
            <Button
              variant="secondary"
              small
              onClick={() => setRenaming({ from: t.name, to: t.name })}
            >
              Renommer ou fusionner
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function IdeasPage() {
  const module = useModule();
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<IdeaSort>('recent');
  const [archived, setArchived] = useState(false);
  const [managing, setManaging] = useState(false);
  const [random, setRandom] = useState<IdeaDto | null | 'none'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<IdeaDto | null>(null);
  const query = new URLSearchParams({
    q,
    tags: tags.join(','),
    sort,
    archived: archived ? '1' : '0',
  }).toString();
  const state = useApi<IdeasResponse>(module.url(`/ideas?${query}`));
  const data = state.data;
  const colors = useMemo(() => new Map((data?.tags ?? []).map((t) => [t.name, t.color])), [data]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      state.reload();
    }
  };
  const toggleTag = (tag: string) =>
    setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);
  const pick = async () => {
    setError(null);
    try {
      const { idea } = await module.api.get<{ idea: IdeaDto | null }>(
        `/random?tags=${encodeURIComponent(tags.join(','))}`,
      );
      setRandom(idea ?? 'none');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const exportMd = async () => {
    setNotice(null);
    await run(async () => {
      const r = await module.api.post<{ path?: string; count?: number }>('/export', {
        archives: true,
      });
      setNotice(
        r.path
          ? `${r.count} idée(s) exportée(s) : ${r.path}`
          : 'Export annulé : rien n’a été enregistré.',
      );
    });
  };

  return (
    <Page
      title="Boîte à idées"
      subtitle="Note une idée en une seconde, retrouve-la quand tu en as besoin."
      actions={
        <>
          <Button variant="secondary" onClick={() => setManaging(!managing)}>
            Tags…
          </Button>
          <Button variant="secondary" onClick={() => void exportMd()}>
            Exporter en Markdown…
          </Button>
        </>
      }
    >
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {notice && <p className="small muted">{notice}</p>}
      {data && (
        <>
          <Card>
            <IdeaForm
              compact
              data={data}
              initial={{ title: '', body: '', tags: [], trackId: null }}
              submitLabel="Noter"
              onSubmit={(draft) => run(() => module.api.post('/ideas', draft))}
            />
          </Card>
          {managing && (
            <Card title="Tags">
              <TagManager tags={data.tags} run={run} />
            </Card>
          )}
          <div className="ib-toolbar">
            <input
              className="input ib-search"
              type="search"
              value={q}
              placeholder="Rechercher (titre, texte, tags ; accents ignorés)"
              aria-label="Rechercher"
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="input ib-sort"
              value={sort}
              aria-label="Tri"
              onChange={(e) => setSort(e.target.value as IdeaSort)}
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => void pick()} disabled={archived}>
              Une idée au hasard{tags.length ? ` (${tags.map((t) => `#${t}`).join(' ')})` : ''}
            </Button>
            <Button
              variant="secondary"
              aria-pressed={archived}
              onClick={() => {
                setArchived(!archived);
                setRandom(null);
              }}
            >
              {archived ? (
                <>
                  <Icon name="arrow-left" /> Idées ({data.counts.active})
                </>
              ) : (
                `Archives (${data.counts.archived})`
              )}
            </Button>
          </div>
          {data.tags.length > 0 && (
            <div className="ib-tags" aria-label="Filtrer par tags">
              {data.tags.map((t) => (
                <TagChip
                  key={t.name}
                  tag={t.name}
                  color={t.color}
                  active={tags.includes(t.name)}
                  onClick={() => toggleTag(t.name)}
                >
                  <span className="ib-tag__count">{t.count}</span>
                </TagChip>
              ))}
              {tags.length > 0 && (
                <button type="button" className="ib-link small" onClick={() => setTags([])}>
                  Tous les tags
                </button>
              )}
            </div>
          )}
          {random === 'none' && (
            <p className="small muted">Aucune idée {tags.length ? 'avec ces tags ' : ''}à tirer.</p>
          )}
          {random && random !== 'none' && (
            <div className="ib-row small muted">
              Tirée au hasard{tags.length ? ` parmi ${tags.map((t) => `#${t}`).join(' ')}` : ''}
              <button type="button" className="ib-link" onClick={() => setRandom(null)}>
                Fermer
              </button>
            </div>
          )}
          {random && random !== 'none' && (
            <ul className="ib-list">
              <IdeaCard
                idea={random}
                data={data}
                colors={colors}
                highlight
                onTag={toggleTag}
                run={run}
                onDeleted={(idea) => {
                  setRandom(null);
                  setUndo(idea);
                }}
              />
            </ul>
          )}
          {data.ideas.length === 0 ? (
            <EmptyState
              title={
                archived
                  ? 'Aucune idée archivée.'
                  : q || tags.length
                    ? 'Aucune idée ne correspond.'
                    : 'Aucune idée pour l’instant.'
              }
            >
              {!archived &&
                !q &&
                !tags.length &&
                'Note la première ci-dessus, ou dis « idée : … » à l’assistant.'}
            </EmptyState>
          ) : (
            <>
              <p className="small muted">
                {data.ideas.length} idée{data.ideas.length > 1 ? 's' : ''}
                {archived ? ' archivée(s)' : ''}
              </p>
              <ul className="ib-list">
                {data.ideas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    data={data}
                    colors={colors}
                    onTag={toggleTag}
                    run={run}
                    onDeleted={setUndo}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {undo && (
        <UndoToast
          message={`Idée supprimée : « ${undo.title} »`}
          onUndo={() => void run(() => module.api.post(`/ideas/${undo.id}/restore`))}
          onDismiss={() => setUndo(null)}
        />
      )}
    </Page>
  );
}

/** Home card (setting « Carte d'accueil »): how many ideas, the latest ones. */
function HomeWidget() {
  const module = useModule();
  const { data } = useApi<{
    show: boolean;
    count: number;
    latest: { id: number; title: string }[];
  }>(module.url('/home'));
  if (!data?.show) return null;
  if (data.count === 0) return <p className="small muted">Aucune idée notée.</p>;
  return (
    <div className="small">
      <p>
        <strong className="num">{data.count}</strong> idée{data.count > 1 ? 's' : ''}
      </p>
      <ul className="ib-home">
        {data.latest.map((i) => (
          <li key={i.id}>{i.title}</li>
        ))}
      </ul>
    </div>
  );
}

export default defineFrontendModule({
  pages: [{ path: '', component: IdeasPage }],
  HomeWidget,
});
