import { S, scopedController } from './state.js';
import { stream } from './stream.js';

import { base } from './base.js';
for (const key of ['alfi_token', 'alfi:session:v1']) {
  try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertCurrent(gen) {
  if (gen !== S.sessionGen) throw new DOMException('Сессия сменилась', 'AbortError');
}

async function checkResponse(response, gen) {
  assertCurrent(gen);
  if (response.ok || response.status === 304) return;
  const error = await response.json().catch(() => ({}));
  assertCurrent(gen);
  if (response.status === 401) document.dispatchEvent(new Event('alfi:auth'));
  const detail = response.status === 403 ? 'Нет доступа' : error.detail;
  throw new ApiError(response.status, typeof detail === 'string' ? detail : 'Ошибка ' + response.status);
}

async function request(method, path, body, options = {}) {
  const gen = S.sessionGen;
  const ctrl = scopedController();
  const signals = [ctrl.signal, AbortSignal.timeout(15000)];
  if (options.signal) signals.push(options.signal);
  try {
    const response = await fetch(base + path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any(signals),
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...options.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    await checkResponse(response, gen);
    const data = response.status === 304 ? null : await response.json();
    assertCurrent(gen);
    return options.envelope ? { data, etag: response.headers.get('ETag') } : data;
  } finally {
    S.controllers.delete(ctrl);
  }
}

const API = {
  ApiError,
  get session() { return S.me && { uid: S.me.uid, role: S.me.role }; },
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
  stream
};

export { API, assertCurrent, base, checkResponse, ApiError, request };
