/* 旅行工作台 · 运行时冒烟测试（Playwright + 本地 Chromium）
 * 覆盖：基础渲染 / 四个反馈问题修复验证 / 回归 */
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
const FILE = path.resolve(__dirname, '..', 'index.html');
const PAGE_URL = url.pathToFileURL(FILE).href;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /* ===== 0. 加载计时（问题3） ===== */
  const t0 = Date.now();
  await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30000 });
  let tMap = 0, tToday = 0;
  for (let i = 0; i < 100; i++) {
    const st = await page.evaluate(() => ({
      map: document.querySelectorAll('#china-map canvas').length,
      today: (document.getElementById('today-card').textContent || '').indexOf('今天要处理') >= 0
    }));
    if (st.map && !tMap) tMap = Date.now() - t0;
    if (st.today && !tToday) tToday = Date.now() - t0;
    if (tMap && tToday) break;
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1200);
  check('加载性能：地图 canvas 快速可见', tMap > 0 && tMap < 2500, 'map=' + tMap + 'ms');
  check('加载性能：首屏数据区快速渲染', tToday > 0 && tToday < 2500, 'today=' + tToday + 'ms');

  /* ===== 1. 基础资源与地图 ===== */
  const basics = await page.evaluate(() => ({
    echarts: typeof window.echarts !== 'undefined',
    geo: !!(window.CHINA_GEO && window.CHINA_GEO.features && window.CHINA_GEO.features.length),
    mapCanvas: document.querySelectorAll('#china-map canvas').length,
    loadingHidden: document.getElementById('map-loading').classList.contains('hidden'),
    extScripts: document.querySelectorAll('script[src]').length
  }));
  check('ECharts 已内联加载', basics.echarts);
  const geoCount = await page.evaluate(() => (window.CHINA_GEO && window.CHINA_GEO.features) ? window.CHINA_GEO.features.length : 0);
  check('中国 GeoJSON 已内联（35 要素含南海诸岛）', basics.geo && geoCount === 35, 'features=' + geoCount);
  check('地图 Canvas 已渲染', basics.mapCanvas > 0, 'canvas=' + basics.mapCanvas);
  check('地图加载遮罩已移除', basics.loadingHidden);
  check('零外部脚本（单文件自包含，无任何 CDN / SDK 依赖）', basics.extScripts === 0, 'src scripts=' + basics.extScripts);

  /* ===== 2. 首页内容 ===== */
  const home = await page.evaluate(() => ({
    today: document.getElementById('today-card').textContent,
    stats: document.getElementById('stats-bar').textContent,
    recent: document.getElementById('recent-body').children.length,
    lsKeys: Object.keys(localStorage).filter(k => k.indexOf('td_') === 0).length,
    overdue: document.querySelectorAll('.today-item.overdue').length
  }));
  check('「今天要处理」置顶渲染', home.today.indexOf('今天要处理') >= 0);
  check('统计条点亮数字', home.stats.indexOf('已点亮') >= 0, home.stats.replace(/\s+/g, ' ').slice(0, 50));
  check('最近足迹 3 条', home.recent === 3, 'items=' + home.recent);
  check('localStorage 缓存已写入', home.lsKeys >= 1, 'keys=' + home.lsKeys);
  check('逾期任务红色标注', home.overdue >= 1, 'overdue=' + home.overdue);

  /* ===== 3. 悬浮浮层 vs 点击（问题2） ===== */
  const mapBox = await page.evaluate(() => {
    const c = document.querySelector('#china-map canvas');
    const r = c.getBoundingClientRect();
    /* 用经纬度换算精确命中山东省，不依赖容器宽高比（桌面侧边栏布局也可用） */
    const px = (window.mapChart && window.mapChart.convertToPixel({ geoIndex: 0 }, [118.0, 36.4])) || [r.width * 0.62, r.height * 0.42];
    return { x: r.left + px[0], y: r.top + px[1] };
  });
  await page.mouse.move(mapBox.x - 30, mapBox.y - 20);
  await page.mouse.move(mapBox.x, mapBox.y);
  await page.waitForTimeout(350);
  const hover1 = await page.evaluate(() => ({
    hoverVisible: !document.getElementById('hover-card').classList.contains('hidden'),
    hoverText: (document.getElementById('hover-card').textContent || '').slice(0, 30),
    sheetCount: document.querySelectorAll('#sheet-root .sheet').length,
    maskCount: document.querySelectorAll('#sheet-mask').length
  }));
  check('悬浮显示轻量浮层（非遮罩抽屉）', hover1.hoverVisible && hover1.sheetCount === 0 && hover1.maskCount === 0, hover1.hoverText);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(350);
  const hover2 = await page.evaluate(() => document.getElementById('hover-card').classList.contains('hidden'));
  check('移出地图后浮层隐藏', hover2);

  /* 点击 → 选中 + 底部抽屉 */
  await page.mouse.click(mapBox.x, mapBox.y);
  await page.waitForTimeout(500);
  const click1 = await page.evaluate(() => ({
    sheet: !!document.querySelector('#sheet-root .sheet'),
    selProv: window.state.selProvince,
    hoverHidden: document.getElementById('hover-card').classList.contains('hidden')
  }));
  check('点击省份弹出足迹抽屉', click1.sheet);
  check('点击后记录选中省份（持续高亮状态）', !!click1.selProv, click1.selProv);
  check('点击时浮层隐藏', click1.hoverHidden);
  await page.screenshot({ path: 'smoke_province_panel.png' });
  await page.click('#sheet-mask');
  await page.waitForTimeout(300);

  /* ===== 4. Tab 切换 ===== */
  for (const [tab, view] of [['foot', 'view-foot'], ['trip', 'view-trip'], ['archive', 'view-archive'], ['map', 'view-map']]) {
    await page.click(`.nav-item[data-tab="${tab}"]`);
    await page.waitForTimeout(350);
    const active = await page.evaluate(v => document.getElementById(v).classList.contains('active'), view);
    check('切换到 ' + tab + ' Tab', active);
  }

  /* ===== 5. 足迹库 ===== */
  await page.click('.nav-item[data-tab="foot"]');
  await page.waitForTimeout(300);
  const foot = await page.evaluate(() => ({
    count: document.querySelectorAll('#foot-list .foot-item').length,
    provOpts: document.getElementById('f-province').options.length
  }));
  check('足迹列表 6 条', foot.count === 6, 'count=' + foot.count);
  await page.selectOption('#f-province', '浙江省');
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => document.querySelectorAll('#foot-list .foot-item').length);
  check('按浙江省筛选 = 1 条', filtered === 1, 'count=' + filtered);
  await page.click('#f-reset');
  await page.waitForTimeout(200);

  /* ===== 6. 省市区联动（问题4） ===== */
  await page.click('#btn-add-foot');
  await page.waitForTimeout(300);
  const modalOpen = await page.evaluate(() => !!document.getElementById('fm-prov'));
  check('足迹表单打开（城市为二级联动）', modalOpen);
  await page.selectOption('#fm-prov', '青海省');
  await page.waitForTimeout(200);
  const qh = await page.evaluate(() => {
    var opts = Array.from(document.getElementById('fm-city').options).map(o => o.value);
    return { hasHangzhou: opts.indexOf('杭州市') >= 0, hasXining: opts.indexOf('西宁市') >= 0 };
  });
  check('选青海省 → 城市列表只含青海城市（无杭州市）', !qh.hasHangzhou && qh.hasXining);
  await page.selectOption('#fm-prov', '浙江省');
  await page.waitForTimeout(200);
  const zj = await page.evaluate(() => {
    var opts = Array.from(document.getElementById('fm-city').options).map(o => o.value);
    return opts.indexOf('杭州市') >= 0;
  });
  check('选浙江省 → 城市列表含杭州市', zj);
  /* 手动输入其他城市 + 归属不一致 → 保存被拦截 */
  await page.selectOption('#fm-prov', '青海省');
  await page.waitForTimeout(150);
  await page.selectOption('#fm-city', '__other__');
  await page.waitForTimeout(150);
  await page.fill('#fm-city-other', '杭州市');
  await page.click('#fm-save');
  await page.waitForTimeout(400);
  const blocked = await page.evaluate(() => ({
    modalStill: !!document.getElementById('fm-prov'),
    count: document.querySelectorAll('#foot-list .foot-item').length
  }));
  check('青海省+杭州市 保存被拦截（归属校验）', blocked.modalStill && blocked.count === 6);
  /* 合法组合保存成功 */
  await page.selectOption('#fm-prov', '浙江省');
  await page.waitForTimeout(150);
  await page.selectOption('#fm-city', '杭州市');
  await page.fill('#fm-date', '2026-10-10');
  await page.click('#fm-save');
  await page.waitForTimeout(500);
  const added = await page.evaluate(() => ({
    count: document.querySelectorAll('#foot-list .foot-item').length,
    modalClosed: !document.getElementById('fm-prov')
  }));
  check('浙江省+杭州市 保存成功', added.modalClosed && added.count === 7, 'count=' + added.count);

  /* ===== 7. 行程：详情 + 输入保持（问题1） ===== */
  await page.click('.nav-item[data-tab="trip"]');
  await page.waitForTimeout(300);
  await page.click('#trip-list .trip-item');
  await page.waitForTimeout(500);
  const detail = await page.evaluate(() => ({
    days: document.querySelectorAll('.day-block').length,
    links12306: Array.from(document.querySelectorAll('.link-btn.t12306')).map(a => a.href),
    jsLinks: Array.from(document.querySelectorAll('a[href^="javascript:"]')).length,
    brief: document.body.innerText.indexOf('行前简报') >= 0
  }));
  check('每日计划 4 天框架', detail.days === 4, 'days=' + detail.days);
  check('12306 深链格式正确', detail.links12306.some(u => u.indexOf('kyfw.12306.cn/otn/leftTicket/init') >= 0), detail.links12306[0] || 'none');
  check('无 javascript: 伪协议链接', detail.jsLinks === 0);
  check('行前简报卡片存在', detail.brief);
  /* 输入保持：填写任务标题 → 勾选任务 → 输入不丢 */
  await page.fill('#tk-title', '测试任务保留XYZ');
  await page.waitForTimeout(150);
  await page.click('.task-row .tk-check');
  await page.waitForTimeout(600);
  const kept = await page.evaluate(() => {
    var el = document.getElementById('tk-title');
    return el ? el.value : '(元素不存在)';
  });
  check('勾选任务后未提交的输入被保留', kept === '测试任务保留XYZ', 'value=' + kept);
  /* javascript: 深链输入被过滤 */
  await page.fill('#tk-title', '测试链接过滤');
  await page.fill('#tk-link', 'javascript:alert(1)');
  await page.click('#tk-add');
  await page.waitForTimeout(500);
  const jsFiltered = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="javascript:"]')).length);
  check('任务深链 javascript: 被过滤', jsFiltered === 0);

  /* ===== 8. 存档 ===== */
  await page.click('.nav-item[data-tab="archive"]');
  await page.waitForTimeout(400);
  const arch = await page.evaluate(() => ({
    saveCard: document.getElementById('save-card').textContent.replace(/\s/g, '').indexOf('TRAVELERSAVE') >= 0,
    achs: document.querySelectorAll('#ach-grid .ach-badge').length,
    achsUnlocked: document.querySelectorAll('#ach-grid .ach-badge:not(.locked)').length
  }));
  check('人物存档卡渲染', arch.saveCard);
  check('成就墙渲染（含锁定）', arch.achs >= 8, 'total=' + arch.achs);
  check('成就自动解锁（示例 4 + 自动 2）', arch.achsUnlocked === 6, 'unlocked=' + arch.achsUnlocked);
  await page.screenshot({ path: 'smoke_archive_desktop.png' });

  /* ===== 9. 移动端 ===== */
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mp.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  const tm0 = Date.now();
  await mp.goto(PAGE_URL, { waitUntil: 'load', timeout: 30000 });
  let tmMap = 0;
  for (let i = 0; i < 100; i++) {
    const n = await mp.evaluate(() => document.querySelectorAll('#china-map canvas').length);
    if (n) { tmMap = Date.now() - tm0; break; }
    await mp.waitForTimeout(50);
  }
  await mp.waitForTimeout(800);
  const mob = await mp.evaluate(() => ({
    mapCanvas: document.querySelectorAll('#china-map canvas').length,
    navFixed: getComputedStyle(document.getElementById('bottomnav')).position === 'fixed',
    today: document.getElementById('today-card').textContent.indexOf('今天要处理') >= 0
  }));
  check('移动端地图渲染', mob.mapCanvas > 0);
  check('移动端地图 < 2.5s 可见', tmMap > 0 && tmMap < 2500, 'map=' + tmMap + 'ms');
  check('移动端底部导航 fixed', mob.navFixed);
  check('移动端首页内容', mob.today);
  await mp.screenshot({ path: 'smoke_home_mobile.png' });

  /* ===== 10. 控制台错误汇总 ===== */
  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' ; '));

  await browser.close();
  const fails = results.filter(r => !r.ok).length;
  console.log('\n===== SMOKE SUMMARY: ' + (results.length - fails) + '/' + results.length + ' PASS, ' + fails + ' FAIL =====');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TEST_CRASH:', e); process.exit(2); });
