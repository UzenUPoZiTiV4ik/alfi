import { $, esc, $$, safeUrl, KIND, plural, reduce, cut, toast, modal } from './ui.js';
import { byId, S } from './state.js';
import { agentOf, mount, ALFI } from './people.js';
import { SIGN, IMPACT_T, renderFeed } from './feed.js';
import { tidy } from './profile.js';
import { KIND_T, openChat } from './chat.js';
import { API } from './api.js';

/* ---------- Разбор события ----------
   Пока агент работает: шесть этапов с таймером и контур будущего разбора.
   Готовый разбор — бриф: ответ, что делать, где это заденет компанию и позиция банка.
   Риски, сценарии, факты, источники и проверки раскрываются по запросу, без сносок в тексте. */
const ins = $('#aIns'), insBody = $('#aInsBody'), insFoot = $('#aInsFoot'), rPop = $('#rPop');
let insId = null, insTimer = 0, spy = null, popBtn = null;
const STAGES = [
  ['Контекст', 'Изучаем профиль компании и саму новость'],
  ['План', 'Решаем, что нужно проверить'],
  ['Данные', 'Собираем аналитику банка и новости по теме'],
  ['Разбор', 'Формулируем выводы для компании'],
  ['Перепроверка', 'Сверяем цифры с источниками'],
  ['Готово', 'Разбор готов']
];
const stageOf = (t) => ({ context: 0, plan: 1, tool: 2, check: 2, llm: 3, verify: 4, critic: 4, repair: 4, final: 5 })[t];
const txt = (x) => (typeof x === 'string' ? x : x && (x.text || x.title || x.name || x.question || x.gap) || '');
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const brief = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(brief).filter(Boolean).join(', ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${brief(x)}`).join('; ') : String(v));
const CRIT_T = { grounding: 'опора на источники', personalization: 'персонализация', depth: 'глубина', attribution: 'атрибуция' };

/* --- Пока агент работает --- */
function runSkeleton(id) {
  const it = byId(id), mate = agentOf(it && it.helper);
  const g = (...ws) => ws.map((w) => `<i style="width:${w}%"></i>`).join('');
  insBody.innerHTML = `<div class="b-run" data-run="${esc(id)}">
    <div class="b-run__head">
      <span class="b-run__ava" data-rava></span>
      <div class="b-run__hd"><p class="b-run__t">Готовим разбор для компании</p>${it ? `<p class="b-run__n">${esc(it.headline || it.title)}</p>` : ''}</div>
    </div>
    <ol class="b-run__bar">${STAGES.map(([t], i) => `<li data-st="${i}"><i></i><span class="visually-hidden">${t}</span></li>`).join('')}</ol>
    <p class="b-run__s" data-rstage role="status"></p>
    <div class="b-run__msg" data-rmsg role="alert" hidden></div>
    <div class="b-ghost" aria-hidden="true">
      <p class="b-ghost__k">${g(22)}</p><p class="b-ghost__h">${g(94, 58)}</p><p class="b-ghost__p">${g(100, 98, 100, 64)}</p>
      <p class="b-ghost__s">${g(36)}</p><div class="b-ghost__rows">${[46, 38, 52, 34].map((w) => `<p>${g(w)}</p>`).join('')}</div>
    </div>
  </div>`;
  mount(insBody.querySelector('[data-rava]'), mate.kind, 96);
}
function runUpdate(id) {
  const R = S.runs[id], box = insBody.querySelector(`.b-run[data-run="${CSS.escape(id)}"]`);
  if (!R || !box) return;
  // этап только растёт: поздние проверки данных не откатывают полосу назад
  for (const ev of R.steps.slice(+(box.dataset.n || 0))) if (stageOf(ev.type) != null) box.dataset.cur = Math.max(+(box.dataset.cur || 0), stageOf(ev.type));
  box.dataset.n = R.steps.length;
  const last = STAGES.length - 1, cur = R.result ? last : +(box.dataset.cur || 0), stop = !!(R.error || R.held);
  $$('[data-st]', box).forEach((li, i) => {
    li.classList.toggle('is-done', i < cur || !!R.result);
    li.classList.toggle('is-on', i === cur && !R.result && !stop);
    li.classList.toggle('is-err', i === cur && !!R.error);
  });
  box.dataset.cur = cur;
  stageLine(id);
  box.classList.toggle('is-stopped', stop);
  const msg = box.querySelector('[data-rmsg]');
  const head = box.querySelector('.b-run__t'); if (head) head.textContent = R.error ? 'Разбор не готов' : R.held ? 'Новый разбор завтра' : 'Готовим разбор для компании';
  if (R.error) { msg.hidden = false; msg.innerHTML = `<p class="b-text" title="${esc(R.error)}">Не удалось подготовить разбор: сервис анализа не ответил. Лента и готовые разборы работают, повторите через минуту.</p><button class="btn btn--secondary" type="button" data-ins-redo><svg class="ic ic--sm" aria-hidden="true"><use href="#i-refresh"/></svg>Повторить</button>`; }
  else if (R.held) { msg.hidden = false; msg.innerHTML = '<p class="b-text">На сегодня лимит новых разборов исчерпан. Лента и готовые разборы доступны, новый разбор можно будет подготовить завтра.</p>'; }
}
function stageLine(id) {
  const R = S.runs[id], box = insBody.querySelector(`.b-run[data-run="${CSS.escape(id)}"]`), el = box && box.querySelector('[data-rstage]');
  if (!R || !el) return;
  const x = STAGES[+(box.dataset.cur || 0)][1];
  el.textContent = R.result ? 'Разбор готов' : R.error || R.held ? ''
    : Date.now() - (R.t0 || Date.now()) > 60000 ? `${x}. Это дольше обычного, разбор продолжается` : `${x}. Обычно это занимает до минуты`;
}
function runTimer(id) {
  clearInterval(insTimer);
  const tick = () => { if (!insBody.querySelector('.b-run') || !S.runs[id] || S.runs[id].done) { clearInterval(insTimer); return; } stageLine(id); };
  tick(); insTimer = setInterval(tick, 1000);
}

/* --- Готовый разбор ---
   Порядок чтения: ответ → что делать → где заденет → позиция банка → подробности по запросу.
   Источники не стоят сносками после каждой фразы: они в одном списке, у банка — свои материалы. */
const BASIS = { bank: ['is-bank', 'Альфа-Банк'], 'bank+ai': ['is-mix', 'Альфа-Банк и Альфи'], ai: ['is-ai', 'Вывод Альфи'] };
const basis = (b) => { const x = BASIS[b] || BASIS.ai; return `<span class="i-basis ${x[0]}">${x[1]}</span>`; };
let SRC = {};
const PROB = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const URG = { now: 'Сейчас', week: 'На этой неделе', month: 'В течение месяца', quarter: 'В этом квартале' };
const STATUS = { reported: 'по сообщениям СМИ', unconfirmed: 'не подтверждено', unclear: 'не подтверждено', expected: 'ожидается' };
const KIND_IMPACT = { risk: 'negative', chance: 'positive', mixed: 'mixed' };
const areaImpact = (a) => a.impact || ({ up: 'positive', down: 'negative', mixed: 'mixed' })[a.direction] || '';
const SRC_GROUPS = [['news', 'Новости'], ['web', 'Интернет'], ['bank', 'Аналитика Альфа-Банка'], ['data', 'Данные о компании'], ['other', 'Другие материалы']];
const srcGroup = (id) => { const k = id.split(':')[0]; return k === 'feat' || k === 'data' ? 'data' : SRC_GROUPS.some(([g]) => g === k) ? k : 'other'; };
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ruDate = (t) => String(t || '').replace(/\((\d{4})-(\d{2})-(\d{2})\)/, (_, y, m, d) => `(${+d} ${MONTHS_G[+m - 1]} ${y})`);
const obj = (x) => (x && typeof x === 'object' ? x : { text: txt(x) });
const URG_ORDER = ['now', 'week', 'month', 'quarter'];
const urgRank = (u) => { const i = URG_ORDER.indexOf(u); return i < 0 ? URG_ORDER.length : i; };
const madeAt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(d); };
const RULE_T = {
  refs_exist: 'Все ссылки ведут на найденные материалы', items_sourced: 'У рисков, возможностей и шагов есть источник',
  bank_attribution: 'Позиция банка взята только из материалов банка', bank_used: 'Найденная аналитика банка учтена',
  features: 'Учтены данные о компании', channels: 'Разобрано несколько путей влияния',
  numbers: 'Цифры сверены с источниками', not_retelling: 'Выводы, а не пересказ новости', has_action: 'Есть конкретный шаг'
};
// Что не прошло проверку — по-человечески, без счётчика правил
const RULE_FAIL = {
  refs_exist: 'часть ссылок не удалось открыть', items_sourced: 'не у всех пунктов указан источник',
  bank_attribution: 'не все пункты позиции банка взяты из его материалов', bank_used: 'не вся найденная аналитика банка учтена',
  features: 'данные о компании учтены не полностью', channels: 'разобран только один путь влияния',
  numbers: 'для части цифр не нашли источник', not_retelling: 'часть выводов близка к пересказу новости', has_action: 'конкретного шага нет'
};

function docHTML(r) {
  SRC = r.sources || {};
  const w = r.what_happened || {}, bv = r.bank_view || {}, it = byId(insId);
  const rules = arr(r.rules);
  const [areas, risks, opps, scen, facts, pts] = [r.affected_areas, r.risks, r.opportunities, r.scenarios, w.facts, bv.points].map((x) => arr(x).map(obj));
  const acts = arr(r.actions).map(obj).sort((a, b) => urgRank(a.urgency) - urgRank(b.urgency));
  const made = madeAt((r.meta || {}).created);
  const qs = [...arr(r.questions), ...arr(r.data_gaps)].map(txt).filter(Boolean);
  const ids = Object.keys(SRC), bankN = ids.filter((id) => srcGroup(id) === 'bank').length;
  const lead = txt(r.why_it_matters), src = it && safeUrl(it.url);
  const quiet = !areas.length && !acts.length, bankEmpty = !bv.summary && !pts.length, failed = rules.filter((x) => !x.ok);
  const sign = (im) => (SIGN[im] ? `<i class="b-sign ${SIGN[im][0]}" aria-hidden="true">${SIGN[im][1]}</i>` : '');
  const meta = (parts) => { const p = parts.filter(Boolean); return p.length ? `<span class="b-meta">${p.join(' · ')}</span>` : ''; };
  const list = (xs, f) => `<ul class="b-list">${xs.map((x) => `<li>${f(x)}</li>`).join('')}</ul>`;
  const titled = (x) => `${x.title ? `<b>${esc(x.title)}.</b> ` : ''}${esc(x.text || '')}`;
  const row = (id, title, n, body) => (body ? `<details class="b-row" id="${id}"><summary><span>${title}</span>${n ? `<span class="b-row__n">${n}</span>` : ''}</summary><div class="b-row__in">${body}</div></details>` : '');
  const sec = (title, body, cls = '') => `<section class="b-sec b-part ${cls}">${title ? `<h4 class="b-h">${title}</h4>` : ''}${body}</section>`;

  const cover = `<header class="b-cover b-part">
      <p class="b-kind">${quiet ? '' : sign(KIND_IMPACT[r.kind])}${quiet ? 'К сведению' : KIND[r.kind] || 'К сведению'}${made ? `<span class="b-kind__at"><span>Собран </span>${esc(made)}</span>` : ''}</p>
      <h3 class="b-title">${esc(r.headline || (it && (it.headline || it.title)) || 'Разбор события')}</h3>
      ${lead ? `<p class="b-lead" data-clamp>${esc(tidy(lead))}</p>` : ''}
      ${ids.length || src ? `<p class="b-trust">
        ${ids.length ? `<button type="button" class="b-trust__i" data-open="b-src">${ids.length} ${plural(ids.length, 'источник', 'источника', 'источников')}</button>` : ''}
        ${src ? `<a class="b-trust__i" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${it.source ? `Новость в ${esc(it.source)}` : 'Открыть новость'}<svg class="ic" aria-hidden="true"><use href="#i-arrow-ur"/></svg></a>` : ''}
      </p>` : ''}
      ${r.demo ? '<p class="b-demo">Демо-разбор: сервис анализа сейчас недоступен, поэтому текст собран по шаблону из данных ленты, профиля компании и аналитики банка.</p>' : ''}
    </header>`;

  const map = !areas.length ? '' : sec('Где это заденет компанию', `<div class="b-map">${areas.map((a) => {
    const im = areaImpact(a), why = a.effect || a.text || '';
    const head = `${sign(im) || '<i class="b-sign" aria-hidden="true"></i>'}<span class="b-map__l">${esc(a.label || a.area)}</span><span class="b-map__v">${IMPACT_T[im] || ''}</span>`;
    return why ? `<details class="b-map__i"><summary>${head}</summary><p>${esc(why)}</p></details>` : `<div class="b-map__i"><div class="b-map__s">${head}</div></div>`;
  }).join('')}</div>`);

  const act = sec('Что делать', acts.length
    ? `<ol class="b-acts">${acts.map((x) => `<li><p class="b-acts__when${x.urgency === 'now' ? ' is-now' : ''}">${esc(URG[x.urgency] || x.urgency || '')}</p><div><p class="b-acts__t">${esc(x.title || x.text || '')}</p>${x.title && x.text ? `<p class="b-acts__x">${esc(x.text)}</p>` : ''}${meta([x.owner && esc(x.owner), x.product && `продукт банка: ${esc(x.product)}`])}</div></li>`).join('')}</ol>`
    : '<p class="b-text b-text--muted">Срочных действий не нужно, достаточно следить за ситуацией</p>');

  const bank = bankEmpty && quiet ? '' : sec('', `<div class="b-bank">
      <h4 class="b-h"><svg class="ic" aria-hidden="true"><use href="#i-bank"/></svg>Позиция Альфа-Банка</h4>
      ${bv.summary ? `<p class="b-text">${esc(bv.summary)}</p>` : ''}
      ${pts.length ? list(pts, (x) => `${esc(x.text)}${x.support != null && x.support < 0.3 ? meta(['пересказ, дословной цитаты в отчёте банка нет']) : ''}`) : ''}
      ${!bv.summary && !pts.length ? '<p class="b-text b-text--muted">В аналитике банка по этой теме прямых материалов нет</p>' : ''}
      ${bv.summary || pts.length ? `<p class="b-bank__f">Из аналитики банка, отдельно от выводов Альфи${bankN ? ` · <button type="button" data-open="b-src">${bankN} ${plural(bankN, 'материал', 'материала', 'материалов')}</button>` : ''}</p>` : ''}
    </div>`);

  const sources = SRC_GROUPS.map(([g, label]) => {
    const xs = ids.filter((id) => srcGroup(id) === g);
    return xs.length ? `<div class="b-srcg"><p class="b-sub">${label}<span>${xs.length}</span></p><ul class="b-srcs">${xs.map((id) => { const x = SRC[id]; return `<li><button type="button" data-pop="${esc(id)}"><span>${esc(ruDate(x.title || id))}</span>${g === 'bank' && x.verified === false ? '<small>без дословной цитаты</small>' : g === 'data' && x.text ? `<small>${esc(tidy(x.text))}</small>` : ''}</button></li>`; }).join('')}</ul></div>` : '';
  }).join('');
  const what = facts.length
    ? list(facts, (f) => `${esc(f.text || '')}${STATUS[f.status] ? meta([STATUS[f.status]]) : ''}`)
    : w.summary ? `<p class="b-text">${esc(w.summary)}</p>` : '';
  const rows = [
    row('b-facts', 'Что случилось', facts.length, what && what + (w.timing ? `<p class="b-note">Сроки: ${esc(brief(w.timing).replace(/^[А-ЯЁ](?=[а-яё])/, (c) => c.toLowerCase()))}</p>` : '')),
    row('b-risks', 'Риски', risks.length, risks.length && list(risks, (x) => `${titled(x)}${meta([x.probability && `вероятность ${PROB[x.probability] || esc(x.probability)}`, x.horizon && esc(tidy(x.horizon))])}`)),
    row('b-opps', 'Возможности', opps.length, opps.length && list(opps, (x) => `${titled(x)}${meta([x.horizon && esc(tidy(x.horizon))])}`)),
    row('b-scen', 'Сценарии', scen.length, scen.length && list(scen, (x) => `<b>${esc(cap(x.name || x.title))}.</b> ${esc(x.text || '')}${x.trigger ? meta([`Признак: ${esc(x.trigger)}`]) : ''}`)),
    row('b-ask', 'Что уточнить в компании', qs.length, qs.length && list(qs, (q) => esc(q))),
    row('b-src', 'Источники', ids.length, sources),
    row('b-checks', 'Проверка разбора', '', rules.length && (failed.length
      ? `<p class="b-text">Перед решением перепроверьте:</p><ul class="b-checks">${failed.map((x) => `<li class="is-no"><i aria-hidden="true">!</i><span>${cap(esc(RULE_FAIL[x.id] || RULE_T[x.id] || x.name))}</span></li>`).join('')}</ul>`
      : '<p class="b-text">Ссылки, цифры и позиция банка сверены с источниками.</p>'))
  ].join('');

  return `<article class="b-doc">${cover}${act}${map}${bank}${rows ? sec('Подробнее', `<div class="b-rows">${rows}</div>`) : ''}
    <div class="b-rate b-part" data-rate-box><span>Разбор полезен?</span><button class="btn btn--secondary" type="button" data-rate="5">Да</button><button class="btn btn--secondary" type="button" data-rate="1">Нет</button></div></article>`;
}
function footHTML() {
  return `<button class="btn btn--dark" type="button" data-ins-chat>Задать вопрос по разбору</button>
    <button class="btn btn--ghost" type="button" data-ins-redo aria-label="Обновить разбор"><svg class="ic ic--sm"><use href="#i-refresh"/></svg><span class="r-foot__t">Обновить разбор</span></button>`;
}
function showDoc(id, animate) {
  const R = S.runs[id];
  hidePop();
  insBody.innerHTML = docHTML(R.result);
  insBody.scrollTop = 0;
  insFoot.hidden = false; insFoot.innerHTML = footHTML();
  requestAnimationFrame(() => $$('[data-clamp]', insBody).forEach((p) => {
    if (p.scrollHeight > p.clientHeight + 4 && !(p.nextElementSibling && p.nextElementSibling.matches('.b-clamp'))) { const b = document.createElement('button'); b.type = 'button'; b.className = 'b-clamp'; b.textContent = 'Читать полностью'; b.onclick = () => { p.removeAttribute('data-clamp'); b.remove(); }; p.after(b); }
  }));
  if (animate && !reduce) $$('.b-part', insBody).forEach((s, i) => s.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 40 + i * 60, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' }));
  // заголовок разбора переезжает в шапку, когда уходит за верхний край
  if (spy) spy.disconnect();
  ins.classList.remove('is-scrolled');
  $('#aInsTitle').textContent = cut(R.result.headline || $('#aInsTitle').textContent, 140);
  const h = insBody.querySelector('.b-title');
  if (h) { spy = new IntersectionObserver(([e]) => ins.classList.toggle('is-scrolled', !e.isIntersecting), { root: insBody }); spy.observe(h); }
}
/* --- Карточка источника рядом с кнопкой --- */
function showPop(btn, id) {
  const s = SRC[id]; if (!s) return;
  const k = id.split(':')[0], url = safeUrl(s.url);
  rPop.innerHTML = `<p class="r-pop__k is-${esc(k)}">${esc(KIND_T[k] || k)}${k === 'bank' && s.verified != null ? (s.verified ? ' · цитата сверена с отчётом' : ' · без дословной цитаты') : ''}${s.stale ? ' · материал устарел' : ''}</p>
    <p class="r-pop__t">${esc(s.title || id)}</p>
    ${s.quote ? `<q>${esc(cut(s.quote, 320))}</q>` : s.text ? `<p class="r-pop__x">${esc(cut(s.text, 320))}</p>` : ''}
    ${url ? `<p class="r-pop__f"><a class="btn btn--secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${k === 'bank' ? 'Открыть отчёт' : 'Открыть'}<svg class="ic ic--sm"><use href="#i-ext"/></svg></a></p>` : ''}`;
  rPop.hidden = false;
  const r = btn.getBoundingClientRect(), d = ins.getBoundingClientRect(), pw = Math.min(380, d.width - 24);
  rPop.style.width = pw + 'px';
  const left = Math.max(12, Math.min(r.left - d.left, d.width - pw - 12));
  const below = r.bottom - d.top + 8, ph = rPop.offsetHeight;
  rPop.style.left = left + 'px';
  rPop.style.top = (below + ph > d.height - 12 ? Math.max(12, r.top - d.top - ph - 8) : below) + 'px';
  if (!reduce) rPop.animate([{ opacity: 0, transform: 'translateY(4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,.9,.3,1)' });
  rPop.dataset.for = id;
  popBtn = btn;
  rPop.focus({ preventScroll: true });
}
function hidePop() {
  if (rPop.hidden) return;
  const back = rPop.contains(document.activeElement) && popBtn;
  rPop.hidden = true; rPop.dataset.for = '';
  if (back && back.isConnected) back.focus({ preventScroll: true });
}

/* --- Запуск и показ --- */
function paintRun(id) {
  if (insId !== id || !ins.open) return;
  const R = S.runs[id]; if (!R) return;
  if (R.result && R.done) {
    if (insBody.dataset.view !== 'doc:' + id) { const was = insBody.dataset.view === 'run:' + id; insBody.dataset.view = 'doc:' + id; showDoc(id, true); if (was) toast('Разбор готов'); }
    return;
  }
  if (insBody.dataset.view !== 'run:' + id) { insBody.dataset.view = 'run:' + id; insFoot.hidden = true; runSkeleton(id); runTimer(id); }
  runUpdate(id);
}
function startRun(id, force) {
  const R = S.runs[id] = { steps: [], result: null, error: '', held: false, done: false, t0: Date.now() };
  const h = API.stream(`/api/insight/${encodeURIComponent(id)}/stream${force ? '?force=true' : ''}`, { onEvent: (type, ev) => {
    if (S.runs[id] !== R || type === 'start' || type === 'end') return;
    if (type === 'final') { const d = ev.data || {}; if (d.result) R.result = d.result; else R.held = true; }
    else if (type === 'error') R.error = (ev.data && ev.data.message) || ev.title;
    R.steps.push(ev);
    paintRun(id);
  } });
  h.done.catch((e) => { R.error = R.error || e.message; }).finally(() => {
    R.done = true;
    if (S.runs[id] !== R) return;
    if (R.result) { const it = byId(id); if (it && !it.has_insight) { it.has_insight = true; renderFeed(true); } }
    // небольшая пауза, чтобы было видно, что все этапы закрылись
    setTimeout(() => { if (S.runs[id] === R) paintRun(id); }, R.result && !reduce ? 650 : 0);
    if (insId === id) runUpdate(id);
  });
}
async function openInsight(id, force) {
  const gen = S.sessionGen;
  const it = byId(id);
  insId = id; insBody.dataset.view = '';
  $('#aInsTitle').textContent = it ? cut(it.headline || it.title, 120) : 'Разбор для компании';
  $('#aInsKicker').innerHTML = `Разбор для компании${S.me ? `<span> · ${esc(S.me.role_label)}</span>` : ''}`;
  insFoot.hidden = true; hidePop();
  ins.classList.remove('is-scrolled'); if (spy) spy.disconnect();
  if (!ins.open) modal(ins);
  const R = S.runs[id];
  if (!force && R && (!R.done || R.result)) { paintRun(id); return; }
  if (!force) {
    insBody.innerHTML = '<p class="tr-lead r-wait"><span class="f-spin" aria-hidden="true"></span>Открываем разбор…</p>';
    try {
      const c = await API.get(`/api/insight/${encodeURIComponent(id)}`);
      if (gen !== S.sessionGen || insId !== id || !ins.open) return;
      S.runs[id] = { steps: [], result: c, done: true };
      paintRun(id); return;
    } catch (e) {
      if (gen !== S.sessionGen || insId !== id || !ins.open) return;
      if (e.status !== 404) { insBody.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; return; }
    }
  }
  startRun(id, force);
  paintRun(id);
}
ins.addEventListener('close', () => { clearInterval(insTimer); hidePop(); if (spy) spy.disconnect(); });
ins.addEventListener('cancel', (e) => { if (!rPop.hidden) { e.preventDefault(); hidePop(); } });
insBody.addEventListener('scroll', hidePop, { passive: true });
ins.addEventListener('click', async (e) => {
  let t;
  if ((t = e.target.closest('[data-pop]'))) { if (rPop.dataset.for === t.dataset.pop) hidePop(); else showPop(t, t.dataset.pop); return; }
  if (!e.target.closest('#rPop')) hidePop();
  if ((t = e.target.closest('[data-open]'))) {
    const d = insBody.querySelector('#' + CSS.escape(t.dataset.open));
    if (d) { d.open = true; insBody.scrollTo({ top: d.getBoundingClientRect().top - insBody.getBoundingClientRect().top + insBody.scrollTop - 12, behavior: reduce ? 'auto' : 'smooth' }); const sm = d.querySelector('summary'); if (sm) sm.focus({ preventScroll: true }); }
    return;
  }
  if (e.target.closest('[data-ins-redo]')) { openInsight(insId, true); return; }
  if (e.target.closest('[data-ins-chat]')) { const id = insId, it = byId(id); ins.close(); openChat(it ? agentOf(it.helper) : ALFI, id); return; }
  if ((t = e.target.closest('[data-rate]'))) {
    const gen = S.sessionGen;
    try {
      await API.post('/api/feedback', { news_id: insId, kind: 'rating', value: +t.dataset.rate });
    } catch (error) {
      if (gen === S.sessionGen) toast(error.message);
      return;
    }
    const box = t.closest('[data-rate-box]'); if (box) box.textContent = +t.dataset.rate >= 4 ? 'Спасибо за оценку' : 'Спасибо, учтём в следующих разборах';
  }
});

function resetInsight() {
  insId = null;
  clearInterval(insTimer);
  spy?.disconnect();
  SRC = {};
  hidePop();
  rPop.replaceChildren();
  insBody.replaceChildren();
  insBody.dataset.view = '';
  insFoot.replaceChildren();
  insFoot.hidden = true;
  $('#aInsTitle').textContent = '';
  $('#aInsKicker').textContent = '';
}

export { openInsight, CRIT_T, resetInsight, basis };
