import { z } from 'zod';
import type { ModuleManifest } from '../../../packages/sdk/manifest';

export const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Ids the hub keeps for itself (API scopes, event sources, table prefixes). */
export const RESERVED_IDS = new Set([
  'core',
  'hub',
  'api',
  'settings',
  'jobs',
  'logs',
  'accounts',
  'notifications',
]);

const id = z.string().regex(MODULE_ID, 'identifiant en kebab-case attendu (ex. « music-library »)');
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'clé de réglage invalide');
const base = {
  key,
  label: z.string().min(1),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
};

const settingField = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.enum(['string', 'text']),
    placeholder: z.string().optional(),
    default: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    default: z.number().optional(),
  }),
  z.object({ ...base, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({
    ...base,
    type: z.literal('select'),
    options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
    default: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal('secret') }),
  z.object({ ...base, type: z.literal('folder'), default: z.string().optional() }),
  z.object({
    ...base,
    type: z.literal('weekdays'),
    default: z
      .string()
      .regex(/^([1-7](,[1-7])*)?$/)
      .optional(),
  }),
]);

const manifestSchema = z.strictObject({
  $schema: z.string().optional(),
  id,
  name: z.string().min(1),
  description: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version sémantique attendue (ex. « 1.0.0 »)'),
  section: z.string().min(1),
  icon: z.string().min(1),
  order: z.number().optional(),
  experimental: z.boolean().optional(),
  dependsOn: z
    .strictObject({
      modules: z.array(id).optional(),
      services: z.array(z.string()).optional(),
      optionalServices: z.array(z.string()).optional(),
    })
    .optional(),
  provides: z.strictObject({ services: z.array(z.string()).optional() }).optional(),
  permissions: z
    .strictObject({
      accounts: z
        .array(
          z.enum(['google'], { message: 'fournisseur de compte inconnu (« google » attendu)' }),
        )
        .optional(),
      assistant: z.boolean().optional(),
      globalKeys: z.boolean().optional(),
    })
    .optional(),
  backup: z
    .strictObject({
      exclude: z
        .array(
          z
            .string()
            .regex(
              /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i,
              'chemin relatif au dossier de données du module attendu (ex. « models »)',
            ),
        )
        .optional(),
    })
    .optional(),
  settings: z.array(settingField).optional(),
});

export class ManifestError extends Error {}

/** Validates a parsed module.json. Throws ManifestError with a French, readable message. */
export function validateManifest(raw: unknown, expectedId?: string): ModuleManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' ; ');
    throw new ManifestError(`module.json invalide — ${details}`);
  }
  const manifest = parsed.data;
  if (expectedId !== undefined && manifest.id !== expectedId) {
    throw new ManifestError(
      `module.json : l'id « ${manifest.id} » doit être identique au nom du dossier (« ${expectedId} »)`,
    );
  }
  if (RESERVED_IDS.has(manifest.id)) {
    throw new ManifestError(`module.json : l'id « ${manifest.id} » est réservé par le hub`);
  }
  const keys = (manifest.settings ?? []).map((field) => field.key);
  const duplicate = keys.find((k, index) => keys.indexOf(k) !== index);
  if (duplicate)
    throw new ManifestError(`module.json : réglage « ${duplicate} » déclaré deux fois`);
  return manifest as ModuleManifest;
}
