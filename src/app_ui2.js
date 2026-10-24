/* ============================================================
 * UI 层 · 行程 / 存档 / 启动
 * ============================================================ */

/* ---------------- 交通深链（不编造车次，只给平台搜索页） ---------------- */
function link12306(from, to, date) {
  var u = 'https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=' + encodeURIComponent(from) + '&ts=' + encodeURIComponent(to);
  if (date) u += '&date=' + encodeURIComponent(date);
  return u + '&flag=N,N,Y';
}
function linkCtrip(from, to) {
  var a = PINYIN[from], b = PINYIN[to];
  if (a && b) return 'https://trains.ctrip.com/trainbooking/' + a + '-' + b + '/';
  return 'https://trains.ctrip.com/';
}
function linkQunar() { return 'https://train.qunar.com/'; }

/* 从文本中识别城市（支持 杭州市→杭州 别名，最长优先，防误报） */
/* 自治州/盟等复合后缀按从长到短剥离，保证「西双版纳傣族自治州→西双版纳」「香港特别行政区→香港」 */
var CITY_SUFFIXES = ['蒙古族藏族自治州', '藏族羌族自治州', '土家族苗族自治州', '苗族侗族自治州', '布依族苗族自治州', '哈尼族彝族自治州', '壮族苗族自治州', '傣族景颇族自治州', '柯尔克孜自治州', '蒙古自治州', '哈萨克自治州', '回族自治州', '藏族自治州', '彝族自治州', '白族自治州', '傣族自治州', '朝鲜族自治州', '傈僳族自治州', '特别行政区', '自治州', '地区', '盟', '市', '县', '区'];
function stripCitySuffix(c) {
  for (var i = 0; i < CITY_SUFFIXES.length; i++) {
    var s = CITY_SUFFIXES[i];
    if (c.length > s.length && c.slice(-s.length) === s) return c.slice(0, -s.length);
  }
  return c;
}
/* 已知误报复合词：短别名是这些词的一部分时不算命中（北海道/北海公园/大理寺） */
var ALIAS_FALSE_POS = ['北海道', '北海公园', '大理寺', '南海公园', '东方明珠'];
var CITY_ALIASES = (function () {
  var arr = [];
  Object.keys(CITY_COORDS).forEach(function (c) {
    arr.push({ alias: c, city: c });
    var short = stripCitySuffix(c);
    if (short !== c && short.length >= 2) arr.push({ alias: short, city: c });
  });
  arr.sort(function (a, b) { return b.alias.length - a.alias.length; });
  return arr;
})();
function extractCities(text) {
  var out = [];
  CITY_ALIASES.forEach(function (a) {
    if (out.indexOf(a.city) >= 0) return;
    var idx = text.indexOf(a.alias);
    while (idx >= 0) {
      /* 命中位置若落在已知误报复合词内部，则跳过这次出现继续找 */
      var blocked = ALIAS_FALSE_POS.some(function (fp) {
        var fi = text.indexOf(fp);
        return fi >= 0 && fi <= idx && idx + a.alias.length <= fi + fp.length;
      });
      if (!blocked) { out.push(a.city); return; }
      idx = text.indexOf(a.alias, idx + 1);
    }
  });
  return out;
}

/* ---------------- 行程列表 ---------------- */
var _lastDetailId = '';
function renderTripTab() {
  var list = $('trip-list'), detail = $('trip-detail');
  if (state.tripDetailId) {
    SIG['triplist'] = '';   /* 清列表签名：返回列表时必须重建（进详情时已清空 DOM） */
    /* 分页复位：仅在「进入另一个行程」时，避免每次 refreshAll 把续载天数打回 7 */
    if (_lastDetailId !== state.tripDetailId) { state.tripDayShown = 7; _lastDetailId = state.tripDetailId; }
    list.innerHTML = '';
    $('trip-empty').classList.add('hidden');
    renderTripDetail();
    return;
  }
  _lastDetailId = '';
  detail.classList.add('hidden');
  detail.innerHTML = '';
  SIG['tripdetail'] = '';   /* 清详情签名：再次进入详情时必须重建 */
  var trips = state.trips.slice().sort(function (a, b) { return (a.start || '') < (b.start || '') ? 1 : -1; });
  /* 签名守卫：行程与任务完成状态未变则跳过 */
  var sig = trips.map(function (t) { return t.id + t.title + t.status + t.budget + (t.provinces || []).join(','); }).join('|') +
    '#' + state.tasks.map(function (k) { return k.id + (k.done ? 1 : 0); }).join(',');
  if (sigUnchanged('triplist', sig)) return;
  $('trip-empty').classList.toggle('hidden', trips.length > 0);
  list.innerHTML = trips.map(function (t) {
    var total = state.tasks.filter(function (k) { return k.tripId === t.id; }).length;
    var done = state.tasks.filter(function (k) { return k.tripId === t.id && k.done; }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var stCls = t.status === '已完成' ? 'green' : t.status === '已确认' ? 'caramel' : 'gray';
    var provs = (t.provinces || []).map(function (p) { return '<span class="tag gray">' + esc(p) + '</span>'; }).join(' ');
    return '<div class="card trip-item" data-trip="' + esc(t.id) + '" role="button" tabindex="0" aria-label="' + esc(t.title + ' · ' + t.start + ' 至 ' + t.end + ' · ' + t.status) + '">' +
      '<div class="t-head"><span class="t-name">' + esc(t.title) + '</span>' +
      '<span class="tag ' + stCls + '">' + esc(t.status) + '</span>' +
      '<span class="t-dates">' + esc(t.start) + ' → ' + esc(t.end) + '</span></div>' +
      '<div class="trip-meta">' + provs + '<span class="tag caramel">预算 ¥' + (t.budget || 0).toLocaleString('zh-CN') + '</span>' +
      '<span class="tag gray">' + (t.days || []).length + ' 天计划</span></div>' +
      (total ? '<div class="progress"><i style="width:' + pct + '%"></i></div><div class="progress-label"><span>任务进度</span><span>' + done + ' / ' + total + '</span></div>' : '<div class="small muted">还没有任务，进详情添加</div>') +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(list.querySelectorAll('[data-trip]'), function (el) {
    el.onclick = function () { state.tripDetailId = el.getAttribute('data-trip'); refreshAll(); };
    el.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    };
  });
}

/* ---------------- 行程详情 ---------------- */
function renderTripDetail() {
  var t = tripById(state.tripDetailId);
  var detail = $('trip-detail');
  if (!t) { state.tripDetailId = ''; renderTripTab(); return; }
  /* 签名守卫：行程/计划/任务/展开天数未变则跳过全量重建（大行程详情性能关键） */
  var tSig = t.id + t.title + t.start + t.end + t.status + t.budget + (t.provinces || []).join(',') +
    '#' + (t.days || []).map(function (d) {
      return d.date + ':' + (d.items || []).map(function (it) { return it.time + it.place + it.action + it.duration + it.note + it.type; }).join(';');
    }).join('|') +
    '#' + state.tasks.filter(function (k) { return k.tripId === t.id; }).map(function (k) { return k.id + k.done + k.deadline + k.title + k.link; }).join(',') +
    '#' + state.tripDayShown;
  if (sigUnchanged('tripdetail', tSig)) return;
  /* 快照用户正在填写的内容，重建后恢复（勾选等操作不丢输入） */
  var focusSnap = snapshotFocus();
  var inputSnap = snapshotInputs(detail);
  detail.classList.remove('hidden');
  var tasks = state.tasks.filter(function (k) { return k.tripId === t.id; }).sort(byDeadline);
  var doneN = tasks.filter(function (k) { return k.done; }).length;
  var pct = tasks.length ? Math.round((doneN / tasks.length) * 100) : 0;
  var today = todayStr();

  var daysHtml = (t.days || []).slice(0, Math.min(state.tripDayShown, (t.days || []).length)).map(function (day, di) {
    var items = (day.items || []).map(function (it, ii) {
      var typeName = { transit: '交通', food: '美食', sight: '景点', stay: '住宿', other: '其他' }[it.type] || '其他';
      return '<div class="plan-item">' +
        '<span class="p-time">' + esc(it.time || '--:--') + '</span>' +
        '<div class="p-body"><div class="p-place">' + esc(it.place) + '</div>' +
        '<div class="p-action">' + esc(it.action) + (it.duration ? ' · ' + esc(it.duration) : '') + '</div>' +
        (it.note ? '<div class="p-note">备注：' + esc(it.note) + '</div>' : '') + '</div>' +
        '<span class="p-type">' + typeName + '</span>' +
        '<button class="btn small p-del" data-deli="' + di + '_' + ii + '" title="删除">' + ICONS.trash + '</button>' +
        '</div>';
    }).join('');
    return '<div class="day-block"><div class="day-head">DAY ' + (di + 1) + ' · ' + esc(day.date) + '</div>' +
      '<div class="day-items">' + (items || '<div class="small muted" style="padding:10px">这一天还没有安排</div>') +
      '<div class="plan-item" style="background:#FDF6E7">' +
      '<input class="p-time" type="time" id="pi-time-' + di + '" style="border:1.5px solid var(--line);border-radius:4px;padding:2px 4px;width:86px;background:#fff">' +
      '<div class="p-body"><input id="pi-place-' + di + '" placeholder="地点" style="width:100%;border:1.5px solid var(--line);border-radius:4px;padding:4px 6px;font-size:14px;margin-bottom:4px">' +
      '<input id="pi-action-' + di + '" placeholder="做什么" style="width:100%;border:1.5px solid var(--line);border-radius:4px;padding:4px 6px;font-size:14px;margin-bottom:4px">' +
      '<div style="display:flex;gap:6px"><input id="pi-dur-' + di + '" placeholder="时长" style="flex:1;border:1.5px solid var(--line);border-radius:4px;padding:4px 6px;font-size:14px">' +
      '<select id="pi-type-' + di + '" style="flex:1;border:1.5px solid var(--line);border-radius:4px;padding:4px 6px;font-size:14px;background:#fff">' +
      '<option value="sight">景点</option><option value="food">美食</option><option value="transit">交通</option><option value="stay">住宿</option><option value="other">其他</option></select></div></div>' +
      '<button class="btn small primary" data-piadd="' + di + '">＋</button>' +
      '</div></div></div>';
  }).join('');

  /* 大行程分页：默认只渲染前 N 天，剩余按需续载（D9） */
  var allDayCount = (t.days || []).length;
  var shownDays = Math.min(state.tripDayShown, allDayCount);
  if (allDayCount > shownDays) {
    daysHtml += '<button class="btn" id="td-more-days" style="width:100%;margin-top:10px">加载更多（还剩 ' + (allDayCount - shownDays) + ' 天）</button>';
  }

  /* 跨城交通深链：从逐小时条目中自动提取 */
  var links = [];
  (t.days || []).forEach(function (day) {
    (day.items || []).forEach(function (it) {
      var text = (it.place || '') + ' ' + (it.action || '');
      var isTransit = it.type === 'transit' || /高铁|动车|火车|飞机|航班|大巴|客车|轮渡|驾车|自驾|前往|返回|返程/.test(text);
      if (!isTransit) return;
      var cities = extractCities(text);
      if (cities.length >= 2) {
        var from = stripCitySuffix(cities[0]);
        var to = stripCitySuffix(cities[1]);
        var key = from + '|' + to + '|' + day.date;
        if (links.some(function (l) { return l.key === key; })) return;
        links.push({
          key: key, from: from, to: to, date: day.date, place: it.place,
          u12306: link12306(from, to, day.date),
          uctrip: linkCtrip(from, to),
          uqunar: linkQunar()
        });
      }
    });
  });
  var linksHtml = links.length ? links.map(function (l) {
    return '<div class="task-row" style="align-items:center">' +
      '<div class="tk-body"><div class="tk-title">' + esc(l.from) + ' → ' + esc(l.to) + '</div>' +
      '<div class="tk-meta">' + esc(l.date) + ' · ' + esc(l.place) + '</div></div>' +
      '<a class="link-btn t12306" href="' + esc(l.u12306) + '" target="_blank" rel="noopener">12306</a>' +
      '<a class="link-btn ctrip" href="' + esc(l.uctrip) + '" target="_blank" rel="noopener">携程</a>' +
      '<a class="link-btn qunar" href="' + esc(l.uqunar) + '" target="_blank" rel="noopener">去哪儿</a>' +
      '</div>';
  }).join('') : '<div class="small muted">未从每日计划中识别到跨城交通。在计划里添加类型为「交通」的条目（如「上海虹桥站 乘高铁前往杭州东」）后，这里会自动生成 12306 / 携程 / 去哪儿 的搜索深链。</div>';

  var taskRows = tasks.map(function (k) {
    var over = !k.done && k.deadline && k.deadline < today;
    var soon = !k.done && k.deadline && k.deadline >= today && daysBetween(today, k.deadline) <= 3;
    var cls = k.done ? 'done' : over ? 'overdue' : soon ? 'soon' : '';
    var safeLink = sanitizeUrl(k.link);
    var link = safeLink ? '<a class="link-btn t12306" href="' + esc(safeLink) + '" target="_blank" rel="noopener">' + ICONS.link + ' 链接</a>' : '';
    return '<div class="task-row ' + cls + '">' +
      '<button class="tk-check" data-tk="' + esc(k.id) + '">' + (k.done ? ICONS.check : '') + '</button>' +
      '<div class="tk-body"><div class="tk-title">' + esc(k.title) + '</div>' +
      '<div class="tk-meta">' + esc(k.type) + ' · 截止 ' + esc(k.deadline || '未设') + (over ? ' · 已逾期' : '') + '</div></div>' +
      link +
      '<button class="btn small danger" data-tkdel="' + esc(k.id) + '">' + ICONS.trash + '</button>' +
      '</div>';
  }).join('');

  var stOpts = ['草稿', '已确认', '已完成'].map(function (s) {
    return '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  detail.innerHTML =
    '<div class="card">' +
    '<div class="card-tape"></div>' +
    '<div class="t-head"><span class="t-name" style="font-size:17px">' + esc(t.title) + '</span>' +
    '<span class="t-dates">' + esc(t.start) + ' → ' + esc(t.end) + '</span></div>' +
    '<div class="trip-meta">' +
    (t.provinces || []).map(function (p) { return '<span class="tag gray">' + esc(p) + '</span>'; }).join('') +
    '<span class="tag caramel">预算 ¥' + (t.budget || 0).toLocaleString('zh-CN') + '</span></div>' +
    (tasks.length ? '<div class="progress"><i style="width:' + pct + '%"></i></div><div class="progress-label"><span>任务进度</span><span>' + doneN + ' / ' + tasks.length + '</span></div>' : '') +
    '<div class="form-2col" style="margin-top:12px">' +
    '<div class="form-row"><label>状态</label><select id="td-status">' + stOpts + '</select></div>' +
    '<div class="form-row"><label>预算总额（¥）</label><input id="td-budget" type="number" min="0" step="100" value="' + (t.budget || 0) + '"></div>' +
    '</div>' +
    '<div class="btn-row">' +
    '<button class="btn" id="td-back">← 返回列表</button>' +
    '<button class="btn" id="td-share">分享</button>' +
    (t.status !== '已完成' ? '<button class="btn green" id="td-complete">标记为已完成</button>' : '') +
    '<button class="btn danger" id="td-del">删除行程</button>' +
    '</div></div>' +

    '<div class="card"><div class="card-title"><span class="dot"></span>每日计划<span class="right">逐小时 · 时间 / 地点 / 做什么 / 时长 / 备注</span></div>' + daysHtml + '</div>' +

    '<div class="card"><div class="card-title"><span class="dot"></span>跨城交通深链<span class="right">自动提取 · 前往平台搜索页</span></div>' + linksHtml + '</div>' +

    '<div class="card"><div class="card-title"><span class="dot"></span>行前简报<span class="right">出发前过一遍</span></div>' +
    '<div class="form-2col">' +
    '<div class="save-stat" style="text-align:left;padding:10px 12px"><b style="font-size:13px;color:var(--ink)">应急号码</b>' +
    '<div class="small muted" style="margin-top:4px;line-height:1.8">报警 110 ｜ 急救 120 ｜ 火警 119<br>交通事故 122 ｜ 旅游投诉 12301</div></div>' +
    '<div class="save-stat" style="text-align:left;padding:10px 12px"><b style="font-size:13px;color:var(--ink)">支付分层</b>' +
    '<div class="small muted" style="margin-top:4px;line-height:1.8">① 微信 / 支付宝（主力）<br>② 银行卡（备用）③ 少量现金</div></div>' +
    '</div>' +
    '<div class="task-row" style="align-items:flex-start;margin-top:8px"><div class="tk-body">' +
    '<div class="tk-title">离线地图准备</div>' +
    '<div class="tk-meta" style="white-space:normal;line-height:1.7">本工作台地图已内置，可随时查看省份与足迹。进山 / 信号差的区域，建议提前在手机地图 App 下载目的地离线包，并截图保存酒店地址与车牌号。</div></div>' +
    '<a class="link-btn ctrip" href="https://www.weather.com.cn/" target="_blank" rel="noopener">气象查询</a></div>' +
    '</div>' +

    '<div class="card"><div class="card-title"><span class="dot"></span>任务清单<span class="right">按截止日排序 · 完成得 15 EXP</span></div>' +
    (taskRows || '<div class="small muted">还没有任务</div>') +
    '<div class="dashed"></div>' +
    '<div class="form-row"><label>新任务标题</label><input id="tk-title" placeholder="如：预订 11/14 成都东—镇江关 动车票"></div>' +
    '<div class="form-2col">' +
    '<div class="form-row"><label>类型</label><select id="tk-type"><option>预订</option><option>准备</option><option>现场</option></select></div>' +
    '<div class="form-row"><label>截止日</label><input id="tk-deadline" type="date" value="' + esc(addDays(todayStr(), 7)) + '"></div>' +
    '</div>' +
    '<div class="form-row"><label>深链（可选）</label><input id="tk-link" placeholder="https://… 预订 / 查询链接"></div>' +
    '<button class="btn primary" id="tk-add">＋ 添加任务</button>' +
    '</div>';

  /* --- 事件绑定 --- */
  $('td-back').onclick = function () { state.tripDetailId = ''; refreshAll(); };
  var sh = $('td-share');
  if (sh) sh.onclick = function () {
    showSheet('分享这份行程',
      '<div class="btn-row" style="flex-direction:column;gap:10px">' +
      '<button class="btn primary" id="share-text-btn" style="width:100%">📋 复制行程文本</button>' +
      '<button class="btn" id="share-img-btn" style="width:100%">🖼️ 保存为长图</button></div>');
    $('share-text-btn').onclick = function () { closeSheet(); shareTripText(t); };
    $('share-img-btn').onclick = function () { closeSheet(); saveTripImage(t); };
  };
  var st = $('td-status');
  st.onchange = function () {
    t.status = st.value;
    queueWrite({ table: 'trips', action: 'upsert', id: t.id });
    refreshAll();
  };
  $('td-budget').onchange = function () {
    t.budget = Math.max(0, +$('td-budget').value || 0);
    queueWrite({ table: 'trips', action: 'upsert', id: t.id });
    refreshAll();
  };
  var del = $('td-del');
  if (del) del.onclick = function () {
    confirmDialog('删除行程', ['确定删除行程《' + esc(t.title) + '》及其 ' + state.tasks.filter(function (k) { return k.tripId === t.id; }).length + ' 条任务吗？', '删除后不可恢复（云端记录同步移除）。'], function () {
      /* 删除行程时同步清理足迹里的悬空 tripId 引用 */
      state.footprints.forEach(function (f) {
        if (f.tripId === t.id) { f.tripId = ''; queueWrite({ table: 'footprints', action: 'upsert', id: f.id }); }
      });
      var rid = t.recId;
      state.trips = state.trips.filter(function (x) { return x.id !== t.id; });
      queueWrite({ table: 'trips', action: 'remove', id: t.id, recId: rid });
      state.tasks.filter(function (k) { return k.tripId === t.id; }).forEach(function (k) {
        queueWrite({ table: 'tasks', action: 'remove', id: k.id, recId: k.recId });
      });
      state.tasks = state.tasks.filter(function (k) { return k.tripId !== t.id; });
      state.tripDetailId = '';
      toast('行程已删除');
      refreshAll();
    }, '删除');
  };
  var comp = $('td-complete');
  if (comp) comp.onclick = function () { completeTrip(t); };

  Array.prototype.forEach.call(detail.querySelectorAll('[data-piadd]'), function (btn) {
    btn.onclick = function () {
      var di = +btn.getAttribute('data-piadd');
      var place = $('pi-place-' + di).value.trim();
      var action = $('pi-action-' + di).value.trim();
      if (!place && !action) { toast('至少填写地点或做什么', 'warn'); return; }
      t.days[di].items.push({
        time: $('pi-time-' + di).value || '--:--',
        place: place, action: action,
        duration: $('pi-dur-' + di).value.trim(),
        note: '', type: $('pi-type-' + di).value
      });
      queueWrite({ table: 'trips', action: 'upsert', id: t.id });
      refreshAll();
      /* 保存后清空当日输入表单 */
      ['pi-time-', 'pi-place-', 'pi-action-', 'pi-dur-'].forEach(function (p) {
        var el = $(p + di); if (el) el.value = '';
      });
    };
  });
  Array.prototype.forEach.call(detail.querySelectorAll('[data-deli]'), function (btn) {
    btn.onclick = function () {
      var parts = btn.getAttribute('data-deli').split('_');
      t.days[+parts[0]].items.splice(+parts[1], 1);
      queueWrite({ table: 'trips', action: 'upsert', id: t.id });
      refreshAll();
    };
  });
  Array.prototype.forEach.call(detail.querySelectorAll('[data-tk]'), function (btn) {
    btn.onclick = function () { toggleTask(btn.getAttribute('data-tk')); };
  });
  Array.prototype.forEach.call(detail.querySelectorAll('[data-tkdel]'), function (btn) {
    btn.onclick = function () {
      var id = btn.getAttribute('data-tkdel');
      var k = null;
      state.tasks.forEach(function (x) { if (x.id === id) k = x; });
      if (!k) return;
      state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
      queueWrite({ table: 'tasks', action: 'remove', id: id, recId: k.recId });
      toast('任务已删除');
      refreshAll();
    };
  });
  $('tk-add').onclick = function () {
    var title = $('tk-title').value.trim();
    if (!title) { toast('请填写任务标题', 'warn'); return; }
    var nk = {
      id: uid('task'), tripId: t.id, type: $('tk-type').value,
      title: title, deadline: $('tk-deadline').value || todayStr(),
      done: false, link: sanitizeUrl($('tk-link').value)
    };
    state.tasks.push(nk);
    queueWrite({ table: 'tasks', action: 'upsert', id: nk.id });
    refreshAll();
    /* 保存后清空表单 */
    var t1 = $('tk-title'); if (t1) t1.value = '';
    var t2 = $('tk-link'); if (t2) t2.value = '';
  };

  /* 分页续载：按钮 + 滚动接近底部自动加载 */
  function loadMoreDays() {
    state.tripDayShown = Math.min(state.tripDayShown + 7, allDayCount);
    renderTripDetail();
  }
  var mdBtn = $('td-more-days');
  if (mdBtn) mdBtn.onclick = loadMoreDays;
  detail.onscroll = function () {
    if (state.tripDayShown >= allDayCount) { detail.onscroll = null; return; }
    if (detail.scrollTop + detail.clientHeight >= detail.scrollHeight - 120) loadMoreDays();
  };

  restoreFocus(focusSnap);
  restoreInputs(detail, inputSnap);
}

/* ---------------- 完成行程 → 提示加入足迹 ---------------- */
function completeTrip(t) {
  t.status = '已完成';
  queueWrite({ table: 'trips', action: 'upsert', id: t.id });
  awardExp(50, '行程完成 · ' + t.title);
  if (typeof saveSnapshot === 'function') saveSnapshot(true);   /* D14：完成行程自动存档 */
  var existing = {};
  state.footprints.forEach(function (f) { existing[f.city] = f.province; });   /* 城市 → 省份（已访） */
  var cands = {};
  (t.days || []).forEach(function (day) {
    (day.items || []).forEach(function (it) {
      extractCities((it.place || '') + ' ' + (it.action || '')).forEach(function (c) {
        /* 只提议未到访过的城市；保留首次出现日期（多日到访以第一天为建议） */
        if (!(c in existing) && !(c in cands)) cands[c] = day.date;
      });
    });
  });
  var cities = Object.keys(cands);
  if (!cities.length) {
    refreshAll();
    return;
  }
  var rows = cities.map(function (c, i) {
    var defProv = CITY_TO_PROVINCE[c] || ((t.provinces && t.provinces.length === 1) ? t.provinces[0] : '');
    return '<div class="task-row" style="align-items:center">' +
      '<button class="tk-check" data-pick="' + i + '">' + ICONS.check + '</button>' +
      '<div class="tk-body"><div class="tk-title">' + esc(c) + '</div>' +
      '<div class="tk-meta">建议日期 ' + esc(cands[c]) + '</div></div>' +
      '<select data-pickprov="' + i + '" style="border:2px solid var(--line);border-radius:5px;padding:6px;font-size:14px;background:#fff">' +
      '<option value="">选省份</option>' + PROVINCES.map(function (p) {
        return '<option value="' + esc(p) + '"' + (p === defProv ? ' selected' : '') + '>' + esc(p) + '</option>';
      }).join('') + '</select></div>';
  }).join('');
  showModal('加入足迹',
    '<div class="small muted" style="margin-bottom:10px">以下城市出现在行程计划中，但还没有足迹记录。勾选后写入足迹库并点亮地图。</div>' + rows +
    '<div class="btn-row" style="margin-top:12px;justify-content:flex-end">' +
    '<button class="btn" id="cp-skip">暂不加入</button>' +
    '<button class="btn primary" id="cp-ok">加入足迹</button></div>');
  var picked = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (btn) {
    btn.onclick = function () {
      var i = btn.getAttribute('data-pick');
      picked[i] = !picked[i];
      btn.style.background = picked[i] ? 'var(--green)' : '#fff';
      btn.style.borderColor = picked[i] ? 'var(--green)' : 'var(--line)';
    };
  });
  $('cp-skip').onclick = function () { closeModal(); refreshAll(); };
  $('cp-ok').onclick = function () {
    var n = 0, skipped = 0;
    Object.keys(picked).forEach(function (i) {
      if (!picked[i]) return;
      var c = cities[+i];
      var prov = document.querySelector('[data-pickprov="' + i + '"]').value;
      if (!prov) return;
      if (CITY_TO_PROVINCE[c] && CITY_TO_PROVINCE[c] !== prov) { skipped++; return; }
      var nf = { id: uid('fp'), province: prov, city: c, date: cands[c] || todayStr(), note: '来自行程《' + t.title + '》', tags: ['行程自动'], tripId: t.id };
      state.footprints.unshift(nf);
      queueWrite({ table: 'footprints', action: 'upsert', id: nf.id });
      n++;
    });
    closeModal();
    if (n) awardExp(10 * n, '加入 ' + n + ' 条足迹');
    refreshAll();
    /* D12：加入足迹为确认类操作，界面已即时可见，静默；仅无选择/跳过时提示 */
    if (!n) toast('未选择要加入的城市', 'warn');
    else if (skipped) toast('已加入 ' + n + ' 条足迹（' + skipped + ' 条省市不一致已跳过）', 'warn');
  };
}

/* ---------------- 新建行程 ---------------- */
function openTripModal() {
  showModal('新建行程',
    '<div class="form-row"><label>标题 *</label><input id="tm-title" placeholder="如：川西小环线 4 日"></div>' +
    '<div class="form-row"><label>行程模板</label><select id="tm-template">' +
    '<option value="blank">空白（自己排）</option>' +
    '<option value="weekend">周末短途（2 天 · 预填返程占位）</option>' +
    '<option value="longhaul">跨省长线（5 天 · 预填往返占位）</option>' +
    '</select><div class="hint">模板只生成骨架与占位提示，不会替你编造地点</div></div>' +
    '<div class="form-2col">' +
    '<div class="form-row"><label>出发日期 *</label><input id="tm-start" type="date" value="' + esc(todayStr()) + '"></div>' +
    '<div class="form-row"><label>结束日期 *</label><input id="tm-end" type="date" value="' + esc(addDays(todayStr(), 2)) + '"></div>' +
    '</div>' +
    '<div class="form-2col">' +
    '<div class="form-row"><label>预算总额（¥）</label><input id="tm-budget" type="number" min="0" step="100" value="2000"></div>' +
    '<div class="form-row"><label>状态</label><select id="tm-status"><option>草稿</option><option>已确认</option></select></div>' +
    '</div>' +
    '<div class="form-row"><label>覆盖省份（可多选）</label><div id="tm-provs" style="display:flex;gap:6px;flex-wrap:wrap">' +
    PROVINCES.map(function (p) {
      return '<button type="button" class="btn small" data-prov="' + esc(p) + '">' + esc(p) + '</button>';
    }).join('') + '</div>' +
    '<div class="hint">系统会根据日期自动生成每日计划框架，逐小时条目可在详情里补充</div></div>' +
    '<div class="btn-row" style="justify-content:flex-end">' +
    '<button class="btn" id="tm-cancel">取消</button>' +
    '<button class="btn primary" id="tm-save">创建</button></div>');
  var picked = [];
  Array.prototype.forEach.call(document.querySelectorAll('#tm-provs [data-prov]'), function (btn) {
    btn.onclick = function () {
      var p = btn.getAttribute('data-prov');
      var i = picked.indexOf(p);
      if (i >= 0) { picked.splice(i, 1); btn.classList.remove('primary'); }
      else { picked.push(p); btn.classList.add('primary'); }
    };
  });
  $('tm-cancel').onclick = closeModal;
  /* 模板切换：自动给出建议日期（周末=下周六~周日；长线=下周一~周五） */
  $('tm-template').onchange = function () {
    var v = this.value;
    function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    var base;
    if (v === 'weekend') {
      base = new Date(); base.setDate(base.getDate() + ((6 - base.getDay() + 7) % 7 || 7));
      $('tm-start').value = fmt(base);
      var sun = new Date(base); sun.setDate(sun.getDate() + 1); $('tm-end').value = fmt(sun);
    } else if (v === 'longhaul') {
      base = new Date(); base.setDate(base.getDate() + ((1 - base.getDay() + 7) % 7 || 7));
      $('tm-start').value = fmt(base);
      var fri = new Date(base); fri.setDate(fri.getDate() + 4); $('tm-end').value = fmt(fri);
    }
  };
  $('tm-save').onclick = function () {
    var title = $('tm-title').value.trim();
    var s = $('tm-start').value, e = $('tm-end').value;
    if (!title) { toast('请填写标题', 'warn'); return; }
    if (!s || !e) { toast('请选择日期范围', 'warn'); return; }
    if (e < s) { toast('结束日期不能早于出发日期', 'warn'); return; }
    var days = [];
    var d = s, guard = 0;
    while (d <= e && guard < 366) { days.push({ date: d, items: [] }); d = addDays(d, 1); guard++; }
    if (d <= e) toast('行程最长支持 366 天，之后的日期未生成计划框架', 'warn');
    var nt = {
      id: uid('trip'), title: title, start: s, end: e,
      provinces: picked, budget: Math.max(0, +$('tm-budget').value || 0),
      status: $('tm-status').value, days: days
    };
    state.trips.unshift(nt);
    queueWrite({ table: 'trips', action: 'upsert', id: nt.id });
    applyTripTemplate(nt, $('tm-template').value);
    state.tripDetailId = nt.id;
    closeModal();
    refreshAll();
  };
}

/* 行程模板：只放骨架占位，不编造地点/车次 */
function applyTripTemplate(t, tpl) {
  if (!tpl || tpl === 'blank') return;
  function push(idx, place, action) {
    if (t.days[idx]) t.days[idx].items.push({ time: '--:--', place: place, action: action, duration: '', note: '', type: 'transit' });
  }
  if (tpl === 'weekend' && t.days.length >= 2) {
    push(t.days.length - 1, '返程交通', '填写返程方式（高铁 / 飞机 / 自驾）');
  } else if (tpl === 'longhaul') {
    push(0, '出发交通', '填写出发方式与班次');
    push(t.days.length - 1, '返程交通', '填写返程方式与班次');
  }
  queueWrite({ table: 'trips', action: 'upsert', id: t.id });
}

/* ---------------- 行程分享（文本 / 长图） ---------------- */
function shareTripText(t) {
  var lines = ['🗺️ ' + t.title, t.start + ' → ' + t.end + ((t.provinces || []).length ? ' · ' + t.provinces.join(' / ') : ''), ''];
  (t.days || []).forEach(function (d, i) {
    lines.push('DAY ' + (i + 1) + ' · ' + d.date);
    (d.items || []).forEach(function (it) {
      lines.push('  ' + (it.time || '--:--') + ' ' + it.place + (it.action ? ' · ' + it.action : ''));
    });
    lines.push('');
  });
  lines.push('跨城交通可在 12306 / 携程 / 去哪儿 搜索「出发-到达」');
  lines.push('— 旅行工作台 · TRAVEL DESK');
  copyText(lines.join('\n'), '行程文本已复制，去粘贴给同行的人吧');
}

function saveTripImage(t) {
  var days = (t.days || []).slice(0, 20);
  var W = 900, H = 340 + days.length * 210 + 130;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#FBF6EC'; ctx.fillRect(0, 0, W, H);
  for (var x = 0; x < W; x += 22) for (var y = 0; y < H; y += 22) { ctx.fillStyle = 'rgba(47,42,38,0.045)'; ctx.fillRect(x + 2, y + 2, 2, 2); }
  ctx.fillStyle = '#FFFDF8'; ctx.fillRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = '#2F2A26'; ctx.lineWidth = 4; ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.fillStyle = 'rgba(232,161,92,0.5)';
  ctx.save(); ctx.translate(150, 44); ctx.rotate(-0.05); ctx.fillRect(-40, -12, 80, 24); ctx.restore();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#A85B1F'; ctx.font = '700 20px ui-monospace,Consolas,monospace';
  ctx.fillText('T R I P   P L A N', W / 2, 112);
  ctx.fillStyle = '#2F2A26'; ctx.font = '800 40px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(t.title, W / 2, 168);
  ctx.fillStyle = '#7A6C5C'; ctx.font = '400 17px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(t.start + ' → ' + t.end + ((t.provinces || []).length ? ' ｜ ' + t.provinces.join(' / ') : ''), W / 2, 200);
  var y = 250;
  days.forEach(function (d, i) {
    ctx.fillStyle = '#FDF6E7'; ctx.fillRect(70, y, W - 140, 180);
    ctx.strokeStyle = 'rgba(47,42,38,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(70, y, W - 140, 180);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#A85B1F'; ctx.font = '800 20px ui-monospace,Consolas,monospace';
    ctx.fillText('DAY ' + (i + 1) + ' · ' + d.date, 92, y + 36);
    ctx.fillStyle = '#2F2A26'; ctx.font = '400 15px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    var items = (d.items || []).slice(0, 5);
    if (!items.length) { ctx.fillText('（这一天还空着）', 92, y + 72); }
    items.forEach(function (it, ii) {
      ctx.fillText((it.time || '--:--') + '  ' + it.place + (it.action ? ' · ' + it.action : ''), 92, y + 70 + ii * 24);
    });
    y += 210;
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7A6C5C'; ctx.font = '400 14px ui-monospace,Consolas,monospace';
  ctx.fillText((t.days || []).length > 20 ? '（长图仅展示前 20 天）' : '', W / 2, y + 20);
  ctx.fillText('— 旅行工作台 · TRAVEL DESK —', W / 2, y + 48);
  cv.toBlob(function (blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '行程_' + t.title + '_' + todayStr() + '.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('行程长图已保存', 'ok');
  });
}

/* ---------------- 存档 ---------------- */
function renderSaveCard() {
  var p = state.profile;
  if (!p) return;
  var g = globalStats();
  var lv = levelFromExp(p.exp);
  var cur = p.exp - (lv - 1) * CONFIG.EXP_PER_LEVEL;
  var achs = state.achievements.slice(0, 6).map(function (a) {
    return '<div class="ach-badge"><div class="ic">' + esc(a.icon) + '</div><div class="nm">' + esc(a.name) + '</div></div>';
  }).join('');
  $('save-card').innerHTML =
    '<div class="save-title">T R A V E L E R   S A V E</div>' +
    '<div class="save-name">' + esc(p.nick || '旅行者') + '</div>' +
    '<div class="save-sub">出发地 · ' + esc(p.origin || '未设置') + ' ｜ ' + esc(todayStr()) + '</div>' +
    '<div class="save-grid">' +
    '<div class="save-stat"><b>LV.' + lv + '</b><span>等级</span></div>' +
    '<div class="save-stat"><b>' + g.provCount + '/34</b><span>省级行政区</span></div>' +
    '<div class="save-stat"><b>' + g.cityCount + '</b><span>城市</span></div>' +
    '<div class="save-stat"><b>' + g.dayCount + '</b><span>在路上</span></div>' +
    '</div>' +
    '<div class="save-exp"><span class="lv mono">LV.' + lv + '</span>' +
    '<div class="expbar"><i style="width:' + Math.min(100, (cur / CONFIG.EXP_PER_LEVEL) * 100) + '%"></i></div>' +
    '<span class="small muted mono">' + p.exp + ' EXP</span></div>' +
    (achs
      ? '<div class="ach-grid">' + achs + '</div>' +
        (ACH_RULES.length > 6
          ? '<div class="small muted mono" style="text-align:center;margin-top:6px"><button class="link-plain" id="save-ach-more">全部 ' + ACH_RULES.length + ' 枚 ' + ICONS.go + '</button></div>'
          : '')
      : '<div class="small muted" style="text-align:center">暂无成就</div>') +
    '<div class="small muted mono" style="text-align:center;margin-top:12px">— TRAVEL DESK · 手账像素版 —</div>';
  var more = $('save-ach-more');
  if (more) more.onclick = function () {
    var card = $('ach-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

function renderSnapList() {
  var p = state.profile;
  if (!p) return;
  var box = $('snap-list');
  var snaps = (p.snapshots || []).slice().reverse();
  if (!snaps.length) {
    box.innerHTML = '<div class="small muted">还没有存档快照。点「保存当前存档」给现在的旅程拍一张照。</div>';
    return;
  }
  box.innerHTML = snaps.map(function (s, i) {
    var idx = (p.snapshots || []).length - 1 - i;
    return '<div class="snap-row">' +
      '<span class="tag caramel">#' + (snaps.length - i) + '</span>' +
      '<div class="s-name">' + esc(s.name) + '<div class="small muted" style="font-weight:400">LV.' + (s.data && s.data.level || 1) + ' · ' + ((s.data && s.data.provCount) || 0) + '/34 省 · ' + esc(s.date) + '</div></div>' +
      '<button class="btn small" data-snapview="' + idx + '">回看</button>' +
      '<button class="btn small danger" data-snapdel="' + idx + '">' + ICONS.trash + '</button>' +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('[data-snapview]'), function (b) {
    b.onclick = function () { viewSnapshot(+b.getAttribute('data-snapview')); };
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-snapdel]'), function (b) {
    b.onclick = function () {
      var idx = +b.getAttribute('data-snapdel');
      confirmDialog('删除存档快照', ['确定删除快照「' + esc(p.snapshots[idx].name) + '」吗？', '快照只读不回写，删除后不可恢复。'], function () {
        p.snapshots.splice(idx, 1);
        queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
        refreshAll();
        toast('快照已删除');
      }, '删除');
    };
  });
}

function snapshotData() {
  if (!state.profile) return null;
  var g = globalStats();
  return {
    nick: state.profile.nick, origin: state.profile.origin,
    level: levelFromExp(state.profile.exp), exp: state.profile.exp,
    provCount: g.provCount, cityCount: g.cityCount, dayCount: g.dayCount,
    achievements: state.achievements.map(function (a) { return a.icon + ' ' + a.name; })
  };
}
function viewSnapshot(idx) {
  if (!state.profile) { toast('数据加载中，请稍候', 'warn'); return; }
  var s = state.profile.snapshots[idx];
  if (!s) return;
  var d = s.data || {};
  var html =
    '<div class="save-title">T R A V E L E R   S A V E</div>' +
    '<div class="save-name">' + esc(d.nick || '旅行者') + '</div>' +
    '<div class="save-sub">' + esc(s.name) + ' · ' + esc(s.date) + '</div>' +
    '<div class="save-grid">' +
    '<div class="save-stat"><b>LV.' + (d.level || 1) + '</b><span>等级</span></div>' +
    '<div class="save-stat"><b>' + (d.provCount || 0) + '/34</b><span>省级行政区</span></div>' +
    '<div class="save-stat"><b>' + (d.cityCount || 0) + '</b><span>城市</span></div>' +
    '<div class="save-stat"><b>' + (d.dayCount || 0) + '</b><span>在路上</span></div>' +
    '</div>' +
    '<div class="small muted" style="text-align:center">EXP ' + (d.exp || 0) + ' ｜ 成就：' + esc((d.achievements || []).join(' / ') || '暂无') + '</div>' +
    '<div class="small muted mono" style="text-align:center;margin-top:10px">— 只读快照 · 不回写数据表 —</div>';
  showModal('存档回看', html);
}

/* 一键存档：自动命名（日期 · LV.n），保留最近 10 版；auto=true 为里程碑自动存档 */
function saveSnapshot(auto) {
  if (!state.profile) { toast('数据加载中，请稍候', 'warn'); return; }
  state.profile.snapshots = state.profile.snapshots || [];
  var lv = levelFromExp(state.profile.exp);
  state.profile.snapshots.push({ name: todayStr() + ' · LV.' + lv, date: todayStr(), data: snapshotData() });
  if (state.profile.snapshots.length > 10) state.profile.snapshots = state.profile.snapshots.slice(-10);
  queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
  if (auto) toast('已自动存档', 'ok');
}

/* ---------------- 存档长图（Canvas 绘制） ---------------- */
function saveCardImage() {
  var p = state.profile;
  if (!p) { toast('数据加载中，请稍候', 'warn'); return; }
  var g = globalStats();
  var lv = levelFromExp(p.exp), cur = p.exp - (lv - 1) * CONFIG.EXP_PER_LEVEL;
  var W = 900, H = 1160;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  /* 背景 */
  ctx.fillStyle = '#FBF6EC';
  ctx.fillRect(0, 0, W, H);
  for (var x = 0; x < W; x += 22) for (var y = 0; y < H; y += 22) { ctx.fillStyle = 'rgba(47,42,38,0.045)'; ctx.fillRect(x + 2, y + 2, 2, 2); }
  /* 主体卡片 */
  ctx.fillStyle = '#FFFDF8';
  ctx.fillRect(40, 40, W - 80, H - 80);
  ctx.strokeStyle = '#2F2A26'; ctx.lineWidth = 4;
  ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.setLineDash([8, 8]); ctx.lineWidth = 2;
  ctx.strokeRect(60, 60, W - 120, H - 120);
  ctx.setLineDash([]);
  /* 胶带 */
  ctx.fillStyle = 'rgba(232,161,92,0.5)';
  ctx.save(); ctx.translate(150, 44); ctx.rotate(-0.05); ctx.fillRect(-40, -12, 80, 24); ctx.restore();
  ctx.fillStyle = 'rgba(122,155,109,0.4)';
  ctx.save(); ctx.translate(W - 150, 44); ctx.rotate(0.06); ctx.fillRect(-40, -12, 80, 24); ctx.restore();
  /* 标题 */
  ctx.fillStyle = '#A85B1F';
  ctx.font = '700 20px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'center';
  ctx.fillText('T R A V E L E R   S A V E', W / 2, 116);
  ctx.fillStyle = '#2F2A26';
  ctx.font = '800 44px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(p.nick || '旅行者', W / 2, 176);
  ctx.fillStyle = '#7A6C5C';
  ctx.font = '400 18px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('出发地 · ' + (p.origin || '未设置') + ' ｜ ' + todayStr(), W / 2, 208);
  /* 统计格 */
  var stats = [['LV.' + lv, '等级'], [g.provCount + '/34', '省级行政区'], [g.cityCount, '城市'], [g.dayCount, '在路上']];
  var bw = 180, gap = 20, bx = (W - (bw * 4 + gap * 3)) / 2;
  for (var s = 0; s < 4; s++) {
    var x0 = bx + s * (bw + gap);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x0, 240, bw, 96);
    ctx.strokeStyle = '#2F2A26'; ctx.lineWidth = 3;
    ctx.strokeRect(x0, 240, bw, 96);
    ctx.fillStyle = '#A85B1F';
    ctx.font = '800 30px ui-monospace,Consolas,monospace';
    ctx.fillText(String(stats[s][0]), x0 + bw / 2, 288);
    ctx.fillStyle = '#7A6C5C';
    ctx.font = '400 16px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(stats[s][1], x0 + bw / 2, 318);
  }
  /* 经验条 */
  var ex = 110, ew = W - 220;
  ctx.fillStyle = '#F3EAD8';
  ctx.fillRect(ex, 386, ew, 30);
  ctx.strokeStyle = '#2F2A26'; ctx.lineWidth = 3;
  ctx.strokeRect(ex, 386, ew, 30);
  var pctW = Math.max(0, Math.min(1, cur / CONFIG.EXP_PER_LEVEL)) * (ew - 8);
  ctx.fillStyle = '#C8763C';
  for (var sx = 0; sx < pctW; sx += 12) ctx.fillRect(ex + 4 + sx, 390, 10, 22);
  ctx.fillStyle = '#2F2A26';
  ctx.font = '700 18px ui-monospace,Consolas,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('LV.' + lv, 40, 408);
  ctx.textAlign = 'right';
  ctx.fillText(p.exp + ' EXP', W - 40, 408);
  /* 成就 */
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2F2A26';
  ctx.font = '700 20px ui-monospace,Consolas,monospace';
  ctx.fillText('ACHIEVEMENTS · 成就', 110, 480);
  var achs = state.achievements.slice(0, 6);
  achs.forEach(function (a, ai) {
    var col = ai % 4, row = Math.floor(ai / 4);
    var x0 = 110 + col * 170, y0 = 500 + row * 120;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x0, y0, 150, 100);
    ctx.strokeStyle = '#2F2A26'; ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, 150, 100);
    ctx.textAlign = 'center';
    ctx.font = '34px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(a.icon || '🏅', x0 + 75, y0 + 46);
    ctx.fillStyle = '#2F2A26';
    ctx.font = '700 15px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(a.name, x0 + 75, y0 + 76);
    ctx.textAlign = 'left';
  });
  if (!achs.length) {
    ctx.fillStyle = '#7A6C5C';
    ctx.font = '400 16px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('暂无成就，去点亮第一座城市吧', 110, 520);
  }
  /* 底部 */
  ctx.textAlign = 'center';
  ctx.fillStyle = '#A79B8B';
  ctx.font = '400 16px ui-monospace,Consolas,monospace';
  ctx.fillText('— TRAVEL DESK · 手账像素版 —', W / 2, H - 80);
  /* 导出 */
  if (cv.toBlob) {
    cv.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '旅行者存档_' + todayStr() + '.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('长图已保存', 'ok');
    }, 'image/png');
  } else {
    var a2 = document.createElement('a');
    a2.href = cv.toDataURL('image/png');
    a2.download = '旅行者存档_' + todayStr() + '.png';
    a2.click();
    toast('长图已保存', 'ok');
  }
}

function copyShareText() {
  var p = state.profile;
  if (!p) { toast('数据加载中，请稍候', 'warn'); return; }
  var g = globalStats();
  var lv = levelFromExp(p.exp);
  var text =
    '🗺️ 旅行者存档 · ' + (p.nick || '旅行者') + '\n' +
    '出发地：' + (p.origin || '未设置') + '\n' +
    '等级：LV.' + lv + '（EXP ' + p.exp + '）\n' +
    '已点亮 ' + g.provCount + '/34 个省级行政区 · 去过 ' + g.cityCount + ' 座城市 · 在路上 ' + g.dayCount + ' 天\n' +
    '成就：' + (state.achievements.map(function (a) { return a.name; }).join(' / ') || '暂无') + '\n' +
    '—— 旅行工作台 TRAVEL DESK';
  function done() { toast('分享文本已复制', 'ok'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
  } else { fallbackCopy(text); done(); }
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { }
  ta.remove();
}

/* ---------------- 成就墙 ---------------- */
function renderAchGrid() {
  var box = $('ach-grid');
  var unlocked = {};
  state.achievements.forEach(function (a) { unlocked[a.name] = a; });
  var html = ACH_RULES.map(function (r) {
    var a = unlocked[r.name];
    if (a) {
      return '<div class="ach-badge"><div class="ic">' + esc(a.icon) + '</div><div class="nm">' + esc(a.name) + '</div><div class="dt">' + esc(a.date) + '</div></div>';
    }
    return '<div class="ach-badge locked"><div class="ic">' + esc(r.icon) + '</div><div class="nm">' + esc(r.name) + '</div><div class="dt">' + esc(r.desc) + '</div></div>';
  }).join('');
  box.innerHTML = html;
  /* 计数只统计能匹配到规则墙的成就（导入的自定义成就不计入，防计数与展示不符） */
  var ruleNames = {};
  ACH_RULES.forEach(function (r) { ruleNames[r.name] = 1; });
  var matched = state.achievements.filter(function (a) { return ruleNames[a.name]; }).length;
  $('ach-count').textContent = '已解锁 ' + matched + ' / ' + ACH_RULES.length;
}

/* ---------------- 数据管理 ---------------- */
function exportJSON() {
  var strip = function (r) { var c = Object.assign({}, r); delete c.recId; delete c.isNew; return c; };
  var data = {
    app: '旅行工作台 TRAVEL DESK', version: 1,
    exportedAt: new Date().toISOString(),
    profile: strip(state.profile),
    footprints: state.footprints.map(strip),
    trips: state.trips.map(strip),
    tasks: state.tasks.map(strip),
    achievements: state.achievements.map(strip)
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '旅行工作台备份_' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function importJSON(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var data;
    try { data = JSON.parse(reader.result); } catch (e) { toast('文件解析失败，不是有效的 JSON', 'warn'); return; }
    if (!data || !data.profile || !Array.isArray(data.footprints)) { toast('备份格式不正确', 'warn'); return; }
    /* 记录级校验：统计非法条目，导入时跳过 */
    var bad = 0;
    ['footprints', 'trips', 'tasks', 'achievements'].forEach(function (key) {
      (data[key] || []).forEach(function (rec) { if (validateRecord(key, rec)) bad++; });
    });
    confirmDialog('导入恢复',
      ['将用备份文件替换当前全部数据（足迹 ' + (data.footprints || []).length + ' 条 · 行程 ' + (data.trips || []).length + ' 个 · 任务 ' + (data.tasks || []).length + ' 条' + (bad ? '，其中 ' + bad + ' 条不完整将被跳过' : '') + '）。',
       '云端数据表会与备份内容对齐（多余记录删除、缺失记录补建）。此操作不可恢复，建议先导出当前数据。'],
      function () {
        /* 作废与备份冲突的旧写队列 op（不再无条件清空）：
           - upsert：导入的全量数据会重新入队覆盖，旧 op 直接丢弃
           - remove：备份中仍存在的 id，其 remove 会被重新 upsert 取代；
             备份中没有的 id，remove 保留执行（防恢复在线后云端旧行复活） */
        var backupIds = {};
        ['footprints', 'trips', 'tasks', 'achievements'].forEach(function (key) {
          (data[key] || []).forEach(function (r) { if (r && r.id) backupIds[key + '|' + r.id] = 1; });
        });
        Sync.queue = Sync.queue.filter(function (op) {
          if (op.action !== 'remove') return false;
          return !backupIds[op.table + '|' + op.id];
        });
        saveSyncState();
        importLocal(data, bad);
      }, '确认导入');
  };
  reader.readAsText(file);
}

/* 本地模式导入：直接替换 + 全部入队（恢复在线后自动 flush） */
function importLocal(data, bad) {
  var valid = {};
  ['footprints', 'trips', 'tasks', 'achievements'].forEach(function (key) {
    valid[key] = (data[key] || []).filter(function (rec) { return !validateRecord(key, rec); })
      .map(function (rec) { var r = Object.assign({}, rec); delete r.recId; delete r.isNew; return r; });
  });
  state.profile = Object.assign(defaultProfile(), data.profile);
  state.profile.id = 'main';
  state.footprints = valid.footprints;
  state.trips = valid.trips;
  state.tasks = valid.tasks;
  state.achievements = valid.achievements;
  queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
  valid.footprints.forEach(function (f) { queueWrite({ table: 'footprints', action: 'upsert', id: f.id }); });
  valid.trips.forEach(function (t) { queueWrite({ table: 'trips', action: 'upsert', id: t.id }); });
  valid.tasks.forEach(function (k) { queueWrite({ table: 'tasks', action: 'upsert', id: k.id }); });
  valid.achievements.forEach(function (a) { queueWrite({ table: 'achievements', action: 'upsert', id: a.id }); });
  cacheSaveNow();
  refreshAll();
  /* D12：导入成功为确认类，静默；仅不完整/只读缓存时提示 */
  if (bad) toast('导入完成（跳过 ' + bad + ' 条不完整记录）', 'warn');
}

function clearAllData() {
  confirmDialog('清空全部数据（1/2）',
    ['将清空：旅行档案、全部足迹、全部行程、全部任务、全部成就。',
     '云端 5 张数据表中的记录会被同步删除，此操作不可恢复。',
     '其他已打开的设备需各自刷新或清空（防误删的同步保护）。'],
    function () {
      confirmDialog('清空全部数据（2/2）',
        ['<b>再次确认：真的要把所有旅行数据都清空吗？</b>',
         '建议先「导出 JSON 备份」。清空后可通过导入恢复。'],
        function () {
          /* 全部记录入队移除（含本会话新建未 flush 的：无 recId 时 flush 会按 id 查云端兜底，防幽灵行） */
          state.footprints.forEach(function (f) { queueWrite({ table: 'footprints', action: 'remove', id: f.id, recId: f.recId }); });
          state.trips.forEach(function (t) { queueWrite({ table: 'trips', action: 'remove', id: t.id, recId: t.recId }); });
          state.tasks.forEach(function (k) { queueWrite({ table: 'tasks', action: 'remove', id: k.id, recId: k.recId }); });
          state.achievements.forEach(function (a) { queueWrite({ table: 'achievements', action: 'remove', id: a.id, recId: a.recId }); });
          /* profile 复用现有 recId 走 update 重置，避免云端累积垃圾行 */
          var oldRecId = state.profile && state.profile.recId;
          state.profile = defaultProfile();
          if (oldRecId) state.profile.recId = oldRecId;
          queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
          state.footprints = []; state.trips = []; state.tasks = []; state.achievements = [];
          state.selProvince = ''; state.tripDetailId = '';
          cacheSaveNow();
          refreshAll();
          toast('已清空全部数据', 'ok');
        }, '确认清空');
    }, '继续');
}

/* ---------------- 升级庆祝 ---------------- */
function showLevelUp(lv) {
  var root = $('levelup-root');
  if (!root) return;
  root.innerHTML = '<div class="levelup-card"><div class="lv-num">LV.' + lv + '</div><div class="lv-txt">LEVEL UP · 旅行者等级提升</div></div>';
  var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  var colors = ['#C8763C', '#E8A15C', '#F0BE8A', '#4E8A5A', '#C0392B'];
  for (var i = 0; i < 18; i++) {
    var p = document.createElement('div');
    p.className = 'particle';
    p.style.left = (cx - 4) + 'px';
    p.style.top = (cy - 4) + 'px';
    p.style.background = colors[i % colors.length];
    root.appendChild(p);
    var ang = (i / 18) * Math.PI * 2;
    var dist = 130 + Math.random() * 140;
    try {
      p.animate([
        { transform: 'translate(0,0) scale(1.2)', opacity: 1 },
        { transform: 'translate(' + (Math.cos(ang) * dist) + 'px,' + (Math.sin(ang) * dist) + 'px) scale(0.2)', opacity: 0 }
      ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    } catch (e) { }
  }
  setTimeout(function () { root.innerHTML = ''; }, 1900);
}

/* ---------------- 存档 Tab 汇总渲染 ---------------- */
function renderArchiveTab() {
  var p = state.profile;
  /* 签名守卫：档案关键字段 + 快照数 + 成就集合未变则跳过 */
  var sig = p ? [p.exp, p.nick, p.origin, (p.snapshots || []).length, (p.want || []).length].join('|') +
    '#' + state.achievements.map(function (a) { return a.id; }).join(',') +
    '#' + state.footprints.length : 'empty';
  if (sigUnchanged('archive', sig)) return;
  renderSaveCard();
  renderSnapList();
  renderAchGrid();
  var hint = $('data-hint');
  if (hint) {
    hint.textContent = cacheDegraded
      ? '警告：本地缓存不可用（存储空间不足），数据仅存于内存，请立即导出 JSON 备份！'
      : '当前为本地模式：数据保存在此浏览器 localStorage，建议定期导出 JSON 备份。';
  }
}

/* ---------------- 全局刷新入口（唯一调度点） ---------------- */
function refreshAll() {
  if (!state.loaded) return;
  recomputeDerived();   /* 数据层：派生字段 + 成就检查 */
  renderLevelChip();
  renderSyncStatus();
  renderToday();
  renderStatsBar();
  renderMapData();      /* 地图层 */
  renderProfileCard();
  renderRecent();
  renderNextTask();
  renderBook();
  renderFootTab();
  renderTripTab();
  renderArchiveTab();
}

/* ---------------- 静态 UI 绑定 ---------------- */
function bindUI() {
  $('sync-retry').onclick = function () { toast('本地模式：数据保存在此浏览器，建议定期到「存档」导出 JSON 备份', 'warn'); };
  $('btn-add-foot').onclick = function () { openFootprintModal(null, '', ''); };
  $('foot-batch-toggle').onclick = function () {
    state.footBatch.on = !state.footBatch.on;
    state.footBatch.picked = {};
    renderFootTab();
  };
  $('btn-add-trip').onclick = openTripModal;
  $('f-province').onchange = function () { state.footFilter.province = this.value; refreshAll(); };
  $('f-tag').onchange = function () { state.footFilter.tag = this.value; refreshAll(); };
  $('f-year').onchange = function () { state.footFilter.year = this.value; refreshAll(); };
  $('f-reset').onclick = function () { resetFootFilter(); refreshAll(); };
  $('btn-save-snap').onclick = function () { saveSnapshot(false); refreshAll(); };
  $('btn-save-img').onclick = saveCardImage;
  $('btn-copy-share').onclick = copyShareText;
  $('btn-export').onclick = exportJSON;
  $('btn-import').onclick = function () { $('import-file').click(); };
  $('import-file').onchange = function () {
    if (this.files && this.files[0]) importJSON(this.files[0]);
    this.value = '';
  };
  $('btn-clear').onclick = clearAllData;
  var fab = $('fab-note');
  if (fab) fab.onclick = openQuickNote;
}

/* ---------------- 键盘快捷键（桌面） ---------------- */
function initHotkeys() {
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    var typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    var k = e.key;
    if (!typing && k >= '1' && k <= '4') {
      var tab = TABS[+k - 1];
      if (tab) switchTab(tab.key);
    } else if (k === '/') {
      if (typing && t.id === 'f-q') return;
      e.preventDefault();
      if (activeTab !== 'foot') switchTab('foot');
      setTimeout(function () { var q = $('f-q'); if (q) q.focus(); }, 60);
    } else if (!typing && (k === 'n' || k === 'N')) {
      if (activeTab === 'map' && typeof openQuickNote === 'function') openQuickNote();
    }
  });
}

/* ---------------- 启动：缓存先行秒开 → 在线拉取后刷新 ---------------- */
function boot() {
  $('brand-badge').innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" shape-rendering="crispEdges">' +
    '<rect x="3" y="7" width="16" height="11" rx="1.5" stroke="#FFFDF8" stroke-width="1.8"/>' +
    '<path d="M8 7V5.2c0-1 .8-1.8 1.8-1.8h2.4c1 0 1.8.8 1.8 1.8V7" stroke="#FFFDF8" stroke-width="1.8"/>' +
    '<path d="M3 11.5h16" stroke="#FFFDF8" stroke-width="1.4"/></svg>';
  renderBottomNav();
  syncTopbarHeight();      /* 桌面侧边栏固定定位依赖顶栏实际高度 */
  window.addEventListener('resize', debounce(syncTopbarHeight, 150));
  initEscapeKey();         /* Escape 关闭弹层（a11y） */
  initLayerFocusTrap();    /* Tab 焦点约束在弹层内（a11y） */
  initMap();               /* 地图本地资产，立即渲染，保证 1 秒内可见 */
  loadDataSync();          /* 同步：应用缓存/示例，首屏秒开 */
  restoreQueue();          /* 恢复离线写队列 */
  try {
    refreshAll();          /* 立即渲染全部模块 */
  } catch (err) {
    console.error('[boot] refreshAll failed:', err);
  }
  bindUI();                /* 交互立即可用 */
  initHotkeys();           /* 键盘快捷键（桌面） */
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
