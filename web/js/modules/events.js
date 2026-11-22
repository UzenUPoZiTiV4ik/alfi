import { $, toast, reduce, modal, plural, $$ } from './ui.js';
import { API } from './api.js';
import { S, visible, byId, saveRead, isRead } from './state.js';
import { loadFeed, renderFeed, rateItem, swapFeed } from './feed.js';
import { writeFilters } from './url.js';
import { logoutSession, openLogin } from './session.js';
import { openProfile, openMetrics } from './profile.js';
import { openHow, renderHero } from './summary.js';
import { openCreate, renderTeam, dropMate, colorsEl } from './team.js';
import { setTeam, PEOPLE, agentOf, ALFI } from './people.js';
import { openInsight } from './insight.js';
import { openChat, say, chat, closeChat } from './chat.js';
import { selectCat } from './stage.js';

/* ---------- Проверить свою новость ---------- */
const sub = $('#aSubmit');
$('#aSubmitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const gen = S.sessionGen;
  const btn = e.submitter || $('#aSubmitForm button[type="submit"]'), err = $('#aSubErr');
  err.textContent = '';
  const title = $('#aSubTitle').value.trim(), text = $('#aSubText').value.trim(), url = $('#aSubUrl').value.trim();
  if (title.length < 8) { err.textContent = 'Заголовок хотя бы из 8 символов'; return; }
  if (url && !/^https?:\/\//i.test(url)) { err.textContent = 'Ссылка должна начинаться с http:// или https://'; return; }
  btn.disabled = true; btn.textContent = 'Оцениваем…';
  try {
    const r = await API.post('/api/news/submit', { title, text, url: url || null });
    sub.close();
    $('#aSubmitForm').reset();
    toast(r.relevant ? `Новость касается компании: ${(r.reasons || []).slice(0, 2).map((x) => x.text).join('; ')}` : 'Новость добавлена в ленту. Прямого влияния на компанию Альфи не видит');
    S.tab = 'all'; S.cat = 'alfi';
    await loadFeed();
    if (gen === S.sessionGen) flashCard(r.id);
  } catch (x) { if (gen === S.sessionGen) err.textContent = x.message; }
  finally {
    if (gen === S.sessionGen) {
      btn.disabled = false;
      btn.textContent = 'Оценить для компании';
    }
  }
});

function flashCard(id) {
  if (!visible().some((it) => it.id === id)) { S.tab = 'all'; S.cat = 'alfi'; S.area = ''; writeFilters(); renderFeed(); }
  const c = document.querySelector(`.a-card[data-id="${CSS.escape(id)}"]`);
  if (c) { c.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); c.classList.remove('is-flash'); void c.offsetWidth; c.classList.add('is-flash'); }
}

/* ---------- События ---------- */
document.addEventListener('click', async (e) => {
  const gen = S.sessionGen;
  const el = (s) => e.target.closest(s);
  let t;
  if ((t = el('dialog')) && e.target === t && (t.classList.contains('x-sheet') || t.classList.contains('x-modal'))) { t.close(); return; }
  if ((t = el('[data-close]'))) { t.closest('dialog').close(); return; }
  if (el('[data-logout]')) { await logoutSession(); return; }
  if (el('[data-login]')) { openLogin(); return; }
  if (el('[data-prof]')) { openProfile(); return; }
  if (el('[data-metrics]')) { openMetrics(); return; }
  if (el('[data-submit]')) { $('#aSubErr').textContent = ''; modal(sub); setTimeout(() => $('#aSubTitle').focus(), 50); return; }
  if ((t = el('[data-refresh]'))) {
    await loadFeed(true, { force: true });
    return;
  }
  if (el('[data-how2]')) { openHow(2); return; }
  if (el('[data-how]')) { openHow(0); return; }
  if (el('#aTeamNew')) { openCreate(); return; }
  if (el('[data-team-reset]')) {
    try { setTeam(await API.del('/api/team')); if (!PEOPLE[S.cat]) S.cat = 'alfi'; await loadFeed(true); if (gen === S.sessionGen) toast('Команда подобрана заново'); } catch (x) { if (gen === S.sessionGen) toast(x.message); }
    return;
  }
  if ((t = el('[data-ins]'))) { openInsight(t.dataset.ins); return; }
  if ((t = el('[data-askabout]'))) {
    const it = byId(t.dataset.askabout);
    openChat(agentOf(t.dataset.askhelper || it?.helper), t.dataset.askabout);
    say('Что это значит для нас и что сделать в первую очередь?');
    return;
  }
  if ((t = el('[data-useful]'))) {
    const id = t.dataset.useful;
    await rateItem(id, S.useful.has(id) ? 'undo_useful' : 'useful');
    return;
  }
  if ((t = el('[data-read]'))) {
    const id = t.dataset.read;
    S.read.add(id); saveRead();
    renderFeed(); renderTeam(); renderHero();
    const n = S.items.filter(isRead).length;
    toast(`Перенесено в «Прочитано», там ${n} ${plural(n, 'новость', 'новости', 'новостей')}`);
    return;
  }
  if ((t = el('[data-unread]'))) {
    const id = t.dataset.unread;
    S.read.delete(id); saveRead();
    if (S.tab === 'read' && !S.items.some(isRead)) { S.tab = 'all'; writeFilters(); }
    renderFeed(); renderTeam(); renderHero();
    toast('Новость возвращена в ленту');
    return;
  }
  if ((t = el('[data-nope]'))) {
    await rateItem(t.dataset.nope, 'not_relevant');
    return;
  }
  if ((t = el('[data-undo]'))) {
    await rateItem(t.dataset.undo, 'undo');
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
// Вкладки и радиогруппы из кнопок: стрелки, Home и End, как у нативных контролов
document.addEventListener('keydown', (e) => {
  if (!/^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) return;
  const item = e.target.closest('[role="tab"], button[role="radio"]');
  const group = item && item.closest('[role="tablist"], [role="radiogroup"]');
  if (!group || group === colorsEl) return;
  const all = $$(item.getAttribute('role') === 'tab' ? '[role="tab"]' : 'button[role="radio"]', group).filter((x) => !x.hidden && !x.disabled);
  const i = all.indexOf(item), n = all.length;
  const next = all[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (/Right|Down/.test(e.key) ? 1 : -1) + n) % n];
  e.preventDefault(); next.focus(); next.click();
});
