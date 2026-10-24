/* ============================================================
 * MAP 层 · 大中国地图（ECharts + 内联 GeoJSON，纯离线渲染）
 * 渲染函数只读 state；交互只改 state 并交给 refreshAll()
 * 悬浮 = 轻量浮层（无遮罩、不拦截指针）；点击 = 选中 + 底部抽屉
 * ============================================================ */
var mapChart = null, mapReady = false;
var MAP_VIEW = { zoom: 1.18, center: [104, 34] };

function initMap() {
  if (typeof echarts === 'undefined' || !window.CHINA_GEO) {
    var ld = $('map-loading');
    if (ld) ld.innerHTML = '<div style="text-align:center"><div style="font-size:26px">🗺️</div><div style="margin-top:8px">地图资源未加载</div><div style="font-size:11px;margin-top:4px">请使用本文件自带的 ECharts 与 GeoJSON</div></div>';
    return;
  }
  try {
    /* 幂等：脚本重复执行时先释放旧实例，避免同 DOM 重复 init 泄漏 */
    if (mapChart) { try { mapChart.dispose(); } catch (e) { } mapChart = null; mapReady = false; }
    echarts.registerMap('china', window.CHINA_GEO);
    mapChart = echarts.init($('china-map'), null, { renderer: 'canvas' });
    bindMapEvents();
    mapReady = true;
    var ld2 = $('map-loading');
    if (ld2) ld2.classList.add('hidden');
  } catch (e) {
    console.error('[map] init failed:', e);
    var ld3 = $('map-loading');
    if (ld3) ld3.innerHTML = '<div style="text-align:center"><div style="font-size:26px">⚠️</div><div style="margin-top:8px">地图初始化失败</div></div>';
  }
}

/* ---------------- 事件：悬浮浮层 / 点击抽屉 / 双击复位 ---------------- */
function bindMapEvents() {
  var isFinePointer = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
  var hoverTimer = null;

  /* 触屏设备提示文案与桌面不同（无滚轮、纵向滑动归页面滚动） */
  var hint = $('map-hint');
  if (hint && window.matchMedia && window.matchMedia('(pointer:coarse)').matches) {
    hint.textContent = '双指缩放 · 左右拖动平移 · 双击空白复位';
  }

  /* 悬浮（仅桌面精确指针）：120ms 延迟后显示轻量浮层，无遮罩、pointer-events:none，不拦截地图操作 */
  mapChart.on('mouseover', function (p) {
    if (!isFinePointer) return;
    var prov = (p && (p.componentType === 'geo' || p.seriesType === 'map')) ? p.name : '';
    if (!prov || PROVINCES.indexOf(prov) < 0) { hideHoverCard(); return; }
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { showHoverCard(prov); }, 120);
  });
  mapChart.on('mouseout', function (p) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hideHoverCard();
  });
  mapChart.on('globalout', function () {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hideHoverCard();
  });

  /* 点击：选中省份（持续高亮）+ 打开底部抽屉；点击城市散点打开城市记录 */
  mapChart.on('click', function (p) {
    hideHoverCard();
    if (p.componentType === 'series' && p.seriesType === 'scatter') {
      var d = p.data || {};
      openCityPanel(d.city, d.province);
      return;
    }
    var prov = p ? p.name : '';
    if (prov && PROVINCES.indexOf(prov) >= 0) {
      if (state.selProvince !== prov) {
        state.selProvince = prov;
        renderMapData();   /* 数据未变，只重画地图选中高亮 */
      }
      openProvincePanel(prov, true);
    }
  });

  /* 双击地图空白处复位（桌面 dblclick + 触屏双击自定义检测：
     zrender 触屏不合成 dblclick，需自行判断 300ms 内两次空白点击） */
  var lastBlankTap = 0;
  mapChart.getZr && mapChart.getZr().on('dblclick', function (e) {
    if (!e.target) resetMapView();
  });
  mapChart.getZr && mapChart.getZr().on('click', function (e) {
    var now = Date.now();
    if (e.target) { lastBlankTap = 0; return; }   /* 点在省份/散点上，不计入 */
    if (now - lastBlankTap < 320) { resetMapView(); lastBlankTap = 0; return; }
    lastBlankTap = now;
  });

  /* 页面滚动/缩放时隐藏悬浮卡（定位为 fixed，避免停留在错位位置） */
  window.addEventListener('scroll', hideHoverCard, { passive: true });
  window.addEventListener('resize', hideHoverCard);

  /* 容器尺寸变化自动重绘（含手机横竖屏） */
  var onResize = debounce(function () { if (mapChart) mapChart.resize(); }, 150);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

function resetMapView() {
  if (!mapChart) return;
  mapChart.setOption({ geo: { zoom: MAP_VIEW.zoom, center: MAP_VIEW.center } });
}

/* ---------------- 悬浮浮层（只读，不弹遮罩） ---------------- */
function showHoverCard(prov) {
  var card = $('hover-card');
  if (!card) return;
  var recs = provinceFootprints(prov);
  var prof = state.profile;
  var want = !!(prof && (prof.want || []).indexOf(prov) >= 0);
  var html = '<div class="hc-title">' + esc(prov) + (want ? ' <span class="tag caramel">想去</span>' : '') + '</div>';
  if (recs.length) {
    var cities = {};
    recs.forEach(function (f) { cities[f.city] = (cities[f.city] || 0) + 1; });
    var names = Object.keys(cities);
    var chips = names.slice(0, 4).map(function (c) { return '<span class="tag caramel">' + esc(c) + '×' + cities[c] + '</span>'; }).join('');
    var latest = recs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    html += '<div class="hc-cities">' + chips + (names.length > 4 ? '<span class="muted small">等 ' + names.length + ' 城</span>' : '') + '</div>' +
      '<div class="hc-mem">最近 ' + esc(latest.date) + '：' + esc(latest.note) + '</div>' +
      '<div class="hc-tip">点击查看完整足迹</div>';
  } else {
    html += '<div class="hc-mem">' + esc(inviteFor(prov)) + '</div><div class="hc-tip">点击可标记想去</div>';
  }
  card.innerHTML = html;
  card.classList.remove('hidden');
  /* 定位到地图容器右上角 */
  var shell = $('map-shell');
  if (!shell) return;
  var r = shell.getBoundingClientRect();
  var w = Math.min(250, Math.max(180, r.width - 24));
  card.style.width = w + 'px';
  card.style.left = Math.max(8, r.right - w - 12) + 'px';
  card.style.top = (r.top + 12) + 'px';
}
function hideHoverCard() {
  var c = $('hover-card');
  if (c) c.classList.add('hidden');
}

/* ---------------- 统计聚合 ---------------- */
function provinceCityStats() {
  var m = {};
  state.footprints.forEach(function (f) {
    if (!f.province) return;
    if (!m[f.province]) m[f.province] = {};
    var c = f.city || '未知城市';
    m[f.province][c] = (m[f.province][c] || 0) + 1;
  });
  return m;
}
function globalStats() {
  var provSet = {}, citySet = {}, daySet = {};
  state.footprints.forEach(function (f) {
    if (f.province) provSet[f.province] = 1;
    if (f.city) citySet[f.city] = 1;
    if (f.date) daySet[f.date] = 1;
  });
  return { provCount: Object.keys(provSet).length, cityCount: Object.keys(citySet).length, dayCount: Object.keys(daySet).length };
}

/* ---------------- 渲染地图数据（签名守卫 + merge 更新） ---------------- */
var _mapSig = '';
function renderMapData() {
  if (!mapReady || !mapChart) return;
  var wantProvs = (state.profile && state.profile.want) || [];
  var sig = state.selProvince + '|' + wantProvs.join(',') + '|' + state.footprints.map(function (f) {
    return f.id + f.province + f.city + f.date;
  }).join(',');
  if (sigUnchanged('map', sig)) return;   /* 数据未变则跳过，交互不重画地图 */

  var stats = provinceCityStats();
  var mapData = PROVINCES.map(function (p) {
    var n = stats[p] ? Object.keys(stats[p]).length : 0;
    var item = { name: p };
    if (p === state.selProvince) item.selected = true;   /* 选中高亮对已去/未去省份都生效 */
    if (wantProvs.indexOf(p) >= 0) {
      /* 想去省份：焦糖虚线省界（种草过 vs 没听说过一眼可分） */
      item.itemStyle = { borderType: 'dashed', borderColor: '#B25E1E', borderWidth: 1.6 };
    }
    if (n > 0) item.value = n;
    return item;
  });

  /* 城市像素散点（同城多次到访合并，方块越大次数越多） */
  var cityAgg = {};
  state.footprints.forEach(function (f) {
    if (!f.city) return;
    var key = f.province + '|' + f.city;
    if (!cityAgg[key]) cityAgg[key] = { city: f.city, province: f.province, count: 0 };
    cityAgg[key].count++;
  });
  var scatter = [];
  Object.keys(cityAgg).forEach(function (k) {
    var c = cityAgg[k];
    var co = CITY_COORDS[c.city];
    if (!co) return;
    scatter.push({
      name: c.city,
      value: [co[0], co[1], c.count],
      city: c.city, province: c.province,
      symbolSize: Math.min(16, 6 + c.count * 2.5)
    });
  });

  /* 想去省份图钉（省会坐标，独立 scatter 层，不参与 visualMap） */
  var wantPins = [];
  wantProvs.forEach(function (w) {
    var cap = PROV_CAPITAL[w];
    var co = cap && CITY_COORDS[cap];
    if (co) wantPins.push({ name: w, value: [co[0], co[1], 1] });
  });

  /* merge 更新（不 replaceSet）：仅数据变化做 diff，更新动画 150ms */
  mapChart.setOption({
    tooltip: { show: false },
    visualMap: {
      type: 'continuous', min: 1, max: 5, calculable: false, show: false, seriesIndex: 0,
      inRange: { color: ['#F7DDBE', '#F0BE8A', '#E8A15C', '#D67F35', '#B25E1E'] }
    },
    geo: {
      map: 'china', roam: true, zoom: MAP_VIEW.zoom, center: MAP_VIEW.center,
      scaleLimit: { min: 0.75, max: 8 },
      selectedMode: false,
      itemStyle: {
        areaColor: '#EFE9DC',
        borderColor: 'rgba(47,42,38,0.35)', borderWidth: 0.9, borderType: 'solid',
        shadowColor: 'rgba(47,42,38,0.10)', shadowBlur: 4, shadowOffsetY: 2
      },
      emphasis: {
        disabled: false,
        itemStyle: { areaColor: '#F8E9CB', borderColor: '#2F2A26', borderWidth: 2, shadowColor: 'rgba(200,118,60,0.45)', shadowBlur: 8 },
        label: { show: true, color: '#2F2A26', fontSize: 11, fontFamily: 'ui-monospace,Consolas,monospace', fontWeight: 700 }
      },
      select: { disabled: true }
    },
    series: [
      {
        type: 'map', geoIndex: 0, map: 'china', data: mapData,
        selectedMode: 'single',
        itemStyle: { areaColor: '#EFE9DC', borderColor: 'rgba(47,42,38,0.35)', borderWidth: 0.9 },
        /* 悬浮高亮：只让当前凸起的这一块响应（ECharts 原生单区域 emphasis） */
        emphasis: {
          disabled: false,
          itemStyle: {
            areaColor: '#F8E9CB', borderColor: '#2F2A26', borderWidth: 2,
            shadowColor: 'rgba(200,118,60,0.5)', shadowBlur: 8, shadowOffsetY: 0
          },
          label: { show: true, color: '#2F2A26', fontSize: 11, fontFamily: 'ui-monospace,Consolas,monospace', fontWeight: 700 }
        },
        /* 选中持续高亮（像素描边 + 亮度提升） */
        select: {
          disabled: false,
          itemStyle: {
            borderColor: '#2F2A26', borderWidth: 2.5,
            shadowColor: 'rgba(200,118,60,0.65)', shadowBlur: 10, shadowOffsetY: 0
          },
          label: { show: true, color: '#2F2A26', fontSize: 11, fontFamily: 'ui-monospace,Consolas,monospace', fontWeight: 700 }
        }
      },
      {
        type: 'scatter', coordinateSystem: 'geo', geoIndex: 0,
        data: scatter, symbol: 'rect', zlevel: 2,
        itemStyle: { color: '#C8763C', borderColor: '#FFFDF8', borderWidth: 1.5, shadowBlur: 3, shadowColor: 'rgba(47,42,38,.4)' },
        emphasis: { itemStyle: { color: '#A85B1F', borderColor: '#2F2A26', borderWidth: 2 } },
        label: { show: false },
        tooltip: { show: false }
      },
      {
        type: 'scatter', coordinateSystem: 'geo', geoIndex: 0,
        data: wantPins, symbol: 'pin', symbolSize: 20, zlevel: 3,
        itemStyle: { color: '#B25E1E', borderColor: '#FFFDF8', borderWidth: 1.5, shadowBlur: 3, shadowColor: 'rgba(47,42,38,.4)' },
        label: { show: false }, tooltip: { show: false },
        emphasis: { disabled: true }
      }
    ]
  });
  /* a11y：动态描述（省份/城市/想去数量），读屏用户可感知。
     ECharts 按 zlevel 分多个 canvas 层，渲染后可能重建，故每层都补语义 */
  var provCnt = Object.keys(stats).length;
  var cityCnt = 0;
  Object.keys(stats).forEach(function (k) { cityCnt += Object.keys(stats[k]).length; });
  var ariaText = '中国足迹地图：已点亮 ' + provCnt + ' 个省级行政区、' + cityCnt + ' 座城市' +
    (wantProvs.length ? '，标记了 ' + wantProvs.length + ' 个想去的目的地' : '');
  Array.prototype.forEach.call(mapChart.getDom().querySelectorAll('canvas'), function (cv, i) {
    if (i === 0) { cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', ariaText); }
    else { cv.setAttribute('aria-hidden', 'true'); }
  });
}

/* ---------- 省份面板（点击后底部抽屉） ---------- */
function provinceFootprints(prov) {
  return state.footprints.filter(function (f) { return f.province === prov; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
}
function inviteFor(prov) {
  if (INVITES[prov]) return INVITES[prov];
  return INVITE_GENERIC[stableHash(prov) % INVITE_GENERIC.length];
}

/* 想去标记切换（地图面板 / 旅行者卡共用；D12 后静默，界面即时可见） */
function toggleWant(prov) {
  if (!state.profile) { toast('数据加载中，请稍候', 'warn'); return; }
  var list = state.profile.want || [];
  var i = list.indexOf(prov);
  if (i >= 0) { list.splice(i, 1); }
  else { list.push(prov); }
  state.profile.want = list;
  queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
}

function openProvincePanel(prov, asSheet) {
  var recs = provinceFootprints(prov);
  var prof = state.profile || defaultProfile();
  var want = (prof.want || []).indexOf(prov) >= 0;
  var html = '';
  if (recs.length) {
    var cities = {};
    recs.forEach(function (f) { cities[f.city] = (cities[f.city] || 0) + 1; });
    var cityChips = Object.keys(cities).map(function (c) {
      return '<span class="tag caramel">' + esc(c) + ' ×' + cities[c] + '</span>';
    }).join('');
    var latest = recs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    var mems = recs.slice(0, 6).map(function (f) {
      var tags = (f.tags || []).map(function (t) { return '<span class="tag gray">' + esc(t) + '</span>'; }).join(' ');
      return '<div class="recent-item"><div class="r-city">' + esc(f.city) + '<small>' + esc(f.date) + '</small></div><div class="r-note">' + esc(f.note) + '<div style="margin-top:4px">' + tags + '</div></div></div>';
    }).join('');
    html =
      '<div class="form-row"><label>去过城市</label><div style="display:flex;gap:6px;flex-wrap:wrap">' + cityChips + '</div></div>' +
      '<div class="dashed"></div>' +
      '<div class="small muted" style="margin-bottom:8px">最近一次到访：<b class="mono">' + esc(latest.date) + '</b> · ' + esc(latest.city) + '</div>' +
      '<div id="panel-mems">' + mems + '</div>' +
      '<div class="btn-row" style="margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn primary" id="panel-add-foot">＋ 记录一次到访</button>' +
      '<button class="btn" id="panel-go-foot">' + ICONS.foot + ' 查看足迹</button>' +
      '<button class="btn ' + (want ? 'green' : '') + '" id="panel-want">' + (want ? '已标记想去 ✓' : '标记为想去') + '</button>' +
      '</div>';
  } else {
    html =
      '<div style="text-align:center;padding:10px 0 4px">' +
      '<div style="font-size:40px">' + (want ? '📌' : '❔') + '</div>' +
      '<div style="font-weight:700;margin-top:8px">' + esc(prov) + '</div>' +
      '<div class="muted small" style="margin-top:4px">' + esc(inviteFor(prov)) + '</div>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:14px;justify-content:center">' +
      '<button class="btn primary" id="panel-want">' + (want ? '取消想去' : '标记为想去') + '</button>' +
      '<button class="btn" id="panel-add-foot">记录一次到访</button>' +
      '</div>';
  }
  showSheet(prov + ' · 足迹', html);
  var wb = $('panel-want');
  if (wb) wb.onclick = function () {
    toggleWant(prov);
    closeSheet();
    refreshAll();
  };
  var gf = $('panel-go-foot');
  if (gf) gf.onclick = function () {
    resetFootFilter(prov);
    closeSheet();
    switchTab('foot');
    refreshAll();
  };
  var af = $('panel-add-foot');
  if (af) af.onclick = function () { closeSheet(); openFootprintModal(null, prov, ''); };
}

/* ---------- 城市面板 ---------- */
function openCityPanel(city, prov) {
  var recs = state.footprints.filter(function (f) { return f.city === city && (!prov || f.province === prov); })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var html = '<div class="small muted" style="margin-bottom:10px">' + esc(prov || (recs[0] && recs[0].province) || '') + ' · 到访 ' + recs.length + ' 次</div>';
  recs.forEach(function (f) {
    var tags = (f.tags || []).map(function (t) { return '<span class="tag gray">' + esc(t) + '</span>'; }).join(' ');
    html += '<div class="task-row" style="align-items:flex-start">' +
      '<div class="tk-body"><div class="tk-title">' + esc(f.note) + '</div>' +
      '<div class="tk-meta">' + esc(f.date) + ' ' + tags + '</div></div>' +
      '<button class="btn small" data-edit="' + esc(f.id) + '">' + ICONS.edit + '</button>' +
      '<button class="btn small danger" data-del="' + esc(f.id) + '">' + ICONS.trash + '</button>' +
      '</div>';
  });
  html += '<div class="btn-row" style="margin-top:12px">' +
    '<button class="btn primary" id="city-add">＋ 新增一次到访</button></div>';
  showSheet(city + ' · 到访记录', html);
  var root = document.querySelector('#sheet-root .sheet-body');
  if (root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-edit]'), function (btn) {
      btn.onclick = function () { closeSheet(); openFootprintModal(btn.getAttribute('data-edit'), '', ''); };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (btn) {
      btn.onclick = function () { deleteFootprint(btn.getAttribute('data-del')); };
    });
  }
  var ca = $('city-add');
  if (ca) ca.onclick = function () { closeSheet(); openFootprintModal(null, prov || (recs[0] && recs[0].province) || '', city); };
}

/* ---------- 统计条 ---------- */
function renderStatsBar() {
  var g = globalStats();
  var sig = g.provCount + '/' + g.cityCount + '/' + g.dayCount;
  if (sigUnchanged('stats', sig)) return;
  var bar = $('stats-bar');
  if (!bar) return;
  bar.innerHTML =
    '<span class="seg"><span class="sync-dot ok"></span>已点亮 <span class="num">' + g.provCount + '</span> / 34 个省级行政区</span>' +
    '<span class="seg" style="margin:0 4px;opacity:.4">|</span><span class="seg">去过 <span class="num">' + g.cityCount + '</span> 座城市</span>' +
    '<span class="seg" style="margin:0 4px;opacity:.4">|</span><span class="seg">在路上 <span class="num">' + g.dayCount + '</span> 天</span>' +
    '<span class="go">查看足迹 ' + ICONS.go + '</span>';
  bar.onclick = function () {
    switchTab('foot');
    refreshAll();
  };
  /* 键盘可达：统计条是整块可点区域 */
  bar.setAttribute('tabindex', '0');
  bar.setAttribute('aria-label', '共点亮 ' + g.provCount + ' 个省级行政区、' + g.cityCount + ' 座城市，查看足迹库');
  bar.onkeydown = function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bar.click(); }
  };
}
