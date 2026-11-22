import { $, reduce, cut, safeUrl, esc, toast, $$ } from './ui.js';
import { ALFI, mount, agentOf } from './people.js';
import { scene, stageEl } from './scene.js';
import { S, byId } from './state.js';
import { showCat } from './stage.js';
import { API } from './api.js';

/* ---------- Чат: сцена с командой переезжает в панель чата ---------- */
const chat = $('#aChat'), log = $('#aLog');
const chatTitle = $('#aChatTitle'), chatSt = $('#aChatSt'), chatAva = $('#aChatAva');
let catBeforeChat = null;
let chatAgent = ALFI;
const sideEl = $('#aSide'), dock = $('#aChatDock'), chatPanel = $('#aChatPanel'), plate = chat.querySelector('.a-chat__plate');
const holder = document.createElement('div');
holder.className = 'a-side-holder';
holder.setAttribute('aria-hidden', 'true');
const feedEl = $('#aFeed'), PIN = matchMedia('(min-width: 1025px)');
function pinSide() {
  const on = PIN.matches;
  sideEl.classList.toggle('is-pinned', on); holder.classList.toggle('is-pinned', on);
  if (!on) return;
  const r = feedEl.getBoundingClientRect(), cols = getComputedStyle(feedEl).gridTemplateColumns.split(' ');
  const col = parseFloat(cols[cols.length - 1]) || 344;
  const top = Math.max(r.top + scrollY, (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64) + 16);
  const root = document.documentElement.style;
  root.setProperty('--side-top', Math.round(top) + 'px');
  root.setProperty('--side-left', Math.round(r.right - col) + 'px');
  root.setProperty('--side-col', Math.round(col) + 'px');
}
pinSide();
new ResizeObserver(pinSide).observe(feedEl);
PIN.addEventListener('change', pinSide);
addEventListener('resize', pinSide);
const DOCK_MIN = 1100, EASE = 'cubic-bezier(.22,1,.36,1)', MOVE_MS = 560;
let docked = false, closing = null, moveAnim = null;
const dur = (ms) => (reduce ? 0 : ms);
function moving(anim, ms, holdScene = true) {
  moveAnim = anim;
  chat.classList.add('is-moving');
  if (holdScene && scene && scene.hold) scene.hold(ms);
  anim.finished.catch(() => {}).then(() => { if (moveAnim === anim) { chat.classList.remove('is-moving'); moveAnim = null; } });
}
function openShell(holdScene) {
  if (chat.open) return;
  docked = innerWidth >= DOCK_MIN;
  chat.classList.toggle('is-docked', docked);
  if (!docked) { chat.showModal(); return; }
  const from = sideEl.getBoundingClientRect();
  holder.style.height = from.height + 'px';
  sideEl.after(holder);
  chat.style.setProperty('--side-w', from.width + 'px');
  chat.classList.add('is-moving');
  dock.appendChild(sideEl);
  chat.showModal();
  dock.scrollTop = 0;
  const to = sideEl.getBoundingClientRect();
  moving(sideEl.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: dur(MOVE_MS), easing: EASE }), dur(MOVE_MS) + 40, holdScene);
  plate.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: dur(MOVE_MS), easing: EASE });
  chatPanel.animate([{ transform: 'translateX(48px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: dur(460), delay: dur(120), easing: EASE, fill: 'backwards' });
}
function undock() {
  if (!docked) return;
  moveAnim = null;
  chat.classList.remove('is-docked', 'is-moving');
  if (holder.isConnected) holder.replaceWith(sideEl);
  docked = false;
}
async function closeChat(instant) {
  if (!chat.open || closing) return;
  if (!docked || instant || reduce) { undock(); chat.close(); return; }
  const from = sideEl.getBoundingClientRect(), to = holder.getBoundingClientRect();
  const dx = to.left - from.left, dy = to.top - from.top;
  const opts = { duration: 460, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' };
  chat.classList.add('is-closing');
  const anims = [
    sideEl.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px)` }], opts),
    plate.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], opts),
    chatPanel.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(48px)', opacity: 0 }], { ...opts, duration: 260 })
  ];
  moving(anims[0], opts.duration + 200);
  closing = Promise.all(anims.map((a) => a.finished)).catch(() => {});
  const gen = S.sessionGen;
  await closing;
  if (gen !== S.sessionGen) {
    anims.forEach(animation => animation.cancel());
    return;
  }
  closing = null;
  undock();
  anims.forEach((a) => a.cancel());
  chat.close();
  chat.classList.remove('is-closing');
}
chat.addEventListener('close', () => {
  undock();
  if (catBeforeChat) showCat(agentOf(catBeforeChat));
  catBeforeChat = null;
});
chat.addEventListener('cancel', (e) => { e.preventDefault(); closeChat(); });

/* ---------- Чат с агентом ----------
   Ответ приходит потоком: видно, какие инструменты агент вызвал. Ссылки [news:…], [bank:…] превращаются
   в номера источников, внизу ответа список с первоисточниками и страницами PDF. */
const TOOL_T = {
  get_company_profile: 'профиль компании', get_counterparties: 'поставщики и покупатели', get_group_structure: 'группа компаний',
  get_linked_companies: 'связанные компании', search_news: 'поиск по новостям', get_news: 'текст новости',
  search_bank_analytics: 'аналитика Альфа-Банка', get_bank_forecasts: 'прогнозы банка', web_search: 'поиск в интернете', fetch_page: 'чтение страницы'
};
const toolT = (t) => TOOL_T[t] || t;
const REF_RX = /\[((?:news|bank|web|feat|data):[^\]\s]+)\]/g;
function refLabel(id, r) {
  const [kind] = id.split(':');
  if (kind === 'bank') return `Альфа-Банк${r && r.page ? `, стр. ${r.page}` : ''}`;
  if (kind === 'news') return (r && (r.source || (r.title && cut(r.title, 26)))) || 'новость';
  if (kind === 'web') return r && r.url ? (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (_) { return 'интернет'; } })() : 'интернет';
  if (kind === 'feat') return (r && r.title) || 'данные компании';
  return (r && r.title) || 'данные банка';
}
const KIND_T = { news: 'Новость', bank: 'Аналитика Альфа-Банка', web: 'Интернет', feat: 'Данные о компании', data: 'Данные банка о компании' };
function srcList(refs, ids, scope) {
  return `<ol class="c-srcs">${ids.map((id, i) => {
    const r = refs[id] || {}, kind = id.split(':')[0], url = safeUrl(r.url);
    return `<li id="${scope}-${i + 1}" class="c-srcs__i is-${kind}"><span class="c-srcs__n">${i + 1}</span><span class="c-srcs__b"><span class="c-srcs__k">${KIND_T[kind] || kind}${r.verified === false ? ' · цитата не подтверждена' : r.verified ? ' · цитата сверена с PDF' : ''}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title || id)}</a>` : `<span>${esc(r.title || id)}</span>`}
      ${r.quote ? `<q>${esc(cut(r.quote, 240))}</q>` : r.text && kind !== 'news' ? `<small>${esc(cut(r.text, 200))}</small>` : ''}</span></li>`;
  }).join('')}</ol>`;
}
// Ответ модели: экранируем, размечаем **жирный** и списки. Ссылки, идущие подряд, склеиваются в одну метку,
// а список источников свёрнут под «Источники · N»: в ответе остаётся текст, первоисточник открывается по клику
function answerHTML(text, refs) {
  refs = refs || {};
  const scope = 'm' + Math.random().toString(36).slice(2, 8), order = [];
  const num = (id) => { let i = order.indexOf(id); if (i < 0) { order.push(id); i = order.length - 1; } return i + 1; };
  const group = (ids) => {
    const real = ids.filter((id) => refs[id]);
    if (!real.length) return '';
    const ns = real.map(num), bank = real.some((id) => id.startsWith('bank:'));
    const label = ns.length === 1 ? ns[0] : ns.length === 2 ? `${ns[0]}, ${ns[1]}` : `${ns[0]}–${ns[ns.length - 1]}`;
    return `<button class="c-ref${bank ? ' is-bank' : ''}" type="button" data-ref="${scope}-${ns[0]}" title="${esc(real.map((id) => refLabel(id, refs[id])).join(', '))}" aria-label="Источник: ${esc(real.map((id) => refLabel(id, refs[id])).join(', '))}">${label}</button>`;
  };
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?:\s*\[(?:news|bank|web|feat|data):[^\]\s]+\])+/g, (m) => {
      const ids = [...m.matchAll(/\[((?:news|bank|web|feat|data):[^\]\s]+)\]/g)].map((x) => x[1].replace(/&amp;/g, '&'));
      const g = group(ids); return g ? ' ' + g : '';
    })
    .replace(/^(Альфа-Банк|Позиция банка):/, '<b class="c-bankline">$1:</b>')
    .replace(/^(?:<b>)?(?:Вывод AI|Вывод Альфи)[.:]?(?:<\/b>)?[.:]?\s*/, '<b>Вывод Альфи:</b>')
    .replace(/(Вывод|оценке|мнению) AI(?![A-Za-z])/g, '$1 Альфи')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/([^.])\.\.(?!\.)/g, '$1.');
  // Короткий жирный ярлык в начале абзаца («Позиция банка.», «Вывод Альфи:») выносим подписью над абзацем
  const KICK = /^<b(?: class="c-bankline")?>([^<]{2,40}?)(?:[.:]<\/b>|<\/b>[.:])\s*/;
  // Длинный абзац делим по границам предложений примерно на равные части по ~300 знаков: слова не меняются, только переносы
  const split = (h) => {
    const plain = h.replace(/<[^>]+>/g, '');
    if (plain.length < 380) return [h];
    const ss = h.split(/(?<=[^\s.]{3}[.!?](?:<\/b>)?(?:\s*<button[^>]*>[^<]*<\/button>)?)\s+(?=[«"(]?[А-ЯЁA-Z])/);
    if (ss.length < 2) return [h];
    const n = Math.min(ss.length, Math.ceil(plain.length / 320)), per = plain.length / n, parts = [];
    let cur = '', len = 0;
    for (const s of ss) {
      cur += (cur ? ' ' : '') + s; len += s.replace(/<[^>]+>/g, '').length;
      if (len >= per * 0.85 && parts.length < n - 1) { parts.push(cur); cur = ''; len = 0; }
    }
    if (cur) parts.push(cur);
    // если разрез пришёлся внутрь жирного, оставляем абзац целым
    return parts.every((x) => (x.match(/<b[ >]/g) || []).length === (x.match(/<\/b>/g) || []).length) ? parts : [h];
  };
  const ps = (h) => split(h).map((x) => `<p>${x}</p>`).join('');
  const para = (h) => {
    const k = h.match(KICK), body = k ? h.slice(k[0].length) : h;
    if (!k || !body) return ps(h);
    const take = /^Вывод Альфи$/.test(k[1]);
    return `<div class="c-block${take ? ' c-take' : ''}"><p class="c-kick">${k[1]}</p>${ps(body)}</div>`;
  };
  const out = []; let list = null, ord = false;
  const flush = () => { if (list) out.push(ord ? `<ol>${list.join('')}</ol>` : `<ul>${list.join('')}</ul>`); list = null; };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const m = line.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      const o = /\d/.test(m[1]);
      if (list && o !== ord) flush();
      if (!list) { list = []; ord = o; }
      list.push(`<li>${inline(m[2])}</li>`); continue;
    }
    flush();
    if (line) out.push(para(inline(line.replace(/^#+\s*/, ''))));
  }
  flush();
  return out.join('') + (order.length ? `<details class="c-srcbox"><summary>Источники · ${order.length}</summary>${srcList(refs, order, scope)}</details>` : '');
}
/* У каждого помощника своя переписка: своя панель в журнале и своя история на сервере.
   Переключили помощника — показали его панель, ответ, который ещё идёт у другого, дописывается в фоне. */
const panes = new Map(), runs = new Map();
const chatId = (a) => (a && !a.all ? a.id : 'alfi');
function pane(a) {
  const id = chatId(a);
  let p = panes.get(id);
  if (!p) { p = document.createElement('div'); p.className = 'c-pane'; p.dataset.pane = id; p.hidden = true; log.appendChild(p); panes.set(id, p); }
  return p;
}
const scrollLog = () => { log.scrollTop = log.scrollHeight; };
function bot(html, p = pane(chatAgent)) {
  const el = document.createElement('div');
  el.className = 'a-msg a-msg--bot';
  el.innerHTML = `<div class="a-msg__b">${html}</div>`;
  p.appendChild(el);
  return el;
}
const me = (q, p = pane(chatAgent)) => p.insertAdjacentHTML('beforeend', `<div class="a-msg a-msg--me">${esc(q)}</div>`);
const agentStatus = (a) => (a.all ? 'По данным компании и аналитике банка' : a.watch);
function paintSugg() {
  const ctx = S.chatCtx ? byId(S.chatCtx) : null, a = chatAgent;
  const list = ctx ? ['Что это меняет для нас?', 'Что говорит Альфа-Банк?', 'Какие риски для долга и валюты?', 'Что сделать в первую очередь?']
    : a.all ? ['Что важно на этой неделе?', 'Как ставка ЦБ влияет на наши кредиты?', 'Какие риски у наших контрагентов?', 'Что прогнозирует Альфа-Банк по курсу?']
    : [`Что нового по теме «${a.name}»?`, `Почему «${a.name}» в нашей команде?`, 'Какой главный риск сейчас?', 'Что говорит аналитика банка?'];
  const used = !!pane(a).querySelector('.a-msg--me');
  $('#aChatSugg').hidden = used && !ctx;
  $('#aChatSugg').innerHTML = list.slice(0, 3).map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('');
  const c = $('#aChatCtx');
  c.hidden = !ctx;
  if (ctx) c.innerHTML = `<span>Обсуждаем: <b>${esc(cut(ctx.headline || ctx.title, 80))}</b></span><button type="button" data-ctx-clear aria-label="Убрать новость из контекста"><svg class="ic ic--sm"><use href="#i-close"/></svg></button>`;
}
async function loadHistory(a) {
  const gen = S.sessionGen;
  const p = pane(a);
  if (p.dataset.loaded) return;
  p.dataset.loaded = '1';
  try {
    const h = await API.get('/api/chat' + (a.all ? '' : '?helper=' + encodeURIComponent(a.id)));
    for (const m of h.items || []) {
      if (m.role === 'user') me(String(m.content || ''), p);
      else bot(answerHTML(String(m.content || '').replace(REF_RX, ''), {}), p);
    }
    if ((h.items || []).length) p.insertAdjacentHTML('afterbegin', '<p class="c-sep">Прошлая переписка</p>');
  } catch (_) {}
  if (gen !== S.sessionGen) return;
  if (!p.children.length) {
    bot(a.all
      ? `<p>Альфи отвечает с учётом профиля «${esc(S.me ? S.me.company.title : 'компании')}»: отрасль, ВЭД, продукты банка, контрагенты и группа. В ответах есть ссылки на новости и аналитику Альфа-Банка.</p>`
      : `<p><b>${esc(a.name)}</b> ${a.task ? `отвечает за тему: ${esc(a.task)}.` : `следит за темой: ${esc(a.watch)}.`}</p>${a.why_ai || a.why ? `<p class="c-meta">В команде, потому что ${esc((a.why_ai || a.why).replace(/^./, (c) => c.toLowerCase()))}</p>` : ''}`, p);
  }
  if (p === pane(chatAgent)) scrollLog();
}
function openChat(person, ctxId) {
  if (!S.me) { document.dispatchEvent(new Event('alfi:login')); return; }
  const opening = !chat.open;
  if (opening) catBeforeChat = S.cat;
  if (person) chatAgent = person;
  if (ctxId !== undefined) S.chatCtx = ctxId;
  chatTitle.textContent = chatAgent.name;
  chatSt.textContent = agentStatus(chatAgent);
  mount(chatAva, chatAgent.kind);
  mount($('#aFabBuddy'), chatAgent.kind, 160);
  const cur = pane(chatAgent);
  panes.forEach((p) => { p.hidden = p !== cur; });
  if (!reduce) cur.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  paintSugg();
  const changing = chatAgent.id !== S.cat;
  if (opening) openShell(!changing);
  if (changing) showCat(chatAgent, opening);
  loadHistory(chatAgent);
  scrollLog();
  const gen = S.sessionGen;
  setTimeout(() => {
    if (gen === S.sessionGen && chat.open) $('#aChatInput').focus({ preventScroll: true });
  }, reduce ? 0 : 380);
}
function say(q) {
  if (!S.me) return;
  const a = chatAgent, id = chatId(a);
  if (runs.get(id)) { toast(`${a.name} ещё отвечает на прошлый вопрос`); return; }
  openChat();
  const p = pane(a);
  me(q, p);
  if (!S.chatCtx) $('#aChatSugg').hidden = true;
  const t = bot('<span class="a-typing"><i></i><i></i><i></i></span><p class="c-tools"></p>', p);
  const b = t.querySelector('.a-msg__b'), tl = () => b.querySelector('.c-tools');
  const follow = () => { if (!p.hidden) scrollLog(); };
  follow();
  const used = [];
  const run = API.stream('/api/chat', { method: 'POST', body: { message: q, news_id: S.chatCtx || null, helper: p.dataset.pane === 'alfi' ? null : p.dataset.pane }, onEvent: (type, ev) => {
    const d = ev.data || {};
    if (type === 'tool' && tl()) { used.push(toolT(d.tool)); tl().textContent = 'Смотрим: ' + used.join(', '); }
    else if (type === 'guard' && tl()) tl().textContent = ev.title + (d.text ? `. ${d.text}` : '');
    else if (type === 'final') {
      b.innerHTML = answerHTML(d.text, d.refs) + '';
      if (p.hidden) toast(`Ответ готов: ${a.name}`);
    } else if (type === 'error') b.innerHTML = `<p class="c-err">Не получилось ответить: ${esc(d.message || ev.title)}. Попробуйте ещё раз.</p>`;
    follow();
  } });
  runs.set(id, run);
  run.done.catch((e) => { b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }).finally(() => { if (runs.get(id) === run) { runs.delete(id); follow(); } });
}
chat.addEventListener('click', (e) => {
  if (e.target === chat || e.target.closest('.a-chat__x')) { closeChat(); return; }
  if (e.target.closest('[data-ctx-clear]')) { S.chatCtx = null; paintSugg(); }
});
$('#aChatClear').addEventListener('click', async (e) => {
  const btn = e.currentTarget, a = chatAgent, p = pane(a);
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; toast('Нажмите ещё раз, чтобы удалить переписку'); setTimeout(() => { delete btn.dataset.armed; }, 3000); return; }
  delete btn.dataset.armed;
  try { await API.del('/api/chat' + (a.all ? '' : '?helper=' + encodeURIComponent(a.id))); } catch (error) { if (error.name !== 'AbortError') toast(error.message); return; }
  p.innerHTML = ''; delete p.dataset.loaded; loadHistory(a);
  toast('Переписка удалена');
});
$('#aChatForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#aChatInput').value.trim(); if (v) { say(v); $('#aChatInput').value = ''; } });
$('#aFab').addEventListener('click', () => openChat(agentOf(S.cat)));
new IntersectionObserver(([e]) => { $('#aFab').hidden = e.isIntersecting; }, { threshold: 0.15 }).observe(stageEl);
/* Плавающий Альфи не ложится на кнопки карточек. Листают вниз: уезжает. Остановились или листают вверх: возвращается,
   а если под ним оказалась кнопка («Прочитано», «Не про нас»), приподнимается над ней или прячется */
const fabEl = $('#aFab');
const fabFit = (() => {
  let lastY = scrollY, down = false, t = 0;
  const hits = (r) => $$('#aCards button, #aCards a, #fMore, #fLive button, .a-tab').some((el) => {
    const b = el.getBoundingClientRect();
    return b.width && b.right > r.left - 6 && b.left < r.right + 6 && b.bottom > r.top - 6 && b.top < r.bottom + 6;
  });
  const fit = () => {
    if (fabEl.hidden) { fabEl.classList.remove('is-away'); fabEl.style.removeProperty('--lift'); return; }
    // Базовое место кнопки без сдвига: offset* не учитывает translate и идущую анимацию
    const r0 = { left: fabEl.offsetLeft, top: fabEl.offsetTop, right: fabEl.offsetLeft + fabEl.offsetWidth, bottom: fabEl.offsetTop + fabEl.offsetHeight };
    let lift = 0;
    while (lift <= 120 && hits({ left: r0.left, right: r0.right, top: r0.top - lift, bottom: r0.bottom - lift })) lift += 12;
    if (lift > 120) { fabEl.classList.add('is-away'); return; }
    fabEl.classList.toggle('is-away', down);
    if (lift) fabEl.style.setProperty('--lift', `-${lift}px`); else fabEl.style.removeProperty('--lift');
  };
  addEventListener('scroll', () => {
    const y = scrollY, dy = y - lastY;
    if (Math.abs(dy) >= 6) { down = dy > 0 && y > 240 && y + innerHeight < document.documentElement.scrollHeight - 80; lastY = y; fabEl.classList.toggle('is-away', down); }
    clearTimeout(t); t = setTimeout(() => { down = false; fit(); }, 160);
  }, { passive: true });
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fit, 160); });
  return () => { clearTimeout(t); t = setTimeout(fit, 60); };
})();
new MutationObserver(fabFit).observe(fabEl, { attributes: true, attributeFilter: ['hidden'] });

function resetChat() {
  catBeforeChat = null;
  closing = null;
  chat.classList.remove('is-closing');
  undock();
  $('#aChatCtx').replaceChildren();
  $('#aChatCtx').hidden = true;
  if (chat.open) chat.close();
  chatAgent = ALFI;
  panes.clear();
  runs.clear();
  log.replaceChildren();
  $('#aChatInput').value = '';
  $('#aChatSugg').replaceChildren();
  chatTitle.textContent = ALFI.name;
  chatSt.textContent = '';
  mount(chatAva, 'alfi');
  mount($('#aFabBuddy'), 'alfi', 160);
  delete $('#aChatClear').dataset.armed;
}

export { openChat, say, chat, closeChat, fabFit, KIND_T, resetChat };
