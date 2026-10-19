// Frontend side of the module contract: what `modules/<id>/frontend/index.tsx`
// exports, plus the API client, hooks and UI components shared by the shell
// and all modules. See docs/MODULES.md.
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { JobInfo } from './backend';
import type { ModuleManifest } from './manifest';

export type * from './manifest';
export type { JobInfo, JobStatus } from './backend';

// ---------------------------------------------------------------------------
// What a module exports
// ---------------------------------------------------------------------------

export interface ModulePage {
  /** Relative to /m/<id>/ : "" for the main page, "items/:itemId" for a sub-page. */
  path: string;
  component: ComponentType;
}

export interface FrontendModule {
  /** Pages of the module; the one with path "" is linked from the sidebar and the home card. */
  pages?: ModulePage[];
  /** Sidebar entry (default: the manifest name). `hidden: true` removes it. */
  nav?: { label?: string; hidden?: boolean };
  /** Small component shown in the module's card on the home page. */
  HomeWidget?: ComponentType;
}

/** Identity helper giving type inference to `frontend/index.tsx`. */
export function defineFrontendModule(module: FrontendModule): FrontendModule {
  return module;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    toolbox?: { token: string; getPathForFile?: (file: File) => string };
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Calls the local backend (same origin). Adds the session token; JSON bodies
 * must be passed already stringified. Throws ApiError with the server's French
 * message on failure.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (window.toolbox?.token) headers.set('x-toolbox-token', window.toolbox.token);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Shorthand for JSON requests: api.post('/api/...', { a: 1 }). */
export const api = {
  get: <T,>(path: string) => apiFetch<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Opens an SSE stream on a route declared with `streamTicket: true`.
 * EventSource cannot send the token header, so each connection first obtains a
 * single-use ticket; on error the stream reconnects with a fresh ticket.
 * Returns a function that closes the stream.
 */
export function openEventStream(
  path: string,
  handlers: Record<string, (data: unknown) => void>,
): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = async () => {
    try {
      const { ticket } = await api.post<{ ticket: string }>('/api/core/stream-tickets');
      if (closed) return;
      const separator = path.includes('?') ? '&' : '?';
      source = new EventSource(`${path}${separator}ticket=${encodeURIComponent(ticket)}`);
      for (const [event, handler] of Object.entries(handlers)) {
        source.addEventListener(event, (message) =>
          handler(JSON.parse((message as MessageEvent<string>).data)),
        );
      }
      source.onerror = () => {
        // The ticket is spent: never let EventSource retry by itself.
        source?.close();
        scheduleRetry();
      };
    } catch {
      scheduleRetry();
    }
  };
  const scheduleRetry = () => {
    if (closed) return;
    retryTimer = setTimeout(() => void connect(), 2000);
  };

  void connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}

// ---------------------------------------------------------------------------
// Local files (drag & drop, file pickers, clipboard)
// ---------------------------------------------------------------------------

/**
 * Real path of a file dropped onto the window or chosen with <input type=file>.
 * Only available inside the desktop app (null in a regular browser): send the
 * path to your backend, which copies the file into ctx.files.dataDir.
 */
export function getFilePath(file: File): string | null {
  try {
    return window.toolbox?.getPathForFile?.(file) || null;
  } catch {
    return null;
  }
}

/** Opens the native file picker (works in the app and in the dev browser). */
export async function pickFiles(options: {
  title: string;
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}): Promise<string[]> {
  const { files } = await api.post<{ files: string[] }>('/api/core/dialogs/select-files', options);
  return files;
}

/** Opens the native folder picker; null when cancelled. */
export async function pickFolder(options: {
  title: string;
  defaultPath?: string;
}): Promise<string | null> {
  const { folder } = await api.post<{ folder: string | null }>(
    '/api/core/dialogs/select-folder',
    options,
  );
  return folder;
}

/** Copies text to the clipboard; resolves to false if the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 185.4 → "3:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GETs a path on mount (and when it changes); `reload()` fetches again. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    apiFetch<T>(path)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => {
    setLoading(true);
    setVersion((v) => v + 1);
  }, []);

  return { data, error, loading, reload };
}

/** Live list of jobs (optionally of one module), updated through SSE. */
export function useJobs(moduleId?: string): {
  jobs: JobInfo[];
  cancel: (id: string) => Promise<void>;
} {
  const [jobs, setJobs] = useState<JobInfo[]>([]);

  useEffect(() => {
    let active = true;
    const query = moduleId ? `?module=${encodeURIComponent(moduleId)}` : '';
    void apiFetch<JobInfo[]>(`/api/core/jobs${query}`).then((list) => {
      if (active) setJobs(list);
    });
    const close = openEventStream('/api/core/jobs/stream', {
      job: (data) => {
        const job = data as JobInfo;
        if (moduleId && job.moduleId !== moduleId) return;
        setJobs((current) => {
          const index = current.findIndex((j) => j.id === job.id);
          if (index === -1) return [job, ...current];
          const next = [...current];
          next[index] = job;
          return next;
        });
      },
    });
    return () => {
      active = false;
      close();
    };
  }, [moduleId]);

  const cancel = useCallback(async (id: string) => {
    await api.post(`/api/core/jobs/${id}/cancel`);
  }, []);

  return { jobs, cancel };
}

// ---------------------------------------------------------------------------
// Module context (provided by the shell around every module page and widget)
// ---------------------------------------------------------------------------

export interface ModuleContextValue {
  id: string;
  manifest: ModuleManifest;
  /** Calls this module's own routes: moduleApi.get('/notes') → GET /api/modules/<id>/notes. */
  api: typeof api;
  /** Absolute URL of a module API route, for links and EventSource. */
  url(path: string): string;
  /** Router path of a module page, for <Link to> / navigate(): path('tracks/3'). */
  path(page?: string): string;
}

const ModuleReactContext = createContext<ModuleContextValue | null>(null);

export function ModuleProvider(props: { manifest: ModuleManifest; children: ReactNode }) {
  const { manifest } = props;
  const base = `/api/modules/${manifest.id}`;
  const value: ModuleContextValue = {
    id: manifest.id,
    manifest,
    url: (path) => base + path,
    path: (page = '') => `/m/${manifest.id}${page ? `/${page.replace(/^\//, '')}` : ''}`,
    api: {
      get: <T,>(path: string) => api.get<T>(base + path),
      post: <T,>(path: string, body?: unknown) => api.post<T>(base + path, body),
      put: <T,>(path: string, body?: unknown) => api.put<T>(base + path, body),
      patch: <T,>(path: string, body?: unknown) => api.patch<T>(base + path, body),
      delete: <T,>(path: string) => api.delete<T>(base + path),
    },
  };
  return <ModuleReactContext.Provider value={value}>{props.children}</ModuleReactContext.Provider>;
}

/** The current module (id, manifest, API scoped to /api/modules/<id>). */
export function useModule(): ModuleContextValue {
  const value = useContext(ModuleReactContext);
  if (!value) throw new Error('useModule() doit être utilisé dans une page ou un widget de module');
  return value;
}

// ---------------------------------------------------------------------------
// UI components (styles: frontend/src/styles.css)
// ---------------------------------------------------------------------------

export function Page(props: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{props.title}</h1>
          {props.subtitle && <p className="muted">{props.subtitle}</p>}
        </div>
        {props.actions && <div className="page__actions">{props.actions}</div>}
      </header>
      {props.children}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(props.title || props.actions) && (
        <div className="card__header">
          {props.title && <h2>{props.title}</h2>}
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Button(
  props: {
    variant?: 'primary' | 'secondary' | 'danger';
    small?: boolean;
  } & ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const { variant = 'primary', small, className, ...rest } = props;
  const classes = ['button', `button--${variant}`, small ? 'button--small' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={classes} {...rest} />;
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p>{props.title}</p>
      {props.children && <div className="muted">{props.children}</div>}
    </div>
  );
}

export function ErrorMessage(props: { children: ReactNode }) {
  return <p className="error">{props.children}</p>;
}

export function ProgressBar(props: { value: number | null }) {
  const percent = props.value === null ? null : Math.round(props.value * 100);
  return (
    <div className={`progress${percent === null ? ' progress--indeterminate' : ''}`}>
      <div
        className="progress__bar"
        style={{ width: percent === null ? undefined : `${percent}%` }}
      />
    </div>
  );
}

/** Catches rendering errors of a module so the rest of the shell keeps working. */
export class ErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="card card--error">
          <strong>« {this.props.label} » a rencontré une erreur d’affichage.</strong>
          <p className="muted">{this.state.error.message}</p>
          <Button variant="secondary" small onClick={() => this.setState({ error: null })}>
            Réessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
