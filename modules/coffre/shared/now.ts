// v0.47.0 (Expérimental): « Maintenant » — which context goes with a course
// of the Agenda. A context may be linked to a course by hand (« Lié au cours
// … », its `courseName`), or to none (« - »); else, automatically, the one
// whose name is the course's name or its code (the deepest). Pure (tested).
import { fold } from './deduce';

/** `courseName` of a context never linked to a course. */
export const NO_COURSE = '-';

export interface ContextForCourse {
  id: string;
  name: string;
  path: string[];
  courseName: string | null;
}

/** Is this context the one of this course (by hand, or by its name / code)? */
export function linkedTo(
  context: Pick<ContextForCourse, 'name' | 'courseName'>,
  course: { name: string; code: string | null },
): 'hand' | 'auto' | null {
  if (context.courseName === NO_COURSE) return null;
  if (context.courseName) return fold(context.courseName) === fold(course.name) ? 'hand' : null;
  const name = fold(context.name);
  return name === fold(course.name) || (course.code !== null && name === fold(course.code))
    ? 'auto'
    : null;
}

/** The context of a course: linked by hand first, else by name / code (the deepest), or null. */
export function contextOfCourse<T extends ContextForCourse>(
  contexts: readonly T[],
  course: { name: string; code: string | null },
): T | null {
  const hand = contexts.find((c) => linkedTo(c, course) === 'hand');
  if (hand) return hand;
  return (
    contexts
      .filter((c) => linkedTo(c, course) === 'auto')
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  );
}
