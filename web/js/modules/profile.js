import { fmt, $, modal, plural, pct, esc, rub, ago } from './ui.js';
import { S } from './state.js';
import { API } from './api.js';
import { CRIT_T } from './insight.js';

/* ---------- Профиль компании: на чём строится персонализация ---------- */
const bnum = (v) => (v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽' : v >= 1e6 ? Math.round(v / 1e6) + ' млн ₽' : fmt(v / 1e3) + ' тыс ₽');
// Значения из данных банка: без капса, диапазоны через тире, место в отрасли словами
const FEAT_HIDE = new Set(['feat:eco', 'feat:owner', 'feat:suppliers', 'feat:customers']);
const FEAT_LABEL = { 'feat:market': 'Место среди клиентов банка', 'feat:workers': 'Сотрудники' };
// Страны приходят капсом: «АЛЖИР» → «Алжир», аббревиатуры вроде «ОАЭ» и «США» остаются
const ABBR = new Set(['ОКВЭД', 'ОКФС', 'ОКОПФ', 'ЕАЭС', 'КНДР']);
const tidy = (v) => String(v ?? '')
  .replace(/[А-ЯЁ]{4,}/g, (w) => (ABBR.has(w) ? w : w[0] + w.slice(1).toLowerCase()))
  .replace(/(\d)\s?-\s?(\d)/g, '$1–$2')
  .replace(/#(\d+) из/g, '$1-е из')
  .replace(/-На-/g, '-на-')
  .replace(/^одна компания$/, 'не входит в группу');
const level = (v) => (v >= 0.66 ? 'высокая' : v >= 0.4 ? 'средняя' : 'низкая');
async function openProfile() {
  const d = $('#aProf'), b = $('#aProfBody');
  const gen = S.sessionGen;
  modal(d);
  b.innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Загружаем данные о компании…</p>';
  try {
    const p = await API.get('/api/profile');
    $('#aProfTitle').textContent = tidy(p.title);
    const cp = (x, title) => x && x.n ? `<section class="p-sec"><h4>${title}</h4>
      <p class="i-small">${x.n} ${plural(x.n, 'контрагент', 'контрагента', 'контрагентов')}, оборот ${bnum(x.total)}, крупнейший ${pct(x.top_share)}${x.intra_group ? `, внутри группы ${bnum(x.intra_group)}` : ''}</p>
      ${(x.sectors || []).filter((s) => s.share > 0.001).slice(0, 4).length ? `<div class="p-bars">${x.sectors.filter((s) => s.share > 0.001).slice(0, 4).map((s) => `<p><span>${esc(s.label)}</span><i style="--w:${Math.min(100, s.share * 100)}%"></i><b>${pct(s.share)}</b></p>`).join('')}</div>` : ''}
      ${(x.top || []).length ? `<ul class="p-top">${x.top.slice(0, 5).map((t) => `<li><span>${esc(t.sector_label || t.okved || '')}${t.region ? ` · ${esc(t.region)}` : ''}${t.key_owner ? ' · общий собственник' : ''}</span><b>${pct(t.share)}</b></li>`).join('')}</ul>` : ''}
    </section>` : `<section class="p-sec"><h4>${title}</h4><p class="i-small">Нет платежей в данных</p></section>`;
    b.innerHTML = `
      <p class="i-lead">${esc(p.okved)} ${esc(p.okved_name)}</p>
      <section class="p-sec"><h4>На что опирается Альфи</h4><p class="i-small">По этим данным Альфи понимает, какие новости важны для компании</p>
        <ul class="p-feats">${(p.features || []).filter((f) => !FEAT_HIDE.has(f.id)).map((f) => `<li><span>${esc(FEAT_LABEL[f.id] || f.label)}</span><b>${esc(tidy(f.value))}${f.detail && f.id !== 'feat:products' ? `<small>${esc(f.detail)}</small>` : ''}</b></li>`).join('')}</ul></section>
      <section class="p-sec"><h4>К чему чувствительна компания</h4><p class="i-small">Новости на эти темы стоят в ленте выше</p>
        <div class="p-bars">${(p.sensitivities || []).slice(0, 8).map((s) => `<p title="${esc((s.why || []).map((w) => w.text).join('; '))}"><span>${esc(s.label)}</span><i style="--w:${Math.min(100, s.value * 100)}%"></i><b>${level(s.value)}</b></p>`).join('')}</div></section>
      ${p.position ? `<section class="p-sec"><h4>Место среди клиентов банка</h4><p class="i-small">${p.position.okved ? `По ОКВЭД: ${p.position.okved.rank} из ${p.position.okved.of}, доля ${pct(p.position.okved.share)}. ` : ''}${p.position.sector ? `По отрасли: ${p.position.sector.rank} из ${p.position.sector.of}. ` : ''}${esc(p.position.note || '')}</p></section>` : ''}
      ${p.group && p.group.n > 1 ? `<section class="p-sec"><h4>Группа компаний · ${p.group.n}</h4><p class="i-small">Выручка группы ${bnum(p.group.revenue)}</p>
        <ul class="p-top">${p.group.members.slice(0, 8).map((g) => `<li><span>${esc(g.sector_label)} · ${esc(g.region || '')}${g.self ? ' · это вы' : ''}</span><b>${bnum(g.revenue)}</b></li>`).join('')}</ul></section>` : ''}
      <div class="i-two">${cp(p.suppliers, 'Поставщики')}${cp(p.customers, 'Покупатели')}</div>
      ${p.links && p.links.persons ? `<section class="p-sec"><h4>Связи через собственников</h4><p class="i-small">${p.links.persons} ${plural(p.links.persons, 'физлицо', 'физлица', 'физлиц')}, связанных компаний: ${(p.links.companies || []).length}</p></section>` : ''}
      ${/^U_TEST_/.test(p.uid) ? '<p class="i-small">Это тестовая компания из описания. Платежей, группы и связей у неё нет, поэтому часть разбора будет помечена как неполные данные.</p>' : ''}`;
  } catch (e) { if (gen !== S.sessionGen) return; b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }
}

/* ---------- Метрики качества ---------- */
async function openMetrics() {
  const d = $('#aMet'), b = $('#aMetBody');
  const gen = S.sessionGen;
  modal(d);
  b.innerHTML = '<p class="tr-lead"><span class="f-spin" aria-hidden="true"></span>Считаем метрики…</p>';
  try {
    const m = await API.get('/api/metrics');
    const c = m.content || {}, p = m.personalization || {}, a = m.ai || {}, cost = m.cost || {}, sec = m.security || {};
    const tile = (v, l, s = '') => (v == null || v === '—') ? `<li class="m-t is-empty"><b>—</b><span>${l}</span><small>нет данных за период</small></li>` : `<li class="m-t"><b>${v}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</li>`;
    b.innerHTML = `
      <section class="p-sec"><h4>Новости и база знаний</h4><ul class="m-grid">
        ${tile(fmt(c.news_5d), 'новостей за 5 дней', `ленты ${fmt(c.rss)}, поиск ${fmt(c.exa)}`)}${tile(fmt(c.sources), 'источников')}${tile(fmt(c.events), 'событий без дублей', `дублей ${pct(c.dedup_ratio)}`)}
        ${tile(pct(c.business_share), 'про бизнес')}${tile(c.kb ? `${c.kb.docs} / ${c.kb.theses}` : '—', 'документов / тезисов банка', c.kb ? `цитаты сверены ${c.kb.verified} из ${c.kb.theses}` : '')}${tile(c.kb ? c.kb.forecasts : '—', 'прогнозов банка')}</ul></section>
      <section class="p-sec"><h4>Персонализация</h4><ul class="m-grid">
        ${tile(pct(p.feed_diversity), 'различие лент у компаний', 'сравнение первых 10 событий у 5 компаний')}${tile(pct(p.useful_rate), 'отмечено полезным')}${tile(fmt((p.feedback || {}).n), 'отметок обратной связи')}</ul></section>
      <section class="p-sec"><h4>Качество разборов</h4><ul class="m-grid">
        ${tile(fmt(a.insights), 'разборов')}${tile(pct(a.avg_confidence), 'средняя надёжность')}${tile(pct(a.rules_pass_rate), 'прошли все проверки')}
        ${tile(pct(a.bank_view_coverage), 'с позицией банка')}${tile(pct(a.critic_revise_rate), 'отправлены на доработку', a.critic ? Object.entries(a.critic).map(([k, v]) => `${CRIT_T[k] || k} ${pct(v)}`).join(', ') : '')}${tile(fmt(a.repair_runs), 'доработок')}</ul></section>
      <section class="p-sec"><h4>Расходы и безопасность</h4><ul class="m-grid">
        ${tile(rub((cost.today || {}).spent_rub), 'потрачено сегодня', `мягкий лимит ${rub((cost.today || {}).soft_rub)}, жёсткий ${rub((cost.today || {}).hard_rub)}`)}
        ${tile(fmt((sec.tool_calls || {}).n), 'обращений к данным', `отклонено ${(sec.tool_calls || {}).denied || 0}, с ошибкой ${(sec.tool_calls || {}).failed || 0}`)}${tile(fmt((sec.events || []).length), 'срабатываний защиты', 'попытки обойти правила, персональные данные')}</ul>
        ${(cost.by_purpose_today || []).length ? `<ul class="p-top">${cost.by_purpose_today.map((x) => `<li><code>${esc(x.purpose)}</code><span>${x.calls} ${plural(x.calls, 'вызов', 'вызова', 'вызовов')}</span><b>${rub(x.rub)}</b></li>`).join('')}</ul>` : ''}</section>
      <p class="i-small">Посчитано ${esc(ago(m.generated))}</p>`;
  } catch (e) { if (gen !== S.sessionGen) return; b.innerHTML = `<p class="c-err">${esc(e.message)}</p>`; }
}

export { openProfile, openMetrics, tidy };
