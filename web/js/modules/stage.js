import { $, $$ } from './ui.js';
import { scene, stageEl } from './scene.js';
import { agentOf } from './people.js';
import { S, helperFilter, visible } from './state.js';
import { swapFeed } from './feed.js';
import { chat, openChat } from './chat.js';

/* ---------- Смена персонажа на сцене ---------- */
const whoEl = $('#aStageWho'), chatBtn = $('#aStageChat');
function paintWho(p) {
  whoEl.dataset.cat = p.kind;
  whoEl.textContent = `На сцене ${p.name}. ${p.watch}`;
  chatBtn.setAttribute('aria-label', p.all ? 'Чат с Альфи' : `Чат с помощником «${p.name}»`);
}
function catSwap(p) { if (!scene) return; if (scene.swap) scene.swap(p.kind); else scene.setKind(p.kind); }
function showCat(p, instant = false) {
  if (p.id === S.cat) return;
  if (instant && scene?.setKind) {
    scene.setKind(p.kind);
    scene.squash?.(2.4);
  } else {
    catSwap(p);
  }
  S.cat = p.id;
  markTeam();
  paintWho(p);
  swapFeed(() => { if (helperFilter() && !visible().length) S.tab = 'all'; });
}
function selectCat(id) {
  const p = agentOf(id);
  if (p.id === S.cat) return;
  showCat(p);
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

export { showCat, selectCat, markTeam, catSwap, paintWho };
