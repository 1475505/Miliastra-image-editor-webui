---
name: miliastra-image-svg-builder
description: 生成可导入千星图片编辑器（https://github.com/1475505/Miliastra-image-editor-webui）并导出 GIA 的 SVG。当用户提供图片（或图片描述）、希望用有限数量的图元拟合、且构图天然轴对齐时使用。SVG 导入器只支持轴对齐矩形、圆/椭圆和 3 点 polygon——旋转在导入时不保留。若用户未给出图元数量上限或画布尺寸，先提问再生成。
---

# 千星图片编辑器 SVG 生成

为千星图片编辑器生成可导入的 SVG。SVG 由 `backend/app/main.py` 中的 `parse_svg_scene` 解析，只有本文档列出的写法能被可靠还原。"导入即所得"。

## 先问清楚

动手写 SVG 之前，先确认两件事：

1. **图元数量上限** —— 未给出时问一句：`请给我一个图元数量上限，例如 20、50 或 100。`
2. **画布尺寸** —— 图片尺寸不明确时，主动询问或按图片宽高比提议一个尺寸（如 `300x300`）。

满画布的背景 `<rect>` **计入图元上限**。

## 格式选择门：SVG 还是 CSS？

**SVG 导入会丢弃全部旋转**（`transform` 不被解析，所有图元落成 `rotation=0`）。动笔前先做判断：

- 构图天然轴对齐（山体、徽章、UI 风、像素风场景）→ SVG 合适，继续。
- 构图需要倾斜形状、旋转的柔光椭圆、对角线动势 → **停手，改用 `miliastra-image-css-builder`**（CSS 导入保留 `transform: rotate(...)`）。高还原度的 Primitive Shaper 风格（`demo/demo.css`）靠旋转半透明椭圆构建，在可导入 SVG 里根本无法复现。
- 需要精确的四角星/五角星、圆环或旋转三角形 → 推荐 JSON 导入（见 §升级路径）。**注意：编辑器导出 SVG 时会直接忽略圆环图元**，并在 SVG 文件头部写入 `Miliastra-Warning` 警告注释——需要圆环的成品请用 CSS 或 JSON 导出。

需要切换时简短说明一句；不要沉默地产出退化的旋转 SVG。

## 工作流：先规划，后写码

不要直接动笔写 SVG。先走规划流程（内部过程，只返回 SVG）：

1. **调色板**：提取 3–6 个主色（hex），另备 1–2 个提亮/压暗变体。全篇复用。
2. **区域映射**：每个图片区域用哪个轴对齐图元覆盖。
3. **图层规划**：自下而上——背景 → 大色块 → 中等特征 → 点缀。文档顺序 = z 顺序。
4. **预算分配**：背景 1 个 + 大色块约 50% + 中等特征约 35% + 点缀约 15%。预留 1–2 个余量。
5. **写码**：按下方契约输出。
6. **自检**：过 §输出前检查清单；服务可达时执行 §自校验。

## 输出目标

除非用户要求解释，否则只返回 SVG。单个结构良好的文档：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H">
  <rect x="0" y="0" width="W" height="H" fill="<背景色>" />
  <!-- 图元按文档顺序 = 绘制顺序 -->
</svg>
```

- `viewBox` 必须是 `0 0 W H`——min-x/min-y 偏移被**忽略**；只读第 3、4 个分量（它们会覆盖 `width`/`height`）。
- **不会自动扩展画布**：导入器不放大画布，超出 `[0,0]→[W,H]` 的部分导出时被裁掉。所有图元必须完整落在画布内。
- **第一个子元素**必须是满画布背景 `<rect>`。导入细节：画布背景被硬编码为白色，且任何图元都不会被标记 `isBackground`（根 `<svg>` 占用了导入器的 index 0）——所以这个背景 rect 只是在最低 zIndex 上第一个被绘制，在编辑器、PNG、GIA 中都是如此。
- 只写普通十进制数（整数或 `.5`）。`px` 这类单位可以容忍；**科学计数法会解析错误**（`1e2` 读成 `1`）。

## 支持的 SVG 子集

### 可导入标签（namespace 会被剥掉）

| 标签 | 导入为 | 读取的几何 | 备注 |
|------|--------|-----------|------|
| `<rect>` | `rectangle` | `x`,`y`,`width`,`height`（x,y = **左上角**） | 仅轴对齐。`rx`/`ry`（圆角）不读。 |
| `<circle>` | `ellipse` | `cx`,`cy`,`r` | `width=height=2r`。 |
| `<ellipse>` | `ellipse` | `cx`,`cy`,`rx`,`ry` | `width=2rx`，`height=2ry`。 |
| `<polygon points="p1 p2 p3">` | `triangle` | 仅 3 个点的**包围盒** | 在该包围盒内渲染为 apex-up 等腰三角形；实际顶点形状不保留。 |

### 属性——逐个书写，绝不继承

- `fill` —— 仅纯色：`#rrggbb`（推荐）、`#rgb`、`rgb(r,g,b)` 或 CSS 颜色名。**必须逐个写在每个形状上**——不存在从 `<g>` 或祖先继承。缺失/`none`/无法解析的 fill 会静默变成 `#4f46e5`（紫色）。
- `opacity` —— `[0,1]` 之间的数字，同样逐个书写。不要用 `rgba()`/8 位 hex（alpha 被剥掉）或 `fill-opacity`（不读）。

### 会被丢弃并产生警告的（`部分 SVG 节点未导入: <tags>`）

- `<path>`、`<line>`、`<polyline>`、`<use>`、`<text>`、`<image>`、`<style>`、`<defs>`、渐变、滤镜、clip-path、蒙版。
- 圆环（`ring`）无法用 SVG 表达（编辑器 SVG 导出会忽略它并写入警告注释；手写 `<path>` 也无法导入）——需要圆环请用 CSS 或 JSON。
- 点数 ≠ 3 的 `<polygon>`——所以四角星（8 点）、五角星（10 点）**不能**用 polygon 导入。
- `<g>` 本身会进警告列表，**但它的子元素仍会被导入**（`<g>` 上的 `fill`/`transform` 不起作用）。最简单的原则：不要用 `<g>`。

### 会被静默忽略的（无警告）

- 任何元素上的 `transform`——头号约束。即使浏览器里渲染正确，导入后的场景也会全部摊平为 `rotation=0`，编辑器/GIA 输出与你的 SVG 预览不一致。永远不要写 `transform`。
- `stroke`、`stroke-width`——纯描边设计会丢掉描边，形状只剩 fill。
- CSS 类，以及 `fill`/`opacity` 以外的 presentation 属性。
- 百分比：按原始数字处理（`50%` → `50`）。

## 三角形几何（round-trip 配方）

导入时只取 polygon 的包围盒。要让导入的三角形和你画的一致，永远按目标中心 `(cx, cy)` 与尺寸 `w × h` 写出**apex-up 等腰**三角形的三个顶点：

- 顶点 `(cx, cy − h/2)`
- 左下 `(cx − w/2, cy + h/2)`
- 右下 `(cx + w/2, cy + h/2)`

朝下/朝侧/不等边的三角形做不到——用层叠矩形近似（阶梯轮廓），或改用 CSS/JSON。

## 拟合技法（轴对齐约束下如何"像"）

1. **背景先行**：第一个 rect = 图片主背景色，铺满画布。
2. **大色块**：柔和的团块、高光、光晕用 `<ellipse>`/`<circle>`；平坦的色带/区域用 `<rect>`。先画大形状。
3. **半透明叠色**：`opacity` 0.4–0.9 的交叠是这里**唯一**能模拟渐变和柔边的手段——规划调色板时让交叠处混出需要的中间色。提亮 = 白椭圆 0.3–0.6；压暗 = 深色椭圆 0.2–0.4。
4. **斜线/倾斜区域**：用宽度递增/递减的层叠矩形近似（每层约 10px 高），或接受轴对齐的简化。
5. **主体硬边**：视觉主体用 `opacity` ≥ 0.9 的锐利图元。
6. 宁可少而干净，不要碎噪的微细节。

## 端到端示例（完整示范）

需求：`300x300，上限 20 个图元，画「日落山峦」：橙黄天空、太阳光晕、两层远山、近山有雪顶、两朵云、深色前景地。`

**规划**（内部过程）：调色板 `#f7b267` 天空 / `#f4845f` 暖光 / `#ffe3a3` 光晕 / `#ffd166` 太阳 / `#8d80ad`+`#6b6390` 远山 / `#4a4e69` 近山 / `#f8f7ff` 雪顶 / `#22223b` 前景。图层：背景 → 暖光 → 光晕 → 太阳 → 云 → 远山 → 近山 → 雪顶 → 前景。

**输出**（11/20 图元）：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect x="0" y="0" width="300" height="300" fill="#f7b267" />
  <ellipse cx="250" cy="45" rx="40" ry="30" fill="#f4845f" opacity="0.3" />
  <ellipse cx="150" cy="120" rx="120" ry="90" fill="#ffe3a3" opacity="0.5" />
  <circle cx="150" cy="120" r="42" fill="#ffd166" opacity="0.95" />
  <ellipse cx="70" cy="70" rx="45" ry="13" fill="#ffffff" opacity="0.45" />
  <ellipse cx="235" cy="60" rx="40" ry="12" fill="#ffffff" opacity="0.45" />
  <polygon points="105,150 10,260 200,260" fill="#8d80ad" opacity="1" />
  <polygon points="215,170 135,260 295,260" fill="#6b6390" opacity="1" />
  <polygon points="120,180 10,300 230,300" fill="#4a4e69" opacity="1" />
  <polygon points="120,175 98,201 142,201" fill="#f8f7ff" opacity="0.9" />
  <rect x="0" y="270" width="300" height="30" fill="#22223b" />
</svg>
```

三角形校验（近山）：目标中心 `(120,240)`，尺寸 `220×120` → 顶点 `(120,180)`、左下 `(10,300)`、右下 `(230,300)`——与写出的一致，包围盒无损 round-trip。雪顶复用同一配方，中心对齐近山山尖。

## 沉默失败模式（导入器不会报错，直接给你错误结果）

| 你写的 | 实际导入结果 |
|---|---|
| `transform="rotate(...)"` 等任何 transform | 完全丢弃 → rotation = 0 |
| `fill="none"` 或漏写 `fill` | 静默变成默认紫 `#4f46e5` |
| `fill` 只写在父级 `<g>` 上 | 不继承 → 子元素全部变紫 |
| `rgba(...)` / 8 位 hex 的 alpha | alpha 被剥掉，opacity 仍为 1 |
| `width: 50%` / 百分比坐标 | 静默按 `50` 像素处理 |
| 科学计数法坐标 `1e2` | 解析为 `1` |
| 5 点/10 点 polygon（星星） | 整个图元被丢弃（进警告列表） |
| 指望 `stroke` 描边 | 描边丢失，只剩 fill |
| 形状超出 viewBox | 不扩展画布，超出部分被裁掉 |
| 用 `<g>` 分组组织 | 子元素照常导入，但警告列表出现 `g`——直接不要用 |

## 输出前检查清单

- [ ] 图元总数 ≤ 上限（含背景 `<rect>`）
- [ ] 根元素有 `width`/`height`/`viewBox="0 0 W H"`，第一个子元素是满画布背景 rect
- [ ] 每个形状都各自写了 `fill` 和 `opacity`（不依赖任何继承）
- [ ] 全文没有 `transform`、`<g>`、`<defs>`、渐变、`stroke`、`path`
- [ ] polygon 恰好 3 个点，且按"apex-up 等腰"配方计算
- [ ] 所有坐标为普通十进制数，全部落在 `[0,0]→[W,H]` 内
- [ ] 文档顺序 = 期望的绘制顺序（z 顺序）

## 自校验（可选，服务在本地时强烈推荐）

```bash
python3 - <<'EOF'
import json, urllib.request
svg = open("fit.svg").read()
def post(path, payload):
    req = urllib.request.Request("http://localhost:8439" + path,
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req).read()
scene = json.loads(post("/api/import", {"sourceType": "svg", "content": svg}))["scene"]
print("warnings:", scene["meta"]["warnings"])
print("canvas:", scene["canvas"]["width"], "x", scene["canvas"]["height"], "elements:", len(scene["elements"]))
open("fit.png", "wb").write(post("/api/export/png", {"scene": scene}))
EOF
```

出现任何警告 = 回去改 SVG。把 `fit.png` 和目标图对比，修正图层规划。

## 升级路径：JSON 导入

需要原生星星、旋转图元或精确控制时，推荐 JSON 导入（`POST /api/import {sourceType: "json"}`）。最小 schema：

```json
{
  "canvas": { "width": 300, "height": 300, "background": "#ffffff" },
  "elements": [
    { "type": "five_point_star", "x": 150, "y": 150, "width": 92, "height": 92, "rotation": 0, "color": "#be123c", "opacity": 1, "zIndex": 0 }
  ]
}
```

`type` ∈ `ellipse | rectangle | triangle | four_point_star | five_point_star | ring`；`x`/`y` = 中心坐标；rotation 逆时针为正。

## 星星近似方案（无法改用 JSON 时的兜底）

四角星（8 点 polygon 会被丢弃）：一个竖矩形 + 一个横矩形 + 一个中心圆，同一 fill。五角星：4 根轴对齐短矩形辐条（上下左右）+ 1 个中心圆。这些读起来像"闪光/十字"而不是真正的星星——要可辨识的五角星轮廓，旋转是刚需，请推荐 CSS builder 或 JSON。
