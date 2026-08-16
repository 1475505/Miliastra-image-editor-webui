---
name: miliastra-image-css-builder
description: 生成可导入千星图片编辑器（https://github.com/1475505/Miliastra-image-editor-webui）并导出 GIA 的 CSS。当用户提供图片（或图片描述）、希望用有限数量的图元拟合时使用。支持旋转矩形/椭圆、原生三角形（精确 clip-path 字符串）与圆环（radial-gradient 三段式）——旋转是 CSS 相对 SVG 导入的独有优势。若用户未给出图元数量上限或画布尺寸，先提问再生成。
---

# 千星图片编辑器 CSS 生成

为千星图片编辑器生成可导入的 CSS。CSS 由 `backend/app/main.py` 中的 `parse_css_scene` 解析，只有本文档列出的写法能被可靠还原。"导入即所得"——编辑器预览、PNG 导出、GIA 导出全部来自解析后的场景。

## 先问清楚

动手写 CSS 之前，先确认两件事：

1. **图元数量上限** —— 未给出时问一句：`请给我一个图元数量上限，例如 20、50 或 100。`
2. **画布尺寸** —— 图片尺寸不明确时，主动询问或按图片宽高比提议一个尺寸（如 `300x300`、`400x300`），不要无脑默认正方形。

满画布的背景矩形**计入图元上限**。最终在注释里写明用量，例如 `/* 11/20 elements used */`（注释中不要出现花括号）。

## 工作流：先规划，后写码

不要直接动笔写 CSS。影响成品质量的最大因素是先写出规划。永远按以下步骤走（规划是内部过程，只返回 CSS）：

1. **调色板**：从图片提取 3–6 个主色（hex），另备 1–2 个提亮/压暗的变体。全篇复用这些 hex，不要为每个图元发明新颜色。
2. **区域映射**：把画布划分成区域（天空 / 主体 / 前景……），决定每个区域用什么图元覆盖。
3. **图层规划**：自下而上列出图元（z 顺序）：背景 → 大色块 → 中等特征 → 小而实的点缀。
4. **预算分配**：背景 1 个 + 大色块约占 50% + 中等特征约 35% + 点缀约 15%。预留 1–2 个图元的余量。
5. **写码**：按下方契约输出 CSS。
6. **自检**：过一遍 §输出前检查清单；服务可达时执行 §自校验 的实时验证。

## 输出格式契约

除非用户要求解释，否则只返回 CSS。目标结构：

- 一个 `.shaper-container { ... }` 块（画布）。
- 一条基础规则 `.shaper-element { position: absolute; box-sizing: border-box; }` —— **里面不能写 `left`/`top`/`width`/`height`**，否则基础规则本身会被当成一个幽灵图元导入。
- 每个图元一条规则：`.shaper-element.shaper-e0`、`.shaper-element.shaper-e1`……按绘制顺序排列。

`.shaper-container` 固定写法：

```css
.shaper-container {
  position: relative;
  width: 300px;
  height: 300px;
  background: #ffffff;
  overflow: hidden;
}
```

容器背景在导入时会被**忽略**，并触发警告 `已忽略 .shaper-container 的背景颜色…`——这个警告是预期行为（编辑器自己导出的 CSS 也带这一行），保留它是为了浏览器预览保真。场景背景必须用满画布矩形图元（`shaper-e0`）表示；第一个矩形图元会自动被标记为 `isBackground`。

每条图元规则必须包含以下完整样板（一行都不能少）：

```css
.shaper-element.shaper-eN {
  left: <中心x>px;
  top: <中心y>px;
  width: <w>px;
  height: <h>px;
  background: <#rrggbb>;
  opacity: <0-1>;
  transform: translate(-50%, -50%) rotate(<deg>deg);
  transform-origin: 50% 50%;
  z-index: <N>;
}
```

- `left`/`top` 是图元**中心**坐标，单位 px。`translate(-50%, -50%)` 是让浏览器中"left/top 即中心"成立的关键——必须永远保留；导入器只提取其中的 `rotate(...)` 部分。
- `z-index`：从 0 连续编号，且与文档顺序一致。导入时场景会按 `z-index` 重排，编号混乱会导致图层错乱。
- 填充统一用 `background`（不要 `background-color`），只写纯色 hex。

## 支持的图元

只有四种基础图元，一切构图都由它们组合而成。

### 1. 矩形

默认类型，无需额外属性。

### 2. 椭圆

加 `border-radius: 50%;`。正圆 = width 与 height 相等。

### 3. 三角形（原生，clip-path）

加下面这个**精确字符串**（空格位置敏感——匹配前只做空白归一化，是字面匹配）：

```css
clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
```

导入为原生 apex-up 等腰三角形（`type: triangle`），并能在 GIA 中导出为真正的三角形素材。定位/尺寸约定与矩形完全一致（`left`/`top` = 三角形包围盒的中心）。这也是编辑器 CSS 导出器自己使用的字符串，可以无损 round-trip。

- 只存在**apex-up（尖朝上）**三角形。需要朝下/朝侧的三角形时：对三角形图元使用 `rotate(...)` 是有效的（旋转整个包围盒），`rotate(180deg)` 即得到尖朝下的三角形。
- 字符串与模板有任何偏差（例如 `polygon(50% 0%,0% 100%,100% 100%)` 少了空格）会静默导入为**矩形**。

### 4. 圆环（radial-gradient 三段式）

加下面这段**精确写法**作为 `background`（空格位置敏感——匹配前只做空白归一化，是字面匹配）：

```css
background: radial-gradient(closest-side, transparent 79.5%, #f59e0b 80.5%, transparent 100%);
```

导入为原生圆环（`type: ring`，内径:外径 = 0.8，GIA 素材 100006），颜色从第二段 stop 提取。定位/尺寸约定与矩形完全一致（`left`/`top` = 圆环外接包围盒的中心，`width`/`height` = 外接直径）。这也是编辑器 CSS 导出器自己使用的写法，可以无损 round-trip。

- 圆环比例固定为 0.8，不需要（也不能）手动调整 stop 百分比；第二段 stop 的颜色会被解析为图元颜色。
- 尾部 `transparent 100%` 必须保留：radial-gradient 在结束形状（100%）之外会用最后一个 stop 的颜色填满四角，少了它会变成「带圆洞的矩形」而非圆环。
- 只有 `transparent → 纯色`（可尾随 transparent 收尾）的 `radial-gradient` 会被识别为圆环；其他渐变（`linear-gradient`、无 transparent 首段的径向渐变）仍按旧行为落入默认紫色并静默变成矩形。

### 四角星 / 五角星

CSS 没有能编码原生星星的写法。要么用矩形 + 旋转正方形近似（见文末 §旧式近似方案），要么——当用户需要在 GIA 中得到真正的星星素材时——推荐 JSON 导入（见 §升级路径）。

## 旋转速查表

旋转是 CSS 格式的独有优势（SVG 导入会丢弃全部旋转），务必用活。正角度 = 屏幕上**顺时针**：

- `rotate(45deg)`：横条右端下沉 → 呈 `\` 形
- `rotate(-45deg)`：横条右端上扬 → 呈 `/` 形
- 椭圆的长轴按同样方向倾斜
- `rotate(180deg)`：三角形尖朝下
- 永远带 `deg` 单位：`rotate(45)`（缺单位）会静默导入为旋转 0

## 拟合技法（让结果"像"的关键）

参考风格（`demo/demo.css`，Primitive Shaper）几乎全部用**旋转的大号半透明椭圆**构建。技法按影响力排序：

1. **大面积色块用旋转椭圆**：天空、水面、肤色、阴影——几个 `opacity` 0.4–0.7 的大旋转椭圆互相叠色，能调和出矩形永远做不到的柔和渐变。
2. **提亮**：叠加白色/近白色椭圆，`opacity` 0.3–0.6。**压暗**：叠加深色椭圆（或主色的暗变体），`opacity` 0.2–0.4。没有渐变可用时，光影就是这么做的。
3. **半透明叠色**：半透明形状交叠处会混色——规划调色板时，让交叠区域恰好混出你需要的中间色调。
4. **主体用硬边**：视觉主体（图标、山体、建筑）用 `opacity` ≥ 0.9 的锐利图元（矩形/三角形）；柔和只属于氛围层。
5. **每个图元的旋转后包围盒必须留在画布内**。旋转会撑大包围盒（`bbox = w·|cos θ| + h·|sin θ|`）。越界会触发画布自动拟合：从左/上越界会导致**所有图元整体平移**——整个构图静默错位。
6. 坐标取整数或 `.5`。中心坐标不要为负，也不要超过 W/H。

## 端到端示例（完整示范，照这个思路做）

需求：`300x300，上限 20 个图元，画「日落山峦」：橙黄天空、带光晕的太阳、两层远山、近山有雪顶、两朵云、深色前景地。`

**规划**（内部过程）：

| z | 语义 | 图元 | 颜色 / opacity |
|---|------|------|----------------|
| e0 | 天空底 | 满画布 rect | `#f7b267` / 1 |
| e1 | 右上暖光 | 旋转 ellipse 80x60 | `#f4845f` / 0.3 |
| e2 | 太阳光晕 | 旋转 ellipse 240x180 | `#ffe3a3` / 0.5 |
| e3 | 太阳 | circle 84x84 | `#ffd166` / 0.95 |
| e4/e5 | 云 ×2 | 旋转 ellipse | `#ffffff` / 0.45 |
| e6/e7 | 远山 ×2 | triangle (clip-path) | `#8d80ad`、`#6b6390` / 1 |
| e8 | 近山 | triangle | `#4a4e69` / 1 |
| e9 | 雪顶 | 小 triangle 叠在山尖 | `#f8f7ff` / 0.9 |
| e10 | 前景地 | rect 300x30 | `#22223b` / 1 |

**输出**（11/20 图元，预留了余量）：

```css
/* 11/20 elements used */
.shaper-container {
  position: relative;
  width: 300px;
  height: 300px;
  background: #ffffff;
  overflow: hidden;
}
.shaper-element {
  position: absolute;
  box-sizing: border-box;
}
.shaper-element.shaper-e0 {
  left: 150px;
  top: 150px;
  width: 300px;
  height: 300px;
  background: #f7b267;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}
.shaper-element.shaper-e1 {
  left: 250px;
  top: 45px;
  width: 80px;
  height: 60px;
  background: #f4845f;
  opacity: 0.3;
  transform: translate(-50%, -50%) rotate(15deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 1;
}
.shaper-element.shaper-e2 {
  left: 150px;
  top: 120px;
  width: 240px;
  height: 180px;
  background: #ffe3a3;
  opacity: 0.5;
  transform: translate(-50%, -50%) rotate(-10deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 2;
}
.shaper-element.shaper-e3 {
  left: 150px;
  top: 120px;
  width: 84px;
  height: 84px;
  background: #ffd166;
  opacity: 0.95;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 3;
}
.shaper-element.shaper-e4 {
  left: 70px;
  top: 70px;
  width: 90px;
  height: 26px;
  background: #ffffff;
  opacity: 0.45;
  transform: translate(-50%, -50%) rotate(-6deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 4;
}
.shaper-element.shaper-e5 {
  left: 235px;
  top: 60px;
  width: 80px;
  height: 24px;
  background: #ffffff;
  opacity: 0.45;
  transform: translate(-50%, -50%) rotate(4deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 5;
}
.shaper-element.shaper-e6 {
  left: 105px;
  top: 205px;
  width: 190px;
  height: 110px;
  background: #8d80ad;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  z-index: 6;
}
.shaper-element.shaper-e7 {
  left: 215px;
  top: 215px;
  width: 160px;
  height: 90px;
  background: #6b6390;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  z-index: 7;
}
.shaper-element.shaper-e8 {
  left: 120px;
  top: 240px;
  width: 220px;
  height: 120px;
  background: #4a4e69;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  z-index: 8;
}
.shaper-element.shaper-e9 {
  left: 120px;
  top: 188px;
  width: 44px;
  height: 26px;
  background: #f8f7ff;
  opacity: 0.9;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  z-index: 9;
}
.shaper-element.shaper-e10 {
  left: 150px;
  top: 285px;
  width: 300px;
  height: 30px;
  background: #22223b;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 10;
}
```

注意雪顶的做法：近山的山尖在 `(120, 180)`（中心 y 240 − 高/2 60），所以一个中心在 `(120, 188)` 的小号 apex-up 三角形恰好落在峰顶。组合特征时就这样对齐包围盒。

## 沉默失败模式（导入器不会报错，直接给你错误结果）

| 你写的 | 实际导入结果 |
|---|---|
| `clip-path` 字符串与精确模板有任何差异 | 静默变成 rectangle |
| `rotate(45)` 漏写 `deg` | rotation = 0 |
| `width: 50%`（任何百分比） | 静默变成 `50px` |
| `background: rgba(234,88,12,0.3)` | alpha 被剥掉 → 颜色 `#ea580c` 且 `opacity: 1` |
| `background: linear-gradient(...)` / `url(...)` | 颜色解析失败 → 默认紫 `#4f46e5` |
| radial-gradient 缺 `transparent → 纯色` 首段结构 | 不识别为圆环 → 同左，静默变成矩形 |
| 基础规则 `.shaper-element {}` 里写 left/top/width/height | 基础规则本身被导入为一个幽灵图元 |
| `border-left/right/bottom` 三角形 hack | 能导入为 triangle，但 `top` 被当作包围盒**顶边**而非中心——不要用，用 clip-path |
| 图元（旋转后的包围盒）超出画布左/上边缘 | **所有图元被整体平移**，构图静默错位；超右/下则画布被撑大 |
| `::before` / `::after` / `box-shadow` / `border` / `filter` | 完全忽略 |
| `scale(...)` / `skew(...)` / `matrix(...)` / `translateX(...)` | 完全忽略（只读 `rotate(Ndeg)`） |
| 缺 `left`/`top`/`width`/`height` 任一 | 整条规则被跳过，图元丢失 |

## 输出前检查清单

- [ ] 图元总数 ≤ 上限（含背景矩形），并在注释中写明 `N/M`
- [ ] `shaper-e0` 是满画布背景矩形，颜色取自图片主背景色
- [ ] 每条图元规则都有完整的 8 行样板（含 `translate(-50%, -50%) rotate(Ndeg)` 与 `transform-origin`）
- [ ] 三角形只用精确 clip-path 字符串；ellipse 都有 `border-radius: 50%`；圆环只用三段式 radial-gradient（尾部 `transparent 100%` 收尾）
- [ ] 所有图元的**旋转后包围盒**都在 `[0,0]→[W,H]` 内
- [ ] `z-index` 从 0 连续编号且与文档顺序一致
- [ ] 无渐变（圆环的三段式 radial-gradient 除外）、无 rgba、无百分比、无伪元素、无 border hack

## 自校验（可选，服务在本地时强烈推荐）

如果编辑器服务正在运行（默认 8439 端口），交付前做一次 round-trip 并检查 PNG：

```bash
python3 - <<'EOF'
import json, urllib.request
css = open("fit.css").read()
def post(path, payload):
    req = urllib.request.Request("http://localhost:8439" + path,
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req).read()
scene = json.loads(post("/api/import", {"sourceType": "css", "content": css}))["scene"]
print("warnings:", scene["meta"]["warnings"])
print("canvas:", scene["canvas"]["width"], "x", scene["canvas"]["height"], "elements:", len(scene["elements"]))
open("fit.png", "wb").write(post("/api/export/png", {"scene": scene}))
EOF
```

出现任何警告或画布尺寸异常 = 回去改 CSS。把 `fit.png` 和目标图对比，修正图层规划（通常是：调整调色板、放大色块、补提亮/压暗层）。

## 升级路径：JSON 导入

当用户需要原生星星、精确旋转的三角形、或超出 CSS 表达能力的精确控制时，推荐 JSON 导入（`POST /api/import {sourceType: "json"}`）。最小 schema：

```json
{
  "canvas": { "width": 300, "height": 300, "background": "#ffffff" },
  "elements": [
    { "type": "five_point_star", "x": 150, "y": 150, "width": 92, "height": 92, "rotation": 0, "color": "#be123c", "opacity": 1, "zIndex": 0 }
  ]
}
```

`type` ∈ `ellipse | rectangle | triangle | four_point_star | five_point_star | ring`；`x`/`y` = 中心坐标；**rotation 逆时针为正**（与 CSS `rotate` 符号相反）。

如果给定图元上限内无法达到用户期望的还原度，简短说明，并给出选择：(a) 在上限内出低还原度版本；(b) 改用 JSON 导入。

## 旧式近似方案（仅在不允许 clip-path 的旧流程中使用）

四角星：一个竖矩形 + 一个横矩形 + 一个中心旋转 `45deg` 的正方形。五角星：5 根辐条（矩形分别旋转 `0/72/144/216/288deg`）+ 1 个中心圆。能用 clip-path 三角形和 JSON 原生星星时，优先不用这些近似。
