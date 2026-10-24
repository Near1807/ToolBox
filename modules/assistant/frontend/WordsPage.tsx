// « Mots » : what the ear writes and what the assistant understands.
// Corrections (« quand l'oreille écrit X, comprendre Y »), the English words
// and names given to the speech recognition, and a test. Nicknames of the
// tools are on the Commands page, those of the tracks on their page.
import { useRef, useState, type FormEvent } from 'react';
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
import type { VocabularyDto } from '../shared';

function CorrectionRow(props: {
  correction: VocabularyDto['corrections'][number];
  onChange: (data: VocabularyDto) => void;
  setError: (error: string | null) => void;
}) {
  const module = useModule();
  const { correction } = props;
  const [editing, setEditing] = useState(false);
  const [heard, setHeard] = useState(correction.heard);
  const [replacement, setReplacement] = useState(correction.replacement);
  const call = (run: () => Promise<VocabularyDto>) =>
    void run()
      .then((data) => {
        props.setError(null);
        setEditing(false);
        props.onChange(data);
      })
      .catch((e: unknown) => props.setError(errorMessage(e)));
  if (editing)
    return (
      <tr>
        <td>
          <input
            className="input"
            value={heard}
            onChange={(e) => setHeard(e.target.value)}
            aria-label="L’oreille écrit"
          />
        </td>
        <td>
          <input
            className="input"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            aria-label="Comprendre"
          />
        </td>
        <td className="as-cell-actions">
          <Button
            small
            onClick={() =>
              call(() =>
                module.api.put<VocabularyDto>(`/vocabulary/corrections/${correction.id}`, {
                  heard,
                  replacement,
                }),
              )
            }
          >
            Enregistrer
          </Button>
          <Button variant="secondary" small onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </td>
      </tr>
    );
  return (
    <tr>
      <td>« {correction.heard} »</td>
      <td>« {correction.replacement} »</td>
      <td className="as-cell-actions">
        <Button variant="secondary" small onClick={() => setEditing(true)}>
          Modifier
        </Button>
        <Button
          variant="secondary"
          small
          onClick={() => {
            if (
              window.confirm(
                `Supprimer la correction « ${correction.heard} » → « ${correction.replacement} » ?`,
              )
            )
              call(() =>
                module.api.delete<VocabularyDto>(`/vocabulary/corrections/${correction.id}`),
              );
          }}
        >
          Supprimer
        </Button>
      </td>
    </tr>
  );
}

function TestText() {
  const module = useModule();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{
    corrected: string;
    changed: boolean;
    verdict: string;
    command: { description: string; score: number } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const test = (e: FormEvent) => {
    e.preventDefault();
    void module.api
      .post<NonNullable<typeof result>>('/vocabulary/test', { text })
      .then((r) => {
        setResult(r);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };
  return (
    <Card title="Tester">
      <form className="as-row" onSubmit={test}>
        <input
          className="input"
          value={text}
          placeholder="Ce que l’oreille a écrit, ex. « ouvre la tout doux »"
          onChange={(e) => setText(e.target.value)}
          aria-label="Texte à tester"
        />
        <Button type="submit" disabled={!text.trim()}>
          Tester
        </Button>
      </form>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {result && (
        <div className="small as-test">
          <p>
            Après corrections : « {result.corrected} »{' '}
            {!result.changed && <span className="muted">(aucune correction)</span>}
          </p>
          <p>
            <StateBadge tone={result.verdict === 'recognised' ? 'success' : 'warning'}>
              {result.verdict === 'recognised' ? 'commande reconnue' : 'pas reconnue'}
            </StateBadge>{' '}
            {result.command && (
              <>
                {result.command.description} · {Math.round(result.command.score * 100)} %
              </>
            )}
          </p>
          <p className="faint">Rien n’est exécuté.</p>
        </div>
      )}
    </Card>
  );
}

export function WordsPage() {
  const module = useModule();
  const state = useApi<VocabularyDto>(module.url('/vocabulary'));
  const [data, setData] = useState<VocabularyDto | null>(null);
  const [heard, setHeard] = useState('');
  const [replacement, setReplacement] = useState('');
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = data ?? state.data;

  const call = (run: () => Promise<VocabularyDto>, after?: () => void) =>
    void run()
      .then((next) => {
        setData(next);
        setError(null);
        after?.();
      })
      .catch((e: unknown) => setError(errorMessage(e)));

  const exportFile = async () => {
    const file = await module.api.get<unknown>('/commands/export');
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mots-et-commandes-assistant-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await module.api.post<{
        added: number;
        vocabulary: { corrections: number; words: number; nicknames: number };
      }>('/commands/import', { file: JSON.parse(await file.text()) as unknown });
      setMessage(
        `Import : ${result.vocabulary.corrections} correction(s), ${result.vocabulary.words} mot(s), ${result.vocabulary.nicknames} surnom(s) et ${result.added} phrase(s) ajoutés. Rien n’a été supprimé.`,
      );
      setData(null);
      state.reload();
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Ce fichier n’est pas un fichier JSON' : errorMessage(e));
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <Page
      title="Mots de l’assistant"
      subtitle="Ce que l’oreille écrit, et ce que l’assistant doit comprendre. La reconnaissance reste en français."
      actions={
        <div className="as-row">
          <Link to={module.path()} className="small">
            ← Assistant vocal
          </Link>
          <Link to={module.path('commands')} className="small">
            Commandes et surnoms des outils
          </Link>
        </div>
      }
    >
      {(error || state.error) && <ErrorMessage>{error ?? state.error}</ErrorMessage>}
      {message && <p className="small as-notice">{message}</p>}
      <div className="as-layout">
        <div className="as-stack">
          <Card
            title="Corrections"
            actions={
              <div className="as-row">
                <Button variant="secondary" small onClick={() => void exportFile()}>
                  Exporter
                </Button>
                <Button variant="secondary" small onClick={() => fileInput.current?.click()}>
                  Importer
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
            <p className="small muted">
              Appliquées juste après la transcription, avant la reconnaissance des commandes, sur
              des mots entiers seulement, sans tenir compte des majuscules ni des accents.
            </p>
            <table className="as-table">
              <thead>
                <tr>
                  <th>Quand l’oreille écrit</th>
                  <th>Comprendre</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown?.corrections.map((c) => (
                  <CorrectionRow key={c.id} correction={c} onChange={setData} setError={setError} />
                ))}
              </tbody>
            </table>
            <form
              className="as-row"
              onSubmit={(e) => {
                e.preventDefault();
                call(
                  () =>
                    module.api.post<VocabularyDto>('/vocabulary/corrections', {
                      heard,
                      replacement,
                    }),
                  () => {
                    setHeard('');
                    setReplacement('');
                  },
                );
              }}
            >
              <input
                className="input"
                value={heard}
                placeholder="L’oreille écrit… (ex. tout doux)"
                onChange={(e) => setHeard(e.target.value)}
                aria-label="L’oreille écrit"
              />
              <input
                className="input"
                value={replacement}
                placeholder="Comprendre… (ex. to-do)"
                onChange={(e) => setReplacement(e.target.value)}
                aria-label="Comprendre"
              />
              <Button type="submit" small disabled={!heard.trim() || !replacement.trim()}>
                Ajouter
              </Button>
            </form>
          </Card>

          <Card
            title="Mots attendus"
            actions={
              <Button
                variant="secondary"
                small
                onClick={() =>
                  call(() => module.api.post<VocabularyDto>('/vocabulary/words/restore'))
                }
              >
                Remettre les mots d’origine
              </Button>
            }
          >
            <p className="small muted">
              Mots anglais et du métier que la reconnaissance vocale doit savoir écrire. S’y
              ajoutent tout seuls : les noms et surnoms des outils, ton nom d’artiste, les titres et
              surnoms de tes morceaux, tes tags (mis à jour quand la Bibliothèque change).
            </p>
            <ul className="as-chips">
              {shown?.words.map((w) => (
                <li key={w.id} className="as-chip">
                  {w.word}
                  <button
                    type="button"
                    className="as-chip__remove"
                    aria-label={`Retirer ${w.word}`}
                    title="Retirer"
                    onClick={() =>
                      call(() => module.api.delete<VocabularyDto>(`/vocabulary/words/${w.id}`))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="as-row"
              onSubmit={(e) => {
                e.preventDefault();
                call(
                  () => module.api.post<VocabularyDto>('/vocabulary/words', { word }),
                  () => setWord(''),
                );
              }}
            >
              <input
                className="input"
                value={word}
                placeholder="Ajouter un mot (ex. Obsidian, sidechain)"
                onChange={(e) => setWord(e.target.value)}
                aria-label="Nouveau mot"
              />
              <Button type="submit" small disabled={!word.trim()}>
                Ajouter
              </Button>
            </form>
          </Card>
        </div>
        <div className="as-stack">
          <TestText />
          <Card title="Envoyé à la reconnaissance vocale">
            <p className="small muted">
              Avec chaque enregistrement (« mots attendus » de whisper.cpp), dans cet ordre, coupé à
              environ 700 caractères :
            </p>
            <p className="small as-expected">{shown?.expected || '—'}</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
