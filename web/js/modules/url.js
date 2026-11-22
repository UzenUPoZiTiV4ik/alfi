import { S } from './state.js';
import { $ } from './ui.js';

function readFilters() {
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');
  S.tab = ['all', 'risk', 'chance', 'read'].includes(tab) ? tab : 'all';
  S.q = (params.get('q') || '').trim().slice(0, 200);
  S.area = params.get('area') || '';
  S.areaLabel = S.area;
  S.cat = params.get('helper') || 'alfi';
  $('#aFeedQ').value = S.q;
}

function writeFilters() {
  const url = new URL(location.href);
  const filters = { tab: S.tab !== 'all' && S.tab, q: S.q, area: S.area, helper: S.cat !== 'alfi' && S.cat };
  for (const [key, value] of Object.entries(filters)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

export { writeFilters, readFilters };
