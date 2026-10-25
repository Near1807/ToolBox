// Exports of the version shown: the HTML report and the complete data through
// « Enregistrer sous » (the folder of the user's choice), the Markdown summary to
// the clipboard. Same numbers as the page; the comparisons included are chosen here.
import { useState } from 'react';
import { Button, copyText, errorMessage, useModule } from '@hub/sdk/frontend';
import { Help } from './guide/Help';
import type { StateDto, VersionDto } from './types';

export function Exports(props: { version: VersionDto; versions: VersionDto[]; state: StateDto }) {
  const module = useModule();
  const others = props.versions.filter((v) => v.id !== props.version.id && v.status === 'done');
  const previous = others.filter((v) => v.number < props.version.number).at(-1);
  const profiles = props.state.profiles.filter((p) => p.refs.some((r) => r.status === 'done'));
  const [compareTo, setCompareTo] = useState<number | ''>(previous?.id ?? '');
  const [profile, setProfile] = useState<number | ''>(profiles[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const options = { compareTo: compareTo === '' ? null : compareTo, profileId: profile || null };

  const save = async (format: 'html' | 'data') => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await module.api.post<{ path?: string; cancelled?: boolean }>(
        `/versions/${props.version.id}/export`,
        { format, ...options },
      );
      setMessage(
        result.path
          ? { text: `Enregistré : ${result.path}` }
          : { text: 'Export annulé : rien n’a été enregistré.' },
      );
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const query = new URLSearchParams();
      if (options.compareTo !== null) query.set('compareTo', String(options.compareTo));
      if (options.profileId !== null) query.set('profile', String(options.profileId));
      const { text } = await module.api.get<{ text: string }>(
        `/versions/${props.version.id}/summary?${query.toString()}`,
      );
      setMessage(
        (await copyText(text))
          ? { text: `Résumé copié (${text.split('\n').length} lignes, Markdown).` }
          : { text: 'Le presse-papiers a refusé la copie.', error: true },
      );
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ma-exports" aria-label="Exporter l’analyse">
      <div className="toolbar">
        <strong className="small">Exporter</strong>
        <label className="small">
          Comparer à{' '}
          <select
            className="input input--short"
            value={compareTo}
            onChange={(e) => setCompareTo(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">aucune version</option>
            {others.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          Références{' '}
          <select
            className="input input--short"
            value={profile}
            onChange={(e) => setProfile(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">aucune</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" small disabled={busy} onClick={() => void save('html')}>
          Exporter le rapport (HTML)…
        </Button>
        <Button variant="secondary" small disabled={busy} onClick={() => void copy()}>
          Copier le résumé
        </Button>
        <Button variant="secondary" small disabled={busy} onClick={() => void save('data')}>
          Exporter les données complètes…
        </Button>
        <Help topic="exports" />
      </div>
      {message && (
        <p className={`small ${message.error ? 'error' : 'muted'}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
