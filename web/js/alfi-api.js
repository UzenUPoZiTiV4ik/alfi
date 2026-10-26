/* Клиент API Альфи: токен сессии, JSON-запросы и поток событий агента (SSE поверх fetch).
   EventSource не умеет заголовок Authorization, поэтому поток читается через ReadableStream. */
(function () {
  'use strict';
  const KEY = 'alfi:session:v1';
  // под /alfi/ api живёт по тому же префиксу, на корне префикс пустой
  const base = (window.ALFI_API || location.pathname.replace(/\/[^/]*$/, '')).replace(/\/$/, '');

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  let session = load();

  function save(s) {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (_) {}
  }

  const headers = (json) => {
    const h = {};
    if (json) h['content-type'] = 'application/json';
    if (session && session.token) h.authorization = 'Bearer ' + session.token;
    return h;
  };

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function req(method, path, body) {
    const r = await fetch(base + path, { method, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401) { save(null); document.dispatchEvent(new CustomEvent('alfi:auth')); }
    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new ApiError(r.status, (data && (data.detail && (typeof data.detail === 'string' ? data.detail : data.detail[0] && data.detail[0].msg))) || `Ошибка ${r.status}`);
    return data;
  }

  /* Поток событий агента. onEvent(type, payload) вызывается на каждый шаг.
     Возвращает { done: Promise, abort() }. */
  function stream(path, { method = 'GET', body, onEvent } = {}) {
    const ctrl = new AbortController();
    const done = (async () => {
      const r = await fetch(base + path, { method, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      if (r.status === 401) { save(null); document.dispatchEvent(new CustomEvent('alfi:auth')); }
      if (!r.ok) {
        let msg = `Ошибка ${r.status}`;
        try { const d = await r.json(); if (d && d.detail) msg = typeof d.detail === 'string' ? d.detail : msg; } catch (_) {}
        throw new ApiError(r.status, msg);
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let type = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) type = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          let payload = {};
          try { payload = data ? JSON.parse(data) : {}; } catch (_) {}
          if (onEvent) onEvent(type, payload);
        }
      }
    })();
    return { done, abort: () => ctrl.abort() };
  }

  window.AlfiAPI = {
    get session() { return session; },
    ApiError,
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b ?? {}),
    put: (p, b) => req('PUT', p, b ?? {}),
    del: (p) => req('DELETE', p),
    stream,
    async login(uid, role) {
      const s = await req('POST', '/api/session', { uid, role });
      save({ token: s.token, uid: s.uid, role: s.role });
      return s;
    },
    logout() { save(null); }
  };
})();
