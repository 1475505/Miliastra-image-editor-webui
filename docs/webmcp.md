# WebMCP / AI 接入

[使用指南](README.md) · [English overview](../README.md#use-with-ai--webmcp)

## 连接当前页面

1. 在支持页面 WebMCP 的浏览器／AI 集成中打开[在线编辑器](https://qx.070077.xyz/)或本地 `http://localhost:8439/`。
2. 让 AI 列出当前标签页提供的工具，确认能看到 `get_scene`、`search_assets`、`add_elements` 等。
3. 描述想做的画面、尺寸、是否保留已有内容和交付格式。AI 与你的手工操作共用当前画布及撤销历史。

页面使用 `document.modelContext.registerTool` 注册工具。仅安装通用 MCP 客户端不一定能发现它：浏览器集成需要提供这个接口并转发页面工具。本项目没有需要配置 `command` 或独立端口的 MCP 服务。

If tools are missing, check the browser integration, reload the editor after enabling it, and list the tools again. The editor still works manually without WebMCP. Tool calls below show **tool name + JSON arguments**; they are not browser-console globals.

## 建议工作流

1. `get_scene({"summary":true})` 查看当前画布；用 `list_elements` 定位已有图元。
2. 找素材：`list_asset_categories` → `list_asset_uses` / `search_assets` → `get_asset_info` / `preview_assets`。按返回 ID 使用素材。
3. 优先用 `add_elements` / `update_elements` / `remove_elements` 批量编辑，每批只产生一步撤销。
4. 检查画面。普通作品可用 `get_canvas_preview`；含元件或启用蒙版的作品请查看网页画布截图，该工具的 PNG 出口不支持这些效果。
5. `export_scene({"format":"json"})` 保存；需要游戏脚本时导出 Lua。

示例：调用 `add_elements`，参数如下：

```json
{
  "elements": [
    {"id":"panel","type":"rectangle","x":150,"y":150,"width":260,"height":180,"color":"#203b35","opacity":1},
    {"id":"title","type":"textbox","x":150,"y":130,"width":200,"height":50,"text":"星间来信","fontSize":32,"color":"#ffffff","opacity":1}
  ],
  "select": true
}
```

`x/y` 是画布左上坐标系中的图元中心，X 向右、Y 向下；`rotation` 逆时针为正。`zIndex` 越大越靠上。明确填写尺寸、颜色和透明度可避免图形库预设影响结果。

## 工具分组

| 用途 | 工具 |
|---|---|
| 查看场景 | `get_scene`、`list_elements`、`get_canvas_preview` |
| 素材发现 | `list_asset_categories`、`list_asset_uses`、`search_assets`、`get_asset_info` |
| 看图与素材包 | `preview_assets`、`prepare_asset_pack` |
| 元件查询 | `get_prefab_info` |
| 编辑 | `add_element(s)`、`update_element(s)`、`remove_element(s)`、`set_elements` |
| 画布与选择 | `set_canvas`、`set_selection`、`clear_canvas` |
| 导入导出 | `import_source`、`export_scene` |
| 历史 | `undo`、`redo` |

上表括号表示单项／批量工具，如 `add_element` 和 `add_elements`；实际参数以页面返回的 schema 为准。

## 使用注意

- `set_elements` 替换全部图元；`import_source` 替换整个场景。只想局部调整时用 update。
- 图片用 `type:"image"` + `imageAssetId`；元件用 `type:"prefab"` + `prefabId`。它们都不是 Lua 的控件模板索引。
- 图片类型、三轴旋转和 `luaMask` 可通过新增／更新工具配置。蒙版字段部分更新会合并；`luaMask:null` 清除设置。
- `get_canvas_preview` 默认返回 data URL；支持图片内容的客户端可传 `output:"image"`。预览不含选择框。
- `preview_assets` 使用原图总览，最多 48 张；拉伸缩略图可从 `get_asset_info` 获取。`prepare_asset_pack` 仅返回下载请求，需再发起下载。
- `set_selection` 目前选择单个图元；批量编辑用 ID 列表，不依赖手工多选状态。
- 导出文本可选 `json/css/svg/lua`。GIA 用页面导出按钮或 HTTP API。保存、复制前读取最新场景，工具失败后先确认状态，避免重复添加。

## 可选技能

根据 AI 客户端的技能安装方式，加载仓库中的 [素材选择](../skills/miliastra-image-asset-selector/SKILL.md)、[CSS 生成](../skills/miliastra-image-css-builder/SKILL.md)或 [SVG 生成](../skills/miliastra-image-svg-builder/SKILL.md)。技能提供操作与格式约束；浏览器 WebMCP 接入仍需单独可用。
