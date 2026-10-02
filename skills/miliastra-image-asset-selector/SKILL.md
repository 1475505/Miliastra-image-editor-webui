---
name: miliastra-image-asset-selector
description: 为千星图片编辑器的 UI 拼接寻找现有图片素材，按图形分类、用途和关键词检索，看图挑选，并通过 WebMCP 批量拼接或下载带 ID 总览的素材包。适用于素材选型与组合，不用于生成新图片。
---

# 千星图片素材选择与拼接

从编辑器现有素材中选出适合目标 UI 的图片，查看实际外观后再拼接。素材 ID、图片地址和分类以当前素材库返回值为准；描述帮助检索，不能代替看图。

## 发现与筛选

先发现页面实际提供的 WebMCP 工具，按返回的 schema 调用。下面的检索、预览和打包工具都不修改画布。

1. 用 `list_asset_categories({query?,tone?,refresh?})` 找原有图形分类，返回 `key/label/count/tones`。`icons` 是“图标”汇总分类，不必逐个查图标子类。
2. 在选定分类内调用 `list_asset_uses({category,tone?,query?,group?})`，查看有素材的 40 个中间用途及数量。默认不返回 129 个精细用途；确需细分时加 `includeFine:true`，需要空分类时加 `includeEmpty:true`。
3. 用 `search_assets({category,use?,tone?,query?,offset?,limit?})` 加入用途和外观关键词。分类与用途都接受明确代码或完整中文名称；不要把部分名称当作分类。完整用途名称优先匹配 40 个中间分类，精细筛选用明确代码；未知名称或同一层内重名时从发现结果选明确代码。空格分隔的关键词必须全部命中。
4. 用 `preview_assets({ids:[...] ,output:"image"})` 看候选图，或直接传上述筛选条件。每页最多 48 张，PNG 总览标注素材 ID，棋盘格用于看透明边缘。`failedIds` 表示下载失败的占位格，必要时只重试这些 ID。根据轮廓、留白、宽高比和视觉风格选择；必要时查看原图。

例如先发现“图标”类，再看该范围内的用途，最后查单色放大镜：

```js
list_asset_categories({ query: "图标" })
list_asset_uses({ category: "icons", tone: "mono" })
search_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 20 })
preview_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 48, output: "image" })
prepare_asset_pack({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜" })
```

`use` 也接受精细用途，如 `avatar.frame`，以及 `group:content`。搜索无结果时逐步放宽用途或关键词，并保留用户指定的视觉要求。分页查看候选通常更快；用户需要全库时可下载全部有图片的素材。

## 下载并在本地看图

`prepare_asset_pack({ids:[...]})` 或 `prepare_asset_pack({category?,use?,tone?,query?})` 返回 `request`，短 ID 列表及全量模式还返回 `downloadUrl`；较长列表用 POST 请求。`prepare_asset_pack({all:true})` 准备全库，不限制为候选子集。打包与下载分开，准备工具本身不会下载图片。

把返回的 `request` 或完整返回结果保存成 JSON，运行本技能的 [下载脚本](scripts/download_asset_pack.py)：

```text
python <本技能目录>/scripts/download_asset_pack.py --request asset-request.json --output asset-pack
python <本技能目录>/scripts/download_asset_pack.py --base-url http://127.0.0.1:8439 --ids 100006 100001 --output asset-pack
python <本技能目录>/scripts/download_asset_pack.py --base-url http://127.0.0.1:8439 --all --output all-assets
```

脚本只需 Python 标准库，POST 下载 ZIP 并检查路径后解压。输出包含 `images/{id}.png`、`manifest.json` 和每页最多 48 张的 `contact-sheets/*.png`。清单记录原图地址、描述、用途、分类、原始尺寸、下载状态及总览位置。先看带 ID 的总览，再按 ID 打开原图。失败项保留在清单中，脚本报告失败并返回非零退出码；不要将下载失败误判为素材不存在。

没有 WebMCP 时，已知 ID 可直接用脚本；服务端接口为 `POST /api/library/assets.zip`，请求 `{ids:[...]}` 或 `{all:true}`，两者互斥。总览接口 `POST /api/library/contact-sheet` 接受 `{ids:[...]}`，最多 48 个 ID。

## 批量拼接与检查

编辑当前画布前用 `get_scene({summary:true})` 了解尺寸，需定位已有图层时用 `list_elements`。根据用户要求添加或修改；整体替换画布才使用 `set_elements`。

- 用 `add_elements` 批量添加选中的素材，`type:"image"`、`imageAssetId` 取已核对的 ID。`x/y` 是中心，`rotation` 逆时针为正，`zIndex` 越大越靠上。
- 保留原图颜色时设 `imageTint:false`、`opacity:1`。需要染色时设 `imageTint:true` 与目标 `color`；单色标记仅说明素材色态。
- 根据原始宽高比安排尺寸，只有构图需要时才拉伸。文本用 `type:"textbox"`，不要把素材中的文字当作可编辑文字。
- 用 `get_canvas_preview({output:"image"})` 检查拼接后的比例、层序、透明边缘和文字可读性。保留所选素材 ID，方便后续调整。

交付 CSS、SVG 或 JSON 文件时仍使用查询所得 ID 和 URL。文件导入的支持范围取决于编辑器格式；素材筛选流程不会扩展导入器能力。
