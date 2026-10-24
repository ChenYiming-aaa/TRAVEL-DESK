/* 本轮 bug 修复专项回归测试（R1-R17） */
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
  await page.waitForTimeout(1200);

  /* ========== R1/R2：行程详情返回列表 & 重复进入 ========== */
  await page.click('.nav-item[data-tab="trip"]');
  await page.waitForTimeout(300);
  const tripCount = await page.evaluate(() => document.querySelectorAll('#trip-list .trip-item').length);
  await page.evaluate(() => { document.querySelectorAll('#trip-list .trip-item')[0].click(); });
  await page.waitForTimeout(400);
  const detailShown = await page.evaluate(() => !document.getElementById('trip-detail').classList.contains('hidden'));
  await page.evaluate(() => { document.getElementById('td-back').click(); });
  await page.waitForTimeout(400);
  const listAfterBack = await page.evaluate(() => document.querySelectorAll('#trip-list .trip-item').length);
  check('R1 详情返回列表后列表非空（SIG 重置修复）', detailShown && listAfterBack === tripCount, 'detail=' + detailShown + ' list=' + listAfterBack + '/' + tripCount);
  /* 再次进入同一行程详情 */
  await page.evaluate(() => { document.querySelectorAll('#trip-list .trip-item')[0].click(); });
  await page.waitForTimeout(400);
  const detailAgain = await page.evaluate(() => !document.getElementById('trip-detail').classList.contains('hidden') && document.querySelectorAll('#trip-detail .day-block').length);
  check('R2 重复进入同一行程详情正常渲染', !!detailAgain, 'day-blocks=' + detailAgain);
  await page.evaluate(() => { document.getElementById('td-back').click(); });
  await page.waitForTimeout(200);

  /* ========== R3：extractCities 误报防护 ========== */
  const ex = await page.evaluate(() => ({
    hokkaido: extractCities('去北海道看雪'),
    dali: extractCities('大理寺香火很旺'),
    beihai: extractCities('北海公园划船'),
    cd: extractCities('成都东站 乘高铁'),
    hk: extractCities('香港迪士尼'),
    xishuangbanna: extractCities('西双版纳傣族自治州度假')
  }));
  check('R3a 北海道不误报北海', ex.hokkaido.indexOf('北海市') < 0, JSON.stringify(ex.hokkaido));
  check('R3b 大理寺不误报大理', ex.dali.indexOf('大理市') < 0 && ex.dali.indexOf('大理白族自治州') < 0, JSON.stringify(ex.dali));
  check('R3c 北海公园不误报北海', ex.beihai.indexOf('北海市') < 0, JSON.stringify(ex.beihai));
  check('R3d 成都东站识别成都', ex.cd.indexOf('成都市') >= 0, JSON.stringify(ex.cd));
  check('R3e 香港识别香港特别行政区', ex.hk.indexOf('香港特别行政区') >= 0, JSON.stringify(ex.hk));
  check('R3f 西双版纳识别州', ex.xishuangbanna.indexOf('西双版纳傣族自治州') >= 0, JSON.stringify(ex.xishuangbanna));

  /* ========== R4：stripCitySuffix ========== */
  const strip = await page.evaluate(() => ({
    hk: stripCitySuffix('香港特别行政区'), xsn: stripCitySuffix('西双版纳傣族自治州'),
    dali: stripCitySuffix('大理白族自治州'), hz: stripCitySuffix('杭州市'), yb: stripCitySuffix('巴音郭楞蒙古自治州')
  }));
  check('R4 复合后缀剥离正确', strip.hk === '香港' && strip.xsn === '西双版纳' && strip.dali === '大理' && strip.hz === '杭州' && strip.yb === '巴音郭楞', JSON.stringify(strip));

  /* ========== R5：normDate 时区 ========== */
  const nd = await page.evaluate(() => ({
    utcMid: normDate('2026-10-02T00:00:00Z'),
    utcLate: normDate('2026-10-02T16:00:00Z'),
    dateOnly: normDate('2026-10-02'),
    bad: normDate('not-a-date')
  }));
  check('R5 normDate 时区安全', nd.utcMid === '2026-10-02' && nd.utcLate === '2026-10-02' && nd.dateOnly === '2026-10-02' && nd.bad.length <= 10, JSON.stringify(nd));

  /* ========== R6：toast aria-live ========== */
  const toastAria = await page.evaluate(() => {
    toast('aria 测试');
    var el = document.querySelector('#toast-root .toast');
    return el ? { role: el.getAttribute('role'), live: el.getAttribute('aria-live') } : null;
  });
  check('R6 toast 有 role=status/aria-live', toastAria && toastAria.role === 'status' && toastAria.live === 'polite', JSON.stringify(toastAria));

  /* ========== R7：模态层级高于抽屉 ========== */
  const z = await page.evaluate(() => {
    showSheet('测试', '<button id="ztest-del">删</button>');
    document.getElementById('ztest-del').onclick = function () { confirmDialog('确认', ['x'], function () { }); };
    document.getElementById('ztest-del').click();
    return {
      modalRoot: getComputedStyle(document.getElementById('modal-root')).zIndex,
      sheet: getComputedStyle(document.querySelector('#sheet-root .sheet')).zIndex,
      modal: getComputedStyle(document.querySelector('#modal-root .modal')).zIndex
    };
  });
  check('R7 模态层级高于抽屉（隔离生效）', +z.modalRoot > +z.sheet && +z.modal > +z.sheet, JSON.stringify(z));
  await page.evaluate(() => { closeModal(); closeSheet(); });

  /* ========== R8：省市联动（武夷山/青海不含杭州） ========== */
  await page.click('.nav-item[data-tab="foot"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('btn-add-foot').click());
  await page.waitForTimeout(300);
  const linkage = await page.evaluate(() => {
    function opts(prov) {
      document.getElementById('fm-prov').value = prov;
      document.getElementById('fm-prov').dispatchEvent(new Event('change'));
      return Array.from(document.getElementById('fm-city').options).map(o => o.value);
    }
    var fj = opts('福建省'), qh = opts('青海省');
    return { wuyi: fj.indexOf('武夷山市') >= 0, hzInQh: qh.indexOf('杭州市') >= 0, xnInQh: qh.indexOf('西宁市') >= 0 };
  });
  check('R8a 福建省可选武夷山市', linkage.wuyi, JSON.stringify(linkage));
  check('R8b 青海省不可选杭州市', !linkage.hzInQh && linkage.xnInQh, JSON.stringify(linkage));

  /* ========== R9：坐标全覆盖 ========== */
  const coordCov = await page.evaluate(() => {
    var miss = [];
    Object.keys(PROVINCE_CITIES).forEach(p => PROVINCE_CITIES[p].forEach(c => { if (!CITY_COORDS[c]) miss.push(c); }));
    return miss;
  });
  check('R9 377 城坐标全覆盖（散点无缺失）', coordCov.length === 0, 'missing=' + coordCov.length);

  /* ========== R10：未来日期拦截 + max 属性 ========== */
  const future = await page.evaluate(() => {
    document.getElementById('fm-prov').value = '浙江省';
    document.getElementById('fm-prov').dispatchEvent(new Event('change'));
    document.getElementById('fm-city').value = '杭州市';
    var d = new Date(); d.setDate(d.getDate() + 7);
    var futureStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    document.getElementById('fm-date').value = futureStr;
    var max = document.getElementById('fm-date').getAttribute('max');
    var today = todayStr();
    var before = state.footprints.length;
    document.getElementById('fm-save').click();
    return { max: max, today: today, blocked: state.footprints.length === before, modalStill: !!document.querySelector('#modal-root .modal') };
  });
  check('R10a 日期输入有 max=today', future.max === future.today, 'max=' + future.max);
  check('R10b 未来日期保存被拦截', future.blocked && future.modalStill, JSON.stringify(future));
  await page.evaluate(() => { var c = document.getElementById('modal-close'); if (c) c.click(); });
  await page.waitForTimeout(200);

  /* ========== R11：触屏双击空白复位（zr 事件模拟） ========== */
  const dblReset = await page.evaluate(async () => {
    mapChart.setOption({ geo: { zoom: 4, center: [110, 36] } });
    await new Promise(r => setTimeout(r, 100));
    var zr = mapChart.getZr();
    zr.trigger('click', { target: null });
    zr.trigger('click', { target: null });
    await new Promise(r => setTimeout(r, 200));
    var o = mapChart.getOption();
    return o.geo[0].zoom;
  });
  check('R11 双击空白复位（含触屏路径）', Math.abs(dblReset - 1.18) < 0.01, 'zoom=' + dblReset);

  /* ========== R12：upsert 入队并持久化（本地版：写队列刷新不丢） ========== */
  const ro = await page.evaluate(() => {
    var before = Sync.queue.length;
    queueWrite({ table: 'footprints', action: 'upsert', id: 'fp_rotest' });
    var queued = Sync.queue.some(o => o.id === 'fp_rotest');
    var persisted = (localStorage.getItem('td_queue') || '').indexOf('fp_rotest') >= 0;
    /* 清理 */
    Sync.queue = Sync.queue.filter(o => o.id !== 'fp_rotest');
    saveSyncState();
    return { before: before, queued: queued, persisted: persisted };
  });
  check('R12 upsert 入队并持久化到 localStorage', ro.queued && ro.persisted, JSON.stringify(ro));

  /* ========== R13：remove 入队并留墓碑（本地版：导入合并时跳过已删 id） ========== */
  const rm = await page.evaluate(() => {
    var fid = state.footprints[0].id;
    var rec = state.footprints[0];
    state.footprints = state.footprints.filter(f => f.id !== fid);
    queueWrite({ table: 'footprints', action: 'remove', id: fid, recId: rec.recId });
    var queued = Sync.queue.some(o => o.action === 'remove' && o.id === fid);
    var grave = Sync.graveyard && Sync.graveyard['footprints|' + fid] !== undefined;
    var gone = !state.footprints.some(f => f.id === fid);
    /* 清理 */
    Sync.queue = Sync.queue.filter(o => o.id !== fid);
    delete Sync.graveyard['footprints|' + fid];
    saveSyncState();
    state.footprints.unshift(rec);
    return gone && queued && grave;
  });
  check('R13 remove 入队留墓碑且记录即删', rm);

  /* ========== R14：本地编辑即时落缓存（刷新后可恢复） ========== */
  const profProt = await page.evaluate(() => {
    var oldNick = state.profile.nick;
    state.profile.nick = '本地新昵称';
    queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
    cacheSaveNow();   /* 立即落盘（绕过防抖） */
    var cached = cacheLoad();
    var persisted = cached && cached.profile && cached.profile.nick === '本地新昵称';
    state.profile.nick = oldNick;
    Sync.queue = Sync.queue.filter(o => o.table !== 'profile');
    saveSyncState();
    cacheSaveNow();
    return persisted;
  });
  check('R14 profile 本地编辑即时落缓存', profProt);

  /* ========== R15：成就计数只算规则内 ========== */
  const achCount = await page.evaluate(() => {
    var before = document.getElementById('ach-count').textContent;
    state.achievements.push({ id: 'ach_custom', name: '自定义成就', icon: '🏅', desc: 'x', date: '2026-10-23' });
    renderAchGrid();
    var after = document.getElementById('ach-count').textContent;
    state.achievements = state.achievements.filter(a => a.id !== 'ach_custom');
    renderAchGrid();
    return { before: before, after: after };
  });
  check('R15 成就计数只统计规则内成就', achCount.before === achCount.after, JSON.stringify(achCount));

  /* ========== R16：profile 为 null 时悬浮卡不崩 ========== */
  const nullProf = await page.evaluate(() => {
    var saved = state.profile;
    state.profile = null;
    var err1 = null, err2 = null;
    try { showHoverCard('山东省'); } catch (e) { err1 = String(e); }
    try { openProvincePanel('山东省', true); } catch (e) { err2 = String(e); }
    state.profile = saved;
    closeSheet();
    return { err1: err1, err2: err2 };
  });
  check('R16 profile null 时地图悬浮/面板不崩溃', !nullProf.err1 && !nullProf.err2, JSON.stringify(nullProf));

  /* ========== R17：队列按身份去重（同 table+id 二次写只留最新） ========== */
  const idDeq = await page.evaluate(() => {
    var q = Sync.queue;
    Sync.queue = [];
    queueWrite({ table: 'footprints', action: 'upsert', id: 'a' });
    queueWrite({ table: 'footprints', action: 'upsert', id: 'b' });
    queueWrite({ table: 'footprints', action: 'upsert', id: 'a' });   /* 二次编辑 a：应替换而非追加 */
    var countA = Sync.queue.filter(o => o.id === 'a').length;
    var total = Sync.queue.length;
    /* remove 与 upsert 同 id 应并存（不同 action） */
    queueWrite({ table: 'footprints', action: 'remove', id: 'a', recId: 'r1' });
    var coexist = Sync.queue.filter(o => o.id === 'a').length === 2;
    Sync.queue = q;
    saveSyncState();
    return countA === 1 && total === 2 && coexist;
  });
  check('R17 队列按身份去重（upsert 替换 / remove 并存）', idDeq);

  /* ========== 无 JS 错误 ========== */
  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' ; '));

  console.log('===== REGRESS SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
