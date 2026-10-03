# Prefab 元件图片与公开索引

「图形库 → 元件」输入官方元件 ID，按 Enter 或点查询，只显示一个匹配结果。名称、分类和 PNG 像素尺寸均来自索引，点击或拖动结果可加入画布。查询已集中在元件栏，顶部不再提供独立查询按钮。索引中不存在的 ID、`img: null` 的条目、非法 ID 均不构造或访问 PNG 地址。导入/收藏中的元件预览也先校验索引。

元件栏下方「已添加的元件」记录实际加入画布的元件 ID，同一 ID 去重，最近添加的排在前面。可点击或拖动再次添加，也可逐项移除或清空记录。记录保存在浏览器本地，刷新仍保留；删除画布元件和撤销不会删除记录。失败、未知 ID 或没有缩略图的条目不加入记录。记录仅存 ID 和添加时间，不随场景 JSON 或公开 R2 索引上传；缩略图仍按当前索引校验。

六位 UI 素材仍使用 `/images/` 和 `type: image / imageAssetId`；元件使用独立 `/prefabs/` 和 `type: prefab / prefabId / prefabVariable`。目录 ID、基础 ID 和 Gadget ID 不作为查询别名。预览图像素大小不是物件模型尺寸。

## Lua 绘制与脚本内配置

包含元件的场景只能使用 Lua 绘制，GIA、CSS、SVG 和 PNG 导出会明确拒绝，避免丢图；JSON 保留场景、变量名和收藏素材并可回导。元件与基础形状/六位素材可以混合编辑，Lua 按同一图层顺序创建图片控件。

「导出 → 复制Lua绘制脚本」打开当前画布的脚本弹窗，支持查看、直接复制和重新生成，不触发文件下载。

在元件属性中编辑「Lua 元件 ID 配置名称」，默认 `prefab_<ID>`。导出 Lua 会在脚本内自动定义 `PREFAB_IDS`，无需在游戏编辑器创建同名脚本参数。示意：

```lua
local PREFAB_IDS = { ["prefab_20001003"] = 20001003 }
image:SetImage(Enum.ImageSource.Prefab, PREFAB_IDS["prefab_20001003"])
```

知识库 API 将 `ClientUIImageControl.imageId` 定义为 `integer`，`SetImage(imageSource, imageId)` 通过 `Enum.ImageSource.Prefab` 指定元件图片来源。`Enum.ParamType.PrefabId` 是编辑器脚本参数的类型选项，不要求必须通过 `script:GetParam` 取得图片 ID，也没有文档支持的 Lua `PrefabId` 构造器。此前要求必须配置客户端脚本参数的说明已更正。

实际导出脚本从 `PREFAB_BINDINGS` 读取配置名称，在 `PREFAB_IDS` 中取出对应 ID。可直接修改配置表，回导时以修改后的 ID 为准；兼容回导早先只有绑定表的导出脚本。场景 JSON 保留字段名 `prefabVariable` 以兼容已有文件。`IMAGE_PREFAB_ID` 仍是创建图片控件用的**控件模板索引 ID**。

缺少或非法 ID 配置会停止绘制；创建或绘制失败会清理已创建的控件。同一个配置名称不能绑定不同元件 ID。`imageType` 有 `pcall` 兼容保护，因为知识库说明只有部分图片支持该字段。

接口依据：`E:\qxqy-lua\knowledge\guide\Lua客户端UI脚本API.md` 及原始飞书表格快照（`feishu-import/lua-client-ui-api/latest/02-all-sheets.json`）。已做离线 Lua VM 的 ID 配置、绘制顺序和生命周期校验；真实客户端显示效果尚需对应图片模板运行验证。

## 公开 JSON v2

正式约束见 [prefab-catalog.schema.json](schema/prefab-catalog.schema.json)。应用不内置生产字典，示例只说明结构：

```json
{
  "schemaVersion": 2,
  "dataVersion": "7.1.0",
  "categoryLabelSource": "curated",
  "rendering": {"formats": ["lua"], "imageSource": "Prefab", "idVariableType": "PrefabId"},
  "imageData": {
    "20001003": {
      "id": 20001003,
      "img": "sprite/20001003.png",
      "width": 256,
      "height": 256,
      "names": {"zh-CN": "竹子", "en-US": "Bamboo"},
      "entityType": "Gadget",
      "categoryIds": [120201]
    }
  },
  "category": {"120201": {"id": 120201, "images": [20001003]}}
}
```

`img/width/height` 同时为 `null` 表示没有缩略图；不猜测路径。`category` 保留真实分类 ID、多分类归属和成员集合，分类显示名独立存于 `i18n/zh-cn.json`、`i18n/en-us.json`，格式 `Record<分类ID, 名称>`。显示名是人工整理的标签，未冒充官方分类名称。

`rendering.idVariableType: "PrefabId"` 标记索引中的 ID 属于元件 ID；它不声明 Lua 运行时对象或要求使用客户端脚本参数。Lua 图片控件仍按 API 的整数 `imageId` 和 `ImageSource.Prefab` 绘制。

公开载荷仅保留上述字段。移除提取源路径、本机路径、内部表字段名、仓库/commit/build、listIds、baseId、gadgetId、jsonName 和 descriptions。正式 Schema 禁止额外字段；ID 字典键须与条目 `id` 一致，图片路径须为对应 `sprite/<ID>.png`，分类正反关系由加工脚本核对。

后端兼容旧版 v1 索引，但计划发布使用 v2；v2 API 仅透传公开字段，不透传上游附带的内部关联信息。

## 本机审查文件与未来 R2 上传

加工脚本 `D:\Codes\AnimeGameData\derived\prepare_prefab_public.py` 从已校验的原始元件导出包生成以下**待审查**文件，尚未上传：

```text
F:\gi-object-thumbnails\prefabs-review\
  data.schema.json                  正式 JSON Schema
  data.example.json                 三条实际样例（含缺图条目）
  data.json                         完整公开候选索引
  i18n\zh-cn.json
  i18n\en-us.json
  REVIEW.txt                        公开字段与已删除字段说明
  upload-manifest.private.json      私有上传计划，包含本机路径
```

PNG 仍存于 `F:\gi-object-thumbnails\prefabs\sprite`。审查通过后，仅上传候选 `data.json`、两个 i18n JSON 和原 `sprite/` PNG，R2 key 保留 `prefabs/` 前缀。`upload-manifest.private.json`、原始索引、缺图报告和提取日志不发布；凭证不写入任何公开文件。内容类型分别为 `application/json; charset=utf-8` 和 `image/png`。

发布完成再清理 CDN 缓存，界面点击“刷新”获取新索引。生产数据与图片只在 OSS 维护，不打包进本项目。

## API、缓存与本地预览

- `GET /api/prefabs/catalog`：合并索引及中英分类名，首次 ID 查询或已有场景元件预览时按需读取。
- `GET /api/prefabs/{prefab_id}`：单条信息，非法 ID 为 400、未知为 404、上游不可用为 502。
- WebMCP `get_prefab_info({id})` 精确查一条；`add_element(s)` 使用 `type: "prefab"`、`prefabId` 和可选 `prefabVariable`，添加/更换 ID 前核验索引，批量失败不修改画布。

后端无状态、不落盘。三份上游 ETag 合并为缓存版本，分类名称变更也失效；分类翻译缺失仍显示 ID。浏览器缓存 12 小时，刷新跳过缓存，断网仅可使用此前已有索引并标注提示。

`MILIASTRA_PREFAB_OSS_BASE` 默认 `https://oss.070077.xyz/prefabs`，可配置测试根地址。浏览器从后端读取 JSON，仅匹配成功的图片直连该地址；不提供本地生产字典兜底。
