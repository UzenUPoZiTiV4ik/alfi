/* Оболочка кабинета Альфа-Бизнес: шапка и боковое меню.
   Подключается синхронно сразу после <body>: <div id="shell-top"></div> + <script src="js/shell.js"></script>
   Плюс тост для заглушек и автообновление страницы на localhost при правке файлов. */
(function () {
  'use strict';

  const SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="i-services" viewBox="0 0 24 24"><g fill="none" stroke-width="2"><circle cx="7" cy="7" r="2.6" stroke="#1C1D20"/><circle cx="17" cy="7" r="2.6" stroke="#7A2E3A"/><circle cx="7" cy="17" r="2.6" stroke="#1C1D20"/><path d="M17 13.4v7.2M13.4 17h7.2" stroke="#EF3124" stroke-linecap="round"/></g></symbol>
  <symbol id="i-requests" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4h9A2.5 2.5 0 0 1 18 6.5V12"/><path d="M8 9h6M8 12.5h3.5"/><path d="M14 20.5c.4-2.6 2-4 4.6-4M17.2 14.8l2 1.8-1.8 2"/></g></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></symbol>
  <symbol id="i-feed" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 9.5 6.4 5.6A2 2 0 0 1 8.1 4.6h7.8a2 2 0 0 1 1.7 1l2.4 3.9V17a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17Z"/><path d="M4 10h4.5l1.2 2.2h4.6L15.5 10H20"/></g></symbol>
  <symbol id="i-history" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 13.5A7.6 7.6 0 1 0 6.3 7"/><path d="M4.5 4.5v3.6h3.6"/><path d="M12 8.5V12l2.4 1.6"/></g></symbol>
  <symbol id="i-import" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20H7.5A2.5 2.5 0 0 1 5 17.5v-11A2.5 2.5 0 0 1 7.5 4H12l2 2.4"/><path d="M17 11v7.5M14.5 16l2.5 2.6 2.5-2.6"/></g></symbol>
  <symbol id="i-statement" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 20h-4A2.5 2.5 0 0 1 5 17.5v-11A2.5 2.5 0 0 1 7.5 4H12l2 2.4"/><circle cx="17" cy="16.5" r="2.6"/></g></symbol>
  <symbol id="i-accounts" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="M8.5 9.5h7M8.5 13h3.5"/></g></symbol>
  <symbol id="i-partners" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9.5" cy="7.5" r="3"/><path d="M3.8 19.5c.5-3.3 2.8-5.3 5.7-5.3s5.2 2 5.7 5.3"/><circle cx="17" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><path d="M17 13c1.7.4 2.8 1.7 3.2 3.8"/><circle cx="20.2" cy="19.2" r=".9" fill="currentColor" stroke="none"/></g></symbol>
  <symbol id="i-certs" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20h-3A2.5 2.5 0 0 1 5 17.5v-11A2.5 2.5 0 0 1 7.5 4H12l2 2.4"/><path d="m13.6 20 2.4-6.6h.6l2.4 6.6M14.4 18h3.8"/></g></symbol>
  <symbol id="i-invoice" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5h13v15l-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4-2.1-1.4-2.2 1.4Z"/><path d="M9 9h6M9 12.5h3.5"/></g></symbol>
  <symbol id="i-cards" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="5.5" width="16" height="13" rx="2.5"/><path d="M4 10h16"/></g></symbol>
  <symbol id="i-gov" viewBox="0 0 24 24"><path d="M12 5.2c-1 0-1.6.6-1.6 1.4 0 .5.2.9.6 1.2-1.6-.6-3.8-1.6-5.6-1-.9.3-1.4 1.1-1.2 2 .3 1.5 2.3 2.4 4.4 2.6-1.5.6-2.6 1.6-2.6 2.9 0 1.2 1 2 2.4 2l2.3-.5-.6 2.9h3.8l-.6-2.9 2.3.5c1.4 0 2.4-.8 2.4-2 0-1.3-1.1-2.3-2.6-2.9 2.1-.2 4.1-1.1 4.4-2.6.2-.9-.3-1.7-1.2-2-1.8-.6-4 .4-5.6 1 .4-.3.6-.7.6-1.2 0-.8-.6-1.4-1.6-1.4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></symbol>
  <symbol id="i-news" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 5h11v14H7a2 2 0 0 1-2-2V5Z"/><path d="M16 9h3v8a2 2 0 0 1-2 2h-1"/><path d="M8 9h5M8 12.5h5M8 16h3" stroke-linecap="round"/></g></symbol>
  <symbol id="i-gear-fill" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M10.3 3h3.4l.5 2.4c.6.2 1.1.5 1.6.9l2.3-.8 1.7 2.9-1.8 1.6a6.6 6.6 0 0 1 0 1.9l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1 .7-1.6.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.1-.5-1.6-.9l-2.3.8-1.7-2.9 1.8-1.6a6.6 6.6 0 0 1 0-1.9L4.2 8.4l1.7-2.9 2.3.8c.5-.4 1-.7 1.6-.9ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"/></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 6.5 8 6.2 8-6.2"/></g></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v1.3M7 16.5V11a5 5 0 0 1 10 0v5.5l1.5 1.5h-13Z"/><path d="M10.2 20.5h3.6"/></g></symbol>
  <symbol id="i-collapse" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5v15"/><rect x="8.5" y="4.5" width="11" height="15" rx="2.5"/><path d="m14.8 9.6-2.3 2.4 2.3 2.4"/></g></symbol>
  <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <!-- Иконки интерфейса -->
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-arrow-ur" viewBox="0 0 24 24"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-cal" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></g></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></g></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3.5c.6 4.2 2.3 6 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.5 5.9-2.3 6.5-6.5ZM18 15.5c.3 1.8 1 2.6 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.2 2.5-1 2.8-2.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></symbol>
  <symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.6-5 3.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
  <symbol id="i-bookmark-fill" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.6-5 3.6Z" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></g></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l16 16M10 6c.6-.1 1.3-.2 2-.2 6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.7 3.4M6.5 7.6C4 9.3 2.5 12 2.5 12S6 18.2 12 18.2c1.6 0 3-.4 4.2-1"/></g></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></symbol>
  <symbol id="i-mic" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></g></symbol>
  <symbol id="i-thumb" viewBox="0 0 24 24"><path d="M8 10.5V20H5v-9.5h3Zm0 0 3.5-6.5c1.4 0 2.3 1.1 2 2.5L13 9.5h5.3a1.7 1.7 0 0 1 1.7 2l-1.3 6.5a2.5 2.5 0 0 1-2.4 2H8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
  <symbol id="i-share" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></g></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></g></symbol>
  <symbol id="i-arrow-l" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></symbol>
</defs></svg>`;

  const TOPBAR = `
<a class="skip-link" href="#main">Перейти к новостям</a>
<header class="topbar">
  <button class="icon-btn topbar__burger" id="burger" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar"><svg class="ic"><use href="#i-menu"/></svg></button>
  <a class="brand" href="#" aria-label="Альфа-Бизнес, главная">
    <span class="brand__logo" aria-hidden="true">
      <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#EF3124"/><path d="M20 8.5c-2 0-3.1 1.2-3.7 3l-5 14.5h3.9l1.2-3.6h7.2l1.1 3.6h4.2l-5-14.5c-.6-1.8-1.7-3-3.9-3Zm-2.6 10.6 2.5-7.6h.1l2.4 7.6Z M11 28.5h18v3H11Z" fill="#fff"/></svg>
    </span>
    <span class="brand__name">Альфа-Бизнес</span>
  </a>
  <div class="topbar__actions">
    <button class="icon-btn" aria-label="Сообщения"><svg class="ic"><use href="#i-mail"/></svg></button>
    <button class="icon-btn" aria-label="Уведомления"><svg class="ic"><use href="#i-bell"/></svg></button>
    <span class="topbar__divider" aria-hidden="true"></span>
    <button class="companies" aria-label="Мои компании">
      <svg class="companies__tiles" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="13" height="13" rx="3.5" fill="#6B4CF6"/><path d="M3.6 9.8 7.2 3h1.6L6.6 7.1h2.9l-3.9 5" fill="#fff" transform="translate(-.4 -1.2) scale(.95)"/>
        <rect x="15" width="13" height="13" rx="3.5" fill="#1F2347"/><path d="M19 4h5M18.6 6.5h5M18.2 9h5" stroke="#8FA2FF" stroke-width="1.4" stroke-linecap="round"/>
        <rect y="15" width="13" height="13" rx="3.5" fill="#C9F24B"/><path d="M4 25v-7l5 7v-7" fill="none" stroke="#1C1D20" stroke-width="1.7" stroke-linejoin="round"/>
        <rect x="15" y="15" width="13" height="13" rx="3.5" fill="#4CC3C7"/>
      </svg>
      <span class="companies__text">
        <span class="companies__name">Мои компании</span>
        <span class="companies__user">Иванов И.И.</span>
      </span>
    </button>
    <span class="topbar__divider" aria-hidden="true"></span>
    <button class="account" aria-label="Профиль: Альфа Босс">
      <svg class="account__avatar" viewBox="0 0 32 32" aria-hidden="true">
        <defs><radialGradient id="avBg" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#6E5B4C"/><stop offset="1" stop-color="#1E1815"/></radialGradient></defs>
        <rect width="32" height="32" fill="url(#avBg)"/>
        <path d="M3 34c.8-6.2 5.6-9.4 13-9.4S28.2 27.8 29 34Z" fill="#18202F"/>
        <path d="M13.2 24.6 16 31l2.8-6.4-2.8.9Z" fill="#F1F1F1"/><path d="m15.4 26 .6 4.6.6-4.6Z" fill="#8A1F1F"/>
        <ellipse cx="16" cy="15.4" rx="5.1" ry="6.2" fill="#D9AC8D"/>
        <path d="M10.7 14c-.4-4.6 2.1-7.3 5.5-7.3s5.9 2.5 5.3 7.3c-.6-2.3-2.1-3.5-5.4-3.7-3 .1-4.6 1.4-5.4 3.7Z" fill="#2A221E"/>
      </svg>
      <span class="account__name">Альфа Босс</span>
    </button>
    <span class="topbar__divider topbar__divider--last" aria-hidden="true"></span>
    <button class="icon-btn topbar__collapse" id="collapseBtn" aria-label="Свернуть меню" aria-pressed="false"><svg class="ic"><use href="#i-collapse"/></svg></button>
  </div>
</header>`;

  const badge = document.documentElement.dataset.badge || '9';
  const SIDEBAR = `
<aside class="sidebar" id="sidebar" aria-label="Основное меню">
  <nav class="nav">
    <a class="nav__item nav__item--lead" href="#" title="Все сервисы"><svg class="ic"><use href="#i-services"/></svg><span class="nav__label">Все сервисы</span></a>
    <hr class="nav__sep">
    <a class="nav__item" href="#" title="Заявки"><svg class="ic"><use href="#i-requests"/></svg><span class="nav__label">Заявки</span><span class="tag tag--new">Новое</span></a>
    <a class="nav__item" href="#" title="Новый платёж"><svg class="ic"><use href="#i-plus"/></svg><span class="nav__label">Новый платёж</span></a>
    <a class="nav__item" href="#" title="Лента операций"><svg class="ic"><use href="#i-feed"/></svg><span class="nav__label">Лента операций</span></a>
    <a class="nav__item" href="#" title="Платежи в работе"><svg class="ic"><use href="#i-history"/></svg><span class="nav__label">Платежи в работе</span></a>
    <a class="nav__item" href="#" title="Импорт реестров"><svg class="ic"><use href="#i-import"/></svg><span class="nav__label">Импорт реестров</span></a>
    <a class="nav__item" href="#" title="Выписка"><svg class="ic"><use href="#i-statement"/></svg><span class="nav__label">Выписка</span></a>
    <a class="nav__item" href="#" title="Счета"><svg class="ic"><use href="#i-accounts"/></svg><span class="nav__label">Счета</span></a>
    <a class="nav__item" href="#" title="Контрагенты"><svg class="ic"><use href="#i-partners"/></svg><span class="nav__label">Контрагенты</span></a>
    <a class="nav__item" href="#" title="Справки"><svg class="ic"><use href="#i-certs"/></svg><span class="nav__label">Справки</span></a>
    <a class="nav__item" href="#" title="Счета на оплату"><svg class="ic"><use href="#i-invoice"/></svg><span class="nav__label">Счета на оплату</span></a>
    <a class="nav__item" href="#" title="Карты"><svg class="ic"><use href="#i-cards"/></svg><span class="nav__label">Карты</span></a>
    <a class="nav__item is-active" href="#" aria-current="page" title="Новости"><svg class="ic"><use href="#i-news"/></svg><span class="nav__label">Новости</span><span class="nav__badge">${badge}</span></a>
    <hr class="nav__sep">
    <a class="nav__item" href="#" title="Госзакупки"><span class="nav__promo"><svg class="ic"><use href="#i-gov"/></svg></span><span class="nav__label">Госзакупки</span></a>
  </nav>
  <a class="nav__item nav__item--muted nav__bottom" href="#" title="Настроить меню"><svg class="ic"><use href="#i-gear-fill"/></svg><span class="nav__label">Настроить меню</span></a>
</aside>
<div class="scrim" id="scrim" hidden></div>`;

  // Вставляем оболочку синхронно, до первой отрисовки
  const top = document.getElementById('shell-top');
  if (top) top.outerHTML = SPRITE + TOPBAR;
  const side = document.getElementById('shell-side');
  if (side) side.outerHTML = SIDEBAR;


  function onReady() {
    const $ = (s) => document.querySelector(s);
    const store = {
      get(k, d) { try { const v = localStorage.getItem('ab-news:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
      set(k, v) { try { localStorage.setItem('ab-news:' + k, JSON.stringify(v)); } catch { /* приватный режим */ } }
    };

    // Свернуть меню (десктоп), состояние общее с основным макетом
    const collapseBtn = $('#collapseBtn');
    function setCollapsed(on) {
      document.body.classList.toggle('is-collapsed', on);
      collapseBtn.setAttribute('aria-pressed', String(on));
      collapseBtn.setAttribute('aria-label', on ? 'Развернуть меню' : 'Свернуть меню');
      store.set('collapsed', on);
    }
    collapseBtn.addEventListener('click', () => setCollapsed(!document.body.classList.contains('is-collapsed')));
    if (store.get('collapsed', false)) setCollapsed(true);

    // Мобильное меню
    const sidebar = $('#sidebar'), scrim = $('#scrim'), burger = $('#burger');
    function setMenu(open) {
      sidebar.classList.toggle('is-open', open);
      scrim.hidden = !open;
      burger.setAttribute('aria-expanded', String(open));
    }
    burger.addEventListener('click', () => setMenu(!sidebar.classList.contains('is-open')));
    scrim.addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('is-open')) setMenu(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();

  // Тост для заглушек действий
  let toastEl, toastT;
  window.shellToast = function (msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ctoast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
  };

  // Автообновление: только на локальном сервере, следим за html, css и js страницы
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    const seen = new Map();
    const urls = () => {
      const list = [location.pathname];
      document.querySelectorAll('link[rel="stylesheet"], script[src]').forEach((n) => {
        const u = new URL(n.href || n.src, location.href);
        if (u.origin === location.origin) list.push(u.pathname);
      });
      return Array.from(new Set(list));
    };
    async function tick() {
      for (const u of urls()) {
        try {
          const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
          const m = r.headers.get('last-modified');
          if (!m) continue;
          if (seen.has(u) && seen.get(u) !== m) { location.reload(); return; }
          seen.set(u, m);
        } catch { /* сервер перезапускается */ }
      }
      setTimeout(tick, 1200);
    }
    window.addEventListener('load', () => setTimeout(tick, 600));
  }
})();
