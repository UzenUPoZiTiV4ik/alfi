import { S, isRead, visible, helperFilter, inTab, ofHelper, ofArea, FEED_STEP, byId } from './state.js';
import { esc, cut, kindOf, safeUrl, icon, KIND, plural, ago, $, reduce, $$, fmt, toast } from './ui.js';
import { agentOf, mount, setTeam, PEOPLE } from './people.js';
import { markTeam, catSwap, paintWho } from './stage.js';
import { fabFit, chat } from './chat.js';
import { writeFilters, readFilters } from './url.js';
import { API, assertCurrent } from './api.js';
import { renderTeam, renderScheduleControl } from './team.js';
import { renderHero } from './summary.js';

/* ---------- Карточка ленты ----------
   Наверху событие и первоисточник. Ниже «Почему это вам»: признаки компании, из-за которых новость попала в ленту,
   сферы бизнеса, которые она затрагивает, и ближайший тезис аналитики Альфа-Банка со ссылкой на страницу PDF. */
const IMPACT = { negative: 'is-neg', positive: 'is-pos', mixed: 'is-mix' };
const IMPACT_T = { negative: 'во вред', positive: 'на пользу', mixed: 'и плюс, и минус' };
// Знак влияния: линия тренда вверх или вниз, «±» когда событие и помогает, и мешает
const TREND = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const SIGN = {
  negative: ['is-neg', TREND('M4 7l6 6 3.5-3.5L20 16M20 10.5V16h-5.5'), 'во вред'],
  positive: ['is-pos', TREND('M4 17l6-6 3.5 3.5L20 8M20 13.5V8h-5.5'), 'на пользу'],
  mixed: ['is-mix', TREND('M12 4.5v8M8 8.5h8M8 18.5h8'), 'и плюс, и минус']
};
// Одинаковую цитату банка у соседних карточек показываем один раз
const bankKey = (it) => { const b = (it && it.bank_refs || [])[0]; return b ? b.doc_title + '|' + b.page + '|' + b.text : ''; };
function card(it, noBank) {
  if (S.gone.has(it.id)) {
    return `<div class="a-gone" data-id="${esc(it.id)}"><span>Новость «${esc(cut(it.headline || it.title, 90))}» скрыта. Похожие будем показывать реже.</span><button data-undo="${esc(it.id)}">Вернуть</button></div>`;
  }
  const k = kindOf(it), src = safeUrl(it.url), mate = agentOf(it.helper);
  const bank = noBank ? null : (it.bank_refs || [])[0], bankUrl = bank && safeUrl(bank.url);
  const areas = (it.areas || []).filter((a) => a.label).slice(0, 3);
  const step = it.action && !/^(Разобрать|Не требуется)/i.test(it.action) ? it.action : '';
  const sign = (a) => SIGN[a.impact] || ['', TREND('M7 12h10'), 'влияние'];
  return `
    <article class="a-card f-card is-${k}${it.user ? ' is-user' : ''}" data-id="${esc(it.id)}">
      <header class="f-head">
        <span class="f-ic is-${k}" title="${esc(it.main_factor_label || '')}">${icon(it)}</span>
        <p class="f-meta">
          ${it.urgency >= 3 ? `<span class="f-badge is-urgent">Срочно${S.tab === k ? '' : ` · ${KIND[k]}`}</span>` : S.tab === k ? '' : `<span class="f-badge is-${k}"><i aria-hidden="true"></i>${KIND[k]}</span>`}
          <span class="f-meta__s">${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(it.source)}</a>` : esc(it.source)}${it.n_sources > 1 ? ` <span class="f-meta__n" title="Ещё ${it.n_sources - 1} ${plural(it.n_sources - 1, 'источник', 'источника', 'источников')}">+${it.n_sources - 1}</span>` : ''}</span>
          <button class="f-lnk" type="button" data-useful="${esc(it.id)}" aria-pressed="${S.useful.has(it.id)}">${S.useful.has(it.id) ? '✓ Полезно' : 'Полезно'}</button>
          <time class="f-date" datetime="${esc(it.published || '')}">${esc(ago(it.published))}</time>${it.user ? '<span class="c-mine">ваша новость</span>' : ''}
        </p>
        ${isRead(it) ? `<button class="f-read is-back" data-unread="${esc(it.id)}" aria-label="Вернуть в ленту" title="Вернуть в ленту"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="f-read__t">Вернуть</span></button>`
          : `<button class="f-read" data-read="${esc(it.id)}" aria-label="Отметить прочитанным" title="Отметить прочитанным"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="f-read__t">Прочитано</span></button>`}
        <h3 class="a-card__title f-title">${esc(it.headline || it.title)}</h3>
      </header>
      <div class="f-body">
        ${areas.length && !areas.some((a) => String(a.effect || '').trim()) ? `<ul class="f-tags" aria-label="Что задевает">${areas.map((a) => `<li class="${sign(a)[0]}" title="${sign(a)[2]}">${esc(a.label)}</li>`).join('')}</ul>`
          : areas.length ? `<ul class="f-imp" aria-label="Что меняется для компании">${areas.map((a) => { const g = sign(a); const e = String(a.effect || '').trim(), e2 = /^[А-ЯЁA-Z][а-яёa-z]/.test(e) ? e[0].toLowerCase() + e.slice(1) : e; return `<li class="${g[0]}"><span class="f-imp__s" role="img" aria-label="${g[2]}" title="${g[2]}">${g[1]}</span><p><b>${esc(a.label)}</b>${e2 ? `: ${esc(e2)}` : ''}</p></li>`; }).join('')}</ul>`
          : it.lead ? `<p class="f-lead">${esc(cut(it.lead, 220))}</p>` : ''}
        ${step || bankUrl ? `<div class="f-panel${step && bankUrl ? ' is-two' : ''}">
          ${step ? `<div class="f-panel__c"><p class="f-panel__k">Что сделать <span>вывод AI</span></p><p class="f-panel__t">${esc(step)}</p></div>` : ''}
          ${bankUrl ? `<a class="f-panel__c f-panel__bank" href="${esc(bankUrl)}" target="_blank" rel="noopener" title="${esc(bank.doc_title)}"><p class="f-panel__k"><svg class="ic" aria-hidden="true"><use href="#i-bank"/></svg>Альфа-Банк<span>стр. ${esc(bank.page)}</span></p><p class="f-panel__q">${esc(bank.text)}</p></a>` : ''}
        </div>` : ''}
      </div>
      <footer class="a-card__acts f-acts">
        <button class="btn ${it.has_insight || it.urgency >= 3 ? 'btn--dark' : 'btn--secondary'}" data-ins="${esc(it.id)}">${it.has_insight ? (it.insight_readiness === 'needs_review' ? 'Проверить разбор' : 'Открыть разбор') : 'Подготовить разбор'}</button>
        <button class="f-ask" data-askabout="${esc(it.id)}" data-askhelper="${esc(mate.id)}" aria-label="Задать вопрос ${mate.all ? 'Альфи' : `помощнику «${esc(mate.name)}»`} об этой новости" title="${esc(mate.all ? 'Альфи: все темы' : `Помощник «${mate.name}»: ${mate.task || mate.watch}`)}"><span class="f-ask__ava" data-ava="${esc(mate.id)}"></span><span class="f-ask__t">Задать вопрос</span><span class="f-ask__s" aria-hidden="true">Спросить</span></button>
        ${it.user || isRead(it) ? '' : `<button class="f-nope" type="button" data-nope="${esc(it.id)}" aria-label="Скрыть: не касается компании" title="Скрыть и показывать похожие реже">Не про нас</button>`}
      </footer>
    </article>`;
}
const sigOf = (it) => [S.gone.has(it.id), isRead(it), S.useful.has(it.id), it.has_insight, it.insight_readiness || '', it.urgency, (it.areas || []).map((a) => a.id + a.impact).join(), it.relevance, it.helper, it.action, it.kind].join('|');

// Лента не перерисовывается целиком: карточки переиспользуются, новые проявляются, остальные съезжают (FLIP)
function renderFeed(quiet) {
  const wrap = $('#aCards');
  const list = visible();
  const more = $('#fMore');
  more.hidden = !S.feed?.has_more;
  more.textContent = 'Показать ещё';
  const animate = !quiet && !reduce;
  $$('.a-empty', wrap).forEach((el) => el.remove());
  const wrapTop = wrap.getBoundingClientRect().top;
  const prev = new Map();
  for (const el of wrap.querySelectorAll('[data-id]')) prev.set(el.dataset.id, el.getBoundingClientRect());
  const have = new Map([...wrap.querySelectorAll('[data-id]')].map((el) => [el.dataset.id, el]));
  const want = new Set(list.map((it) => it.id));

  for (const [id, el] of [...have]) {
    if (want.has(id)) continue;
    have.delete(id);
    if (!animate) { el.remove(); continue; }
    const r = prev.get(id);
    el.style.cssText += `position:absolute;left:0;top:${r.top - wrapTop}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:0;`;
    const a = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 130, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'both' });
    a.finished.then(() => el.remove(), () => el.remove());
  }
  const entering = [], seenBank = new Set();
  list.forEach((it) => {
    const bk = bankKey(it), noBank = !!bk && seenBank.has(bk);
    if (bk) seenBank.add(bk);
    const sig = JSON.stringify(it) + sigOf(it) + (noBank ? '|nb' : '') + '|' + S.tab;
    let el = have.get(it.id);
    have.delete(it.id);
    if (el && el.dataset.sig === sig) { wrap.appendChild(el); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = card(it, noBank);
    const fresh = tmp.firstElementChild;
    fresh.dataset.sig = sig;
    if (el) el.replaceWith(fresh); else wrap.appendChild(fresh);
    wrap.appendChild(fresh);
    if (!el) entering.push(fresh);
  });
  if (!list.length) {
    wrap.insertAdjacentHTML('beforeend', S.feed ? `<div class="a-empty">${helperFilter() ? `У помощника «${esc(agentOf(S.cat).name)}» пока нет событий в этой вкладке.` : (S.tab === 'read' ? 'Прочитанных пока нет. Отмечайте новости кнопкой «Прочитано», и они соберутся здесь.' : 'Новых событий в этой вкладке нет.')}</div>` : '<div class="a-empty">Загружаем ленту…</div>');
  }
  for (const el of wrap.querySelectorAll('[data-ava]')) if (!el.firstChild) mount(el, agentOf(el.dataset.ava).kind);
  if (animate) {
    for (const el of wrap.querySelectorAll('[data-id]')) {
      const r0 = prev.get(el.dataset.id), r1 = el.getBoundingClientRect();
      if (!r0) { el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,0,0,1)', fill: 'both' }); continue; }
      const dy = r0.top - r1.top;
      if (Math.abs(dy) >= 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' });
    }
  }
  $$('.a-tab').forEach((t) => {
    const n = S.items.filter((it) => inTab(it, t.dataset.tab) && ofHelper(it) && ofArea(it) && !S.gone.has(it.id)).length;
    t.hidden = t.dataset.tab === 'read' && S.tab !== 'read' && !S.items.some(isRead);
    t.querySelector('sup').textContent = n;
    t.setAttribute('aria-label', `${t.firstChild.textContent}, ${n}`);
    t.setAttribute('aria-selected', String(t.dataset.tab === S.tab));
    t.tabIndex = t.dataset.tab === S.tab ? 0 : -1;
  });
  const f = $('#aFilter'), tok = [];
  if (helperFilter()) tok.push(`<button class="a-token" data-clearteam aria-label="Снять фильтр: ${esc(agentOf(S.cat).name)}"><span class="a-token__ava" data-tava></span>${esc(agentOf(S.cat).name)}<svg class="ic ic--sm"><use href="#i-close"/></svg></button>`);
  if (S.area) tok.push(`<button class="a-token" data-cleararea aria-label="Снять фильтр: ${esc(S.areaLabel || '')}">${esc(S.areaLabel || '')}<svg class="ic ic--sm"><use href="#i-close"/></svg></button>`);
  f.hidden = !tok.length; f.innerHTML = tok.join('');
  if (helperFilter()) mount(f.querySelector('[data-tava]'), agentOf(S.cat).kind);
  if (helperFilter()) renderScheduleControl(f, agentOf(S.cat));
  markTeam();
  fabFit();
}

/* ---------- Плавная смена ленты: другой помощник или вкладка ----------
   Если вы ниже начала ленты, страница сначала плавно доезжает до вкладок, и только потом карточки меняются.
   Старые гаснут, новые проявляются по очереди. Высота ленты держится, пока идёт прокрутка,
   поэтому короткий список не обрывает страницу под вами. */
let swapping = 0;
const waitScroll = (y) => new Promise((res) => {
  if (reduce || Math.abs(scrollY - y) < 4) { scrollTo(0, y); res(); return; }
  scrollTo({ top: y, behavior: 'smooth' });
  let last = scrollY, still = 0;
  const t0 = performance.now();
  const tick = () => {
    if (Math.abs(scrollY - last) < 0.5) still++; else still = 0;
    last = scrollY;
    if (still > 4 || Math.abs(scrollY - y) < 2 || performance.now() - t0 > 900) res(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
async function swapFeed(apply) {
  const wrap = $('#aCards'), bar = $('.a-feed__bar');
  const my = ++swapping;
  apply();
  writeFilters();
  // вкладки и счётчики отвечают сразу, карточки догоняют
  $$('.a-tab').forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)); t.tabIndex = t.dataset.tab === S.tab ? 0 : -1; });
  if (reduce || chat.open) { renderFeed(true); return; }
  const old = $$('[data-id]', wrap);
  wrap.style.minHeight = wrap.offsetHeight + 'px';
  const top = bar.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64) - 12;
  const fade = Promise.all(old.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
    .map((el) => el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px) scale(.99)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})));
  await Promise.all([scrollY > top + 40 ? waitScroll(top) : Promise.resolve(), fade]);
  if (my !== swapping) return;
  old.forEach((el) => el.remove());
  renderFeed(true);
  const fresh = $$('[data-id], .a-empty', wrap);
  fresh.forEach((el, i) => {
    if (i > 7) return;
    el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 45, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
  });
  // высота плавно доезжает до новой
  const from = parseFloat(wrap.style.minHeight) || 0;
  wrap.style.minHeight = '';
  const to = wrap.offsetHeight;
  if (to < from) wrap.animate([{ minHeight: from + 'px' }, { minHeight: to + 'px' }], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' });
}

/* ---------- Строка состояния ленты: сколько отобрано, когда собрано, кнопки ---------- */
function renderLive() {
  const f = S.feed; if (!f) return;
  const st = f.stats || {}, ing = f.ingest || {};
  // Статус работы виден, только пока сервер действительно собирает новости или оценивает их. Очередь на оценку без идущей работы не загрузка
  const busy = f.ingest_running ? 'Обновляем ленту' : f.triage_running ? 'Альфи уточняет оценки новых событий' : '';
  $('#fLive').innerHTML = `
    <span class="f-live__s${busy ? ' is-busy' : ''}">${busy ? `<span class="f-pulse" aria-hidden="true"></span>${busy}` : `${ing.finished ? `Обновлено ${esc(ago(ing.finished))}` : `За ${st.days} ${plural(st.days, 'день', 'дня', 'дней')}`} · ${st.picked} из ${fmt(st.scanned)} новостей касаются компании`}</span>
    <span class="f-live__acts">
      <button class="f-lnk" type="button" data-refresh ><svg class="ic ic--sm"><use href="#i-refresh"/></svg>Обновить</button>
      <button class="f-lnk" type="button" data-submit>Проверить свою новость</button>
    </span>`;
}

let requestId = 0;
let searchTimer;
let failures = 0;
let statusKey = '';
const statusSignature = status => JSON.stringify([status.triage_running, status.team_selecting ?? status.team?.selecting,
  status.ingest_running, status.ingest?.finished, status.ingest?.new, status.ingest?.sources]);

function resetFeed() {
  requestId++;
  swapping++;
  clearTimeout(searchTimer);
  failures = 0;
  statusKey = '';
  $('#aCards').style.minHeight = '';
  $('#fMore').disabled = false;
}

function reportFeedError(error) {
  failures++;
  $('#fNotice').textContent = error.status === 403 ? 'Нет доступа к ленте' : 'Не удалось обновить ленту, пробуем снова…';
  if (!S.feed) $('#aCards').innerHTML = '<div class="a-empty"><button class="btn btn--ghost" type="button" data-retry>Повторить</button></div>';
}

function schedulePoll(retryFeed = false) {
  clearTimeout(S.pollT);
  const gen = S.sessionGen;
  const id = requestId;
  const delay = Math.min(60000, 5000 * 2 ** Math.max(0, failures - 1));
  S.pollT = setTimeout(async () => {
    try {
      const status = await API.get('/api/feed/status');
      if (gen !== S.sessionGen || id !== requestId) return;
      if (retryFeed || statusSignature(status) !== statusKey) {
        await loadFeed(true);
        return;
      }
      failures = 0;
      $('#fNotice').textContent = '';
    } catch (error) {
      if (gen !== S.sessionGen || id !== requestId) return;
      reportFeedError(error);
    }
    schedulePoll(retryFeed);
  }, delay);
}

/** @returns {Promise<import('./types.js').FeedResponse>} */
async function fetchPage(offset, force, gen) {
  const url = '/api/feed?' + new URLSearchParams({ q: S.q, offset, limit: FEED_STEP });
  const feedbackRevision = S.feedbackRevision;
  const key = gen + ':' + url;
  const cached = S.etags.get(key);
  const page = await API.get(url, { envelope: true,
    headers: !force && cached?.etag ? { 'If-None-Match': cached.etag } : {} });
  assertCurrent(gen);
  if (page.data === null) return cached.data;
  if (S.etags.size >= 80) S.etags.delete(S.etags.keys().next().value);
  if (feedbackRevision === S.feedbackRevision) S.etags.set(key, page);
  return page.data;
}

async function loadFeed(quiet = false, { force = false, append = false } = {}) {
  if (!S.me) return;
  const gen = S.sessionGen;
  const id = ++requestId;
  clearTimeout(S.pollT);
  const sameQuery = S.feed && S.loadedQuery === S.q;
  const pages = append && sameQuery ? [...S.pages] : [];
  const feedbackRevision = S.feedbackRevision;
  const count = sameQuery && !append ? S.pages.length : 1;
  $('#fMore').disabled = true;
  try {
    for (let i = 0; i < count; i++) {
      const last = pages.at(-1);
      if (last && !last.has_more) break;
      const offset = last ? last.offset + last.limit : 0;
      const page = await fetchPage(offset, force, gen);
      if (gen !== S.sessionGen || id !== requestId) return;
      pages.push(page);
    }
    if (feedbackRevision !== S.feedbackRevision) return loadFeed(true, { force: true, append });
    failures = 0;
    $('#fNotice').textContent = '';
    if (!sameQuery || pages.length !== S.pages.length || pages.some((page, i) => page !== S.pages[i])) {
      S.pages = pages;
      S.loadedQuery = S.q;
      const last = pages.at(-1);
      S.feed = last;
      S.items = [...new Map(pages.flatMap(page => page.items.map(item => [item.id, {...item}]))).values()];
      S.gone.clear();
      S.useful.clear();
      for (const item of S.items) applyFeedback(item.id, S.feedbackPending.has(item.id) ? S.feedbackPending.get(item.id).next : item.feedback_state);
      statusKey = statusSignature(last);
      setTeam(last.team);
      if (!PEOPLE[S.cat]) S.cat = 'alfi';
      const person = agentOf(S.cat);
      if ($('#aStageWho').dataset.cat !== person.kind) {
        catSwap(person);
        paintWho(person);
      }
      S.areaLabel = S.items.flatMap(item => item.areas || []).find(area => area.id === S.area)?.label || S.area;
      renderTeam();
      renderFeed(quiet);
      renderLive();
      renderHero();
      writeFilters();
    }
    schedulePoll();
  } catch (error) {
    if (gen !== S.sessionGen || id !== requestId) return;
    reportFeedError(error);
    schedulePoll(true);
  } finally {
    if (id === requestId) $('#fMore').disabled = false;
  }
}

function applyFeedback(id, value) {
  const item = byId(id);
  if (item) item.feedback_state = value;
  S.gone[value === 'not_relevant' ? 'add' : 'delete'](id);
  S.useful[value === 'useful' ? 'add' : 'delete'](id);
}

async function rateItem(id, kind) {
  const item = byId(id);
  if (!item || S.feedbackPending.has(id)) return;
  const gen = S.sessionGen;
  const previous = item.feedback_state;
  const next = kind.startsWith('undo') ? null : kind;
  S.feedbackPending.set(id, { next });
  const paint = value => {
    applyFeedback(id, value);
    renderFeed(true);
    renderTeam();
    renderHero();
  };
  paint(next);
  try {
    const response = await API.post('/api/feedback', { news_id: id, kind });
    if (gen !== S.sessionGen) return;
    S.feedbackRevision++;
    S.etags.clear();
    paint(response.state);
  } catch (error) {
    if (gen !== S.sessionGen) return;
    paint(previous);
    toast('Оценку не удалось сохранить: ' + error.message);
  } finally {
    if (gen === S.sessionGen) S.feedbackPending.delete(id);
  }
}

$('#aCards').addEventListener('click', event => {
  if (event.target.closest('[data-retry]')) loadFeed();
});
$('#fMore').addEventListener('click', () => loadFeed(false, { append: true }));
$('#aFeedQ').addEventListener('input', event => {
  S.q = event.target.value.trim();
  writeFilters();
  requestId++;
  clearTimeout(S.pollT);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadFeed(true), 250);
});
window.addEventListener('popstate', () => {
  clearTimeout(searchTimer);
  readFilters();
  if (!S.me) return;
  renderFeed(true);
  renderHero();
  paintWho(agentOf(S.cat));
  catSwap(agentOf(S.cat));
  loadFeed(true);
});

export { loadFeed, renderFeed, rateItem, swapFeed, SIGN, IMPACT_T, resetFeed, IMPACT };
