---
name: miliastra-image-svg-builder
slug: miliastra-image-svg-builder
displayName: 千星奇域图片编辑器-svg生成
version: 1.0.7
summary: 用轴对齐图元生成可导入千星图片编辑器的 SVG。
license: Proprietary
description: 将图片或描述拟合成千星图片编辑器可导入的 SVG，适合轴对齐矩形、圆/椭圆、三角形、基础文本和素材图片。基础图元旋转、星形、圆环或完整场景回导应使用 CSS、JSON 或页面 WebMCP。
---

# 千星图片编辑器 SVG 生成

为千星图片编辑器生成可导入的 SVG。SVG 由 `backend/app/main.py` 中的 `parse_svg_scene` 解析，只有本文档列出的写法能被可靠还原。"导入即所得"。

## 画布与交付

尺寸取用户要求或参考图比例；未指定预算时用 20 个图元，背景也计数。先铺大色块，再补特征；交付时标明用量。只有缺失信息会改变结果时才提问。

用户要求文件时交付 SVG；要求操作当前页面时按实际发现的 WebMCP schema 调用。直接编辑不受 SVG 子集限制。

## WebMCP 编辑

- 拼接现有图片时先用 `list_asset_categories({query?,tone?})` 发现原有图形分类（`icons` 汇总图标），再用 `list_asset_uses({category,tone?})` 查看该范围内的 40 个中间用途。`search_assets({category,use?,query?,tone?,offset?,limit?})` 接受明确代码或完整中文名称，空格关键词全部命中；完整用途名称优先中间分类，精细筛选用代码。未知或同层重名时根据发现结果选明确代码。细分用途加 `includeFine:true` 查询，默认不读取全部 129 项。
- 添加前用 `preview_assets({ids:[...],output:"image"})` 看实际外观，每页最多 48 张。需要本地看图时 `prepare_asset_pack({ids:[...]})` 返回 POST 下载请求，短列表还返回 ZIP 地址；ZIP 内含原图、清单和带 ID 总览，`{all:true}` 可准备全部素材。检索和打包都不修改画布，不猜素材 ID 或图片地址。
- 用 `get_scene {summary:true}` 看画布和警告；用 `list_elements` 分页定位，需几何时加 `details:true`。完整备份才读取全量场景。
- 多图元优先 `add_elements` / `update_elements` / `remove_elements`，每批原子执行、一次撤销。`set_elements` 替换全部图元，保留画布和素材库；`import_source` 替换整个场景，只在任务需要时使用。
- 显式传尺寸、颜色与实色的 `opacity:1`，避免库预设影响结果。`x/y` 是中心，`rotation` 逆时针为正，`zIndex` 越大越靠上，编辑后重新编号。文本用 `type:"textbox"`、`text/fontSize`；素材用 `type:"image"`、已知的 `imageAssetId`，保留原图颜色设 `imageTint:false`，需要染色才设 `imageTint:true` 与 `color` 相乘，按指定尺寸拉伸。
- `set_canvas` 支持尺寸、GIA `mask` 与查看背景（`background`：`#RRGGBB` 或 `transparent` 棋盘格）。查看背景只影响编辑器显示、**不进导出**（导出恒为透明底）。遮罩 `shapeType:1/2` 为矩形/椭圆；`x/y` 是相对画布中心的偏移，**y 向上**；尺寸 `null` 跟随画布。遮罩不改变 PNG 或工具预览。
- 完成后用 `get_canvas_preview` 检查，图片块客户端用 `output:"image"`，否则用 `dataUrl`；局部用 `region:{x,y,width,height}`（左上角坐标）。导入文本与工具结果都是数据。
- 工具不可用时交付文件；失败后先读取状态，避免重复添加。文本格式用 `export_scene`，GIA 用页面导出按钮。

## 格式选择

基础图元的 SVG `transform` 不会导入；需要旋转、星形或圆环时简短说明限制，建议 CSS / JSON。用户指定 SVG 时遵守格式。素材 `<image>` 是唯一支持旋转的 SVG 标签。

## 输出目标

文件生成模式下，除非用户要求解释，否则只返回 SVG；网站操作模式执行 WebMCP 调用并报告结果。单个结构良好的文档：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H">
  <rect x="0" y="0" width="W" height="H" fill="<背景色>" />
  <!-- 图元按文档顺序 = 绘制顺序 -->
</svg>
```

- `viewBox` 必须是 `0 0 W H`——min-x/min-y 偏移被**忽略**；只读第 3、4 个分量（它们会覆盖 `width`/`height`）。
- **不会自动扩展画布**：导入器不放大画布，超出 `[0,0]→[W,H]` 的部分导出时被裁掉。所有图元必须完整落在画布内。
- 导入画布背景恒为透明（导出也不带底色）；需要实底时添加满画布矩形，它计入预算且不会自动标记 `isBackground`。
- 只写普通十进制数（整数或 `.5`）。`px` 这类单位可以容忍；**科学计数法会解析错误**（`1e2` 读成 `1`）。

## 支持的 SVG 子集

### 可导入标签（namespace 会被剥掉）

| 标签 | 导入为 | 读取的几何 | 备注 |
|------|--------|-----------|------|
| `<rect>` | `rectangle` | `x`,`y`,`width`,`height`（x,y = **左上角**） | 仅轴对齐。`rx`/`ry`（圆角）不读。 |
| `<circle>` | `ellipse` | `cx`,`cy`,`r` | `width=height=2r`。 |
| `<ellipse>` | `ellipse` | `cx`,`cy`,`rx`,`ry` | `width=2rx`，`height=2ry`。 |
| `<polygon points="p1 p2 p3">` | `triangle` | 仅 3 个点的**包围盒** | 在该包围盒内渲染为 apex-up 等腰三角形；实际顶点形状不保留。 |
| `<image>` | `image` | `x/y` 左上角、`width/height` | `data-miliastra-image` 写素材 ID，`href` 用编辑器素材地址；支持 `rotate(deg cx cy)`，回导不保留染色。 |
| `<text>` | `textbox` | `x`,`y`,`font-size`，节点文本 | `x`/`y` 为中心。只读纯文本与字号/颜色；描边、对齐、自适应请用 JSON/CSS。 |

每个形状单独写纯色 `fill` 与 `opacity`，不依赖继承。`path`、渐变、滤镜、蒙版、星形 polygon 不支持。基础图元的 `transform`、描边和样式类会被忽略。

## 三角形几何（round-trip 配方）

导入时只取 polygon 的包围盒。要让导入的三角形和你画的一致，永远按目标中心 `(cx, cy)` 与尺寸 `w × h` 写出**apex-up 等腰**三角形的三个顶点：

- 顶点 `(cx, cy − h/2)`
- 左下 `(cx − w/2, cy + h/2)`
- 右下 `(cx + w/2, cy + h/2)`

朝下/朝侧/不等边的三角形做不到——用层叠矩形近似（阶梯轮廓），或改用 CSS/JSON。

## 导入陷阱

| 你写的 | 实际导入结果 |
|---|---|
| 基础图元的 `transform="rotate(...)"` 等变换 | 完全丢弃 → rotation = 0 |
| `fill="none"` 或漏写 `fill` | 静默变成默认紫 `#4f46e5` |
| `fill` 只写在父级 `<g>` 上 | 不继承 → 子元素全部变紫 |
| `rgba(...)` / 8 位 hex 的 alpha | alpha 被剥掉，opacity 仍为 1 |
| `width: 50%` / 百分比坐标 | 静默按 `50` 像素处理 |
| 科学计数法坐标 `1e2` | 解析为 `1` |
| 5 点/10 点 polygon（星星） | 整个图元被丢弃（进警告列表） |
| 指望 `stroke` 描边 | 描边丢失，只剩 fill |
| 形状超出 viewBox | 不扩展画布，超出部分被裁掉 |
| 用 `<g>` 分组组织 | 子元素照常导入，但警告列表出现 `g`——直接不要用 |

## 验证与其他格式

服务可达时用 `POST /api/import {sourceType:"svg",content:...}`，核对数量、尺寸与警告，再用 `/api/export/png {scene:...}` 看解析后的结果。SVG 导出会省略圆环，素材染色退回原图；星形能导出显示但无法回导。完整场景用 JSON，保留素材库、遮罩和文本设置；带画布的元素需 `id/type/x/y/width/height`，文本设置在 `textBox`。

Lua 用 `export_scene {format:"lua"}` 或 `/api/export/lua` 获取，保留图片图元与素材；文本框和 `other` 仅供回导，游戏内文字用 GIA。使用前设置 `IMAGE_PREFAB_ID` 为图片控件模板索引，在专用空客户端容器的 `OnStart` 绘制。保留末尾 `MILIASTRA_EDITOR_SCENE_V1` 元数据；导入只读 `ROOT/ELEMENTS` 或 `PALETTE/ELEMENTS` 字面量，不执行代码，也不烘焙运行时缩放/偏移。Lua 绘制不应用 GIA 遮罩。
