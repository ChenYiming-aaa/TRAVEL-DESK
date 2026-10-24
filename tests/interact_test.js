/* 交互优化专项测试（interact）—— 按计划逐任务累积用例 */
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

  /* ========== T1 足迹搜索 ========== */
  await page.click('.nav-item[data-tab="foot"]');
  await page.waitForTimeout(300);
  await page.fill('#f-q', '西湖');
  await page.waitForTimeout(500);
  const n1 = await page.evaluate(() => document.querySelectorAll('#foot-list .foot-item').length);
  check('T1a 搜索「西湖」只出含西湖的记录', n1 === 1, 'n=' + n1);
  await page.fill('#f-q', '不存在的词xyz');
  await page.waitForTimeout(500);
  const empty = await page.evaluate(() => document.getElementById('foot-empty').textContent.indexOf('没有含') >= 0);
  check('T1b 空结果显示引导文案', empty);
  await page.evaluate(() => document.getElementById('f-reset').click());
  await page.waitForTimeout(400);
  const nAll = await page.evaluate(() => document.querySelectorAll('#foot-list .foot-item').length);
  const qVal = await page.evaluate(() => document.getElementById('f-q').value);
  check('T1c 重置清空搜索与筛选', nAll === 6 && qVal === '', 'n=' + nAll + ' q="' + qVal + '"');

  /* ========== T2 卡片整卡点开编辑 ========== */
  const t2 = await page.evaluate(() => {
    var card = document.querySelector('#foot-list .foot-item');
    if (!card) return { ok: false, why: 'no card' };
    card.click();
    return { ok: true };
  });
  await page.waitForTimeout(400);
  const modalTitle = await page.evaluate(() => {
    var el = document.querySelector('#modal-root .sheet-head .s-title');
    return el ? el.textContent : '';
  });
  check('T2 点击卡片空白处打开编辑模态', t2.ok && modalTitle.indexOf('编辑足迹') >= 0, modalTitle);
  await page.evaluate(() => { var c = document.getElementById('fm-cancel'); if (c) c.click(); });

  /* ========== T3 toast 上限 2 条 + 确认类静默 ========== */
  const cnt = await page.evaluate(() => {
    toast('第一条'); toast('第二条'); toast('第三条'); toast('第四条');
    return document.querySelectorAll('#toast-root .toast').length;
  });
  check('T3a 同屏 toast ≤ 2', cnt <= 2, 'n=' + cnt);
  const delSilent = await page.evaluate(() => {
    Array.prototype.forEach.call(document.querySelectorAll('#toast-root .toast'), function (t) { t.remove(); });
    state.footprints.push({ id: 'fp_t3', province: '浙江省', city: '杭州市', date: '2026-10-01', note: 't3', tags: [], tripId: '' });
    refreshAll();
    var card = Array.from(document.querySelectorAll('#foot-list .foot-item')).filter(function (c) { return c.textContent.indexOf('t3') >= 0; })[0];
    if (!card) return { err: 'no card' };
    var del = card.querySelector('[data-del]');
    if (!del) return { err: 'no del btn' };
    del.click();
    var ok = document.getElementById('cf-ok');
    if (ok) ok.click();
    return { n: document.querySelectorAll('#toast-root .toast').length };
  });
  check('T3b 删除足迹不弹确认 toast', delSilent.n === 0, JSON.stringify(delSilent));

  /* ========== T4 快捷键 ========== */
  const hkdbg = await page.evaluate(() => {
    window.__hklog = [];
    document.addEventListener('keydown', function (e) {
      window.__hklog.push({ key: e.key, target: (e.target && e.target.tagName) + '#' + (e.target && e.target.id || '') });
    });
    switchTab('map');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();  /* 移出输入框，模拟桌面正常操作态 */
    return true;
  });
  await page.keyboard.press('2');
  await page.waitForTimeout(300);
  const hkInfo = await page.evaluate(() => ({ tab: activeTab, log: window.__hklog }));
  check('T4a 按 2 切到足迹 Tab', hkInfo.tab === 'foot', JSON.stringify(hkInfo));
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'f-q');
  check('T4b 按 / 聚焦足迹搜索', focused);
  await page.evaluate(() => {
    switchTab('map');
    var ta = document.createElement('input');
    ta.id = 'tmp-input'; document.body.appendChild(ta); ta.focus();
  });
  await page.keyboard.press('3');
  const stillMap = await page.evaluate(() => activeTab === 'map');
  check('T4c 输入框聚焦时数字键不切 Tab', stillMap);
  await page.evaluate(() => { var t = document.getElementById('tmp-input'); if (t) t.remove(); });

  /* ========== T5 想去集中管理 ========== */
  const want = await page.evaluate(() => {
    if (!state.profile) return '';
    if ((state.profile.want || []).indexOf('贵州省') < 0) {
      state.profile.want = (state.profile.want || []).concat(['贵州省']);
      queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
    }
    refreshAll();
    var tg = document.getElementById('want-toggle');
    return tg ? tg.textContent : '';
  });
  check('T5a 旅行者卡出现想去管理入口', want.indexOf('想去清单') >= 0, want);
  await page.evaluate(() => document.getElementById('want-toggle').click());
  const rowVisible = await page.evaluate(() => !document.getElementById('want-list').classList.contains('hidden'));
  check('T5b 展开想去列表', rowVisible);
  const locate = await page.evaluate(() => {
    var btn = document.querySelector('[data-wantgo="贵州省"]');
    if (!btn) return { sel: null, sheet: false };
    btn.click();
    return { sel: state.selProvince, sheet: !!document.querySelector('#sheet-root .sheet') };
  });
  check('T5c 「定位」选中省份并开抽屉', locate.sel === '贵州省' && locate.sheet, JSON.stringify(locate));
  await page.evaluate(() => { closeSheet(); });
  const cancel = await page.evaluate(() => {
    var btn = document.querySelector('[data-wantdel="贵州省"]');
    if (!btn) return false;
    btn.click();
    return (state.profile.want || []).indexOf('贵州省') < 0;
  });
  check('T5d 「取消」移出想去', cancel);

  /* ========== T6 想去可视化 ========== */
  const vis = await page.evaluate(() => {
    if ((state.profile.want || []).indexOf('贵州省') < 0) {
      state.profile.want = (state.profile.want || []).concat(['贵州省']);
      queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
    }
    refreshAll();
    return new Promise(function (res) {
      setTimeout(function () {
        var opt = mapChart.getOption();
        var mapData = opt.series[0].data;
        var gz = mapData.filter(function (d) { return d.name === '贵州省'; })[0] || {};
        var pins = opt.series[2] ? opt.series[2].data : [];
        res({
          dashed: !!(gz.itemStyle && gz.itemStyle.borderType === 'dashed'),
          pinCount: pins.length,
          pinOnGuizhou: pins.some(function (p) { return p.name === '贵州省'; })
        });
      }, 300);
    });
  });
  check('T6a 想去省份虚线省界', vis.dashed, JSON.stringify(vis));
  check('T6b 图钉层含想去省', vis.pinCount >= 1 && vis.pinOnGuizhou, JSON.stringify(vis));

  /* ========== T7 快记抽屉 ========== */
  const qnBefore = await page.evaluate(() => state.footprints.length);
  await page.evaluate(() => { switchTab('map'); openQuickNote(); });
  await page.waitForTimeout(300);
  const sheetOk = await page.evaluate(() => !!document.querySelector('#sheet-root .sheet'));
  check('T7a 快记抽屉打开', sheetOk);
  await page.evaluate(() => {
    document.getElementById('qn-prov').value = '云南省';
    document.getElementById('qn-prov').dispatchEvent(new Event('change'));
    document.getElementById('qn-city').value = '昆明市';
    document.getElementById('qn-note').value = '菌子季的昆明';
    document.getElementById('qn-save').click();
  });
  await page.waitForTimeout(500);
  const qnAfter = await page.evaluate(() => ({
    n: state.footprints.length,
    sheetClosed: !document.querySelector('#sheet-root .sheet'),
    last: state.footprints[0] || {}
  }));
  check('T7b 保存后足迹+1 且抽屉关闭', qnAfter.n === qnBefore + 1 && qnAfter.sheetClosed && qnAfter.last.city === '昆明市', JSON.stringify({ before: qnBefore, after: qnAfter.n }));
  const qnToast = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#toast-root .toast'), function (t) { return t.textContent; }));
  const qnHasConfirm = qnToast.some(function (t) { return /已保存|已更新|已记录|已添加/.test(t); });
  check('T7c 保存无确认类 toast（D12；EXP 飘字在 D11 落地）', !qnHasConfirm, JSON.stringify(qnToast));
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.keyboard.press('n');
  await page.waitForTimeout(300);
  const nOpens = await page.evaluate(() => !!document.querySelector('#sheet-root .sheet'));
  check('T7d 按 n 开快记抽屉', nOpens);
  await page.evaluate(() => { document.getElementById('qn-cancel').click(); });
  /* 清理 T7 测试足迹 */
  await page.evaluate(() => {
    var i = state.footprints.findIndex(function (f) { return f.note === '菌子季的昆明'; });
    if (i >= 0) {
      var rec = state.footprints[i];
      state.footprints.splice(i, 1);
      queueWrite({ table: 'footprints', action: 'remove', id: rec.id, recId: rec.recId });
      refreshAll();
    }
  });

  /* ========== T8 新建行程模板 ========== */
  await page.evaluate(() => switchTab('trip'));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('btn-add-trip').click());
  await page.waitForTimeout(300);
  const tplOk = await page.evaluate(() => !!document.getElementById('tm-template'));
  check('T8a 新建模态含模板选择', tplOk);
  await page.evaluate(() => {
    document.getElementById('tm-title').value = '周末测试';
    document.getElementById('tm-template').value = 'weekend';
    document.getElementById('tm-template').dispatchEvent(new Event('change'));
    document.getElementById('tm-save').click();
  });
  await page.waitForTimeout(600);
  const tripTpl = await page.evaluate(() => {
    var t = state.trips.filter(function (x) { return x.title === '周末测试'; })[0];
    if (!t) return null;
    return { days: t.days.length, lastTransit: (t.days[t.days.length - 1].items || []).some(function (i) { return i.type === 'transit'; }) };
  });
  check('T8b 周末模板生成 2 天且末日在途占位', tripTpl && tripTpl.days === 2 && tripTpl.lastTransit, JSON.stringify(tripTpl));
  await page.evaluate(() => {
    var t = state.trips.filter(function (x) { return x.title === '周末测试'; })[0];
    if (t) {
      state.trips = state.trips.filter(function (x) { return x.id !== t.id; });
      queueWrite({ table: 'trips', action: 'remove', id: t.id, recId: t.recId });
      state.tripDetailId = '';
      refreshAll();
    }
  });

  /* ========== T9 大行程分页 ========== */
  const pg = await page.evaluate(() => {
    var days = [];
    for (var i = 1; i <= 20; i++) days.push({ date: '2026-12-' + String(i).padStart(2, '0'), items: [] });
    state.trips.push({ id: 'trip_pg', title: '分页测试', start: '2026-12-01', end: '2026-12-20', provinces: [], budget: 0, status: '草稿', days: days });
    state.tripDetailId = 'trip_pg';
    refreshAll();
    return new Promise(function (res) {
      setTimeout(function () {
        res({
          shown: document.querySelectorAll('#trip-detail .day-block').length,
          more: !!document.getElementById('td-more-days'),
          moreText: document.getElementById('td-more-days') ? document.getElementById('td-more-days').textContent : ''
        });
      }, 400);
    });
  });
  check('T9a 20 天行程默认渲染 7 天 + 加载更多', pg.shown === 7 && pg.more, JSON.stringify(pg));
  await page.evaluate(() => document.getElementById('td-more-days').click());
  await page.waitForTimeout(400);
  const pg2 = await page.evaluate(() => document.querySelectorAll('#trip-detail .day-block').length);
  check('T9b 点击加载更多渲染 14 天', pg2 === 14, 'n=' + pg2);

  /* ========== T10 行程分享 ========== */
  const shBtn = await page.evaluate(() => !!document.getElementById('td-share'));
  check('T10a 详情页有分享按钮', shBtn);
  await page.evaluate(() => document.getElementById('td-share').click());
  await page.waitForTimeout(300);
  const shOpts = await page.evaluate(() => ({ text: !!document.getElementById('share-text-btn'), img: !!document.getElementById('share-img-btn') }));
  check('T10b 分享抽屉两选项', shOpts.text && shOpts.img, JSON.stringify(shOpts));
  await page.evaluate(() => document.getElementById('share-text-btn').click());
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => window.__lastCopied || '');
  check('T10c 分享文本含标题与 DAY 速览', clip.indexOf('DAY 1') >= 0 && clip.indexOf('分页测试') >= 0, clip.slice(0, 40));
  /* 清理分页测试行程 */
  await page.evaluate(() => {
    state.trips = state.trips.filter(function (x) { return x.id !== 'trip_pg'; });
    state.tripDetailId = '';
    queueWrite({ table: 'trips', action: 'remove', id: 'trip_pg', recId: undefined });
    refreshAll();
  });

  /* ========== T11 足迹批量操作 ========== */
  const b0 = await page.evaluate(() => {
    state.footprints.push({ id: 'fp_batch_1', province: '浙江省', city: '杭州市', date: '2026-03-01', note: '批量1', tags: [], tripId: '' });
    state.footprints.push({ id: 'fp_batch_2', province: '浙江省', city: '杭州市', date: '2026-03-02', note: '批量2', tags: [], tripId: '' });
    state.footBatch = { on: true, picked: { fp_batch_1: 1, fp_batch_2: 1 } };
    switchTab('foot');
    refreshAll();
    return new Promise(function (res) {
      setTimeout(function () {
        res({
          boxes: document.querySelectorAll('#foot-list .foot-check').length,
          bar: !!document.getElementById('foot-batch-bar') && !document.getElementById('foot-batch-bar').classList.contains('hidden')
        });
      }, 400);
    });
  });
  check('T11a 多选态出现复选框与操作栏', b0.boxes === 8 && b0.bar, JSON.stringify(b0));
  const tagged = await page.evaluate(() => {
    var ids = ['fp_batch_1', 'fp_batch_2'];
    batchAddTags(ids, ['批量测试']);
    return ids.every(function (id) {
      var r = state.footprints.filter(function (x) { return x.id === id; })[0];
      return r && r.tags.indexOf('批量测试') >= 0;
    });
  });
  check('T11b 批量打标签写入所选记录', tagged);
  const del = await page.evaluate(() => {
    var n0 = state.footprints.length;
    batchDeleteFootprints(['fp_batch_1', 'fp_batch_2']);
    return { n0: n0, n1: state.footprints.length, picked: Object.keys(state.footBatch.picked).length };
  });
  check('T11c 批量删除移除记录并清空选择', del.n1 === del.n0 - 2 && del.picked === 0, JSON.stringify(del));
  await page.evaluate(() => { state.footBatch = { on: false, picked: {} }; refreshAll(); });

  /* ========== T12 EXP 飘字 + 经验条动画 ========== */
  const exp0 = await page.evaluate(() => state.profile.exp);
  const fl = await page.evaluate(() => {
    awardExp(15, '测试');
    return new Promise(function (res) {
      setTimeout(function () {
        var el = document.querySelector('#exp-float-root .exp-float');
        res({ has: !!el, txt: el ? el.textContent : '' });
      }, 80);
    });
  });
  check('T12a EXP 飘字出现且内容正确', fl.has && fl.txt === '+15 EXP', JSON.stringify(fl));
  await page.waitForTimeout(700);
  const gone = await page.evaluate(() => document.querySelectorAll('#exp-float-root .exp-float').length);
  check('T12b 飘字 480ms 后自动清除', gone === 0, 'n=' + gone);
  const trans = await page.evaluate(() => getComputedStyle(document.getElementById('chip-exp')).transitionDuration);
  check('T12c 经验条有过渡动画', trans && trans !== '0s', trans);
  await page.evaluate((e0) => { state.profile.exp = e0; queueWrite({ table: 'profile', action: 'upsert', id: 'main' }); refreshAll(); }, exp0);

  /* ========== T13 翻书人成就 ========== */
  const book = await page.evaluate(() => {
    try { localStorage.setItem('td_book', '4'); } catch (e) { }
    state.achievements = state.achievements.filter(function (a) { return a.id !== 'ach_book'; });
    refreshAll();
    document.getElementById('book-shuffle').click();
    return new Promise(function (res) {
      setTimeout(function () {
        res({
          unlocked: state.achievements.some(function (a) { return a.id === 'ach_book'; }),
          count: (function () { try { return localStorage.getItem('td_book'); } catch (e) { return null; } })()
        });
      }, 500);
    });
  });
  check('T13a 第 5 次翻书解锁「翻书人」', book.unlocked, JSON.stringify(book));
  check('T13b 解锁后计数重置', book.count === null || +book.count === 0, 'count=' + book.count);
  const again = await page.evaluate(() => {
    try { localStorage.setItem('td_book', '2'); } catch (e) { }
    checkAchievements();
    return state.achievements.filter(function (a) { return a.id === 'ach_book'; }).length;
  });
  check('T13c 不重复解锁', again === 1, 'n=' + again);
  await page.evaluate(() => {
    state.achievements = state.achievements.filter(function (a) { return a.id !== 'ach_book'; });
    try { localStorage.removeItem('td_book'); } catch (e) { }
    refreshAll();
  });

  /* ========== T14 一键存档 + 自动存档 ========== */
  const s0 = await page.evaluate(() => (state.profile.snapshots || []).length);
  await page.evaluate(() => { saveSnapshot(false); refreshAll(); });
  const s1 = await page.evaluate(() => (state.profile.snapshots || []).length);
  const lastSnap = await page.evaluate(() => { var ss = state.profile.snapshots || []; return ss[ss.length - 1]; });
  check('T14a 一键存档直接存入（无命名弹窗）', s1 === s0 + 1 && /LV\.\d+/.test(lastSnap.name), JSON.stringify({ s0: s0, s1: s1, name: lastSnap.name }));
  const autoBefore = await page.evaluate(() => {
    var n0 = (state.profile.snapshots || []).length;
    state.profile.exp = 0;
    awardExp(200, '测试升级');
    return n0;
  });
  const autoAfter = await page.evaluate(() => (state.profile.snapshots || []).length);
  check('T14b 升级触发自动存档', autoAfter > autoBefore, JSON.stringify({ before: autoBefore, after: autoAfter }));
  const cap = await page.evaluate(() => {
    for (var i = 0; i < 12; i++) saveSnapshot(false);
    return (state.profile.snapshots || []).length;
  });
  check('T14c 快照保留最近 10 版', cap === 10, 'n=' + cap);
  await page.evaluate(() => {
    state.profile.snapshots = (state.profile.snapshots || []).slice(-3);
    state.profile.exp = 285;
    queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
    refreshAll();
  });

  /* ========== T15 移动端「今天要处理」默认折叠 ========== */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { switchTab('map'); state.todayOpen = false; refreshAll(); });
  await page.waitForTimeout(400);
  const fold = await page.evaluate(() => ({
    items: document.querySelectorAll('#today-card .today-item').length,
    caret: !!document.querySelector('#today-card .today-caret'),
    summary: (document.querySelector('#today-card .today-sum') || {}).textContent || '',
    mapTop: Math.round(document.getElementById('map-shell').getBoundingClientRect().top)
  }));
  check('T15a 移动端默认折叠（不渲染任务条目）', fold.items === 0 && fold.caret, JSON.stringify(fold));
  check('T15b 折叠后地图上移（首屏可见）', fold.mapTop < 480, 'mapTop=' + fold.mapTop);
  await page.evaluate(() => document.querySelector('#today-card .today-head').click());
  await page.waitForTimeout(400);
  const unfolded = await page.evaluate(() => document.querySelectorAll('#today-card .today-item').length);
  check('T15c 点击头部展开任务列表', unfolded > 0, 'n=' + unfolded);

  /* ========== T16 桌面端侧边栏导航 ========== */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(() => refreshAll());
  const side = await page.evaluate(() => {
    var nav = document.getElementById('bottomnav').getBoundingClientRect();
    var views = document.getElementById('views').getBoundingClientRect();
    return {
      navX: Math.round(nav.x), navW: Math.round(nav.width), viewsX: Math.round(views.x),
      dir: getComputedStyle(document.getElementById('bottomnav')).flexDirection
    };
  });
  check('T16a 桌面端导航在内容左侧（侧边栏）', side.navX < side.viewsX && side.navW <= 240, JSON.stringify(side));
  check('T16b 桌面端导航纵向排列', side.dir === 'column', side.dir);

  /* ========== T17 已去省份可再次记录（同一省多次） ========== */
  const prov = await page.evaluate(() => {
    switchTab('map');
    openProvincePanel('浙江省', true);
    return {
      has: !!document.getElementById('panel-add-foot'),
      before: state.footprints.filter(function (f) { return f.province === '浙江省'; }).length
    };
  });
  check('T17a 已去省份抽屉有「记录一次到访」', prov.has, JSON.stringify(prov));
  await page.evaluate(() => document.getElementById('panel-add-foot').click());
  await page.waitForTimeout(400);
  const preset = await page.evaluate(() => ({
    prov: document.getElementById('fm-prov').value,
    modal: !!document.querySelector('#modal-root .modal')
  }));
  check('T17b 表单预设该省份', preset.prov === '浙江省' && preset.modal, JSON.stringify(preset));
  await page.evaluate(() => {
    document.getElementById('fm-city').value = '杭州市';
    document.getElementById('fm-note').value = '同省二次到访';
    document.getElementById('fm-save').click();
  });
  await page.waitForTimeout(500);
  const afterProv = await page.evaluate(() => ({
    n: state.footprints.filter(function (f) { return f.province === '浙江省'; }).length,
    city: (state.footprints[0] || {}).city
  }));
  check('T17c 同一省份可记录多次（+1）', afterProv.n === prov.before + 1 && afterProv.city === '杭州市', JSON.stringify({ before: prov.before, after: afterProv.n }));
  await page.evaluate(() => {
    var i = state.footprints.findIndex(function (f) { return f.note === '同省二次到访'; });
    if (i >= 0) {
      var rec = state.footprints[i];
      state.footprints.splice(i, 1);
      queueWrite({ table: 'footprints', action: 'remove', id: rec.id, recId: rec.recId });
      refreshAll();
    }
  });

  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 2).join(' ; '));
  console.log('===== INTERACT SUMMARY: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
