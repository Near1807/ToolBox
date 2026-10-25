// Page of the assistant: conversation (what was heard, the answer, the actions
// with « Annuler », « C'était… » when not understood), the « IA » switch,
// typing instead of speaking, latencies, the rights, and the setup (models,
// voice, key, advanced: thresholds and instructions of the model).
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  Page,
  ProgressBar,
  StateBadge,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import type { CommandsDto, PromptDto, StatusDto, TurnActionDto, TurnDto } from '../shared';
import { RightsCard, savePhrase } from './CommandsPage';
import { live } from './live';

const MODE_LABELS: Record<NonNullable<TurnDto['mode']>, string> = {
  command: 'commande standardisée',
  ai: 'IA',
  'not-understood': 'pas compris',
  answer: 'réponse oui / non',
};

const percent = (score: number | null | undefined) =>
  score === null || score === undefined ? '—' : `${Math.round(score * 100)} %`;

const STATE_LABELS: Record<string, string> = {
  idle: 'Prêt',
  listening: 'J’écoute…',
  transcribing: 'Je transcris…',
  thinking: 'Je réfléchis…',
  speaking: 'Je réponds…',
};

const seconds = (ms: number | null) =>
  ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

function useLive() {
  return useSyncExternalStore(
    (listener) => live.subscribe(listener),
    () => live.state,
  );
}

function ActionLine(props: {
  turn: TurnDto;
  action: TurnActionDto;
  index: number;
  onUndone: () => void;
}) {
  const module = useModule();
  const { action } = props;
  const [error, setError] = useState<string | null>(null);
  const tone =
    action.status === 'done'
      ? 'success'
      : action.status === 'confirm'
        ? 'warning'
        : action.status === 'refused' || action.status === 'forbidden'
          ? 'neutral'
          : 'danger';
  const label = {
    done: 'fait',
    confirm: 'à confirmer',
    refused: 'refusé (sensible)',
    forbidden: 'droit désactivé',
    invalid: 'non compris',
    error: 'erreur',
  }[action.status];
  return (
    <li className="as-action">
      <StateBadge tone={tone}>{label}</StateBadge>
      <span className="small">
        <strong>{action.moduleName}</strong> ·{' '}
        {action.status === 'refused' ? (
          'action sensible : à faire toi-même'
        ) : action.undone ? (
          <s>{action.message}</s>
        ) : (
          action.message
        )}
      </span>
      {action.undoId && !action.undone && (
        <Button
          variant="secondary"
          small
          onClick={() =>
            void module.api
              .post(`/turns/${props.turn.id}/actions/${props.index}/undo`)
              .then(props.onUndone)
              .catch((e: unknown) => setError(errorMessage(e)))
          }
        >
          Annuler
        </Button>
      )}
      {action.undone && <span className="small muted">annulé</span>}
      {action.status === 'forbidden' && (
        <Link className="small" to={module.path('commands')}>
          Droits de l’assistant
        </Link>
      )}
      {action.status === 'refused' && action.open && (
        <Link className="small" to={action.open}>
          Ouvrir la page
        </Link>
      )}
      {error && <span className="error small">{error}</span>}
    </li>
  );
}

/**
 * « C'était… » on a request that was not understood: Thomas picks the command
 * he meant, his phrase is added to it (conflict check included). Nothing runs.
 */
function WasMeant(props: { turn: TurnDto }) {
  const module = useModule();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commands = useApi<CommandsDto>(open ? module.url('/commands') : null);
  if (done) return <p className="small as-notice">{done}</p>;
  if (!open)
    return (
      <Button variant="secondary" small onClick={() => setOpen(true)}>
        C’était…
      </Button>
    );
  const list = commands.data?.commands ?? [];
  const chosen = list.find((c) => c.id === choice);
  return (
    <form
      className="as-row small"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return;
        void savePhrase(
          (force) =>
            module.api.post(`/commands/${encodeURIComponent(chosen.id)}/phrases`, {
              text: props.turn.heard,
              force,
            }),
          chosen.description,
        )
          .then((saved) =>
            saved
              ? setDone(
                  `Phrase ajoutée à « ${chosen.description} » : la prochaine fois, elle sera reconnue.`,
                )
              : setOpen(false),
          )
          .catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      <select
        className="input"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        aria-label="Commande voulue"
      >
        <option value="">Choisis la commande voulue…</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.moduleName} —{' '}
            {c.description.length > 70 ? `${c.description.slice(0, 69)}…` : c.description}
          </option>
        ))}
      </select>
      <Button type="submit" small disabled={!chosen}>
        Ajouter ma phrase
      </Button>
      <Button variant="secondary" small onClick={() => setOpen(false)}>
        Annuler
      </Button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}

/**
 * « Corriger » : a word the ear wrote wrong (select it in the transcript, or
 * type it) and the right one: a correction applied to every next recording.
 */
function FixWord(props: { turn: TurnDto }) {
  const module = useModule();
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState('');
  const [right, setRight] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) return <p className="small as-notice">{done}</p>;
  if (!open)
    return (
      <Button
        variant="secondary"
        small
        title="Sélectionne d’abord le mot mal écrit dans la phrase"
        onClick={() => {
          const selected = window.getSelection()?.toString().trim() ?? '';
          setHeard(selected && props.turn.heard.includes(selected) ? selected : '');
          setOpen(true);
        }}
      >
        Corriger
      </Button>
    );
  return (
    <form
      className="as-row small"
      onSubmit={(e) => {
        e.preventDefault();
        void module.api
          .post('/vocabulary/corrections', { heard, replacement: right })
          .then(() =>
            setDone(
              `Correction ajoutée : quand l’oreille écrit « ${heard} », je comprends « ${right} ».`,
            ),
          )
          .catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      <input
        className="input"
        value={heard}
        placeholder="Mot mal écrit (ex. tout doux)"
        onChange={(e) => setHeard(e.target.value)}
        aria-label="Mot mal écrit"
      />
      <input
        className="input"
        value={right}
        placeholder="Le bon mot (ex. to-do)"
        onChange={(e) => setRight(e.target.value)}
        aria-label="Le bon mot"
      />
      <Button type="submit" small disabled={!heard.trim() || !right.trim()}>
        Ajouter la correction
      </Button>
      <Button variant="secondary" small onClick={() => setOpen(false)}>
        Annuler
      </Button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}

function TurnView(props: { turn: TurnDto; latest: boolean; onChange: () => void }) {
  const module = useModule();
  const { turn } = props;
  const l = turn.latency;
  const command = turn.command;
  return (
    <li className="as-turn">
      <div className="as-turn__you">
        <span className="small muted">
          {turn.source === 'voice'
            ? '🎙️ Tu as dit'
            : turn.source === 'bar'
              ? '⌨️ Écrit dans la barre'
              : '⌨️ Tu as écrit'}
        </span>
        <p className="as-heard">{turn.heard}</p>
        {turn.rawHeard && (
          <p className="small faint">L’oreille a écrit : « {turn.rawHeard} » (corrigé)</p>
        )}
        {turn.source === 'voice' && <FixWord turn={turn} />}
      </div>
      <div className="as-turn__reply">
        <span className="small muted">Assistant</span>
        {turn.reply ? <p>{turn.reply}</p> : <p className="muted">…</p>}
        {turn.error && <ErrorMessage>{turn.error}</ErrorMessage>}
        {turn.actions.length > 0 && (
          <ul className="as-actions">
            {turn.actions.map((action, index) => (
              <ActionLine
                key={index}
                turn={turn}
                action={action}
                index={index}
                onUndone={props.onChange}
              />
            ))}
          </ul>
        )}
        {turn.mode === 'not-understood' && <WasMeant turn={turn} />}
        {turn.pending?.kind === 'choose' && props.latest && (
          <div className="as-pending">
            {turn.pending.options?.map((label, choice) => (
              <Button
                key={label}
                small
                variant={choice === 0 ? 'primary' : 'secondary'}
                onClick={() =>
                  void module.api.post(`/turns/${turn.id}/answer`, { choice }).then(props.onChange)
                }
              >
                {label}
              </Button>
            ))}
            <Button
              variant="secondary"
              small
              onClick={() =>
                void module.api
                  .post(`/turns/${turn.id}/answer`, { yes: false })
                  .then(props.onChange)
              }
            >
              Aucune
            </Button>
          </div>
        )}
        {turn.pending && turn.pending.kind !== 'choose' && props.latest && (
          <div className="as-pending">
            <Button
              small
              onClick={() =>
                void module.api.post(`/turns/${turn.id}/answer`, { yes: true }).then(props.onChange)
              }
            >
              Oui
            </Button>
            <Button
              variant="secondary"
              small
              onClick={() =>
                void module.api
                  .post(`/turns/${turn.id}/answer`, { yes: false })
                  .then(props.onChange)
              }
            >
              Non
            </Button>
          </div>
        )}
        <p className="as-latency small faint">
          {turn.mode && <StateBadge tone="neutral">{MODE_LABELS[turn.mode]}</StateBadge>}{' '}
          {command?.actionId && command.verdict !== 'empty' && (
            <span title="Commande la plus proche, score et écart avec la 2e">
              {command.actionId} · {percent(command.score)} (écart {percent(command.gap)})
            </span>
          )}
          {turn.questions > 0 && <> · {turn.questions} question(s)</>}
        </p>
        <p className="as-latency small faint" title="Temps de chaque maillon">
          {turn.source === 'voice' && l.micOpenMs !== null && <>Micro {seconds(l.micOpenMs)} · </>}
          {turn.source === 'voice' && <>Transcription {seconds(l.transcribeMs)} · </>}
          {l.matchMs !== null && <>Commandes {seconds(l.matchMs)} · </>}
          {l.modelMs !== null && <>Modèle {seconds(l.modelMs)} · </>}
          Réflexion {seconds(l.firstSentenceMs)}
          {l.thinkMs !== null &&
            l.firstSentenceMs !== null &&
            l.thinkMs - l.firstSentenceMs > 300 && <> (fin {seconds(l.thinkMs)})</>}{' '}
          · Voix {seconds(l.voiceMs)}
          {l.firstAudioMs !== null && <> · 1er son {seconds(l.firstAudioMs)} après avoir relâché</>}
          {l.rounds > 1 && <> · {l.rounds} passes du modèle</>}
        </p>
      </div>
    </li>
  );
}

/** The « IA » switch, always visible above the conversation. */
function AiSwitch(props: { status: StatusDto; onChange: () => void }) {
  const module = useModule();
  const ai = props.status.settings.ai;
  return (
    <div className={`as-ai${ai ? ' as-ai--on' : ''}`}>
      <label className="as-inline">
        <input
          type="checkbox"
          checked={ai}
          onChange={(e) =>
            void module.api.put('/choices', { ai: e.target.checked }).then(props.onChange)
          }
        />{' '}
        <strong>IA</strong>
      </label>
      <span className="small muted">
        {ai
          ? 'Activée : une demande qui n’est pas une commande va au modèle choisi (plus lent).'
          : 'Désactivée : seules les commandes sont comprises, tout de suite et sans modèle. « Quelles sont les commandes ? » pour les voir.'}
      </span>
    </div>
  );
}

function Conversation(props: { status: StatusDto | null; onStatusChange: () => void }) {
  const module = useModule();
  const state = useLive();
  const turnsApi = useApi<{ turns: TurnDto[] }>(module.url('/turns'));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const { reload } = turnsApi;

  // New turns and updates arrive live; the list is reloaded when a turn ends.
  useEffect(() => live.subscribe(() => force((n) => n + 1)), []);
  useEffect(() => {
    if (state.state === 'idle') reload();
  }, [state.state, reload]);

  const turns = [...(turnsApi.data?.turns ?? [])];
  for (const turn of live.turns.values()) {
    const index = turns.findIndex((t) => t.id === turn.id);
    if (index >= 0) turns[index] = turn;
    else if (turn.id > (turns[0]?.id ?? 0)) turns.unshift(turn);
  }
  turns.sort((a, b) => b.id - a.id);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await module.api.post('/turn/text', { text });
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
      reload();
    }
  };
  const listening = state.state === 'listening';
  const key = props.status?.hotkey.key?.label;

  return (
    <Card
      title={
        <span className="as-title">
          Conversation{' '}
          <StateBadge tone={state.state === 'idle' ? 'neutral' : 'running'}>
            {STATE_LABELS[state.state]}
          </StateBadge>
        </span>
      }
      actions={
        <div className="as-row">
          <Link className="small" to={module.path('commands')}>
            Commandes
          </Link>
          <Link className="small" to={module.path('mots')}>
            Mots
          </Link>
          <Button
            variant="secondary"
            small
            onClick={() => {
              live.turns.clear();
              void module.api.post('/reset').then(reload);
            }}
          >
            Nouvelle conversation
          </Button>
        </div>
      }
    >
      {props.status && <AiSwitch status={props.status} onChange={props.onStatusChange} />}
      <form className="as-composer" onSubmit={(e) => void send(e)}>
        <button
          type="button"
          className={`as-mic${listening ? ' as-mic--on' : ''}`}
          title={listening ? 'Terminer' : 'Parler'}
          aria-label={listening ? 'Terminer' : 'Parler'}
          onClick={() => void module.api.post(listening ? '/listen/stop' : '/listen/start')}
        >
          🎙️
        </button>
        <input
          className="input as-composer__input"
          value={text}
          placeholder="Écris au lieu de parler : « ajoute finir le mix pour vendredi »"
          onChange={(e) => setText(e.target.value)}
          aria-label="Demande"
        />
        <Button type="submit" disabled={sending || !text.trim()}>
          Envoyer
        </Button>
      </form>
      <p className="small muted as-help">
        {props.status?.hotkey.available && key ? (
          <>
            Maintiens <strong>{key}</strong> pour parler, relâche pour envoyer (ou appuie une fois,
            parle, puis appuie à nouveau). Le micro de l’app marche aussi.
          </>
        ) : (
          <>
            Clique le micro pour parler (touche globale indisponible :{' '}
            {props.status?.hotkey.reason ?? '…'}).
          </>
        )}
      </p>
      {(error || live.micError) && <ErrorMessage>{error ?? live.micError}</ErrorMessage>}
      {turns.length === 0 ? (
        <p className="muted">
          Rien pour l’instant. Essaie : « ajoute une tâche finir le mix pour vendredi », « qu’est-ce
          que j’ai à faire aujourd’hui ? », « qu’est-ce que je publie cette semaine ? », « résumé de
          la chaîne », « ouvre le planning ».
        </p>
      ) : (
        <ul className="as-turns">
          {turns.map((turn, i) => (
            <TurnView key={turn.id} turn={turn} latest={i === 0} onChange={reload} />
          ))}
        </ul>
      )}
      <p className="small faint">
        La conversation reste en mémoire jusqu’à la fermeture de l’app, puis est oubliée.
      </p>
    </Card>
  );
}

function Step(props: { ok: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className={`as-step${props.ok ? ' as-step--ok' : ''}`}>
      <div className="as-step__head">
        <StateBadge tone={props.ok ? 'success' : 'warning'}>
          {props.ok ? 'Prêt' : 'À faire'}
        </StateBadge>
        <strong>{props.title}</strong>
      </div>
      {props.children && <div className="as-step__body">{props.children}</div>}
    </div>
  );
}

function Setup(props: { status: StatusDto; reload: () => void }) {
  const module = useModule();
  const { status, reload } = props;
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [capturing, setCapturing] = useState(false);
  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
    reload();
  };
  const choose = (body: Record<string, unknown>) => act(() => module.api.put('/choices', body));
  const install = (target: string, id?: string) =>
    act(() => module.api.post('/install', { target, id }));
  const o = status.ollama;
  const toolsMissing = o.capabilities !== null && !o.capabilities.includes('tools');
  const models = [
    ...new Set([
      ...status.choices.models.map((m) => m.tag),
      ...o.installed.map((m) => m.name),
      o.model,
    ]),
  ];
  const hw = status.hardware;

  return (
    <Card
      title="Modèles et réglages"
      actions={
        !status.ready && (
          <Button small onClick={() => void act(() => module.api.post('/install-all'))}>
            Tout installer
          </Button>
        )
      }
    >
      {hw && (
        <p className="small muted">
          Ce PC : {hw.ramGb} Go de mémoire, {hw.threads} fils de calcul
          {hw.gpus.length
            ? `, ${hw.gpus.map((g) => `${g.name}${g.vramGb ? ` (${g.vramGb} Go)` : ''}`).join(', ')}`
            : ''}
          . {status.recommendation?.reason}
        </p>
      )}
      {status.installing.length > 0 && (
        <div className="as-installs">
          {status.installing.map((job) => (
            <div key={job.id} className="small">
              {job.title} {job.message && <span className="muted">· {job.message}</span>}
              <ProgressBar value={job.progress} />
            </div>
          ))}
        </div>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      <Step
        ok={status.commands.modelInstalled}
        title={
          status.commands.modelInstalled
            ? 'Modèle des commandes installé'
            : 'Modèle des commandes (conseillé, ~120 Mo)'
        }
      >
        <p className="small muted">
          {status.commands.modelLabel} : reconnaît les commandes par le sens (« rajoute… », « mets
          dans ma liste… »), en quelques millisecondes, sans IA.{' '}
          {status.commands.modelInstalled
            ? status.commands.semantic
              ? 'Utilisé.'
              : 'Pas encore chargé.'
            : 'Sans lui, les commandes sont reconnues par les mots seuls (plus strict).'}
        </p>
        {!status.commands.modelInstalled && (
          <Button small onClick={() => void install('embeddings')}>
            Télécharger
          </Button>
        )}
      </Step>

      {!status.settings.ai && (
        <p className="small muted as-note">
          IA désactivée : Ollama et le modèle de langage ne sont pas nécessaires. Active « IA » en
          haut de la conversation pour les installer et les utiliser.
        </p>
      )}
      {status.settings.ai && (
        <>
          <Step
            ok={Boolean(o.version)}
            title={
              o.version
                ? `Ollama ${o.version} est lancé`
                : 'Installer et lancer Ollama (le « cerveau »)'
            }
          >
            {!o.version && (
              <ol className="small as-steps">
                <li>
                  Télécharger Ollama pour Windows :{' '}
                  <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                    ollama.com/download
                  </a>{' '}
                  (gratuit, open source).
                </li>
                <li>
                  Lancer « OllamaSetup.exe » et suivre l’installation. Ollama démarre ensuite tout
                  seul avec Windows (icône près de l’horloge).
                </li>
                <li>
                  Revenir ici et cliquer « Vérifier ».{' '}
                  {o.canStart && (
                    <>
                      Installé mais arrêté ?{' '}
                      <Button
                        variant="secondary"
                        small
                        onClick={() => void act(() => module.api.post('/ollama/start'))}
                      >
                        Démarrer Ollama
                      </Button>
                    </>
                  )}
                </li>
              </ol>
            )}
            <Button variant="secondary" small onClick={reload}>
              Vérifier
            </Button>
          </Step>

          <Step ok={o.modelInstalled && !toolsMissing} title={`Modèle de langage : ${o.model}`}>
            <div className="as-row">
              <select
                className="input"
                value={o.model}
                onChange={(e) => void choose({ model: e.target.value })}
                aria-label="Modèle"
              >
                {models.map((tag) => {
                  const info = status.choices.models.find((m) => m.tag === tag);
                  const installed = o.installed.some(
                    (m) => m.name === tag || m.name === `${tag}:latest`,
                  );
                  return (
                    <option key={tag} value={tag}>
                      {info ? `${info.label} — ${info.sizeGb} Go, ${info.note}` : tag}
                      {installed ? ' ✓' : ''}
                      {tag === status.recommendation?.model ? ' (recommandé)' : ''}
                    </option>
                  );
                })}
              </select>
              {o.version && !o.modelInstalled && (
                <Button small onClick={() => void install('llm', o.model)}>
                  Télécharger
                </Button>
              )}
            </div>
            <form
              className="as-row small"
              onSubmit={(e) => {
                e.preventDefault();
                if (customModel.trim())
                  void choose({ model: customModel.trim() }).then(() => setCustomModel(''));
              }}
            >
              <input
                className="input"
                value={customModel}
                placeholder="Autre modèle d’ollama.com/library, ex. qwen3.5:9b"
                onChange={(e) => setCustomModel(e.target.value)}
              />
              <Button type="submit" variant="secondary" small disabled={!customModel.trim()}>
                Choisir
              </Button>
            </form>
            {toolsMissing && (
              <ErrorMessage>
                Ce modèle ne sait pas appeler d’outils (Ollama ne déclare pas « tools ») : il pourra
                répondre, mais pas agir sur ToolBox. Choisis-en un autre.
              </ErrorMessage>
            )}
            <div className="as-row small">
              <label
                className="as-inline"
                title="Lit tel quel le résultat des outils, sans reformulation par le modèle"
              >
                Réponses directes{' '}
                <select
                  className="input"
                  value={status.settings.directReplies}
                  onChange={(e) => void choose({ directReplies: e.target.value })}
                >
                  <option value="auto">
                    Automatique ({status.settings.directReads ? 'activées' : 'désactivées'} sur ce
                    PC)
                  </option>
                  <option value="on">Activées (plus rapide)</option>
                  <option value="off">Désactivées</option>
                </select>
              </label>
              <label
                className="as-inline"
                title="Durée pendant laquelle Ollama garde le modèle chargé"
              >
                Garder en mémoire{' '}
                <select
                  className="input"
                  value={status.settings.keepAlive}
                  onChange={(e) => void choose({ keepAlive: e.target.value })}
                >
                  <option value="10m">10 min</option>
                  <option value="30m">30 min</option>
                  <option value="2h">2 h</option>
                  <option value="-1">toujours</option>
                </select>
              </label>
            </div>
          </Step>
        </>
      )}

      <Step
        ok={Boolean(status.whisper.engine && status.whisper.modelInstalled)}
        title="Reconnaissance vocale (whisper.cpp)"
      >
        <div className="as-row">
          {!status.whisper.engine && (
            <Button small onClick={() => void install('whisper-engine')}>
              Installer le moteur
            </Button>
          )}
          <select
            className="input"
            value={status.whisper.model}
            onChange={(e) => void choose({ whisperModel: e.target.value })}
            aria-label="Modèle de reconnaissance"
          >
            {status.choices.whisper.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.note}
                {m.id === status.recommendation?.whisper ? ' (recommandé)' : ''}
              </option>
            ))}
          </select>
          {!status.whisper.modelInstalled && (
            <Button small onClick={() => void install('whisper-model', status.whisper.model)}>
              Télécharger
            </Button>
          )}
        </div>
      </Step>

      <Step ok={Boolean(status.piper.engine && status.piper.voiceInstalled)} title="Voix (Piper)">
        <div className="as-row">
          {!status.piper.engine && (
            <Button small onClick={() => void install('piper-engine')}>
              Installer le moteur
            </Button>
          )}
          <select
            className="input"
            value={status.piper.voice}
            onChange={(e) => void choose({ voice: e.target.value })}
            aria-label="Voix"
          >
            {status.choices.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          {!status.piper.voiceInstalled ? (
            <Button small onClick={() => void install('voice', status.piper.voice)}>
              Télécharger
            </Button>
          ) : (
            <Button
              variant="secondary"
              small
              disabled={!status.piper.engine}
              onClick={() => void act(() => module.api.post('/voice/test'))}
            >
              Écouter
            </Button>
          )}
        </div>
        <div className="as-row small">
          <label className="as-inline">
            Vitesse {status.settings.speed.toFixed(2).replace('.', ',')}
            <input
              type="range"
              min={0.7}
              max={1.5}
              step={0.05}
              value={status.settings.speed}
              onChange={(e) => void choose({ speed: Number(e.target.value) })}
            />
          </label>
          <label className="as-inline">
            <input
              type="checkbox"
              checked={status.settings.speakReplies}
              onChange={(e) => void choose({ speakReplies: e.target.checked })}
            />{' '}
            Répondre à voix haute
          </label>
          <label className="as-inline" title="Un son très court quand le micro reçoit ta voix">
            <input
              type="checkbox"
              checked={status.settings.readySound}
              onChange={(e) => void choose({ readySound: e.target.checked })}
            />{' '}
            Son « micro prêt »
          </label>
        </div>
      </Step>

      <Step
        ok={status.hotkey.available}
        title={`Touche « parler » : ${status.hotkey.key?.label ?? 'aucune'}`}
      >
        {status.hotkey.available ? (
          <div className="as-row">
            <Button
              variant="secondary"
              small
              disabled={capturing}
              onClick={() => {
                setCapturing(true);
                void act(() => module.api.post('/hotkey/capture')).finally(() =>
                  setCapturing(false),
                );
              }}
            >
              {capturing ? 'Appuie sur la touche voulue…' : 'Changer la touche'}
            </Button>
          </div>
        ) : (
          <p className="small">{status.hotkey.reason}</p>
        )}
        <details className="small muted">
          <summary>À propos de la touche Copilot</summary>
          <p>
            Elle envoie la combinaison Win+Maj+F23 : ToolBox l’entend même sans le focus. Mais
            Windows ouvre aussi Copilot (ou la Recherche) : le réglage Windows « Personnaliser la
            touche Copilot » ne propose que des apps du Microsoft Store. Sur certains PC, la touche
            envoie son relâchement tout de suite : on ne peut pas la maintenir, l’assistant passe
            alors en « appuyer pour commencer, appuyer pour finir ».
          </p>
          <p>
            Solution propre : PowerToys › Gestionnaire de clavier › « Remapper un raccourci » :
            Win+Maj+F23 → F24, puis « Changer la touche » ici et appuyer sur la touche Copilot. Ou
            choisir une autre touche (Ctrl droit, F13…).
          </p>
        </details>
      </Step>

      <Step
        ok={status.bar.key !== null}
        title={`Barre de commande écrite : ${status.bar.key ? status.bar.key.label : 'désactivée (aucune touche)'}`}
      >
        <p className="small muted">
          Une petite barre par-dessus l’application en cours, sans afficher ToolBox : tu écris la
          commande, Entrée l’envoie, Échap ferme. Mêmes commandes, mêmes droits et mêmes
          confirmations qu’à la voix ; la réponse s’affiche dans la barre.
        </p>
        {status.hotkey.available ? (
          <>
            <div className="as-row">
              <Button
                variant="secondary"
                small
                disabled={capturing}
                onClick={() => {
                  setCapturing(true);
                  void act(() => module.api.post('/hotkey/capture', { target: 'bar' })).finally(
                    () => setCapturing(false),
                  );
                }}
              >
                {capturing
                  ? 'Appuie sur la touche ou la combinaison voulue…'
                  : status.bar.key
                    ? 'Changer la touche'
                    : 'Choisir la touche'}
              </Button>
              {status.bar.key && (
                <Button
                  variant="secondary"
                  small
                  onClick={() => void act(() => module.api.post('/hotkey/clear-bar'))}
                >
                  Désactiver
                </Button>
              )}
            </div>
            <div className="as-row">
              <label className="as-inline">
                <input
                  type="radio"
                  name="bar-mode"
                  checked={status.bar.mode === 'double'}
                  onChange={() => void choose({ barMode: 'double' })}
                />{' '}
                Double appui
              </label>
              <label className="as-inline">
                <input
                  type="radio"
                  name="bar-mode"
                  checked={status.bar.mode === 'single'}
                  onChange={() => void choose({ barMode: 'single' })}
                />{' '}
                Appui simple
              </label>
              {status.bar.mode === 'double' && (
                <label className="as-inline">
                  Délai du double appui{' '}
                  <input
                    type="range"
                    min={150}
                    max={1000}
                    step={50}
                    value={status.bar.doubleMs}
                    onChange={(e) => void choose({ barDoubleMs: Number(e.target.value) })}
                  />{' '}
                  <span className="num">{status.bar.doubleMs} ms</span>
                </label>
              )}
            </div>
            {status.bar.conflict && (
              <p className={`small ${status.bar.conflict.warning ? 'error' : 'muted'}`}>
                {status.bar.conflict.text}
              </p>
            )}
            <label className="as-inline">
              <input
                type="checkbox"
                checked={status.bar.speak}
                onChange={(e) => void choose({ speakTyped: e.target.checked })}
              />{' '}
              Lire aussi la réponse à voix haute
            </label>
          </>
        ) : (
          <p className="small">{status.hotkey.reason}</p>
        )}
      </Step>

      <details className="as-advanced">
        <summary>Réglages avancés</summary>
        <Advanced status={status} choose={choose} />
      </details>
    </Card>
  );
}

/** Thresholds of the commands, and the instructions of the model. */
function Advanced(props: {
  status: StatusDto;
  choose: (body: Record<string, unknown>) => Promise<void>;
}) {
  const module = useModule();
  const prompt = useApi<PromptDto>(module.url('/prompt'));
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { settings } = props.status;
  const text = draft ?? prompt.data?.effective ?? '';
  const save = (value: string) =>
    void module.api
      .put<PromptDto>('/prompt', { text: value })
      .then(() => {
        setDraft(null);
        setError(null);
        prompt.reload();
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  const tokens = Math.round(text.length / 4);
  return (
    <div className="as-advanced__body">
      <h3>Commandes</h3>
      <div className="as-row small">
        <label className="as-inline">
          Seuil de reconnaissance{' '}
          <input
            className="input as-number"
            type="number"
            min={0.5}
            max={0.95}
            step={0.01}
            value={settings.commandThreshold}
            onChange={(e) => void props.choose({ commandThreshold: Number(e.target.value) })}
          />
        </label>
        <label className="as-inline">
          Écart minimal avec la 2e{' '}
          <input
            className="input as-number"
            type="number"
            min={0}
            max={0.3}
            step={0.01}
            value={settings.commandMargin}
            onChange={(e) => void props.choose({ commandMargin: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="small faint">
        Plus haut = plus strict : moins d’erreurs, mais plus de « pas compris ». « Tester une phrase
        » sur la page Commandes montre le score et l’écart.
      </p>

      <h3>Instructions du modèle (IA)</h3>
      <p className="small muted">
        Ce que le modèle lit avant chaque demande. Plus c’est long, plus il est lent sans carte
        graphique. La sécurité ne dépend pas de ce texte : confirmations, droits et refus sont
        appliqués par l’application, quoi qu’il dise.
      </p>
      <textarea
        className="input as-prompt"
        rows={9}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Instructions du modèle"
      />
      <div className="as-row small">
        <span className="muted">
          {text.length} caractères (~{tokens} jetons)
          {prompt.data &&
            ` + ~${prompt.data.length.autoTokens} ajoutés + ~${prompt.data.length.toolsTokens} pour les actions`}
        </span>
        <Button small disabled={draft === null} onClick={() => save(text)}>
          Enregistrer
        </Button>
        <Button
          variant="secondary"
          small
          disabled={!prompt.data?.custom && draft === null}
          onClick={() => {
            if (window.confirm('Rétablir les instructions d’origine ? Ton texte sera remplacé.'))
              save('');
          }}
        >
          Rétablir l’original
        </Button>
      </div>
      {prompt.data?.custom ? (
        <p className="small faint">Instructions personnalisées (appliquées tout de suite).</p>
      ) : (
        <p className="small faint">Instructions d’origine.</p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {prompt.data && (
        <div className="small as-auto">
          <p className="muted">Ajouté automatiquement par l’application (lecture seule) :</p>
          <pre>{prompt.data.auto.join('\n')}</pre>
          <p className="muted">
            Actions envoyées au modèle ({prompt.data.tools.length}, moins quand la demande ressemble
            à une commande d’un outil) : {prompt.data.tools.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

export function AssistantPage() {
  const module = useModule();
  const status = useApi<StatusDto>(module.url('/status'));
  const commands = useApi<CommandsDto>(module.url('/commands'));
  const installing = (status.data?.installing.length ?? 0) > 0;
  const { reload } = status;
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [installing, reload]);

  return (
    <Page
      title="Assistant vocal"
      subtitle="100 % local et gratuit : Whisper (oreilles), commandes sans IA, Ollama facultatif (IA), Piper (voix)."
    >
      {status.data && !status.data.ready && (
        <div className="card as-banner">
          <strong>Il manque des éléments pour parler à l’assistant.</strong> Suis les étapes de «
          Modèles et réglages » ci-dessous.
        </div>
      )}
      <div className="as-layout">
        <Conversation status={status.data} onStatusChange={reload} />
        {status.error && <ErrorMessage>{status.error}</ErrorMessage>}
        <div className="as-stack">
          {status.data ? (
            <Setup status={status.data} reload={reload} />
          ) : (
            <Card title="Modèles et réglages">
              <p className="muted">Vérification…</p>
            </Card>
          )}
          {commands.data && <RightsCard rights={commands.data.rights} onChange={commands.reload} />}
        </div>
      </div>
    </Page>
  );
}
