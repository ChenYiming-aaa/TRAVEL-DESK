/* 视觉基线：关键界面截图存档 + 设计不变量断言（零依赖，不引入像素比对库） */
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
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS | ' + name + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
}

const OUT = path.resolve(__dirname, 'visual_baseline');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
const PAGE = url.pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const errors = [];

  /* ---- 桌面端：四个 Tab ---- */
  const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  d.on('pageerror', e => errors.push(e.message));
  await d.goto(PAGE, { waitUntil: 'load' });
  await d.waitForTimeout(2200);

  const tokens = await d.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const keys = ['--bg', '--card', '--ink', '--ink-soft', '--ink-faint', '--caramel', '--caramel-deep', '--line', '--sel-bg', '--press-bg'];
    const o = {};
    keys.forEach(k => { o[k] = cs.getPropertyValue(k).trim(); });
    return o;
  });
  const missing = Object.keys(tokens).filter(k => !tokens[k]);
  check('V1 设计令牌齐全（含新增语义令牌）', missing.length === 0, missing.join(',') || 'all set');

  const type = await d.evaluate(() => ({
    h2: getComputedStyle(document.querySelector('#view-foot h2')).fontSize,   /* 地图页无标题，取足迹页 */
    body: getComputedStyle(document.body).fontSize,
    cardBorder: getComputedStyle(document.querySelector('.card')).borderTopWidth,
    cardRadius: getComputedStyle(document.querySelector('.card')).borderRadius
  }));
  check('V2 字号层级与卡片边线保持原设定', type.h2 === '19px' && type.cardBorder === '2px' && /6px|8px|10px/.test(type.cardRadius), JSON.stringify(type));

  for (const [tab, name] of [['map', 'desktop_map'], ['foot', 'desktop_foot'], ['trip', 'desktop_trip'], ['archive', 'desktop_archive']]) {
    await d.evaluate(t => switchTab(t), tab);
    await d.waitForTimeout(450);
    await d.screenshot({ path: path.join(OUT, name + '.png') });
  }
  await d.evaluate(() => { switchTab('trip'); state.tripDetailId = state.trips[0].id; refreshAll(); });
  await d.waitForTimeout(500);
  await d.screenshot({ path: path.join(OUT, 'desktop_trip_detail.png') });
  await d.evaluate(() => { state.tripDetailId = ''; switchTab('archive'); openFootprintModal(null, '浙江省', ''); });
  await d.waitForTimeout(450);
  await d.screenshot({ path: path.join(OUT, 'desktop_form.png') });
  await d.close();

  /* ---- 移动端：地图/足迹/快记 ---- */
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  m.on('pageerror', e => errors.push(e.message));
  await m.goto(PAGE, { waitUntil: 'load' });
  await m.waitForTimeout(2200);
  await m.screenshot({ path: path.join(OUT, 'mobile_map.png') });
  await m.evaluate(() => switchTab('foot'));
  await m.waitForTimeout(450);
  await m.screenshot({ path: path.join(OUT, 'mobile_foot.png') });
  await m.evaluate(() => { switchTab('map'); openQuickNote(); });
  await m.waitForTimeout(450);
  await m.screenshot({ path: path.join(OUT, 'mobile_quicknote.png') });

  /* ---- 三档宽度无横向溢出 ---- */
  for (const w of [375, 768, 1280]) {
    await m.setViewportSize({ width: w, height: 844 });
    await m.waitForTimeout(350);
    const ov = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('V3 ' + w + 'px 宽度无横向溢出', !ov);
  }
  await m.close();

  const shots = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  check('V4 基线截图已生成（' + shots.length + ' 张）', shots.length >= 9, shots.join(','));

  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' ; '));
  console.log('===== VISUAL SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
