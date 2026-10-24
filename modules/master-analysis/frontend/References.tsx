// « Références »: profiles of reference tracks (copied, never modified), the
// track compared to them at equal loudness (tonal balance per band and third
// of an octave, per section, global), and A/B listening at equal volume: only
// the PLAYBACK volume of the reference changes, never a file.
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  confirmDelete,
  ErrorMessage,
  errorMessage,
  pickFiles,
  StateBadge,
  useApi,
  useModule,
} from '@hub/sdk/frontend';
import { abLevels } from '../shared/measures';
import { fr, pct } from '../shared/format';
import { BANDS } from '../shared/types';
import { DiffBars, SpectrumChart } from './charts';
import { Help } from './guide/Help';
import { Choice, emphasis, Group, KeyFigures, useStoredChoice } from './layout';
import { BAND_TOKENS, useColors } from './theme';
import type { ReferencesDto, StateDto, VersionDto } from './types';

const AUDIO = [{ name: 'Audio', extensions: ['wav', 'flac', 'aif', 'aiff', 'mp3'] }];

const SECTION_COLUMNS = [
  { id: 'plr', label: 'PLR' },
  { id: 'width', label: 'Largeur' },
  { id: 'bands', label: 'Bandes' },
] as const;

export function References(props: { state: StateDto; reload: () => void; current: VersionDto }) {
  const module = useModule();
  const colors = useColors();
  const profiles = props.state.profiles;
  const [profileId, setProfileId] = useState<number | null>(profiles[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const columns = useStoredChoice('references-columns', ['bands']);
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const ready = profile?.refs.some((r) => r.status === 'done') ?? false;
  const data = useApi<ReferencesDto>(
    ready && profile
      ? module.url(
          `/references/compare?version=${props.current.id}&profile=${profile.id}&n=${profile.refs.filter((r) => r.status === 'done').length}`,
        )
      : null,
  );
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      props.reload();
    }
  };
  const create = () => {
    const name = window.prompt('Nom du profil de références (ex. « Club », « Ambient »)');
    if (name?.trim())
      void run(async () =>
        setProfileId((await module.api.post<{ id: number }>('/profiles', { name })).id),
      );
  };
  const add = async () => {
    if (!profile) return;
    const files = await pickFiles({
      title: 'Morceaux de référence',
      filters: AUDIO,
      multiple: true,
    });
    if (files.length)
      void run(() => module.api.post(`/profiles/${profile.id}/references`, { paths: files }));
  };
  const c = data.data;
  const show = (id: string) => columns.shown.has(id);
  const pair = (p: { track: number | null; references: number | null }, digits = 1, sign = false) =>
    `${fr(p.track, digits, sign)} / ${fr(p.references, digits, sign)}`;
  return (
    <div className="ma-groups">
      <Group title="Profil de références" topic="vue-references" wide>
        <div className="toolbar">
          <label className="small">
            Profil{' '}
            <select
              className="input input--short"
              value={profileId ?? ''}
              onChange={(e) => setProfileId(Number(e.target.value))}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" small onClick={create}>
            Nouveau profil
          </Button>
          {profile && (
            <>
              <Button variant="secondary" small onClick={() => void add()}>
                Ajouter des références…
              </Button>
              <Button
                variant="secondary"
                small
                onClick={() => {
                  const name = window.prompt('Nouveau nom du profil', profile.name);
                  if (name?.trim())
                    void run(() => module.api.put(`/profiles/${profile.id}`, { name }));
                }}
              >
                Renommer
              </Button>
              <Button
                variant="danger"
                small
                onClick={() =>
                  confirmDelete(
                    `le profil « ${profile.name} » et les copies de ses ${profile.refs.length} référence(s)`,
                  ) && void run(() => module.api.delete(`/profiles/${profile.id}`))
                }
              >
                Supprimer le profil
              </Button>
            </>
          )}
        </div>
        <p className="ma-note">
          Les références sont copiées dans l’app et ne sont jamais modifiées. Sans référence, rien
          n’est bloqué : les autres onglets fonctionnent seuls.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {profile && profile.refs.length > 0 && (
          <ul className="ma-refs">
            {profile.refs.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <StateBadge
                  tone={
                    r.status === 'done' ? 'success' : r.status === 'error' ? 'danger' : 'running'
                  }
                >
                  {r.status === 'done'
                    ? `${fr(r.summary?.integrated)} LUFS`
                    : r.status === 'error'
                      ? 'Erreur'
                      : 'Analyse…'}
                </StateBadge>
                {r.error && <span className="small error">{r.error}</span>}
                <button
                  type="button"
                  className="ma-link small"
                  onClick={() =>
                    confirmDelete(`la référence « ${r.name} » (sa copie dans l’app)`) &&
                    void run(() => module.api.delete(`/references/${r.id}`))
                  }
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
        {profiles.length === 0 && (
          <p className="muted">
            Aucun profil : crée-en un pour comparer ce master à des morceaux de référence.
          </p>
        )}
        {data.error && <ErrorMessage>{data.error}</ErrorMessage>}
        {c && <h4>Master (en grand) et moyenne des références (en dessous)</h4>}
        {c && (
          <KeyFigures
            label="Master (références : moyenne)"
            items={[
              {
                label: 'Sonie intégrée',
                value: fr(c.global.integrated.track),
                unit: 'LUFS',
                sub: `références : ${fr(c.global.integrated.references)} LUFS`,
                topic: 'sonie',
              },
              {
                label: 'Crête vraie',
                value: fr(c.global.truePeak.track, 1, true),
                unit: 'dBTP',
                sub: `références : ${fr(c.global.truePeak.references, 1, true)} dBTP`,
                topic: 'crete-vraie',
              },
              {
                label: 'PLR',
                value: fr(c.global.plr.track),
                unit: 'LU',
                sub: `références : ${fr(c.global.plr.references)} LU`,
                topic: 'plr',
              },
              {
                label: 'LRA',
                value: fr(c.global.lra.track),
                unit: 'LU',
                sub: `références : ${fr(c.global.lra.references)} LU`,
                topic: 'lra',
              },
              {
                label: 'Largeur',
                value: pct(c.global.width.track),
                sub: `références : ${pct(c.global.width.references)}`,
                topic: 'largeur',
              },
              {
                label: 'Corrélation',
                value: fr(c.global.correlation.track, 2),
                sub: `références : ${fr(c.global.correlation.references, 2)}`,
                topic: 'correlation',
              },
            ]}
          />
        )}
      </Group>
      {c && (
        <>
          <Group title="Écoute A/B à volume égal" topic="ecoute-ab" wide>
            <AbPlayer track={props.current} references={c.references} />
          </Group>
          <Group
            title="Fréquences (à sonie égale)"
            topic="equilibre-references"
            detailLabel="le spectre au tiers d’octave"
            detail={
              <>
                <p className="ma-note">
                  Spectre au tiers d’octave, à sonie égale <Help topic="spectre" />
                </p>
                <SpectrumChart
                  ariaLabel="Spectre du master et des références"
                  series={[
                    {
                      label: 'Master',
                      points: c.thirdOctave.map((p) => ({ f: p.f, db: p.track })),
                      color: colors['series-1'],
                    },
                    {
                      label: 'Références (moyenne)',
                      points: c.thirdOctave.map((p) => ({ f: p.f, db: p.references })),
                      color: colors['series-2'],
                      dashed: true,
                    },
                  ]}
                />
              </>
            }
          >
            <p className="ma-note">
              Énergie de chaque bande par rapport à la sonie intégrée : le master moins la moyenne
              des références.
            </p>
            <DiffBars
              ariaLabel="Écart par bande avec les références"
              unit="dB"
              items={c.bands.map((b, i) => ({
                label: b.label,
                value: b.difference,
                color: colors[BAND_TOKENS[i]!],
              }))}
            />
          </Group>
          <Group title="Structure et sections" topic="equilibre-references" wide>
            <p className="ma-note">
              Section de la référence portant le même nom quand elle existe, sinon la référence
              entière. Bandes : écart du master, à sonie égale (dB) ; en gras : 3 ou plus ; en gris
              : moins de 1.
            </p>
            <Choice
              label="Colonnes"
              options={SECTION_COLUMNS}
              shown={columns.shown}
              onToggle={columns.toggle}
            />
            <div className="ma-scroll">
              <table className="ma-table">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="num">Sonie (LUFS, master / réf.)</th>
                    {show('plr') && <th className="num">PLR (LU)</th>}
                    {show('width') && <th className="num">Largeur (%)</th>}
                    {show('bands') &&
                      BANDS.map((b) => (
                        <th key={b.id} className="num">
                          {b.label} (dB)
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {c.sections.map((s, i) => (
                    <tr key={i}>
                      <th>{s.section.label}</th>
                      <td className="num">{pair(s.integrated)}</td>
                      {show('plr') && <td className="num">{pair(s.plr)}</td>}
                      {show('width') && (
                        <td className="num">
                          {fr(s.width.track === null ? null : s.width.track * 100, 0)} /{' '}
                          {fr(s.width.references === null ? null : s.width.references * 100, 0)}
                        </td>
                      )}
                      {show('bands') &&
                        s.bands.map((b) => (
                          <td key={b.id} className={`num ${emphasis(b.difference)}`}>
                            {fr(b.difference, 1, true)}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

/**
 * Two players kept at the same position; switching A/B changes which one is
 * heard. To compare at the same loudness, the louder of the two is turned
 * down (element volume, never above 1: playback is never made louder).
 */
function AbPlayer(props: { track: VersionDto; references: ReferencesDto['references'][number][] }) {
  const [refId, setRefId] = useState(props.references[0]?.id ?? null);
  const [side, setSide] = useState<'A' | 'B'>('A');
  const [playing, setPlaying] = useState(false);
  const a = useRef<HTMLAudioElement>(null);
  const b = useRef<HTMLAudioElement>(null);
  const ref = props.references.find((r) => r.id === refId) ?? null;
  const levels = abLevels(ref?.gain ?? 0);
  useEffect(() => {
    if (a.current) a.current.volume = 10 ** (levels.master / 20);
    if (b.current) b.current.volume = 10 ** (levels.reference / 20);
  }, [levels.master, levels.reference]);
  const players = () => [a.current!, b.current!] as const;
  const toggle = async () => {
    const [pa, pb] = players();
    if (playing) {
      pa.pause();
      pb.pause();
      setPlaying(false);
      return;
    }
    pb.currentTime = Math.min(pa.currentTime, pb.duration || pa.currentTime);
    pa.muted = side !== 'A';
    pb.muted = side !== 'B';
    await Promise.all([pa.play(), pb.play()]);
    setPlaying(true);
  };
  const switchTo = (next: 'A' | 'B') => {
    const [pa, pb] = players();
    const now = next === 'B' ? pa.currentTime : pb.currentTime;
    if (next === 'B') pb.currentTime = now;
    else pa.currentTime = now;
    pa.muted = next !== 'A';
    pb.muted = next !== 'B';
    setSide(next);
  };
  if (!ref) return null;
  return (
    <div className="toolbar">
      <audio ref={a} src={props.track.audioUrl ?? undefined} preload="auto" />
      <audio ref={b} src={ref.audioUrl ?? undefined} preload="auto" />
      <Button small onClick={() => void toggle()}>
        {playing ? 'Pause' : 'Lire'}
      </Button>
      <div className="ma-segmented" role="group" aria-label="Écoute">
        <button type="button" aria-pressed={side === 'A'} onClick={() => switchTo('A')}>
          A · {props.track.name}
        </button>
        <button type="button" aria-pressed={side === 'B'} onClick={() => switchTo('B')}>
          B · {ref.name}
        </button>
      </div>
      <select
        className="input input--short"
        value={refId ?? ''}
        onChange={(e) => setRefId(Number(e.target.value))}
        aria-label="Référence"
      >
        {props.references.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <span className="small muted">
        {levels.master < 0
          ? `Master baissé de ${fr(-levels.master, 1)} dB à l’écoute`
          : levels.reference < 0
            ? `Référence baissée de ${fr(-levels.reference, 1)} dB à l’écoute`
            : 'Même sonie, aucun réglage de volume'}{' '}
        (la plus forte des deux est baissée pour les entendre à la même sonie ; le volume n’est
        jamais monté).
      </span>
    </div>
  );
}
