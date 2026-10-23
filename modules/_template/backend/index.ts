// Backend of the template module. Copy the whole folder to create a new module
// (see docs/AJOUTER-UN-MODULE.md). Everything a module needs comes from `ctx`;
// a module never imports another module or the hub core.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineBackendModule, HttpError } from '@hub/sdk/backend';

interface NoteRow {
  id: number;
  text: string;
  created_at: string;
}

export default defineBackendModule({
  // Applied by the hub before register(), with an automatic backup of hub.db.
  // Table names MUST start with the module prefix ("template__"); a migration
  // touching anything else is refused. Never edit a released migration.
  migrations: [
    {
      version: 1,
      description: 'notes table',
      up: `
        CREATE TABLE template__notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `,
    },
  ],

  register(ctx) {
    const notes = ctx.db.table('notes');

    // Routes are served under /api/modules/template/…
    ctx.routes.get('/notes', () => ctx.db.prepare(`SELECT * FROM ${notes} ORDER BY id DESC`).all());

    ctx.routes.post('/notes', (request) => {
      const text = (request.body as { text?: unknown } | undefined)?.text;
      if (typeof text !== 'string' || text.trim() === '') {
        throw new HttpError(400, 'Le texte de la note est obligatoire');
      }
      const result = ctx.db
        .prepare(`INSERT INTO ${notes} (text, created_at) VALUES (?, ?)`)
        .run(text.trim(), new Date().toISOString());
      const note = ctx.db
        .prepare(`SELECT * FROM ${notes} WHERE id = ?`)
        .get(result.lastInsertRowid) as NoteRow;
      // Other modules can listen to "template:note.created".
      ctx.events.emit('note.created', { id: note.id });
      ctx.logger.info(`Note ${note.id} créée`);
      return note;
    });

    ctx.routes.delete('/notes/:id', (request) => {
      const { id } = request.params as { id: string };
      const result = ctx.db.prepare(`DELETE FROM ${notes} WHERE id = ?`).run(Number(id));
      if (result.changes === 0) throw new HttpError(404, 'Note introuvable');
      return { ok: true };
    });

    // A generated file: written in ctx.files.outputDir() and ALWAYS registered in
    // ctx.outputs, so that it is listed, checked on disk and deletable from the
    // interface (MODULES.md §5.13). `ref` names the element in the module's own terms.
    ctx.routes.post('/notes/:id/export', (request) => {
      const { id } = request.params as { id: string };
      const note = ctx.db.prepare(`SELECT * FROM ${notes} WHERE id = ?`).get(Number(id)) as
        NoteRow | undefined;
      if (!note) throw new HttpError(404, 'Note introuvable');
      const file = path.join(ctx.files.outputDir(), `Note ${note.id}.txt`);
      writeFileSync(file, `${note.text}\n`);
      // `subject`: the project the file belongs to (mandatory). Here the note itself;
      // in the Music section it is the track: `music-library:track:<id>`.
      return ctx.outputs.register({
        path: file,
        ref: `note:${note.id}`,
        subject: `_template:note:${note.id}`,
        label: 'Note exportée',
      });
    });

    // When files are deleted or removed from the lists (here, from the module page,
    // or from the « Fichiers générés » page), the module cleans its own data. The
    // template keeps nothing about its exports: nothing to do.
    ctx.outputs.onRemoved((records, reason) => {
      ctx.logger.info(
        `${records.length} export(s) ${reason === 'deleted' ? 'supprimé(s)' : 'retiré(s)'}`,
      );
    });

    // « Sans projet » > Rattacher (MODULES.md §5.13): the user attaches files of
    // this module to another project. The core record already has the new
    // subject; the module moves its OWN rows the same way (e.g. a track_id
    // column), then calls ctx.outputs.register() again if `parent` changes.
    // Synchronous, in the core's transaction: throw HttpError(409, …) to refuse.
    // The template stores no project for its notes: nothing to move.
    ctx.outputs.onReattach((records, subject) => {
      ctx.logger.info(`${records.length} export(s) rattaché(s) à ${subject}`);
    });

    ctx.routes.get('/summary', () => {
      const { count } = ctx.db.prepare(`SELECT COUNT(*) AS count FROM ${notes}`).get() as {
        count: number;
      };
      return { count, greeting: ctx.settings.get<string>('greeting') };
    });

    // A long task with real progress and cancellation (renders work the same way).
    ctx.jobs.define<{ seconds: number }, { steps: number }>('demo', async (job) => {
      const steps = job.input.seconds * 4;
      for (let step = 1; step <= steps; step++) {
        if (job.signal.aborted) throw new Error('Annulée');
        await new Promise((resolve) => setTimeout(resolve, 250));
        job.progress(step / steps, `Étape ${step} sur ${steps}`);
      }
      return { steps };
    });

    ctx.routes.post('/demo-job', () => {
      const seconds = ctx.settings.get<number>('demoSeconds') ?? 5;
      return ctx.jobs.enqueue('demo', { seconds }, { title: `Démonstration (${seconds} s)` });
    });

    // Periodic task: missed runs are caught up at the next start.
    ctx.scheduler.schedule('daily-summary', { daily: '09:00' }, async () => {
      const { count } = ctx.db.prepare(`SELECT COUNT(*) AS count FROM ${notes}`).get() as {
        count: number;
      };
      ctx.logger.info(`Résumé quotidien : ${count} note(s)`);
    });

    // Assistant actions (MODULES.md §5.15): what the voice assistant may do with
    // this module. The hub enforces the risk level: `read` and `change` run
    // directly (a change returns `undo` for « Annuler »), `destructive` only
    // after the user confirmed (`confirmation`), `sensitive` never (`page`).
    ctx.assistant.define({
      name: 'count-notes',
      description: 'Donne le nombre de notes du module modèle.',
      risk: 'read',
      run: () => {
        const { count } = ctx.db.prepare(`SELECT COUNT(*) AS count FROM ${notes}`).get() as {
          count: number;
        };
        return { message: `${count} note(s).`, data: { count } };
      },
    });
    ctx.assistant.define({
      name: 'add-note',
      description: 'Ajoute une note au module modèle.',
      parameters: {
        text: { type: 'string', description: 'Texte de la note, ex. « appeler Paul »' },
      },
      required: ['text'],
      risk: 'change',
      run: (params) => {
        const result = ctx.db
          .prepare(`INSERT INTO ${notes} (text, created_at) VALUES (?, ?)`)
          .run(String(params.text), new Date().toISOString());
        return {
          message: `J’ai ajouté la note « ${String(params.text)} ».`,
          undo: () =>
            void ctx.db.prepare(`DELETE FROM ${notes} WHERE id = ?`).run(result.lastInsertRowid),
        };
      },
    });

    // Services: declare the name in module.json (provides.services), then
    //   ctx.services.provide('notes', { count: () => … });
    // Consumers declare it in dependsOn.services and call ctx.services.get('notes').
  },
});
