// Test helper shared by the PC's and the phone's table dumps.
/**
 * The synchronisation's bookkeeping, added in v0.32.0 (ADR 0044), left out of
 * the references written before it: the columns `hlc`, `origin` and `seq` of
 * the journals (an HLC depends on the device and the time) and the tables
 * `*__field_clock`. Everything the modules themselves write is still compared.
 */
export function withoutSyncBookkeeping(
  tables: Record<string, unknown[]>,
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    if (name.endsWith('__field_clock')) continue;
    out[name] = name.endsWith('__changes')
      ? rows.map((r) => {
          const { hlc: _h, origin: _o, seq: _s, ...rest } = r as Record<string, unknown>;
          void _h;
          void _o;
          void _s;
          return rest;
        })
      : rows;
  }
  return out;
}
