import { S, isRead } from './state.js';
import { esc, $, $$, toast, noName, reduce, plural, modal, M } from './ui.js';
import { ALFI, PEOPLE, mount, agentOf, setTeam, register } from './people.js';
import { markTeam, selectCat } from './stage.js';
import { API } from './api.js';
import { loadFeed } from './feed.js';

/* ---------- Команда Альфи: 3 помощника подобраны под компанию, можно до 4 ---------- */
const countOf = (p) => S.items.filter((it) => !S.gone.has(it.id) && !isRead(it) && (p.all || it.helper === p.id)).length;
function teamRow(p) {
  const n = countOf(p);
  const hot = !p.all && S.items.some((it) => it.helper === p.id && it.urgency >= 3);
  return `<li class="a-team__row">
    <button class="a-mate" data-team="${esc(p.id)}" aria-pressed="${S.cat === p.id}" title="${esc(p.why_ai || p.why || '')}">
      <span class="a-mate__ava" data-mava="${esc(p.id)}"></span>
      <span class="a-mate__txt"><span class="a-mate__name">${esc(p.name)}</span><span class="a-mate__sub">${esc(p.task || p.watch)}</span>${p.all ? '' : `<span class="a-mate__sub">${esc(scheduleLabel(p))}</span>`}</span>
      <span class="a-mate__n ${hot ? 'is-hot' : ''}"${hot ? ' title="Есть срочные"' : ''}>${n}</span>
    </button>
    ${p.all ? '' : `<button class="a-mate__x" type="button" data-drop="${esc(p.id)}" aria-label="Убрать «${esc(p.name)}» из команды"><svg class="ic"><use href="#i-close"/></svg></button>`}
  </li>`;
}
function renderTeam() {
  const t = S.team || { members: [], max: 4 };
  const full = t.members.length >= (t.max || 4);
  $('#aTeamSub').innerHTML = t.selecting ? '<span class="f-spin" aria-hidden="true"></span>Альфи подбирает команду…'
    : t.custom ? 'Состав изменён вами' : '';
  $('#aTeam').innerHTML = [ALFI, ...t.members.map((m) => PEOPLE[m.id])].map(teamRow).join('') + `
    <li><button class="a-mate a-mate--new" id="aTeamNew" type="button" ${full ? 'aria-disabled="true"' : ''}>
      <span class="a-mate__ava a-mate__ava--plus"><svg class="ic"><use href="#i-plus"/></svg></span>
      <span class="a-mate__txt"><span class="a-mate__name">${full ? 'Команда собрана' : 'Добавить помощника'}</span><span class="a-mate__sub">${full ? `Не больше ${t.max || 4}, уберите кого-то, чтобы добавить` : 'Тема, имя и цвет'}</span></span>
    </button></li>
    ${t.custom ? '<li><button class="a-team__reset" type="button" data-team-reset>Подобрать команду заново</button></li>' : ''}`;
  $$('[data-mava]', $('#aTeam')).forEach((el) => mount(el, agentOf(el.dataset.mava).kind));
  markTeam();
}
// Состав хранится на сервере: id предложенных помощников и до двух своих
const teamBody = (members) => ({
  ids: members.filter((m) => !m.own).map((m) => m.id),
  schedules: Object.fromEntries(members.map(member => [member.id, {
    frequency: member.frequency || 'off',
    timezone: member.timezone || browserTimezone()
  }])),
  own: members.filter((m) => m.own).map((m) => ({ id: m.id, name: m.name, watch: m.watch, fur: m.fur }))
});
async function saveTeam(members, msg) {
  const gen = S.sessionGen;
  try {
    const t = await API.put('/api/team', teamBody(members));
    setTeam(t);
    if (!PEOPLE[S.cat]) S.cat = 'alfi';
    await loadFeed(true, { force: true });
    if (gen !== S.sessionGen) return false;
    if (msg) toast(msg);
    return true;
  } catch (e) { if (gen === S.sessionGen) toast(e.message); }
}
async function dropMate(id) {
  const left = S.team.members.filter((m) => m.id !== id).map((m) => PEOPLE[m.id]);
  const gone = PEOPLE[id];
  if (S.cat === id) selectCat('alfi');
  if (!left.length) { toast('В команде должен остаться хотя бы один помощник'); return; }
  await saveTeam(left, `«${gone.name}» убран из команды. Его новости теперь у Альфи`);
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
  { id: 'off', name: 'Не присылать', sub: 'Без рассылки', first: '' },
  { id: 'week', name: 'Раз в неделю', sub: 'Итоги в понедельник', first: 'в понедельник' }
];
const dlg = $('#aNew'), form = $('#aNewForm'), colorsEl = $('#aNewColors'), newStage = $('#aNewStage');
const nameIn = $('#aNewName'), watchIn = $('#aNewWatch'), nameErr = $('#aNewNameErr');
const backBtn = $('#aNewBack'), nextBtn = $('#aNewNext'), steps = $$('.a-step', dlg);
const previewKind = (fur) => 'own-preview-' + fur.slice(1);
let TOPICS = [];
const draft = { step: 0, topic: null, fur: PALETTE[4].fur, freq: 'day', nameTouched: false };
let newScene = null;

// Пример сообщения: реальная находка из ленты по факторам темы, если она есть
function sampleFor(c) {
  const it = S.items.find((x) => (x.factors || []).some((f) => (c.factors || []).includes(f.id)));
  return it ? `${it.headline || it.title}. ${it.action && !/^(Разобрать|Не требуется)/i.test(it.action) ? it.action : 'Разберу, что это меняет для компании'}` : '';
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
      ${t.why ? `<span class="a-topic__y" title="${esc(t.why)}">${esc(t.why)}</span>` : ''}
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
  $('#aNewSampleText').textContent = draft.freq === 'off' ? 'Сообщения по расписанию отключены.' : `${lead}. ${t && t.sample ? t.sample : `Новое событие по теме «${watch || 'ваша тема'}» и что оно меняет для компании`}. Первое сообщение придёт ${f.first}.`;
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
  if (!S.team) return;
  const t = S.team || { members: [], max: 4 };
  if (t.members.length >= (t.max || 4)) { toast(`В команде уже ${t.members.length} ${plural(t.members.length, 'помощник', 'помощника', 'помощников')}. Уберите кого-то, чтобы добавить нового`); return; }
  buildTopics();
  Object.assign(draft, { step: 0, topic: null, fur: PALETTE[4].fur, freq: 'day', nameTouched: false });
  nameIn.value = ''; watchIn.value = ''; nameErr.textContent = '';
  form.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = r.name === 'aFreq' && r.value === draft.freq; });
  $('#aNewOwnWrap').hidden = true;
  register(previewKind(draft.fur), draft.fur);
  modal(dlg);
  if (M && M.stage && !newScene) newScene = M.stage(newStage, { kind: previewKind(draft.fur), anchor: placeNew });
  newStage.classList.toggle('is-nogl', !newScene);
  paintColor(false); paintDraft(); go(0);
}
async function createAgent() {
  const t = topicOf(), name = noName(nameIn.value, 18), watch = watchOf();
  const members = S.team.members.map((m) => PEOPLE[m.id]);
  // Предложенный помощник без изменений сохраняется как есть; переименованный или перекрашенный становится своим
  const asIs = t && !t.own && name === t.name && draft.fur === t.fur;
  if (!asIs && members.filter((m) => m.own).length >= 2) { toast('Своих помощников можно добавить не больше двух. Чтобы добавить нового, уберите одного из них'); return; }
  const id = asIs ? t.id : 'own-' + Date.now().toString(36).slice(-8);
  members.push(asIs ? { id: t.id, own: false } : { id, name, watch, fur: draft.fur, own: true });
  members.at(-1).frequency = draft.freq;
  members.at(-1).timezone = browserTimezone();
  const gen = S.sessionGen;
  nextBtn.disabled = true;
  const saved = await saveTeam(members);
  if (gen !== S.sessionGen) return;
  nextBtn.disabled = false;
  if (!saved) return;
  dlg.close();
  if (PEOPLE[id]) {
    const n = countOf(PEOPLE[id]);
    selectCat(id);
    const row = $(`#aTeam [data-team="${CSS.escape(id)}"]`);
    if (row) row.classList.add('is-born');
    const f = FREQ.find((x) => x.id === draft.freq);
    toast(n ? `${name || t.name} в команде. По теме уже ${n} ${plural(n, 'событие', 'события', 'событий')}` : (f.id === 'off' ? 'Помощник добавлен без рассылки' : `${name || t.name} в команде. Первое сообщение ${f.first}`));
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
    if (!stepReady()) { toast('Опишите тему подробнее'); watchIn.focus(); return; }
    go(1); return;
  }
  if (draft.step === 1) {
    if (!stepReady()) { nameErr.textContent = 'Придумайте имя'; nameIn.focus(); return; }
    go(2); return;
  }
  createAgent();
});

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
}

/** @param {import('./types.js').TeamMember} member */
function scheduleLabel(member) {
  const frequency = FREQ.find(choice => choice.id === member.frequency)?.name || 'Без рассылки';
  if (!member.next_run_at) return frequency;
  const date = new Date(member.next_run_at);
  return frequency + ' · ' + date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function resetTeamWizard() {
  TOPICS = [];
  draft.topic = null;
  nextBtn.disabled = false;
  nameErr.textContent = '';
  newStage.setAttribute('aria-label', 'Новый помощник');
  $('#aNewSampleName').textContent = '';
}

// Available on the helper's active filter, outside the team selection button.
function renderScheduleControl(container, member) {
  const select = document.createElement('select');
  select.className = 'a-token';
  select.setAttribute('aria-label', 'Расписание помощника ' + member.name);
  for (const choice of FREQ) select.add(new Option(choice.name, choice.id));
  select.value = member.frequency || 'off';
  container.append(select);
  select.addEventListener('change', async () => {
    const gen = S.sessionGen;
    select.disabled = true;
    try {
      const schedule = await API.put('/api/team/' + encodeURIComponent(member.id) + '/schedule', {
        frequency: select.value,
        timezone: browserTimezone()
      });
      if (gen !== S.sessionGen) return;
      Object.assign(member, schedule);
      renderTeam();
      await loadFeed(true, { force: true });
    } catch (error) {
      if (gen !== S.sessionGen) return;
      select.value = member.frequency;
      toast('Не удалось сохранить расписание: ' + error.message);
    } finally {
      select.disabled = false;
    }
  });
}

export { resetTeamWizard, renderScheduleControl, openCreate, renderTeam, dropMate, colorsEl };
