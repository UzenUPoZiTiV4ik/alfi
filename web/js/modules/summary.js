import { $, kindOf, esc, KIND, reduce, $$, hello, plural, fmt, cut, pct, modal } from './ui.js';
import { ALFI, PEOPLE, agentOf, mount, register, ACC } from './people.js';
import { S, byId, isRead, inTab } from './state.js';
import { IMPACT } from './feed.js';
import { basis } from './insight.js';
import { chat, closeChat } from './chat.js';
import { API } from './api.js';

/* ---------- Сводка над лентой ----------
   Сколько рисков и возможностей, главное событие и сферы бизнеса, которые задеты.
   «Как работает» открывает отдельное окно с анимацией и не трогает сводку. */
const heroEl = $('#aHero');
const crew = () => [ALFI, ...((S.team && S.team.members) || []).map((m) => PEOPLE[m.id])];
// Сферы бизнеса по всем непрочитанным событиям: сколько во вред, сколько на пользу
function areaStats(list) {
  const m = new Map();
  for (const it of list) for (const a of it.areas || []) {
    if (!a.id || !a.label) continue;
    const x = m.get(a.id) || { id: a.id, label: a.label, neg: 0, pos: 0, mix: 0, n: 0 };
    x[a.impact === 'positive' ? 'pos' : a.impact === 'mixed' ? 'mix' : 'neg']++; x.n++;
    m.set(a.id, x);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.neg - a.neg).slice(0, 5);
}
// «Главное сейчас»: три самых важных события, листаются стрелками. Ниже в плитке — два других из этой тройки
function topHTML(deck) {
  const i = Math.max(0, deck.findIndex((x) => x.id === S.hbId)), top = deck[i];
  S.hbId = top.id;
  const tk = kindOf(top), tm = agentOf(top.helper), tstep = top.action && !/^(Разобрать|Не требуется)/i.test(top.action) ? top.action : '';
  const more = deck.filter((x) => x !== top);
  const n = deck.length;
  return `<article class="hb-top is-${tk}" data-hb-car aria-roledescription="карусель" aria-label="Главное сейчас">
          <p class="hb-top__k"><span class="hb-top__ava" data-hava="${esc(tm.id)}"></span>Главное сейчас<span class="hb-top__b">${top.urgency >= 3 ? 'Срочно · ' : ''}${KIND[tk]}</span></p>
          <div class="hb-top__body">
            <button class="hb-top__t" type="button" data-goto="${esc(top.id)}">${esc(top.headline || top.title)}</button>
            ${tstep ? `<p class="hb-top__s"><svg class="ic" aria-hidden="true"><use href="#i-arrow"/></svg>${esc(tstep)}</p>` : ''}
            ${more.length ? `<ul class="hb-more" aria-label="Ещё важное">${more.map((x) => `<li><button type="button" class="is-${kindOf(x)}" data-hb-pick="${esc(x.id)}"><i aria-hidden="true"></i><span>${esc(x.headline || x.title)}</span></button></li>`).join('')}</ul>` : ''}
            <div class="hb-top__foot">
              <button class="hb-top__go" type="button" data-ins="${esc(top.id)}">${top.has_insight ? 'Открыть разбор' : 'Подготовить разбор'}</button>
              ${n > 1 ? `<span class="hb-top__nav"><button type="button" data-hb-step="-1" aria-label="Предыдущее событие"><svg class="ic" aria-hidden="true"><use href="#i-arrow-l"/></svg></button><span class="hb-top__i" aria-live="polite">${i + 1} из ${n}</span><button type="button" data-hb-step="1" aria-label="Следующее событие"><svg class="ic" aria-hidden="true"><use href="#i-arrow"/></svg></button></span>` : ''}
            </div>
          </div>
        </article>`;
}
// Листание: старое содержимое плитки мягко гаснет, новое проявляется с лёгким сдвигом в сторону листания
const HB_SOFT = 'cubic-bezier(.25, .1, .25, 1)';
let hbTurn = 0;
// Рамка плитки (верхняя строка и строка с кнопкой и стрелками) стоит на месте и только меняет значения; листается содержимое
const hbParts = (card) => [...card.querySelector('.hb-top__body').children].filter((el) => !el.matches('.hb-top__foot'));
async function hbShow(id, dir) {
  const card = $('[data-hb-car]', heroEl), deck = (S.hbDeck || []).map(byId).filter(Boolean);
  if (!card || deck.length < 2) return;
  const my = ++hbTurn;
  S.hbId = id;
  const focus = document.activeElement && document.activeElement.closest('[data-hb-step]') ? document.activeElement.dataset.hbStep : null;
  const oldAva = card.querySelector('.hb-top__ava'), oldWho = oldAva && oldAva.dataset.hava;
  const swapCat = !reduce && oldWho !== agentOf(byId(id) && byId(id).helper).id;
  if (!reduce) {
    const out = hbParts(card).map((el) => el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-8 * dir}px)` }],
      { duration: 200, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' }));
    // Другой помощник: кот уходит вниз и тает, следом выпрыгивает новый
    if (swapCat && oldAva) out.push(oldAva.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(.6) rotate(-10deg)' }],
      { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }));
    await Promise.all(out.map((a) => a.finished.catch(() => {})));
    if (my !== hbTurn) return;
  }
  const tmp = document.createElement('div'); tmp.innerHTML = topHTML(deck);
  const fresh = tmp.firstElementChild;
  if (hbHeight) fresh.style.minHeight = `${hbHeight}px`;
  card.replaceWith(fresh);
  $$('[data-hava]', fresh).forEach((el) => mount(el, agentOf(el.dataset.hava).kind, 96));
  if (focus) { const b = fresh.querySelector(`[data-hb-step="${focus}"]`); if (b) b.focus({ preventScroll: true }); }
  if (reduce) return;
  hbParts(fresh).forEach((el, k) => el.animate([{ opacity: 0, transform: `translateX(${12 * dir}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 560, delay: k * 25, easing: HB_SOFT, fill: 'backwards' }));
  const ava = fresh.querySelector('.hb-top__ava');
  if (swapCat && ava) ava.animate([
    { opacity: 0, transform: 'translateY(6px) scale(.5) rotate(12deg)' },
    { opacity: 1, transform: 'translateY(-2px) scale(1.08) rotate(-4deg)', offset: .6 },
    { opacity: 1, transform: 'none' }
  ], { duration: 520, easing: 'cubic-bezier(.34, 1.3, .64, 1)', fill: 'backwards' });
}
// Высота плитки фиксируется по самому высокому слайду: при листании страница не дёргается.
// Меряем каждый слайд в скрытом блоке той же ширины и ставим карточке min-height
let hbHeight = 0;
function hbMeasure() {
  const card = $('[data-hb-car]', heroEl), deck = (S.hbDeck || []).map(byId).filter(Boolean);
  if (!card || deck.length < 2 || !card.offsetWidth) { hbHeight = 0; return; }
  const keep = S.hbId;
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:-9999px;top:0;width:${card.offsetWidth}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(box);
  let max = 0;
  for (const x of deck) { S.hbId = x.id; box.innerHTML = topHTML(deck); max = Math.max(max, box.firstElementChild.offsetHeight); }
  S.hbId = keep;
  box.remove();
  hbHeight = max;
  card.style.minHeight = max ? `${max}px` : '';
}
// Ширина меняется — переносы строк другие, перемеряем после ресайза
let hbRs = 0;
window.addEventListener('resize', () => { clearTimeout(hbRs); hbRs = setTimeout(hbMeasure, 200); });
heroEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-hb-step], [data-hb-pick]'); if (!t) return;
  const ids = S.hbDeck || [], i = Math.max(0, ids.indexOf(S.hbId));
  if (t.dataset.hbPick) { const j = ids.indexOf(t.dataset.hbPick); hbShow(t.dataset.hbPick, j > i ? 1 : -1); return; }
  const d = +t.dataset.hbStep, j = (i + d + ids.length) % ids.length;
  hbShow(ids[j], d);
});
heroEl.addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !e.target.closest('[data-hb-car]') || e.target.closest('input')) return;
  const b = $(`[data-hb-step="${e.key === 'ArrowRight' ? 1 : -1}"]`, heroEl); if (!b) return;
  e.preventDefault(); b.click();
});
function briefHTML() {
  const list = S.items.filter((it) => !S.gone.has(it.id) && !isRead(it));
  const risk = list.filter((it) => inTab(it, 'risk')).length, chance = list.filter((it) => inTab(it, 'chance')).length;
  const fresh = list.filter((it) => it.published && Date.now() - new Date(it.published) < 864e5).length;
  const areas = areaStats(list), max = Math.max(1, ...areas.map((a) => a.n));
  const deck = list.slice().sort((a, b) => (b.urgency - a.urgency) || (b.relevance - a.relevance)).slice(0, 3);
  S.hbDeck = deck.map((x) => x.id);
  return `
    <div class="a-hero__in a-hero__in--brief">
      <header class="a-brief__head">
        <h2 class="a-hero__title a-hero__title--s" id="aHeroTitle">${esc(hello())}</h2>
        <p class="a-hero__lead">${list.length ? `Касаются компании: <b class="is-risk">${risk} ${plural(risk, 'риск', 'риска', 'рисков')}</b> и <b class="is-chance">${chance} ${plural(chance, 'возможность', 'возможности', 'возможностей')}</b>${fresh ? `, из них ${fresh} за сутки` : ''}` : 'Всё прочитано. Новые события появятся здесь'}</p>
        <button class="a-brief__team" type="button" data-how aria-label="Как работает Альфи">
          <span class="a-brief__avas">${crew().slice(0, 4).map((p) => `<span class="a-brief__ava" data-hava="${esc(p.id)}"></span>`).join('')}</span>
          <span>Как работает</span>
        </button>
      </header>
      ${list.length ? `<div class="hb">
        ${deck.length ? topHTML(deck) : ''}
        ${areas.length ? `<div class="hb-areas">
          <p class="hb-areas__h">Где это бьёт по бизнесу<span><b class="is-neg">↓</b> во вред <b class="is-pos">↑</b> на пользу <b class="is-mix">±</b> двояко</span></p>
          <ul>${areas.map((a) => `<li><button type="button" data-area="${esc(a.id)}" data-area-label="${esc(a.label)}" aria-pressed="${S.area === a.id}">
            <span class="hb-a__l">${esc(a.label)}</span>
            <span class="hb-a__bar" aria-hidden="true"><i class="is-neg" style="width:${a.neg / max * 100}%"></i><i class="is-mix" style="width:${a.mix / max * 100}%"></i><i class="is-pos" style="width:${a.pos / max * 100}%"></i></span>
            <span class="hb-a__n">${a.neg ? `<b class="is-neg" title="во вред">↓${a.neg}</b>` : ''}${a.pos ? `<b class="is-pos" title="на пользу">↑${a.pos}</b>` : ''}${a.mix ? `<b class="is-mix" title="и плюс, и минус">±${a.mix}</b>` : ''}</span>
          </button></li>`).join('')}</ul>
        </div>` : ''}
      </div>` : ''}
    </div>`;
}
function renderHero() {
  if (!S.feed || !S.me) { heroEl.innerHTML = ''; return; }
  // При фоновом обновлении не мигаем: перерисовываем, только если что-то поменялось
  const sig = S.items.map((it) => it.id + it.kind + it.helper + (isRead(it) ? 'r' : '') + (it.areas || []).map((a) => a.id).join('')).join() + '|' + S.gone.size + '|' + S.area + '|' + S.team.members.map((m) => m.id).join();
  if (sig === S.heroSig) return;
  S.heroSig = sig;
  heroEl.dataset.mode = 'brief';
  heroEl.innerHTML = briefHTML();
  $$('[data-hava]', heroEl).forEach((el) => mount(el, agentOf(el.dataset.hava).kind, 96));
  hbMeasure();
}

/* ---------- «Как работает»: окно с пошаговой анимацией ----------
   Шесть сцен на реальных данных текущей компании: сбор новостей, профиль, сборка команды под задачи,
   отбор, работа агента над разбором и отдельная позиция банка. Сцены листаются сами, есть пауза и стрелки. */
const how = $('#aHow'), howStage = $('#aHowStage'), howProg = $('#aHowProg');
const HOW_MS = 7500;
const H = { i: 0, el: 0, last: 0, raf: 0, paused: false, prof: null, kb: null };
const howKey = () => `alfi:how:${S.me ? S.me.uid + ':' + S.me.role : ''}`;
const SOURCES = ['Интерфакс', 'Коммерсантъ', 'Ведомости', 'ЦБ РФ', 'ТАСС', 'РБК', 'Лента', 'Финам', 'Банки.ру', 'Frank Media', 'Retail.ru', 'Поиск в интернете'];
const kindFor = (m) => {
  if (PEOPLE[m.id]) return PEOPLE[m.id].kind;
  const fur = /^#[0-9A-Fa-f]{6}$/.test(m.fur || '') ? m.fur.toUpperCase() : '#7A3FE0', kind = 'c-' + String(m.id).replace(/[^a-z0-9-]/gi, '') + '-' + fur.slice(1);
  register(kind, fur, ACC[m.kind] ?? 0); return kind;
};
function counter(el, to, ms = 1200) {
  if (reduce) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => { const u = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - u, 3); el.textContent = fmt(to * k); if (u < 1 && how.open) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const SCENES = [
  {
    t: 'Альфи сам читает новости', x: () => `Раз в ${S.feed.ingest_interval_min || 60} минут Альфи забирает свежие новости из лент деловых СМИ и ЦБ и добирает поиском по интернету. Одинаковые новости из разных изданий склеиваются в одно событие, поэтому ничего не нужно искать и вводить вручную.`,
    v: () => `<div class="hv-src">
        <div class="hv-src__cloud">${SOURCES.map((s, i) => `<span style="--i:${i}">${esc(s)}</span>`).join('')}</div>
        <div class="hv-flow" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="hv-num"><b data-to="${S.feed.stats.scanned}">0</b><span>новостей за ${S.feed.stats.days} ${plural(S.feed.stats.days, 'день', 'дня', 'дней')} из ${S.feed.stats.sources} источников</span></div>
        <div class="hv-flow" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="hv-num"><b data-to="${S.feed.stats.events}">0</b><span>событий после склейки дублей</span></div>
      </div>`
  },
  {
    t: 'Понимает вашу компанию', x: () => 'Из данных банка Альфи собирает профиль: ОКВЭД, выручка, регион, ВЭД, продукты банка, поставщики и покупатели из платежей, группа компаний. По профилю видно, к чему бизнес чувствителен: ставка, курс, сырьё, спрос и другие факторы.',
    v: () => {
      const c = S.me.company, p = H.prof;
      const feats = p ? p.features.slice(0, 9) : knowsList().map((k, i) => ({ id: 'feat:' + i, label: '', value: k }));
      const sens = p ? p.sensitivities.slice(0, 5) : [];
      return `<div class="hv-prof">
        <div class="hv-prof__card"><span class="hv-prof__ic"><svg class="ic"><use href="#i-bank"/></svg></span><b>${esc(c.title)}</b><span>${esc(S.me.uid)} · ${esc(c.revenue_label)}</span></div>
        <ul class="hv-feats">${feats.map((f, i) => `<li style="--i:${i}">${f.label ? `<small>${esc(f.label)}</small>` : ''}<b>${esc(cut(f.value, 42))}</b></li>`).join('')}</ul>
        ${sens.length ? `<div class="hv-sens">${sens.map((s, i) => `<p style="--i:${i}"><span>${esc(s.label)}</span><i><em style="--w:${Math.round(s.value * 100)}%"></em></i><b>${pct(s.value)}</b></p>`).join('')}</div>` : ''}
      </div>`;
    }
  },
  {
    // Сборка команды: правила дают кандидатов с весами, модель выбирает троих и пишет каждому задачу
    t: 'Собирает команду под ваши задачи', ms: 15000, wide: true,
    x: () => {
      const T = S.team, ai = T.picked_by === 'ai' && T.ai;
      if (T.selecting) return 'Альфи смотрит на профиль компании и вашу роль и выбирает, какие помощники будут полезнее всего. Это несколько секунд.';
      return ai ? `По данным компании подошли ${T.members.length + (T.available || []).length} ${plural(T.members.length + (T.available || []).length, 'помощник', 'помощника', 'помощников')}. Альфи выбрал ${T.members.length} под роль «${esc(S.me.role_label)}» и дал каждому свою задачу. ${esc(T.ai.summary || '')}`
        : `Помощники подобраны по данным компании и роли «${esc(S.me.role_label)}».${T.picked_by === 'custom' ? ' Состав вы меняли вручную.' : ''}`;
    },
    v: () => {
      const T = S.team, ids = T.members.map((m) => m.id), skip = (T.ai && T.ai.skipped) || {};
      const pool = [...T.members, ...(T.available || [])].filter((m) => !String(m.id).startsWith('own-')).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 8);
      const max = Math.max(...pool.map((m) => m.weight || 0), 0.01);
      return `<div class="hv-ai${T.selecting ? ' is-wait' : ''}">
        <div class="hv-ai__brain"><span class="hv-ava" data-hk="alfi"></span><div><b>${T.selecting ? 'Альфи выбирает помощников…' : T.picked_by === 'ai' ? 'Команду выбрал Альфи' : 'Выбрано по данным компании'}</b><span>${esc(S.me.company.title.split(' · ')[0])} · ${esc(S.me.role_label)}</span></div><i class="hv-ai__scan" aria-hidden="true"></i></div>
        <p class="hv-ai__h">Кандидаты и вес по данным компании</p>
        <ul class="hv-pool">${pool.map((m, i) => `<li data-pc="${esc(m.id)}" class="${ids.includes(m.id) ? 'is-pick' : 'is-skip'}" style="--i:${i};--c:${esc(m.fur || '#7A3FE0')}">
          <span class="hv-ava hv-ava--s" data-hk="${esc(kindFor(m))}"></span><b>${esc(m.name)}</b>
          <i class="hv-w"><em style="--w:${Math.round((m.weight || 0) / max * 100)}%"></em></i>
          ${!ids.includes(m.id) && skip[m.id] ? `<small class="hv-skip">${esc(skip[m.id])}</small>` : ''}
        </li>`).join('')}</ul>
        <p class="hv-ai__h">Команда</p>
        <ol class="hv-slots">${T.members.map((m, i) => `<li class="hv-slot" data-slot="${esc(m.id)}" style="--c:${esc(m.fur || '#7A3FE0')}">
          <div class="hv-slot__c"><span class="hv-ava" data-hk="${esc(kindFor(m))}"></span><div><b>${esc(m.name)}</b><small>${esc(m.watch)}</small></div></div>
          <p class="hv-task"><span class="hv-task__ghost" aria-hidden="true">${esc(m.task || m.watch)}</span><span class="hv-task__t" data-type="${esc(m.task || m.watch)}"></span></p>
          ${m.why_ai || m.why ? `<p class="hv-slot__why">${esc(cut(m.why_ai || m.why, 110))}</p>` : ''}
        </li>`).join('')}</ol>
      </div>`;
    },
    play: (el, alive) => {
      const box = el.querySelector('.hv-ai'); if (!box || S.team.selecting) return;
      const at = (ms, f) => setTimeout(() => { if (alive()) f(); }, reduce ? 0 : ms);
      box.classList.add('is-scan');
      at(1500, () => {
        box.classList.remove('is-scan'); box.classList.add('is-pick');
        $$('.hv-slot', box).forEach((slot, i) => at(i * 650, () => {
          const from = box.querySelector(`[data-pc="${CSS.escape(slot.dataset.slot)}"]`);
          slot.classList.add('is-on');
          if (from && !reduce) {
            const a = from.getBoundingClientRect(), b = slot.getBoundingClientRect();
            slot.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${Math.min(1, a.width / b.width)})`, opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
            from.classList.add('is-taken');
          }
          const t = slot.querySelector('.hv-task__t'), full = t.dataset.type;
          if (reduce) { t.textContent = full; slot.classList.add('is-done'); return; }
          let k = 0;
          const iv = setInterval(() => { if (!alive()) { clearInterval(iv); return; } k += 2; t.textContent = full.slice(0, k); if (k >= full.length) { clearInterval(iv); slot.classList.add('is-done'); } }, 22);
        }));
      });
    }
  },
  {
    t: 'Оставляет только то, что касается вас', x: () => `Каждое событие получает оценку связи с компанией: отрасль, факторы чувствительности, география, значимость, свежесть, доверие к источнику. Затем Альфи уточняет, какие сферы бизнеса оно задевает. Из ${fmt(S.feed.stats.scanned)} новостей в ленте осталось ${S.feed.stats.picked}.`,
    v: () => {
      const st = S.feed.stats, max = Math.log10(st.scanned + 1);
      const rows = [[st.scanned, 'прочитано'], [st.events, 'событий'], [st.business, 'про экономику и бизнес'], [st.picked, 'про вашу компанию']];
      const top = S.items[0];
      return `<div class="hv-fun">
        <div class="hv-fun__rows">${rows.map(([n, l], i) => `<p style="--i:${i};--w:${Math.max(14, Math.log10(n + 1) / max * 100)}%" class="${i === 3 ? 'is-you' : ''}"><i></i><b data-to="${n}">0</b><span>${l}</span></p>`).join('')}</div>
        ${top ? `<div class="hv-ex"><p class="hv-ex__k"><span class="c-kind is-${kindOf(top)}">${KIND[kindOf(top)]}</span>${esc(agentOf(top.helper).name)}</p><b>${esc(cut(top.headline || top.title, 90))}</b>
          <div class="hv-ex__r">${(top.reasons || []).slice(0, 3).map((r, i) => `<span style="--i:${i}">${esc(r.text)}</span>`).join('')}</div>
          ${(top.areas || []).length ? `<div class="hv-ex__a">${top.areas.slice(0, 3).map((a) => `<span class="c-area ${IMPACT[a.impact] || ''}"><i></i>${esc(a.label)}</span>`).join('')}</div>` : ''}</div>` : ''}
      </div>`;
    }
  },
  {
    t: 'Разбирает событие как аналитик', x: () => 'Альфи составляет план и сам собирает данные: аналитику банка, контрагентов, группу компаний, поиск. Потом пишет разбор, проверяет его по 9 правилам и отдаёт на независимую перепроверку. Если там находят слабое место, Альфи дорабатывает текст.',
    v: () => `<div class="hv-pipe">
        <ol>${['Контекст', 'План', 'Данные', 'Черновик', '9 правил', 'Перепроверка', 'Доработка', 'Готово'].map((s, i) => `<li style="--i:${i}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>
        <div class="hv-tools">${['аналитика Альфа-Банка', 'прогнозы банка', 'поставщики и покупатели', 'группа компаний', 'поиск новостей', 'поиск в интернете'].map((t, i) => `<span style="--i:${i}">${t}</span>`).join('')}</div>
      </div>`
  },
  {
    t: 'Позиция банка отдельно от выводов', x: () => `Мнение Альфа-Банка берётся только из его аналитики: ${H.kb ? `${H.kb.docs} ${plural(H.kb.docs, 'документ', 'документа', 'документов')}` : 'документы банка'}, цитаты сверены с PDF. Выводы Альфи помечены отдельно. У каждого пункта есть ссылка на первоисточник.`,
    v: () => {
      const it = S.items.find((x) => (x.bank_refs || []).length) || S.items[0], b = it && (it.bank_refs || [])[0];
      return `<div class="hv-two">
        <div class="hv-two__c is-bank"><p class="hv-two__h"><svg class="ic"><use href="#i-bank"/></svg>Альфа-Банк</p><q>${esc(cut(b ? b.text : 'Тезис из аналитики банка', 170))}</q>${b ? `<small>${esc(b.doc_title)}, стр. ${esc(b.page)}${b.verified ? ' · цитата сверена с PDF' : ''}</small>` : ''}</div>
        <div class="hv-two__c is-ai"><p class="hv-two__h"><span class="hv-ava hv-ava--s" data-hk="alfi"></span>Вывод Альфи</p><p>${esc(cut(it ? (it.areas && it.areas[0] && it.areas[0].effect) || it.why : 'Что это значит для компании', 170))}</p><small>со ссылками на новость и признаки компании</small></div>
        <div class="hv-legend">${basis('bank')}${basis('bank+ai')}${basis('ai')}</div>
      </div>`;
    }
  }
];
function knowsList() {
  const c = S.me.company, k = [c.sector_label, c.revenue_label, c.region];
  if (c.countries && c.countries.length) k.push('ВЭД: ' + c.countries.slice(0, 3).join(', '));
  if (c.products && c.products.length) k.push(c.products.join(', '));
  return k.filter(Boolean);
}
function howShow(i, dir = 1) {
  H.i = Math.max(0, Math.min(SCENES.length - 1, i));
  H.el = 0;
  const sc = SCENES[H.i];
  const old = howStage.firstElementChild;
  const el = document.createElement('section');
  el.className = 'h-scene' + (sc.wide ? ' is-wide' : '');
  el.innerHTML = `<div class="h-vis">${sc.v()}</div><div class="h-txt"><p class="h-n">Шаг ${H.i + 1} из ${SCENES.length}</p><h2 class="h-t" id="aHowTitle">${esc(sc.t)}</h2><p class="h-x">${sc.x()}</p></div>`;
  if (old && !reduce) {
    old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-24 * dir}px)` }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
    old.style.position = 'absolute'; old.style.inset = '0';
  } else if (old) old.remove();
  howStage.appendChild(el);
  if (!reduce) el.animate([{ opacity: 0, transform: `translateX(${28 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 360, delay: old ? 120 : 0, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
  $$('[data-hk]', el).forEach((a) => mount(a, a.dataset.hk, 128));
  $$('[data-to]', el).forEach((b, k) => setTimeout(() => counter(b, +b.dataset.to), 250 + k * 180));
  // сцена команды: сначала все кандидаты, потом выбранные подсвечиваются, остальные гаснут
  const token = (H.tok = (H.tok || 0) + 1);
  if (sc.play) sc.play(el, () => H.tok === token && how.open);
  el.classList.toggle('is-still', reduce);
  howProg.innerHTML = SCENES.map((s, k) => `<button type="button" role="tab" aria-selected="${k === H.i}" aria-label="${esc(s.t)}" data-hs="${k}" class="${k < H.i ? 'is-done' : ''}"><i></i></button>`).join('');
  $('#aHowPrev').disabled = H.i === 0;
  $('#aHowNext').textContent = H.i === SCENES.length - 1 ? 'К ленте' : 'Дальше';
}
function howTick(now) {
  if (!how.open) return;
  const dt = H.last ? now - H.last : 0; H.last = now;
  if (!H.paused) H.el += dt;
  const u = Math.min(1, H.el / (SCENES[H.i].ms || HOW_MS));
  const bar = howProg.querySelector(`[data-hs="${H.i}"] i`);
  if (bar) bar.style.width = (u * 100) + '%';
  if (u >= 1 && H.i < SCENES.length - 1) howShow(H.i + 1);
  H.raf = requestAnimationFrame(howTick);
}
function setPause(v) {
  H.paused = v;
  const b = $('#aHowPause'); b.setAttribute('aria-pressed', String(v)); b.setAttribute('aria-label', v ? 'Продолжить' : 'Пауза');
  b.innerHTML = v ? '<svg class="ic" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5Z" fill="currentColor"/></svg>' : '<svg class="ic" viewBox="0 0 24 24"><path d="M8 6v12M16 6v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
}
async function openHow(start = 0) {
  if (!S.feed || !S.me) return;
  if (chat.open) closeChat(true);
  const gen = S.sessionGen;
  const loads = [];
  if (!H.prof || H.prof.uid !== S.me.uid) loads.push(API.get('/api/profile').then((p) => { H.prof = p; }).catch(() => {}));
  if (!H.kb) loads.push(API.get('/api/kb/docs').then((d) => { H.kb = { docs: (d.items || []).length }; }).catch(() => {}));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
  if (gen !== S.sessionGen) return;
  howStage.innerHTML = '';
  if (!how.open) modal(how);
  setPause(!!reduce);
  howShow(start);
  cancelAnimationFrame(H.raf); H.last = 0; H.raf = requestAnimationFrame(howTick);

}
how.addEventListener('close', () => { cancelAnimationFrame(H.raf); try { if (S.me) localStorage.setItem(howKey(), '1'); } catch (_) {} });
how.addEventListener('click', (e) => {
  const s = e.target.closest('[data-hs]'); if (s) { howShow(+s.dataset.hs, +s.dataset.hs >= H.i ? 1 : -1); return; }
  if (e.target.closest('#aHowPause')) { setPause(!H.paused); return; }
  if (e.target.closest('#aHowPrev')) { howShow(H.i - 1, -1); return; }
  if (e.target.closest('#aHowNext')) {
    if (H.i < SCENES.length - 1) howShow(H.i + 1);
    else { how.close(); $('#aFeedTitle').closest('.a-feed').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
  }
});
how.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.preventDefault(); if (H.i < SCENES.length - 1) howShow(H.i + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); if (H.i) howShow(H.i - 1, -1); }
});
// После входа в новую компанию окно открывается само, на шаге «Собирает команду»: так видно, какие помощники созданы
function maybeHow() { try { if (!localStorage.getItem(howKey())) openHow(2); } catch (_) {} }

function resetSummary() {
  hbTurn++;
  hbHeight = 0;
  H.prof = null;
  H.kb = null;
  cancelAnimationFrame(H.raf);
  howStage.replaceChildren();
  heroEl.replaceChildren();
  heroEl.dataset.mode = '';
}

export { openHow, renderHero, maybeHow, resetSummary };
