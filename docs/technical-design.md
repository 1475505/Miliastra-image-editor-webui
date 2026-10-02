# Miliastra Image Editor WebUI 技术设计

## 1. 目标

这是一个“在线图元编辑 + 多格式互转 + GIA 导出”的单页 Web 工具。

### Lua 绘制与回导

- `POST /api/export/lua` 生成千星客户端图片绘制脚本。链路：规范化场景 → 本项目 GIA 编码器 → 拟合工具的 `gia_lua.parse_material_gia` / `build_gia_lua`；使用同一份 ROOT/ELEMENTS 布局及运行时。空画布使用同项目 `lua_export.build_lua_export_text`。
- 上游 `lua_export.py`、`gia_lua.py` 原样收录在 `backend/vendor/primitive_shape/`，无本机目录运行依赖。来源、MIT 许可、SHA-256 见该目录 `PROVENANCE.md`；复制时源文件尚未提交，故没有来源 commit。
- `POST /api/import` 的 `sourceType: "lua"` 同时接受拟合工具的 PALETTE/ELEMENTS（8 字段）和 GIA 转 Lua 的 ROOT/ELEMENTS（18 字段）。只读取字面量数据，不执行脚本或运行时函数。支持旧版负 Y 坐标、三角形质心、图片锚点、轴心与镜像；不导入自定义图片资产或任意游戏逻辑。
- 导入恢复原始绘图坐标；模板索引、BASE_SCALE、OFFSET、FIT_TO_CANVAS 等运行设置不应用于画布。组级缩放/旋转也不烘焙，导入时给出提示。
- 脚本末尾的 `MILIASTRA_EDITOR_SCENE_V1` 注释保存 Base64 JSON 元数据及绘图数据摘要。数据区未改动时完整恢复规范化场景（图元 ID / 名称、文字、素材库等）；若数据区被修改则重新解析当前记录，并提示编辑快照未使用。填写模板索引不影响回导。
- 游戏绘制支持六种基础图片图元。文本框和 other 仅保留在编辑快照中，界面及脚本明确提示；游戏内文字使用 GIA。Lua 中不继承 GIA 基础模板遮罩，与编辑器画布可溢出显示一致。
- 使用：建立“仅存为模板”的客户端图片控件，将模板索引填入 IMAGE_PREFAB_ID，把脚本挂到专用空客户端容器节点，在 OnStart 绘制。OnDestroy 清理，重复启动先清理再创建。
- 文件限制为 10 MiB，字面量表深度为 64。拒绝数据区函数调用、重复声明、无效调色板/图片引用、非有限数值、损坏的元数据；上传的运行时代码从不执行。
- 测试：在 `backend/` 运行 `python -m unittest discover -s tests -v`；上游固定样本覆盖填充、轮廓、单模板与 GIA 布局。Lua VM 验收可运行 `node backend/tests/check_gia_lua.cjs <fengari模块路径> <导出.lua> <预期记录.json>`。VM 通过不代表真机容量或显示已验证。

界面采用 M3 风格的柔和青绿色表面与圆角控件；开局引导为可关闭的单页快速上手，继续沿用已有的“不再自动展示”记录。顶栏和导入面板提供[图元拟合工具](https://qx-img.070077.xyz/)入口。

用户可以：
- 在左侧 `基础模板` 中粘贴或上传 `CSS / JSON / SVG`
- 在左侧 `图片库` 中选择分类并把基础图形拖入画布
- 在中间画布中移动、缩放、旋转图元
- 在右侧详情区查看和编辑图元属性
- 在下方保存并导出 `GIA / CSS / SVG / JSON`

整体目标是用一份统一的场景模型，打通导入、编辑、预览、导出与 GIA 转换。

## 2. 部署策略

采用“前后端一体部署、尽量少组件”的方案：

- 前端：`React + TypeScript + Vite`
- 后端：`FastAPI`
- 生产环境由同一个 `FastAPI` 服务同时提供：
  - `/`
  - `/api/*`
  - 前端静态构建产物

这样做的原因：
- GIA 导出天然依赖 Python
- 避免额外维护独立 Node 服务
- 同域提供页面和 API，部署最简单

## 3. 页面结构

页面采用单页三栏加底部固定操作区布局：

### 左侧
- `基础模板 / 图片库` Tab

`基础模板`：
- 格式下拉框
- 上传入口
- 文本输入框
- `导入到画布` 按钮

`图片库`：
- 分类下拉框，默认 `基础形状`
- 基础形状卡片区
- 已保存图元区

### 中间
- 画布主区域
- 视图缩放滑块与 `+ / -`
- 画布宽高输入框
- “等比”勾选

### 右侧
- 选中图元时显示层级与属性编辑
- 未选中图元时显示当前图元列表

### 下方
- `保存并应用`
- 下载 `GIA / CSS / SVG / JSON`
- 折叠式 `JSON / CSS / SVG` 浏览区

## 4. 数据模型

核心模型：

```ts
type SceneDocument = {
  canvas: {
    width: number;
    height: number;
    background: string;
  };
  elements: SceneElement[];
  meta: {
    sourceType: "json" | "css" | "svg" | "editor";
    warnings: string[];
  };
  library: SceneLibrary;
};
```

图元模型：

```ts
type SceneElement = {
  id: string;
  type: "ellipse" | "rectangle" | "triangle" | "four_point_star" | "five_point_star" | "ring" | "textbox" | "other";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  opacity: number;
  zIndex: number;
  isBackground: boolean;
  textBox?: {
    text: string;
    fontSize: number;
    autoSize: boolean;
    minFontSize: number;
    textColor: string;
    textOpacity: number;
    bgColor: string;
    bgOpacity: number;
    outlineEnabled: boolean;
    outlineColor: string;
    outlineOpacity: number;
    alignH: "left" | "center" | "right";
    alignV: "top" | "middle" | "bottom";
    anchorType: "center" | "custom";
    visible: boolean;
    scaleX: number;
    scaleY: number;
    anchorMinX: number;
    anchorMinY: number;
    anchorMaxX: number;
    anchorMaxY: number;
    pivotX: number;
    pivotY: number;
  };
};
```

图片库模型：

```ts
type SceneLibrary = {
  activeCategory: string;
  categories: LibraryCategory[];
  baseShapePresets: LibraryBaseShapePreset[];
  savedItems: SavedLibraryItem[];
};
```

其中：
- `categories` 预留所有分类接口
- `baseShapePresets` 保存基础图形默认颜色与尺寸
- `savedItems` 保存“保存并应用”后的图元快照

## 5. 导入设计

### JSON
- 优先支持完整 `SceneDocument`
- 兼容简化格式
- 如果缺少 `canvas`，后端根据图元外接范围自动拟合画布

### CSS
- 兼容 `Primitive Shaper` 风格输出
- 优先读取 `.shaper-container` 的宽高作为画布；缺失时根据图元范围自动拟合
- 忽略 `.shaper-container` 的背景颜色；如需视觉背景，使用铺满画布的矩形图元
- 读取任意具备 `left / top / width / height` 的规则作为候选图元，不依赖固定类名
- 映射：
  - `left/top -> x/y`
  - `width/height -> width/height`
  - `background / background-color -> color`
  - `opacity -> opacity`
  - `rotate(...) -> rotation`
  - `z-index -> zIndex`
- `border-radius: 50% -> ellipse`
- `background: radial-gradient(closest-side, transparent 79.5%, <color> 80.5%, transparent 100%) -> ring`（内径:外径 = 0.8，颜色从第二段 stop 提取；尾部 transparent 使环外四角透明）
- `-miliastra-type: textbox` 或 `-miliastra-text` / `content` -> `textbox`
- 若存在 `.shaper-container`，先读取其原始宽高作为初始画布
- 如果图元超出容器，则自动扩展画布；如果图元坐标为负，还会整体平移到可见区域
- 同时写入 warning，提醒用户当前已为越界图元自动调整画布

### CSS 到渲染流程
1. 前端在左侧 `基础模板` 中接收用户粘贴或上传的 CSS 文本。
2. 用户点击“导入到画布”后，前端通过 `POST /api/import` 把 `{ sourceType: "css", content }` 发给后端。
3. 后端 `parse_css_scene()` 优先读取 `.shaper-container` 的 `width / height` 建立画布尺寸；如果缺失，则在解析完图元后根据外接范围自动拟合画布。容器背景颜色会被忽略。
4. 后端逐个解析 `.shaper-element.shaper-eN`，提取：
   - `left / top`
   - `width / height`
   - `background-color`
   - `opacity`
   - `transform` 中的 `rotate(...)`
   - `z-index`
   - `border-radius: 50%`
5. 后端把这些值映射为统一的 `SceneElement`：
   - `left / top -> x / y`
   - `rotate -> rotation`
   - `border-radius: 50% -> ellipse`
   - 其他基础块 -> rectangle
6. 如果存在 `.shaper-container`，后端会检查图元是否超出容器；如果超出，会自动扩展画布并追加 warning。若不存在 `.shaper-container`，则直接按图元范围自动拟合画布。
7. 后端返回标准化后的 `SceneDocument` 给前端。
8. 前端执行 `ensureSceneLibrary()`，补齐 `library` 相关字段，再写入当前页面状态。
9. 前端在中间画布里按 `shapeStyle()` 把每个图元渲染成绝对定位 DOM，并使用：
   - `translate(-50%, -50%)`
   - `rotate(...)`
   - `opacity`
   - `border-radius`
10. 如果 CSS 图元超出 `shaper-container`，导入时会自动扩展画布以容纳全部图元，而不是继续按 `overflow:hidden` 裁切。

### 右侧显示名
- 右侧详情和图元列表统一使用“层级-文件名-图元名”的显示名
- 其中：
  - 层级来自当前 `zIndex`
  - 文件名来自 `meta.sourceName`
  - 图元名优先使用导入时解析出的规则选择器，其次回退到基础图形名称

### SVG
- 当前支持基础图元子集，以及轴对齐 `<text>`（导入为 `textbox`，只保留中心坐标、字号、颜色和纯文本）
- 复杂路径、滤镜、渐变不保证导入
- 不支持的内容通过 warning 提示

## 6. 编辑设计

### 图片库
- 默认分类为 `基础形状`
- 基础形状包含：
  - 圆形
  - 矩形
  - 等腰三角形
  - 四角星
  - 五角星
  - 圆环（内径:外径 = 0.8，GIA 素材 100006）
  - 文本框（默认：字号 20、自适应、最小字号 12、白字 100%、白底 0%、描边 `#333333` 20%、水平左对齐、垂直上对齐；内容支持 `<color>` / `<i>` / `<size>`）
- 其他分类预留但暂不支持

### 画布交互
- 左键拖动空白区域：平移视图
- 缩放滑块与按钮：调整画布视图缩放
- 宽高输入框：调整画布大小
- “等比”勾选：按比例联动宽高
- 左键拖图元：移动图元
- 选中图元后：
  - 可直接拖动蓝色旋转手柄旋转
  - 可直接拖动橙色缩放手柄缩放
- 右键图元：
  - 快速修改颜色
  - 快速修改透明度
  - 快速缩放

### 右侧详情区
- 选中图元时显示：
  - 层级信息
  - X / Y
  - 宽 / 高
  - 旋转
  - 颜色
  - 透明度
  - 是否背景图元
  - 层级数字输入与 `-1 / +1` 调整
  - 图层顺序操作
- 未选中图元时显示图元列表

### 历史记录
- 支持前端会话级撤销重做
- 快捷键：
  - `Ctrl+Z`
  - `Ctrl+R`

## 7. 基础图形颜色同步

为满足“改了基础图形颜色后，图片库和后续拖入颜色也同步变化”的需求：

- 基础形状默认值存放在 `scene.library.baseShapePresets`
- 当用户修改画布中某个基础形状的颜色时：
  - 当前图元颜色更新
  - 对应的 `baseShapePresets` 颜色同步更新
  - 左侧图片库卡片立即变色
  - 之后从图片库拖入或双击添加时沿用新颜色

这部分会随着导出的 JSON 一起保留。

## 8. 保存并应用

`保存并应用` 负责两件事：
- 刷新当前场景对应的 `JSON / CSS / SVG` 浏览内容
- 把当前画布里的基础图元收集到 `library.savedItems`

这样用户可以把当前编辑结果沉淀为可复用图元。

## 9. 视图缩放与导出

- 画布缩放属于前端视图状态，只影响编辑时看到的比例
- 导出使用的是 `SceneDocument.canvas` 和 `SceneElement` 的真实数值
- 因此把画布放大查看，不会让导出的图形整体缩放倍率变大

## 10. 导出设计

### JSON
- 导出完整 `SceneDocument`

### CSS
- 导出为与当前导入格式兼容的绝对定位样式
- 文本框额外写出 `-miliastra-type` / `-miliastra-text` 以及字号、颜色、对齐、描边等自定义属性

### SVG
- 从统一场景模型直接生成
- 圆环（`ring`）在 SVG 导出时被**忽略**（SVG 导入器不支持 `<path>`，无法无损往返），并在 SVG 文件头部写入 `Miliastra-Warning` 警告注释；前端代码预览区会同步显示强提醒横幅。需要圆环请导出 CSS 或 JSON。
- 文本框导出为 `<text>`，富文本拆成 `tspan`

### GIA
- 后端将 `SceneDocument` 规范化为 GIA 所需结构
- 然后调用外部 Python 工具输出 `image mode` GIA
- 素材组父节点尺寸使用当前画布宽高，并写入全部平台的变换数据，避免使用默认尺寸；子元素仍以画布中心为原点导出。
- 文本框导出为 class=15 UI 节点；水平对齐写 `508`（省略=左 / `1`=中 / `2`=右），垂直对齐写 `509`（省略=上 / `1`=中 / `2`=下）

## 11. API

### 素材库
- `GET /api/library/catalog` 合并现有图片、中文/英文名称、描述与用途字典。
- `GET/POST /api/library/contact-sheet` 输出最多 48 个素材的带 ID 棋盘格 PNG 总览，POST 请求为 `{ids:[...]}`。
- `GET/POST /api/library/assets.zip` 下载指定素材或全部有图片路径的素材；POST 请求为 `{ids:[...]}` 或 `{all:true}`，两者互斥。ZIP 含 `images/{id}.png` 原图、`manifest.json` 和 `contact-sheets/001.png` 等每页最多 48 张的总览。
- ZIP 清单 `assets` 每项保存 `id/path/imageUrl/description/uses/categoryIds/width/height/status/error/contactSheet`，总览定位字段为 `contactSheet:{path,index}`；`counts:{requested,ok,failed}` 记录结果。单张下载失败不丢失该 ID 的清单信息，也不阻止其他图片进入素材包。

### 导入
- `POST /api/import`

请求：

```json
{
  "sourceType": "css",
  "content": "..."
}
```

响应：

```json
{
  "scene": {},
  "warnings": []
}
```

### 导出
- `POST /api/export/json`
- `POST /api/export/css`
- `POST /api/export/svg`
- `POST /api/export/png`
- `POST /api/export/gia`

统一请求体：

```json
{
  "scene": {}
}
```

## 12. WebMCP 批量编辑与预览

工具在 `frontend/src/webmcp.ts` 注册，由 `App.tsx` 的桥接对象读取最新场景；工具返回值与场景隔离，连续调用无需等待 React 渲染。

- 图形库的“用途”是独立筛选栏，提供 40 个中间用途分类，可与原有图形分类、色态和文字搜索交叉筛选；8 个用途分组只作为不可选择的段标题，129 个精细用途继续用于检索及素材详情。`category.json` 的 `filters` 为 `Record<string, {group, label, keywords, uses: string[]}>`，每个中间分类按精细用途的并集匹配素材并去重。后端读取 OSS 的 `filters`，前端构建内置这 40 个分类作为旧版 OSS 字典的兜底；`desc.json` 继续使用原有精细用途代码，无需为本次分类调整重新上传。
- `list_asset_categories({query?,tone?,refresh?})` 发现原有图形分类，返回 `key/label/count/tones`，并提供 `icons` 图标汇总。`list_asset_uses({category?,tone?,query?,group?,includeFine?,includeEmpty?,refresh?})` 在选定图形分类与色态范围内查询中间用途 `filters`（每项含 `code/group/label/keywords/uses/count`）。默认隐藏空用途且不返回 129 个精细用途；`includeEmpty:true` 保留空用途，`includeFine:true` 返回精细 `uses`。
- `search_assets({query?,use?,category?,tone?,offset?,limit?,refresh?})` 查找 ID、视觉描述与用途；`use` 接受中间用途（如 `purpose.avatar`）、精细用途（如 `avatar.frame`）或分组（如 `group:content`），`category` 接受原有素材分类 `key` 或 `icons`。分类与用途也接受完整中文名称，完整用途名称优先匹配中间分类，精细筛选用明确代码；未知名称和同层重名报错。默认每页 20 张、最多 100 张，空格分隔的搜索词须全部命中。返回图片 URL、描述、用途和色态；将返回的 `id` 用作 `add_elements` 的 `imageAssetId`。
- `preview_assets({ids?或搜索筛选条件,offset?,limit?,output?})` 返回带 ID 的素材 PNG 总览，每页最多 48 张；默认 `output:"image"` 返回图片内容，也可用 `output:"dataUrl"` 返回 data URL。`prepare_asset_pack({ids?或搜索筛选条件,all?})` 返回 `count` 和绝对 POST `request:{method,url,body}`；短 ID 列表及全量模式还提供 `downloadUrl`。`all:true` 可下载全部有图片路径的素材，不限制为候选子集。素材发现、搜索、总览与打包准备均不修改场景或撤销历史。
- `add_elements({elements:[...]})` 批量追加；`set_elements({elements:[...]})` 整体替换图元、保留画布及素材库，空数组清空图元。每个条目使用 `add_element` 的参数，可指定唯一 `id`。默认只返回 `count` 和输入顺序的 `ids`，`returnElements:true` 返回完整新增图元。
- `update_elements({updates:[{id,...fields}]})` 批量修改；`remove_elements({ids:[...]})` 批量删除。整批先校验，再提交；无效 ID、重复更新 ID、无效数值不会造成部分修改。每批只记一步撤销。
- 单个及批量新增/更新均支持 `zIndex`。它是排序键，数值越大越靠上，同值保持原有/输入顺序；提交后重排为连续索引。可用 `-1` 置底、超过当前最大值置顶、半整数插入两层之间，也可批量设置整组排序键。
- `add_element` / `add_elements` 默认 `select:false`，保持已有选择；`set_elements` 默认清除选择，`select:true` 选中最后新增图元。`set_selection({id})` 选择指定图元，`set_selection({})` 取消选择，不产生撤销记录。
- 坐标原点为左上，位置是尺寸盒中心，旋转逆时针为正且绕尺寸盒中心。三角形朝上；星形顶点与编辑器 CSS clip-path 一致；圆环内外径比为 0.8。工具和属性面板支持最小 1px 尺寸。基础图形默认透明度仍为 0.85，文本框和素材图为 1；需要实色时显式传 `opacity:1`。`background:"transparent"` 表示透明画布。
- `list_elements` 默认每页 100 个简要条目（id/name/type/zIndex），可设 `details:true`、`offset`、`limit`（最多 1000）、名称子串 `name`、`type`、`ids` 及 `region:{x,y,width,height}`。区域按旋转后的轴对齐外接框相交筛选。响应包含 `total`、`matched`、`count`、`nextOffset`。
- `get_scene()` 保留完整文档返回；`summary:true` 只返回画布、元数据和图元数，`includeLibrary:false` 排除素材库快照。也支持上述分页筛选参数。
- `import_source` 描述中提供可直接使用的 JSON 场景示例。含 `canvas` 的格式中，图元必填 `id/type/x/y/width/height`；其余字段采用后端默认值（特别是 JSON 的默认 opacity 为 1）。仅含图元数组的格式会自动拟合画布。
- `get_canvas_preview` 默认返回 PNG data URL；可设 `format:"jpeg"`、`quality`、`region` 和 `maxSize`。区域坐标为左上角，裁切至画布后可放大到 maxSize；全图仅缩小。JPEG 用白色衬底。`output:"image"` 返回 `{content:[{type:"image",mimeType,data}]}`，能否作为视觉内容而非文本消费取决于调用客户端；旧客户端继续使用默认 `output:"dataUrl"`。
- 代码面板仅在显示时自动生成当前格式，300ms 防抖，取消过时请求并缓存当前结果；JSON 本地生成。工具编辑不再主动发送 CSS/SVG/Lua 三种全量导出。显式导出与复制读取最新场景。
- 撤销使用不可变场景与图元引用共享，保留最近 100 次编辑。原值修改不生成状态、快照或导出，也不会清除重做分支。
- PNG 多边形显式使用图元中心旋转（修复 180° 三角形偏移 height/3），基本图形、圆环及素材图按 source-over 叠加透明度；星形 PNG/SVG/CSS 使用与画布相同的顶点。

批量调用示例：

```js
add_elements({elements: [
  {id: "base", type: "rectangle", x: 150, y: 150, width: 100, height: 1, color: "#ffffff", opacity: 1},
  {id: "tip", type: "triangle", x: 150, y: 100, width: 60, height: 60, color: "#ff0000", opacity: 1}
]});
update_elements({updates: [{id: "tip", rotation: 180}, {id: "base", zIndex: 10}]});
list_elements({name: "triangle", limit: 20, details: true});
get_canvas_preview({region: {x: 100, y: 50, width: 100, height: 100}, maxSize: 512, format: "jpeg", output: "image"});
```

验证：后端 `python -m unittest discover -s tests -v` 覆盖旋转中心、星形、透明叠加和 CSS 往返；前端 `npm run build` 完成类型检查和构建。图片内容块需在具体 WebMCP 客户端验证兼容性。

## 13. 验收点

### 文档
- README 能说明项目目标、启动方式、当前能力
- 技术设计文档能独立描述架构和数据模型

### 功能
- `demo/demo.css` 可导入
- 超出容器范围的 CSS 会自动扩展画布并完整导入
- 基础图形可拖入、旋转、缩放、调色
- 未选中图元时右侧能显示图元列表
- 基础图形改色后，图片库和后续拖入颜色同步更新
- `Ctrl+Z / Ctrl+R` 生效
- `保存并应用` 后预览区和已保存图元同步刷新
- 可导出 `json / css / svg / gia`

### 部署
- 开发环境两个进程
- 生产环境一个 Python 进程
- 前端和 API 同域
