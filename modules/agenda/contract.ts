// Public types of the Agenda's service `agenda` (types only: the only import
// allowed between modules, docs/MODULES.md §5.8). v0.45.0, read only.

/** A course of the imported timetables (ICS, CSV, Excel): what other tools may recognise. */
export interface AgendaCourse {
  /** Its name (« Thermo »), as the Agenda shows it. */
  name: string;
  /** Its code in the school's file (« TH2C »), or null. */
  code: string | null;
  /** Its teachers' names or initials (the file's « Ens: » lines), sorted. */
  teachers: string[];
  /** Its next occurrence from now, or null. */
  next: { start: string; end: string; location: string | null } | null;
}

export interface AgendaService {
  /** The courses of the imported timetables (read only; nothing is written). */
  courses(): AgendaCourse[];
}
