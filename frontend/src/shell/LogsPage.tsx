import { useState } from 'react';
import { Button, ErrorMessage, Page, useApi } from '@hub/sdk/frontend';
import { useModules } from '../modules/ModulesContext';
import { formatDateTime } from './format';

interface LogEntry {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  data?: unknown;
}

const LEVEL_LABELS = { debug: 'Débogage', info: 'Info', warn: 'Avertissement', error: 'Erreur' };

export function LogsPage() {
  const { modules } = useModules();
  const [source, setSource] = useState('');
  const [level, setLevel] = useState<LogEntry['level']>('info');
  const query = new URLSearchParams({ level, limit: '500' });
  if (source) query.set('source', source);
  const logs = useApi<LogEntry[]>(`/api/core/logs?${query.toString()}`);
  const sourceName = (id: string) =>
    id === 'core' ? 'Socle' : (modules.find((m) => m.id === id)?.manifest.name ?? id);

  return (
    <Page
      title="Journaux"
      subtitle="Ce que font le hub et ses modules (14 derniers jours)."
      actions={
        <Button variant="secondary" onClick={logs.reload}>
          Actualiser
        </Button>
      }
    >
      <div className="toolbar">
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Toutes les sources</option>
          <option value="core">Socle</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manifest.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={level}
          onChange={(e) => setLevel(e.target.value as LogEntry['level'])}
        >
          {Object.entries(LEVEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label} et plus
            </option>
          ))}
        </select>
      </div>
      {logs.error && <ErrorMessage>{logs.error}</ErrorMessage>}
      <table className="log-table">
        <tbody>
          {logs.data?.map((entry, index) => (
            <tr key={index} className={`log-table__row log-table__row--${entry.level}`}>
              <td className="muted nowrap">{formatDateTime(entry.ts)}</td>
              <td className="nowrap">{LEVEL_LABELS[entry.level]}</td>
              <td className="nowrap">{sourceName(entry.source)}</td>
              <td>
                {entry.message}
                {entry.data !== undefined && (
                  <details>
                    <summary className="muted">Détails</summary>
                    <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.data?.length === 0 && <p className="muted">Aucune entrée.</p>}
    </Page>
  );
}
