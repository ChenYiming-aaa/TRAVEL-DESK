/* ============================================================
 * 旅行工作台 · TRAVEL DESK
 * 分层：CONFIG 配置 / UTILS 工具 / STATIC 静态数据
 *       DATA 数据层 / SYNC 同步层 / MAP 地图层 / UI 界面层
 * 调用纪律（铁律）：渲染函数只读数据、互不调用；
 * 任何交互 → 改数据 → queueWrite → refreshAll() 统一调度
 * ============================================================ */
'use strict';

/* ---------------- CONFIG · 配置区（换表改这里） ---------------- */
var CONFIG = {
  LS_PREFIX: 'td_',     /* localStorage 键前缀，避免冲突 */
  SYNC_DEBOUNCE: 450,            /* 写操作防抖（ms） */
  REFRESH_DEBOUNCE: 600,         /* onUpdated 回拉防抖（ms） */
  CACHE_DEBOUNCE: 300,           /* 本地缓存写入防抖（ms） */
  EXP_PER_LEVEL: 100,
  MAX_LEVEL: 30,
  REMIND_AT: 30                  /* 数据量提醒阈值 */
};

/* ---------------- UTILS ---------------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}
function normDate(v) {
  if (!v) return '';
  var s = String(v);
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    /* 完整 ISO 串按 UTC 取日期：SDK 序列化为 T00:00:00Z，若为本地午夜折回的 UTC
       （UTC+8 下 T16:00:00Z）也不会因时区偏移差一天 */
    if (/T/.test(s)) {
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  return s.slice(0, 10);
}
function addDays(d, n) { var t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function stableHash(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
function parseJsonArr(v, fb) { try { var a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : (fb || []); } catch (e) { return fb || []; } }
/* 链接清洗：只允许 http/https，拦截 javascript: 等伪协议 */
function sanitizeUrl(u) {
  u = String(u || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}
/* 渲染签名守卫：内容未变则跳过重渲染（交互性能关键） */
var SIG = {};
function sigUnchanged(key, sig) { if (SIG[key] === sig) return true; SIG[key] = sig; return false; }
/* 选择器批量遍历（替代重复的 Array.prototype.forEach.call 样板） */
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
/* 足迹筛选重置（单一入口，避免各调用点漏字段） */
function resetFootFilter(province) {
  state.footFilter = { q: '', province: province || '', tag: '', year: '' };
}
/* 焦点/输入快照：全量重建 DOM 后恢复用户正在填写的内容 */
function snapshotFocus() {
  var el = document.activeElement;
  if (!el || !el.id || !el.tagName) return null;
  var tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
  var snap = { id: el.id, value: el.value };
  try { snap.start = el.selectionStart; snap.end = el.selectionEnd; } catch (e) { }
  return snap;
}
function restoreFocus(snap) {
  if (!snap) return;
  var el = $(snap.id);
  if (!el) return;
  try {
    el.value = snap.value;
    if (el.setSelectionRange && typeof snap.start === 'number') el.setSelectionRange(snap.start, snap.end);
  } catch (e) { }
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
}
/* 容器内全部输入值快照（含无 id 焦点场景，如点击按钮导致焦点转移） */
function snapshotInputs(root) {
  var snaps = {};
  if (!root || !root.querySelectorAll) return snaps;
  Array.prototype.forEach.call(root.querySelectorAll('input,textarea,select'), function (el) {
    if (el.id) snaps[el.id] = el.value;
  });
  return snaps;
}
function restoreInputs(root, snaps) {
  if (!root || !snaps) return;
  Object.keys(snaps).forEach(function (id) {
    var el = $(id);
    if (el && el !== document.activeElement) el.value = snaps[id];
  });
}

/* ---------------- ICONS · 内联 SVG 像素图标 ---------------- */
var ICONS = {
  map: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><path d="M2.5 5.2 7.5 3l5 2.2L18 3v12.8l-5.5 2.2-5-2.2L2 17.8V5.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.5 3v12.4M12.5 5.2v12.4" stroke="currentColor" stroke-width="1.2"/></svg>',
  foot: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><path d="M6.2 3.2c2 0 3.3 1.8 3.3 4 0 1.3-.5 2.2-1 3.1-.6 1-1 1.8-1 2.9 0 2 1.5 3.6 3.5 3.6s3.5-1.6 3.5-3.6c0-1.2-.6-2.3-1.2-3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><ellipse cx="5.4" cy="9.6" rx="2.1" ry="3.2" fill="currentColor"/><circle cx="13.2" cy="6.4" r="1" fill="currentColor"/></svg>',
  trip: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><rect x="3" y="6.5" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 6.5V4.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6v1.9" stroke="currentColor" stroke-width="1.5"/><path d="M3 10.5h14" stroke="currentColor" stroke-width="1.2"/></svg>',
  save: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="6.5" y="3" width="7" height="4.5" fill="currentColor"/><rect x="6.5" y="11" width="7" height="5.5" stroke="currentColor" stroke-width="1.2"/></svg>',
  cloudOk: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><path d="M5.5 15.5h9a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-1.3 3.2 3.2 0 0 0-1.3 7.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m8 11.6 1.8 1.8 3-3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  cloudSync: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><path d="M5.5 15.5h9a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-1.3 3.2 3.2 0 0 0-1.3 7.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 7.5v4M8 9.5l2-2 2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  cloudOff: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" shape-rendering="crispEdges"><path d="M5.5 15.5h9a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-1.3 3.2 3.2 0 0 0-1.3 7.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 4l12 12" stroke="#C0392B" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" shape-rendering="crispEdges"><path d="M7 1.5a3.8 3.8 0 0 0-3.8 3.8c0 2.8 3.8 7.2 3.8 7.2s3.8-4.4 3.8-7.2A3.8 3.8 0 0 0 7 1.5z" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="5.3" r="1.4" fill="currentColor"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" shape-rendering="crispEdges"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" shape-rendering="crispEdges"><path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" shape-rendering="crispEdges"><path d="M9.5 2.5l2 2L5 11H3v-2l6.5-6.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" shape-rendering="crispEdges"><path d="M2.5 4h9M5.5 4V2.5h3V4M4 4l.7 8h4.6L10 4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" shape-rendering="crispEdges"><path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  go: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" shape-rendering="crispEdges"><path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  link: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" shape-rendering="crispEdges"><path d="M5 3H3.5A1.5 1.5 0 0 0 2 4.5v4A1.5 1.5 0 0 0 3.5 10h4A1.5 1.5 0 0 0 9 8.5V7" stroke="currentColor" stroke-width="1.3"/><path d="M7 2h3v3M9.5 2.5 5 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
};

/* ---------------- STATIC · 静态数据 ---------------- */
var PROVINCES = ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '台湾省', '香港特别行政区', '澳门特别行政区'];
/* 省级行政区 → 省会/首府（想去图钉定位用；34 省全覆盖，坐标均在 CITY_COORDS） */
var PROV_CAPITAL = {
  '北京市': '北京市', '天津市': '天津市', '河北省': '石家庄市', '山西省': '太原市', '内蒙古自治区': '呼和浩特市',
  '辽宁省': '沈阳市', '吉林省': '长春市', '黑龙江省': '哈尔滨市', '上海市': '上海市', '江苏省': '南京市',
  '浙江省': '杭州市', '安徽省': '合肥市', '福建省': '福州市', '江西省': '南昌市', '山东省': '济南市',
  '河南省': '郑州市', '湖北省': '武汉市', '湖南省': '长沙市', '广东省': '广州市', '广西壮族自治区': '南宁市',
  '海南省': '海口市', '重庆市': '重庆市', '四川省': '成都市', '贵州省': '贵阳市', '云南省': '昆明市',
  '西藏自治区': '拉萨市', '陕西省': '西安市', '甘肃省': '兰州市', '青海省': '西宁市', '宁夏回族自治区': '银川市',
  '新疆维吾尔自治区': '乌鲁木齐市', '台湾省': '台北市', '香港特别行政区': '香港特别行政区', '澳门特别行政区': '澳门特别行政区'
};
/* 省市归属映射：省 → 城市/州/盟列表（地级行政区 + 常用旅行县级行政区） */
var PROVINCE_CITIES = {
  '北京市': ['北京市'],
  '天津市': ['天津市'],
  '河北省': ['石家庄市', '唐山市', '秦皇岛市', '邯郸市', '邢台市', '保定市', '张家口市', '承德市', '沧州市', '廊坊市', '衡水市'],
  '山西省': ['太原市', '大同市', '阳泉市', '长治市', '晋城市', '朔州市', '晋中市', '运城市', '忻州市', '临汾市', '吕梁市'],
  '内蒙古自治区': ['呼和浩特市', '包头市', '乌海市', '赤峰市', '通辽市', '鄂尔多斯市', '呼伦贝尔市', '巴彦淖尔市', '乌兰察布市', '兴安盟', '锡林郭勒盟', '阿拉善盟'],
  '辽宁省': ['沈阳市', '大连市', '鞍山市', '抚顺市', '本溪市', '丹东市', '锦州市', '营口市', '阜新市', '辽阳市', '盘锦市', '铁岭市', '朝阳市', '葫芦岛市'],
  '吉林省': ['长春市', '吉林市', '四平市', '辽源市', '通化市', '白山市', '松原市', '白城市', '延边朝鲜族自治州'],
  '黑龙江省': ['哈尔滨市', '齐齐哈尔市', '鸡西市', '鹤岗市', '双鸭山市', '大庆市', '伊春市', '佳木斯市', '七台河市', '牡丹江市', '黑河市', '绥化市', '大兴安岭地区'],
  '上海市': ['上海市'],
  '江苏省': ['南京市', '无锡市', '徐州市', '常州市', '苏州市', '南通市', '连云港市', '淮安市', '盐城市', '扬州市', '镇江市', '泰州市', '宿迁市'],
  '浙江省': ['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '衢州市', '舟山市', '台州市', '丽水市', '淳安县'],
  '安徽省': ['合肥市', '芜湖市', '蚌埠市', '淮南市', '马鞍山市', '淮北市', '铜陵市', '安庆市', '黄山市', '滁州市', '阜阳市', '宿州市', '六安市', '亳州市', '池州市', '宣城市'],
  '福建省': ['福州市', '厦门市', '莆田市', '三明市', '泉州市', '漳州市', '南平市', '龙岩市', '宁德市', '武夷山市'],
  '江西省': ['南昌市', '景德镇市', '萍乡市', '九江市', '新余市', '鹰潭市', '赣州市', '吉安市', '宜春市', '抚州市', '上饶市', '婺源县'],
  '山东省': ['济南市', '青岛市', '淄博市', '枣庄市', '东营市', '烟台市', '潍坊市', '济宁市', '泰安市', '威海市', '日照市', '临沂市', '德州市', '聊城市', '滨州市', '菏泽市'],
  '河南省': ['郑州市', '开封市', '洛阳市', '平顶山市', '安阳市', '鹤壁市', '新乡市', '焦作市', '濮阳市', '许昌市', '漯河市', '三门峡市', '南阳市', '商丘市', '信阳市', '周口市', '驻马店市'],
  '湖北省': ['武汉市', '黄石市', '十堰市', '宜昌市', '襄阳市', '鄂州市', '荆门市', '孝感市', '荆州市', '黄冈市', '咸宁市', '随州市', '恩施土家族苗族自治州'],
  '湖南省': ['长沙市', '株洲市', '湘潭市', '衡阳市', '邵阳市', '岳阳市', '常德市', '张家界市', '益阳市', '郴州市', '永州市', '怀化市', '娄底市', '湘西土家族苗族自治州'],
  '广东省': ['广州市', '韶关市', '深圳市', '珠海市', '汕头市', '佛山市', '江门市', '湛江市', '茂名市', '肇庆市', '惠州市', '梅州市', '汕尾市', '河源市', '阳江市', '清远市', '东莞市', '中山市', '潮州市', '揭阳市', '云浮市'],
  '广西壮族自治区': ['南宁市', '柳州市', '桂林市', '梧州市', '北海市', '防城港市', '钦州市', '贵港市', '玉林市', '百色市', '贺州市', '河池市', '来宾市', '崇左市', '阳朔县'],
  '海南省': ['海口市', '三亚市', '三沙市', '儋州市', '五指山市', '琼海市', '文昌市', '万宁市', '东方市'],
  '重庆市': ['重庆市'],
  '四川省': ['成都市', '自贡市', '攀枝花市', '泸州市', '德阳市', '绵阳市', '广元市', '遂宁市', '内江市', '乐山市', '南充市', '眉山市', '宜宾市', '广安市', '达州市', '雅安市', '巴中市', '资阳市', '阿坝藏族羌族自治州', '甘孜藏族自治州', '凉山彝族自治州', '都江堰市', '峨眉山市', '康定市', '九寨沟县', '小金县'],
  '贵州省': ['贵阳市', '六盘水市', '遵义市', '安顺市', '毕节市', '铜仁市', '黔西南布依族苗族自治州', '黔东南苗族侗族自治州', '黔南布依族苗族自治州'],
  '云南省': ['昆明市', '曲靖市', '玉溪市', '保山市', '昭通市', '丽江市', '普洱市', '临沧市', '楚雄彝族自治州', '红河哈尼族彝族自治州', '文山壮族苗族自治州', '西双版纳傣族自治州', '大理白族自治州', '德宏傣族景颇族自治州', '怒江傈僳族自治州', '迪庆藏族自治州', '大理市', '香格里拉市'],
  '西藏自治区': ['拉萨市', '日喀则市', '昌都市', '林芝市', '山南市', '那曲市', '阿里地区'],
  '陕西省': ['西安市', '铜川市', '宝鸡市', '咸阳市', '渭南市', '延安市', '汉中市', '榆林市', '安康市', '商洛市'],
  '甘肃省': ['兰州市', '嘉峪关市', '金昌市', '白银市', '天水市', '武威市', '张掖市', '平凉市', '酒泉市', '庆阳市', '定西市', '陇南市', '临夏回族自治州', '甘南藏族自治州', '敦煌市'],
  '青海省': ['西宁市', '海东市', '海北藏族自治州', '黄南藏族自治州', '海南藏族自治州', '果洛藏族自治州', '玉树藏族自治州', '海西蒙古族藏族自治州', '格尔木市'],
  '宁夏回族自治区': ['银川市', '石嘴山市', '吴忠市', '固原市', '中卫市'],
  '新疆维吾尔自治区': ['乌鲁木齐市', '克拉玛依市', '吐鲁番市', '哈密市', '昌吉回族自治州', '博尔塔拉蒙古自治州', '巴音郭楞蒙古自治州', '阿克苏地区', '克孜勒苏柯尔克孜自治州', '喀什地区', '和田地区', '伊犁哈萨克自治州', '塔城地区', '阿勒泰地区', '库尔勒市', '喀什市', '伊宁市', '阿勒泰市'],
  '台湾省': ['台北市', '新北市', '桃园市', '台中市', '台南市', '高雄市', '基隆市', '新竹市', '嘉义市', '花莲县', '台东县', '南投县', '彰化县', '云林县', '屏东县', '宜兰县'],
  '香港特别行政区': ['香港特别行政区'],
  '澳门特别行政区': ['澳门特别行政区']
};
/* 城市 → 省份 反查表（由 PROVINCE_CITIES 生成，用于校验与纠偏） */
var CITY_TO_PROVINCE = (function () {
  var m = {};
  Object.keys(PROVINCE_CITIES).forEach(function (p) {
    PROVINCE_CITIES[p].forEach(function (c) { m[c] = p; });
  });
  return m;
})();
/* 主要城市坐标 [lng, lat]，用于地图像素散点（近似展示坐标） */
var CITY_COORDS = {
  '北京市': [116.41, 39.90], '天津市': [117.20, 39.08], '石家庄市': [114.51, 38.04], '太原市': [112.55, 37.87],
  '呼和浩特市': [111.75, 40.84], '沈阳市': [123.43, 41.80], '大连市': [121.62, 38.92], '长春市': [125.32, 43.82],
  '哈尔滨市': [126.64, 45.76], '上海市': [121.47, 31.23], '南京市': [118.80, 32.06], '苏州市': [120.58, 31.30],
  '无锡市': [120.30, 31.57], '扬州市': [119.41, 32.39], '杭州市': [120.16, 30.27], '宁波市': [121.55, 29.87],
  '温州市': [120.70, 28.00], '绍兴市': [120.58, 30.03], '嘉兴市': [120.76, 30.77], '舟山市': [122.21, 29.99],
  '合肥市': [117.23, 31.82], '福州市': [119.30, 26.08], '厦门市': [118.09, 24.48], '泉州市': [118.59, 24.87],
  '南昌市': [115.86, 28.68], '济南市': [117.12, 36.65], '青岛市': [120.38, 36.07], '烟台市': [121.45, 37.46],
  '威海市': [122.12, 37.51], '郑州市': [113.62, 34.75], '洛阳市': [112.45, 34.62], '开封市': [114.31, 34.80],
  '武汉市': [114.31, 30.60], '宜昌市': [111.29, 30.69], '长沙市': [112.94, 28.23], '张家界市': [110.48, 29.13],
  '广州市': [113.26, 23.13], '深圳市': [114.06, 22.55], '珠海市': [113.55, 22.27], '汕头市': [116.68, 23.35],
  '湛江市': [110.36, 21.27], '南宁市': [108.37, 22.82], '柳州市': [109.42, 24.33], '桂林市': [110.29, 25.27],
  '阳朔县': [110.49, 24.78], '北海市': [109.12, 21.47], '海口市': [110.20, 20.04], '三亚市': [109.51, 18.25],
  '重庆市': [106.55, 29.56], '成都市': [104.07, 30.57], '都江堰市': [103.63, 30.99], '乐山市': [103.76, 29.58],
  '峨眉山市': [103.48, 29.60], '九寨沟县': [104.24, 33.26], '康定市': [101.96, 30.05], '小金县': [102.36, 31.00],
  '贵阳市': [106.63, 26.65], '遵义市': [106.93, 27.73], '昆明市': [102.83, 24.88], '大理市': [100.23, 25.60],
  '丽江市': [100.23, 26.86], '香格里拉市': [99.71, 27.83], '西双版纳傣族自治州': [100.80, 22.01], '拉萨市': [91.11, 29.65],
  '日喀则市': [88.88, 29.27], '林芝市': [94.36, 29.65], '西安市': [108.94, 34.34], '渭南市': [109.50, 34.50],
  '宝鸡市': [107.14, 34.36], '汉中市': [107.03, 33.07], '延安市': [109.49, 36.60], '兰州市': [103.83, 36.06],
  '敦煌市': [94.66, 40.14], '张掖市': [100.45, 38.93], '嘉峪关市': [98.29, 39.80], '天水市': [105.72, 34.58],
  '西宁市': [101.78, 36.62], '格尔木市': [94.90, 36.40], '银川市': [106.23, 38.49], '中卫市': [105.19, 37.51],
  '乌鲁木齐市': [87.62, 43.83], '喀什市': [75.99, 39.47], '伊宁市': [81.32, 43.92], '吐鲁番市': [89.19, 42.95],
  '库尔勒市': [86.15, 41.73], '阿勒泰市': [88.14, 47.85], '香港特别行政区': [114.17, 22.32],
  '澳门特别行政区': [113.55, 22.20], '台北市': [121.52, 25.03], '台中市': [120.68, 24.15],
  '台南市': [120.20, 23.00], '高雄市': [120.31, 22.62], '黄山市': [118.34, 29.71], '婺源县': [117.86, 29.25],
  '武夷山市': [118.05, 27.75], '承德市': [117.96, 40.99], '秦皇岛市': [119.60, 39.93], '晋中市': [112.75, 37.69],
  '淳安县': [119.04, 29.61], '济宁市': [116.59, 35.41],
  /* ---- 以下为全量地级行政区坐标补充（城市政府驻地近似坐标） ---- */
  /* 河北 */
  '唐山市': [118.18, 39.63], '邯郸市': [114.49, 36.61], '邢台市': [114.51, 37.07], '保定市': [115.46, 38.87],
  '张家口市': [114.89, 40.83], '沧州市': [116.84, 38.30], '廊坊市': [116.70, 39.52], '衡水市': [115.67, 37.74],
  /* 山西 */
  '大同市': [113.30, 40.08], '阳泉市': [113.58, 37.86], '长治市': [113.12, 36.19], '晋城市': [112.85, 35.49],
  '朔州市': [112.43, 39.33], '运城市': [111.00, 35.03], '忻州市': [112.73, 38.42], '临汾市': [111.52, 36.08],
  '吕梁市': [111.14, 37.52],
  /* 内蒙古 */
  '包头市': [109.84, 40.66], '乌海市': [106.80, 39.67], '赤峰市': [118.89, 42.26], '通辽市': [122.26, 43.62],
  '鄂尔多斯市': [109.99, 39.82], '呼伦贝尔市': [119.77, 49.21], '巴彦淖尔市': [107.39, 40.74], '乌兰察布市': [113.11, 40.99],
  '兴安盟': [122.04, 46.08], '锡林郭勒盟': [116.05, 43.93], '阿拉善盟': [105.73, 38.85],
  /* 辽宁 */
  '鞍山市': [122.99, 41.11], '抚顺市': [123.96, 41.88], '本溪市': [123.77, 41.30], '丹东市': [124.38, 40.13],
  '锦州市': [121.13, 41.10], '营口市': [122.24, 40.67], '阜新市': [121.67, 42.02], '辽阳市': [123.24, 41.27],
  '盘锦市': [122.07, 41.12], '铁岭市': [123.84, 42.29], '朝阳市': [120.45, 41.57], '葫芦岛市': [120.84, 40.71],
  /* 吉林 */
  '吉林市': [126.55, 43.84], '四平市': [124.35, 43.17], '辽源市': [125.14, 42.89], '通化市': [125.94, 41.73],
  '白山市': [126.42, 41.94], '松原市': [124.83, 45.14], '白城市': [122.84, 45.62], '延边朝鲜族自治州': [129.51, 42.91],
  /* 黑龙江 */
  '齐齐哈尔市': [123.92, 47.35], '鸡西市': [130.97, 45.30], '鹤岗市': [130.30, 47.35], '双鸭山市': [131.16, 46.65],
  '大庆市': [125.10, 46.59], '伊春市': [128.90, 47.73], '佳木斯市': [130.32, 46.80], '七台河市': [131.00, 45.77],
  '牡丹江市': [129.63, 44.58], '黑河市': [127.53, 50.24], '绥化市': [126.97, 46.65], '大兴安岭地区': [124.12, 50.42],
  /* 江苏 */
  '徐州市': [117.28, 34.21], '常州市': [119.95, 31.79], '南通市': [120.86, 32.01], '连云港市': [119.16, 34.30],
  '淮安市': [119.02, 33.61], '盐城市': [120.16, 33.35], '镇江市': [119.45, 32.20], '泰州市': [119.92, 32.46],
  '宿迁市': [118.28, 33.96],
  /* 浙江 */
  '湖州市': [120.09, 30.89], '金华市': [119.65, 29.08], '衢州市': [118.87, 28.94], '台州市': [121.43, 28.66],
  '丽水市': [119.92, 28.45],
  /* 安徽 */
  '芜湖市': [118.38, 31.33], '蚌埠市': [117.39, 32.92], '淮南市': [117.02, 32.63], '马鞍山市': [118.51, 31.67],
  '淮北市': [116.79, 33.96], '铜陵市': [117.82, 30.95], '安庆市': [117.06, 30.54], '滁州市': [118.32, 32.30],
  '阜阳市': [115.81, 32.89], '宿州市': [116.98, 33.63], '六安市': [116.51, 31.75], '亳州市': [115.78, 33.85],
  '池州市': [117.49, 30.66], '宣城市': [118.76, 30.95],
  /* 福建 */
  '莆田市': [119.01, 25.45], '三明市': [117.64, 26.27], '漳州市': [117.65, 24.51], '南平市': [118.18, 26.64],
  '龙岩市': [117.02, 25.08], '宁德市': [119.53, 26.66],
  /* 江西 */
  '景德镇市': [117.18, 29.27], '萍乡市': [113.85, 27.62], '九江市': [115.99, 29.71], '新余市': [114.92, 27.82],
  '鹰潭市': [117.07, 28.24], '赣州市': [114.94, 25.83], '吉安市': [114.99, 27.11], '宜春市': [114.39, 27.81],
  '抚州市': [116.36, 27.95], '上饶市': [117.94, 28.46],
  /* 山东 */
  '淄博市': [118.05, 36.81], '枣庄市': [117.32, 34.81], '东营市': [118.67, 37.43], '潍坊市': [119.16, 36.71],
  '泰安市': [117.09, 36.20], '日照市': [119.53, 35.42], '临沂市': [118.35, 35.10], '德州市': [116.36, 37.44],
  '聊城市': [115.98, 36.46], '滨州市': [117.97, 37.38], '菏泽市': [115.48, 35.24],
  /* 河南 */
  '平顶山市': [113.19, 33.77], '安阳市': [114.39, 36.10], '鹤壁市': [114.30, 35.75], '新乡市': [113.93, 35.30],
  '焦作市': [113.24, 35.22], '濮阳市': [115.03, 35.76], '许昌市': [113.85, 34.04], '漯河市': [114.03, 33.58],
  '三门峡市': [111.20, 34.77], '南阳市': [112.53, 32.99], '商丘市': [115.65, 34.44], '信阳市': [114.09, 32.15],
  '周口市': [114.70, 33.63], '驻马店市': [114.02, 33.01],
  /* 湖北 */
  '黄石市': [115.04, 30.20], '十堰市': [110.80, 32.65], '襄阳市': [112.14, 32.04], '鄂州市': [114.89, 30.40],
  '荆门市': [112.20, 31.04], '孝感市': [113.92, 30.93], '荆州市': [112.24, 30.34], '黄冈市': [114.87, 30.45],
  '咸宁市': [114.32, 29.84], '随州市': [113.38, 31.72], '恩施土家族苗族自治州': [109.49, 30.27],
  /* 湖南 */
  '株洲市': [113.13, 27.83], '湘潭市': [112.94, 27.83], '衡阳市': [112.57, 26.89], '邵阳市': [111.47, 27.24],
  '岳阳市': [113.13, 29.36], '常德市': [111.69, 29.05], '益阳市': [112.36, 28.55], '郴州市': [113.01, 25.79],
  '永州市': [111.61, 26.42], '怀化市': [109.98, 27.55], '娄底市': [111.99, 27.73], '湘西土家族苗族自治州': [109.74, 28.31],
  /* 广东 */
  '韶关市': [113.60, 24.81], '佛山市': [113.12, 23.02], '江门市': [113.09, 22.59], '茂名市': [110.93, 21.66],
  '肇庆市': [112.47, 23.05], '惠州市': [114.42, 23.11], '梅州市': [116.12, 24.30], '汕尾市': [115.38, 22.79],
  '河源市': [114.70, 23.74], '阳江市': [111.98, 21.86], '清远市': [113.05, 23.68], '东莞市': [113.75, 23.05],
  '中山市': [113.39, 22.52], '潮州市': [116.63, 23.66], '揭阳市': [116.37, 23.55], '云浮市': [112.04, 22.93],
  /* 广西 */
  '梧州市': [111.28, 23.48], '防城港市': [108.35, 21.69], '钦州市': [108.62, 21.98], '贵港市': [109.60, 23.11],
  '玉林市': [110.15, 22.63], '百色市': [106.62, 23.90], '贺州市': [111.55, 24.41], '河池市': [108.06, 24.69],
  '来宾市': [109.23, 23.73], '崇左市': [107.37, 22.40],
  /* 海南 */
  '三沙市': [112.03, 16.83], '儋州市': [109.58, 19.52], '五指山市': [109.52, 18.78], '琼海市': [110.47, 19.25],
  '文昌市': [110.75, 19.61], '万宁市': [110.39, 18.80], '东方市': [108.65, 19.10],
  /* 四川 */
  '自贡市': [104.78, 29.34], '攀枝花市': [101.72, 26.58], '泸州市': [105.44, 28.87], '德阳市': [104.40, 31.13],
  '绵阳市': [104.68, 31.47], '广元市': [105.84, 32.44], '遂宁市': [105.57, 30.51], '内江市': [105.06, 29.58],
  '南充市': [106.11, 30.84], '眉山市': [103.85, 30.08], '宜宾市': [104.62, 28.77], '广安市': [106.63, 30.47],
  '达州市': [107.50, 31.21], '雅安市': [103.00, 29.98], '巴中市': [106.75, 31.87], '资阳市': [104.63, 30.13],
  '阿坝藏族羌族自治州': [102.22, 31.90], '甘孜藏族自治州': [101.96, 30.05], '凉山彝族自治州': [102.26, 27.88],
  /* 贵州 */
  '六盘水市': [104.83, 26.59], '安顺市': [105.95, 26.25], '毕节市': [105.29, 27.29], '铜仁市': [109.19, 27.72],
  '黔西南布依族苗族自治州': [104.90, 25.09], '黔东南苗族侗族自治州': [107.98, 26.58], '黔南布依族苗族自治州': [107.52, 26.26],
  /* 云南 */
  '曲靖市': [103.80, 25.49], '玉溪市': [102.55, 24.35], '保山市': [99.16, 25.11], '昭通市': [103.72, 27.34],
  '普洱市': [100.97, 22.78], '临沧市': [100.08, 23.88], '楚雄彝族自治州': [101.55, 25.03],
  '红河哈尼族彝族自治州': [103.38, 23.37], '文山壮族苗族自治州': [104.24, 23.37], '大理白族自治州': [100.23, 25.60],
  '德宏傣族景颇族自治州': [98.58, 24.43], '怒江傈僳族自治州': [98.85, 25.85], '迪庆藏族自治州': [99.71, 27.83],
  /* 西藏 */
  '昌都市': [97.18, 31.14], '山南市': [91.77, 29.24], '那曲市': [92.06, 31.48], '阿里地区': [80.11, 32.50],
  /* 陕西 */
  '铜川市': [108.95, 34.90], '咸阳市': [108.71, 34.33], '榆林市': [109.74, 38.29], '安康市': [109.03, 32.69],
  '商洛市': [109.94, 33.87],
  /* 甘肃 */
  '金昌市': [102.19, 38.52], '白银市': [104.14, 36.55], '武威市': [102.63, 37.93], '平凉市': [106.68, 35.54],
  '酒泉市': [98.51, 39.74], '庆阳市': [107.64, 35.71], '定西市': [104.59, 35.58], '陇南市': [104.92, 33.40],
  '临夏回族自治州': [103.21, 35.60], '甘南藏族自治州': [102.91, 34.98],
  /* 青海 */
  '海东市': [102.11, 36.50], '海北藏族自治州': [100.90, 36.96], '黄南藏族自治州': [102.02, 35.52],
  '海南藏族自治州': [100.62, 36.28], '果洛藏族自治州': [100.24, 34.48], '玉树藏族自治州': [97.01, 33.00],
  '海西蒙古族藏族自治州': [97.37, 37.38],
  /* 宁夏 */
  '石嘴山市': [106.38, 39.02], '吴忠市': [106.20, 37.99], '固原市': [106.28, 36.02],
  /* 新疆 */
  '克拉玛依市': [84.87, 45.60], '哈密市': [93.51, 42.83], '昌吉回族自治州': [87.30, 44.01],
  '博尔塔拉蒙古自治州': [82.07, 44.90], '巴音郭楞蒙古自治州': [86.15, 41.73], '阿克苏地区': [80.27, 41.17],
  '克孜勒苏柯尔克孜自治州': [76.17, 39.71], '喀什地区': [75.99, 39.47], '和田地区': [79.92, 37.11],
  '伊犁哈萨克自治州': [81.32, 43.92], '塔城地区': [82.98, 46.75], '阿勒泰地区': [88.14, 47.85],
  /* 台湾 */
  '新北市': [121.47, 25.01], '桃园市': [121.30, 24.99], '基隆市': [121.74, 25.13], '新竹市': [120.97, 24.80],
  '嘉义市': [120.45, 23.48], '花莲县': [121.60, 23.98], '台东县': [121.15, 22.76], '南投县': [120.69, 23.91],
  '彰化县': [120.54, 24.08], '云林县': [120.43, 23.71], '屏东县': [120.49, 22.68], '宜兰县': [121.75, 24.76]
};
/* 携程火车票城市拼音（用于生成 trainbooking 深链；未覆盖则给搜索首页） */
var PINYIN = {
  '北京': 'beijing', '上海': 'shanghai', '广州': 'guangzhou', '深圳': 'shenzhen', '杭州': 'hangzhou', '南京': 'nanjing',
  '苏州': 'suzhou', '天津': 'tianjin', '成都': 'chengdu', '重庆': 'chongqing', '武汉': 'wuhan', '西安': 'xian',
  '郑州': 'zhengzhou', '长沙': 'changsha', '合肥': 'hefei', '南昌': 'nanchang', '福州': 'fuzhou', '厦门': 'xiamen',
  '济南': 'jinan', '青岛': 'qingdao', '沈阳': 'shenyang', '大连': 'dalian', '哈尔滨': 'haerbin', '长春': 'changchun',
  '昆明': 'kunming', '贵阳': 'guiyang', '南宁': 'nanning', '桂林': 'guilin', '海口': 'haikou', '三亚': 'sanya',
  '兰州': 'lanzhou', '敦煌': 'dunhuang', '西宁': 'xining', '银川': 'yinchuan', '乌鲁木齐': 'wulumuqi', '喀什': 'kashi',
  '拉萨': 'lasa', '太原': 'taiyuan', '石家庄': 'shijiazhuang', '呼和浩特': 'huhehaote', '宁波': 'ningbo', '温州': 'wenzhou',
  '无锡': 'wuxi', '扬州': 'yangzhou', '黄山': 'huangshan', '婺源': 'wuyuan', '张家界': 'zhangjiajie', '丽江': 'lijiang',
  '大理': 'dali', '香格里拉': 'xianggelila', '西双版纳': 'xishuangbanna', '洛阳': 'luoyang', '开封': 'kaifeng',
  '宜昌': 'yichang', '珠海': 'zhuhai', '汕头': 'shantou', '湛江': 'zhanjiang', '北海': 'beihai', '柳州': 'liuzhou',
  '阳朔': 'yangshuo', '泉州': 'quanzhou', '武夷山': 'wuyishan', '泰安': 'taian', '威海': 'weihai', '烟台': 'yantai',
  '承德': 'chengde', '秦皇岛': 'qinhuangdao', '张掖': 'zhangye', '嘉峪关': 'jiayuguan', '天水': 'tianshui',
  '延安': 'yanan', '宝鸡': 'baoji', '汉中': 'hanzhong', '都江堰': 'dujiangyan', '乐山': 'leshan', '峨眉山': 'emeishan',
  '康定': 'kangding', '九寨沟': 'jiuzhaigou', '台北': 'taipei', '香港': 'hongkong', '澳门': 'macau', '镇江关': 'zhenjiangguan'
};
/* 未去省份的邀请文案 */
var INVITES = {
  '贵州省': '下一站，去这里吃一碗粉？', '四川省': '火锅在沸腾，熊猫在打滚。', '新疆维吾尔自治区': '羊肉串的烟火气，等你入画。',
  '黑龙江省': '冰雪大世界，零下二十度的热情。', '甘肃省': '一碗牛肉面，一条河西走廊。', '云南省': '风花雪月，四季如春。',
  '西藏自治区': '雪山与经筒，在海拔之上。', '台湾省': '夜市与海风，宝岛在招手。', '内蒙古自治区': '草原的风，一直吹到天边。',
  '海南省': '椰林树影，水清沙白。', '陕西省': '十三朝古都，等你拆封。', '湖南省': '岳麓山的枫叶，橘子洲的烟花。',
  '福建省': '海丝起点，茶香四溢。', '广西壮族自治区': '桂林山水，螺蛳粉香。', '青海省': '青海湖的蓝，天空之镜。'
};
var INVITE_GENERIC = ['下一站，把脚印盖在这里？', '世界很大，先去这里看看。', '空白地图，等着被点亮。', '收拾行李，就是现在。', '这里的故事，缺一个你。'];
/* 每日答案之书 */
var QUOTES = [
  '出发就是答案。', '地图上未点亮的地方，都是下次见面的理由。', '所谓远方，不过是把日常换成陌生。',
  '慢慢走，欣赏啊。', '身体能到达的地方，就别让眼睛缺席。', '最好的相机，是不舍得移开的眼睛。',
  '旅行为我们存档，一段无法复制的时间。', '去陌生的城市，认一个回家的路口。',
  '风来自很远的地方，去看看也无妨。', '把日子过成路线图，每一站都算数。', '世界这本书，你又多读了一页。',
  '不是在旅行，就是在计划旅行。', '远方有回声，那是你想去的地方。', '带一本书去旅行，或者写一本回来。'
];

/* ---------------- 示例数据（本地模式首开播种） ---------------- */
function buildSample() {
  var plan1 = [
    { date: '2026-10-01', items: [
      { time: '08:30', place: '上海虹桥站', action: '乘高铁前往杭州东', duration: '约1小时', note: '班次与余票以 12306 为准，提前 30 分钟到站', type: 'transit' },
      { time: '10:30', place: '湖滨·龙翔桥', action: '入住酒店 + 西湖边散步', duration: '2小时', note: '地铁 1 号线龙翔桥站', type: 'stay' },
      { time: '13:00', place: '知味观·湖滨总店', action: '杭帮菜午饭', duration: '1小时', note: '猫耳朵、龙井虾仁', type: 'food' },
      { time: '15:00', place: '西湖风景区·北山街', action: '断桥—白堤—平湖秋月漫步', duration: '3小时', note: '带把伞，十月午后仍热', type: 'sight' },
      { time: '19:00', place: '湖滨银泰in77', action: '晚饭 + 西湖音乐喷泉', duration: '2小时', note: '喷泉 19:30 / 20:30 各一场', type: 'food' }] },
    { date: '2026-10-02', items: [
      { time: '08:00', place: '酒店', action: '早餐后前往灵隐', duration: '1小时', note: '', type: 'food' },
      { time: '09:30', place: '灵隐寺·飞来峰', action: '拜寺 + 登山', duration: '3小时', note: '需先购飞来峰门票', type: 'sight' },
      { time: '13:30', place: '天竺路', action: '素面午饭 + 茶村散步', duration: '2小时', note: '', type: 'food' },
      { time: '16:00', place: '河坊街', action: '逛老街买伴手礼', duration: '2小时', note: '', type: 'sight' },
      { time: '19:00', place: '南山路', action: '晚饭 + 夜逛西湖', duration: '2小时', note: '', type: 'food' }] },
    { date: '2026-10-03', items: [
      { time: '09:00', place: '西溪湿地', action: '摇橹船半日游', duration: '3小时', note: '地铁 5 号线到蒋村', type: 'sight' },
      { time: '13:00', place: '西溪·印象城', action: '午饭', duration: '1小时', note: '', type: 'food' },
      { time: '15:30', place: '杭州东站', action: '高铁返沪', duration: '约1小时', note: '留足候车时间', type: 'transit' }] }];
  var plan2 = [
    { date: '2026-11-14', items: [
      { time: '07:30', place: '成都东站', action: '乘动车至镇江关站，转景区交通车进四姑娘山镇', duration: '约3小时', note: '关注天气，备用大巴方案', type: 'transit' },
      { time: '12:00', place: '四姑娘山镇', action: '午饭 + 适应海拔', duration: '2小时', note: '镇上海拔约 3200 米', type: 'food' },
      { time: '15:00', place: '双桥沟', action: '下午场游览', duration: '3小时', note: '观光车全程', type: 'sight' }] },
    { date: '2026-11-15', items: [
      { time: '08:00', place: '长坪沟', action: '徒步一日游', duration: '6小时', note: '带路餐和保暖外套', type: 'sight' }] },
    { date: '2026-11-16', items: [
      { time: '08:30', place: '四姑娘山—丹巴', action: '包车前往丹巴藏寨', duration: '4小时', note: '提前联系司机', type: 'transit' },
      { time: '13:00', place: '甲居藏寨', action: '游览 + 住寨子', duration: '半天', note: '', type: 'sight' }] },
    { date: '2026-11-17', items: [
      { time: '09:00', place: '丹巴—成都', action: '返程', duration: '5小时', note: '', type: 'transit' }] }];
  return {
    profile: { id: 'main', nick: '小旅行家', origin: '上海市', styles: ['城市漫步', '美食', '自然风光'], want: ['新疆维吾尔自治区', '黑龙江省', '贵州省', '甘肃省'], exp: 285, days: 6, provCount: 6, level: 3, snapshots: [] },
    footprints: [
      { id: 'fp_001', province: '浙江省', city: '杭州市', date: '2026-10-02', note: '西湖的日落把整座城市泡进了橘子汽水', tags: ['国庆', '带朋友'], tripId: 'trip_001' },
      { id: 'fp_002', province: '江苏省', city: '苏州市', date: '2026-09-19', note: '平江路的雨，评弹声混着桂花香', tags: ['雨天', '独自'], tripId: '' },
      { id: 'fp_003', province: '四川省', city: '成都市', date: '2026-08-08', note: '人民公园鹤鸣茶社，一碗茶坐了一下午', tags: ['美食'], tripId: '' },
      { id: 'fp_004', province: '北京市', city: '北京市', date: '2026-07-15', note: '故宫闭馆前一小时，光影在太和殿慢慢挪步', tags: ['人文', '夏天'], tripId: '' },
      { id: 'fp_005', province: '云南省', city: '丽江市', date: '2026-05-03', note: '玉龙雪山下的油菜花田，蓝得不真实', tags: ['自然风光', '高原'], tripId: '' },
      { id: 'fp_006', province: '福建省', city: '厦门市', date: '2026-04-11', note: '鼓浪屿的钢琴声从老别墅里飘出来', tags: ['海岛', '第一次'], tripId: '' }],
    trips: [
      { id: 'trip_001', title: '杭州 3 日 · 西湖漫步', start: '2026-10-01', end: '2026-10-03', provinces: ['浙江省'], budget: 1800, status: '已完成', days: plan1 },
      { id: 'trip_002', title: '川西小环线 4 日', start: '2026-11-14', end: '2026-11-17', provinces: ['四川省'], budget: 3200, status: '草稿', days: plan2 }],
    tasks: [
      { id: 'task_001', tripId: 'trip_002', type: '预订', title: '预订 11/14 成都东—镇江关 动车票', deadline: '2026-10-20', done: false, link: 'https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=%E6%88%90%E9%83%BD%E4%B8%9C&ts=%E9%95%87%E6%B1%9F%E5%85%B3&date=2026-11-14&flag=N,N,Y' },
      { id: 'task_002', tripId: 'trip_002', type: '准备', title: '下载四姑娘山离线地图 + 抗高反攻略', deadline: '2026-11-05', done: false, link: '' },
      { id: 'task_003', tripId: 'trip_002', type: '现场', title: '双桥沟门票预约（现场也可买）', deadline: '2026-11-10', done: false, link: '' },
      { id: 'task_004', tripId: 'trip_001', type: '准备', title: '整理杭州照片写进旅行手账', deadline: '2026-10-08', done: true, link: '' }],
    achievements: [
      { id: 'ach_001', name: '启程者', icon: '🚶', date: '2026-04-11', desc: '完成第一次旅行打卡' },
      { id: 'ach_002', name: '九州行者', icon: '🧭', date: '2026-05-03', desc: '足迹点亮 3 个省级行政区' },
      { id: 'ach_003', name: '江南常客', icon: '⛩️', date: '2026-09-19', desc: '江苏与浙江都留下足迹' },
      { id: 'ach_004', name: '美食捕手', icon: '🍜', date: '2026-08-08', desc: '3 条美食记忆入库' }]
  };
}

/* ---------------- DATA · 状态 ---------------- */
var state = {
  profile: null, footprints: [], trips: [], tasks: [], achievements: [],
  selProvince: '',
  footFilter: { q: '', province: '', tag: '', year: '' },
  footBatch: { on: false, picked: {} },
  todayOpen: false,
  tripDetailId: '', tripDayShown: 7,
  bookIdx: -1,
  loaded: false
};

function defaultProfile() {
  return { id: 'main', nick: '旅行者', origin: '', styles: [], want: [], exp: 0, days: 0, provCount: 0, level: 1, snapshots: [] };
}

/* ---------------- 本地缓存（防抖写入 + 配额告警） ---------------- */
function lsKey(k) { return CONFIG.LS_PREFIX + k; }
var cacheDegraded = false;
var _quotaWarned = false;
function cacheSaveNow() {
  try {
    localStorage.setItem(lsKey('cache'), JSON.stringify({
      profile: state.profile, footprints: state.footprints,
      trips: state.trips, tasks: state.tasks, achievements: state.achievements
    }));
    cacheDegraded = false;
    _quotaWarned = false;
  } catch (e) {
    cacheDegraded = true;
    /* 配额失败只提示一次，避免连续操作下 toast 风暴 */
    if (e && e.name === 'QuotaExceededError' && !_quotaWarned) {
      _quotaWarned = true;
      if (typeof toast === 'function') toast('本地缓存写入失败（存储空间不足），请导出备份', 'warn');
    }
  }
}
var cacheSave = debounce(cacheSaveNow, CONFIG.CACHE_DEBOUNCE);
function cacheLoad() {
  try {
    var c = JSON.parse(localStorage.getItem(lsKey('cache')) || 'null');
    if (c && c.profile) return c;
  } catch (e) { }
  return null;
}
function applyCachePart(key, c) {
  if (!c) return;
  if (key === 'profile') { state.profile = c.profile; return; }
  if (Array.isArray(c[key])) state[key] = c[key];
}
function applySample(s) {
  state.profile = s.profile;
  state.footprints = s.footprints;
  state.trips = s.trips;
  state.tasks = s.tasks;
  state.achievements = s.achievements;
}

/* ---------------- 加载：缓存先行 → 在线并行拉取 ---------------- */
var TABLE_KEYS = ['profile', 'footprints', 'trips', 'tasks', 'achievements'];

function loadDataSync() {
  /* 应用本地缓存或播种示例，保证首屏秒开 */
  var cached = cacheLoad();
  if (cached) {
    TABLE_KEYS.forEach(function (k) { applyCachePart(k, cached); });
    /* 归一化：旧缓存可能缺字段（styles/want 等），补齐默认值防渲染 TypeError */
    if (state.profile) state.profile = Object.assign(defaultProfile(), state.profile);
  } else {
    applySample(buildSample());
    cacheSaveNow();
  }
  state.loaded = true;
}

/* 脏数据清洗：城市归属与省份不一致时，按 CITY_TO_PROVINCE 纠正并回写 */
function repairProvinceCity() {
  var fixed = 0;
  state.footprints.forEach(function (f) {
    var p = CITY_TO_PROVINCE[f.city];
    if (p && p !== f.province) {
      f.province = p;
      fixed++;
      queueWrite({ table: 'footprints', action: 'upsert', id: f.id });
    }
  });
  if (fixed && typeof toast === 'function') toast('已自动纠正 ' + fixed + ' 条省市不一致的足迹', 'warn');
}

/* ---------------- 写队列（本地持久化） ---------------- */
/* 所有写操作经 queueWrite：按 (table,id[,action]) 去重入队 → 持久化 → 防抖缓存。
   本地版无云端：队列是本次编辑的脏操作日志，刷新/重开不丢（localStorage）。 */
var Sync = {
  queue: [],
  status: 'idle',
  persistFailed: false
};

function saveSyncState() {
  try {
    localStorage.setItem(lsKey('queue'), JSON.stringify({ q: Sync.queue }));
    Sync.persistFailed = false;
  } catch (e) {
    /* 队列持久化失败：刷新后会丢未保存改动，必须显式告知用户 */
    Sync.persistFailed = true;
    console.warn('[persist] 写队列持久化失败（存储空间不足？）:', e);
  }
}
function restoreQueue() {
  try {
    var d = JSON.parse(localStorage.getItem(lsKey('queue')) || 'null');
    if (d && Array.isArray(d.q)) Sync.queue = d.q;
  } catch (e) { }
}

function queueWrite(op) {
  /* op: {table, action:'upsert'|'remove', id, recId?} */
  var i = Sync.queue.findIndex(function (o) {
    return o.table === op.table && o.id === op.id && o.action === op.action &&
      (op.action !== 'remove' || o.recId === op.recId);
  });
  if (i >= 0) Sync.queue.splice(i, 1, op); else Sync.queue.push(op);
  if (op.action === 'remove') {
    /* 墓碑：同 id 二次 remove（无 recId）时保留有效值，导入合并时可跳过 */
    Sync.graveyard = Sync.graveyard || {};
    Sync.graveyard[op.table + '|' + op.id] = op.recId || Sync.graveyard[op.table + '|' + op.id] || null;
  }
  saveSyncState();
  cacheSave();
  Sync.status = 'saved';
  renderSyncStatus();
}

/* ---------------- 派生计算（数据层） ---------------- */
function levelFromExp(exp) { return Math.max(1, Math.min(CONFIG.MAX_LEVEL, Math.floor((exp || 0) / CONFIG.EXP_PER_LEVEL) + 1)); }

function recomputeDerived() {
  if (!state.profile) return;
  var provSet = {}, citySet = {}, daySet = {};
  state.footprints.forEach(function (f) {
    if (f.province) provSet[f.province] = 1;
    if (f.city) citySet[f.city] = 1;
    if (f.date) daySet[f.date] = 1;
  });
  var provCount = Object.keys(provSet).length;
  var days = Object.keys(daySet).length;
  var lv = levelFromExp(state.profile.exp);
  var changed = provCount !== state.profile.provCount || days !== state.profile.days || lv !== state.profile.level;
  state.profile.provCount = provCount;
  state.profile.days = days;
  state.profile.level = lv;
  if (changed && !state.profile.isNew) queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
  checkAchievements();
  maybeRemindBackup();
}

var ACH_RULES = [
  { id: 'ach_001', name: '启程者', icon: '🚶', desc: '完成第一次旅行打卡', test: function () { return state.footprints.length >= 1; } },
  { id: 'ach_3prov', name: '九州行者', icon: '🧭', desc: '足迹点亮 3 个省级行政区', test: function () { return provCountNow() >= 3; } },
  { id: 'ach_10prov', name: '大好河山', icon: '🏔️', desc: '足迹点亮 10 个省级行政区', test: function () { return provCountNow() >= 10; } },
  { id: 'ach_jiangnan', name: '江南常客', icon: '⛩️', desc: '江苏与浙江都留下足迹', test: function () { return hasProv('江苏省') && hasProv('浙江省'); } },
  { id: 'ach_food', name: '美食捕手', icon: '🍜', desc: '3 条美食记忆入库', test: function () { return state.footprints.filter(function (f) { return (f.tags || []).indexOf('美食') >= 0; }).length >= 3; } },
  { id: 'ach_task5', name: '任务达人', icon: '✅', desc: '完成 5 个行前任务', test: function () { return state.tasks.filter(function (t) { return t.done; }).length >= 5; } },
  { id: 'ach_trip', name: '行程规划师', icon: '🗺️', desc: '创建第一个行程', test: function () { return state.trips.length >= 1; } },
  { id: 'ach_want', name: '心之所向', icon: '📌', desc: '标记第一个想去的目的地', test: function () { return (state.profile.want || []).length >= 1; } },
  { id: 'ach_book', name: '翻书人', icon: '📖', desc: '连翻 5 次答案之书', test: function () { return bookShuffleCount() >= 5; } }
];
/* 答案之书换句计数（跨会话持久化；解锁「翻书人」后清零） */
function bookShuffleCount() {
  try { return +localStorage.getItem(lsKey('book')) || 0; } catch (e) { return 0; }
}
function provCountNow() { var s = {}; state.footprints.forEach(function (f) { if (f.province) s[f.province] = 1; }); return Object.keys(s).length; }
function hasProv(p) { return state.footprints.some(function (f) { return f.province === p; }); }
var ACH_RULE_IDS = {};
ACH_RULES.forEach(function (r) { ACH_RULE_IDS[r.id] = 1; });

function checkAchievements() {
  ACH_RULES.forEach(function (rule) {
    if (state.achievements.some(function (a) { return a.name === rule.name; })) return;
    var ok = false;
    try { ok = rule.test(); } catch (e) { ok = false; }
    if (ok) {
      var ach = { id: rule.id, name: rule.name, icon: rule.icon, desc: rule.desc, date: todayStr() };
      state.achievements.unshift(ach);
      queueWrite({ table: 'achievements', action: 'upsert', id: ach.id });
      if (rule.id === 'ach_book') { try { localStorage.removeItem(lsKey('book')); } catch (e) { } }
      awardExp(30, '成就解锁 · ' + rule.name);
    }
  });
}

/* EXP 像素飘字（减弱动效偏好时跳过） */
function showExpFloat(n) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var root = $('exp-float-root');
  if (!root) return;
  var el = document.createElement('div');
  el.className = 'exp-float';
  el.textContent = '+' + n + ' EXP';
  root.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 480);
}

function awardExp(n, why) {
  if (!state.profile) return;
  var oldLv = levelFromExp(state.profile.exp);
  state.profile.exp = Math.max(0, (state.profile.exp || 0) + n);
  var newLv = levelFromExp(state.profile.exp);
  queueWrite({ table: 'profile', action: 'upsert', id: 'main' });
  if (n > 0) showExpFloat(n);   /* D11：飘字替代 EXP toast */
  if (newLv > oldLv) {
    showLevelUp(newLv);
    if (why) toast('LV.' + newLv + ' 达成！' + why, 'ok');
    if (typeof saveSnapshot === 'function') saveSnapshot(true);   /* D14：升级自动存档 */
  }
  maybeRemindBackup();
}

var _reminded = false;
function maybeRemindBackup() {
  if (_reminded) return;
  var total = state.footprints.length + state.trips.length + state.tasks.length + state.achievements.length;
  if (total >= CONFIG.REMIND_AT) {
    _reminded = true;
    toast('数据已积累 ' + total + ' 条，建议到「存档」导出 JSON 备份', 'warn');
  }
}

/* ---------------- 导入数据校验 ---------------- */
function validateRecord(table, rec) {
  if (!rec || typeof rec !== 'object') return '记录格式错误';
  if (table === 'footprints') {
    if (!rec.province || !rec.city || !rec.date) return '足迹缺少 省份/城市/日期';
    /* 归一化日期后再校验（手改备份可能是 ISO 串或其他格式） */
    rec.date = normDate(rec.date);
    if (rec.date > todayStr()) return '足迹日期不能是未来';
    if (CITY_TO_PROVINCE[rec.city] && CITY_TO_PROVINCE[rec.city] !== rec.province) {
      return '「' + rec.city + '」属于' + CITY_TO_PROVINCE[rec.city] + '，与所选省份不一致';
    }
  }
  if (table === 'trips') {
    if (!rec.title || !rec.start || !rec.end) return '行程缺少 标题/日期';
    rec.start = normDate(rec.start); rec.end = normDate(rec.end);
    if (rec.end < rec.start) return '行程结束日期早于出发日期';
    if (!Array.isArray(rec.days)) rec.days = [];
  }
  if (table === 'tasks') {
    if (!rec.title || !rec.deadline) return '任务缺少 标题/截止日';
    rec.deadline = normDate(rec.deadline);
    if (rec.link) rec.link = sanitizeUrl(rec.link);
  }
  if (table === 'achievements') {
    if (!rec.name) return '成就缺少名称';
    /* 成就由内置规则自动解锁：导入的 id 必须属于规则集，防伪造/污染成就墙 */
    if (rec.id && !ACH_RULE_IDS[rec.id]) return '未知成就 ID：' + rec.id;
  }
  return null;
}
