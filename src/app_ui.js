/* ============================================================
 * UI 层 · 外壳组件 + 首页信息流 + 足迹库
 * 只读 state 渲染；交互改数据后一律交给 refreshAll()
 * ============================================================ */

/* ---------------- Toast ---------------- */
function toast(msg, type) {
  var root = $('toast-root');
  if (!root) return;
  /* 同屏最多 2 条：超出立即让位最旧（D12 收敛策略） */
  while (root.children.length >= 2) { root.removeChild(root.firstChild); }
  var el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  /* a11y：操作反馈需被屏幕阅读器播报 */
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  root.appendChild(el);
  setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2000);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2400);
}

/* 复制文本（clipboard API + execCommand 降级；file:// 下后者生效） */
function copyText(text, okMsg) {
  window.__lastCopied = text;   /* 供测试断言，生产无副作用 */
  function done() { if (okMsg) toast(okMsg, 'ok'); }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('复制失败，请手动选择复制', 'warn'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else { fallback(); }
}

/* ---------------- Escape 关闭弹层（a11y） ---------------- */
function initEscapeKey() {  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if ($('modal-root').innerHTML) { closeModal(); return; }
    if ($('sheet-root').innerHTML) { closeSheet(); }
  });
}

/* ---------------- 底部抽屉 / 弹窗 ---------------- */
/* 焦点管理：打开时移入层内并约束 Tab 循环，关闭时归还触发元素（栈式，支持抽屉上叠模态） */
var FOCUS_STACK = [];
function focusablesIn(root) {
  var sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.prototype.filter.call(root.querySelectorAll(sel), function (el) {
    return el.offsetParent !== null || el === document.activeElement;
  });
}
function openLayer(layer) {
  FOCUS_STACK.push(document.activeElement);
  var target = layer.querySelector('input:not([type=hidden]),select,textarea') ||
    layer.querySelector('button,#sheet-close,#modal-close');
  if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
}
function closeLayer() {
  var prev = FOCUS_STACK.pop();
  if (prev && prev.isConnected && prev.offsetParent !== null) {
    try { prev.focus({ preventScroll: true }); } catch (e) { prev.focus(); }
  }
}
/* Tab 在层内循环：不跑到遮罩后面的背景控件 */
function initLayerFocusTrap() {
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var layer = document.querySelector('#modal-root .modal') || document.querySelector('#sheet-root .sheet');
    if (!layer) return;
    var items = focusablesIn(layer);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (!layer.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });
}

function showSheet(title, bodyHTML) {
  var root = $('sheet-root');
  root.innerHTML =
    '<div id="sheet-mask"></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
    '<div class="sheet-head"><span class="s-title" id="sheet-title">' + esc(title) + '</span>' +
    '<button class="icon-btn" id="sheet-close" aria-label="关闭">' + ICONS.close + '</button></div>' +
    '<div class="sheet-body">' + bodyHTML + '</div></div>';
  $('sheet-close').onclick = closeSheet;
  $('sheet-mask').onclick = closeSheet;
  openLayer(root.querySelector('.sheet'));
}
function closeSheet() {
  $('sheet-root').innerHTML = '';
  closeLayer();
}

function showModal(title, bodyHTML) {
  var root = $('modal-root');
  root.innerHTML =
    '<div id="modal-mask"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
    '<div class="sheet-head"><span class="s-title" id="modal-title">' + esc(title) + '</span>' +
    '<button class="icon-btn" id="modal-close" aria-label="关闭">' + ICONS.close + '</button></div>' +
    '<div class="sheet-body">' + bodyHTML + '</div></div>';
  $('modal-close').onclick = closeModal;
  $('modal-mask').onclick = closeModal;
  openLayer(root.querySelector('.modal'));
}
function closeModal() {
  $('modal-root').innerHTML = '';
  closeLayer();
}

function confirmDialog(title, lines, onOk, okLabel) {
  var html = '<div style="font-size:14px;line-height:1.7">' + lines.map(function (l) { return '<p style="margin:0 0 8px">' + l + '</p>'; }).join('') + '</div>' +
    '<div class="btn-row" style="margin-top:14px;justify-content:flex-end">' +
    '<button class="btn" id="cf-cancel">取消</button>' +
    '<button class="btn danger" id="cf-ok">' + esc(okLabel || '确认') + '</button></div>';
  showModal(title, html);
  $('cf-cancel').onclick = closeModal;
  $('cf-ok').onclick = function () { closeModal(); onOk(); };
}

/* ---------------- 底部导航 / Tab 切换 ---------------- */
var TABS = [
  { key: 'map', label: '地图', icon: ICONS.map, view: 'view-map' },
  { key: 'foot', label: '足迹', icon: ICONS.foot, view: 'view-foot' },
  { key: 'trip', label: '行程', icon: ICONS.trip, view: 'view-trip' },
  { key: 'archive', label: '存档', icon: ICONS.save, view: 'view-archive' }
];
var activeTab = 'map';

function renderBottomNav() {
  var nav = $('bottomnav');
  nav.innerHTML = TABS.map(function (t) {
    return '<button class="nav-item' + (t.key === activeTab ? ' active' : '') + '" data-tab="' + t.key + '">' + t.icon + '<span>' + t.label + '</span></button>';
  }).join('');
  Array.prototype.forEach.call(nav.querySelectorAll('.nav-item'), function (btn) {
    btn.onclick = function () { switchTab(btn.getAttribute('data-tab')); };
  });
}
function switchTab(key) {
  activeTab = key;
  TABS.forEach(function (t) {
    var v = $(t.view);
    if (v) v.classList.toggle('active', t.key === key);
  });
  Array.prototype.forEach.call(document.querySelectorAll('#bottomnav .nav-item'), function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === key);
  });
  /* FAB 只在「地图」Tab 显示（它挂在 body，需手动跟随 Tab 切换） */
  var fab = $('fab-note');
  if (fab) fab.classList.toggle('hidden', key !== 'map');
  /* 尊重系统减弱动效偏好 */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  if (key === 'map' && mapChart) requestAnimationFrame(function () { mapChart.resize(); });
}

/* ---------------- 同步状态 ---------------- */
function renderSyncStatus() {
  var btn = $('sync-btn'), bar = $('sync-bar'), txt = $('sync-bar-text'), dot = $('sync-bar-dot');
  if (!btn) return;
  var pending = Sync.queue.length;
  var degraded = Sync.persistFailed;
  /* 提示条可见时下移 toast（侧边栏固定定位，无需避让） */
  document.documentElement.style.setProperty('--toast-top', degraded ? '108px' : '70px');
  btn.onclick = function () {
    if (degraded) { toast('本地队列持久化失败，请立即到「存档」导出备份', 'warn'); return; }
    toast('本地模式：数据保存在此浏览器，建议定期导出 JSON 备份', 'warn');
  };
  if (degraded) {
    btn.innerHTML = ICONS.cloudOff;
    btn.title = '本地队列持久化失败';
    if (bar && dot && txt) {
      bar.classList.remove('hidden');
      dot.className = 'sync-dot off';
      txt.textContent = '本地暂存失败（存储空间不足），请导出备份';
    }
    return;
  }
  btn.innerHTML = ICONS.cloudOff;
  btn.title = '本地模式 · 数据存于浏览器';
  if (bar && dot && txt) {
    bar.classList.remove('hidden');
    dot.className = 'sync-dot off';
    txt.textContent = '本地存储模式 · 数据保存在此浏览器，建议定期导出备份';
  }
}
function syncTopbarHeight() {
  var tb = $('topbar');
  if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  var nav = $('bottomnav');
  if (nav && nav.offsetHeight) document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
}
function renderLevelChip() {
  var p = state.profile;
  if (!p) return;
  var lv = levelFromExp(p.exp);
  var cur = p.exp - (lv - 1) * CONFIG.EXP_PER_LEVEL;
  var need = CONFIG.EXP_PER_LEVEL;
  $('chip-level').textContent = 'LV.' + lv;
  $('chip-exp').style.width = Math.min(100, (cur / need) * 100) + '%';
  var chip = $('level-chip');
  chip.title = 'LV.' + lv + ' · EXP ' + p.exp + '（距下一级 ' + Math.max(0, need - cur) + '）';
}

/* ---------------- 今天要处理（置顶） ---------------- */
function renderToday() {
  var box = $('today-card');
  var t = todayStr();
  var open = state.tasks.filter(function (k) { return !k.done; });
  var overdue = open.filter(function (k) { return k.deadline && k.deadline < t; }).sort(byDeadline);
  var today = open.filter(function (k) { return k.deadline === t; });
  var soon = open.filter(function (k) { return k.deadline > t; }).sort(byDeadline);
  /* 移动端默认折叠为一行摘要（把屏幕让给地图）；点击展开 */
  var narrow = window.matchMedia && window.matchMedia('(max-width:600px)').matches;
  var collapsed = narrow && !state.todayOpen;
  var ordered = overdue.concat(today, soon);
  var show = ordered.slice(0, 4);
  var restN = Math.max(0, ordered.length - show.length);
  /* 签名守卫：任务集合 / 折叠态未变则跳过重渲染 */
  var sig = t + '|' + (narrow ? 1 : 0) + (state.todayOpen ? 1 : 0) + '|' + show.map(function (k) { return k.id + k.deadline + (k.done ? 1 : 0); }).join(',') + '|' + overdue.length + '|' + restN;
  if (sigUnchanged('today', sig)) return;
  var summary = overdue.length
    ? overdue.length + ' 条逾期 · 共 ' + ordered.length + ' 条待办'
    : ordered.length + ' 条待办';
  var html = '<div class="today-head' + (narrow ? ' today-toggle' : '') + '"' + (narrow ? ' role="button" tabindex="0" aria-expanded="' + (state.todayOpen ? 'true' : 'false') + '"' : '') + '>' +
    ICONS.pin + ' 今天要处理' +
    (narrow
      ? '<span class="today-sum">' + esc(summary) + '</span><span class="today-caret">' + (collapsed ? '▾' : '▴') + '</span>'
      : (overdue.length ? '<span class="tag red" style="margin-left:auto">' + overdue.length + ' 条逾期</span>' : '')) +
    '</div>';
  if (collapsed) {
    /* 折叠态：只有一行摘要，不渲染任务条目 */
  } else if (!show.length) {
    html += '<div class="today-empty">今天没有待办任务。去「行程」规划下一段旅程，或到「足迹」补一篇手账吧。</div>';
  } else {
    html += '<div class="today-body">';
    show.forEach(function (k) {
      var over = k.deadline && k.deadline < t;
      var isToday = k.deadline === t;
      var trip = tripById(k.tripId);
      html += '<div class="today-item' + (over ? ' overdue' : '') + '">' +
        '<span class="tag ' + (over ? 'red' : isToday ? 'caramel' : 'gray') + '">' + esc(k.type) + '</span>' +
        '<div class="t-title">' + esc(k.title) + (trip ? '<div class="small muted" style="font-weight:400">' + esc(trip.title) + '</div>' : '') + '</div>' +
        '<span class="t-date">' + (over ? '逾期 ' : '') + esc(k.deadline) + '</span>' +
        '<button class="btn small" data-done="' + esc(k.id) + '">完成</button>' +
        '</div>';
    });
    html += '</div>';
    if (restN > 0) {
      html += '<button class="today-more" id="today-more">还有 ' + restN + ' 条待处理，去「行程」查看 ' + ICONS.go + '</button>';
    }
    if (narrow) {
      html += '<button class="today-more" id="today-collapse">收起 ' + ICONS.go + '</button>';
    }
  }
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('[data-done]'), function (btn) {
    btn.onclick = function () { toggleTask(btn.getAttribute('data-done'), true); };
  });
  var more = $('today-more');
  if (more) more.onclick = function () { switchTab('trip'); refreshAll(); };
  var col = $('today-collapse');
  if (col) col.onclick = function () { state.todayOpen = false; renderToday(); };
  if (narrow) {
    var head = box.querySelector('.today-head');
    if (head) head.onclick = function () { state.todayOpen = !state.todayOpen; renderToday(); };
  }
}
function byDeadline(a, b) { return (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1; }
function tripById(id) { for (var i = 0; i < state.trips.length; i++) if (state.trips[i].id === id) return state.trips[i]; return null; }

/* ---------------- 首页信息流 ---------------- */
function renderProfileCard() {
  var body = $('profile-card-body');
  var p = state.profile;
  if (!p) return;
  var total = state.footprints.length + state.trips.length + state.tasks.length + state.achievements.length;
  /* 真空状态（含云端加载中防护）才显示欢迎卡；清空后也能通过它恢复示例 */
  if (total === 0) {
    body.innerHTML =
      '<div style="text-align:center;padding:8px 0">' +
      '<div style="font-size:38px">🧳</div>' +
      '<div style="font-weight:700;margin-top:8px">欢迎来到旅行工作台</div>' +
      '<div class="muted small" style="margin:6px 0 12px">还没有任何数据。可以先载入示例数据看看效果，再清空换成自己的旅程。</div>' +
      '<button class="btn primary" id="welcome-seed">载入示例数据</button></div>';
    var ws = $('welcome-seed');
    if (ws) ws.onclick = seedSampleIntoState;
    return;
  }
  var lv = levelFromExp(p.exp);
  var cur = p.exp - (lv - 1) * CONFIG.EXP_PER_LEVEL;
  var styles = (p.styles || []).map(function (s) { return '<span class="tag caramel">' + esc(s) + '</span>'; }).join('');
  var wantN = (p.want || []).length;
  var sig = p.nick + p.origin + (p.styles || []).join(',') + p.exp + wantN + total;
  if (sigUnchanged('profile', sig)) return;
  /* 想去清单：可展开管理（定位到地图 / 取消） */
  var wantHtml = '';
  if (wantN) {
    wantHtml = '<div class="want-box"><button class="want-toggle" id="want-toggle">📌 想去清单 · ' + wantN + ' 个 <span class="want-arrow">▾</span></button>' +
      '<div id="want-list" class="hidden">' + (p.want || []).map(function (w) {
        return '<div class="want-row"><span class="tag caramel">' + esc(w) + '</span>' +
          '<button class="btn small" data-wantgo="' + esc(w) + '">定位</button>' +
          '<button class="btn small danger" data-wantdel="' + esc(w) + '">取消</button></div>';
      }).join('') + '</div></div>';
  }
  body.innerHTML =
    '<div class="profile-row">' +
    '<div class="avatar">🧑‍🚀</div>' +
    '<div class="profile-info">' +
    '<div class="nick">' + esc(p.nick || '旅行者') + '</div>' +
    '<div class="origin">出发地 · ' + esc(p.origin || '未设置') + '</div>' +
    '</div>' +
    '<button class="btn small" id="profile-edit">' + ICONS.edit + ' 编辑</button>' +
    '</div>' +
    '<div class="save-exp" style="margin-top:12px">' +
    '<span class="lv mono">LV.' + lv + '</span>' +
    '<div class="expbar"><i id="exp-fill" style="width:' + Math.min(100, (cur / CONFIG.EXP_PER_LEVEL) * 100) + '%"></i></div>' +
    '<span class="small muted mono">' + cur + '/' + CONFIG.EXP_PER_LEVEL + '</span>' +
    '</div>' +
    '<div class="style-tags">' + (styles || '<span class="muted small">还没有旅行风格标签</span>') + '</div>' +
    wantHtml;
  var ed = $('profile-edit');
  if (ed) ed.onclick = openProfileModal;
  /* 想去列表交互 */
  var wt = $('want-toggle');
  if (wt) wt.onclick = function () {
    var list = $('want-list'), arrow = document.querySelector('.want-arrow');
    if (!list) return;
    list.classList.toggle('hidden');
    if (arrow) arrow.textContent = list.classList.contains('hidden') ? '▾' : '▴';
  };
  Array.prototype.forEach.call(body.querySelectorAll('[data-wantgo]'), function (b) {
    b.onclick = function () {
      var w = b.getAttribute('data-wantgo');
      state.selProvince = w;
      switchTab('map');
      renderMapData();
      openProvincePanel(w, true);
    };
  });
  Array.prototype.forEach.call(body.querySelectorAll('[data-wantdel]'), function (b) {
    b.onclick = function () {
      toggleWant(b.getAttribute('data-wantdel'));
      refreshAll();
    };
  });
}

function renderRecent() {
  var box = $('recent-body');
  var more = $('recent-more');
  var list = state.footprints.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3);
  var sig = list.map(function (f) { return f.id + f.note; }).join(',');
  if (sigUnchanged('recent', sig)) return;
  if (!list.length) {
    box.innerHTML = '<div class="muted small">还没有足迹。去地图上点一座去过的城市，或点「＋ 记录足迹」。</div>';
    if (more) more.innerHTML = '';
    return;
  }
  box.innerHTML = list.map(function (f) {
    var tags = (f.tags || []).slice(0, 3).map(function (t) { return '<span class="tag gray">' + esc(t) + '</span>'; }).join(' ');
    return '<div class="recent-item"><div class="r-city">' + esc(f.city) + '<small>' + esc(f.province) + '</small></div>' +
      '<div class="r-note">' + esc(f.note) + '<div style="margin-top:4px">' + tags + '</div></div></div>';
  }).join('');
  if (more) more.innerHTML = '<button class="btn small ghost" id="recent-go">全部足迹 ' + ICONS.go + '</button>';
  var g = $('recent-go');
  if (g) g.onclick = function () { switchTab('foot'); refreshAll(); };
}

function renderNextTask() {
  var box = $('nexttask-body');
  var more = $('nexttask-more');
  var t = todayStr();
  var open = state.tasks.filter(function (k) { return !k.done && k.deadline; }).sort(byDeadline);
  var next = open[0];
  if (!next) {
    box.innerHTML = '<div class="muted small">没有未完成任务。新建行程后会自动生成待办清单。</div>';
    if (more) more.innerHTML = '';
    sigUnchanged('nexttask', 'empty');
    return;
  }
  if (sigUnchanged('nexttask', next.id + next.link + next.deadline)) return;
  var over = next.deadline < t;
  var trip = tripById(next.tripId);
  var safeLink = sanitizeUrl(next.link);
  var link = safeLink ? '<a class="link-btn t12306" href="' + esc(safeLink) + '" target="_blank" rel="noopener">' + ICONS.link + ' 去预订</a>' : '';
  box.innerHTML =
    '<div class="nexttask-box">' +
    '<div class="nt-title">' + esc(next.title) + (trip ? '<div class="small muted" style="font-weight:400">' + esc(trip.title) + '</div>' : '') + '</div>' +
    '<span class="nt-date' + (over ? ' over' : '') + '">' + (over ? '已逾期 ' : '截止 ') + esc(next.deadline) + '</span>' +
    link +
    '<button class="btn small" id="nt-done">完成</button>' +
    '</div>';
  var d = $('nt-done');
  if (d) d.onclick = function () { toggleTask(next.id, true); };
  if (more) more.innerHTML = '<button class="btn small ghost" id="nt-go">去行程 ' + ICONS.go + '</button>';
  var g = $('nt-go');
  if (g) g.onclick = function () {
    if (next.tripId) { state.tripDetailId = next.tripId; }
    switchTab('trip'); refreshAll();
  };
}

function renderBook() {
  if (state.bookIdx < 0) state.bookIdx = stableHash(todayStr()) % QUOTES.length;
  if (sigUnchanged('book', state.bookIdx + '|' + todayStr())) return;
  var q = $('book-quote');
  q.innerHTML = esc(QUOTES[state.bookIdx % QUOTES.length]) + '<span class="from">— 每日答案之书 · ' + esc(todayStr()) + '</span>';
  $('book-date').textContent = '';
  var btn = $('book-shuffle');
  if (btn) btn.onclick = function () {
    state.bookIdx = (state.bookIdx + 1) % QUOTES.length;
    /* 翻书计数（成就「翻书人」用；跨会话累计，解锁后清零） */
    try { localStorage.setItem(lsKey('book'), String(bookShuffleCount() + 1)); } catch (e) { }
    renderBook();
    checkAchievements();
  };
}

/* ---------------- 足迹库 ---------------- */
var _filterSig = '';
function fillFootFilters() {
  var ps = $('f-province'), ts = $('f-tag'), ys = $('f-year');
  /* 搜索词同步放在选项签名守卫之前：重置/外部改 state 后输入框必须立即反映 */
  var qEl = $('f-q');
  if (qEl) {
    var qVal = state.footFilter.q || '';   /* 兜底：外部重置漏写 q 时不会把输入框变成 "undefined" */
    state.footFilter.q = qVal;
    if (qEl.value !== qVal) qEl.value = qVal;
    qEl.oninput = debounce(function () {
      state.footFilter.q = qEl.value.trim();
      renderFootTab();
    }, 300);
  }
  var provs = {}, tags = {}, years = {};
  state.footprints.forEach(function (f) {
    if (f.province) provs[f.province] = 1;
    (f.tags || []).forEach(function (t) { if (t) tags[t] = 1; });
    if (f.date) years[f.date.slice(0, 4)] = 1;
  });
  /* 选项集签名：未变化时只恢复选中值，不重建 option（筛选交互性能） */
  var sig = Object.keys(provs).sort().join(',') + '|' + Object.keys(tags).sort().join(',') + '|' + Object.keys(years).sort().join(',');
  if (sig === _filterSig) {
    ps.value = state.footFilter.province;
    ts.value = state.footFilter.tag;
    ys.value = state.footFilter.year;
    return;
  }
  _filterSig = sig;
  ps.innerHTML = '<option value="">全部省份</option>' + Object.keys(provs).sort().map(function (p) {
    return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
  }).join('');
  ts.innerHTML = '<option value="">全部标签</option>' + Object.keys(tags).sort().map(function (t) {
    return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
  }).join('');
  ys.innerHTML = '<option value="">全部年份</option>' + Object.keys(years).sort().reverse().map(function (y) {
    return '<option value="' + esc(y) + '">' + esc(y) + '</option>';
  }).join('');
  ps.value = state.footFilter.province;
  ts.value = state.footFilter.tag;
  ys.value = state.footFilter.year;
}

function renderFootTab() {
  fillFootFilters();
  var f = state.footFilter;
  var list = state.footprints.filter(function (r) {
    if (f.province && r.province !== f.province) return false;
    if (f.tag && (r.tags || []).indexOf(f.tag) < 0) return false;
    if (f.year && String(r.date).slice(0, 4) !== f.year) return false;
    if (f.q) {
      var hay = (r.city + ' ' + r.note + ' ' + (r.tags || []).join(' ')).toLowerCase();
      if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
    }
    return true;
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

  /* 签名守卫：足迹或筛选未变则跳过（含多选态） */
  var sig = f.province + f.tag + f.year + f.q + (state.footBatch.on ? '|B' : '|') + Object.keys(state.footBatch.picked).sort().join(',') + '|' + list.map(function (r) { return r.id + r.date + r.note; }).join(';');
  if (sigUnchanged('foot', sig)) return;

  $('foot-count').textContent = '共 ' + list.length + ' 条' + (list.length !== state.footprints.length ? '（全部 ' + state.footprints.length + ' 条）' : '');
  /* 空状态文案区分：无数据 vs 筛选无结果 vs 搜索无结果 */
  var hasFilter = !!(f.province || f.tag || f.year || f.q);
  $('foot-empty').classList.toggle('hidden', list.length > 0);
  if (!list.length) {
    $('foot-empty').innerHTML = hasFilter
      ? (f.q
        ? '<div class="big">🔍</div><div>没有含「' + esc(f.q) + '」的足迹</div><div class="small" style="margin-top:6px">换个关键词，或重置筛选条件</div>'
        : '<div class="big">🔍</div><div>没有符合筛选条件的足迹</div><div class="small" style="margin-top:6px">试试重置筛选条件</div>')
      : '<div class="big">🗺️</div><div>这里还没有足迹记录</div><div class="small" style="margin-top:6px">点「记录足迹」，把第一座城市盖上邮戳</div>';
  }
  $('foot-list').innerHTML = list.map(function (r) {
    var tags = (r.tags || []).map(function (t) { return '<span class="tag gray">' + esc(t) + '</span>'; }).join(' ');
    var trip = tripById(r.tripId);
    var tripBtn = trip ? '<button class="foot-trip-link" data-trip="' + esc(trip.id) + '">' + esc(trip.title) + ' ' + ICONS.go + '</button>' : '';
    var batch = state.footBatch.on;
    var ariaLabel = r.city + ' · ' + r.date + (r.note ? ' · ' + r.note : '');
    return '<div class="card foot-item' + (batch ? ' batch-mode' : '') + '" data-fp="' + esc(r.id) + '"' +
      ' role="' + (batch ? 'checkbox' : 'button') + '"' + (batch ? ' aria-checked="' + (state.footBatch.picked[r.id] ? 'true' : 'false') + '"' : '') +
      ' tabindex="0" aria-label="' + esc(ariaLabel) + '">' +
      (batch ? '<label class="foot-check"><input type="checkbox" data-fpick="' + esc(r.id) + '"' + (state.footBatch.picked[r.id] ? ' checked' : '') + '></label><div class="f-wrap">' : '') +
      '<div class="f-head"><span class="f-city">' + esc(r.city) + '</span><span class="f-prov">' + esc(r.province) + '</span>' +
      '<span class="f-date">' + esc(r.date) + '</span></div>' +
      '<div class="f-note">' + esc(r.note) + '</div>' +
      '<div class="f-foot"><span class="f-tags">' + tags + '</span>' +
      '<span class="f-ops">' + tripBtn +
      '<button class="btn small" data-edit="' + esc(r.id) + '">' + ICONS.edit + '</button>' +
      '<button class="btn small danger" data-del="' + esc(r.id) + '">' + ICONS.trash + '</button>' +
      '</span></div>' +
      (batch ? '</div>' : '') + '</div>';
  }).join('');
  /* 整卡点击 = 打开编辑（多选态下 = 切换勾选）；操作按钮阻止冒泡；键盘 Enter/Space 等价点击 */
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-fp]'), function (el) {
    el.onclick = function () {
      if (state.footBatch.on) {
        var id = el.getAttribute('data-fp');
        if (state.footBatch.picked[id]) delete state.footBatch.picked[id];
        else state.footBatch.picked[id] = 1;
        var cb = el.querySelector('[data-fpick]');
        if (cb) cb.checked = !!state.footBatch.picked[id];
        el.setAttribute('aria-checked', state.footBatch.picked[id] ? 'true' : 'false');
        renderFootBatchBar();
        return;
      }
      openFootprintModal(el.getAttribute('data-fp'), '', '');
    };
    el.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    };
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('.foot-check'), function (lb) {
    lb.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-fpick]'), function (cb) {
    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      var id = cb.getAttribute('data-fpick');
      if (cb.checked) state.footBatch.picked[id] = 1; else delete state.footBatch.picked[id];
      renderFootBatchBar();
    });
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-edit],[data-del],[data-trip]'), function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-edit]'), function (b) {
    b.onclick = function () { openFootprintModal(b.getAttribute('data-edit'), '', ''); };
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-del]'), function (b) {
    b.onclick = function () { deleteFootprint(b.getAttribute('data-del')); };
  });
  Array.prototype.forEach.call($('foot-list').querySelectorAll('[data-trip]'), function (b) {
    b.onclick = function () { state.tripDetailId = b.getAttribute('data-trip'); switchTab('trip'); refreshAll(); };
  });
  /* 多选开关文案与批量操作栏 */
  var bt = $('foot-batch-toggle');
  if (bt) {
    bt.textContent = state.footBatch.on ? '完成' : '多选';
    bt.classList.toggle('primary', state.footBatch.on);
  }
  renderFootBatchBar();
}

/* ---------------- 足迹批量操作 ---------------- */
function renderFootBatchBar() {
  var bar = $('foot-batch-bar');
  if (!bar) return;
  var n = Object.keys(state.footBatch.picked).length;
  if (!state.footBatch.on || !n) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = '<span>已选 ' + n + ' 条</span>' +
    '<button class="btn small" id="fb-tag">批量打标签</button>' +
    '<button class="btn small danger" id="fb-del">批量删除</button>';
  $('fb-tag').onclick = function () {
    showModal('批量打标签',
      '<div class="form-row"><label>标签（逗号分隔，追加到所选记录）</label>' +
      '<input id="fb-tag-input" placeholder="如：国庆，带朋友"></div>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
      '<button class="btn" id="fb-tag-cancel">取消</button>' +
      '<button class="btn primary" id="fb-tag-ok">添加</button></div>');
    $('fb-tag-cancel').onclick = closeModal;
    $('fb-tag-ok').onclick = function () {
      var tags = $('fb-tag-input').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!tags.length) { toast('请填写至少一个标签', 'warn'); return; }
      batchAddTags(Object.keys(state.footBatch.picked), tags);
      closeModal();
      refreshAll();
    };
  };
  $('fb-del').onclick = function () {
    var ids = Object.keys(state.footBatch.picked);
    confirmDialog('批量删除足迹', ['确定删除所选 ' + ids.length + ' 条足迹吗？', '删除后地图与统计会同步回退，此操作不可恢复。'], function () {
      batchDeleteFootprints(ids);
      refreshAll();
    }, '删除');
  };
}
function batchAddTags(ids, tags) {
  ids.forEach(function (id) {
    var rec = null;
    for (var i = 0; i < state.footprints.length; i++) if (state.footprints[i].id === id) rec = state.footprints[i];
    if (!rec) return;
    var merged = (rec.tags || []).slice();
    tags.forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
    rec.tags = merged;
    queueWrite({ table: 'footprints', action: 'upsert', id: rec.id });
  });
}
function batchDeleteFootprints(ids) {
  ids.forEach(function (id) {
    var rec = null;
    for (var i = 0; i < state.footprints.length; i++) if (state.footprints[i].id === id) rec = state.footprints[i];
    if (!rec) return;
    queueWrite({ table: 'footprints', action: 'remove', id: id, recId: rec.recId });
  });
  state.footprints = state.footprints.filter(function (f) { return ids.indexOf(f.id) < 0; });
  state.footBatch.picked = {};
}

/* 城市下拉选项按省份联动；不在列表中的城市可走"其他"手动输入
   selId/otherId 可指定元素（记录表单用 fm-city，快记抽屉用 qn-city） */
function fillCityOptions(prov, selCity, selId, otherId) {
  var sel = $(selId || 'fm-city');
  if (!sel) return;
  var cities = (PROVINCE_CITIES[prov] || []).slice();
  var opts = '<option value="">请选择城市</option>' + cities.map(function (c) {
    return '<option value="' + esc(c) + '"' + (c === selCity ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  opts += '<option value="__other__"' + (selCity && cities.indexOf(selCity) < 0 ? ' selected' : '') + '>其他城市（手动输入）</option>';
  sel.innerHTML = opts;
  var other = $(otherId || 'fm-city-other');
  if (other) {
    var isOther = selCity && cities.indexOf(selCity) < 0;
    other.classList.toggle('hidden', !isOther);
    if (isOther) other.value = selCity || '';
  }
}

/* 表单内联错误：标记字段 + 行内提示 + 聚焦；输入时自动清除 */
function markFieldError(inputId, msg) {
  var el = $(inputId);
  if (!el) return;
  el.setAttribute('aria-invalid', 'true');
  var row = el.parentNode;
  while (row && row.className.indexOf('form-row') < 0) row = row.parentNode;
  if (row) {
    row.classList.add('has-error');
    var hint = row.querySelector('.form-err');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'form-err';
      hint.setAttribute('role', 'alert');
      row.appendChild(hint);
    }
    hint.textContent = msg;
  }
  var clear = function () {
    el.removeAttribute('aria-invalid');
    if (row) {
      row.classList.remove('has-error');
      var h = row.querySelector('.form-err');
      if (h) h.remove();
    }
    el.removeEventListener('input', clear);
    el.removeEventListener('change', clear);
  };
  el.addEventListener('input', clear);
  el.addEventListener('change', clear);
  try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); }
}

/* 省市联动绑定（记录表单 / 快记抽屉共用） */
function bindCityLinkage(provSelId, citySelId, otherId, initialProv, initialCity) {
  fillCityOptions(initialProv, initialCity, citySelId, otherId);
  $(provSelId).onchange = function () { fillCityOptions(this.value, '', citySelId, otherId); };
  $(citySelId).onchange = function () {
    var other = $(otherId);
    if (other) other.classList.toggle('hidden', this.value !== '__other__');
  };
}

/* 足迹保存公共函数（记录表单 / 快记抽屉共用）；返回是否成功。D12 后成功静默。
   prefix：表单字段前缀（fm / qn），用于把校验错误定位到具体字段 */
function saveFootprintRecord(prov, city, date, note, tags, tripId, rec, prefix) {
  var p = prefix || 'fm';
  if (!prov) { toast('请选择省级行政区', 'warn'); markFieldError(p + '-prov', '请选择省份'); return false; }
  if (!city) { toast('请选择或输入城市', 'warn'); markFieldError(p + '-city', '请选择或输入城市'); return false; }
  if (!date) { toast('请选择到访日期', 'warn'); markFieldError(p + '-date', '请选择到访日期'); return false; }
  /* 日期口径与导入一致：足迹为已发生事实，不允许未来日期 */
  if (date > todayStr()) { toast('到访日期不能是未来', 'warn'); markFieldError(p + '-date', '不能选择未来日期'); return false; }
  /* 省市归属校验：已知城市必须与所选省份一致（如 杭州市 只能属于 浙江省） */
  if (CITY_TO_PROVINCE[city] && CITY_TO_PROVINCE[city] !== prov) {
    toast('「' + city + '」属于' + CITY_TO_PROVINCE[city] + '，与所选「' + prov + '」不一致', 'warn');
    markFieldError(p + '-city', '属于' + CITY_TO_PROVINCE[city]);
    return false;
  }
  if (rec) {
    rec.province = prov; rec.city = city; rec.date = date; rec.note = note;
    rec.tags = tags; rec.tripId = tripId;
    queueWrite({ table: 'footprints', action: 'upsert', id: rec.id });
  } else {
    var nf = { id: uid('fp'), province: prov, city: city, date: date, note: note, tags: tags, tripId: tripId };
    state.footprints.unshift(nf);
    queueWrite({ table: 'footprints', action: 'upsert', id: nf.id });
    awardExp(10, '新足迹 · ' + city);
  }
  return true;
}

/* ---------------- 足迹 新增 / 编辑 / 删除 ---------------- */
function openFootprintModal(id, presetProv, presetCity) {
  var rec = null;
  if (id) { for (var i = 0; i < state.footprints.length; i++) if (state.footprints[i].id === id) rec = state.footprints[i]; }
  var prov = presetProv || (rec && rec.province) || '';
  var city = presetCity || (rec && rec.city) || '';
  var date = (rec && rec.date) || todayStr();
  var note = rec ? rec.note : '';
  var tags = rec ? (rec.tags || []).join('，') : '';
  var tripId = rec ? rec.tripId : '';
  var tripOpts = '<option value="">不关联行程</option>' + state.trips.map(function (t) {
    return '<option value="' + esc(t.id) + '"' + (t.id === tripId ? ' selected' : '') + '>' + esc(t.title) + '</option>';
  }).join('');
  showModal(rec ? '编辑足迹' : '记录足迹',
    '<div class="form-row"><label>省级行政区 *</label><select id="fm-prov">' +
    '<option value="">请选择</option>' + PROVINCES.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === prov ? ' selected' : '') + '>' + esc(p) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="form-row"><label>城市 *</label><select id="fm-city"></select>' +
    '<input id="fm-city-other" class="hidden" style="margin-top:8px" placeholder="其他城市（手动输入，如县城）">' +
    '<div class="hint">城市列表随省份联动；如目的地不在列表中，选「其他城市」手动输入</div></div>' +
    '<div class="form-2col">' +
    '<div class="form-row"><label>到访日期 *</label><input id="fm-date" type="date" max="' + todayStr() + '" value="' + esc(date) + '">' +
    '<div class="hint">足迹是已发生的事实，不能选择未来日期</div></div>' +
    '<div class="form-row"><label>关联行程</label><select id="fm-trip">' + tripOpts + '</select></div>' +
    '</div>' +
    '<div class="form-row"><label>一句话记忆</label><textarea id="fm-note" placeholder="手账式短句，如：西湖的日落把整座城市泡进了橘子汽水">' + esc(note) + '</textarea></div>' +
    '<div class="form-row"><label>标签</label><input id="fm-tags" value="' + esc(tags) + '" placeholder="用逗号分隔，如：国庆，带朋友，美食"></div>' +
    '<div class="btn-row" style="justify-content:flex-end">' +
    '<button class="btn" id="fm-cancel">取消</button>' +
    '<button class="btn primary" id="fm-save">保存</button></div>');

  /* 省 → 市 联动 */
  bindCityLinkage('fm-prov', 'fm-city', 'fm-city-other', prov, city);

  $('fm-cancel').onclick = closeModal;
  $('fm-save').onclick = function () {
    var p = $('fm-prov').value;
    var citySel = $('fm-city').value;
    var c = citySel === '__other__' ? $('fm-city-other').value.trim() : citySel;
    var d = $('fm-date').value;
    var tagArr = $('fm-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (saveFootprintRecord(p, c, d, $('fm-note').value.trim(), tagArr, $('fm-trip').value, rec, 'fm')) {
      closeModal();
      refreshAll();
    }
  };
}

/* ---------------- 快速记录（地图页 FAB / n 键）：省→市→日期→一句话，两步完成 ---------------- */
function openQuickNote() {
  var prov = state.selProvince || (state.profile && state.profile.origin) || '';
  var t = todayStr();
  showSheet('记一笔',
    '<div class="form-row"><label>省级行政区 *</label><select id="qn-prov">' +
    '<option value="">请选择</option>' + PROVINCES.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === prov ? ' selected' : '') + '>' + esc(p) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="form-row"><label>城市 *</label><select id="qn-city"></select>' +
    '<input id="qn-city-other" class="hidden" style="margin-top:8px" placeholder="其他城市（手动输入）"></div>' +
    '<div class="form-row"><label>到访日期 *</label><input id="qn-date" type="date" max="' + t + '" value="' + t + '"></div>' +
    '<div class="form-row"><label>一句话记忆</label><input id="qn-note" placeholder="此刻的一点光"></div>' +
    '<div class="btn-row" style="justify-content:flex-end">' +
    '<button class="btn" id="qn-cancel">取消</button>' +
    '<button class="btn primary" id="qn-save">记下</button></div>');
  bindCityLinkage('qn-prov', 'qn-city', 'qn-city-other', prov, '');
  $('qn-cancel').onclick = closeSheet;
  $('qn-save').onclick = function () {
    var citySel = $('qn-city').value;
    var c = citySel === '__other__' ? $('qn-city-other').value.trim() : citySel;
    if (saveFootprintRecord($('qn-prov').value, c, $('qn-date').value, $('qn-note').value.trim(), [], '', null, 'qn')) {
      closeSheet();
      refreshAll();
    }
  };
}

function deleteFootprint(id) {
  var rec = null;
  for (var i = 0; i < state.footprints.length; i++) if (state.footprints[i].id === id) rec = state.footprints[i];
  if (!rec) return;
  confirmDialog('删除足迹', ['确定删除这条足迹吗？', '<b>' + esc(rec.province + ' · ' + rec.city) + '</b>（' + esc(rec.date) + '）', '删除后地图与统计会同步回退，此操作不可恢复。'], function () {
    var rid = rec.recId;
    state.footprints = state.footprints.filter(function (f) { return f.id !== id; });
    queueWrite({ table: 'footprints', action: 'remove', id: id, recId: rid });
    closeSheet();   /* 若从城市面板删除，同步关闭抽屉，避免展示已删除记录 */
    refreshAll();
  }, '删除');
}

function openProfileModal() {
  var p = state.profile;
  var allStyles = ['自然风光', '城市漫步', '美食', '人文', '冒险', '躺平'];
  var chips = allStyles.map(function (s) {
    var on = (p.styles || []).indexOf(s) >= 0;
    return '<button type="button" class="btn small' + (on ? ' primary' : '') + '" data-style="' + esc(s) + '" style="min-width:64px">' + esc(s) + '</button>';
  }).join('');
  showModal('编辑旅行者档案',
    '<div class="form-row"><label>昵称</label><input id="pm-nick" value="' + esc(p.nick || '') + '" placeholder="怎么称呼你？"></div>' +
    '<div class="form-row"><label>出发地</label><input id="pm-origin" value="' + esc(p.origin || '') + '" placeholder="常驻城市，如：上海市"></div>' +
    '<div class="form-row"><label>旅行风格（可多选）</label><div style="display:flex;gap:6px;flex-wrap:wrap" id="pm-styles">' + chips + '</div></div>' +
    '<div class="btn-row" style="justify-content:flex-end">' +
    '<button class="btn" id="pm-cancel">取消</button>' +
    '<button class="btn primary" id="pm-save">保存</button></div>');
  var picked = (p.styles || []).slice();
  Array.prototype.forEach.call(document.querySelectorAll('#pm-styles [data-style]'), function (btn) {
    btn.onclick = function () {
      var s = btn.getAttribute('data-style');
      var i = picked.indexOf(s);
      if (i >= 0) { picked.splice(i, 1); btn.classList.remove('primary'); }
      else { picked.push(s); btn.classList.add('primary'); }
    };
  });
  $('pm-cancel').onclick = closeModal;
  $('pm-save').onclick = function () {
    p.nick = $('pm-nick').value.trim();
    p.origin = $('pm-origin').value.trim();
    p.styles = picked;
    queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
    closeModal();
    refreshAll();
    toast('档案已更新', 'ok');
  };
}

/* ---------------- 任务勾选 ---------------- */
function toggleTask(id, force) {
  var k = null;
  for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) k = state.tasks[i];
  if (!k) return;
  var want = typeof force === 'boolean' ? force : !k.done;
  if (want === k.done) return;
  k.done = want;
  queueWrite({ table: 'tasks', action: 'upsert', id: k.id });
  if (want) awardExp(15, '任务完成 · ' + k.title);
  else toast('任务已重新打开');
  refreshAll();
}

/* ---------------- 载入示例数据 ---------------- */
function seedSampleIntoState() {
  var s = buildSample();
  state.profile = s.profile;
  state.footprints = s.footprints;
  state.trips = s.trips;
  state.tasks = s.tasks;
  state.achievements = s.achievements;
  delete state.profile.isNew;
  queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
  state.footprints.forEach(function (f) { queueWrite({ table: 'footprints', action: 'upsert', id: f.id }); });
  state.trips.forEach(function (t) { queueWrite({ table: 'trips', action: 'upsert', id: t.id }); });
  state.tasks.forEach(function (k) { queueWrite({ table: 'tasks', action: 'upsert', id: k.id }); });
  state.achievements.forEach(function (a) { queueWrite({ table: 'achievements', action: 'upsert', id: a.id }); });
  cacheSave();
  refreshAll();
  toast('示例数据已载入，可随时清空', 'ok');
}
