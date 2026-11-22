import { S, scopedController } from './state.js';
import { assertCurrent, base, checkResponse, ApiError, request } from './api.js';

class RunFailed extends Error {}

// Each new request after the first attaches to the journal of the same run.
function stream(path, { method = 'GET', body, onEvent } = {}) {
  const gen = S.sessionGen;
  const controller = scopedController();
  const signal = controller.signal;
  let runId = '', lastSeq = 0, sawFinal = false;
  const runPath = () => '/api/runs/' + encodeURIComponent(runId);
  const emit = (type, event) => {
    assertCurrent(gen);
    signal.throwIfAborted();
    onEvent?.(type, event);
  };

  async function listen(resume) {
    const url = resume ? runPath() + '/stream?after_seq=' + lastSeq : path;
    const attempt = new AbortController();
    let watchdog;
    const heartbeat = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => attempt.abort(), 60000);
    };
    heartbeat();
    try {
      const response = await fetch(base + url, {
        method: resume ? 'GET' : method, credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.any([signal, attempt.signal]),
        ...(!resume && body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      });
      await checkResponse(response, gen);
      runId ||= response.headers.get('X-Run-Id') || '';
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read();
        assertCurrent(gen);
        if (chunk.done) return false;
        heartbeat();
        buffer += chunk.value;
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const lines = buffer.slice(0, boundary.index).split(/\r?\n/);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const field = (key) => lines.filter(line => line.startsWith(key + ':')).map(line => line.slice(key.length + 1).trimStart()).join('\n');
          const type = field('event');
          if (!field('data') || type === 'ping') continue;
          const event = JSON.parse(field('data'));
          runId ||= event.run_id || event.data?.run_id;
          if (type === 'start') continue;
          if (type === 'timeout') return false;
          if (type === 'done') return true;
          if (type === 'error' && event.status) throw new RunFailed(event.title || 'Агент завершил работу с ошибкой');
          const seq = Number(event.seq || field('id'));
          if (seq && seq <= lastSeq) continue;
          if (seq) lastSeq = seq;
          if (type === 'final') sawFinal = true;
          emit(type, event);
        }
      }
    } finally {
      clearTimeout(watchdog);
      attempt.abort();
    }
  }

  async function recover() {
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      signal.throwIfAborted();
      assertCurrent(gen);
      try {
        if (await listen(attempt > 0)) return;
      } catch (error) {
        const permanent = error instanceof RunFailed || (error instanceof ApiError && error.status < 500);
        if (!runId || permanent || signal.aborted) throw error;
      }
      if (!runId) throw new Error('Связь прервалась до получения номера запуска');
    }
    /** @type {import('./types.js').RunState} */
    const result = await request('GET', runPath(), undefined, { signal });
    if (result.status !== 'done') throw new Error(result.status === 'running' ? 'Агент ещё работает. Связь с запуском прервалась' : 'Ошибка агента');
    if (!sawFinal) emit('final', { type: 'final', data: result.kind === 'insight' ? { result: result.result } : result.result });
  }
  return { done: recover().finally(() => S.controllers.delete(controller)), abort: () => controller.abort() };
}

export { stream };
