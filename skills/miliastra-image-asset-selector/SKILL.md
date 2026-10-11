---
name: miliastra-image-asset-selector
description: 为千星图片编辑器的 UI 拼接寻找现有素材，按分类、用途和关键词检索，比较基础图与拉伸预览，按 ID 查询元件，并通过 WebMCP 拼接或下载带 ID 总览的图片包。适用于素材选型与组合，不用于生成新图片。
---

# 千星图片素材选择与拼接

从编辑器现有素材中选出适合目标 UI 的图片，查看实际外观后再拼接。素材 ID、图片地址和分类以当前素材库返回值为准；描述帮助检索，不能代替看图。

## 发现与筛选

先发现页面实际提供的 WebMCP 工具，按返回的 schema 调用。下面的检索、预览和打包工具都不修改画布。

1. 用 `list_asset_categories({query?,tone?,refresh?})` 找原有图形分类，返回 `key/label/count/tones`。`icons` 是“图标”汇总分类，不必逐个查图标子类。
2. 在选定分类内调用 `list_asset_uses({category,tone?,query?,group?})`，查看有素材的 40 个中间用途及数量。默认不返回 129 个精细用途；确需细分时加 `includeFine:true`，需要空分类时加 `includeEmpty:true`。
3. 用 `search_assets({category,use?,tone?,query?,offset?,limit?})` 加入用途和外观关键词。分类与用途都接受明确代码或完整中文名称；不要把部分名称当作分类。完整用途名称优先匹配 40 个中间分类，精细筛选用明确代码；未知名称或同一层内重名时从发现结果选明确代码。空格分隔的关键词必须全部命中。
4. 搜索结果的 `imageUrl` 是原图，`previewUrl/previewImageType` 是图形库默认缩略图；仅已登记的 ID 返回 `stretchPreviewUrl`。需要拉伸能力、边界及默认尺寸时用 `get_asset_info({id,imageType?,refresh?})`，`imageType` 可选 `basic` / `stretch`，默认按素材能力选择。预览索引不等于能力声明，能力由 `metadata.border` 判定。
5. 用 `preview_assets({ids:[...] ,output:"image"})` 比较基础原图，或直接传上述筛选条件。每页最多 48 张，PNG 总览标注 ID，棋盘格用于看透明边缘；该总览使用原图，拉伸外观应查看查询返回的 `stretchPreviewUrl`。预览未登记或图片加载失败时用 `imageUrl`，不猜拉伸 URL。`failedIds` 表示下载失败的占位格，必要时只重试这些 ID。

例如先发现“图标”类，再看该范围内的用途，最后查单色放大镜：

```js
list_asset_categories({ query: "图标" })
list_asset_uses({ category: "icons", tone: "mono" })
search_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 20 })
preview_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 48, output: "image" })
prepare_asset_pack({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜" })
get_asset_info({ id: 106020 })
get_asset_info({ id: 106020, imageType: "basic" })
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
- `imageType:"basic"` 按目标尺寸缩放整张原图，`"stretch"` 按边界做三切片或九切片。任一边界大于零时支持并默认拉伸；全零或缺失时只支持基础，工具会将不支持的拉伸请求转为基础。切换类型或修改素材 ID 不改变已有图元尺寸。
- 新增时省略尺寸与图形库一致：横向有切片边界时宽 136，纵向有切片边界时高 96，未切片方向保留原始厚度；无元数据回退 96。需要确定构图时显式填宽高，工具保留指定值。原始尺寸下两种模式可能相同，例如 106020 的 60×60；新增默认 136×96 可以看出拉伸效果。
- 画布与导出使用原图和边界；不要把固定预览 PNG 当作绘制贴图。文本用 `type:"textbox"`，不要把素材中的文字当作可编辑文字。
- 用 `get_canvas_preview({output:"image"})` 检查拼接后的比例、层序、透明边缘和文字可读性。保留所选素材 ID，方便后续调整。

交付 CSS、SVG 或 JSON 文件时仍使用查询所得 ID 和 URL。文件导入的支持范围取决于编辑器格式；素材筛选流程不会扩展导入器能力。

拉伸素材的 CSS/SVG 导出会内嵌当前尺寸下的切片结果，并保留素材 ID、类型和颜色供回导；直接修改导出位图的宽高只会缩放位图。JSON 保留 `imageType`，Lua 设置对应图片类型。细节见 [图片类型与导出](../../docs/image-stretch.md)。

## 元件 ID

元件使用独立索引：用 `get_prefab_info({id})` 查询单个官方元件 ID，返回名称、分类、缩略图及像素尺寸；不列出整个元件库。未列入 JSON 的 ID 不请求图片，无缩略图的条目不能添加。

添加用 `type:"prefab"`、`prefabId`，`prefabVariable` 是 Lua `PREFAB_IDS` 配置表中的名称。元件不使用六位 `imageAssetId` 或 `basic/stretch` 类型；含元件的场景可保存 JSON，绘制仅支持 Lua。ID 直接在脚本内的 `PREFAB_IDS` 表定义，用 `Enum.ImageSource.Prefab` 绘制，无需客户端脚本参数。`IMAGE_PREFAB_ID` 仍是创建图片控件的模板索引，不能拿素材 ID 或元件 ID 替代。
