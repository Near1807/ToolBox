// Text templates shared by every module (titles, descriptions, captions).
// Pure functions, usable in the backend and in the frontend: `@hub/sdk/texts`.
// Placeholders are written {name} (lowercase, digits, underscores).

/**
 * Fills a template: each {name} is replaced by its value; unknown
 * placeholders are kept as is. Runs of blank lines left by empty values
 * collapse to one, and the result is trimmed.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{([a-z0-9_]+)\}/g, (whole, key: string) => values[key] ?? whole)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The reverse of fillTemplate, for « Enregistrer comme modèle par défaut »:
 * every occurrence of a value in the text becomes its {placeholder}, so the
 * template works for the other tracks. Longer values are replaced first (the
 * YouTube title before the title alone); values shorter than 2 characters are
 * ignored (too likely to appear by chance).
 */
export function toTemplate(text: string, values: Record<string, string>): string {
  const entries = Object.entries(values)
    .filter(([, value]) => value.trim().length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  // Mark replaced parts so that a shorter value never matches inside a placeholder.
  const parts: (string | { key: string })[] = [text];
  for (const [key, value] of entries) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part !== 'string' || !part.includes(value)) continue;
      const pieces = part.split(value);
      const replaced: (string | { key: string })[] = [];
      pieces.forEach((piece, index) => {
        if (index > 0) replaced.push({ key });
        if (piece) replaced.push(piece);
      });
      parts.splice(i, 1, ...replaced);
      i += replaced.length - 1;
    }
  }
  return parts.map((part) => (typeof part === 'string' ? part : `{${part.key}}`)).join('');
}

/** "lofi, chill , #beat" → ["lofi", "chill", "beat"] (no "#", no duplicates). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map((tag) => tag.trim().replace(/^#+/, '').trim())
    .filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
}

export function formatTags(tags: string[]): string {
  return tags.join(', ');
}
