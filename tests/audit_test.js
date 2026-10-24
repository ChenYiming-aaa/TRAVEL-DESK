/* 审计测试：实证静态审查发现的问题（本地 file:// 模式） */
const { chromium } = require('playwright-core');
const path = require('path');
const url = require('url');
/* 运行环境：产物路径相对仓库根；chromium 路径取 CHROMIUM_PATH 环境变量，否则用 playwright-core 默认缓存 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || (() => {
  try { return require('playwright-core').chromium.executablePath(); } catch (e) { return null; }
})();
if (!CHROMIUM_PATH) {
  console.error('未找到 Chromium。请先执行：npx playwright install chromium，或设置环境变量 CHROMIUM_PATH');
  process.exit(2);
}

const EXE = CHROMIUM_PATH;
const PAGE_URL = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1200);

  /* ========== H2：completeTrip 已访城市去重失效 ========== */
  await page.click('.nav-item[data-tab="trip"]');
  await page.waitForTimeout(400);
  /* 打开川西小环线（草稿）——其计划含"成都东站"，成都市已在示例足迹中 */
  const opened = await page.evaluate(async () => {
    var cards = Array.from(document.querySelectorAll('#trip-list .trip-item'));
    var target = cards.find(c => c.textContent.indexOf('川西') >= 0) || cards[cards.length - 1];
    if (!target) return false;
    target.click();
    for (var i = 0; i < 30; i++) {
      if (document.getElementById('td-complete') || document.getElementById('td-status')) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  });
  check('行程详情打开（川西小环线）', opened);
  await page.waitForTimeout(300);
  await page.click('#td-complete');
  await page.waitForTimeout(600);
  const dup = await page.evaluate(() => {
    var modal = document.querySelector('#modal-root .modal');
    if (!modal) return { open: false };
    var items = Array.from(modal.querySelectorAll('.tk-title')).map(e => e.textContent.trim());
    return { open: true, items: items, hasChengdu: items.indexOf('成都市') >= 0 };
  });
  check('H2 复现确认：完成行程时已访城市(成都市)不应再被提议加入足迹', !dup.hasChengdu, dup.open ? '候选: ' + dup.items.join('/') : '弹窗未开');
  if (dup.open) { await page.click('#cp-skip'); await page.waitForTimeout(400); }

  /* ========== M3：城市面板删除足迹后抽屉未关闭 ========== */
  const sheetAfterDel = await page.evaluate(async () => {
    /* 直接打开杭州市城市面板并删除第一条 */
    window.openCityPanel('杭州市', '浙江省');
    await new Promise(r => setTimeout(r, 200));
    var delBtn = document.querySelector('#sheet-root [data-del]');
    if (!delBtn) return { err: 'no-del-btn' };
    delBtn.click();
    await new Promise(r => setTimeout(r, 300));
    var okBtn = document.getElementById('cf-ok');
    if (!okBtn) return { err: 'no-confirm' };
    okBtn.click();
    await new Promise(r => setTimeout(r, 600));
    return {
      sheetStill: !!document.querySelector('#sheet-root .sheet'),
      sheetText: (document.querySelector('#sheet-root .sheet') || {}).textContent || ''
    };
  });
  check('M3：城市面板删除足迹后抽屉应自动关闭', !sheetAfterDel.sheetStill, sheetAfterDel.sheetStill ? '抽屉仍显示: ' + sheetAfterDel.sheetText.slice(0, 30) : '');

  /* ========== M5：清空后欢迎卡片/示例入口 ========== */
  const welcome = await page.evaluate(async () => {
    /* 本地模式清空全部数据 */
    window.clearAllData();
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('cf-ok').click();
    await new Promise(r => setTimeout(r, 250));
    document.getElementById('cf-ok').click();
    await new Promise(r => setTimeout(r, 600));
    return {
      welcomeBtn: !!document.getElementById('welcome-seed'),
      profileText: (document.getElementById('profile-card-body').textContent || '').replace(/\s+/g, ' ').slice(0, 50),
      footCount: window.state.footprints.length
    };
  });
  check('M5：清空数据后应出现「载入示例数据」入口', welcome.welcomeBtn, '当前: ' + welcome.profileText);

  /* 验证示例可恢复 */
  const reseed = await page.evaluate(async () => {
    var b = document.getElementById('welcome-seed');
    if (!b) return { ok: false };
    b.click();
    await new Promise(r => setTimeout(r, 600));
    return { fp: window.state.footprints.length, trips: window.state.trips.length };
  });
  check('清空后可通过欢迎卡恢复示例数据', reseed.fp === 6 && reseed.trips === 2, JSON.stringify(reseed));

  /* ========== M6：悬浮卡滚动后残留 ========== */
  await page.click('.nav-item[data-tab="map"]');   /* 确保在地图 Tab */
  await page.waitForTimeout(500);
  const mapBox = await page.evaluate(() => {
    var c = document.querySelector('#china-map canvas');
    var r = c.getBoundingClientRect();
    var px = (window.mapChart && window.mapChart.convertToPixel({ geoIndex: 0 }, [118.0, 36.4])) || [r.width * 0.62, r.height * 0.42];
    return { x: r.left + px[0], y: r.top + px[1] };
  });
  await page.mouse.move(mapBox.x - 25, mapBox.y - 18);
  await page.mouse.move(mapBox.x, mapBox.y);
  await page.waitForTimeout(400);
  const hoverShown = await page.evaluate(() => !document.getElementById('hover-card').classList.contains('hidden'));
  /* 真实场景：用户用触控板/键盘滚动时鼠标不动，ECharts 收不到 mousemove，不会自愈 */
  const hoverAfterScroll = await page.evaluate(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 200));
    return {
      visible: !document.getElementById('hover-card').classList.contains('hidden'),
      top: document.getElementById('hover-card').style.top
    };
  });
  check('M6：页面滚动后悬浮卡应隐藏（不残留错位）', hoverShown && !hoverAfterScroll.visible, '滚动后 visible=' + hoverAfterScroll.visible + ' top=' + hoverAfterScroll.top);

  /* ========== XSS：用户内容转义 ========== */
  const xss = await page.evaluate(async () => {
    window.openFootprintModal(null, '浙江省', '杭州市');
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('fm-date').value = '2026-10-15';
    document.getElementById('fm-note').value = '<img src=x onerror="window.__xss=1">';
    document.getElementById('fm-tags').value = '<script>window.__xss2=1</script>';
    document.getElementById('fm-save').click();
    await new Promise(r => setTimeout(r, 500));
    return { xss: !!window.__xss, xss2: !!window.__xss2, saved: window.state.footprints.length };
  });
  check('XSS：足迹内容（记忆/标签）渲染时转义', !xss.xss && !xss.xss2, JSON.stringify(xss));

  /* ========== 筛选空结果提示 ========== */
  const emptyFilter = await page.evaluate(async () => {
    window.state.footFilter = { province: '青海省', tag: '', year: '' };
    window.refreshAll();
    await new Promise(r => setTimeout(r, 300));
    var empty = document.getElementById('foot-empty');
    return { visible: !empty.classList.contains('hidden'), text: (empty.textContent || '').replace(/\s+/g, ' ').slice(0, 40) };
  });
  check('筛选无结果时显示空状态', emptyFilter.visible, emptyFilter.text);
  await page.evaluate(() => { window.state.footFilter = { province: '', tag: '', year: '' }; window.refreshAll(); });

  /* ========== 30 条备份提醒 ========== */
  const remind = await page.evaluate(async () => {
    window.seedSampleIntoState();   /* 先恢复 6 条基数（此前清空过） */
    await new Promise(r => setTimeout(r, 200));
    for (var i = 0; i < 25; i++) {
      window.state.footprints.push({ id: 'fp_t' + i, province: '浙江省', city: '杭州市', date: '2026-10-15', note: '测试', tags: [], tripId: '' });
    }
    window.refreshAll();
    await new Promise(r => setTimeout(r, 300));
    var toasts = Array.from(document.querySelectorAll('.toast')).map(t => t.textContent);
    return { total: window.state.footprints.length, hasRemind: toasts.some(t => t.indexOf('建议') >= 0 || t.indexOf('备份') >= 0) };
  });
  check('数据量达 30 条时温和提示导出备份', remind.hasRemind, 'total=' + remind.total);

  /* 清理测试数据 */
  await page.evaluate(async () => {
    window.state.footprints = window.state.footprints.filter(f => f.id.indexOf('fp_t') !== 0);
    window.refreshAll();
    await new Promise(r => setTimeout(r, 300));
  });

  /* ========== Escape 关闭弹窗 ========== */
  const esc = await page.evaluate(async () => {
    window.openFootprintModal(null, '', '');
    await new Promise(r => setTimeout(r, 200));
    var open1 = !!document.getElementById('fm-prov');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    var open2 = !!document.getElementById('fm-prov');
    return { open1, open2 };
  });
  check('Escape 键可关闭弹窗（a11y）', esc.open1 && !esc.open2, JSON.stringify(esc));

  /* ========== 旧缓存兼容（缺 provinces 字段不崩） ========== */
  const legacy = await page.evaluate(async () => {
    try {
      window.state.trips.push({ id: 'trip_legacy', title: '旧数据行程', start: '2026-01-01', end: '2026-01-02', budget: 100, status: '草稿', days: [] });
      window.refreshAll();
      await new Promise(r => setTimeout(r, 300));
      var ok = true;
      window.state.trips = window.state.trips.filter(t => t.id !== 'trip_legacy');
      window.refreshAll();
      return { ok };
    } catch (e) { return { ok: false, err: String(e).slice(0, 100) }; }
  });
  check('旧缓存数据（缺 provinces 字段）不导致崩溃', legacy.ok, legacy.err || '');

  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' ; '));

  await browser.close();
  const fails = results.filter(r => !r.ok).length;
  console.log('\n===== AUDIT SUMMARY: ' + (results.length - fails) + '/' + results.length + ' PASS, ' + fails + ' FAIL =====');
})().catch(e => { console.error('TEST_CRASH:', e); process.exit(2); });
