// v0.47.0 (Expérimental): the Coffre's learning (ADR 0061) — the rules kept
// (« Prêt pour la synchro »: UUID, dates, tombstones, journal, SyncStore),
// what a placement teaches (a deposit, a change of context, a nature chosen),
// and Réglages › Coffre › « Ce que le Coffre a appris » (change, delete,
// « Tout oublier » confirmed).
import {
  HttpError,
  requestBody,
  SYNC_COLUMNS,
  type ModuleContext,
  type SyncStore,
} from '@hub/sdk/core';
import { confidenceOf, lessonsOf, sure, type LearnedRule, type Placement } from '../shared/learn';
import type { LearnedRuleDto } from '../shared/types';

export const RULES_MIGRATION_SQL = (table: string) => `
  CREATE TABLE ${table} (
    ${SYNC_COLUMNS},
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    misses INTEGER NOT NULL DEFAULT 0,
    last_at TEXT
  );
  CREATE INDEX ${table}_key ON ${table} (kind, key);
`;

interface RuleRow extends LearnedRule {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  last_at: string | null;
}

export class Learner {
  private readonly table: string;
  constructor(
    private readonly ctx: ModuleContext,
    private readonly store: SyncStore,
    /** A context's path, or null when it is gone. */
    private readonly pathOf: (contextId: string) => string[] | null,
  ) {
    this.table = ctx.db.table('rules');
  }

  rules(): LearnedRule[] {
    return this.ctx.db
      .prepare(`SELECT * FROM ${this.table} WHERE deleted_at IS NULL`)
      .all() as RuleRow[];
  }

  /**
   * A placement Thomas made (or accepted): the rules that agree are confirmed,
   * those with the same key and another value are corrected.
   */
  learn(p: Placement): void {
    const now = new Date().toISOString();
    this.ctx.db.transaction(() => {
      for (const lesson of lessonsOf(p)) {
        const same = this.ctx.db
          .prepare(`SELECT * FROM ${this.table} WHERE deleted_at IS NULL AND kind = ? AND key = ?`)
          .all(lesson.kind, lesson.key) as RuleRow[];
        let agreed = false;
        for (const r of same) {
          if (r.value === lesson.value) {
            agreed = true;
            this.store.update('rules', r.id, { hits: r.hits + 1, last_at: now });
          } else this.store.update('rules', r.id, { misses: r.misses + 1, last_at: now });
        }
        if (!agreed)
          this.store.create('rules', {
            kind: lesson.kind,
            key: lesson.key,
            value: lesson.value,
            hits: 1,
            misses: 0,
            last_at: now,
          });
      }
    });
  }

  dtos(): LearnedRuleDto[] {
    const rows = this.ctx.db
      .prepare(`SELECT * FROM ${this.table} WHERE deleted_at IS NULL ORDER BY kind, key`)
      .all() as RuleRow[];
    return rows.map((r) => {
      const contextId = r.kind === 'ext' ? r.key.slice(0, r.key.indexOf(':')) : r.value;
      return {
        id: r.id,
        kind: r.kind,
        key: r.kind === 'ext' ? r.key.slice(r.key.indexOf(':') + 1) : r.key,
        contextId,
        contextPath: this.pathOf(contextId),
        nature: r.kind === 'ext' ? r.value : null,
        hits: r.hits,
        misses: r.misses,
        confidence: Math.round(confidenceOf(r) * 100) / 100,
        active: sure(r),
        lastAt: r.last_at,
      };
    });
  }

  register(): void {
    const { ctx, store } = this;
    ctx.routes.get('/learned', () => this.dtos());
    /** Changes what a rule gives (another context, another nature): Thomas's word, sure at once. */
    ctx.routes.patch('/learned/:id', (request) => {
      const { id } = request.params as { id: string };
      const row = store.get<RuleRow>('rules', id);
      if (!row) throw new HttpError(404, 'Règle introuvable');
      const b = requestBody(request);
      if (row.kind === 'ext') {
        const nature = String(b.nature ?? '').trim();
        if (!nature) throw new HttpError(400, 'Nature vide');
        store.update('rules', id, {
          value: nature.slice(0, 200),
          hits: Math.max(row.hits, 2),
          misses: 0,
        });
      } else {
        const contextId = String(b.contextId ?? '');
        if (!this.pathOf(contextId)) throw new HttpError(404, 'Contexte introuvable');
        store.update('rules', id, { value: contextId, hits: Math.max(row.hits, 2), misses: 0 });
      }
      return this.dtos().find((r) => r.id === id);
    });
    ctx.routes.delete('/learned/:id', (request) => {
      const { id } = request.params as { id: string };
      if (!store.get('rules', id)) throw new HttpError(404, 'Règle introuvable');
      store.remove('rules', id);
      return { ok: true };
    });
    /** « Tout oublier » (only when the page confirmed). */
    ctx.routes.post('/learned/forget', (request) => {
      if (requestBody(request).confirm !== true)
        throw new HttpError(400, 'Tout oublier : confirmation nécessaire');
      const ids = this.rules().map((r) => r.id);
      ctx.db.transaction(() => {
        for (const id of ids) store.remove('rules', id);
      });
      ctx.logger.info(`Apprentissage du Coffre oublié (${ids.length} règles)`);
      return { forgotten: ids.length };
    });
  }
}
