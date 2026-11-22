import { base } from './base.js';

const M = window.Mascot;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// В href пускаем только http(s) и свои /api/-ссылки: тексты новостей приходят из внешних источников
function safeUrl(value) {
  const url = String(value || '');
  if (url.startsWith('/api/')) return base + url;
  return /^https?:\/\//i.test(url) ? url : '';
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Служебные экраны (метрики качества) видны только команде сервиса: ?debug=1
const DEBUG = /[?&]debug=1\b/.test(location.search);
const toast = (t) => (window.shellToast ? window.shellToast(t) : console.log(t));
// Фокус на самом окне, а не на первой кнопке: без кольца вокруг «Закрыть», первый Tab ведёт внутрь
const modal = (d) => { d.showModal(); if (d.hasAttribute('autofocus')) d.focus({ preventScroll: true }); };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const nf = new Intl.NumberFormat('ru-RU');
const fmt = (n) => nf.format(Math.round(n || 0));
const rub = (v) => (v == null ? '—' : (v < 1 ? v.toFixed(2) : v.toFixed(1)).replace('.', ',') + ' ₽');
const pct = (v) => Math.round((v || 0) * 100) + '%';
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const noName = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
const MONS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dshort = (d) => `${d.getDate()} ${MONS[d.getMonth()]}`;
// «2 ч назад», «вчера», «22 окт». Новости с одной датой без времени показываем просто датой
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
// Иконка карточки: что за событие. Линейный значок по главному фактору, цвет по типу (риск, возможность)
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

export { $, reduce, cut, safeUrl, esc, toast, $$, modal, plural, kindOf, icon, KIND, ago, fmt, M, pct, rub, DEBUG, hello, noName };
