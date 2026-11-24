// v0.47.0 (Expérimental): what the Coffre learns from Thomas's choices (ADR
// 0061) — simple rules, each with how often it was confirmed and how often
// it was corrected:
//   site → context        (« moodle.ecam.be » → Cours › Réseaux)
//   word → context        (a word or a course code of the name: « labo », « th2c »)
//   ext in context → nature (« .pdf » in Cours › Thermo → « synthèse »)
// A rule proposes only when it is sure enough (confirmed twice, right at
// least 2 times out of 3); its reason is shown on hover. A value Thomas chose
// is never replaced (the proposals stay « deviné »). Pure (tested).
import { wordsOf } from './deduce';
import type { AttributeDto, ProposalDto } from './types';

export type RuleKind = 'site' | 'word' | 'ext';

export interface LearnedRule {
  id: string;
  kind: RuleKind;
  /** The host, the folded word, or « <context id>:<ext> ». */
  key: string;
  /** A context's id (site, word), or a nature (ext). */
  value: string;
  hits: number;
  misses: number;
}

/** Confirmed at least this many times… */
export const MIN_HITS = 2;
/** …and right this often (confirmations / (confirmations + corrections)). */
export const MIN_CONFIDENCE = 0.66;

export const confidenceOf = (r: Pick<LearnedRule, 'hits' | 'misses'>) =>
  r.hits + r.misses ? r.hits / (r.hits + r.misses) : 0;
export const sure = (r: LearnedRule) => r.hits >= MIN_HITS && confidenceOf(r) >= MIN_CONFIDENCE;

/** Words that say nothing about a place (French and English, a file's usual words). */
const STOP = new Set(
  (
    'les des une pour par sur dans avec sans aux est son ses the and for with from copie copy ' +
    'final finale version new nouveau nouvelle document doc fichier file scan img image photo ' +
    'screenshot capture partie part page pages draft brouillon test tmp'
  ).split(' '),
);

/** The words of a name that may say where it goes (3 letters at least, not a year nor a number). */
export function placeWords(name: string): string[] {
  return [
    ...new Set(
      wordsOf(name).filter(
        (w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !/^(19|20)\d\d/.test(w),
      ),
    ),
  ].slice(0, 8);
}

export interface Placement {
  name: string;
  /** The site it was downloaded from (Mark of the Web), if any. */
  site: string | null;
  ext: string;
  /** Where it was put (null: Arrivée, nothing learned for the context). */
  contextId: string | null;
  /** Its nature as kept (chosen, or the guess Thomas left), if any. */
  nature: string | null;
}

/** What a placement teaches: each rule's key, and the value Thomas gave. */
export function lessonsOf(p: Placement): { kind: RuleKind; key: string; value: string }[] {
  const out: { kind: RuleKind; key: string; value: string }[] = [];
  if (p.contextId) {
    if (p.site) out.push({ kind: 'site', key: p.site, value: p.contextId });
    for (const w of placeWords(p.name)) out.push({ kind: 'word', key: w, value: p.contextId });
    if (p.nature && p.ext)
      out.push({ kind: 'ext', key: `${p.contextId}:${p.ext}`, value: p.nature });
  }
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * The context the rules propose for a file (site first, then the name's
 * words: the surest), with its reason; null when no rule is sure.
 */
export function contextFromRules(
  rules: readonly LearnedRule[],
  input: { name: string; site: string | null },
  labelOf: (contextId: string) => string | null,
): { contextId: string; reason: string } | null {
  if (input.site) {
    const r = rules
      .filter((x) => x.kind === 'site' && x.key === input.site && sure(x) && labelOf(x.value))
      .sort((a, b) => confidenceOf(b) - confidenceOf(a) || b.hits - a.hits)[0];
    if (r)
      return {
        contextId: r.value,
        reason: `${plural(r.hits, 'fichier')} de ce site rangé${r.hits > 1 ? 's' : ''} dans « ${labelOf(r.value)} » (appris)`,
      };
  }
  const words = new Set(placeWords(input.name));
  const r = rules
    .filter((x) => x.kind === 'word' && words.has(x.key) && sure(x) && labelOf(x.value))
    .sort((a, b) => confidenceOf(b) - confidenceOf(a) || b.hits - a.hits)[0];
  if (r)
    return {
      contextId: r.value,
      reason: `« ${r.key} » dans le nom : ${plural(r.hits, 'fichier')} rangé${r.hits > 1 ? 's' : ''} dans « ${labelOf(r.value)} » (appris)`,
    };
  return null;
}

/** The nature the rules propose for an extension in a context, with its reason. */
export function natureFromRules(
  rules: readonly LearnedRule[],
  contextId: string | null,
  ext: string,
  labelOf: (contextId: string) => string | null,
): { nature: string; reason: string } | null {
  if (!contextId || !ext) return null;
  const r = rules
    .filter((x) => x.kind === 'ext' && x.key === `${contextId}:${ext}` && sure(x))
    .sort((a, b) => confidenceOf(b) - confidenceOf(a) || b.hits - a.hits)[0];
  if (!r) return null;
  return {
    nature: r.value,
    reason: `${plural(r.hits, 'fichier')} .${ext} de « ${labelOf(contextId) ?? 'ce contexte'} » ${r.hits > 1 ? 'sont' : 'est'} « ${r.value} » (appris)`,
  };
}

/**
 * The proposal with what was learned: a sure rule's context first (it comes
 * from Thomas's own choices), then the nature of that extension in that
 * context. Only « deviné » values change; the reasons say « appris ».
 */
export function applyRules(
  proposal: Pick<ProposalDto, 'context' | 'attributes'>,
  rules: readonly LearnedRule[],
  input: { name: string; site: string | null; ext: string },
  pathOf: (contextId: string) => string[] | null,
): Pick<ProposalDto, 'context' | 'attributes'> {
  const labelOf = (id: string) => pathOf(id)?.join(' › ') ?? null;
  let context = proposal.context;
  const learned = contextFromRules(rules, input, labelOf);
  if (learned) {
    const path = pathOf(learned.contextId)!;
    context = { kind: 'existing', id: learned.contextId, path, reason: learned.reason };
  }
  let attributes: AttributeDto[] = proposal.attributes;
  const nature = natureFromRules(
    rules,
    context?.kind === 'existing' ? context.id : null,
    input.ext,
    labelOf,
  );
  if (nature)
    attributes = [
      ...attributes.filter((a) => a.key !== 'nature' || a.origin === 'chosen'),
      ...(attributes.some((a) => a.key === 'nature' && a.origin === 'chosen')
        ? []
        : [
            {
              key: 'nature' as const,
              value: nature.nature,
              origin: 'guessed' as const,
              reason: nature.reason,
            },
          ]),
    ];
  return { context, attributes };
}
