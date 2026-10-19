// Single entry point for every call to the local backend. The UI is always
// served same-origin (by the backend in production, by the Vite proxy in dev),
// so paths are relative. The session token comes from the Electron preload;
// in a regular browser (dev only) the Vite proxy adds it instead.

declare global {
  interface Window {
    toolbox?: { token: string };
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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (window.toolbox?.token) headers.set('x-toolbox-token', window.toolbox.token);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }

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
  return (await response.json()) as T;
}
