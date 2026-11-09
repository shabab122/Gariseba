let cached;
let loading;

export class ApiError extends Error {
  constructor(status, data = {}) {
    super(data.message || 'Could not connect to the service.');
    this.status = status;
    this.code = data.error || 'network';
    this.fields = data.errors || {};
  }
}

export function bootstrap(refresh = false) {
  if (loading) return loading;
  if (cached && !refresh) return Promise.resolve(cached);
  loading = fetch('/api/bootstrap', { cache: 'no-store' })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.csrf) throw new ApiError(response.status, data);
      cached = data;
      return data;
    }).finally(() => { loading = null; });
  return loading;
}

export function updateCsrf(csrf) {
  if (cached) cached = csrf ? { ...cached, csrf } : null;
}

export async function api(path, { method = 'GET', body, draftKey, signal } = {}, retried = false) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = (await bootstrap()).csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (draftKey) headers['X-Draft-Key'] = draftKey;
  const response = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json().catch(() => ({}));
  if (response.status === 403 && data.error === 'csrf' && !retried) {
    await bootstrap(true);
    return api(path, { method, body, draftKey, signal }, true);
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export async function uploadPhoto(file, label, draftKey, photoKey, onProgress, retried = false) {
  const { csrf } = await bootstrap();
  try {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/photos');
      xhr.responseType = 'json';
      xhr.timeout = 35000;
      xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.setRequestHeader('X-Draft-Key', draftKey);
      xhr.setRequestHeader('X-Photo-Key', photoKey);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round(100 * event.loaded / event.total));
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.response)
        : reject(new ApiError(xhr.status, xhr.response || {}));
      xhr.onerror = xhr.ontimeout = () => reject(new ApiError(0));
      const form = new FormData();
      form.append('photo', file);
      form.append('label', label);
      xhr.send(form);
    });
  } catch (error) {
    if (error.code !== 'csrf' || retried) throw error;
    await bootstrap(true);
    return uploadPhoto(file, label, draftKey, photoKey, onProgress, true);
  }
}
