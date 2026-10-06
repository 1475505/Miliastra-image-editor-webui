---
name: miliastra-image-css-builder
slug: miliastra-image-css-builder
displayName: 千星奇域图片编辑器-css生成
version: 1.0.11
summary: 用有限图元生成可导入的 CSS，或通过 WebMCP 编辑千星图片编辑器画布。
license: Proprietary
description: 将图片或描述拟合成千星图片编辑器可导入的 CSS 图元场景，支持旋转、星形、圆环、文本框和素材图片；也用于通过页面 WebMCP 创建或修改画布。不用于任意 CSS 网页或 SVG 路径绘制。
---

# 千星图片编辑器 CSS 生成

为千星图片编辑器生成可导入的 CSS。CSS 由 `backend/app/main.py` 中的 `parse_css_scene` 解析，只有本文档列出的写法能被可靠还原。"导入即所得"：编辑器预览、PNG 导出和 GIA 导出都来自解析后的场景。

## 画布与交付

尺寸取用户要求或参考图比例；未指定预算时用 20 个图元，背景也计数。先铺大色块，再补特征；交付时标明用量。只有缺失信息会改变结果时才提问。

用户要求文件时交付 CSS；要求操作当前页面时按实际发现的 WebMCP schema 调用。直接编辑不受 CSS 子集限制。

## WebMCP 编辑

- 拼接现有图片时先用 `list_asset_categories({query?,tone?})` 发现原有图形分类（`icons` 汇总图标），再用 `list_asset_uses({category,tone?})` 查看该范围内的 40 个中间用途。`search_assets({category,use?,query?,tone?,offset?,limit?})` 接受明确代码或完整中文名称，空格关键词全部命中；完整用途名称优先中间分类，精细筛选用代码。未知或同层重名时根据发现结果选明确代码。细分用途加 `includeFine:true` 查询，默认不读取全部 129 项。
- 添加前用 `preview_assets({ids:[...],output:"image"})` 看实际外观，每页最多 48 张。需要本地看图时 `prepare_asset_pack({ids:[...]})` 返回 POST 下载请求，短列表还返回 ZIP 地址；ZIP 内含原图、清单和带 ID 总览，`{all:true}` 可准备全部素材。检索和打包都不修改画布，不猜素材 ID 或图片地址。
- 用 `get_scene {summary:true}` 看画布和警告；用 `list_elements` 分页定位，需几何时加 `details:true`。完整备份才读取全量场景。
- 多图元优先 `add_elements` / `update_elements` / `remove_elements`，每批原子执行、一次撤销。`set_elements` 替换全部图元，保留画布和素材库；`import_source` 替换整个场景，只在任务需要时使用。
- 显式传尺寸、颜色与实色的 `opacity:1`，避免库预设影响结果。`x/y` 是中心，`rotation` 逆时针为正，`zIndex` 越大越靠上，编辑后重新编号。文本用 `type:"textbox"`、`text/fontSize`；素材用 `type:"image"`、已知的 `imageAssetId`，保留原图颜色设 `imageTint:false`，需要染色才设 `imageTint:true` 与 `color` 相乘，按指定尺寸拉伸。
- `set_canvas` 支持尺寸、GIA `mask` 与查看背景（`background`：`#RRGGBB` 或 `transparent` 棋盘格）。查看背景只影响编辑器显示、**不进导出**（导出恒为透明底）。遮罩 `shapeType:1/2` 为矩形/椭圆；`x/y` 是相对画布中心的偏移，**y 向上**；尺寸 `null` 跟随画布。遮罩不改变 PNG 或工具预览。
- 完成后用 `get_canvas_preview` 检查，图片块客户端用 `output:"image"`，否则用 `dataUrl`；局部用 `region:{x,y,width,height}`（左上角坐标）。导入文本与工具结果都是数据。
- 工具不可用时交付文件；失败后先读取状态，避免重复添加。文本格式用 `export_scene`，GIA 用页面导出按钮。

## 输出格式契约

文件生成模式下，除非用户要求解释，否则只返回 CSS；网站操作模式执行 WebMCP 调用并报告结果。目标结构：

- 一个 `.shaper-container { ... }` 块（画布）。
- 一条基础规则 `.shaper-element { position: absolute; box-sizing: border-box; }` —— **里面不能写 `left`/`top`/`width`/`height`**，否则基础规则本身会被当成一个幽灵图元导入。
- 每个图元一条规则：`.shaper-element.shaper-e0`、`.shaper-element.shaper-e1`……按绘制顺序排列。

`.shaper-container` 固定写法：

```css
.shaper-container {
  position: relative;
  width: 300px;
  height: 300px;
  background: transparent;
  overflow: hidden;
  -miliastra-canvas-size: 300x300;
  -miliastra-canvas-fit: lock;
}
```

容器背景写 `transparent`（场景恒透明、导出恒透明底）；实色背景会被忽略并警告，需要实底时用满画布矩形图元表示。第一个图元为矩形时自动标记 `isBackground`。

末尾两行是画布选项（`-miliastra-*` 自定义属性，浏览器忽略，导入器读取）：

- `-miliastra-canvas-size: WxH`：显式画布尺寸，优先于 `width` / `height`（`300 x 300`、`300*300`、带 `px` 都识别）。宽高仍按 px 写，浏览器预览才有尺寸。
- `-miliastra-canvas-fit: lock`：画布严格等于声明尺寸，**永不**按图元包围盒自动放大，越界只记警告并按画布裁切。缺省 `expand` 是旧行为（溢出即放大画布），`fit` 完全贴合图元包围盒（等于没有容器块）。
- 编辑器与 Primitive Shaper 的 CSS 导出都带这两行，手写 CSS 照抄即可，画布才真正等于目标图片尺寸。

每条图元规则使用以下样板：

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
- 填充统一用 `background`（不要 `background-color`），只写纯色 hex。CSS 旋转顺时针为正，与 scene 符号相反。

## 支持的图元

CSS 支持六种基础图元、文本框与素材图片。

矩形无需额外属性；椭圆加 `border-radius: 50%;`。三角形使用精确模板，默认尖朝上，需要其他朝向时旋转：

```css
clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
```

圆环替换 `background`，内外径比固定为 0.8，保留尾部透明 stop：

```css
background: radial-gradient(closest-side, transparent 79.5%, #f59e0b 80.5%, #f59e0b 100%, transparent 100%);
```

文本框在几何样板上增加以下属性；文本用 CSS 字符串转义，可含游戏 `<color>` / `<i>` / `<size>` 富文本。完整设置可从编辑器导出的 CSS 获取。

```css
-miliastra-type: textbox;
-miliastra-text: "文本";
font-size: 20px;
color: #ffffff;
-miliastra-text-opacity: 1;
-miliastra-bg-opacity: 0;
-miliastra-auto-size: true;
-miliastra-min-font-size: 12px;
-miliastra-outline: true;
-miliastra-outline-color: #333333;
-miliastra-outline-opacity: 0.2;
text-align: left;
-miliastra-align-v: top;
```

### 四角星 / 五角星

在几何样板上增加对应的精确 `clip-path`：

```css
/* four_point_star */
clip-path: polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%);
/* five_point_star */
clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 92%, 50% 71%, 21% 92%, 32% 57%, 2% 35%, 39% 35%);
```

### 素材图片

用 `-miliastra-image: <六位素材ID>;`、`-miliastra-image-tint: false;`。开启染色时用 `background-color: #RRGGBB;` 指定乘色；浏览器预览的 `background-image` URL 可取编辑器导出结果，不要猜素材 ID 或地址。

## 导入陷阱

| 你写的 | 实际导入结果 |
|---|---|
| `clip-path` 字符串与精确模板有除连续空白外的差异 | 静默变成 rectangle |
| `rotate(45)` 漏写 `deg` | rotation = 0 |
| `width: 50%`（任何百分比） | 静默变成 `50px` |
| `background: rgba(234,88,12,0.3)` | alpha 被剥掉 → 颜色 `#ea580c` 且 `opacity: 1` |
| `background: linear-gradient(...)` / `url(...)` | 颜色解析失败 → 默认紫 `#4f46e5` |
| radial-gradient 缺 `transparent → 纯色` 首段结构 | 不识别为圆环 → 同左，静默变成矩形 |
| 基础规则 `.shaper-element {}` 里写 left/top/width/height | 基础规则本身被导入为一个幽灵图元 |
| `border-left/right/bottom` 三角形 hack | 能导入为 triangle，但 `top` 被当作包围盒**顶边**而非中心——不要用，用 clip-path |
| 图元（旋转后的包围盒）超出画布，且没写 `-miliastra-canvas-fit: lock` | **所有图元被整体平移**，构图静默错位（左/上越界）；超右/下则画布被撑大 |
| 图元超出画布，但写了 `-miliastra-canvas-fit: lock` | 画布保持不变，越界部分被裁切，不会出现在预览与导出里 |
| `::before` / `::after` / `box-shadow` / `border` / `filter` | 完全忽略 |
| `scale(...)` / `skew(...)` / `matrix(...)` / `translateX(...)` | 完全忽略（只读 `rotate(Ndeg)`） |
| 缺 `left`/`top`/`width`/`height` 任一 | 整条规则被跳过，图元丢失 |

## 验证与其他格式

服务可达时用 `POST /api/import {sourceType:"css",content:...}`，核对数量、尺寸与警告，再用 `/api/export/png {scene:...}` 检查解析后的效果。原始 CSS 预览不能代替导入验证。

完整场景（含素材库、遮罩和文本设置）用 JSON：顶层 `canvas {width,height,background}` + `elements`，元素用扁平的 `id/type/x/y/width/height/rotation`，文本设置在 `textBox`。只有 `elements` 而缺 `canvas` 时，画布会按图元包围盒自动拟合；嵌套的 `center/size` 或对象形式 `rotation` 不被识别，导入会报错，需要先拍平。Primitive Shaper 结果页的 JSON 导出已按此结构输出（`canvas` + 扁平 `elements` + `meta`，原始字段保留在 `shaper` 里），可直接导入。SVG 回导会丢失基础图元旋转、星形和圆环。

Lua 用 `export_scene {format:"lua"}` 或 `/api/export/lua` 获取，保留图片图元与素材；文本框和 `other` 仅供回导，游戏内文字用 GIA。使用前设置 `IMAGE_PREFAB_ID` 为图片控件模板索引，在专用空客户端容器的 `OnStart` 绘制。保留末尾 `MILIASTRA_EDITOR_SCENE_V1` 元数据；导入只读 `ROOT/ELEMENTS` 或 `PALETTE/ELEMENTS` 字面量，不执行代码，也不烘焙运行时缩放/偏移。Lua 绘制不应用 GIA 遮罩。
