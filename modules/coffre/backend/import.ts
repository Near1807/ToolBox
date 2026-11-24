// v0.48.0 (Expérimental): importing an existing arborescence (ADR 0065) —
// its sub-folders become contexts, its files go to the right place, a code
// project stays ONE element. The import runs in the background (progress,
// cancel, resumed after a restart): its state is kept in this table, on
// this PC only (never synchronised).

/** Migration 7: the imports of this PC (one line per import, its plan and progress). */
export const IMPORTS_MIGRATION_SQL = (t: string) => `
  CREATE TABLE ${t} (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    bytes_done INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    created_json TEXT NOT NULL DEFAULT '[]',
    error TEXT
  );
`;
