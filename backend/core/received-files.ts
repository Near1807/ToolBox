// v0.47.0 (Expérimental): files sent to ToolBox by Windows — the Explorer's
// right click « Ranger dans ToolBox » or « Envoyer vers » (ADR 0059). The
// Explorer starts ToolBox once per file (right click) or once for all of them
// (Envoyer vers); the single instance gets every launch's arguments. What
// arrives within a short wait is ONE batch: one rangement window. The module
// that receives files (one, `ctx.ui.receiveFiles`) answers with the route that
// shows them. Portable: no Node import.

/** The switch the right click and « Envoyer vers » put before the paths. */
export const RECEIVE_SWITCH = '--ranger';

/**
 * The paths given after `--ranger` (null when the launch is not a sending).
 * `ignore`: the app's own folder (Chromium may put the switches before it).
 */
export function pathsFromArgv(
  argv: readonly string[],
  ignore: readonly string[] = [],
): string[] | null {
  const at = argv.indexOf(RECEIVE_SWITCH);
  if (at < 0) return null;
  const skip = new Set(ignore.map((p) => p.replace(/[\\/]+$/, '').toLowerCase()));
  return argv
    .slice(at + 1)
    .filter((a) => a && !a.startsWith('--'))
    .map((a) => a.replace(/^"(.*)"$/, '$1'))
    .filter((a) => !skip.has(a.replace(/[\\/]+$/, '').toLowerCase()));
}

/**
 * Gathers the paths that arrive close together (10 files: 10 launches within
 * a few hundred ms) and gives them once, without duplicates, in their order.
 * `hold()` keeps everything until `release()` (ToolBox still starting).
 */
export class FileBatcher {
  private paths: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = false;

  constructor(
    private readonly flush: (paths: string[]) => void,
    private readonly waitMs = 700,
  ) {}

  add(paths: readonly string[]): void {
    for (const p of paths) if (!this.paths.includes(p)) this.paths.push(p);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.waitMs);
  }

  hold(): void {
    this.held = true;
  }

  release(): void {
    this.held = false;
    if (!this.timer && this.paths.length) this.fire();
  }

  private fire(): void {
    this.timer = null;
    if (this.held || !this.paths.length) return;
    const batch = this.paths;
    this.paths = [];
    this.flush(batch);
  }
}
