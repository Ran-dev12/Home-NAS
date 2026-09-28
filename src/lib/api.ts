export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fired when the server says the drive went away or the session ended, so the app can re-check its state. */
export const STATE_EVENT = 'homenas:state';

async function toError(res: Response): Promise<ApiError> {
  let body: { error?: string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, body.error ?? 'http_' + res.status, body.message ?? `Request failed (${res.status})`);
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-HomeNAS': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the HomeNAS server. Is the PC on and on the same network?');
  }
  if (!res.ok) {
    const err = await toError(res);
    if (err.status === 401 || err.code === 'storage_offline' || err.code === 'setup_required') window.dispatchEvent(new Event(STATE_EVENT));
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);

const e = encodeURIComponent;
export const urls = {
  list: (space: string, path: string) => `/api/fs/list?space=${e(space)}&path=${e(path)}`,
  download: (space: string, path: string) => `/api/fs/download?space=${e(space)}&path=${e(path)}`,
  inline: (space: string, path: string) => `/api/fs/download?space=${e(space)}&path=${e(path)}&inline=1`,
  zip: (space: string, paths: string[]) => `/api/fs/zip?space=${e(space)}&paths=${e(JSON.stringify(paths))}`,
  thumb: (id: number, v: number | string) => `/api/media/${id}/thumb?v=${v}`,
  preview: (id: number) => `/api/media/${id}/preview`,
  file: (id: number, dl = false) => `/api/media/${id}/file${dl ? '?dl=1' : ''}`,
};

export interface UploadHandle {
  promise: Promise<unknown>;
  abort: () => void;
}

/** One file per request so each has its own progress bar, retry and error. */
export function uploadFile(
  space: string,
  dir: string,
  file: File,
  relpath: string,
  conflict: 'rename' | 'overwrite' | 'skip',
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `/api/fs/upload?space=${e(space)}&path=${e(dir)}&conflict=${conflict}`);
    xhr.setRequestHeader('X-HomeNAS', '1');
    xhr.upload.onprogress = (ev) => onProgress(ev.loaded, ev.total || file.size);
    xhr.onload = () => {
      let body: { message?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body.error ?? 'upload_failed', body.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Connection lost during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Cancelled'));
    const fd = new FormData();
    fd.append('lastModified', String(file.lastModified));
    if (relpath) fd.append('relpath', relpath);
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}
