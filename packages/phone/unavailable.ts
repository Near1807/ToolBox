// What the phone does not provide: an explicit French error, never a silent
// fake success (ADR 0044). Portable: no Node import.

/** A capability of `ctx` the phone does not provide (yet). */
export class UnavailableOnPhoneError extends Error {
  constructor(what: string) {
    super(`« ${what} » n’est pas disponible sur le téléphone.`);
    this.name = 'UnavailableOnPhoneError';
  }
}

/** Every member of this part of `ctx` throws the explicit error when used. */
export function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      // Not a member: what JavaScript itself asks (await, inspection).
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      throw new UnavailableOnPhoneError(`ctx.${name}.${prop}`);
    },
  });
}

/**
 * Like `unavailable`, but the members given are provided: the others throw
 * the explicit error (e.g. ctx.files with only saveAs on the phone).
 */
export function partly<T extends object>(name: string, provided: Partial<T>): T {
  return new Proxy(provided as T, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop in target) return (target as Record<string, unknown>)[prop];
      throw new UnavailableOnPhoneError(`ctx.${name}.${prop}`);
    },
  });
}
