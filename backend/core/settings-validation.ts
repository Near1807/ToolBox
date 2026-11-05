// Validation of a setting's value, PORTABLE part (ADR 0044): the phone checks
// its settings with the same rules as the PC. Re-exported by ./settings.ts.
import type { SettingField, SettingValue } from '../../packages/sdk/manifest';

export class SettingsValidationError extends Error {
  readonly statusCode = 400;
}

/** Returns the normalized value, or null to reset to the default. Throws if invalid. */
export function validateSettingValue(
  field: SettingField,
  value: SettingValue,
  /** Whether a folder path is absolute (the PC: Node's path.isAbsolute). */
  isAbsolutePath: (value: string) => boolean,
): SettingValue {
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
      if (typeof value !== 'string' || !isAbsolutePath(value)) throw invalid('dossier invalide');
      return value;
    case 'weekdays': {
      if (typeof value !== 'string' || !/^([1-7](,[1-7])*)?$/.test(value)) {
        throw invalid('jours invalides');
      }
      const days = [...new Set(value.split(',').filter(Boolean).map(Number))].sort();
      if (days.length === 0) throw invalid('au moins un jour');
      return days.join(',');
    }
  }
}
