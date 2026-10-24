# -*- coding: utf-8 -*-
"""组装单文件 HTML：内联 ECharts + 中国 GeoJSON + 应用脚本"""
import json
import os

import sys
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = HERE                                   # 源文件与脚本同目录
OUT = os.path.join(os.path.dirname(HERE), "index.html")   # 产物输出到仓库根（GitHub Pages 直接托管）

# ---------- 1. GeoJSON 瘦身：仅保留 name，坐标保留 4 位小数，补南海诸岛 ----------
geo = json.load(open(os.path.join(BUILD, "china_geo.json"), encoding="utf-8"))

def round_coords(obj):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(x), 4) for x in obj]
        return [round_coords(x) for x in obj]
    return obj

for f in geo["features"]:
    props = f.get("properties", {}) or {}
    name = props.get("name") or ""
    if not name and props.get("adcode") == "100000_JD":
        name = "南海诸岛"
    f["properties"] = {"name": name}
    f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])

geo_js = "window.CHINA_GEO=" + json.dumps(geo, ensure_ascii=False, separators=(",", ":")) + ";"
with open(os.path.join(BUILD, "geojson_wrapped.js"), "w", encoding="utf-8") as f:
    f.write(geo_js)

# ---------- 2. 读取各部分 ----------
head = open(os.path.join(BUILD, "part_head.html"), encoding="utf-8").read()
body = open(os.path.join(BUILD, "part_body.html"), encoding="utf-8").read()
echarts = open(os.path.join(BUILD, "echarts.min.js"), encoding="utf-8").read()
app = ""
for name in ["app_core.js", "app_map.js", "app_ui.js", "app_ui2.js"]:
    app += "\n/* ================= %s ================= */\n" % name
    app += open(os.path.join(BUILD, name), encoding="utf-8").read()

# ---------- 3. 组装：head 只留 CSS，ECharts/GeoJSON/应用脚本全部移到 body 末尾 ----------
# 目的：HTML+CSS 先行绘制首屏（含地图容器与加载态），1MB 级脚本解析不阻塞首屏
echarts_script = "<script>\n/* ECharts 5.5.1 (Apache-2.0) · 内联本地化，无外部依赖 */\n" + echarts + "\n</script>\n"
geo_script = "<script>\n/* 中国省级行政区 GeoJSON（34 省级行政区 + 南海诸岛，自然资源部标准地图服务·高德 DataV）· 内联本地化 */\n" + geo_js + "\n</script>\n"
app_script = "<script>\n" + app + "\n</script>\n"

assert "</body>" in body, "part_body.html 缺少 </body>"
body = body.replace("</body>", echarts_script + geo_script + app_script + "</body>")
html = head + body

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

size = os.path.getsize(OUT)
print("OUT:", OUT)
print("SIZE: %.2f MB (%d bytes)" % (size / 1048576, size))
print("parts: head=%d body=%d echarts=%.2fMB geo=%.2fMB app=%.1fKB" % (
    len(head), len(body), len(echarts) / 1048576, len(geo_js) / 1048576, len(app) / 1024))

# ---------- 4. 基本校验：无外部资源加载（业务深链除外） ----------
import re
bad_patterns = [
    (r'<script[^>]+src\s*=\s*["\']https?://', "外部 script src"),
    (r'<link[^>]+href\s*=\s*["\']https?://', "外部 link href"),
    (r'@import', "CSS @import"),
    (r'url\(\s*["\']?https?://', "CSS url() 外链"),
    (r'srcset\s*=\s*["\']https?://', "srcset 外链"),
]
for pat, label in bad_patterns:
    m = re.search(pat, html, re.I)
    assert not m, "发现" + label + ": " + html[max(0, m.start() - 40):m.start() + 80]
print("EXTERNAL_RESOURCE_CHECK: ok（无任何外部资源加载，仅保留 12306/携程/去哪儿 等业务深链）")
print("ASSEMBLE_OK")
