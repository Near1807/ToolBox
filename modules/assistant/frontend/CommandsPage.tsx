// « Commandes » : what the assistant understands without AI. Commands grouped
// by module, their phrases (the module's and Thomas's), parameters, risk and
// state; edit the phrases, test a phrase, export / import the dictionary, and
// the rights of the assistant. Only phrases change here, never an action.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  Page,
  StateBadge,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import type { CommandDto, CommandsDto, ConflictDto, RightDto, TestDto } from '../shared';

export const RISK_LABELS: Record<CommandDto['risk'], string> = {
  read: 'lecture',
  change: 'modification',
  destructive: 'suppression (avec « oui »)',
  sensitive: 'sensible',
};

const percent = (score: number | null | undefined) =>
  score === null || score === undefined ? '—' : `${Math.round(score * 100)} %`;

/** « Enregistrer quand même ? » naming both commands. */
export function confirmConflict(target: string, conflicts: ConflictDto[]): boolean {
  const list = conflicts
    .map((c) => `• ${c.moduleName} — ${c.description} (${percent(c.score)}, « ${c.phrase} »)`)
    .join('\n');
  return window.confirm(
    `Cette phrase pour « ${target} » est très proche d’une autre commande :\n${list}\n\nL’assistant pourrait les confondre (ou n’en reconnaître aucune). Enregistrer quand même ?`,
  );
}

/**
 * Saves a phrase with the conflict check: too close to another command, it
 * is saved only after Thomas confirms. Returns true when saved.
 */
export async function savePhrase(
  save: (force: boolean) => Promise<{ saved: boolean; conflicts: ConflictDto[] }>,
  target: string,
): Promise<boolean> {
  const first = await save(false);
  if (first.saved) return true;
  if (!confirmConflict(target, first.conflicts)) return false;
  return (await save(true)).saved;
}

export function RightsCard(props: { rights: RightDto[]; onChange: () => void }) {
  const module = useModule();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Droits de l’assistant">
      <p className="small muted">
        L’assistant est en lecture seule par défaut. Chaque modification a son propre interrupteur,
        à activer toi-même après essai. Même activée, une suppression attend toujours un « oui ».
      </p>
      {props.rights.length === 0 ? (
        <p className="small muted">Aucune action de modification déclarée.</p>
      ) : (
        <ul className="as-rights">
          {props.rights.map((right) => (
            <li key={right.id}>
              <label className="as-inline">
                <input
                  type="checkbox"
                  checked={right.granted}
                  onChange={(e) =>
                    void module.api
                      .put(`/rights/${encodeURIComponent(right.id)}`, { granted: e.target.checked })
                      .then(props.onChange)
                      .catch((err: unknown) => setError(errorMessage(err)))
                  }
                />{' '}
                {right.label}
              </label>
              <span className="small faint"> · {right.moduleName}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Card>
  );
}

function TestPhrase() {
  const module = useModule();
  const [text, setText] = useState('');
  const [result, setResult] = useState<TestDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const test = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setResult(await module.api.post<TestDto>('/commands/test', { text }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const verdict: Record<TestDto['verdict'], string> = {
    recognised: 'reconnue',
    'low-score': 'pas reconnue : score trop bas',
    ambiguous: 'pas reconnue : deux commandes trop proches',
    'missing-params': 'pas reconnue : paramètre obligatoire manquant',
    empty: 'rien à reconnaître',
  };
  return (
    <Card title="Tester une phrase">
      <form className="as-row" onSubmit={(e) => void test(e)}>
        <input
          className="input"
          value={text}
          placeholder="ex. « ajoute une tâche appeler le studio demain »"
          onChange={(e) => setText(e.target.value)}
          aria-label="Phrase à tester"
        />
        <Button type="submit" disabled={!text.trim()}>
          Tester
        </Button>
      </form>
      <p className="small faint">Rien n’est exécuté.</p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {result && (
        <div className="as-test small">
          <p>
            <StateBadge tone={result.verdict === 'recognised' ? 'success' : 'warning'}>
              {verdict[result.verdict]}
            </StateBadge>{' '}
            {result.best && (
              <>
                <strong>
                  {result.best.moduleName} — {result.best.description}
                </strong>{' '}
                · score {percent(result.best.score)} (seuil {percent(result.settings.threshold)})
              </>
            )}
          </p>
          {result.best && (
            <p>
              Écart avec la 2e commande : {percent(result.gap)} (minimum{' '}
              {percent(result.settings.margin)})
              {result.second && (
                <span className="muted">
                  {' '}
                  · 2e : {result.second.moduleName} — {result.second.description} (
                  {percent(result.second.score)})
                </span>
              )}
            </p>
          )}
          {result.best && <p className="muted">Phrase la plus proche : « {result.best.phrase} »</p>}
          <p>
            Paramètres trouvés :{' '}
            {result.params && Object.keys(result.params).length > 0 ? (
              <code>{JSON.stringify(result.params)}</code>
            ) : (
              <span className="muted">aucun</span>
            )}
          </p>
          <p className="faint">
            {result.semantic ? 'Sens et mots' : 'Mots seuls (modèle des commandes non installé)'} ·{' '}
            {result.ms} ms
          </p>
        </div>
      )}
    </Card>
  );
}

function PhraseLine(props: {
  command: CommandDto;
  phrase: CommandDto['phrases'][number];
  onChange: () => void;
  setError: (e: string | null) => void;
}) {
  const module = useModule();
  const { command, phrase } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(phrase.text);
  const act = (run: () => Promise<unknown>) =>
    void run()
      .then(() => {
        props.setError(null);
        props.onChange();
      })
      .catch((e: unknown) => props.setError(errorMessage(e)));

  if (phrase.source === 'module')
    return (
      <li className={phrase.hidden ? 'as-phrase as-phrase--hidden' : 'as-phrase'}>
        <span>« {phrase.text} »</span>
        <span className="small faint">module{phrase.hidden ? ' · masquée' : ''}</span>
        <Button
          variant="secondary"
          small
          onClick={() =>
            act(() =>
              module.api.put(`/commands/${encodeURIComponent(command.id)}/hidden`, {
                text: phrase.text,
                hidden: !phrase.hidden,
              }),
            )
          }
        >
          {phrase.hidden ? 'Afficher' : 'Masquer'}
        </Button>
      </li>
    );

  return (
    <li className="as-phrase">
      {editing ? (
        <form
          className="as-row"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const saved = await savePhrase(
                (force) => module.api.put(`/commands/phrases/${phrase.id}`, { text, force }),
                command.description,
              );
              if (saved) setEditing(false);
            });
          }}
        >
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Phrase"
          />
          <Button type="submit" small disabled={!text.trim()}>
            Enregistrer
          </Button>
          <Button variant="secondary" small onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </form>
      ) : (
        <>
          <span>« {phrase.text} »</span>
          <span className="small faint">la tienne</span>
          <Button variant="secondary" small onClick={() => setEditing(true)}>
            Modifier
          </Button>
          <Button
            variant="secondary"
            small
            onClick={() => {
              if (window.confirm(`Supprimer ta phrase « ${phrase.text} » ?`))
                act(() => module.api.delete(`/commands/phrases/${phrase.id}`));
            }}
          >
            Supprimer
          </Button>
        </>
      )}
    </li>
  );
}

function CommandCard(props: { command: CommandDto; onChange: () => void }) {
  const module = useModule();
  const { command } = props;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const own = command.phrases.filter((p) => p.source === 'user').length;
  const hidden = command.phrases.filter((p) => p.hidden).length;
  const add = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const saved = await savePhrase(
        (force) =>
          module.api.post(`/commands/${encodeURIComponent(command.id)}/phrases`, { text, force }),
        command.description,
      );
      if (saved) setText('');
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
    props.onChange();
  };
  return (
    <div className="as-command">
      <div className="as-command__head">
        <strong>{command.description}</strong>
        <StateBadge tone={command.risk === 'read' ? 'neutral' : 'warning'}>
          {RISK_LABELS[command.risk]}
        </StateBadge>
        {command.available ? (
          <StateBadge tone="success">disponible</StateBadge>
        ) : (
          <StateBadge tone="neutral" title={command.right?.label}>
            désactivée (droit)
          </StateBadge>
        )}
        <code className="small faint">{command.id}</code>
      </div>
      {!command.available && command.right && (
        <p className="small muted">
          Il faut le droit « {command.right.label} » (case dans « Droits de l’assistant »
          ci-dessus).
        </p>
      )}
      {command.parameters.length > 0 && (
        <p className="small muted">
          Paramètres :{' '}
          {command.parameters.map((p, i) => (
            <span key={p.name}>
              {i > 0 && ' · '}
              <strong>{p.name}</strong>
              {p.required ? ' (obligatoire)' : ''} — {p.description}
            </span>
          ))}
        </p>
      )}
      <ul className="as-phrases">
        {command.phrases.map((phrase) => (
          <PhraseLine
            key={`${phrase.source}-${phrase.id ?? phrase.text}`}
            command={command}
            phrase={phrase}
            onChange={props.onChange}
            setError={setError}
          />
        ))}
      </ul>
      <form className="as-row" onSubmit={(e) => void add(e)}>
        <input
          className="input"
          value={text}
          placeholder="Ajouter ta phrase…"
          onChange={(e) => setText(e.target.value)}
          aria-label={`Nouvelle phrase pour ${command.description}`}
        />
        <Button type="submit" small disabled={!text.trim()}>
          Ajouter
        </Button>
        {(own > 0 || hidden > 0) && (
          <Button
            variant="secondary"
            small
            onClick={() => {
              if (
                window.confirm(
                  `Rétablir les phrases d’origine de « ${command.description} » ?\n\n${own} phrase(s) à toi supprimée(s), ${hidden} phrase(s) du module réaffichée(s).`,
                )
              )
                void module.api
                  .post(`/commands/${encodeURIComponent(command.id)}/restore`)
                  .then(props.onChange)
                  .catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            Rétablir les phrases d’origine
          </Button>
        )}
      </form>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}

const matches = (command: CommandDto, query: string) => {
  const q = query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (!q) return true;
  const hay = [
    command.moduleName,
    command.description,
    command.id,
    ...command.phrases.map((p) => p.text),
  ]
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
};

export function CommandsPage() {
  const module = useModule();
  const data = useApi<CommandsDto>(module.url('/commands'));
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { reload } = data;

  const groups = useMemo(() => {
    const byModule = new Map<string, CommandDto[]>();
    for (const command of data.data?.commands ?? []) {
      if (!matches(command, query)) continue;
      byModule.set(command.moduleName, [...(byModule.get(command.moduleName) ?? []), command]);
    }
    return [...byModule];
  }, [data.data, query]);

  const exportFile = async () => {
    setError(null);
    try {
      const file = await module.api.get<unknown>('/commands/export');
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `commandes-assistant-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const content = JSON.parse(await file.text()) as unknown;
      const result = await module.api.post<{ added: number; hidden: number; skipped: number }>(
        '/commands/import',
        { file: content },
      );
      setMessage(
        `Import : ${result.added} phrase(s) ajoutée(s), ${result.hidden} phrase(s) du module masquée(s)${result.skipped ? `, ${result.skipped} ignorée(s) (commande absente ou phrase invalide)` : ''}. Rien n’a été supprimé.`,
      );
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Ce fichier n’est pas un fichier JSON' : errorMessage(e));
    }
    if (fileInput.current) fileInput.current.value = '';
    reload();
  };
  const restoreAll = () => {
    if (
      !window.confirm(
        'Rétablir toutes les phrases d’origine ?\n\nToutes tes phrases sont supprimées et les phrases des modules réaffichées. Pense à exporter le dictionnaire avant si tu veux les garder.',
      )
    )
      return;
    void module.api
      .post<{ removed: number; shown: number }>('/commands/restore')
      .then((r) => setMessage(`${r.removed} phrase(s) supprimée(s), ${r.shown} réaffichée(s).`))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(reload);
  };

  return (
    <Page
      title="Commandes de l’assistant"
      subtitle="Ce que l’assistant comprend sans IA. Seules les phrases se modifient : jamais l’action, ses paramètres ni son niveau de risque."
      actions={
        <Link to={`/m/${module.id}`} className="small">
          ← Assistant vocal
        </Link>
      }
    >
      <div className="as-layout">
        <div className="as-stack">
          <Card
            title="Commandes"
            actions={
              <div className="as-row">
                <Button variant="secondary" small onClick={() => void exportFile()}>
                  Exporter
                </Button>
                <Button variant="secondary" small onClick={() => fileInput.current?.click()}>
                  Importer
                </Button>
                <Button variant="secondary" small onClick={restoreAll}>
                  Tout rétablir
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </div>
            }
          >
            <input
              className="input"
              value={query}
              placeholder="Chercher une commande ou une phrase…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Chercher"
            />
            {message && <p className="small as-notice">{message}</p>}
            {(error || data.error) && <ErrorMessage>{error ?? data.error}</ErrorMessage>}
            {data.data && (
              <p className="small faint">
                {data.data.commands.length} commandes ·{' '}
                {data.data.semantic
                  ? 'reconnaissance par le sens et les mots'
                  : 'reconnaissance par les mots seuls (installe le modèle des commandes sur la page de l’assistant pour comprendre plus de façons de dire)'}{' '}
                · seuil {percent(data.data.settings.threshold)}, écart{' '}
                {percent(data.data.settings.margin)}
              </p>
            )}
            {groups.map(([moduleName, commands]) => (
              <section key={moduleName} className="as-group">
                <h3>{moduleName}</h3>
                {commands.map((command) => (
                  <CommandCard key={command.id} command={command} onChange={reload} />
                ))}
              </section>
            ))}
            {data.data && groups.length === 0 && <p className="muted">Aucune commande trouvée.</p>}
          </Card>
        </div>
        <div className="as-stack">
          <TestPhrase />
          {data.data && <RightsCard rights={data.data.rights} onChange={reload} />}
        </div>
      </div>
    </Page>
  );
}
