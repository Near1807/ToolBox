import { useState } from 'react';
import { api, Button, errorMessage, type SettingField, type SettingValue } from '@hub/sdk/frontend';

export interface SettingsSectionData {
  scope: string;
  title: string;
  fields: { field: SettingField; value: SettingValue; isSet: boolean }[];
}

/** Form generated from a settings schema (core or module manifest). */

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function SettingsForm(props: { section: SettingsSectionData; onSaved: () => void }) {
  const { section } = props;
  const initial = Object.fromEntries(section.fields.map((f) => [f.field.key, f.value]));
  const [values, setValues] = useState<Record<string, SettingValue>>(initial);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = (key: string, value: SettingValue) => {
    setValues((v) => ({ ...v, [key]: value }));
    setChanged((c) => new Set(c).add(key));
    setStatus(null);
  };

  // An empty secret field means "keep the stored secret", not "erase it".
  const discard = (key: string) => {
    setValues((v) => ({ ...v, [key]: null }));
    setChanged((c) => {
      const next = new Set(c);
      next.delete(key);
      return next;
    });
  };

  const save = async () => {
    const payload = Object.fromEntries([...changed].map((key) => [key, values[key] ?? null]));
    try {
      await api.put(`/api/core/settings/${section.scope}`, payload);
      setChanged(new Set());
      setStatus({ ok: true, message: 'Enregistré.' });
      props.onSaved();
    } catch (error) {
      setStatus({ ok: false, message: errorMessage(error) });
    }
  };

  const chooseFolder = async (key: string, label: string) => {
    const current = values[key];
    const { folder } = await api.post<{ folder: string | null }>(
      '/api/core/dialogs/select-folder',
      {
        title: label,
        defaultPath: typeof current === 'string' ? current : undefined,
      },
    );
    if (folder) update(key, folder);
  };

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {section.fields.map(({ field, isSet }) => {
        const value = values[field.key];
        const id = `${section.scope}-${field.key}`;
        let input;
        switch (field.type) {
          case 'string':
            input = (
              <input
                id={id}
                className="input"
                value={typeof value === 'string' ? value : ''}
                placeholder={field.placeholder}
                onChange={(e) => update(field.key, e.target.value)}
              />
            );
            break;
          case 'text':
            input = (
              <textarea
                id={id}
                className="input"
                rows={4}
                value={typeof value === 'string' ? value : ''}
                placeholder={field.placeholder}
                onChange={(e) => update(field.key, e.target.value)}
              />
            );
            break;
          case 'number':
            input = (
              <input
                id={id}
                className="input input--short"
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={typeof value === 'number' ? value : ''}
                onChange={(e) =>
                  update(field.key, e.target.value === '' ? null : Number(e.target.value))
                }
              />
            );
            break;
          case 'boolean':
            input = (
              <input
                id={id}
                type="checkbox"
                checked={value === true}
                onChange={(e) => update(field.key, e.target.checked)}
              />
            );
            break;
          case 'select':
            input = (
              <select
                id={id}
                className="input"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => update(field.key, e.target.value)}
              >
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case 'secret':
            input = (
              <span className="inline-form">
                <input
                  id={id}
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={typeof value === 'string' ? value : ''}
                  placeholder={isSet ? '•••••••• (enregistré, laisser vide pour conserver)' : ''}
                  onChange={(e) =>
                    e.target.value === '' ? discard(field.key) : update(field.key, e.target.value)
                  }
                />
                {isSet && (
                  <Button variant="secondary" small onClick={() => update(field.key, '')}>
                    Effacer
                  </Button>
                )}
              </span>
            );
            break;
          case 'weekdays': {
            const days = new Set(
              (typeof value === 'string' ? value : '').split(',').filter(Boolean).map(Number),
            );
            input = (
              <span id={id} className="settings-form__days" role="group" aria-label={field.label}>
                {WEEKDAYS.map((name, index) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={days.has(index + 1)}
                      onChange={(e) => {
                        const next = new Set(days);
                        if (e.target.checked) next.add(index + 1);
                        else next.delete(index + 1);
                        update(field.key, [...next].sort().join(','));
                      }}
                    />
                    {name}
                  </label>
                ))}
              </span>
            );
            break;
          }
          case 'folder':
            input = (
              <span className="inline-form">
                <input
                  id={id}
                  className="input"
                  readOnly
                  value={typeof value === 'string' ? value : ''}
                />
                <Button
                  variant="secondary"
                  small
                  onClick={() => void chooseFolder(field.key, field.label)}
                >
                  Choisir…
                </Button>
              </span>
            );
            break;
        }
        return (
          <div key={field.key} className="settings-form__field">
            <label htmlFor={id}>{field.label}</label>
            {input}
            {field.description && <p className="muted settings-form__help">{field.description}</p>}
          </div>
        );
      })}
      <div className="settings-form__actions">
        <Button type="submit" disabled={changed.size === 0}>
          Enregistrer
        </Button>
        {status && <span className={status.ok ? 'success' : 'error'}>{status.message}</span>}
      </div>
    </form>
  );
}
