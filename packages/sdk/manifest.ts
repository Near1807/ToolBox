// Module manifest (`modules/<id>/module.json`) and settings schema.
// Shared by the backend loader, the frontend shell and modules themselves.
// The authoritative description lives in docs/MODULES.md — keep both in sync.

/**
 * A setting declared by a module; the Settings page renders a form from it.
 * `hidden: true` keeps it off the Settings page (the module edits it on its own page).
 */
export type SettingField = SettingFieldBase & { hidden?: boolean };

type SettingFieldBase =
  | {
      key: string;
      type: 'string' | 'text';
      label: string;
      description?: string;
      placeholder?: string;
      default?: string;
    }
  | {
      key: string;
      type: 'number';
      label: string;
      description?: string;
      min?: number;
      max?: number;
      step?: number;
      default?: number;
    }
  | { key: string; type: 'boolean'; label: string; description?: string; default?: boolean }
  | {
      key: string;
      type: 'select';
      label: string;
      description?: string;
      options: { value: string; label: string }[];
      default?: string;
    }
  /** Stored encrypted (safeStorage); its value is never sent back to the UI. */
  | { key: string; type: 'secret'; label: string; description?: string }
  /** A folder chosen with the native folder picker. */
  | { key: string; type: 'folder'; label: string; description?: string; default?: string }
  /** Days of the week, stored as ISO numbers "1,2,3,4,5" (1 = Monday … 7 = Sunday). */
  | { key: string; type: 'weekdays'; label: string; description?: string; default?: string };

export type SettingType = SettingField['type'];
export type SettingValue = string | number | boolean | null;

export interface ModuleManifest {
  /** kebab-case, equal to the folder name. Also the API prefix and the table prefix. */
  id: string;
  /** Display name (French). */
  name: string;
  description: string;
  /** Semantic version of the module itself. */
  version: string;
  /** Home page section the module belongs to, e.g. "Musique". */
  section: string;
  /** Short visual marker shown on cards and in the sidebar (an emoji). */
  icon: string;
  /** Sort order inside the section (lower first). Default 100. */
  order?: number;
  /** Not validated by Thomas yet: « Expérimental » is shown on its page, card and sidebar entry. */
  experimental?: boolean;
  dependsOn?: {
    /** Modules that must be present and loaded. */
    modules?: string[];
    /** Services (provided by any loaded module) this module cannot work without. */
    services?: string[];
    /**
     * Services used when present (ctx.services.optional()): the module works
     * without them. Their providers, if any, are loaded first.
     */
    optionalServices?: string[];
  };
  provides?: {
    /** Services this module registers with ctx.services.provide(). */
    services?: string[];
  };
  permissions?: {
    /** Account providers this module needs through ctx.accounts (e.g. "google"). */
    accounts?: string[];
    /** Lists and runs the assistant actions of every module (ctx.assistant.actions/run/undo). */
    assistant?: boolean;
    /** Listens to keys system-wide, even without focus (ctx.hotkeys): push-to-talk. */
    globalKeys?: boolean;
  };
  /**
   * « Exporter une sauvegarde » : folders of the module's data folder left out
   * (downloaded engines and models, caches…), paths relative to ctx.files.dataDir.
   * Only what can be downloaded again or rebuilt: never the user's data.
   */
  backup?: { exclude?: string[] };
  settings?: SettingField[];
}

/** Runtime status of a module, as reported by GET /api/core/modules. */
export type ModuleStatus = 'loaded' | 'failed' | 'missing-dependencies' | 'disabled';

export interface ModuleInfo {
  id: string;
  manifest: ModuleManifest;
  status: ModuleStatus;
  /** Human-readable reason (French) when status is not "loaded". */
  error?: string;
  /** True when the user (or the hub after a failed migration) disabled the module. */
  disabled: boolean;
  /** Example modules (folders starting with "_") are only loaded on demand. */
  example: boolean;
}
