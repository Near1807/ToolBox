// v0.50.0 (Expérimental, ADR 0067): « Nouveau dossier », « Nouveau fichier… »
// (created EMPTY, the name and extension typed, valid on Windows, never over
// another; then ToolBox proposes to open it: code → VS Code, else its
// application, a program or a script never launched without a confirmation),
// and « Coller les étiquettes » (Ajouter / Remplacer, one « Annuler »).
import { useState } from 'react';
import { runnableQuestion } from '@hub/sdk/core';
import { Button, errorMessage, ErrorMessage } from '@hub/sdk/frontend';
import { invalidName, splitExtension } from '../shared/names';
import { FAMILY_NAMES, type FolderDto, type ItemDto, type LabelValue } from '../shared/types';
import { useCoffre } from './frame';

function Modal(props: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="coffre-modal"
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="coffre-modal__box coffre-question coffre-newitem">{props.children}</div>
    </div>
  );
}

/** « Nouveau dossier » (a name or a route « Cours/Réseaux ») / « Nouveau fichier… ». */
export function NewItemDialog(props: {
  kind: 'folder' | 'file';
  folderId: string | null;
  onClose: () => void;
}) {
  const coffre = useCoffre();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ item: ItemDto; open: 'vscode' | 'app' | 'confirm' } | null>(
    null,
  );
  const where: FolderDto | undefined = coffre.folders.find((f) => f.id === props.folderId);
  const place = where
    ? where.path.join(' › ')
    : props.kind === 'folder'
      ? 'le haut du Coffre'
      : 'À ranger';
  const route = name
    .split(/[/\\›]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const problem =
    props.kind === 'folder'
      ? (route.map((r) => invalidName(r)).find(Boolean) ?? null)
      : name.trim() && !splitExtension(name.trim()).ext
        ? 'Tape aussi l’extension (notes.md, main.py, budget.xlsx…)'
        : null;

  const submit = async () => {
    if (!name.trim() || problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (props.kind === 'folder') {
        const r = await coffre.api.post<FolderDto & { undoId?: string }>('/folders', {
          parentId: props.folderId,
          route,
        });
        coffre.notify(`Dossier « ${r.path.join(' › ')} » créé.`, r.undoId ?? null);
        coffre.refresh();
        props.onClose();
      } else {
        const r = await coffre.api.post<{
          item: ItemDto;
          undoId: string;
          open: 'vscode' | 'app' | 'confirm';
        }>('/files/create', { folderId: props.folderId, name: name.trim() });
        coffre.notify(`« ${r.item.name} » créé (vide).`, r.undoId);
        coffre.refresh();
        setMade({ item: r.item, open: r.open });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (made)
    return (
      <Modal label="Ouvrir le fichier créé" onClose={props.onClose}>
        <h2>« {made.item.name} » est créé</h2>
        <p className="muted small">Vide, dans {place}. L’ouvrir maintenant ?</p>
        <div className="coffre-treedialog__buttons">
          <Button
            autoFocus
            onClick={() => {
              if (made.open === 'confirm' && !window.confirm(runnableQuestion(made.item.name)))
                return;
              coffre.open(made.item, made.open === 'vscode' ? 'vscode' : 'app');
              props.onClose();
            }}
            data-coffre-newfile-open
          >
            {made.open === 'vscode' ? 'Ouvrir dans VS Code' : 'Ouvrir dans son application'}
          </Button>
          <Button variant="secondary" onClick={props.onClose}>
            Plus tard
          </Button>
        </div>
      </Modal>
    );

  return (
    <Modal
      label={props.kind === 'folder' ? 'Nouveau dossier' : 'Nouveau fichier'}
      onClose={props.onClose}
    >
      <h2>
        {props.kind === 'folder' ? 'Nouveau dossier' : 'Nouveau fichier'}{' '}
        <span className="badge badge--warning">Expérimental</span>
      </h2>
      <p className="muted small">
        Dans {place}.{' '}
        {props.kind === 'folder'
          ? 'Un nom, ou une route (« Réseaux/Slides ») : les dossiers manquants sont créés.'
          : 'Le nom avec son extension ; le fichier est créé vide.'}
      </p>
      <input
        className="input"
        autoFocus
        value={name}
        placeholder={props.kind === 'folder' ? 'Slides' : 'notes.md'}
        aria-label={props.kind === 'folder' ? 'Nom du dossier' : 'Nom du fichier'}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        data-coffre-newitem-name
      />
      {problem && name.trim() && <p className="small coffre-warn">{problem}</p>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="coffre-treedialog__buttons">
        <Button
          disabled={!name.trim() || Boolean(problem) || busy}
          onClick={() => void submit()}
          data-coffre-newitem-create
        >
          Créer
        </Button>
        <Button variant="secondary" onClick={props.onClose}>
          Annuler
        </Button>
      </div>
    </Modal>
  );
}

/** « 3 étiquettes : Réseaux, support du prof, 2026 ». */
export const labelsText = (labels: readonly LabelValue[]) =>
  labels
    .map((l) => (l.family === 'free' ? l.value : `${FAMILY_NAMES[l.family]} ${l.value}`))
    .join(', ');

/** « Coller les étiquettes » on one or more files: « Ajouter » or « Remplacer ». */
export function PasteLabelsDialog(props: {
  items: ItemDto[];
  labels: LabelValue[];
  onClose: () => void;
}) {
  const coffre = useCoffre();
  const [busy, setBusy] = useState(false);
  const files = props.items.filter((i) => !i.trashedAt);
  const paste = async (mode: 'add' | 'replace') => {
    setBusy(true);
    try {
      const r = await coffre.api.post<{ undoId: string }>('/files/labels/paste', {
        ids: files.map((i) => i.id),
        labels: props.labels,
        mode,
      });
      coffre.notify(
        `Étiquettes ${mode === 'add' ? 'ajoutées' : 'remplacées'} sur ${files.length} fichier${files.length > 1 ? 's' : ''}.`,
        r.undoId,
      );
      coffre.refresh();
      props.onClose();
    } catch (e) {
      coffre.fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="Coller les étiquettes" onClose={props.onClose}>
      <h2>Coller les étiquettes</h2>
      <p>
        Sur {files.length === 1 ? `« ${files[0]!.name} »` : `${files.length} fichiers`} :{' '}
        <strong>{labelsText(props.labels)}</strong>
      </p>
      <div className="coffre-treedialog__buttons">
        <Button autoFocus disabled={busy} onClick={() => void paste('add')} data-coffre-paste-add>
          Ajouter
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void paste('replace')}
          title="Leurs étiquettes actuelles sont remplacées par celles-ci"
          data-coffre-paste-replace
        >
          Remplacer
        </Button>
        <Button variant="secondary" onClick={props.onClose}>
          Annuler
        </Button>
      </div>
    </Modal>
  );
}
