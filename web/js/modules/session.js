import { $, esc, cut, DEBUG, reduce, $$, toast, modal } from './ui.js';
import { S, resetGeneration, loadRead } from './state.js';
import { API, assertCurrent } from './api.js';
import { maybeHow, resetSummary } from './summary.js';
import { resetFeed, loadFeed } from './feed.js';
import { resetTeamWizard } from './team.js';
import { resetChat } from './chat.js';
import { resetInsight } from './insight.js';
import { setTeam, ALFI } from './people.js';
import { writeFilters, readFilters } from './url.js';
import { catSwap, paintWho } from './stage.js';

/* ---------- Роль и бизнес вместо «Альфа Босс» ----------
   Кнопка аккаунта показывает компанию и роль. Меню: смена роли в один клик, текущий бизнес и его смена,
   профиль, «Как работает» и метрики. «Мои компании» сразу открывает выбор компании.
   В продуктиве компанию и роль передаёт вход в Альфа-Бизнес, здесь они меняются для проверки. */
const accBtn = $('.topbar .account');
const accMenu = document.createElement('div');
accMenu.className = 'acc-menu'; accMenu.id = 'accMenu'; accMenu.hidden = true;
accMenu.setAttribute('role', 'dialog'); accMenu.setAttribute('aria-label', 'Роль и компания');
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
    <div class="acc-roles" ${S.meta?.demo ? '' : 'hidden'} role="radiogroup" aria-label="Роль в бизнесе">${Object.entries(roles).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === me.role}" data-role="${esc(k)}" title="${esc(v.focus)}">${esc(v.label)}</button>`).join('')}</div>
    <p class="acc-menu__f">${esc(roles[me.role] ? roles[me.role].focus : '')}</p>
    <p class="acc-menu__h">Ваша компания</p>
    <button type="button" class="acc-biz" data-prof>
      <b>${esc(c.title)}</b>
      <span>${esc(c.sector_label)}${c.revenue_label && !/^0\s/.test(c.revenue_label) ? ` · ${esc(c.revenue_label)}` : ''}${c.region ? ` · ${esc(c.region)}` : ''}</span>
      <small>Профиль: на чём строится лента</small>
    </button>
    <button type="button" class="acc-i is-main" data-login><svg class="ic"><use href="#i-refresh"/></svg>Сменить компанию<small>${S.meta?.demo ? 'из списка или по описанию' : 'по токену'}</small></button>
    <button type="button" class="acc-i" data-logout>Выйти</button>
    <div class="acc-row">
      <button type="button" class="acc-i" data-how><svg class="ic"><use href="#i-layers"/></svg>Как работает</button>
      ${DEBUG ? '<button type="button" class="acc-i" data-metrics><svg class="ic"><use href="#i-chart"/></svg>Метрики</button>' : ''}
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
  try { await API.login(S.me.uid, b.dataset.role); toggleMenu(false); if (!S.me) return; toast(`Лента и команда собраны для роли «${S.me.role_label}»`); maybeHow(); }
  catch (x) { if (x.name !== 'AbortError') toast(x.message); }
});
/* ---------- Вход в демо: компания из кейса или свой бизнес, плюс роль ---------- */
const login = $('#aLogin');
const L = { src: 'case', uid: '', role: 'cfo', tpl: null, qT: 0 };
const compCard = (c) => `<label class="x-comp">
    <input class="visually-hidden" type="radio" name="lc" value="${esc(c.uid)}"${c.uid === L.uid ? ' checked' : ''}>
    <span class="x-comp__t">${esc(String(c.title).replace(/-На-/g, '-на-'))}</span>
    <span class="x-comp__m">${esc(c.sector_label)} · ${esc(c.revenue_label)}${c.region ? ` · ${esc(c.region)}` : ''}</span>
    <span class="x-comp__tags">${c.fts ? '<span>ВЭД</span>' : ''}${c.credit ? '<span>Кредиты</span>' : ''}</span>
  </label>`;
// Список компаний прокручивается: снизу затухание, пока не долистали до конца
const compsEl = $('#aLoginList');
const compsFade = () => compsEl.classList.toggle('is-more', compsEl.scrollHeight - compsEl.scrollTop - compsEl.clientHeight > 4);
compsEl.addEventListener('scroll', compsFade, { passive: true });
function paintRoles() {
  const roles = (S.meta && S.meta.roles) || {};
  $('#aLoginRoles').innerHTML = Object.entries(roles).map(([k, v]) => `<label class="x-role" title="${esc(v.focus)}"><input class="visually-hidden" type="radio" name="lr" value="${esc(k)}"${k === L.role ? ' checked' : ''}><b>${esc(v.label)}</b><span>${esc(v.focus)}</span></label>`).join('');
}
function setSrc(src) {
  L.src = src;
  const demo = S.meta?.demo === true;
  $('.x-seg', login).hidden = !demo;
  $('#aLoginRoles').hidden = !demo;
  $('#aRoleLabel').hidden = !demo;
  $('#aTokenPane').hidden = demo;
  $('.x-sheet__kicker', login).textContent = demo ? 'Демо' : 'Альфа-Бизнес';
  $('.x-modal__sub', login).textContent = demo ? 'Выберите компанию и роль, чтобы увидеть, как меняется лента.' : 'Введите токен, выданный для вашей компании и роли.';
  $$('.x-seg__b', login).forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.src === src)); b.tabIndex = b.dataset.src === src ? 0 : -1; });
  $$('.x-pane', login).forEach((p) => { p.hidden = !demo || p.dataset.pane !== src; });
  $('#aLoginGo').textContent = src === 'own' ? 'Создать и войти' : 'Войти';
}
async function openLogin(src) {
  L.uid = S.me ? S.me.uid : (API.session && API.session.uid) || '';
  L.role = S.me ? S.me.role : (API.session && API.session.role) || 'cfo';
  $('#aLoginErr').textContent = '';
  if (!login.open) modal(login);
  setSrc(src || (/^U_TEST_/.test(L.uid) ? 'own' : 'case'));
  if (S.meta?.demo !== true) return;
  const gen = S.sessionGen;
  paintRoles();
  if (!S.tpls) {
    $('#aLoginList').innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Загружаем компании…</p>';
    try { S.tpls = await API.get('/api/demo/templates'); } catch (e) { if (gen !== S.sessionGen) return; $('#aLoginList').innerHTML = `<p class="c-err">${esc(e.message)}</p>`; return; }
  }
  if (!$('#aLoginQ').value) $('#aLoginList').innerHTML = S.tpls.companies.map(compCard).join('');
  compsFade();
  $('#aLoginTpls').innerHTML = (S.tpls.texts || []).map((t, i) => `<button type="button" class="x-tpl" data-tpl="${i}">${esc(cut(t, 70))}</button>`).join('');
}
$('#aLoginQ').addEventListener('input', (e) => {
  clearTimeout(L.qT);
  L.search?.abort();
  if (!S.meta?.demo) return;
  const gen = S.sessionGen;
  const search = L.search = new AbortController();
  const q = e.target.value.trim();
  L.qT = setTimeout(async () => {
    if (!q) { $('#aLoginList').innerHTML = (S.tpls ? S.tpls.companies : []).map(compCard).join(''); return; }
    try {
      const r = await API.get('/api/demo/companies?q=' + encodeURIComponent(q), { signal: search.signal });
      if (gen !== S.sessionGen || search.signal.aborted) return;
      $('#aLoginList').innerHTML = r.items.length ? r.items.map(compCard).join('') : '<p class="i-small">Ничего не нашлось. Попробуйте отрасль, регион или код ОКВЭД, например 46.21</p>';
      compsFade();
    } catch (err) { if (gen !== S.sessionGen || search.signal.aborted) return; $('#aLoginList').innerHTML = `<p class="c-err">${esc(err.message)}</p>`; }
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
    if (S.meta?.demo !== true) {
      const token = $('#aToken').value.trim();
      if (!token) throw new Error('Введите токен');
      $('#aToken').value = '';
      await exchangeToken(token);
      return;
    }
    let uid = L.uid;
    if (L.src === 'own') {
      const text = $('#aLoginText').value.trim();
      if (text.length < 15) throw new Error('Опишите бизнес хотя бы одним предложением: отрасль, выручка, регион');
      go.textContent = 'Создаём карточку компании…';
      const c = await API.post('/api/demo/company', { description: text });
      uid = c.uid;
      toast(`Карточка компании создана: ${c.sector_label}, ${c.revenue_label}`);
    }
    if (!uid) throw new Error('Выберите компанию');
    await API.login(uid, L.role);
    if (S.me) maybeHow();
  } catch (x) { err.textContent = x.message; }
  finally { go.disabled = false; setSrc(L.src); }
});

function resetSessionState() {
  const hadCompany = !!S.me;
  resetGeneration();
  Object.assign(L, { uid: '', role: 'cfo', src: 'case' });
  resetFeed();
  resetTeamWizard();
  resetChat();
  resetInsight();
  resetSummary();
  L.search?.abort();
  clearTimeout(L.qT);
  setTeam(null);
  S.team = null;
  for (const dialog of $$('dialog[open]')) dialog.close();
  for (const form of $$('#aSubmitForm, #aLoginForm, #aChatForm, #aNewForm')) form.reset();
  for (const node of $$('#aCards, #aTeam, #aTeamSub, #fLive, #fNotice, #aFilter, #aProfBody, #aMetBody, #aLoginList, #aLoginTpls, #aLoginRoles, #aSubErr, #aNewTopics, #aNewSampleText, #aNewCardName, #aNewCardWatch')) node.replaceChildren();
  $('#aSubmitForm button[type=submit]').disabled = false;
  $('#aSubmitForm button[type=submit]').textContent = 'Оценить для компании';
  $('#aFilter').hidden = true;
  $('#fMore').hidden = true;
  $('#aFeedQ').value = '';
  for (const tab of $$('.a-tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === 'all'));
    tab.tabIndex = tab.dataset.tab === 'all' ? 0 : -1;
    tab.querySelector('sup').textContent = '';
    tab.hidden = tab.dataset.tab === 'read';
  }
  if (hadCompany) writeFilters();
  renderBar();
  toggleMenu(false);
  catSwap(ALFI);
  paintWho(ALFI);
}

let changingSession = false;
async function changeSession(authenticate) {
  if (changingSession) throw new Error('Вход уже выполняется');
  changingSession = true;
  resetSessionState();
  try {
    const { uid, role } = await authenticate();
    await boot();
    if (S.me?.uid !== uid || S.me?.role !== role) throw new Error('Сервер не подтвердил вход');
    return { uid, role };
  } catch (error) {
    await openLogin();
    throw error;
  } finally {
    changingSession = false;
  }
}

async function loginDemo(uid, role) {
  S.meta ||= await API.get('/api/meta');
  if (S.meta.demo !== true) throw new Error('Требуется вход по токену');
  return changeSession(() => API.post('/api/session', { uid, role }));
}

function exchangeToken(token) {
  return changeSession(() => API.post('/api/auth/cookie', undefined, { headers: { Authorization: 'Bearer ' + token } }));
}

async function logoutSession() {
  if (changingSession) return;
  changingSession = true;
  resetSessionState();
  try {
    await API.post('/api/auth/logout');
  } catch (error) {
    toast('Сервер не подтвердил выход: ' + error.message);
  } finally {
    changingSession = false;
    await openLogin();
  }
}

document.addEventListener('alfi:login', () => openLogin());

document.addEventListener('alfi:auth', () => {
  resetSessionState();
  $('#aCards').innerHTML = '<div class="a-empty"><button class="btn btn--ghost" type="button" data-login>Войти и выбрать компанию</button></div>';
  openLogin();
});

async function boot() {
  const gen = S.sessionGen;
  try {
    S.meta ||= await API.get('/api/meta');
    S.me = await API.get('/api/me');
    assertCurrent(gen);
    readFilters();
    S.read = loadRead();
    renderBar();
    if (login.open) login.close();
    await loadFeed();
  } catch (error) {
    if (gen !== S.sessionGen) return;
    $('#aCards').innerHTML = '<div class="a-empty"><button class="btn btn--ghost" type="button" data-boot>Повторить вход</button></div>';
    toast(error.message);
    if (error.status === 403) {
      await openLogin();
      $('#aLoginErr').textContent = 'Нет доступа к компании или роли';
    }
  }
}
$('#aCards').addEventListener('click', event => {
  if (event.target.closest('[data-boot]')) boot();
});

export { logoutSession, openLogin, loginDemo, boot, resetSessionState };
