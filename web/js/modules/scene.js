import { $, M } from './ui.js';

/* ---------- Меню: «Новости» наверх, метка «Новое» к ним ---------- */
(() => {
  const nav = $('.nav'); if (!nav) return;
  const news = nav.querySelector('[title="Новости"]'), req = nav.querySelector('[title="Заявки"]');
  if (req) { const tag = req.querySelector('.tag--new'); if (tag) tag.remove(); }
  if (!news) return;
  news.classList.add('is-news');
  if (req) nav.insertBefore(news, req);
})();

/* ---------- Сцена с котом ---------- */
const stageEl = $('#aStage');
const place = (r) => {
  const top = 30, bottom = 78;
  const size = Math.max(150, Math.min(r.height - top - bottom, r.width * 0.78, 280));
  return { x: r.width / 2 - size * 0.03, y: top + (r.height - top - bottom + size) / 2, size };
};
const scene = M && M.stage ? M.stage(stageEl, { kind: 'alfi', anchor: (r) => place(r) }) : (stageEl.classList.add('is-nogl'), null);

export { scene, stageEl };
