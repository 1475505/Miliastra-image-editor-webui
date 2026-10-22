# 元件图片与索引

[返回使用指南](README.md)

## 查询并添加元件

打开「图形库 → 元件」，输入准确的官方元件 ID，按 Enter 或点击查询。点击／拖动结果加入画布；结果显示名称、分类、缩略图和图片像素尺寸，像素尺寸不是模型尺寸。

未知 ID 或没有缩略图的条目不能添加。不要用目录 ID、Gadget ID 或六位 UI 图片 ID 替代元件 ID。

「已添加的元件」在当前浏览器保留去重后的使用历史，方便再次加入；删除画布图元或撤销不会删除该历史，可单独移除或清空。

## 导出

含元件的作品可以保存 JSON，绘制使用 Lua；GIA/CSS/SVG/PNG 不支持该类作品。元件属性中的 `prefabVariable` 是脚本内 `PREFAB_IDS` 表的配置名称，默认 `prefab_<ID>`，无需另建客户端脚本参数。

图片控件模板索引 `IMAGE_PREFAB_ID` 仍须填写。详细挂载步骤见 [Lua 使用](lua-mask.md#使用导出的-lua)。

## 自建索引

默认服务为 `https://oss.070077.xyz/prefabs`，通过 `MILIASTRA_PREFAB_OSS_BASE` 修改。公开目录包括：

```text
prefabs/data.json
prefabs/i18n/zh-cn.json
prefabs/i18n/en-us.json
prefabs/sprite/<ID>.png
```

索引结构以 [JSON Schema](schema/prefab-catalog.schema.json) 为准。v2 条目包含准确 ID、图片相对路径、宽高、名称、实体类型和分类成员。没有图片时 `img/width/height` 同时为 `null`；图片路径须匹配 `sprite/<ID>.png`。分类名由单独的语言文件提供，缺少时显示 ID。

`rendering.idVariableType: "PrefabId"` 是索引中的 ID 类别说明，不代表必须创建客户端参数。前端添加使用 `type:"prefab"`、`prefabId`；后端兼容旧 v1 索引，新索引按 v2 发布。

上传公开索引、语言文件与图片后清理 CDN 缓存，并在界面刷新。生产目录独立维护，不提交本机提取路径、私有上传计划或凭证。浏览器只有匹配到索引中的图片才请求 PNG。

AI 接口：`get_prefab_info({"id":...})`；HTTP 接口：`GET /api/prefabs/catalog` 与 `GET /api/prefabs/<ID>`。完整接入见 [WebMCP](webmcp.md)。
