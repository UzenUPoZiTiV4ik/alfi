// Рендер схем из index.html в PNG 3200×2000 (двойная плотность).
// Запуск: npm i playwright-core@1.56.1 && npx playwright install chromium && node docs/diagrams/render.js
// Путь к браузеру можно задать через CHROME_PATH. Нужен полный Chromium с GPU: в headless-shell
// без GPU маскот рисуется плоской SVG-заглушкой.
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await page.waitForTimeout(400);

  // Проверка вёрстки: узлы не пересекаются, не вылезают за слайд и не залезают под маскота
  const issues = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.slide').forEach((sl) => {
      const name = sl.dataset.name, S = sl.getBoundingClientRect();
      const nodes = [...sl.querySelectorAll('.n:not(.box), .note, .el')].map((n) => ({ n, r: n.getBoundingClientRect() }));
      const corner = sl.querySelector('.corner').getBoundingClientRect();
      const lead = sl.querySelector('.lead').getBoundingClientRect();
      const hit = (a, b, pad = 4) => a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
      for (const { n, r } of nodes) {
        const id = n.id || n.className;
        if (r.right > S.right - 30 || r.bottom > S.bottom - 50 || r.left < S.left + 30) out.push(`${name}: ${id} за краем`);
        if (hit(r, corner, 20) || r.top < lead.bottom + 8) out.push(`${name}: ${id} под шапкой`);
        if (n.classList.contains('n') && !n.classList.contains('dia') && n.scrollWidth > n.clientWidth + 1) out.push(`${name}: ${id} текст шире узла`);
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++)
        if (hit(nodes[i].r, nodes[j].r)) out.push(`${name}: ${nodes[i].n.id || nodes[i].n.className} × ${nodes[j].n.id || nodes[j].n.className}`);
      if (sl.querySelector('.lead').getBoundingClientRect().right > corner.left - 10) out.push(`${name}: подзаголовок под маскотом`);
    });
    return out;
  });

  for (const sl of await page.$$('.slide')) {
    const name = await sl.getAttribute('data-name');
    await sl.screenshot({ path: path.join(__dirname, name + '.png') });
    console.log('ok', name);
  }
  const missing = await page.evaluate(() => [...document.querySelectorAll('[data-cat]')].filter((el) => !el.querySelector('img')).length);
  console.log('layout:', issues.length ? issues : 'ok');
  console.log('mascots without image:', missing, 'errors:', errors);
  await browser.close();
})();
