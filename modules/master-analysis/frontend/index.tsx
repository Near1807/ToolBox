// Frontend of « Analyse du master »: the page, its guide (separate page, on demand) and a
// home widget with the last analyses.
import { defineFrontendModule, useApi, useModule } from '@hub/sdk/frontend';
import { fr } from '../shared/format';
import { GuidePage } from './guide/GuidePage';
import { MasterPage } from './MasterPage';
import type { StateDto } from './types';
import './master.css';

function HomeWidget() {
  const module = useModule();
  const { data } = useApi<StateDto>(module.url('/state'));
  const last = (data?.projects ?? [])
    .flatMap((p) => p.versions.filter((v) => v.summary).map((v) => ({ p, v })))
    .sort((a, b) => b.v.createdAt.localeCompare(a.v.createdAt))
    .slice(0, 3);
  if (!last.length) return <p className="small muted">Aucun master analysé.</p>;
  return (
    <ul className="small">
      {last.map(({ p, v }) => (
        <li key={v.id}>
          <strong>{p.title}</strong> {v.name.split(' ')[0]} : {fr(v.summary!.integrated)} LUFS ·{' '}
          {fr(v.summary!.truePeak, 1, true)} dBTP
        </li>
      ))}
    </ul>
  );
}

export default defineFrontendModule({
  pages: [
    { path: '', component: MasterPage },
    { path: 'guide', component: GuidePage },
  ],
  nav: { label: 'Analyse du master' },
  HomeWidget,
});
