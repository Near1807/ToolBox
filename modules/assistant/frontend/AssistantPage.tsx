// Page of the assistant: conversation (what was heard, the answer, the actions
// with « Annuler »), typing instead of speaking, latencies, and the setup
// (models, voice, key) with the step-by-step help when something is missing.
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
import type { StatusDto, TurnActionDto, TurnDto } from '../shared';
import { live } from './live';

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
        : action.status === 'refused'
          ? 'neutral'
          : 'danger';
  const label = {
    done: 'fait',
    confirm: 'à confirmer',
    refused: 'refusé (sensible)',
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
      {action.status === 'refused' && action.open && (
        <Link className="small" to={action.open}>
          Ouvrir la page
        </Link>
      )}
      {error && <span className="error small">{error}</span>}
    </li>
  );
}

function TurnView(props: { turn: TurnDto; latest: boolean; onChange: () => void }) {
  const module = useModule();
  const { turn } = props;
  const l = turn.latency;
  return (
    <li className="as-turn">
      <div className="as-turn__you">
        <span className="small muted">
          {turn.source === 'voice' ? '🎙️ Tu as dit' : '⌨️ Tu as écrit'}
        </span>
        <p>{turn.heard}</p>
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
        {turn.pending && props.latest && (
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
        <p className="as-latency small faint" title="Temps de chaque maillon">
          {turn.source === 'voice' && <>Transcription {seconds(l.transcribeMs)} · </>}
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

function Conversation(props: { status: StatusDto | null }) {
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
      }
    >
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
          Rien pour l’instant. Essaie : « qu’est-ce que j’ai à faire aujourd’hui ? », « qu’est-ce
          que je publie cette semaine ? », « résume ma chaîne YouTube », « ouvre le Planning ».
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
              Lancer « OllamaSetup.exe » et suivre l’installation. Ollama démarre ensuite tout seul
              avec Windows (icône près de l’horloge).
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
      </Step>

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
          <label
            className="as-inline"
            title="Lit tel quel le résultat des outils, sans reformulation par le modèle"
          >
            <input
              type="checkbox"
              checked={status.settings.directReads}
              onChange={(e) => void choose({ directReads: e.target.checked })}
            />{' '}
            Réponses directes (plus rapide)
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
    </Card>
  );
}

export function AssistantPage() {
  const module = useModule();
  const status = useApi<StatusDto>(module.url('/status'));
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
      subtitle="100 % local et gratuit : Whisper (oreilles), Ollama (cerveau), Piper (voix)."
    >
      {status.data && !status.data.ready && (
        <div className="card as-banner">
          <strong>Il manque des éléments pour parler à l’assistant.</strong> Suis les étapes de «
          Modèles et réglages » ci-dessous (environ 4 Go à télécharger la première fois).
        </div>
      )}
      <div className="as-layout">
        <Conversation status={status.data} />
        {status.error && <ErrorMessage>{status.error}</ErrorMessage>}
        {status.data ? (
          <Setup status={status.data} reload={reload} />
        ) : (
          <Card title="Modèles et réglages">
            <p className="muted">Vérification…</p>
          </Card>
        )}
      </div>
    </Page>
  );
}
