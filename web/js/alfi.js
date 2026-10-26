/* Альфи · новостная аналитика для крупного бизнеса.
   Лента, разбор, чат, профиль и команда работают через API сервиса (alfi-api.js).
   3D-сцена, маскот, мастер «Добавить помощника» и переезд сцены в чат взяты из макета. */
(function () {
  'use strict';
  const API = window.AlfiAPI, M = window.Mascot;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // В href пускаем только http(s) и свои /api/-ссылки: тексты новостей приходят из внешних источников
  const safeUrl = (u) => (/^(https?:\/\/|\/api\/)/i.test(String(u || '')) ? String(u) : '');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toast = (t) => (window.shellToast ? window.shellToast(t) : console.log(t));
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => nf.format(Math.round(n || 0));
  const rub = (v) => (v == null ? '—' : (v < 1 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',') + ' ₽');
  const pct = (v) => Math.round((v || 0) * 100) + '%';
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
  const noName = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const MONS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const dshort = (d) => `${d.getDate()} ${MONS[d.getMonth()]}`;
  // «2 ч назад», «вчера», «22 окт»
  function ago(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const dateOnly = /T00:00:00(\.0+)?(\+00:00|Z)$/.test(iso);
    const min = (Date.now() - d) / 6e4;
    if (!dateOnly) {
      if (min < 2) return 'только что';
      if (min < 60) return `${Math.round(min)} мин назад`;
      if (min < 24 * 60) return `${Math.round(min / 60)} ч назад`;
    }
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return days === 0 ? 'сегодня' : days === 1 ? 'вчера' : dshort(d);
  }
  const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

  const KIND = { risk: 'Риск', chance: 'Возможность', mixed: 'Риск и возможность', neutral: 'К сведению' };
  const kindOf = (it) => (KIND[it.kind] ? it.kind : 'neutral');
  // иконка по главному фактору, цвет по виду события
  const P = (d) => `<path d="${d}"/>`;
  const ICON = {
    rate: P('M7 17 17 7') + '<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    credit: P('M3.5 9.5 12 5l8.5 4.5M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 19.5h17'),
    fx: P('M4 8h12.5M13.5 4.5 17 8l-3.5 3.5M20 16H7.5M10.5 12.5 7 16l3.5 3.5'),
    inflation: P('M4 18 9.5 12.5l3.5 3.5L20 9M15 9h5v5'),
    tax: P('M7 3.5h10v17l-2.5-1.6L12 20.5l-2.5-1.6L7 20.5Z') + P('M9.5 13.5l5-5') + '<circle cx="10" cy="9" r=".9"/><circle cx="14" cy="13" r=".9"/>',
    regulation: P('M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.8 2.8 0 0 0 5 0Zm14 0-2.5 6a2.8 2.8 0 0 0 5 0Z'),
    trade: '<circle cx="12" cy="12" r="8.5"/>' + P('M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z'),
    logistics: P('M2.5 6.5h11v10h-11ZM13.5 10h4l3 3.2v3.3h-7') + '<circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    oil: P('M12 3.5c3.6 4.4 5.5 7.7 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.5 1.9-5.8 5.5-10.2Z'),
    metals: P('M4 17.5 7 9.5h10l3 8ZM8.5 9.5 10 5.5h4l1.5 4'),
    agro: P('M12 20.5V9M12 9c-3.5 0-5-2.2-5-5 3.3 0 5 1.8 5 5Zm0 0c3.5 0 5-2.2 5-5-3.3 0-5 1.8-5 5ZM12 15c-3.3 0-4.8-2-4.8-4.6 3.1 0 4.8 1.7 4.8 4.6Zm0 0c3.3 0 4.8-2 4.8-4.6-3.1 0-4.8 1.7-4.8 4.6Z'),
    demand: P('M3.5 4.5h2.2l2.1 10.2h10.4l1.8-7.2H6.6') + '<circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    budget: P('M4 20.5h16M5.5 17.5h13M6.5 10v7.5M10 10v7.5M14 10v7.5M17.5 10v7.5M3.5 10 12 4l8.5 6Z'),
    labor: '<circle cx="9" cy="8" r="3"/>' + P('M3.5 19.5c.6-3.5 2.6-5.5 5.5-5.5s4.9 2 5.5 5.5') + '<circle cx="17" cy="9" r="2.3"/>' + P('M16 14.2c2.6-.3 4.2 1.4 4.6 4.3'),
    energy: P('M13 3 5.5 13.5h5.5L10 21l8-11h-5.5Z'),
    realty: P('M4 20.5V10l8-5.5 8 5.5v10.5M9.5 20.5V14h5v6.5M2.5 20.5h19'),
    other: '<rect x="4" y="4.5" width="16" height="15" rx="2.5"/>' + P('M8 9h8M8 12.5h8M8 16h5')
  };
  const icon = (it) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[it.main_factor] || ICON.other}</svg>`;

  /* ---------- Команда: собирается на сервере под компанию и роль ---------- */
  const ACC = { alfi: 1, tax: 3, money: 2, sales: 0, market: 0, people: 0, law: 3, ved: 2, partners: 1, group: 2, own: 0 };
  const ALFI = { id: 'alfi', kind: 'alfi', name: 'Альфи', watch: 'Все темы и аналитика банка', fur: '#EF3124', all: true,
    why: 'Читает все источники, сверяет с аналитикой Альфа-Банка и пишет разборы' };
  let PEOPLE = { alfi: ALFI };
  const register = (kind, fur, acc = 0) => { try { return !!(M && M.registerKind && M.registerKind(kind, { fur, acc })); } catch (_) { return false; } };
  const furOf = (kind) => (M && M.KINDS && M.KINDS[kind] ? M.KINDS[kind].fur : '#EF3124');
  const isOwn = (m) => String(m.id).startsWith('own-') || m.auto === false;
  function setTeam(t) {
    S.team = t || { members: [], available: [], max: 4, custom: false };
    PEOPLE = { alfi: ALFI };
    for (const m of S.team.members) {
      const fur = /^#[0-9A-Fa-f]{6}$/.test(m.fur || '') ? m.fur.toUpperCase() : '#EF3124';
      const kind = 'm-' + String(m.id).replace(/[^a-z0-9-]/gi, '') + '-' + fur.slice(1);
      register(kind, fur, ACC[m.kind] ?? 0);
      PEOPLE[m.id] = { ...m, fur, kind, own: isOwn(m) };
    }
  }
  const agentOf = (id) => PEOPLE[id] || ALFI;

  // рендер в WebGL дорогой, поэтому кэшируем
  const avatarCache = new Map();
  const avatarSrc = (kind, size) => {
    const key = kind + '@' + size;
    if (!avatarCache.has(key)) avatarCache.set(key, M && M.img ? M.img(kind, size) : '');
    return avatarCache.get(key);
  };
  const mount = (el, kind = 'alfi', size = 128) => {
    if (!el) return el;
    el.classList.add('a-ava');
    const src = avatarSrc(kind, size);
    if (src) el.innerHTML = `<img src="${src}" alt="" width="${size}" height="${size}">`;
    else { el.classList.add('a-ava--dot'); el.style.setProperty('--c', furOf(kind)); }
    return el;
  };
  const mountAll = (root, attr, size) => $$(`[data-${attr}]`, root).forEach((el) => mount(el, agentOf(el.dataset[attr.replace(/-./g, (x) => x[1].toUpperCase())]).kind, size));

  mount($('#aFabBuddy'), 'alfi', 160);

  /* ---------- Меню: «Новости» наверх, метка «Новое» к ним ---------- */
  (() => {
    const nav = $('.nav'); if (!nav) return;
    const news = nav.querySelector('[title="Новости"]'), req = nav.querySelector('[title="Заявки"]');
    if (req) { const tag = req.querySelector('.tag--new'); if (tag) tag.remove(); }
    if (!news) return;
    news.classList.add('is-news');
    if (req) nav.insertBefore(news, req);
    const label = news.querySelector('.nav__label');
    if (label && !news.querySelector('.tag--new')) label.insertAdjacentHTML('afterend', '<span class="tag tag--new">Новое</span>');
  })();

  /* ---------- Сцена с котом ---------- */
  const stageEl = $('#aStage');
  const place = (r) => {
    const top = 30, bottom = 78;
    const size = Math.max(150, Math.min(r.height - top - bottom, r.width * 0.78, 280));
    return { x: r.width / 2 - size * 0.03, y: top + (r.height - top - bottom + size) / 2, size };
  };
  const scene = M && M.stage ? M.stage(stageEl, { kind: 'alfi', anchor: (r) => place(r) }) : (stageEl.classList.add('is-nogl'), null);

  /* ---------- Состояние ---------- */
  const S = {
    me: null, meta: null, feed: null, items: [], team: null,
    tab: 'risk', cat: 'alfi', gone: new Set(), useful: new Set(),
    read: new Set(), polls: 0, pollT: 0, chatLoaded: false, chatCtx: null, runs: {}, heroSig: ''
  };
  const helperFilter = () => (S.cat === 'alfi' ? null : S.cat);
  // прочитанное уходит из рабочих вкладок в свою
  const readKey = () => `alfi:read:${S.me ? S.me.uid + ':' + S.me.role : ''}`;
  const loadRead = () => { try { return new Set(JSON.parse(localStorage.getItem(readKey()) || '[]')); } catch (_) { return new Set(); } };
  const saveRead = () => { try { localStorage.setItem(readKey(), JSON.stringify([...S.read].slice(-300))); } catch (_) {} };
  const isRead = (it) => S.read.has(it.id);
  const inTab = (it, tab) => tab === 'read' ? isRead(it)
    : !isRead(it) && (tab === 'all' || (tab === 'risk' ? it.kind === 'risk' || it.kind === 'mixed' : it.kind === 'chance' || it.kind === 'mixed'));
  const ofHelper = (it) => !helperFilter() || it.helper === helperFilter();
  const ofArea = (it) => !S.area || (it.areas || []).some((a) => a.id === S.area);
  const visible = () => S.items.filter((it) => inTab(it, S.tab) && ofHelper(it) && ofArea(it));
  const byId = (id) => S.items.find((it) => it.id === id);

  /* ---------- Смена персонажа на сцене ---------- */
  const whoEl = $('#aStageWho'), chatBtn = $('#aStageChat');
  function paintWho(p) {
    whoEl.textContent = `На сцене ${p.name}. ${p.watch}`;
    chatBtn.setAttribute('aria-label', p.all ? 'Чат с Альфи' : `Чат с помощником «${p.name}»`);
  }
  function catSwap(p) { if (!scene) return; if (scene.swap) scene.swap(p.kind); else scene.setKind(p.kind); }
  function selectCat(id) {
    const p = agentOf(id);
    if (p.id === S.cat) return;
    S.cat = p.id;
    markTeam();
    swapFeed(() => { if (helperFilter() && !visible().length) S.tab = 'all'; });
    catSwap(p);
    paintWho(p);
    if (chat.open) openChat(p);
  }
  function markTeam() {
    $$('.a-mate[data-team]').forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.team === S.cat)));
    $$('[data-hero-cat]').forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.heroCat === S.cat)));
  }

  const localXY = (e) => { const r = stageEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  stageEl.addEventListener('click', (e) => {
    if (!scene || e.target.closest('button, a, input')) return;
    if (scene.hit(...localXY(e))) { scene.poke(); openChat(agentOf(S.cat)); }
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!scene) return;
    const on = !e.target.closest('button, a, input') && scene.hit(...localXY(e));
    stageEl.style.cursor = on ? 'pointer' : '';
    if (scene.hover) scene.hover(on);
  });
  stageEl.addEventListener('pointerleave', () => { if (scene && scene.hover) scene.hover(false); });
  chatBtn.addEventListener('click', () => { if (scene) scene.poke(); openChat(agentOf(S.cat)); });

  /* ---------- Карточка ленты ----------
     Наверху событие и первоисточник. Ниже «Почему это вам»: признаки компании, из-за которых новость попала в ленту,
     сферы бизнеса, которые она затрагивает, и ближайший тезис аналитики Альфа-Банка со ссылкой на страницу PDF. */
  const IMPACT = { negative: 'is-neg', positive: 'is-pos', mixed: 'is-mix' };
  const IMPACT_T = { negative: 'во вред', positive: 'на пользу', mixed: 'двояко' };
  // две главные причины одной строкой
  // внизу карточки, без повтора фактора из шапки
  const whyLine = (it) => {
    const main = String(it.main_factor_label || '').trim().toLowerCase();
    const out = [];
    for (const r of it.reasons || []) {
      let t = String(r.text || '').replace(/^ваша отрасль: /, 'отрасль ').replace(/^страна вашей ВЭД: /, 'ВЭД: ').trim();
      if (main && t.toLowerCase() === main) continue;
      if (main && t.toLowerCase().startsWith(main + ':')) t = t.slice(main.length + 1).trim();
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
      if (out.length === 2) break;
    }
    return out.join(' · ');
  };
  // Знак влияния: линия тренда вверх или вниз, «±» когда событие и помогает, и мешает
  const TREND = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const SIGN = {
    negative: ['is-neg', TREND('M4 7l6 6 3.5-3.5L20 16M20 10.5V16h-5.5'), 'во вред'],
    positive: ['is-pos', TREND('M4 17l6-6 3.5 3.5L20 8M20 13.5V8h-5.5'), 'на пользу'],
    mixed: ['is-mix', TREND('M12 4.5v8M8 8.5h8M8 18.5h8'), 'и плюс, и минус']
  };
  function card(it) {
    if (S.gone.has(it.id)) {
      return `<div class="a-gone" data-id="${esc(it.id)}"><span>Скрыл «${esc(cut(it.headline || it.title, 90))}». Похожие новости опущу ниже.</span><button data-undo="${esc(it.id)}">Вернуть</button></div>`;
    }
    const k = kindOf(it), src = safeUrl(it.url), mate = agentOf(it.helper);
    const bank = (it.bank_refs || [])[0], bankUrl = bank && safeUrl(bank.url);
    const areas = (it.areas || []).filter((a) => a.label).slice(0, 3);
    const step = it.action && !/^Разобрать/.test(it.action) ? it.action : '';
    const sign = (a) => SIGN[a.impact] || ['', TREND('M7 12h10'), 'влияние'];
    return `
      <article class="a-card f-card is-${k}${it.user ? ' is-user' : ''}" data-id="${esc(it.id)}" title="Почему в вашей ленте: ${esc(whyLine(it))}">
        <header class="f-head">
          <span class="f-ic is-${k}" title="${esc(it.main_factor_label || '')}">${icon(it)}</span>
          <p class="f-meta">
            <span class="f-badge is-${k}">${it.urgency >= 3 ? 'Срочно · ' : ''}${KIND[k]}</span>
            <span class="f-meta__s">${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(it.source)}</a>` : esc(it.source)}${it.n_sources > 1 ? ` <span class="f-meta__n">+${it.n_sources - 1}</span>` : ''}</span>
            <time class="f-date" datetime="${esc(it.published || '')}">${esc(ago(it.published))}</time>${it.user ? '<span class="c-mine">ваша новость</span>' : ''}
          </p>
          ${isRead(it) ? `<button class="f-read is-back" data-unread="${esc(it.id)}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Вернуть</button>`
            : `<button class="f-read" data-read="${esc(it.id)}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>Прочитано</button>`}
          <h3 class="a-card__title f-title">${esc(it.headline || it.title)}</h3>
        </header>
        <div class="f-body">
          ${areas.length ? `<ul class="f-imp" aria-label="Что меняется для компании">${areas.map((a) => { const g = sign(a); const e = String(a.effect || '').trim(), e2 = /^[А-ЯЁA-Z][а-яёa-z]/.test(e) ? e[0].toLowerCase() + e.slice(1) : e; return `<li class="${g[0]}"><span class="f-imp__s" role="img" aria-label="${g[2]}" title="${g[2]}">${g[1]}</span><p><b>${esc(a.label)}</b>${e2 ? `: ${esc(e2)}` : ''}</p></li>`; }).join('')}</ul>`
            : it.lead ? `<p class="f-lead">${esc(cut(it.lead, 220))}</p>` : ''}
          ${step || bankUrl ? `<div class="f-panel${step && bankUrl ? ' is-two' : ''}">
            ${step ? `<div class="f-panel__c"><p class="f-panel__k">Что сделать</p><p class="f-panel__t">${esc(step)}</p></div>` : ''}
            ${bankUrl ? `<a class="f-panel__c f-panel__bank" href="${esc(bankUrl)}" target="_blank" rel="noopener" title="${esc(bank.doc_title)}"><p class="f-panel__k"><svg class="ic" aria-hidden="true"><use href="#i-bank"/></svg>Альфа-Банк<span>стр. ${esc(bank.page)}</span></p><p class="f-panel__q">${esc(bank.text)}</p></a>` : ''}
          </div>` : ''}
        </div>
        <footer class="a-card__acts f-acts">
          <button class="btn btn--dark" data-ins="${esc(it.id)}">${it.has_insight ? 'Открыть разбор' : 'Разбор для компании'}</button>
          <button class="f-ask" data-askabout="${esc(it.id)}" data-askhelper="${esc(it.helper || '')}" style="--c:${esc(mate.fur)}" title="${esc(mate.all ? 'Альфи: все темы' : mate.task || mate.watch)}"><span class="f-ask__ava" data-ava="${esc(mate.id)}"></span><span>Спросить <b>${esc(mate.all ? 'Альфи' : mate.name)}</b></span></button>
        </footer>
      </article>`;
  }
  const sigOf = (it) => [S.gone.has(it.id), isRead(it), S.useful.has(it.id), it.has_insight, (it.areas || []).map((a) => a.id + a.impact).join(), it.relevance, it.helper, it.action, it.kind].join('|');

  // лента не перерисовывается целиком, карточки переиспользуются
  function renderFeed(quiet) {
    const wrap = $('#aCards');
    const list = visible();
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
    const entering = [];
    list.forEach((it) => {
      const sig = sigOf(it);
      let el = have.get(it.id);
      have.delete(it.id);
      if (el && el.dataset.sig === sig) { wrap.appendChild(el); return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = card(it);
      const fresh = tmp.firstElementChild;
      fresh.dataset.sig = sig;
      if (el) el.replaceWith(fresh); else wrap.appendChild(fresh);
      wrap.appendChild(fresh);
      if (!el) entering.push(fresh);
    });
    if (!list.length) {
      wrap.insertAdjacentHTML('beforeend', S.feed ? `<div class="a-empty">${helperFilter() ? `У помощника «${esc(agentOf(S.cat).name)}» пока нет находок в этой вкладке.` : (S.tab === 'read' ? 'Прочитанных пока нет. Отмечайте новости кнопкой «Прочитано», и они соберутся здесь.' : 'В этой вкладке пусто. Альфи напишет, когда появится что-то важное.')}</div>` : '<div class="a-empty">Загружаю ленту…</div>');
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
      t.hidden = t.dataset.tab === 'read' && !S.items.some(isRead);
      t.querySelector('sup').textContent = n;
      t.setAttribute('aria-selected', String(t.dataset.tab === S.tab));
    });
    const f = $('#aFilter'), tok = [];
    if (helperFilter()) tok.push(`<button class="a-token" data-clearteam><span class="a-token__ava" data-tava></span>${esc(agentOf(S.cat).name)}<svg class="ic ic--sm"><use href="#i-close"/></svg></button>`);
    if (S.area) tok.push(`<button class="a-token" data-cleararea>${esc(S.areaLabel || '')}<svg class="ic ic--sm"><use href="#i-close"/></svg></button>`);
    f.hidden = !tok.length; f.innerHTML = tok.join('');
    if (helperFilter()) mount(f.querySelector('[data-tava]'), agentOf(S.cat).kind);
    markTeam();
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
    // вкладки отвечают сразу, карточки догоняют
    $$('.a-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)));
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
    const from = parseFloat(wrap.style.minHeight) || 0;
    wrap.style.minHeight = '';
    const to = wrap.offsetHeight;
    if (to < from) wrap.animate([{ minHeight: from + 'px' }, { minHeight: to + 'px' }], { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)' });
  }

  /* ---------- Строка состояния ленты: сколько отобрано, когда собрано, кнопки ---------- */
  function renderLive() {
    const f = S.feed; if (!f) return;
    const st = f.stats || {}, ing = f.ingest || {};
    const busy = f.ingest_running ? 'Собираю свежие новости' : (f.triage_running || f.triage_pending) ? 'Уточняю, как новости влияют на компанию' : '';
    $('#fLive').innerHTML = `
      <span class="f-live__s">${busy ? `<span class="f-spin" aria-hidden="true"></span>${busy}` : `${st.picked} из ${fmt(st.scanned)} новостей за ${st.days} ${plural(st.days, 'день', 'дня', 'дней')}${ing.finished ? ` · обновлено ${esc(ago(ing.finished))}` : ''}`}</span>
      <span class="f-live__acts">
        <button class="f-lnk" type="button" data-refresh ${f.ingest_running ? 'disabled' : ''}><svg class="ic ic--sm"><use href="#i-refresh"/></svg>Обновить</button>
        <button class="f-lnk" type="button" data-submit>Проверить свою новость</button>
      </span>`;
  }


  /* ---------- Роль и бизнес вместо «Альфа Босс» ----------
     Кнопка аккаунта показывает компанию и роль. Меню: смена роли в один клик, текущий бизнес и его смена,
     профиль, «Как работает» и метрики. «Мои компании» сразу открывает выбор компании.
     В продуктиве компанию и роль передаёт вход в Альфа-Бизнес, здесь они меняются для проверки. */
  const accBtn = $('.topbar .account');
  const accMenu = document.createElement('div');
  accMenu.className = 'acc-menu'; accMenu.id = 'accMenu'; accMenu.hidden = true;
  accMenu.setAttribute('role', 'dialog'); accMenu.setAttribute('aria-label', 'Роль и бизнес');
  document.body.appendChild(accMenu);
  if (accBtn) { accBtn.setAttribute('aria-haspopup', 'dialog'); accBtn.setAttribute('aria-expanded', 'false'); accBtn.setAttribute('aria-controls', 'accMenu'); }
  const compBtn = $('.topbar .companies');
  if (compBtn) compBtn.setAttribute('data-login', '');
  function renderBar() {
    const me = S.me, name = accBtn && accBtn.querySelector('.account__name');
    if (!accBtn) return;
    if (!me) {
      if (name) name.innerHTML = '<span class="acc__t">Выбрать компанию</span>';
      accBtn.setAttribute('aria-label', 'Выбрать компанию и роль');
      accMenu.innerHTML = '';
      const cu = compBtn && compBtn.querySelector('.companies__user'); if (cu) cu.textContent = 'не выбрана';
      return;
    }
    const c = me.company, roles = (S.meta && S.meta.roles) || {};
    if (name) name.innerHTML = `<span class="acc__t">${esc(me.role_label)}</span><span class="acc__s">${esc(cut(c.title.split(' · ')[0], 28))}</span>`;
    accBtn.setAttribute('aria-label', `Роль: ${me.role_label}. Компания: ${c.title}. Открыть настройки`);
    const cu = compBtn && compBtn.querySelector('.companies__user'); if (cu) cu.textContent = cut(c.title.split(' · ')[0], 22);
    accMenu.innerHTML = `
      <p class="acc-menu__h">Ваша роль</p>
      <div class="acc-roles" role="radiogroup" aria-label="Роль в бизнесе">${Object.entries(roles).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === me.role}" data-role="${esc(k)}" title="${esc(v.focus)}">${esc(v.label)}</button>`).join('')}</div>
      <p class="acc-menu__f">${esc(roles[me.role] ? roles[me.role].focus : '')}</p>
      <p class="acc-menu__h">Ваш бизнес</p>
      <button type="button" class="acc-biz" data-prof>
        <b>${esc(c.title)}</b>
        <span>${esc(c.sector_label)}${c.revenue_label && !/^0\s/.test(c.revenue_label) ? ` · ${esc(c.revenue_label)}` : ''}${c.region ? ` · ${esc(c.region)}` : ''}</span>
        <small>Профиль: на чём строится лента</small>
      </button>
      <button type="button" class="acc-i is-main" data-login><svg class="ic"><use href="#i-refresh"/></svg>Сменить бизнес<small>компания из кейса или описание своего</small></button>
      <div class="acc-row">
        <button type="button" class="acc-i" data-how><svg class="ic"><use href="#i-layers"/></svg>Как работает</button>
        <button type="button" class="acc-i" data-metrics><svg class="ic"><use href="#i-chart"/></svg>Метрики</button>
      </div>`;
  }
  function placeAcc() {
    if (!accBtn) return;
    const r = accBtn.getBoundingClientRect(), w = Math.min(380, innerWidth - 24);
    accMenu.style.width = w + 'px';
    accMenu.style.top = Math.round(r.bottom + 8) + 'px';
    accMenu.style.left = Math.round(Math.max(12, Math.min(r.right - w, innerWidth - w - 12))) + 'px';
  }
  function toggleMenu(open) {
    if (!accBtn) return;
    open = open ?? accMenu.hidden;
    if (open && !S.me) { openLogin(); return; }
    accMenu.hidden = !open; accBtn.setAttribute('aria-expanded', String(open));
    if (open) { placeAcc(); if (!reduce) accMenu.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.9,.3,1)' }); }
  }
  if (accBtn) accBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => {
    if (accMenu.hidden || e.target.closest('.topbar .account')) return;
    if (!e.target.closest('#accMenu') || e.target.closest('[data-prof], [data-login], [data-how], [data-metrics]')) toggleMenu(false);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !accMenu.hidden) { toggleMenu(false); accBtn.focus(); } });
  addEventListener('resize', () => { if (!accMenu.hidden) placeAcc(); });
  accMenu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role]'); if (!b || !S.me || b.dataset.role === S.me.role) return;
    $$('[data-role]', accMenu).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    try { await API.login(S.me.uid, b.dataset.role); toggleMenu(false); await boot(); toast(`Лента и команда собраны для роли «${S.me.role_label}»`); maybeHow(); }
    catch (x) { toast(x.message); }
  });

  /* ---------- Команда Альфи: 3 помощника подобраны под компанию, можно до 4 ---------- */
  const countOf = (p) => S.items.filter((it) => !S.gone.has(it.id) && !isRead(it) && (p.all || it.helper === p.id)).length;
  function teamRow(p) {
    const n = countOf(p);
    const hot = !p.all && S.items.some((it) => it.helper === p.id && it.urgency >= 3);
    return `<li class="a-team__row">
      <button class="a-mate" data-team="${esc(p.id)}" aria-pressed="${S.cat === p.id}" title="${esc(p.why_ai || p.why || '')}">
        <span class="a-mate__ava" data-mava="${esc(p.id)}"></span>
        <span class="a-mate__txt"><span class="a-mate__name">${esc(p.name)}</span><span class="a-mate__sub">${esc(p.task || p.watch)}</span></span>
        <span class="a-mate__n ${hot ? 'is-red' : ''}">${n}</span>
      </button>
      ${p.all ? '' : `<button class="a-mate__x" type="button" data-drop="${esc(p.id)}" aria-label="Убрать «${esc(p.name)}» из команды"><svg class="ic"><use href="#i-close"/></svg></button>`}
    </li>`;
  }
  function renderTeam() {
    const t = S.team || { members: [], max: 4 };
    const full = t.members.length >= (t.max || 4);
    $('#aTeamSub').innerHTML = t.selecting ? '<span class="f-spin" aria-hidden="true"></span>ИИ подбирает команду…'
      : t.custom ? 'Состав изменён вами' : '';
    $('#aTeam').innerHTML = [ALFI, ...t.members.map((m) => PEOPLE[m.id])].map(teamRow).join('') + `
      <li><button class="a-mate a-mate--new" id="aTeamNew" type="button" ${full ? 'aria-disabled="true"' : ''}>
        <span class="a-mate__ava a-mate__ava--plus"><svg class="ic"><use href="#i-plus"/></svg></span>
        <span class="a-mate__txt"><span class="a-mate__name">${full ? 'Команда собрана' : 'Добавить помощника'}</span><span class="a-mate__sub">${full ? `Не больше ${t.max || 4}, уберите кого-то, чтобы добавить` : 'Тема, имя и цвет'}</span></span>
      </button></li>
      ${t.custom ? '<li><button class="a-team__reset" type="button" data-team-reset>Собрать заново под компанию</button></li>' : ''}`;
    $$('[data-mava]', $('#aTeam')).forEach((el) => mount(el, agentOf(el.dataset.mava).kind));
    markTeam();
  }
  // состав команды хранится на сервере
  const teamBody = (members) => ({
    ids: members.filter((m) => !m.own).map((m) => m.id),
    own: members.filter((m) => m.own).map((m) => ({ id: m.id, name: m.name, watch: m.watch, fur: m.fur }))
  });
  async function saveTeam(members, msg) {
    try {
      const t = await API.put('/api/team', teamBody(members));
      setTeam(t);
      if (!PEOPLE[S.cat]) S.cat = 'alfi';
      await loadFeed(true);
      if (msg) toast(msg);
    } catch (e) { toast(e.message); }
  }
  async function dropMate(id) {
    const left = S.team.members.filter((m) => m.id !== id).map((m) => PEOPLE[m.id]);
    const gone = PEOPLE[id];
    if (S.cat === id) selectCat('alfi');
    if (!left.length) { toast('Без помощников Альфи справится сам, но хотя бы один лучше оставить'); return; }
    await saveTeam(left, `Убрал «${gone.name}» из команды. Его новости теперь у Альфи`);
  }

  /* ---------- Мастер «Добавить помощника» ----------
     Шаг 1: тема из предложенных под компанию или своя. Шаг 2: имя и цвет. Шаг 3: как часто писать и пример сообщения. */
  const PALETTE = [
    { fur: '#EF3124', name: 'Алый' }, { fur: '#F2B33D', name: 'Янтарный' }, { fur: '#4FA35A', name: 'Зелёный' },
    { fur: '#16C8D2', name: 'Бирюзовый' }, { fur: '#7A3FE0', name: 'Фиолетовый' }, { fur: '#2A2A30', name: 'Графит' }
  ];
  const FREQ = [
    { id: 'now', name: 'Сразу', sub: 'Как только появится событие', first: 'сегодня' },
    { id: 'day', name: 'Раз в день', sub: 'Сводка в 9:00', first: 'завтра в 9:00' },
    { id: 'week', name: 'Раз в неделю', sub: 'Итоги в понедельник', first: 'в понедельник' }
  ];
  const dlg = $('#aNew'), form = $('#aNewForm'), colorsEl = $('#aNewColors'), newStage = $('#aNewStage');
  const nameIn = $('#aNewName'), watchIn = $('#aNewWatch'), nameErr = $('#aNewNameErr');
  const backBtn = $('#aNewBack'), nextBtn = $('#aNewNext'), steps = $$('.a-step', dlg);
  const previewKind = (fur) => 'own-preview-' + fur.slice(1);
  let TOPICS = [];
  const draft = { step: 0, topic: null, fur: PALETTE[4].fur, freq: 'day', nameTouched: false };
  let newScene = null;

  // пример вопроса берём из ленты, если есть подходящая новость
  function sampleFor(c) {
    const it = S.items.find((x) => (x.factors || []).some((f) => (c.factors || []).includes(f.id)));
    return it ? `${it.headline || it.title}. ${it.action && !/^Разобрать/.test(it.action) ? it.action : 'Разберу, что это меняет для компании'}` : '';
  }
  function buildTopics() {
    TOPICS = (S.team.available || []).map((c) => ({ id: c.id, name: c.name, watch: c.watch, fur: (c.fur || '#7A3FE0').toUpperCase(), why: c.why, factors: c.factors, sample: sampleFor(c) }));
    TOPICS.push({ id: 'own', name: 'Своя тема', watch: 'Опишите своими словами', fur: '#EF3124', own: true });
    $('#aNewTopicsSub').textContent = TOPICS.length > 1 ? 'Темы подобраны по данным вашей компании. Можно описать и свою.' : 'Опишите тему своими словами: Альфи подберёт под неё новости.';
    $('#aNewTopics').innerHTML = TOPICS.map((t) => `
      <label class="a-topic${t.own ? ' a-topic--own' : ''}" style="--c:${t.fur}">
        <input class="visually-hidden" type="radio" name="aTopic" value="${esc(t.id)}">
        <span class="a-topic__dot" aria-hidden="true">${t.own ? '<svg class="ic"><use href="#i-plus"/></svg>' : ''}</span>
        <span class="a-topic__n">${esc(t.name)}</span>
        <span class="a-topic__w">${esc(t.watch)}</span>
        ${t.why ? `<span class="a-topic__y">${esc(cut(t.why, 90))}</span>` : ''}
      </label>`).join('');
  }
  colorsEl.innerHTML = PALETTE.map((c) => `<button type="button" class="a-color" role="radio" aria-checked="false" data-fur="${c.fur}" style="--c:${c.fur}" aria-label="${c.name}" title="${c.name}"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></button>`).join('');
  $('#aNewFreq').innerHTML = FREQ.map((f) => `
    <label class="a-freq__i">
      <input class="visually-hidden" type="radio" name="aFreq" value="${f.id}">
      <span class="a-freq__n">${esc(f.name)}</span><span class="a-freq__s">${esc(f.sub)}</span>
    </label>`).join('');

  const placeNew = (r) => {
    const top = 22, bottom = 18, size = Math.max(140, Math.min(r.height - top - bottom, r.width * 0.84, 250));
    return { x: r.width / 2 - size * 0.03, y: top + (r.height - top - bottom + size) / 2, size };
  };
  const topicOf = () => TOPICS.find((t) => t.id === draft.topic) || null;
  const watchOf = () => { const t = topicOf(); return !t ? '' : t.own ? noName(watchIn.value, 60) : t.watch; };

  function paintColor(animate) {
    dlg.style.setProperty('--c', draft.fur);
    register(previewKind(draft.fur), draft.fur);
    if (newScene) { if (animate && newScene.swap) newScene.swap(previewKind(draft.fur)); else newScene.setKind(previewKind(draft.fur)); }
    colorsEl.querySelectorAll('.a-color').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fur === draft.fur)));
  }
  function paintDraft() {
    const t = topicOf(), name = noName(nameIn.value, 18) || (t && !t.own ? t.name : ''), watch = watchOf();
    $('#aNewCardName').textContent = name || 'Новый помощник';
    $('#aNewCardWatch').textContent = watch || (t ? 'Напишите, за чем следить' : 'Выберите тему');
    newStage.setAttribute('aria-label', name ? `Так будет выглядеть «${name}»` : 'Так будет выглядеть ваш помощник');
    const f = FREQ.find((x) => x.id === draft.freq);
    const lead = { now: 'Важное сейчас', day: 'Сводка за день', week: 'Итоги недели' }[draft.freq];
    $('#aNewSampleName').textContent = name || 'Помощник';
    $('#aNewSampleText').textContent = `${lead}. ${t && t.sample ? t.sample : `Нашёл событие по теме «${watch || 'ваша тема'}» и объясню, что оно меняет для компании`}. Первое сообщение придёт ${f.first}.`;
  }
  function go(step) {
    const prev = draft.step;
    draft.step = step;
    steps.forEach((el, i) => { el.hidden = i !== step; });
    $$('[data-step-dot]', dlg).forEach((el, i) => {
      el.classList.toggle('is-on', i === step); el.classList.toggle('is-done', i < step);
      if (i === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    backBtn.textContent = step ? 'Назад' : 'Отмена';
    nextBtn.textContent = step === 2 ? 'Добавить в команду' : 'Дальше';
    paintNext();
    if (step === 2) mount($('#aNewSampleAva'), previewKind(draft.fur), 96);
    if (!reduce && prev !== step) {
      const dir = step > prev ? 1 : -1;
      steps[step].animate([{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.9,.3,1)' });
    }
    if (step === 1) setTimeout(() => { nameIn.focus(); nameIn.select(); }, 60);
  }
  const stepReady = () => draft.step === 0 ? !!topicOf() && (!topicOf().own || watchOf().length >= 3) : draft.step === 1 ? !!noName(nameIn.value, 18) : true;
  const paintNext = () => nextBtn.classList.toggle('is-wait', !stepReady());
  function pickTopic(id) {
    const t = TOPICS.find((x) => x.id === id); if (!t) return;
    draft.topic = id;
    $('#aNewOwnWrap').hidden = !t.own;
    if (!draft.nameTouched) nameIn.value = t.own ? '' : t.name;
    if (t.fur !== draft.fur) { draft.fur = t.fur; paintColor(true); }
    if (t.own) setTimeout(() => watchIn.focus(), 30);
    paintDraft(); paintNext();
  }
  function openCreate() {
    const t = S.team || { members: [], max: 4 };
    if (t.members.length >= (t.max || 4)) { toast(`В команде уже ${t.members.length}. Уберите кого-то, чтобы добавить нового`); return; }
    buildTopics();
    Object.assign(draft, { step: 0, topic: null, fur: PALETTE[4].fur, freq: 'day', nameTouched: false });
    nameIn.value = ''; watchIn.value = ''; nameErr.textContent = '';
    form.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = r.name === 'aFreq' && r.value === draft.freq; });
    $('#aNewOwnWrap').hidden = true;
    register(previewKind(draft.fur), draft.fur);
    dlg.showModal();
    if (M && M.stage && !newScene) newScene = M.stage(newStage, { kind: previewKind(draft.fur), anchor: placeNew });
    newStage.classList.toggle('is-nogl', !newScene);
    paintColor(false); paintDraft(); go(0);
    setTimeout(() => { const r = form.querySelector('input[name="aTopic"]'); if (r) r.focus(); }, 80);
  }
  async function createAgent() {
    const t = topicOf(), name = noName(nameIn.value, 18), watch = watchOf();
    const members = S.team.members.map((m) => PEOPLE[m.id]);
    // без правок сохраняем как есть, с правками — как своего
    const asIs = t && !t.own && name === t.name && draft.fur === t.fur;
    if (!asIs && members.filter((m) => m.own).length >= 2) { toast('Своих помощников может быть два. Уберите одного из них'); return; }
    const id = asIs ? t.id : 'own-' + Date.now().toString(36).slice(-8);
    members.push(asIs ? { id: t.id, own: false } : { id, name, watch, fur: draft.fur, own: true });
    nextBtn.disabled = true;
    await saveTeam(members);
    nextBtn.disabled = false;
    dlg.close();
    if (PEOPLE[id]) {
      const n = countOf(PEOPLE[id]);
      selectCat(id);
      const row = $(`#aTeam [data-team="${CSS.escape(id)}"]`);
      if (row) row.classList.add('is-born');
      const f = FREQ.find((x) => x.id === draft.freq);
      toast(n ? `${name || t.name} в команде и уже нашёл ${n} ${plural(n, 'событие', 'события', 'событий')}` : `${name || t.name} в команде. Первое сообщение ${f.first}`);
    }
  }
  dlg.addEventListener('close', () => { if (newScene) { newScene.destroy(); newScene = null; } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-new-close]')) dlg.close(); });
  backBtn.addEventListener('click', () => { if (draft.step) go(draft.step - 1); else dlg.close(); });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'aTopic') pickTopic(e.target.value);
    if (e.target.name === 'aFreq') { draft.freq = e.target.value; paintDraft(); }
  });
  colorsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.a-color'); if (!b || b.dataset.fur === draft.fur) return;
    draft.fur = b.dataset.fur; paintColor(true);
  });
  colorsEl.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
    e.preventDefault();
    const all = $$('.a-color', colorsEl), i = all.findIndex((b) => b.dataset.fur === draft.fur);
    const b = all[(i + d + all.length) % all.length]; b.focus(); b.click();
  });
  nameIn.addEventListener('input', () => { draft.nameTouched = true; nameErr.textContent = ''; paintDraft(); paintNext(); });
  watchIn.addEventListener('input', () => { paintDraft(); paintNext(); });
  newStage.addEventListener('click', () => { if (newScene) newScene.poke(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (draft.step === 0) {
      if (!topicOf()) { toast('Выберите тему или опишите свою'); return; }
      if (!stepReady()) { toast('Опишите тему хотя бы в трёх буквах'); watchIn.focus(); return; }
      go(1); return;
    }
    if (draft.step === 1) {
      if (!stepReady()) { nameErr.textContent = 'Придумайте имя, хотя бы одно слово'; nameIn.focus(); return; }
      go(2); return;
    }
    createAgent();
  });

  /* ---------- Сводка над лентой ----------
     Сколько рисков и возможностей, линия дат на 3 месяца и три главных события.
     «Как работает» открывает отдельное окно с анимацией и не трогает сводку. */
  const heroEl = $('#aHero');
  const DAY = 864e5;
  const daysTo = (it) => {
    const d = it.effective_date ? new Date(it.effective_date + 'T00:00:00') : null;
    return d && !isNaN(d) ? Math.round((d - new Date().setHours(0, 0, 0, 0)) / DAY) : null;
  };
  const inDays = (d) => (d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `через ${d} ${plural(d, 'день', 'дня', 'дней')}`);
  const ahead = () => S.items.filter((it) => !S.gone.has(it.id)).map((it) => ({ it, d: daysTo(it) })).filter((x) => x.d != null && x.d >= 0 && x.d <= 90).sort((a, b) => a.d - b.d);
  const shortT = (it) => cut(it.headline || it.title, 46);
  const crew = () => [ALFI, ...((S.team && S.team.members) || []).map((m) => PEOPLE[m.id])];
  // сферы по непрочитанным: сколько во вред, сколько на пользу
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
  function briefHTML() {
    const list = S.items.filter((it) => !S.gone.has(it.id) && !isRead(it));
    const risk = list.filter((it) => inTab(it, 'risk')).length, chance = list.filter((it) => inTab(it, 'chance')).length;
    const fresh = list.filter((it) => it.published && Date.now() - new Date(it.published) < 864e5).length;
    const areas = areaStats(list), max = Math.max(1, ...areas.map((a) => a.n));
    const top = list.slice().sort((a, b) => (b.urgency - a.urgency) || (b.relevance - a.relevance))[0];
    const tk = top && kindOf(top), tm = top && agentOf(top.helper), tstep = top && top.action && !/^Разобрать/.test(top.action) ? top.action : '';
    return `
      <div class="a-hero__in a-hero__in--brief">
        <header class="a-brief__head">
          <h2 class="a-hero__title a-hero__title--s" id="aHeroTitle">${esc(hello())}</h2>
          <p class="a-hero__lead">${list.length ? `Касаются компании: <b class="is-risk">${risk} ${plural(risk, 'риск', 'риска', 'рисков')}</b> и <b class="is-chance">${chance} ${plural(chance, 'возможность', 'возможности', 'возможностей')}</b>${fresh ? `, за сутки новых ${fresh}` : ''}` : 'Непрочитанных событий нет. Новые появятся здесь сами'}</p>
          <button class="a-brief__team" type="button" data-how aria-label="Как работает Альфи">
            <span class="a-brief__avas">${crew().slice(0, 4).map((p) => `<span class="a-brief__ava" data-hava="${esc(p.id)}"></span>`).join('')}</span>
            <span>Как работает</span>
          </button>
        </header>
        ${list.length ? `<div class="hb">
          ${top ? `<article class="hb-top is-${tk}">
            <p class="hb-top__k"><span class="hb-top__ava" data-hava="${esc(tm.id)}"></span>Главное сейчас<span class="hb-top__b">${top.urgency >= 3 ? 'Срочно · ' : ''}${KIND[tk]}</span></p>
            <button class="hb-top__t" type="button" data-goto="${esc(top.id)}">${esc(top.headline || top.title)}</button>
            ${tstep ? `<p class="hb-top__s"><svg class="ic" aria-hidden="true"><use href="#i-arrow"/></svg>${esc(tstep)}</p>` : ''}
            <button class="hb-top__go" type="button" data-ins="${esc(top.id)}">${top.has_insight ? 'Открыть разбор' : 'Разбор для компании'}</button>
          </article>` : ''}
          ${areas.length ? `<div class="hb-areas">
            <p class="hb-areas__h">Где это бьёт по бизнесу<span><b class="is-neg">↓</b> вред <b class="is-pos">↑</b> польза <b class="is-mix">±</b> двояко</span></p>
            <ul>${areas.map((a) => `<li><button type="button" data-area="${esc(a.id)}" data-area-label="${esc(a.label)}" aria-pressed="${S.area === a.id}">
              <span class="hb-a__l">${esc(a.label)}</span>
              <span class="hb-a__bar" aria-hidden="true"><i class="is-neg" style="width:${a.neg / max * 100}%"></i><i class="is-mix" style="width:${a.mix / max * 100}%"></i><i class="is-pos" style="width:${a.pos / max * 100}%"></i></span>
              <span class="hb-a__n">${a.neg ? `<b class="is-neg" title="во вред">↓${a.neg}</b>` : ''}${a.pos ? `<b class="is-pos" title="на пользу">↑${a.pos}</b>` : ''}${a.mix ? `<b class="is-mix" title="и плюс, и минус">±${a.mix}</b>` : ''}</span>
            </button></li>`).join('')}</ul>
          </div>` : ''}
        </div>` : ''}
      </div>`;
  }
  function renderMarks() {
    const hz = document.getElementById('aHz'); if (!hz) return;
    const marks = hz.querySelector('.a-hz__marks'), W = marks.clientWidth || 700;
    const list = ahead(), groups = [];
    const half = (n) => (40 + 17 * (Math.min(3, n) - 1)) / 2;
    const clampX = (g) => Math.max(half(g.items.length), Math.min(W - half(g.items.length), g.x));
    for (const x of list) {
      const px = Math.min(1, x.d / 90) * W, g = groups[groups.length - 1];
      if (g && px - clampX(g) < half(g.items.length) + 28) { g.items.push(x); g.x = g.items.reduce((s, i) => s + Math.min(1, i.d / 90) * W, 0) / g.items.length; }
      else groups.push({ x: px, items: [x] });
    }
    groups.forEach((g) => { g.x = clampX(g); });
    const dl = (d) => (d === 0 ? 'Сегодня' : dshort(new Date(Date.now() + d * DAY)));
    marks.innerHTML = groups.map((g) => {
      const kinds = new Set(g.items.map((x) => x.it.kind));
      const label = g.items.map((x) => `${dl(x.d)}: ${shortT(x.it)}`).join('; ');
      const edge = g.x < 120 ? ' is-l' : g.x > W - 120 ? ' is-r' : '';
      const tip = g.items.map((x) => `<span><b>${dl(x.d)}</b> ${esc(shortT(x.it))}</span>`).join('');
      return `<button class="a-hz__m${kinds.has('risk') || kinds.has('mixed') ? ' is-risk' : ' is-chance'}${g.items.some((x) => x.d === 0) ? ' is-today' : ''}${edge}" type="button" data-goto="${esc(g.items[0].it.id)}" data-ids="${g.items.map((x) => esc(x.it.id)).join(' ')}" style="left:${g.x.toFixed(1)}px" aria-label="${esc(label)}">
        ${g.items.slice(0, 3).map((x) => `<span class="a-hz__ava" data-hava="${esc(agentOf(x.it.helper).id)}"></span>`).join('')}${g.items.length > 3 ? `<span class="a-hz__more">+${g.items.length - 3}</span>` : ''}<span class="a-hz__tip" aria-hidden="true">${tip}</span>
      </button>`;
    }).join('');
    $$('[data-hava]', marks).forEach((el) => mount(el, agentOf(el.dataset.hava).kind, 64));
  }
  function renderHero() {
    if (!S.feed || !S.me) { heroEl.innerHTML = ''; return; }
    // не мигаем при фоновом обновлении
    const sig = S.items.map((it) => it.id + it.kind + it.helper + (isRead(it) ? 'r' : '') + (it.areas || []).map((a) => a.id).join('')).join() + '|' + S.gone.size + '|' + S.area + '|' + S.team.members.map((m) => m.id).join();
    if (sig === S.heroSig) return;
    S.heroSig = sig;
    heroEl.dataset.mode = 'brief';
    heroEl.innerHTML = briefHTML();
    $$('[data-hava]', heroEl).forEach((el) => mount(el, agentOf(el.dataset.hava).kind, 96));
    renderMarks();
  }
  heroEl.addEventListener('mouseover', (e) => {
    const n = e.target.closest('[data-next]');
    $$('.a-hz__m', heroEl).forEach((m) => m.classList.toggle('is-hot', !!n && m.dataset.ids.split(' ').includes(n.dataset.next)));
  });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderMarks, 120); });

  /* ---------- «Как работает»: окно с пошаговой анимацией ----------
     Шесть сцен на реальных данных текущей компании: сбор новостей, профиль, сборка команды под задачи,
     отбор, работа агента над разбором и отдельная позиция банка. Сцены листаются сами, есть пауза и стрелки. */
  const how = $('#aHow'), howStage = $('#aHowStage'), howProg = $('#aHowProg');
  const HOW_MS = 7500;
  const H = { i: 0, el: 0, last: 0, raf: 0, paused: false, prof: null, kb: null };
  const howKey = () => `alfi:how:${S.me ? S.me.uid + ':' + S.me.role : ''}`;
  const SOURCES = ['Интерфакс', 'Коммерсантъ', 'Ведомости', 'ЦБ РФ', 'ТАСС', 'РБК', 'Лента', 'Финам', 'Банки.ру', 'Frank Media', 'Retail.ru', 'Exa · поиск'];
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
      t: 'Альфи сам читает новости', x: () => `Раз в ${S.feed.ingest_interval_min || 60} минут сервис забирает свежие новости из лент деловых СМИ и ЦБ и добирает поиском Exa. Одинаковые новости из разных изданий склеиваются в одно событие, поэтому ничего не нужно искать и вводить вручную.`,
      v: () => `<div class="hv-src">
          <div class="hv-src__cloud">${SOURCES.map((s, i) => `<span style="--i:${i}">${esc(s)}</span>`).join('')}</div>
          <div class="hv-flow" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="hv-num"><b data-to="${S.feed.stats.scanned}">0</b><span>новостей за ${S.feed.stats.days} ${plural(S.feed.stats.days, 'день', 'дня', 'дней')} из ${S.feed.stats.sources} источников</span></div>
          <div class="hv-flow" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="hv-num"><b data-to="${S.feed.stats.events}">0</b><span>событий после склейки дублей</span></div>
        </div>`
    },
    {
      t: 'Понимает вашу компанию', x: () => 'Из данных банка Альфи собирает профиль: ОКВЭД, выручка, регион, ВЭД, продукты банка, поставщики и покупатели из платежей, группа компаний. Из профиля правилами считается, к чему бизнес чувствителен: ставка, курс, сырьё, спрос и другие факторы.',
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
      t: 'ИИ собирает команду под ваши задачи', ms: 15000, wide: true,
      x: () => {
        const T = S.team, ai = T.picked_by === 'ai' && T.ai;
        if (T.selecting) return 'Модель смотрит на профиль компании и вашу роль и выбирает, какие помощники дадут самый полезный сигнал. Это занимает несколько секунд.';
        return ai ? `Правила предложили ${T.members.length + (T.available || []).length} кандидатов с весами по данным компании. ИИ выбрал ${T.members.length} под роль «${esc(S.me.role_label)}» и написала каждому, за что он отвечает. ${esc(T.ai.summary || '')}`
          : `Помощники подобраны по весам из данных компании и роли «${esc(S.me.role_label)}».${T.picked_by === 'custom' ? ' Состав вы меняли вручную.' : ''}`;
      },
      v: () => {
        const T = S.team, ids = T.members.map((m) => m.id), skip = (T.ai && T.ai.skipped) || {};
        const pool = [...T.members, ...(T.available || [])].filter((m) => !String(m.id).startsWith('own-')).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 8);
        const max = Math.max(...pool.map((m) => m.weight || 0), 0.01);
        return `<div class="hv-ai${T.selecting ? ' is-wait' : ''}">
          <div class="hv-ai__brain"><span class="hv-ava" data-hk="alfi"></span><div><b>${T.selecting ? 'ИИ выбирает помощников…' : T.picked_by === 'ai' ? 'Команду выбрал ИИ' : 'Выбрано по данным компании'}</b><span>${esc(S.me.company.title.split(' · ')[0])} · ${esc(S.me.role_label)}</span></div><i class="hv-ai__scan" aria-hidden="true"></i></div>
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
      t: 'Оставляет только то, что касается вас', x: () => `Каждое событие получает оценку связи с компанией: отрасль, факторы чувствительности, география, значимость, свежесть, доверие к источнику. Затем модель уточняет, какие сферы бизнеса оно задевает. Из ${fmt(S.feed.stats.scanned)} новостей в ленте осталось ${S.feed.stats.picked}.`,
      v: () => {
        const st = S.feed.stats, max = Math.log10(st.scanned + 1);
        const rows = [[st.scanned, 'прочитано'], [st.events, 'событий'], [st.business, 'про экономику и бизнес'], [st.picked, 'про вашу компанию']];
        const top = S.items[0];
        return `<div class="hv-fun">
          <div class="hv-fun__rows">${rows.map(([n, l], i) => `<p style="--i:${i};--w:${Math.max(14, Math.log10(n + 1) / max * 100)}%" class="${i === 3 ? 'is-you' : ''}"><i></i><b data-to="${n}">0</b><span>${l}</span></p>`).join('')}</div>
          ${top ? `<div class="hv-ex"><p class="hv-ex__k"><span class="c-kind is-${kindOf(top)}">${KIND[kindOf(top)]}</span>связь ${top.relevance} из 100 · ${esc(agentOf(top.helper).name)}</p><b>${esc(cut(top.headline || top.title, 90))}</b>
            <div class="hv-ex__r">${(top.reasons || []).slice(0, 3).map((r, i) => `<span style="--i:${i}">${esc(r.text)}</span>`).join('')}</div>
            ${(top.areas || []).length ? `<div class="hv-ex__a">${top.areas.slice(0, 3).map((a) => `<span class="c-area ${IMPACT[a.impact] || ''}"><i></i>${esc(a.label)}</span>`).join('')}</div>` : ''}</div>` : ''}
        </div>`;
      }
    },
    {
      t: 'Разбирает событие как аналитик', x: () => 'Агент составляет план и сам вызывает инструменты: аналитику банка, контрагентов, группу, поиск. Потом пишет разбор, проверяет его 9 правилами и отдаёт независимому критику, другой модели ИИ. Если критик нашёл слабое место, агент дорабатывает.',
      v: () => `<div class="hv-pipe">
          <ol>${['Контекст', 'План', 'Инструменты', 'Черновик', '9 правил', 'Критик', 'Доработка', 'Готово'].map((s, i) => `<li style="--i:${i}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>
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
    $('#aHowNext').textContent = H.i === SCENES.length - 1 ? 'Показать находки' : 'Дальше';
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
    const loads = [];
    if (!H.prof || H.prof.uid !== S.me.uid) loads.push(API.get('/api/profile').then((p) => { H.prof = p; }).catch(() => {}));
    if (!H.kb) loads.push(API.get('/api/kb/docs').then((d) => { H.kb = { docs: (d.items || []).length }; }).catch(() => {}));
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]);
    howStage.innerHTML = '';
    if (!how.open) how.showModal();
    setPause(!!reduce);
    howShow(start);
    cancelAnimationFrame(H.raf); H.last = 0; H.raf = requestAnimationFrame(howTick);
    if (S.team.selecting) waitTeam();
  }
  async function waitTeam() {
    for (let i = 0; i < 20 && S.team.selecting; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try { const t = await API.get('/api/team'); if (!t.selecting) { setTeam(t); renderTeam(); if (how.open && H.i === 2) howShow(2); loadFeed(true); } } catch (_) { return; }
    }
  }
  how.addEventListener('close', () => { cancelAnimationFrame(H.raf); try { localStorage.setItem(howKey(), '1'); } catch (_) {} });
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

  /* ---------- Чат: сцена с командой переезжает в панель чата ---------- */
  const chat = $('#aChat'), log = $('#aLog');
  const chatTitle = $('#aChatTitle'), chatSt = $('#aChatSt'), chatAva = $('#aChatAva');
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
  function moving(anim, ms) {
    moveAnim = anim;
    chat.classList.add('is-moving');
    if (scene && scene.hold) scene.hold(ms);
    anim.finished.catch(() => {}).then(() => { if (moveAnim === anim) { chat.classList.remove('is-moving'); moveAnim = null; } });
  }
  function openShell() {
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
    moving(sideEl.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: dur(MOVE_MS), easing: EASE }), dur(MOVE_MS) + 40);
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
    await closing;
    closing = null;
    undock();
    anims.forEach((a) => a.cancel());
    chat.close();
    chat.classList.remove('is-closing');
  }
  chat.addEventListener('close', undock);
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
  const KIND_T = { news: 'Новость', bank: 'Аналитика Альфа-Банка', web: 'Интернет', feat: 'Признак компании', data: 'Данные банка о компании' };
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
      return `<button class="c-ref${bank ? ' is-bank' : ''}" type="button" data-ref="${scope}-${ns[0]}" title="${esc(real.map((id) => refLabel(id, refs[id])).join(', '))}">${label}</button>`;
    };
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(?:\s*\[(?:news|bank|web|feat|data):[^\]\s]+\])+/g, (m) => {
        const ids = [...m.matchAll(/\[((?:news|bank|web|feat|data):[^\]\s]+)\]/g)].map((x) => x[1].replace(/&amp;/g, '&'));
        const g = group(ids); return g ? ' ' + g : '';
      })
      .replace(/^(Альфа-Банк|Позиция банка):/, '<b class="c-bankline">$1:</b>')
      .replace(/^(Вывод AI|Вывод Альфи|По оценке AI):?/, '<b>$1:</b>');
    const out = []; let list = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) list = []; list.push(`<li>${inline(m[1])}</li>`); continue; }
      if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
      if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
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
  const agentStatus = (a) => (a.all ? 'Все темы и аналитика банка' : a.watch);
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
    const p = pane(a);
    if (p.dataset.loaded) return;
    p.dataset.loaded = '1';
    try {
      const h = await API.get('/api/chat' + (a.all ? '' : '?helper=' + encodeURIComponent(a.id)));
      for (const m of h.items || []) {
        if (m.role === 'user') me(String(m.content || ''), p);
        else bot(answerHTML(String(m.content || '').replace(REF_RX, ''), {}), p);
      }
      if ((h.items || []).length) p.insertAdjacentHTML('beforeend', '<p class="c-sep">Раньше в этой переписке</p>');
    } catch (_) {}
    if (!p.children.length) {
      bot(a.all
        ? `<p>Я знаю профиль «${esc(S.me ? S.me.company.title : 'компании')}»: отрасль, ВЭД, продукты банка, контрагентов и группу. Спросите, как событие повлияет на бизнес, и я отвечу со ссылками на новости и аналитику Альфа-Банка.</p>`
        : `<p>Я <b>${esc(a.name)}</b>. ${a.task ? `Отвечаю за: ${esc(a.task)}.` : `Слежу за темой: ${esc(a.watch)}.`}</p>${a.why_ai || a.why ? `<p class="c-meta">В команде, потому что ${esc((a.why_ai || a.why).replace(/^./, (c) => c.toLowerCase()))}</p>` : ''}`, p);
    }
    if (p === pane(chatAgent)) scrollLog();
  }
  function openChat(person, ctxId) {
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
    if (!chat.open) openShell();
    loadHistory(chatAgent);
    scrollLog();
    setTimeout(() => $('#aChatInput').focus({ preventScroll: true }), reduce ? 0 : 380);
  }
  function say(q) {
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
    // helper берём из панели, а не из текущего chatAgent: иначе ответ уедет в чужой чат
    const helperId = p.dataset.pane === 'alfi' ? null : p.dataset.pane;
    const run = API.stream('/api/chat', { method: 'POST', body: { message: q, news_id: S.chatCtx || null, helper: helperId }, onEvent: (type, ev) => {
      const d = ev.data || {};
      if (type === 'tool' && tl()) { used.push(toolT(d.tool)); tl().textContent = 'Смотрю: ' + used.join(', '); }
      else if (type === 'guard' && tl()) tl().textContent = ev.title + (d.text ? `. ${d.text}` : '');
      else if (type === 'final') {
        b.innerHTML = answerHTML(d.text, d.refs) + '';
        if (p.hidden) toast(`${a.name} ответил`);
      } else if (type === 'error') b.innerHTML = `<p class="c-err">Не получилось ответить: ${esc(d.message || ev.title)}. Попробуйте ещё раз.</p>`;
      follow();
    } });
    runs.set(id, run);
    run.done.catch((e) => { b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }).finally(() => { runs.delete(id); follow(); });
  }
  chat.addEventListener('click', (e) => {
    if (e.target === chat || e.target.closest('.a-chat__x')) { closeChat(); return; }
    if (e.target.closest('[data-ctx-clear]')) { S.chatCtx = null; paintSugg(); }
  });
  $('#aChatClear').addEventListener('click', async () => {
    const a = chatAgent, p = pane(a);
    try { await API.del('/api/chat' + (a.all ? '' : '?helper=' + encodeURIComponent(a.id))); } catch (_) {}
    p.innerHTML = ''; delete p.dataset.loaded; loadHistory(a);
  });
  $('#aChatForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#aChatInput').value.trim(); if (v) { say(v); $('#aChatInput').value = ''; } });
  $('#aFab').addEventListener('click', () => openChat(agentOf(S.cat)));
  new IntersectionObserver(([e]) => { $('#aFab').hidden = e.isIntersecting; }, { threshold: 0.15 }).observe(stageEl);

  /* ---------- Разбор события ----------
     Пока агент работает: шесть этапов с таймером, по каждому видно, что он сделал.
     Готовый разбор: сводка с уверенностью и тремя главными пунктами, навигация по разделам,
     у каждого пункта пометка, чей это вывод, и источники, которые открываются карточкой рядом. */
  const ins = $('#aIns'), insBody = $('#aInsBody'), insFoot = $('#aInsFoot'), rPop = $('#rPop');
  let insId = null, insTimer = 0, spy = null;
  const STAGES = [
    ['Контекст', 'профиль компании и источники события'],
    ['План', 'гипотесы и какие инструменты вызвать'],
    ['Данные', 'аналитика банка, контрагенты, новости'],
    ['Разбор', 'модель пишет черновик'],
    ['Перепроверка', 'автоматически, до показа вам'],
    ['Готово', 'разбор с источниками']
  ];
  const stageOf = (t) => ({ context: 0, plan: 1, tool: 2, check: 2, llm: 3, verify: 4, critic: 4, repair: 4, final: 5 })[t];
  const txt = (x) => (typeof x === 'string' ? x : x && (x.text || x.title || x.name || x.question || x.gap) || '');
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const brief = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(brief).filter(Boolean).join(', ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${brief(x)}`).join('; ') : String(v));
  const factorT = (f) => (S.meta && S.meta.factors && S.meta.factors[f] ? S.meta.factors[f].label : f);
  const CRIT_T = { grounding: 'опора на источники', personalization: 'персонализация', depth: 'глубина', attribution: 'атрибуция' };
  const sec1 = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' с';

  // Одна строка шага агента: заголовок и короткая выжимка того, что он сделал
  function stepHTML(ev) {
    const d = ev.data || {}, t = ev.type;
    let body = '';
    if (t === 'context') body = `${esc(d.company)} · ${esc(d.role)}. Источников события: ${d.sources}, признаков компании: ${d.features}${(d.reasons || []).length ? `<span class="tr-chips">${d.reasons.slice(0, 4).map((r) => `<span>${esc(r.text)}</span>`).join('')}</span>` : ''}`;
    else if (t === 'plan') body = `${d.goal ? esc(d.goal) : ''}${(d.hypotheses || []).length ? `<ul>${d.hypotheses.map((h) => `<li>${esc(txt(h))}</li>`).join('')}</ul>` : ''}${(d.steps || []).length ? `<span class="tr-chips">${d.steps.map((s) => `<span title="${esc(s.why || '')}">${esc(toolT(s.tool))}</span>`).join('')}</span>` : ''}`;
    else if (t === 'tool') body = `<b>${esc(toolT(d.tool))}</b>${d.n != null ? ` · найдено ${d.n}` : ''}${d.ms ? ` · ${sec1(d.ms)}` : ''}${d.summary ? `<small>${esc(cut(d.summary, 180))}</small>` : ''}`;
    else if (t === 'check') body = `<ul class="tr-checks">${(d.checks || []).map((c) => `<li class="${c.ok ? 'is-ok' : 'is-no'}">${esc(c.text)}</li>`).join('')}</ul>`;
    else if (t === 'llm') body = d.tokens ? `${fmt(d.tokens)} токенов` : '';
    else if (t === 'verify') body = `${d.passed} из ${d.total} правил${d.after_repair ? ' после доработки' : ''}${(d.rules || []).some((r) => !r.ok) ? `<ul class="tr-checks">${d.rules.filter((r) => !r.ok).map((r) => `<li class="is-no">${esc(r.name)}</li>`).join('')}</ul>` : ''}`;
    else if (t === 'critic') body = `${d.verdict === 'ok' || d.verdict === 'pass' ? 'Принято' : 'Просит доработать'} · ${Object.entries(d.scores || {}).map(([k, v]) => `${CRIT_T[k] || k} ${pct(v)}`).join(', ')}${(d.issues || []).length ? `<ul>${d.issues.slice(0, 2).map((i) => `<li>${esc(cut(i.problem, 150))}</li>`).join('')}</ul>` : ''}`;
    else if (t === 'repair') body = `Исправлено полей: ${Array.isArray(d.changed) ? d.changed.length : d.changed || 0}${d.added ? `, добавлено источников: ${d.added}` : ''}`;
    else if (t === 'guard') body = esc(d.text || '');
    else if (t === 'error') body = esc(d.message || '');
    else if (t === 'final') body = d.cached ? 'Взят готовый разбор' : 'Разбор собран';
    return `<li class="tr-i is-${esc(t)}"><span class="tr-i__dot" aria-hidden="true"></span><div><p class="tr-i__t">${esc(ev.title)}${ev.ms > 200 ? `<small>${sec1(ev.ms)}</small>` : ''}</p>${body ? `<div class="tr-i__b">${body}</div>` : ''}</div></li>`;
  }

  /* --- Пока агент работает --- */
  function runSkeleton(id) {
    const it = byId(id), mate = agentOf(it && it.helper);
    insBody.innerHTML = `<div class="r-run" data-run="${esc(id)}">
      <div class="r-run__head">
        <span class="r-run__ava" data-rava></span>
        <div class="r-run__hd"><p class="r-run__t">${esc(mate.all ? 'Альфи' : mate.name)} разбирает событие для компании</p><p class="r-run__s"><span data-rt>0 с</span> · обычно меньше минуты</p></div>
      </div>
      <div class="r-bar"><i data-rbar></i></div>
      <ol class="r-steps">${STAGES.map(([t, s], i) => `<li class="r-st" data-st="${i}"><span class="r-st__ic" aria-hidden="true"><b>${i + 1}</b></span><div class="r-st__b"><p class="r-st__t">${t}</p><p class="r-st__s">${s}</p><ol class="r-st__log"></ol></div></li>`).join('')}</ol>
      <div class="r-run__msg" data-rmsg hidden></div>
    </div>`;
    mount(insBody.querySelector('[data-rava]'), mate.kind, 128);
  }
  function runUpdate(id) {
    const R = S.runs[id], box = insBody.querySelector(`.r-run[data-run="${CSS.escape(id)}"]`);
    if (!R || !box) return;
    const shown = +(box.dataset.n || 0);
    for (const ev of R.steps.slice(shown)) {
      const k = stageOf(ev.type) ?? (+(box.dataset.cur || 0));
      // журнал шагов не показываем: этап, таймер и прогресс говорят достаточно
      if (stageOf(ev.type) != null) box.dataset.cur = stageOf(ev.type);
    }
    box.dataset.n = R.steps.length;
    const cur = R.result ? 5 : +(box.dataset.cur || 0);
    $$('.r-st', box).forEach((li, i) => {
      li.classList.toggle('is-done', i < cur || (R.result && i === 5));
      li.classList.toggle('is-on', i === cur && !R.result && !R.error && !R.held);
      li.classList.toggle('is-err', i === cur && !!R.error);
    });
    box.querySelector('[data-rbar]').style.width = (R.result ? 100 : Math.min(94, 8 + cur * 17 + R.steps.length)) + '%';
    const msg = box.querySelector('[data-rmsg]');
    if (R.error) { msg.hidden = false; msg.innerHTML = `<p class="c-err">Разбор прервался: ${esc(R.error)}</p><button class="btn btn--primary" type="button" data-ins-redo>Попробовать ещё раз</button>`; }
    else if (R.held) { msg.hidden = false; msg.innerHTML = '<p class="i-small">Дневной бюджет на глубокие разборы исчерпан. Лента и готовые разборы работают, новый можно будет собрать после 00:00 UTC.</p>'; }
  }
  function runTimer(id) {
    clearInterval(insTimer);
    const t0 = (S.runs[id] && S.runs[id].t0) || Date.now();
    const tick = () => { const el = insBody.querySelector('[data-rt]'); if (!el || !S.runs[id] || S.runs[id].done) { clearInterval(insTimer); return; } el.textContent = Math.round((Date.now() - t0) / 1000) + ' с'; };
    tick(); insTimer = setInterval(tick, 1000);
  }

  /* --- Готовый разбор ---
     Меньше служебных меток: источники стоят маленькими номерами в конце пункта, как сноски,
     а пометка «Альфа-Банк» есть только у пунктов из аналитики банка. Без пометки — вывод Альфи. */
  const BASIS = { bank: ['is-bank', 'Альфа-Банк'], 'bank+ai': ['is-mix', 'Банк + вывод Альфи'], ai: ['is-ai', 'Вывод Альфи'] };
  const basis = (b) => { const x = BASIS[b] || BASIS.ai; return `<span class="i-basis ${x[0]}">${x[1]}</span>`; };
  let SRC = {}, SRC_N = [];
  const srcNum = (id) => { let i = SRC_N.indexOf(id); if (i < 0) { SRC_N.push(id); i = SRC_N.length - 1; } return i + 1; };
  function chips(ids) {
    const list = arr(ids).filter((id) => SRC[id]);
    return list.length ? `<span class="r-refs">${list.map((id) => `<button type="button" class="r-ref is-${esc(id.split(':')[0])}" data-pop="${esc(id)}" aria-label="Источник: ${esc(refLabel(id, SRC[id]))}">${srcNum(id)}</button>`).join('')}</span>` : '';
  }
  const PROB = { high: 'высокая', medium: 'средняя', low: 'низкая' };
  const URG = { now: 'сейчас', week: 'на неделе', month: 'в течение месяца', quarter: 'в квартале' };
  const STATUS = { reported: ['is-mid', 'сообщают'], unconfirmed: ['is-no', 'не подтверждено'], expected: ['is-mid', 'ожидается'] };
  const areaImpact = (a) => a.impact || ({ up: 'positive', down: 'negative', mixed: 'mixed' })[a.direction] || '';
  const bankTag = (x) => (x.basis === 'bank' || x.basis === 'bank+ai' ? `<span class="r-bk">${x.basis === 'bank' ? 'Альфа-Банк' : 'банк + Альфи'}</span>` : '');
  const meta = (x, extra = '') => (extra || bankTag(x) ? `<p class="r-m">${extra}${bankTag(x)}</p>` : '');
  const tx = (x) => `${esc(x.text || x.explanation || x.effect || '')}${chips(x.sources)}`;
  const NAV = [['r-sum', 'Коротко'], ['r-imp', 'Влияние'], ['r-bank', 'Альфа-Банк'], ['r-act', 'Что делать'], ['r-what', 'Факты'], ['r-src', 'Источники']];

  function docHTML(r) {
    SRC = r.sources || {}; SRC_N = [];
    const m = r.meta || {}, w = r.what_happened || {}, bv = r.bank_view || {};
    const conf = Math.round((r.confidence || 0) * 100), rules = r.rules || [], okR = rules.filter((x) => x.ok).length;
    const risks = arr(r.risks), opps = arr(r.opportunities), acts = arr(r.actions), facts = arr(w.facts);
    const C = 2 * Math.PI * 34, crit = r.critic;
    const tile = (cls, label, x, go) => x ? `<button type="button" class="r-tl ${cls}" data-jump="${go}"><span class="r-tl__k">${label}</span><b>${esc(cut(x.title || x.text, 90))}</b></button>` : '';
    const sec = (id, title, body, cls = '') => `<section class="r-sec ${cls}" id="${id}" data-spy>${title ? `<h4 class="r-h">${title}</h4>` : ''}${body}</section>`;
    const card = (x, cls, extra) => `<li class="r-card ${cls}">${x.title ? `<p class="r-card__t">${esc(x.title)}</p>` : ''}<p>${tx(x)}</p>${meta(x, extra)}</li>`;
    // разделы собираются по порядку чтения: так номера источников растут сверху вниз
    const sum = sec('r-sum', '', `
        <div class="r-sum__top">
          <div class="r-sum__hd">
            <p class="r-sum__k"><span class="c-kind is-${esc(KIND[r.kind] ? r.kind : 'neutral')}">${KIND[r.kind] || 'К сведению'}</span><span>для роли «${esc(m.role || (S.me && S.me.role_label) || '')}»</span></p>
            <h3 class="r-sum__t">${esc(r.headline)}</h3>
            <p class="r-sum__w" data-clamp>${esc(txt(r.why_it_matters))}</p>
          </div>
          <div class="r-ring" title="Уверенность учитывает оценку модели, правила, критика и полноту данных">
            <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="r-ring__bg"/><circle cx="40" cy="40" r="34" class="r-ring__fg" style="stroke-dasharray:${C.toFixed(1)};--off:${(C * (1 - conf / 100)).toFixed(1)};--full:${C.toFixed(1)}"/></svg>
            <b>${conf}<small>%</small></b><span>уверенность</span>
          </div>
        </div>
        <div class="r-tls">${tile('is-risk', 'Главный риск', risks[0], 'r-imp')}${tile('is-chance', 'Главная возможность', opps[0], 'r-imp')}${tile('is-act', 'Первый шаг', acts[0], 'r-act')}</div>
        <div class="r-ok">
          <button type="button" class="r-badge ${okR === rules.length ? 'is-ok' : 'is-warn'}" data-checks aria-expanded="false">
            <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 5 6.3v5.2c0 4.3 2.9 7.7 7 9 4.1-1.3 7-4.7 7-9V6.3Z" fill="currentColor" opacity=".15"/><path d="M12 3.5 5 6.3v5.2c0 4.3 2.9 7.7 7 9 4.1-1.3 7-4.7 7-9V6.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m8.8 12.2 2.2 2.2 4.4-4.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${okR === rules.length ? 'Перепроверено' : 'Перепроверено, есть оговорки'}
          </button>
          <span class="r-ok__s">${m.sources_used ?? Object.keys(SRC).length} ${plural(m.sources_used ?? Object.keys(SRC).length, 'источник', 'источника', 'источников')}</span>
        </div>
        <div class="r-checks" hidden>
          <p class="i-small">Разбор прошёл ${okR} из ${rules.length} автоматических проверок${crit ? ' и независимую проверку другой моделью ИИ' : ''}.</p>
          <ul class="r-rules">${rules.map((x) => `<li class="${x.ok ? 'is-ok' : 'is-no'}" title="${esc(x.detail)}"><i aria-hidden="true">${x.ok ? '✓' : '!'}</i>${esc(x.name)}</li>`).join('')}</ul>
        </div>`, 'r-sum');
    const imp = sec('r-imp', 'Что это меняет для компании', `
        ${arr(r.affected_areas).length ? `<ul class="r-areas">${arr(r.affected_areas).map((a) => `<li class="r-area ${IMPACT[areaImpact(a)] || ''}"><p class="r-area__h"><i aria-hidden="true"></i><b>${esc(a.label || a.area)}</b><span>${IMPACT_T[areaImpact(a)] || ''}</span></p><p>${tx(a)}</p>${meta(a)}</li>`).join('')}</ul>` : ''}
        <div class="r-two">
          <div><p class="r-sub r-sub--risk">Риски</p>${risks.length ? `<ul class="r-cards">${risks.map((x) => card(x, 'is-risk', x.probability ? `<span class="r-p">вероятность ${PROB[x.probability] || esc(x.probability)}${x.horizon ? `, ${esc(x.horizon)}` : ''}</span>` : '')).join('')}</ul>` : '<p class="i-small">Существенных рисков не найдено</p>'}</div>
          <div><p class="r-sub r-sub--chance">Возможности</p>${opps.length ? `<ul class="r-cards">${opps.map((x) => card(x, 'is-chance', x.horizon ? `<span class="r-p">${esc(x.horizon)}</span>` : '')).join('')}</ul>` : '<p class="i-small">Явных возможностей не найдено</p>'}</div>
        </div>
        ${arr(r.impact_channels).length ? `<details class="r-more"><summary>Через какие факторы · ${arr(r.impact_channels).length}</summary><ul class="r-ch">${arr(r.impact_channels).map((c) => `<li><span class="r-ch__f ${c.direction === 'up' ? 'is-up' : c.direction === 'down' ? 'is-down' : ''}">${esc(factorT(c.factor))}<i>${c.direction === 'up' ? '↑' : c.direction === 'down' ? '↓' : '↕'}</i></span><p>${tx(c)}</p></li>`).join('')}</ul></details>` : ''}
        ${arr(r.scenarios).length ? `<details class="r-more"><summary>Сценарии · ${arr(r.scenarios).length}</summary><ul class="r-scen">${arr(r.scenarios).map((x) => { const n = String(x.name || x.title || '').toLowerCase(); const k = /негат|пессим|плох/.test(n) ? 'is-neg' : /позит|оптим|хорош/.test(n) ? 'is-pos' : 'is-base'; return `<li class="${k}"><b>${esc(x.name || x.title)}</b><p>${tx(x)}</p>${x.trigger ? `<p class="i-small">Признак: ${esc(x.trigger)}</p>` : ''}</li>`; }).join('')}</ul></details>` : ''}`);
    const bank = sec('r-bank', '', `
        <div class="r-bank__h"><span class="r-bank__ic"><svg class="ic"><use href="#i-bank"/></svg></span><div><h4 class="r-h">Позиция Альфа-Банка</h4><p class="i-small">Из аналитики банка, отдельно от выводов Альфи</p></div></div>
        ${bv.summary ? `<p class="i-lead">${esc(bv.summary)}</p>` : ''}
        ${arr(bv.points).length ? `<ul class="r-bank__l">${arr(bv.points).map((x) => `<li>${tx(x)}${x.support != null && x.support < 0.3 ? ' <span class="r-p">пересказ тезиса</span>' : ''}</li>`).join('')}</ul>` : `<p class="i-small">${esc(brief(bv.coverage) || 'По этой теме в аналитике банка прямых материалов нет')}</p>`}`, 'r-bank');
    const qs = [...arr(r.questions).map(txt), ...arr(r.data_gaps).map(txt)].filter(Boolean);
    const act = sec('r-act', 'Что делать', `
        ${acts.length ? `<ol class="r-acts">${acts.map((x, i) => `<li><span class="r-acts__n">${i + 1}</span><div>${x.title ? `<p class="r-card__t">${esc(x.title)}</p>` : ''}<p>${tx(x)}</p>${meta(x, [x.urgency ? `<span class="r-p ${x.urgency === 'now' ? 'is-now' : ''}">${URG[x.urgency] || esc(x.urgency)}</span>` : '', x.owner ? `<span class="r-p">${esc(x.owner)}</span>` : '', x.product ? `<span class="r-p is-prod">${esc(x.product)}</span>` : ''].join(''))}</div></li>`).join('')}</ol>` : '<p class="i-small">Действий не требуется</p>'}
        ${qs.length ? `<details class="r-more"><summary>Что уточнить внутри компании · ${qs.length}</summary><ul class="i-plain">${qs.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}`);
    const what = sec('r-what', 'Что случилось', `
        ${w.summary ? `<p class="i-lead">${esc(w.summary)}</p>` : ''}
        ${facts.length ? `<ul class="r-facts">${facts.map((f) => { const st = STATUS[f.status]; return `<li>${tx(f)}${st ? ` <span class="r-p ${st[0]}">${st[1]}</span>` : ''}</li>`; }).join('')}</ul>` : ''}
        ${w.timing ? `<p class="i-small"><b>Сроки:</b> ${esc(brief(w.timing))}</p>` : ''}`);
    // источники, которые не встретились в тексте, идут в конец списка
    Object.keys(SRC).forEach(srcNum);
    const src = sec('r-src', `Источники · ${SRC_N.length}`, `
        <ol class="r-srcs">${SRC_N.map((id, i) => { const x = SRC[id], k = id.split(':')[0]; return `<li><button type="button" class="r-src is-${esc(k)}" data-pop="${esc(id)}"><span class="r-src__n">${i + 1}</span><span class="r-src__b"><b>${esc(cut(x.title || id, 90))}</b><span>${esc(KIND_T[k] || k)}${k === 'bank' ? (x.verified ? ' · цитата сверена с PDF' : ' · цитата не найдена') : ''}</span></span></button></li>`; }).join('')}</ol>`);
    return `<nav class="r-nav" aria-label="Разделы разбора">${NAV.map(([id, l], i) => `<button type="button" data-jump="${id}" class="${i === 0 ? 'is-on' : ''}">${l}</button>`).join('')}</nav>` + sum + imp + bank + act + what + src;
  }
  function footHTML() {
    return `<button class="btn btn--primary" type="button" data-ins-chat><svg class="ic ic--sm"><use href="#i-spark"/></svg>Спросить про разбор</button>
      <button class="btn btn--ghost" type="button" data-ins-redo><svg class="ic ic--sm"><use href="#i-refresh"/></svg>Пересобрать</button>
      <span class="r-rate" data-rate-box>Разбор полезен?<button class="f-lnk" type="button" data-rate="5">Да</button><button class="f-lnk" type="button" data-rate="1">Нет</button></span>`;
  }
  function showDoc(id, animate) {
    const R = S.runs[id];
    hidePop();
    insBody.innerHTML = `<div class="r-doc">${docHTML(R.result)}</div>`;
    insBody.scrollTop = 0;
    insFoot.hidden = false; insFoot.innerHTML = footHTML();
    $$('[data-clamp]', insBody).forEach((p) => {
      if (p.scrollHeight > p.clientHeight + 4) { const b = document.createElement('button'); b.type = 'button'; b.className = 'r-lnk r-clampbtn'; b.textContent = 'Подробнее'; b.onclick = () => { p.removeAttribute('data-clamp'); b.remove(); }; p.after(b); }
    });
    const ring = insBody.querySelector('.r-ring__fg');
    if (ring) { ring.style.strokeDashoffset = ring.style.getPropertyValue('--full'); requestAnimationFrame(() => requestAnimationFrame(() => { ring.style.strokeDashoffset = ring.style.getPropertyValue('--off'); })); }
    if (animate && !reduce) $$('.r-sec', insBody).forEach((s, i) => s.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60 + i * 70, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' }));
    // Подсветка раздела в навигации по мере прокрутки
    if (spy) spy.disconnect();
    const nav = insBody.querySelector('.r-nav');
    spy = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!vis || !nav) return;
      nav.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.jump === vis.target.id));
      const on = nav.querySelector('.is-on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, { root: insBody, rootMargin: '-64px 0px -60% 0px' });
    $$('[data-spy]', insBody).forEach((s) => spy.observe(s));
  }
  async function loadTrace(box) {
    const R = S.runs[insId], body = box.querySelector('.r-trace');
    if (body.dataset.done) return;
    body.dataset.done = '1';
    if (R && R.steps.length > 1) { body.innerHTML = `<ol class="tr">${R.steps.map(stepHTML).join('')}</ol>`; return; }
    const runId = R && R.result && R.result.meta && R.result.meta.run_id;
    if (!runId) { body.innerHTML = '<p class="i-small">Шаги этого разбора не сохранились</p>'; return; }
    body.innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Загружаю шаги…</p>';
    try {
      const t = await API.get(`/api/runs/${encodeURIComponent(runId)}/trace`);
      body.innerHTML = `<ol class="tr">${(t.steps || []).map(stepHTML).join('')}</ol>`;
    } catch (e) { body.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }
  }

  /* --- Карточка источника рядом с чипом --- */
  function showPop(btn, id) {
    const s = SRC[id]; if (!s) return;
    const k = id.split(':')[0], url = safeUrl(s.url);
    rPop.innerHTML = `<p class="r-pop__k is-${esc(k)}">${KIND_T[k] || k}${k === 'bank' ? (s.verified ? ' · цитата сверена с PDF' : ' · цитата не найдена в PDF') : ''}${s.stale ? ' · материал устарел' : ''}</p>
      <p class="r-pop__t">${esc(s.title || id)}</p>
      ${s.quote ? `<q>${esc(cut(s.quote, 320))}</q>` : s.text ? `<p class="r-pop__x">${esc(cut(s.text, 320))}</p>` : ''}
      <p class="r-pop__f"><code>${esc(id)}</code>${url ? `<a class="btn btn--secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${k === 'bank' ? 'Открыть PDF' : 'Открыть'}<svg class="ic ic--sm"><use href="#i-ext"/></svg></a>` : ''}</p>`;
    rPop.hidden = false;
    const r = btn.getBoundingClientRect(), d = ins.getBoundingClientRect(), pw = Math.min(380, d.width - 24);
    rPop.style.width = pw + 'px';
    const left = Math.max(12, Math.min(r.left - d.left, d.width - pw - 12));
    const below = r.bottom - d.top + 8, ph = rPop.offsetHeight;
    rPop.style.left = left + 'px';
    rPop.style.top = (below + ph > d.height - 12 ? Math.max(12, r.top - d.top - ph - 8) : below) + 'px';
    if (!reduce) rPop.animate([{ opacity: 0, transform: 'translateY(4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,.9,.3,1)' });
    rPop.dataset.for = id;
  }
  function hidePop() { if (!rPop.hidden) { rPop.hidden = true; rPop.dataset.for = ''; } }

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
      if (type === 'start' || type === 'end') return;
      if (type === 'final') { const d = ev.data || {}; if (d.result) R.result = d.result; else R.held = true; }
      else if (type === 'error') R.error = (ev.data && ev.data.message) || ev.title;
      R.steps.push(ev);
      paintRun(id);
    } });
    h.done.catch((e) => { R.error = R.error || e.message; }).finally(() => {
      R.done = true;
      if (R.result) { const it = byId(id); if (it && !it.has_insight) { it.has_insight = true; renderFeed(true); } }
      // небольшая пауза, чтобы было видно, что все этапы закрылись
      setTimeout(() => paintRun(id), R.result && !reduce ? 650 : 0);
      if (insId === id) runUpdate(id);
    });
  }
  async function openInsight(id, force) {
    const it = byId(id);
    insId = id; insBody.dataset.view = '';
    $('#aInsTitle').textContent = 'Разбор для компании';
    $('#aInsKicker').innerHTML = it ? `${esc(cut(it.title, 110))}${safeUrl(it.url) ? ` · <a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.source)}</a>` : ''}` : '';
    insFoot.hidden = true; hidePop();
    if (!ins.open) ins.showModal();
    const R = S.runs[id];
    if (!force && R && (!R.done || R.result)) { paintRun(id); return; }
    if (!force) {
      insBody.innerHTML = '<p class="tr-lead r-wait"><span class="f-spin" aria-hidden="true"></span>Ищу готовый разбор…</p>';
      try {
        const c = await API.get(`/api/insight/${encodeURIComponent(id)}`);
        if (c && c.cached !== false) { S.runs[id] = { steps: [], result: c, done: true }; paintRun(id); return; }
      } catch (e) { insBody.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; return; }
    }
    startRun(id, force);
    paintRun(id);
  }
  ins.addEventListener('close', () => { clearInterval(insTimer); hidePop(); if (spy) spy.disconnect(); });
  ins.addEventListener('cancel', (e) => { if (!rPop.hidden) { e.preventDefault(); hidePop(); } });
  insBody.addEventListener('scroll', hidePop, { passive: true });
  insBody.addEventListener('toggle', (e) => { if (e.target.matches('[data-trace]') && e.target.open) loadTrace(e.target); }, true);
  ins.addEventListener('click', async (e) => {
    let t;
    if ((t = e.target.closest('[data-pop]'))) { if (rPop.dataset.for === t.dataset.pop) hidePop(); else showPop(t, t.dataset.pop); return; }
    if (!e.target.closest('#rPop')) hidePop();
    if ((t = e.target.closest('[data-jump]'))) {
      const el = document.getElementById(t.dataset.jump);
      if (el) insBody.scrollTo({ top: el.offsetTop - 64, behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    if ((t = e.target.closest('[data-checks]'))) {
      const box = insBody.querySelector('.r-checks'); if (!box) return;
      box.hidden = !box.hidden; t.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden && !reduce) box.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
      return;
    }
    if (e.target.closest('[data-ins-redo]')) { openInsight(insId, true); return; }
    if (e.target.closest('[data-ins-chat]')) { const id = insId, it = byId(id); ins.close(); openChat(it ? agentOf(it.helper) : ALFI, id); return; }
    if ((t = e.target.closest('[data-rate]'))) {
      try { await API.post('/api/feedback', { news_id: insId, kind: 'rating', value: +t.dataset.rate }); } catch (_) {}
      const box = t.closest('[data-rate-box]'); if (box) box.textContent = +t.dataset.rate >= 4 ? 'Спасибо, учту' : 'Спасибо, отметка попадёт в метрики';
    }
  });

  /* ---------- Профиль компании: на чём строится персонализация ---------- */
  const bnum = (v) => (v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽' : v >= 1e6 ? Math.round(v / 1e6) + ' млн ₽' : fmt(v / 1e3) + ' тыс ₽');
  async function openProfile() {
    const d = $('#aProf'), b = $('#aProfBody');
    d.showModal();
    b.innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Собираю профиль…</p>';
    try {
      const p = await API.get('/api/profile');
      $('#aProfTitle').textContent = p.title;
      const cp = (x, title) => x && x.n ? `<section class="p-sec"><h4>${title}</h4>
        <p class="i-small">${x.n} ${plural(x.n, 'контрагент', 'контрагента', 'контрагентов')}, оборот ${bnum(x.total)}, крупнейший ${pct(x.top_share)}${x.intra_group ? `, внутри группы ${bnum(x.intra_group)}` : ''}${x.hhi != null ? ` · концентрация HHI ${String(x.hhi).replace('.', ',')}` : ''}</p>
        ${(x.sectors || []).filter((s) => s.share > 0.001).slice(0, 4).length ? `<div class="p-bars">${x.sectors.filter((s) => s.share > 0.001).slice(0, 4).map((s) => `<p><span>${esc(s.label)}</span><i style="--w:${Math.min(100, s.share * 100)}%"></i><b>${pct(s.share)}</b></p>`).join('')}</div>` : ''}
        ${(x.top || []).length ? `<ul class="p-top">${x.top.slice(0, 5).map((t) => `<li><code>${esc(t.uid)}</code><span>${esc(t.sector_label || t.okved || '')}${t.region ? ` · ${esc(t.region)}` : ''}${t.key_owner ? ' · общий собственник' : ''}</span><b>${pct(t.share)}</b></li>`).join('')}</ul>` : ''}
      </section>` : `<section class="p-sec"><h4>${title}</h4><p class="i-small">Нет платежей в данных</p></section>`;
      b.innerHTML = `
        <p class="i-lead">${esc(p.okved)} ${esc(p.okved_name)}</p>
        <section class="p-sec"><h4>Признаки компании</h4><p class="i-small">Каждый признак имеет код: на него ссылаются причины в ленте и пункты разбора</p>
          <ul class="p-feats">${(p.features || []).map((f) => `<li><span>${esc(f.label)}</span><b>${esc(f.value)}</b>${f.detail ? `<small>${esc(f.detail)}</small>` : ''}<code>${esc(f.id)}</code></li>`).join('')}</ul></section>
        <section class="p-sec"><h4>К чему чувствительна компания</h4><p class="i-small">Посчитано правилами из признаков, от 0 до 100%. Чем выше, тем больше вес новостей с этим фактором в ленте</p>
          <div class="p-bars">${(p.sensitivities || []).slice(0, 8).map((s) => `<p title="${esc((s.why || []).map((w) => w.text).join('; '))}"><span>${esc(s.label)}</span><i style="--w:${Math.min(100, s.value * 100)}%"></i><b>${pct(s.value)}</b></p>`).join('')}</div></section>
        ${p.position ? `<section class="p-sec"><h4>Место среди клиентов банка</h4><p class="i-small">${p.position.okved ? `По ОКВЭД: ${p.position.okved.rank} из ${p.position.okved.of}, доля ${pct(p.position.okved.share)}. ` : ''}${p.position.sector ? `По отрасли: ${p.position.sector.rank} из ${p.position.sector.of}. ` : ''}${esc(p.position.note || '')}</p></section>` : ''}
        ${p.group && p.group.n > 1 ? `<section class="p-sec"><h4>Группа компаний · ${p.group.n}</h4><p class="i-small">Выручка группы ${bnum(p.group.revenue)}</p>
          <ul class="p-top">${p.group.members.slice(0, 8).map((g) => `<li><code>${esc(g.uid)}</code><span>${esc(g.sector_label)} · ${esc(g.region || '')}${g.self ? ' · это вы' : ''}</span><b>${bnum(g.revenue)}</b></li>`).join('')}</ul></section>` : ''}
        <div class="i-two">${cp(p.suppliers, 'Поставщики')}${cp(p.customers, 'Покупатели')}</div>
        ${p.links && p.links.persons ? `<section class="p-sec"><h4>Связи через собственников</h4><p class="i-small">${p.links.persons} ${plural(p.links.persons, 'физлицо', 'физлица', 'физлиц')}, связанных компаний: ${(p.links.companies || []).length}</p></section>` : ''}
        ${/^U_TEST_/.test(p.uid) ? '<p class="i-small">Это тестовая компания из описания. Платежей, группы и связей у неё нет, поэтому часть разбора будет помечена как неполные данные.</p>' : ''}`;
    } catch (e) { b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }
  }

  /* ---------- Метрики качества ---------- */
  async function openMetrics() {
    const d = $('#aMet'), b = $('#aMetBody');
    d.showModal();
    b.innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Считаю метрики…</p>';
    try {
      const m = await API.get('/api/metrics');
      const c = m.content || {}, p = m.personalization || {}, a = m.ai || {}, cost = m.cost || {}, sec = m.security || {};
      const tile = (v, l, s = '') => `<li class="m-t"><b>${v}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</li>`;
      b.innerHTML = `
        <section class="p-sec"><h4>Новости и база знаний</h4><ul class="m-grid">
          ${tile(fmt(c.news_5d), 'новостей за 5 дней', `RSS ${fmt(c.rss)}, Exa ${fmt(c.exa)}`)}${tile(fmt(c.sources), 'источников')}${tile(fmt(c.events), 'событий после склейки', `дубли ${pct(c.dedup_ratio)}`)}
          ${tile(pct(c.business_share), 'про бизнес')}${tile(c.kb ? `${c.kb.docs} / ${c.kb.theses}` : '—', 'документов / тезисов банка', c.kb ? `цитаты сверены ${c.kb.verified} из ${c.kb.theses}` : '')}${tile(c.kb ? c.kb.forecasts : '—', 'прогнозов банка')}</ul></section>
        <section class="p-sec"><h4>Персонализация</h4><ul class="m-grid">
          ${tile(pct(p.feed_diversity), 'разница лент у компаний', 'доля различающихся топ-10 у 5 компаний')}${tile(pct(p.useful_rate), 'отмечено полезным')}${tile(fmt((p.feedback || {}).n), 'отметок обратной связи')}</ul></section>
        <section class="p-sec"><h4>Качество разборов</h4><ul class="m-grid">
          ${tile(fmt(a.insights), 'разборов')}${tile(pct(a.avg_confidence), 'средняя уверенность')}${tile(pct(a.rules_pass_rate), 'прошли все правила')}
          ${tile(pct(a.bank_view_coverage), 'с позицией банка')}${tile(pct(a.critic_revise_rate), 'критик просил доработку', a.critic ? Object.entries(a.critic).map(([k, v]) => `${CRIT_T[k] || k} ${pct(v)}`).join(', ') : '')}${tile(fmt(a.repair_runs), 'доработок')}</ul></section>
        <section class="p-sec"><h4>Бюджет и безопасность</h4><ul class="m-grid">
          ${tile(rub((cost.today || {}).spent_rub), 'потрачено сегодня', `мягкий лимит ${rub((cost.today || {}).soft_rub)}, жёсткий ${rub((cost.today || {}).hard_rub)}`)}
          ${tile(fmt((sec.tool_calls || {}).n), 'вызовов инструментов', `отклонено ${(sec.tool_calls || {}).denied || 0}, с ошибкой ${(sec.tool_calls || {}).failed || 0}`)}${tile(fmt((sec.events || []).length), 'событий безопасности', 'попытки инъекций, утечки ПДн')}</ul>
          ${(cost.by_purpose_today || []).length ? `<ul class="p-top">${cost.by_purpose_today.map((x) => `<li><code>${esc(x.purpose)}</code><span>${x.calls} ${plural(x.calls, 'вызов', 'вызова', 'вызовов')}</span><b>${rub(x.rub)}</b></li>`).join('')}</ul>` : ''}</section>
        <p class="i-small">Посчитано ${esc(ago(m.generated))}</p>`;
    } catch (e) { b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }
  }

  /* ---------- Вход в демо: компания из кейса или свой бизнес, плюс роль ---------- */
  const login = $('#aLogin');
  const L = { src: 'case', uid: '', role: 'cfo', tpl: null, qT: 0 };
  const compCard = (c) => `<label class="x-comp">
      <input class="visually-hidden" type="radio" name="lc" value="${esc(c.uid)}"${c.uid === L.uid ? ' checked' : ''}>
      <span class="x-comp__t">${esc(c.title)}</span>
      <span class="x-comp__m"><code>${esc(c.uid)}</code>${esc(c.sector_label)} · ${esc(c.revenue_label)}${c.region ? ` · ${esc(c.region)}` : ''}</span>
      <span class="x-comp__tags">${c.fts ? '<span>ВЭД</span>' : ''}${c.credit ? '<span>Кредиты</span>' : ''}</span>
    </label>`;
  function paintRoles() {
    const roles = (S.meta && S.meta.roles) || {};
    $('#aLoginRoles').innerHTML = Object.entries(roles).map(([k, v]) => `<label class="x-role" title="${esc(v.focus)}"><input class="visually-hidden" type="radio" name="lr" value="${esc(k)}"${k === L.role ? ' checked' : ''}><b>${esc(v.label)}</b><span>${esc(cut(v.focus, 60))}</span></label>`).join('');
  }
  function setSrc(src) {
    L.src = src;
    $$('.x-seg__b', login).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.src === src)));
    $$('.x-pane', login).forEach((p) => { p.hidden = p.dataset.pane !== src; });
    $('#aLoginGo').textContent = src === 'own' ? 'Создать и войти' : 'Войти';
  }
  async function openLogin(src) {
    L.uid = S.me ? S.me.uid : (API.session && API.session.uid) || '';
    L.role = S.me ? S.me.role : (API.session && API.session.role) || 'cfo';
    $('#aLoginErr').textContent = '';
    if (!login.open) login.showModal();
    setSrc(src || (/^U_TEST_/.test(L.uid) ? 'own' : 'case'));
    paintRoles();
    if (!S.tpls) {
      $('#aLoginList').innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Загружаю компании…</p>';
      try { S.tpls = await API.get('/api/demo/templates'); } catch (e) { $('#aLoginList').innerHTML = `<p class="c-err">${esc(e.message)}</p>`; return; }
    }
    if (!$('#aLoginQ').value) $('#aLoginList').innerHTML = S.tpls.companies.map(compCard).join('');
    $('#aLoginTpls').innerHTML = (S.tpls.texts || []).map((t, i) => `<button type="button" class="x-tpl" data-tpl="${i}">${esc(cut(t, 70))}</button>`).join('');
  }
  $('#aLoginQ').addEventListener('input', (e) => {
    clearTimeout(L.qT);
    const q = e.target.value.trim();
    L.qT = setTimeout(async () => {
      if (!q) { $('#aLoginList').innerHTML = (S.tpls ? S.tpls.companies : []).map(compCard).join(''); return; }
      try {
        const r = await API.get('/api/demo/companies?q=' + encodeURIComponent(q));
        $('#aLoginList').innerHTML = r.items.length ? r.items.map(compCard).join('') : '<p class="i-small">Ничего не нашлось. Поиск идёт по коду U_…, ОКВЭД, отрасли и региону среди компаний с выручкой от 15 млрд ₽</p>';
      } catch (err) { $('#aLoginList').innerHTML = `<p class="c-err">${esc(err.message)}</p>`; }
    }, 250);
  });
  login.addEventListener('change', (e) => {
    if (e.target.name === 'lc') L.uid = e.target.value;
    if (e.target.name === 'lr') L.role = e.target.value;
  });
  login.addEventListener('click', (e) => {
    const s = e.target.closest('.x-seg__b'); if (s) { setSrc(s.dataset.src); return; }
    const t = e.target.closest('[data-tpl]'); if (t) { $('#aLoginText').value = S.tpls.texts[+t.dataset.tpl]; $('#aLoginText').focus(); }
  });
  $('#aLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#aLoginErr'), go = $('#aLoginGo');
    err.textContent = '';
    go.disabled = true;
    try {
      let uid = L.uid;
      if (L.src === 'own') {
        const text = $('#aLoginText').value.trim();
        if (text.length < 15) throw new Error('Опишите бизнес хотя бы одним предложением: отрасль, выручка, регион');
        go.textContent = 'Разбираю описание…';
        const c = await API.post('/api/demo/company', { description: text });
        uid = c.uid;
        toast(`Создал карточку: ${c.sector_label}, ${c.revenue_label}${c.parsed_by === 'llm' ? '' : ' (разобрано правилами)'}`);
      }
      if (!uid) throw new Error('Выберите компанию');
      await API.login(uid, L.role);
      login.close();
      await boot();
      maybeHow();
    } catch (x) { err.textContent = x.message; }
    finally { go.disabled = false; setSrc(L.src); }
  });

  /* ---------- Проверить свою новость ---------- */
  const sub = $('#aSubmit');
  $('#aSubmitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#aSubmitForm button[type="submit"]'), err = $('#aSubErr');
    err.textContent = '';
    const title = $('#aSubTitle').value.trim(), text = $('#aSubText').value.trim(), url = $('#aSubUrl').value.trim();
    if (title.length < 8) { err.textContent = 'Заголовок хотя бы из 8 символов'; return; }
    if (url && !/^https?:\/\//i.test(url)) { err.textContent = 'Ссылка должна начинаться с http:// или https://'; return; }
    btn.disabled = true; btn.textContent = 'Оцениваю…';
    try {
      const r = await API.post('/api/news/submit', { title, text, url: url || null });
      sub.close();
      $('#aSubmitForm').reset();
      toast(r.relevant ? `Новость касается компании: ${(r.reasons || []).slice(0, 2).map((x) => x.text).join('; ')}` : 'Связь с компанией слабая, но новость добавлена в ленту для проверки');
      S.tab = 'all'; S.cat = 'alfi';
      await loadFeed();
      flashCard(r.id);
    } catch (x) { err.textContent = x.message; }
    finally { btn.disabled = false; btn.textContent = 'Оценить для компании'; }
  });

  function flashCard(id) {
    if (!visible().some((it) => it.id === id)) { S.tab = 'all'; S.cat = 'alfi'; renderFeed(); }
    const c = document.querySelector(`.a-card[data-id="${CSS.escape(id)}"]`);
    if (c) { c.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); c.classList.remove('is-flash'); void c.offsetWidth; c.classList.add('is-flash'); }
  }

  /* ---------- События ---------- */
  document.addEventListener('click', async (e) => {
    const el = (s) => e.target.closest(s);
    let t;
    if ((t = el('dialog')) && e.target === t && (t.classList.contains('x-sheet') || t.classList.contains('x-modal'))) { t.close(); return; }
    if ((t = el('[data-close]'))) { t.closest('dialog').close(); return; }
    if (el('[data-login]')) { openLogin(); return; }
    if (el('[data-prof]')) { openProfile(); return; }
    if (el('[data-metrics]')) { openMetrics(); return; }
    if (el('[data-submit]')) { $('#aSubErr').textContent = ''; sub.showModal(); setTimeout(() => $('#aSubTitle').focus(), 50); return; }
    if ((t = el('[data-refresh]'))) {
      t.disabled = true;
      try { const r = await API.post('/api/ingest/run'); toast(r.status === 'busy' ? 'Сбор уже идёт' : 'Собираю свежие новости, это 2–3 минуты. Лента обновится сама'); S.feed.ingest_running = true; renderLive(); schedulePoll(true); }
      catch (x) { toast(x.message); t.disabled = false; }
      return;
    }
    if (el('[data-how2]')) { openHow(2); return; }
    if (el('[data-how]')) { openHow(0); return; }
    if (el('#aTeamNew')) { openCreate(); return; }
    if (el('[data-team-reset]')) {
      try { setTeam(await API.del('/api/team')); if (!PEOPLE[S.cat]) S.cat = 'alfi'; await loadFeed(true); toast('Команда собрана заново под компанию'); } catch (x) { toast(x.message); }
      return;
    }
    if ((t = el('[data-ins]'))) { openInsight(t.dataset.ins); return; }
    if ((t = el('[data-askabout]'))) {
      // помощник берётся из кнопки: подпись и чат не разъедутся
      const it = byId(t.dataset.askabout);
      openChat(agentOf(t.dataset.askhelper || (it && it.helper)), t.dataset.askabout);
      say('Что это событие значит для нашей компании и что сделать в первую очередь?');
      return;
    }
    if ((t = el('[data-useful]'))) {
      const id = t.dataset.useful;
      if (S.useful.has(id)) { S.useful.delete(id); renderFeed(true); return; }
      S.useful.add(id); renderFeed(true);
      try { await API.post('/api/feedback', { news_id: id, kind: 'useful' }); toast('Учту: похожие события поднимутся выше'); } catch (x) { toast(x.message); }
      return;
    }
    if ((t = el('[data-read]'))) {
      const id = t.dataset.read;
      S.read.add(id); saveRead();
      renderFeed(); renderTeam(); renderHero();
      const n = S.items.filter(isRead).length;
      toast(`Перенёс в «Прочитано» · ${n}`);
      return;
    }
    if ((t = el('[data-unread]'))) {
      const id = t.dataset.unread;
      S.read.delete(id); saveRead();
      if (S.tab === 'read' && !S.items.some(isRead)) S.tab = 'all';
      renderFeed(); renderTeam(); renderHero();
      toast('Вернул в ленту');
      return;
    }
    if ((t = el('[data-nope]'))) {
      const id = t.dataset.nope;
      S.gone.add(id); renderFeed(true); renderTeam();
      try { await API.post('/api/feedback', { news_id: id, kind: 'not_relevant' }); } catch (x) { toast(x.message); }
      return;
    }
    if ((t = el('[data-undo]'))) {
      const id = t.dataset.undo;
      S.gone.delete(id); renderFeed(true); renderTeam();
      try { await API.post('/api/feedback', { news_id: id, kind: 'undo' }); } catch (_) {}
      return;
    }
    if ((t = el('[data-q]'))) { say(t.dataset.q); return; }
    if ((t = el('[data-ref]'))) {
      const target = document.getElementById(t.dataset.ref);
      const box = target && target.closest('details'); if (box) box.open = true;
      if (target) { target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' }); target.classList.remove('is-flash'); void target.offsetWidth; target.classList.add('is-flash'); }
      return;
    }
    if ((t = el('.a-tab'))) { const tab = t.dataset.tab; if (tab !== S.tab) swapFeed(() => { S.tab = tab; }); return; }
    if ((t = el('[data-team]'))) { selectCat(t.dataset.team); return; }
    if ((t = el('[data-drop]'))) { dropMate(t.dataset.drop); return; }
    if (el('[data-clearteam]')) { selectCat('alfi'); return; }
    if ((t = el('[data-area]'))) {
      const id = t.dataset.area === S.area ? '' : t.dataset.area, label = t.dataset.areaLabel;
      swapFeed(() => { S.area = id; S.areaLabel = label; if (id && !visible().length) S.tab = 'all'; });
      S.heroSig = ''; renderHero();
      if (id) $('.a-feed__bar').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (el('[data-cleararea]')) { swapFeed(() => { S.area = ''; }); S.heroSig = ''; renderHero(); return; }
    if ((t = el('[data-goto]')) && t.dataset.goto) {
      e.preventDefault();
      if (chat.open) closeChat(true);
      flashCard(t.dataset.goto);
    }
  });
  document.addEventListener('alfi:auth', () => { S.me = null; renderBar(); openLogin(); });

  /* ---------- Загрузка ленты и фоновое обновление ----------
     Пока модель уточняет сферы влияния или идёт сбор новостей, лента переспрашивается раз в 6 секунд */
  function schedulePoll(force) {
    clearTimeout(S.pollT);
    const f = S.feed;
    const busy = f && (f.triage_running || f.triage_pending || f.ingest_running || (f.team && f.team.selecting));
    if ((busy || force) && S.polls < 30) { S.polls++; S.pollT = setTimeout(() => loadFeed(true), 6000); }
    else if (!busy) S.polls = 0;
  }
  async function loadFeed(quiet) {
    clearTimeout(S.pollT);
    let f;
    try { f = await API.get('/api/feed'); }
    catch (e) {
      if (e.status !== 401) $('#aCards').innerHTML = `<div class="a-empty">Лента не загрузилась: ${esc(e.message)}. <button class="btn btn--ghost" type="button" data-retry>Повторить</button></div>`;
      return;
    }
    const wasIngest = S.feed && S.feed.ingest_running, wasSel = S.team && S.team.selecting;
    S.feed = f; S.items = f.items || [];
    setTeam(f.team);
    if (!PEOPLE[S.cat]) S.cat = 'alfi';
    renderTeam(); renderFeed(quiet); renderLive(); renderHero();
    if (wasSel && f.team && f.team.picked_by === 'ai') toast('ИИ собрал команду под вашу компанию: ' + f.team.members.map((m) => m.name).join(', '));
    if (wasIngest && !f.ingest_running) toast(`Новости обновлены: ${f.ingest ? `${fmt(f.ingest.new)} новых` : 'готово'}`);
    schedulePoll();
  }
  $('#aCards').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) loadFeed(); });

  async function boot() {
    clearTimeout(S.pollT);
    Object.assign(S, { area: '', areaLabel: '', read: new Set(), feed: null, items: [], gone: new Set(), useful: new Set(), polls: 0, chatCtx: null, runs: {}, heroSig: '', cat: 'alfi', tab: 'risk' });
    log.innerHTML = ''; panes.clear(); runs.forEach((r) => r.abort()); runs.clear();
    heroEl.dataset.mode = '';
    $$('.a-side, .a-side *').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; });
    if (!S.meta) { try { S.meta = await API.get('/api/meta'); } catch (_) {} }
    if (!API.session) { S.me = null; renderBar(); heroEl.innerHTML = ''; $('#aCards').innerHTML = '<div class="a-empty">Выберите компанию, чтобы увидеть ленту</div>'; openLogin(); return; }
    try { S.me = await API.get('/api/me'); }
    catch (e) { if (e.status !== 401) toast(e.message); return; }
    S.read = loadRead();
    renderBar();
    $('#aCards').innerHTML = '<div class="a-empty">Загружаю ленту…</div>';
    if (scene) catSwap(ALFI);
    paintWho(ALFI);
    await loadFeed();
  }
  boot();
})();
