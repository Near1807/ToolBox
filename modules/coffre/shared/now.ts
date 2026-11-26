// v0.47.0 (Expérimental): « Maintenant » — which folder goes with a course
// of the Agenda. A folder may be linked to a course by hand (« Lié au cours
// … », its `courseName`), or to none (« - »); else, automatically, the one
// whose name is the course's name or its code (the deepest). Pure (tested).
import { fold } from './deduce';

/** `courseName` of a folder never linked to a course. */
export const NO_COURSE = '-';

export interface FolderForCourse {
  id: string;
  name: string;
  path: string[];
  courseName: string | null;
}

/** Is this folder the one of this course (by hand, or by its name / code)? */
export function linkedTo(
  folder: Pick<FolderForCourse, 'name' | 'courseName'>,
  course: { name: string; code: string | null },
): 'hand' | 'auto' | null {
  if (folder.courseName === NO_COURSE) return null;
  if (folder.courseName) return fold(folder.courseName) === fold(course.name) ? 'hand' : null;
  const name = fold(folder.name);
  return name === fold(course.name) || (course.code !== null && name === fold(course.code))
    ? 'auto'
    : null;
}

/** The folder of a course: linked by hand first, else by name / code (the deepest), or null. */
export function folderOfCourse<T extends FolderForCourse>(
  folders: readonly T[],
  course: { name: string; code: string | null },
): T | null {
  const hand = folders.find((c) => linkedTo(c, course) === 'hand');
  if (hand) return hand;
  return (
    folders
      .filter((c) => linkedTo(c, course) === 'auto')
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null
  );
}
