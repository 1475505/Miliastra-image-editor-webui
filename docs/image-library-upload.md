# 图片描述与用途索引：R2 上传和接入

`docs/desc.json` 保存各图片的简洁描述和精细用途代码；`docs/category.json` 保存用途分组、中文名称、同义词，以及供界面筛选的 40 个中间用途分类。两份文件通过 `assetID` 补充现有 `data.json`。

本次用途分类更新只需覆盖上传 `docs/category.json`，`desc.json` 没有变化。首次接入时再按下面步骤上传两份文件。

## 上传到现有 R2 桶

1. 打开 Cloudflare 控制台，进入 **R2 Object Storage**，选择当前提供图片素材的桶。
2. 找到现有 `data.json` 所在的目录，进入同一目录，点击 **Upload**。
3. 从本项目 `docs/` 上传 `desc.json` 和 `category.json`，保留原文件名。若现有对象键为 `images/data.json`，新增对象键就是 `images/desc.json` 与 `images/category.json`。
4. 确认下面两个地址返回 JSON：
   - [图片描述](https://oss.070077.xyz/images/desc.json)
   - [用途字典](https://oss.070077.xyz/images/category.json)

上传入口与文件选择方式见 [Cloudflare 官方上传文档](https://developers.cloudflare.com/r2/objects/upload-objects/)。使用现有桶及域名的读取方式即可。项目通过后端请求 JSON，不需要为这一接入额外配置浏览器 CORS。

若使用 Wrangler 管理桶，可在已登录 Cloudflare 的 PowerShell 中，从仓库根目录执行（将 `YOUR_BUCKET` 改成桶名；路径前缀以现有 `data.json` 为准）：

```powershell
npx wrangler r2 object put "YOUR_BUCKET/images/desc.json" --file="docs/desc.json" --content-type="application/json; charset=utf-8" --cache-control="public, max-age=300" --remote
npx wrangler r2 object put "YOUR_BUCKET/images/category.json" --file="docs/category.json" --content-type="application/json; charset=utf-8" --cache-control="public, max-age=300" --remote
```

后续更新只需重新上传有变化的对象。若自定义域名配置了 CDN 缓存，更新后清除对应 URL 的缓存，再在编辑器图形分类旁点击“刷新”。本次只需上传 `category.json` 并清除其 URL 缓存。

## 项目接入

已接入的链路：

```text
R2: data.json + i18n/zh-cn.json + i18n/en-us.json
                  + desc.json + category.json
    → GET /api/library/catalog
    → 前端通过 assetID 合并描述、用途与原有图片分类
    → 图形库搜索 / 用途筛选 / WebMCP 查询
```

后端把五个上游文件的 ETag 合并为整体索引版本，描述或用途字典变化会使整体索引失效。浏览器缓存保留描述与用途。两份补充文件缺失、格式错误或暂时不可访问时，基础素材库仍可浏览；没有图片路径的条目仍隐藏。

“用途”保持独立筛选栏，与“图形分类”、色态和文字搜索交叉筛选。界面提供 40 个中间用途分类，原来的 8 个用途分组只作为不可选择的段标题；129 个精细用途继续用于文字搜索、素材详情和 AI 精确查询。

`category.json` 的 `filters` 字段把中间分类映射到精细用途，结构为 `Record<string, { group, label, keywords, uses: string[] }>`。例如 `purpose.avatar` 可包含 `avatar.background` 和 `avatar.frame`；选中时匹配任一精细用途，同一素材只计数一次。前端构建同时打包这 40 个分类作为兜底，因此 OSS 仍是旧版字典时，本地新版界面也能使用中间分类；上传后，后端索引会读取 OSS 的 `filters`。

本地运行新版项目时，在 `frontend/` 执行 `npm run build`，重启后端；线上则按 [现有部署流程](deploy.md) 发布新版镜像。上传 JSON 后，在图形库选择“全部素材”，搜索“头像框”“按钮底板”或“分隔线”，选中素材可查看描述和用途。

AI 可通过 WebMCP 使用：

```js
list_asset_categories({ query: "图标" })
list_asset_uses({ category: "icons", tone: "mono" })
search_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 20 })
preview_assets({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜", limit: 48, output: "image" })
prepare_asset_pack({ category: "icons", use: "purpose.search_settings", tone: "mono", query: "放大镜" })
list_asset_uses({ query: "头像", includeFine: true })
search_assets({ use: "头像与徽章底框", limit: 10 })
search_assets({ use: "button.background", tone: "color", limit: 10 })
search_assets({ use: "group:content", limit: 10 })
search_assets({ query: "头像框", refresh: true })
```

先用 `list_asset_categories` 发现原有图形分类的 `key/label/count/tones`；`icons` 汇总所有图标。再把 `category` 和可选的 `tone` 传给 `list_asset_uses`，只查询该范围内有素材的中间用途及数量，避免逐项浏览全库。

`list_asset_uses` 返回中间用途 `filters` 数组，每项含 `code/group/label/keywords/uses/count`。默认不返回 129 个精细用途，`includeFine:true` 时返回 `uses`；`includeEmpty:true` 可保留空用途。`query/group/refresh` 用于缩小发现范围或更新索引。

`search_assets` 的 `use` 参数接受中间用途代码（如 `purpose.avatar`）、精细用途代码（如 `avatar.frame`）或用途分组（如 `group:content`）。`category/use` 也接受完整中文名称；完整用途名称优先匹配中间分类，精细筛选用明确代码。未知名称或同一层中重名会报错，不能把不认识的名称静默当作“全部素材”。关键词按空格分隔并且必须全部命中。

返回的 `id` 可作为 `add_elements` 的 `imageAssetId`；`imageUrl` 可用于查看素材。`category` 参数继续使用原有图形分类代码，可与用途、色态交叉筛选。搜索与查询不会修改画布。

## 看图与下载素材包

`preview_assets` 接受 ID 列表或与搜索相同的分类、用途、关键词条件，返回带 ID 的 PNG 总览，每页最多 48 张，透明区域显示棋盘格。`output:"image"` 用于支持图片内容的客户端；默认 `dataUrl` 用于其他客户端。先看候选图，再决定拼接，描述不代替实际外观。

```js
preview_assets({ ids: [100006, 100001], output: "image" })
prepare_asset_pack({ ids: [100006, 100001] })
prepare_asset_pack({ category: "icons", use: "purpose.actions" })
prepare_asset_pack({ all: true })
```

`prepare_asset_pack` 返回数量和 POST `request`；短 ID 列表及全量模式同时提供 `downloadUrl`，较长列表使用 POST。准备调用只生成下载参数，不修改画布或执行下载。全量模式包含全部有图片路径的素材；先筛候选只是减少下载量的选项。

服务端 `GET/POST /api/library/assets.zip` 下载 ZIP；POST 请求为 `{ids:[...]}` 或 `{all:true}`，两者互斥。ZIP 包含原图 `images/{id}.png`、`manifest.json` 和每页最多 48 张、带素材 ID 的 `contact-sheets/001.png` 等总览。清单的 `assets` 每项记录 `id/path/imageUrl/description/uses/categoryIds/width/height/status/error/contactSheet`，`contactSheet` 含 `path/index`；`counts` 记录 `requested/ok/failed`。某张图下载失败时，清单仍保留对应 ID 和错误，其他成功素材仍可用。单独的 `GET/POST /api/library/contact-sheet` 返回总览 PNG，POST 为 `{ids:[...]}`，最多 48 个 ID。

将 `prepare_asset_pack` 返回的 `request` 或完整结果保存成 `asset-request.json`，从仓库根目录运行标准库脚本下载并安全解压：

```powershell
python skills/miliastra-image-asset-selector/scripts/download_asset_pack.py --request asset-request.json --output tmp/asset-pack
python skills/miliastra-image-asset-selector/scripts/download_asset_pack.py --base-url http://127.0.0.1:8439 --ids 100006 100001 --output tmp/selected-assets
python skills/miliastra-image-asset-selector/scripts/download_asset_pack.py --base-url http://127.0.0.1:8439 --all --output tmp/all-assets
```

脚本检查 ZIP 路径并报告清单中的失败项；存在下载失败时返回非零退出码。可先打开 `contact-sheets/` 中的带 ID 总览，再按 ID 查看 `images/` 中的原图。完整选型与拼接流程见 [素材选择技能](../skills/miliastra-image-asset-selector/SKILL.md)。
