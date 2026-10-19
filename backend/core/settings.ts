import path from 'node:path';
import type { SettingField, SettingValue } from '../../packages/sdk/manifest';
import type { DatabaseHandle } from './database';
import type { EventBus } from './events';
import type { HostAdapter } from './host';

export const SETTINGS_CHANGED_EVENT = 'core:settings.changed';

export interface SettingsSectionField {
  field: SettingField;
  /** Current value (null for secrets, see isSet). */
  value: SettingValue;
  isSet: boolean;
}

export interface SettingsSection {
  scope: string;
  title: string;
  fields: SettingsSectionField[];
}

export class SettingsValidationError extends Error {
  readonly statusCode = 400;
}

interface Row {
  value: string | null;
  encrypted: number;
}

/** Stores settings of the core and of every module (table core__settings). */
export class SettingsStore {
  private readonly sections = new Map<string, { title: string; fields: SettingField[] }>();

  constructor(
    private readonly handle: DatabaseHandle,
    private readonly host: HostAdapter,
    private readonly bus: EventBus,
  ) {}

  register(scope: string, title: string, fields: SettingField[]): void {
    this.sections.set(scope, { title, fields });
  }

  unregister(scope: string): void {
    this.sections.delete(scope);
  }

  private field(scope: string, key: string): SettingField {
    const field = this.sections.get(scope)?.fields.find((f) => f.key === key);
    if (!field) throw new SettingsValidationError(`Réglage inconnu « ${scope}.${key} »`);
    return field;
  }

  private row(scope: string, key: string): Row | undefined {
    return this.handle.db
      .prepare('SELECT value, encrypted FROM core__settings WHERE scope = ? AND key = ?')
      .get(scope, key) as Row | undefined;
  }

  get(scope: string, key: string): SettingValue {
    const field = this.field(scope, key);
    const row = this.row(scope, key);
    if (!row || row.value === null) {
      return 'default' in field && field.default !== undefined ? field.default : null;
    }
    if (row.encrypted) return this.host.decryptString(Buffer.from(row.value, 'base64'));
    return JSON.parse(row.value) as SettingValue;
  }

  set(scope: string, key: string, value: SettingValue): void {
    const field = this.field(scope, key);
    const normalized = validateSettingValue(field, value);
    const now = new Date().toISOString();
    if (normalized === null) {
      this.handle.db
        .prepare('DELETE FROM core__settings WHERE scope = ? AND key = ?')
        .run(scope, key);
    } else if (field.type === 'secret') {
      if (!this.host.isEncryptionAvailable()) {
        throw new SettingsValidationError(
          'Chiffrement indisponible : impossible d’enregistrer un secret hors de l’application',
        );
      }
      const encrypted = this.host.encryptString(String(normalized)).toString('base64');
      this.upsert(scope, key, encrypted, 1, now);
    } else {
      this.upsert(scope, key, JSON.stringify(normalized), 0, now);
    }
    this.bus.emit(SETTINGS_CHANGED_EVENT, { scope, key });
  }

  /** Validates every value first, then saves them all (or none). */
  update(scope: string, values: Record<string, unknown>): void {
    if (!this.sections.has(scope))
      throw new SettingsValidationError(`Section inconnue « ${scope} »`);
    const entries = Object.entries(values).map(([key, value]) => {
      validateSettingValue(this.field(scope, key), value as SettingValue);
      return [key, value as SettingValue] as const;
    });
    this.handle.db.transaction(() => {
      for (const [key, value] of entries) this.set(scope, key, value);
    })();
  }

  describe(): SettingsSection[] {
    return [...this.sections.entries()].map(([scope, section]) => ({
      scope,
      title: section.title,
      fields: section.fields.map((field) => {
        if (field.type === 'secret') {
          return { field, value: null, isSet: Boolean(this.row(scope, field.key)?.value) };
        }
        const isSet = this.row(scope, field.key) !== undefined;
        return { field, value: this.get(scope, field.key), isSet };
      }),
    }));
  }

  private upsert(scope: string, key: string, value: string, encrypted: number, now: string): void {
    this.handle.db
      .prepare(
        `INSERT INTO core__settings (scope, key, value, encrypted, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value,
           encrypted = excluded.encrypted, updated_at = excluded.updated_at`,
      )
      .run(scope, key, value, encrypted, now);
  }
}

/** Returns the normalized value, or null to reset to the default. Throws if invalid. */
export function validateSettingValue(field: SettingField, value: SettingValue): SettingValue {
  if (value === null || value === undefined) return null;
  const invalid = (reason: string) => new SettingsValidationError(`« ${field.label} » : ${reason}`);

  switch (field.type) {
    case 'string':
    case 'text':
    case 'secret':
      if (typeof value !== 'string') throw invalid('texte attendu');
      if (value.length > 10_000) throw invalid('texte trop long');
      return field.type === 'secret' && value === '' ? null : value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('nombre attendu');
      if (field.min !== undefined && value < field.min) throw invalid(`minimum ${field.min}`);
      if (field.max !== undefined && value > field.max) throw invalid(`maximum ${field.max}`);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw invalid('oui/non attendu');
      return value;
    case 'select':
      if (typeof value !== 'string' || !field.options.some((o) => o.value === value)) {
        throw invalid('choix invalide');
      }
      return value;
    case 'folder':
      if (typeof value !== 'string' || !path.isAbsolute(value)) throw invalid('dossier invalide');
      return value;
  }
}
