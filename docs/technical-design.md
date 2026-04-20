# Miliastra Image Editor WebUI 技术设计

## 1. 目标

这是一个“在线图元编辑 + 多格式互转 + GIA 导出”的单页 Web 工具。

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
  type: "ellipse" | "rectangle" | "triangle" | "four_point_star" | "five_point_star" | "other";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  opacity: number;
  zIndex: number;
  isBackground: boolean;
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
- 当前只支持基础图元子集
- 复杂路径、滤镜、文本、渐变不保证导入
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

### SVG
- 从统一场景模型直接生成

### GIA
- 后端将 `SceneDocument` 规范化为 GIA 所需结构
- 然后调用外部 Python 工具输出 `image mode` GIA

## 11. API

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

## 12. 验收点

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
