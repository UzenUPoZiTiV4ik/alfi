import { M, $$, $ } from './ui.js';
import { S } from './state.js';

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

// Аватарки кэшируем: рендер в WebGL и кодирование PNG дорогие
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

export { ALFI, mount, agentOf, setTeam, PEOPLE, register, ACC };
