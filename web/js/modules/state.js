const freshState = () => ({
  me: null, feed: null, team: null, items: [], read: new Set(), gone: new Set(), useful: new Set(),
  q: '', area: '', areaLabel: '', cat: 'alfi', tab: 'all', hbDeck: [], hbId: '', heroSig: '',
  loadedQuery: null, pages: [], tpls: null, chatCtx: null, runs: {}, feedbackRevision: 0, pollT: 0, etags: new Map(), feedbackPending: new Map()
});
const S = { ...freshState(), meta: null, sessionGen: 0, controllers: new Set() };

function resetGeneration() {
  S.sessionGen++;
  for (const controller of S.controllers) controller.abort();
  S.controllers.clear();
  clearTimeout(S.pollT);
  Object.assign(S, freshState());
}

function scopedController() {
  const controller = new AbortController();
  S.controllers.add(controller);
  return controller;
}

const helperFilter = () => (S.cat === 'alfi' ? null : S.cat);
// «Прочитано»: новость уходит из рабочих вкладок, сводки и счётчиков в отдельную вкладку; хранится на устройстве для компании и роли
const readKey = () => `alfi:read:${S.me ? S.me.uid + ':' + S.me.role : ''}`;
const loadRead = () => { try { return new Set(JSON.parse(localStorage.getItem(readKey()) || '[]')); } catch (_) { return new Set(); } };
const saveRead = () => { try { localStorage.setItem(readKey(), JSON.stringify([...S.read].slice(-300))); } catch (_) {} };
const isRead = (it) => S.read.has(it.id);
const inTab = (it, tab) => tab === 'read' ? isRead(it)
  : !isRead(it) && (tab === 'all' || (tab === 'risk' ? it.kind === 'risk' || it.kind === 'mixed' : it.kind === 'chance' || it.kind === 'mixed'));
const ofHelper = (it) => !helperFilter() || it.helper === helperFilter();
const ofArea = (it) => !S.area || (it.areas || []).some((a) => a.id === S.area);
const visible = () => S.items.filter((it) => inTab(it, S.tab) && ofHelper(it) && ofArea(it));
const FEED_STEP = 24;

const byId = (id) => S.items.find((it) => it.id === id);

export { S, scopedController, byId, visible, saveRead, isRead, helperFilter, inTab, ofHelper, ofArea, FEED_STEP, resetGeneration, loadRead };
