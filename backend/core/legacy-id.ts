// The UUID of a row that had a number before (PC only: the migrations of the
// existing modules on Thomas's PC; a new installation, like the phone's, has
// no numbered row to convert).
import { createHash } from 'node:crypto';
import { legacyKey, legacyUuidFromHash } from './legacy-id-core';

/**
 * The UUID given to a row that had a number before (« Prêt pour la synchro »
 * migration of an existing module): always the same for the same installation,
 * kind and number, so that each module computes the new id of a row it
 * references (a task of the To-do in a Timer session) without reading the
 * other module's tables. `seed` is the installation's id (`core__meta`),
 * `kind` names the table, e.g. « todo:task ». Format of a UUID version 8
 * (RFC 9562: built by the application), never equal to a random v4 one.
 */
export function legacyUuid(seed: string, kind: string, oldId: number): string {
  return legacyUuidFromHash(
    createHash('sha256')
      .update(legacyKey(seed, kind, oldId))
      .digest('hex'),
  );
}
