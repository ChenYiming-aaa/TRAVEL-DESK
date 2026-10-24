/* 无障碍 / 键盘可达 专项测试（P0-P1 优化验证） */
const { chromium } = require('playwright-core');
const path = require('path'); const url = require('url');
/* 运行环境：产物路径相对仓库根；chromium 路径取 CHROMIUM_PATH 环境变量，否则用 playwright-core 默认缓存 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || (() => {
  try { return require('playwright-core').chromium.executablePath(); } catch (e) { return null; }
})();
if (!CHROMIUM_PATH) {
  console.error('未找到 Chromium。请先执行：npx playwright install chromium，或设置环境变量 CHROMIUM_PATH');
  process.exit(2);
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  /* ===== P0-1：行程详情头部不粘连 ===== */
  await page.evaluate(() => { switchTab('trip'); state.tripDetailId = state.trips[0].id; refreshAll(); });
  await page.waitForTimeout(500);
  const head = await page.evaluate(() => {
    var name = document.querySelector('#trip-detail .t-head .t-name');
    var dates = document.querySelector('#trip-detail .t-head .t-dates');
    if (!name || !dates) return { missing: true };
    var a = name.getBoundingClientRect(), b = dates.getBoundingClientRect();
    return { gap: Math.round(b.left - a.right), display: getComputedStyle(name.parentElement).display };
  });
  check('A1 详情标题与日期有间距（不粘连）', !head.missing && head.gap >= 8, JSON.stringify(head));
  await page.evaluate(() => { state.tripDetailId = ''; refreshAll(); });

  /* ===== P0-2：足迹卡片键盘可达 ===== */
  await page.evaluate(() => { switchTab('foot'); state.footBatch = { on: false, picked: {} }; refreshAll(); });
  await page.waitForTimeout(400);
  const cardA11y = await page.evaluate(() => {
    var c = document.querySelector('.foot-item');
    return c ? { role: c.getAttribute('role'), tab: c.getAttribute('tabindex'), label: c.getAttribute('aria-label') } : null;
  });
  check('A2 足迹卡片有 role/tabindex/aria-label', cardA11y && cardA11y.role === 'button' && cardA11y.tab === '0' && !!cardA11y.label, JSON.stringify(cardA11y));
  await page.evaluate(() => { var c = document.querySelector('.foot-item'); c.focus(); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const byEnter = await page.evaluate(() => {
    var t = document.querySelector('#modal-root .sheet-head .s-title');
    return { modal: !!document.querySelector('#modal-root .modal'), title: t ? t.textContent : '' };
  });
  check('A3 卡片 Enter 键打开编辑模态', byEnter.modal && byEnter.title.indexOf('编辑足迹') >= 0, JSON.stringify(byEnter));

  /* ===== P0-3：模态焦点接管 ===== */
  const focusIn = await page.evaluate(() => {
    var m = document.querySelector('#modal-root .modal');
    return {
      inModal: m ? m.contains(document.activeElement) : false,
      active: document.activeElement.tagName + '#' + (document.activeElement.id || ''),
      ariaModal: m ? m.getAttribute('aria-modal') : null,
      labelledby: m ? m.getAttribute('aria-labelledby') : null,
      titleId: m ? !!document.getElementById(m.getAttribute('aria-labelledby')) : false
    };
  });
  check('A4 模态打开后焦点在层内', focusIn.inModal, JSON.stringify(focusIn));
  check('A5 模态有 aria-modal 且 labelledby 指向标题', focusIn.ariaModal === 'true' && focusIn.labelledby === 'modal-title' && focusIn.titleId, JSON.stringify(focusIn));
  /* Tab 20 次仍在层内 */
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
  const stillIn = await page.evaluate(() => {
    var m = document.querySelector('#modal-root .modal');
    return m ? m.contains(document.activeElement) : false;
  });
  check('A6 Tab 循环不逃出模态', stillIn);
  /* 关闭归还焦点 */
  await page.evaluate(() => closeModal());
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => {
    var a = document.activeElement;
    return { tag: a.tagName, isCard: a.classList.contains('foot-item'), label: a.getAttribute ? a.getAttribute('aria-label') : '' };
  });
  check('A7 关闭模态后焦点归还触发卡片', back.isCard, JSON.stringify(back));

  /* ===== P0-2b：批量模式语义 ===== */
  const batchA11y = await page.evaluate(() => {
    state.footBatch = { on: true, picked: {} };
    refreshAll();
    var c = document.querySelector('.foot-item');
    var before = c.getAttribute('aria-checked');
    c.click();
    var after = c.getAttribute('aria-checked');
    state.footBatch = { on: false, picked: {} };
    refreshAll();
    return { role: c.getAttribute('role'), before: before, after: after };
  });
  check('A8 批量模式卡片为 checkbox 且 aria-checked 随勾选变化', batchA11y.role === 'checkbox' && batchA11y.before === 'false' && batchA11y.after === 'true', JSON.stringify(batchA11y));

  /* ===== 行程列表项 / 统计条键盘可达 ===== */
  const tripKey = await page.evaluate(() => {
    switchTab('trip');
    refreshAll();
    var el = document.querySelector('.trip-item');
    return el ? { role: el.getAttribute('role'), tab: el.getAttribute('tabindex') } : null;
  });
  check('A9 行程列表项键盘可达', tripKey && tripKey.role === 'button' && tripKey.tab === '0', JSON.stringify(tripKey));
  const statsKey = await page.evaluate(() => {
    var b = document.getElementById('stats-bar');
    return { tab: b.getAttribute('tabindex'), label: b.getAttribute('aria-label') };
  });
  check('A10 统计条键盘可达且有描述', statsKey.tab === '0' && !!statsKey.label, JSON.stringify(statsKey));

  /* ===== 抽屉层焦点接管 ===== */
  await page.evaluate(() => { openProvincePanel('浙江省', true); });
  await page.waitForTimeout(400);
  const sheetFocus = await page.evaluate(() => {
    var s = document.querySelector('#sheet-root .sheet');
    return { inSheet: s ? s.contains(document.activeElement) : false, ariaModal: s ? s.getAttribute('aria-modal') : null };
  });
  check('A11 抽屉打开后焦点在层内', sheetFocus.inSheet && sheetFocus.ariaModal === 'true', JSON.stringify(sheetFocus));
  await page.evaluate(() => closeSheet());
  await page.waitForTimeout(150);

  /* ===== P1：筛选行重排 / 对比度 / 触控 / 焦点环 / canvas 语义 ===== */
  await page.evaluate(() => { switchTab('foot'); state.footBatch = { on: false, picked: {} }; refreshAll(); });
  await page.waitForTimeout(400);
  const filterRow = await page.evaluate(() => {
    var q = document.getElementById('f-q').getBoundingClientRect();
    var r = document.getElementById('f-reset').getBoundingClientRect();
    return { sameRow: Math.abs(q.top - r.top) < 6, resetRight: r.left >= q.right - 2, searchW: Math.round(q.width), resetW: Math.round(r.width) };
  });
  check('B1 重置按钮与搜索框同行右侧（不再独占一行）', filterRow.sameRow && filterRow.resetRight, JSON.stringify(filterRow));

  /* 对比度复算（ink-faint vs 卡片底） */
  const contrast = await page.evaluate(() => {
    function lum(hex) {
      const c = hex.replace('#', '');
      const v = [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }
    var faint = getComputedStyle(document.documentElement).getPropertyValue('--ink-faint').trim();
    var card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    var l1 = lum(faint), l2 = lum(card);
    return { faint: faint, ratio: +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)) };
  });
  check('B2 极弱文字对比度 ≥3:1', contrast.ratio >= 3, JSON.stringify(contrast));

  /* 焦点环为品牌焦糖 */
  const ring = await page.evaluate(() => {
    var btn = document.querySelector('#btn-add-foot');
    btn.focus();
    /* 模拟键盘聚焦（focus-visible 在程序聚焦时也生效于 Chromium 的部分场景，改用键盘 Tab 前先标记） */
    var cs = getComputedStyle(btn);
    return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor };
  });
  check('B3 焦点环为焦糖色 2px', /rgb\(200, 118, 60\)|#C8763C/i.test(ring.outline) && /2px/.test(ring.outline), JSON.stringify(ring));

  /* 表单内联错误 */
  const err = await page.evaluate(() => {
    openFootprintModal(null, '', '');
    document.getElementById('fm-save').click();
    var row = document.getElementById('fm-prov').closest('.form-row');
    return {
      hasError: row.classList.contains('has-error'),
      ariaInvalid: document.getElementById('fm-prov').getAttribute('aria-invalid'),
      errText: (row.querySelector('.form-err') || {}).textContent || '',
      focusId: document.activeElement ? document.activeElement.id : ''
    };
  });
  check('B4 校验失败有内联错误 + aria-invalid + 聚焦字段', err.hasError && err.ariaInvalid === 'true' && !!err.errText && err.focusId === 'fm-prov', JSON.stringify(err));
  const cleared = await page.evaluate(() => {
    var el = document.getElementById('fm-prov');
    el.value = '浙江省';
    el.dispatchEvent(new Event('change'));
    var row = el.closest('.form-row');
    return { hasError: row.classList.contains('has-error'), hint: !!row.querySelector('.form-err') };
  });
  check('B5 修正字段后错误提示自动清除', !cleared.hasError && !cleared.hint, JSON.stringify(cleared));
  await page.evaluate(() => closeModal());

  /* canvas 语义 */
  const canvasAria = await page.evaluate(() => {
    var c = document.querySelector('#china-map canvas');
    return { role: c.getAttribute('role'), label: c.getAttribute('aria-label') };
  });
  check('B6 地图 canvas 有 role=img 与动态描述', canvasAria.role === 'img' && /已点亮 \d+ 个省级行政区/.test(canvasAria.label || ''), JSON.stringify(canvasAria));

  /* 移动端触控高度 */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { switchTab('foot'); refreshAll(); });
  await page.waitForTimeout(400);
  const touch = await page.evaluate(() => {
    var out = {};
    ['.foot-item .f-ops .btn.small', '#f-reset', '#book-shuffle'].forEach(function (s) {
      var el = document.querySelector(s);
      /* 隐藏 Tab 中的元素不参与判定 */
      out[s] = (el && el.offsetParent !== null) ? Math.round(el.getBoundingClientRect().height) : null;
    });
    return out;
  });
  const touchOk = Object.keys(touch).every(function (k) { return touch[k] === null || touch[k] >= 44; });
  check('B7 移动端小按钮高度 ≥44px', touchOk, JSON.stringify(touch));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);

  /* ===== P2-A：侧边栏位置恒定 / 徽章入口 / 卡片底行 ===== */
  await page.evaluate(() => switchTab('archive'));
  await page.waitForTimeout(400);
  const navTop = () => page.evaluate(() => Math.round(document.getElementById('bottomnav').getBoundingClientRect().top));
  const t0 = await navTop();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(250);
  const t1 = await navTop();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  /* 切换同步状态条（此前会导致导航上下跳 37px） */
  await page.evaluate(() => { state.online = true; Sync.readOnly = false; Sync.queue = []; Sync.dead = []; renderSyncStatus(); });
  await page.waitForTimeout(350);
  const t2 = await navTop();
  await page.evaluate(() => { state.online = false; renderSyncStatus(); });
  await page.waitForTimeout(350);
  const t3 = await navTop();
  await page.evaluate(() => switchTab('foot'));
  await page.waitForTimeout(350);
  const t4 = await navTop();
  check('C1 桌面侧边栏位置恒定（滚动/切 Tab/同步条切换均不动）', [t0, t1, t2, t3, t4].every(v => v === t0), [t0, t1, t2, t3, t4].join(','));
  /* 状态条隐藏时与内容标题对齐（允许 10px 内视觉误差） */
  await page.evaluate(() => { state.online = true; Sync.readOnly = false; Sync.queue = []; Sync.dead = []; renderSyncStatus(); });
  await page.waitForTimeout(350);
  const align = await page.evaluate(() => {
    var nav = document.getElementById('bottomnav').getBoundingClientRect();
    var h = document.querySelector('#view-foot h2').getBoundingClientRect();
    return { delta: Math.round(h.top - nav.top), achMore: (document.getElementById('save-ach-more') || {}).textContent };
  });
  check('C1b 侧边栏与内容标题对齐', Math.abs(align.delta) <= 10, 'delta=' + align.delta);
  /* 状态条显示时也不应把内容推下（悬浮胶囊） */
  await page.evaluate(() => { state.online = false; renderSyncStatus(); });
  await page.waitForTimeout(350);
  const align2 = await page.evaluate(() => {
    var nav = document.getElementById('bottomnav').getBoundingClientRect();
    var h = document.querySelector('#view-foot h2').getBoundingClientRect();
    var bar = document.getElementById('sync-bar');
    return { delta: Math.round(h.top - nav.top), barVisible: bar ? !bar.classList.contains('hidden') : false };
  });
  check('C1c 状态条显示时内容与侧边栏仍对齐（不占行）', Math.abs(align2.delta) <= 10, JSON.stringify(align2));
  await page.evaluate(() => switchTab('archive'));
  await page.waitForTimeout(300);
  check('C2 存档卡有「全部 N 枚」成就入口', /全部 \d+ 枚/.test(align.achMore || ''), align.achMore);

  await page.evaluate(() => switchTab('foot'));
  await page.waitForTimeout(400);
  const footRow = await page.evaluate(() => {
    var c = document.querySelector('.foot-item');
    var ops = c.querySelector('.f-ops');
    var tags = c.querySelector('.f-tags');
    if (!ops || !tags) return { missing: true };
    var a = ops.getBoundingClientRect(), b = tags.getBoundingClientRect();
    return { sameRow: Math.abs(a.top - b.top) < 8, opsRight: a.left > b.left, opsCount: ops.querySelectorAll('button').length };
  });
  check('C3 卡片底行：标签左 / 操作区右且同行', !footRow.missing && footRow.sameRow && footRow.opsRight && footRow.opsCount >= 3, JSON.stringify(footRow));

  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' ; '));
  console.log('===== A11Y SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
