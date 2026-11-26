// v0.50.0 (Expérimental, ADR 0067): a folder's DEFAULT LABELS (set in its
// header; proposed to the files put in it and its sub-folders — the nearest
// wins —, never applied to the files already there without a click:
// « Appliquer aux fichiers déjà présents », preview first, « Annuler »), and the
// NAMED SETS of labels (« Slides de cours »: made from a file or a folder,
// reused in one click, renamed, deleted).
import { useState } from 'react';
import { Button, Icon, useApi, useModule } from '@hub/sdk/frontend';
import {
  FAMILY_NAMES,
  LABEL_FAMILIES,
  type FolderDto,
  type LabelFamily,
  type LabelSetDto,
  type LabelValue,
} from '../shared/types';
import { useCoffre } from './frame';
import { labelsText } from './NewItem';
import { Picker } from './Picker';
import { labelOptions } from './Sheet';

/** Labels as chips, each removable, a family + value added with the pickers. */
function LabelChips(props: { labels: LabelValue[]; onChange: (labels: LabelValue[]) => void }) {
  const { values } = useCoffre();
  const [family, setFamily] = useState<LabelFamily | null>(null);
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="coffre-chips" data-coffre-label-chips>
      {props.labels.map((l) => (
        <span key={`${l.family}:${l.value}`} className="coffre-value">
          <span className="coffre-value__text">
            {l.family === 'free' ? l.value : `${FAMILY_NAMES[l.family]} : ${l.value}`}
          </span>
          <button
            type="button"
            className="coffre-value__remove"
            aria-label={`Retirer « ${l.value} »`}
            onClick={() => props.onChange(props.labels.filter((x) => x !== l))}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="coffre-sheet__pick coffre-sheet__pick--empty"
        onClick={() => setChoosing(true)}
        aria-label="Ajouter une étiquette"
      >
        + étiquette
      </button>
      {choosing && !family && (
        <Picker
          label="Famille"
          options={LABEL_FAMILIES.map((f) => ({ value: f, label: FAMILY_NAMES[f] }))}
          onClose={() => setChoosing(false)}
          onPick={(f) => setFamily(f as LabelFamily)}
        />
      )}
      {family && (
        <Picker
          label={FAMILY_NAMES[family]}
          options={labelOptions(family, values)}
          createLabel={(t) => `Ajouter « ${t} »`}
          onClose={() => {
            setFamily(null);
            setChoosing(false);
          }}
          onPick={(value) => {
            const next = [...props.labels];
            if (!next.some((l) => l.family === family && l.value === value))
              next.push({ family, value });
            props.onChange(next);
            setFamily(null);
            setChoosing(false);
          }}
        />
      )}
    </div>
  );
}

/** The named sets, to reuse one in a click (or manage them). */
export function SetPicker(props: {
  onPick: (set: LabelSetDto) => void;
  /** « Enregistrer comme ensemble… » from these labels (none: not offered). */
  saveFrom?: LabelValue[];
}) {
  const module = useModule();
  const coffre = useCoffre();
  const sets = useApi<LabelSetDto[]>(module.url('/label-sets'));
  const [open, setOpen] = useState(false);
  const list = sets.data ?? [];
  const save = async () => {
    const name = window.prompt('Nom de l’ensemble (« Slides de cours »)');
    if (!name?.trim() || !props.saveFrom?.length) return;
    try {
      await coffre.api.post('/label-sets', { name, labels: props.saveFrom });
      coffre.notify(`Ensemble « ${name.trim()} » enregistré.`);
      sets.reload();
    } catch (e) {
      coffre.fail(e);
    }
  };
  const rename = async (s: LabelSetDto) => {
    const name = window.prompt('Nouveau nom de l’ensemble', s.name);
    if (!name?.trim() || name.trim() === s.name) return;
    try {
      await coffre.api.patch(`/label-sets/${s.id}`, { name });
      sets.reload();
    } catch (e) {
      coffre.fail(e);
    }
  };
  const remove = async (s: LabelSetDto) => {
    try {
      const r = await coffre.api.delete<{ undoId: string }>(`/label-sets/${s.id}`);
      coffre.notify(`Ensemble « ${s.name} » supprimé.`, r.undoId);
      sets.reload();
    } catch (e) {
      coffre.fail(e);
    }
  };
  return (
    <span className="coffre-sets">
      <Button variant="secondary" small onClick={() => setOpen(!open)} aria-expanded={open}>
        Ensembles…
      </Button>
      {open && (
        <div className="coffre-sets__box" role="dialog" aria-label="Ensembles d’étiquettes">
          {!list.length && <p className="muted small">Aucun ensemble enregistré.</p>}
          {list.map((s) => (
            <div key={s.id} className="coffre-sets__row" data-coffre-set={s.name}>
              <button
                type="button"
                className="coffre-linklike"
                title={labelsText(s.labels)}
                onClick={() => {
                  props.onPick(s);
                  setOpen(false);
                }}
              >
                {s.name}
              </button>
              <span className="muted small">{labelsText(s.labels)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Renommer « ${s.name} »`}
                onClick={() => void rename(s)}
              >
                <Icon name="pencil" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Supprimer « ${s.name} »`}
                onClick={() => void remove(s)}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
          {props.saveFrom && props.saveFrom.length > 0 && (
            <Button variant="secondary" small onClick={() => void save()}>
              Enregistrer celles-ci comme ensemble…
            </Button>
          )}
        </div>
      )}
    </span>
  );
}

/** A folder's default labels, in its header. */
export function DefaultLabels(props: { folder: FolderDto }) {
  const coffre = useCoffre();
  const f = props.folder;
  const save = async (labels: LabelValue[]) => {
    try {
      const r = await coffre.api.patch<{ undoId: string }>(`/folders/${f.id}`, {
        defaults: labels,
      });
      coffre.notify(
        labels.length
          ? `Étiquettes par défaut de « ${f.name} » : ${labelsText(labels)}.`
          : `« ${f.name} » n’a plus d’étiquettes par défaut.`,
        r.undoId,
      );
      coffre.refresh();
    } catch (e) {
      coffre.fail(e);
    }
  };
  const applyExisting = async () => {
    try {
      const p = await coffre.api.post<{ files: number; sample: string[] }>(
        `/folders/${f.id}/defaults/apply`,
        { preview: true },
      );
      if (!p.files) {
        coffre.notify('Aucun fichier déjà présent à changer.');
        return;
      }
      if (
        !window.confirm(
          `Ajouter ${labelsText(f.defaults)} à ${p.files} fichier${p.files > 1 ? 's' : ''} déjà présent${p.files > 1 ? 's' : ''} ?\n\n${p.sample.join('\n')}${p.files > p.sample.length ? '\n…' : ''}\n\nUne étiquette choisie n’est jamais remplacée. Tu pourras annuler.`,
        )
      )
        return;
      const r = await coffre.api.post<{ files: number; undoId: string }>(
        `/folders/${f.id}/defaults/apply`,
        {},
      );
      coffre.notify(`Étiquettes ajoutées à ${r.files} fichier${r.files > 1 ? 's' : ''}.`, r.undoId);
      coffre.refresh();
    } catch (e) {
      coffre.fail(e);
    }
  };
  return (
    <section className="coffre-defaults" aria-label="Étiquettes par défaut" data-coffre-defaults>
      <span className="coffre-defaults__label">
        Étiquettes par défaut <span className="badge badge--warning">Expérimental</span>
      </span>
      <LabelChips labels={f.defaults} onChange={(l) => void save(l)} />
      <SetPicker
        saveFrom={f.defaults}
        onPick={(s) => {
          const next = [...f.defaults];
          for (const l of s.labels)
            if (!next.some((x) => x.family === l.family && x.value === l.value)) next.push(l);
          void save(next);
        }}
      />
      {f.defaults.length > 0 && (
        <Button variant="secondary" small onClick={() => void applyExisting()}>
          Appliquer aux fichiers déjà présents…
        </Button>
      )}
      <p className="muted small">
        Proposées aux fichiers rangés ou créés ici et dans ses sous-dossiers (sauf ceux qui ont les
        leurs), jamais ajoutées aux fichiers déjà là sans ton clic.
      </p>
    </section>
  );
}
