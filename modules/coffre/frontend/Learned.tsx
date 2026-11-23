// v0.47.0 (Expérimental): Réglages › Coffre › « Ce que le Coffre a appris »
// (ADR 0061) — each rule, what it proposes, how sure it is (confirmed /
// corrected); change what it gives, delete it, or « Tout oublier » (confirmed).
// Changing nothing here touches an element: only future proposals.
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage, useApi, useModule } from '@hub/sdk/frontend';
import type { ContextDto, LearnedRuleDto } from '../shared/types';

const KIND: Record<LearnedRuleDto['kind'], string> = {
  site: 'Site',
  word: 'Mot du nom',
  ext: 'Extension',
};

export function LearnedSettings() {
  const module = useModule();
  const rules = useApi<LearnedRuleDto[]>(module.url('/learned'));
  const contexts = useApi<ContextDto[]>(module.url('/contexts'));
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) =>
    void p.then(() => rules.reload()).catch((e: unknown) => setError(errorMessage(e)));
  const list = rules.data ?? [];
  const sorted = [...(contexts.data ?? [])].sort((a, b) =>
    a.path.join('/').localeCompare(b.path.join('/'), 'fr'),
  );
  return (
    <div className="coffre-settings coffre-learned" id="coffre-learned">
      <h3>
        Ce que le Coffre a appris <span className="badge badge--warning">Expérimental</span>
      </h3>
      <p className="muted small">
        Quand tu ranges un fichier (ou le déplaces, ou choisis sa nature), le Coffre retient des
        règles simples. Une règle ne propose rien tant qu’elle n’a pas été confirmée au moins deux
        fois et juste au moins 2 fois sur 3 ; ses propositions restent « devinées », jamais à la
        place de ce que tu as choisi.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {rules.data && !list.length && <p className="muted">Rien appris pour l’instant.</p>}
      {list.length > 0 && (
        <table className="coffre-learned__table">
          <thead>
            <tr>
              <th>Quand</th>
              <th>Propose</th>
              <th>Confiance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.active ? undefined : 'coffre-learned--weak'}>
                <td>
                  <span className="muted small">{KIND[r.kind]}</span>{' '}
                  <strong>{r.kind === 'ext' ? `.${r.key}` : r.key}</strong>
                  {r.kind === 'ext' && (
                    <span className="muted small">
                      {' '}
                      dans {r.contextPath?.join(' › ') ?? 'un contexte supprimé'}
                    </span>
                  )}
                </td>
                <td>
                  {r.kind === 'ext' ? (
                    <input
                      className="input coffre-learned__nature"
                      defaultValue={r.nature ?? ''}
                      aria-label="Nature proposée"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.nature)
                          run(module.api.patch(`/learned/${r.id}`, { nature: v }));
                      }}
                    />
                  ) : (
                    <select
                      className="input"
                      aria-label="Contexte proposé"
                      value={r.contextId}
                      onChange={(e) =>
                        run(module.api.patch(`/learned/${r.id}`, { contextId: e.target.value }))
                      }
                    >
                      {!r.contextPath && <option value={r.contextId}>(contexte supprimé)</option>}
                      {sorted.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.path.join(' › ')}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td title={`${r.hits} fois confirmée, ${r.misses} fois corrigée`}>
                  {Math.round(r.confidence * 100)} %{' '}
                  <span className="muted small">
                    (confirmée {r.hits} fois, corrigée {r.misses} fois)
                    {r.active ? '' : ' · pas encore proposée'}
                  </span>
                </td>
                <td>
                  <Button
                    variant="secondary"
                    small
                    onClick={() => run(module.api.delete(`/learned/${r.id}`))}
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length > 0 && (
        <Button
          variant="secondary"
          onClick={() => {
            if (
              window.confirm(
                `Oublier les ${list.length} règles apprises ?\n\nTes fichiers et leurs fiches ne changent pas ; le Coffre reprendra de zéro.`,
              )
            )
              run(module.api.post('/learned/forget', { confirm: true }));
          }}
        >
          Tout oublier
        </Button>
      )}
    </div>
  );
}
