# 千星图片编辑器

**中文** · [English](README.md) · [在线使用](https://qx.070077.xyz/)

在浏览器里用图形、游戏素材和文字拼出千星奇域 UI，再导出 GIA 或客户端 Lua 绘制脚本。支持手工编辑，也支持通过 WebMCP 让 AI 操作同一张画布。

## 三步开始

1. 打开[编辑器](https://qx.070077.xyz/)，从左侧图形库拖入或双击添加素材；已有 CSS、SVG、JSON 或支持的 Lua 可从「导入」继续编辑。
2. 在画布移动、缩放、旋转图元；右侧调整文字、颜色、图片类型和蒙版。Shift 点选或在空白处拖框可多选。
3. 「导出 → JSON」保存可继续编辑的作品；使用 GIA 或 Lua 将作品带入游戏编辑器。

**「保存并应用」会更新编辑器和已保存图元，不会保存文件。刷新或关闭页面前，请先导出作品。**

## 主要功能

- 矩形、圆形、三角形、星形、圆环拼图。
- 游戏图片素材搜索、分类、基础／拉伸、染色与图层排序。
- 可编辑文本框：富文本、字号自适应、描边和对齐。
- 多选、框选、整体移动、复制粘贴、快捷键与撤销重做。
- Lua 蒙版与羽化；虚线轮廓和半透明覆盖帮助查看被遮住的内容。
- 按准确 ID 查询元件缩略图，保存 JSON 或导出 Lua 绘制。

![蓝金渐变字示例](demo/gradient-text-preview.png)

[打开渐变字示例](demo/gradient-text.md)。需要将位图转成图元，可使用配套的[图元拟合工具](https://qx-img.070077.xyz/)。

## 如何选择导出格式

| 格式 | 用途 | 注意事项 |
|---|---|---|
| JSON | 保存作品、继续编辑 | 保留场景设置和已保存图元 |
| Lua | 在客户端 UI 中绘制原生图片与文字 | 填写真实控件模板索引，并映射、挂载脚本 |
| GIA | 导入游戏编辑器的界面素材组 | 含元件或已启用图元蒙版的作品改用 Lua |
| 容器节点 GIA | 导入为客户端控件模板，图元即其图片子控件 | 无需脚本；文本框、元件与圆形画布遮罩暂不导出 |
| CSS / SVG | 分享或使用支持的图元子集 | SVG 会省略圆环，复杂 SVG 不保证无损回导 |
| PNG | 通过 API 或 AI 工具获取渲染图 | 含元件或已启用图元蒙版时不可用 |

画布背景仅用于查看。导出需要实色底时，添加铺满画布的矩形。网页蒙版效果为近似预览，最终效果请在游戏中检查。

## 常用键盘操作

Windows/Linux 使用 `Ctrl`，macOS 使用 `⌘`。

- Shift 点选增减选择；图层列表 Shift 连选。
- 空白拖动框选；空格拖动或中键拖动平移视图。
- `Ctrl/⌘+A、C、X、V、D`：全选、复制、剪切、粘贴、创建副本。
- 方向键微调 1px，Shift+方向键为 10px；Delete 删除所选。
- `Ctrl/⌘+Z` 撤销，`Ctrl/⌘+Shift+Z` 或 `Ctrl/⌘+Y` 重做。
- 顶部「快捷键」或 `?` 查看完整键位。输入框和弹窗保留自身按键。

## WebMCP：让 AI 帮你拼图

在能发现页面 WebMCP 工具的浏览器／AI 客户端中打开编辑器，让 AI 先列出当前页面工具，再描述目标，例如：

> 保留现有作品，做一张 600×400 的标题卡：深色底、三个图片元素和居中标题。完成后导出 JSON。

工具支持素材搜索、看图、批量编辑、导入导出和撤销。它们操作当前打开的页面；本项目不提供独立 MCP 服务。没有发现工具时，检查浏览器接入是否提供 `document.modelContext.registerTool`；普通浏览器仍可手工使用。

[接入步骤与调用示例](docs/webmcp.md) · [可复用 AI 技能](skills/)

## 本地运行

准备 **Python 3.13** 和 **Node.js 20+**（含 npm），下载源码后在仓库根目录执行：

```powershell
# Windows PowerShell
.\start.bat
```

```bash
# Linux / macOS
bash start.sh
```

启动脚本安装依赖、构建前端并启动服务，访问 **http://localhost:8439**。也可直接使用 Docker，镜像构建会自动编译前端：

```bash
docker build -t miliastra-image-editor .
docker run --rm -p 8439:8439 miliastra-image-editor
```

## 更多说明

- [使用指南与文档导航](docs/README.md)
- [多选、鼠标与快捷键](docs/editor-interaction.md)
- [Lua 导出与蒙版](docs/lua-mask.md)
- [开发和部署](docs/deploy.md)
- [反馈问题](https://github.com/1475505/Miliastra-image-editor-webui/issues)

使用请遵守奇匠守则，尊重他人版权。[许可证](LICENSE)。
