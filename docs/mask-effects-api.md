# 效果编辑相关 Lua API 核对

## 结论

图片控件原生支持**遮罩、反转、像素/比例羽化、水平/垂直/径向填充**。羽化不只有 X/Y 宽度，还有水平/垂直范围。渐变文字和高光是基于这些属性组合的工具预设，不是独立 Lua API。

本表核对了公共控件、图片、文本、Tween/Sequence 的完整相关定义，并扫描其余控件能力。它描述 API 能力，不等于拼图工具已经实现，也不以模拟器实现限制官方能力。按键枚举等与美术属性无关的逐项清单不在这里重复。

## 1. 来源与可信范围

| 来源 | 本轮用途 / 版本 |
|---|---|
| `E:/qxqy-lua/knowledge/guide/Lua客户端UI脚本API.md` | 主 API 来源，SHA-256 `4a43f93f2b322be8336ff33d9cb07b3bc3a8d4c8a931a45d18f90e4e64941bab` |
| 本地官方飞书快照 `lua-client-ui-api/latest/02-all-sheets.json` | manifest 为 `2026-08-26T2213_rev223`；图片字段表 `7iFOjK`、方法表 `0zyWdI`、羽化枚举表 `b8GesQ` |
| 第三方知识库收录的[官方 API 页面](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4) | 抓取时间 `2026-09-25T17:54:09.605Z`；图片、羽化、填充、Tween 相关定义与本地表一致 |
| 真机 MASK v1 | 2026-10-11 PC、矩形资源 100001、Pixel、scale=1；已确认裁切后代、透明着色仍遮罩、X/Y 羽化方向及宽度变化 |
| 真机 TWALL v1 | 2026-09-29 PC；包含 `softEdgeWidthX`、`horizontalSoftRange`、`fillAmount` 的补间与数值读回 |

原始飞书链接：<https://kcnote9o8u33.feishu.cn/wiki/QF4qw7SEUig3q6kY0M3cUYYUnsh>。本轮官网静态抓取未得到正文，浏览器连接不可用，因此**不能称为已在线核验官网最新版本**。

第三方收录仍将公共运行时标识写为 `id`，本地加工稿/现有真机使用 `Id`；其 `imageType` 也未反映本地记录的条件支持。这类差异保留来源，不用第三方版本覆盖已确认接口。

## 2. 图片专用字段（18 项）

所属 `ClientUIImageControl`，另外继承第 5 节的公共属性。表中“补间”只表示官方明确标为 Tweenable；“—”表示未声明可补间，不等于不可读写。

| 类别 | 字段 | 类型 / 访问 | 补间 | 用途 |
|---|---|---|---|---|
| 资源 | `imageSource` | ImageSource，只读 | — | 当前图片来源 |
| 资源 | `imageId` | integer，只读 | — | 当前图片 ID |
| 显示 | `imageColor` | ColorValue，读写 | 是 | 图片着色及 alpha |
| 显示 | `imageType` | ImageType，条件读写 | — | Basic / Stretch；只有部分图片支持 |
| 遮罩 | `enableMask` | boolean，读写 | — | 开关 |
| 遮罩 | `reverseMaskArea` | boolean，读写 | — | 区域反转 |
| 羽化 | `enableSoftEdge` | boolean，读写 | — | 羽化开关 |
| 羽化 | `softEdgeMode` | ImageMaskSoftEdgeMode，读写 | — | Pixel / Percentage |
| 羽化 | `softEdgeWidthX` | number，读写 | 是 | 水平羽化宽度 |
| 羽化 | `softEdgeWidthY` | number，读写 | 是 | 垂直羽化宽度 |
| 羽化 | `horizontalSoftRange` | number，读写 | 是 | 水平羽化范围 |
| 羽化 | `verticalSoftRange` | number，读写 | 是 | 垂直羽化范围 |
| 填充 | `fillType` | ImageFillType，读写 | — | 不使用 / 水平 / 垂直 / 三种径向填充 |
| 填充 | `fillHorizontalType` | ImageFillHorizontalType，读写 | — | 水平起始方向 |
| 填充 | `fillVerticalType` | ImageFillVerticalType，读写 | — | 垂直起始方向 |
| 填充 | `fillRadial90Type` | ImageFillRadial90Type，读写 | — | 90° 起点 |
| 填充 | `fillRadialType` | ImageFillRadialType，读写 | — | 180° / 360° 起点 |
| 填充 | `fillAmount` | number，读写 | 是 | 填充进度 |

### 图片方法（8 项）

均为实例方法，使用冒号；文档未声明返回可链式调用对象。

```lua
image:SetImage(imageSource, imageId)
image:SetSoftEdgeWidth(widthX, widthY)
image:SetFillUnused()
image:SetFillHorizontal(fillHorizontalType, fillAmount)
image:SetFillVertical(fillVerticalType, fillAmount)
image:SetFillRadial90(fillRadial90Type, fillAmount)
image:SetFillRadial180(fillRadialType, fillAmount)
image:SetFillRadial360(fillRadialType, fillAmount)
```

`imageSource/imageId` 通过 `SetImage` 修改，不能直接赋值。范围值直接写字段，没有文档化的 `SetSoftRange` 或 `GetSoftEdgeWidth`。

## 3. 羽化：明确支持两种模式

```lua
image.softEdgeMode = Enum.ImageMaskSoftEdgeMode.Pixel
-- 或
image.softEdgeMode = Enum.ImageMaskSoftEdgeMode.Percentage
```

| 已确认 | 尚未确认 |
|---|---|
| Pixel：按像素设置边缘羽化 | 像素随父级缩放/分辨率的精确换算 |
| Percentage：按比例设置边缘羽化 | 数字范围是 0–1、0–100 或其它限制 |
| 宽度 X/Y 与范围 H/V 是四个独立可写 number | 两种模式分别采用哪些字段、字段组合公式及是否相互影响 |
| 四个数值字段均标 Tweenable | 边缘衰减曲线、角部组合、过大宽度/负值等边界 |

本地 GIA/检视器样本记录过百分比羽化范围 `85/85`，另有 border `8/8`；它们仅证明对应样本值，**不能推出百分比 Lua 的通用范围、默认值或换算公式**。MASK v1 也将 range 固定为 85/85，并未单独验证 range 的视觉作用。

产品应保存枚举及四个原始数值字段，不把 Percentage 提前换算成 Pixel。切换模式保留各值，不做未有依据的自动换算。当前工具按用户要求补充了 Percentage 近似预览，以范围表示中心不透明占比，使用 `%` 展示，并在界面说明这不是已核验的原生公式；具体规则见 [百分比预览约定](lua-mask.md#百分比预览约定)。

“文档声明”“Lua 可保存/输出”“浏览器视觉已核验”分开记录。Percentage 可以进入模型及配置计划；当前精确预览未核验，不能把简化线性比例算式称为原生还原。

## 4. 填充方式与枚举

| `Enum.ImageFillType` | 方向/起点枚举 | 可选值 |
|---|---|---|
| `Unused` | 无 | 关闭填充 |
| `Horizontal` | ImageFillHorizontalType | `Left`、`Right` |
| `Vertical` | ImageFillVerticalType | `Bottom`、`Top` |
| `Radial90` | ImageFillRadial90Type | `BottomLeft`、`TopLeft`、`TopRight`、`BottomRight` |
| `Radial180` | ImageFillRadialType | `Bottom`、`Left`、`Top`、`Right` |
| `Radial360` | ImageFillRadialType | `Bottom`、`Left`、`Top`、`Right` |

**Lua 没有文档化 `enableFill` 字段。** UI 的“启用填充”应映射到 `fillType` / `SetFill*`，关闭调用 `SetFillUnused()`。

当前表只把 `fillAmount` 描述为 number“进度”，未明示闭区间；已有真机脚本使用 1→0，模拟器以 0–1 渲染。UI 0–100% 对应 Lua 0–1 可作为需标明依据的产品约定，不能拿 GIA 样本 wire 的 100 直接写入 Lua。

文档没有单独的顺/逆时针字段，也没有说明填充与反转、羽化、子级裁切的组合顺序。径向 API 的存在已经确定，但尚不能把“Radial360 图片填充”直接等同于“所有后代的圆形遮罩”。

## 5. 公共控件属性和方法

以下来自 `ClientUIBaseControl`，图片、文字及普通容器都继承。形状不需要为每种移动/缩放分别增加专用 API。

| 能力 | 字段 | Tweenable |
|---|---|---|
| 位置 | `anchoredPositionX/Y` | 是 |
| 尺寸差异 | `sizeDeltaX/Y` | 是 |
| 最小/最大锚点 | `anchorMinX/Y`、`anchorMaxX/Y` | 是 |
| 轴心 | `pivotX/Y` | 是 |
| 缩放 | `localScaleX/Y/Z` | 是 |
| 旋转 | `localRotationX/Y/Z` | 是 |
| 层级关系 | `parent`（对象）、`name`（字符串） | 未声明 |
| 手柄聚焦资格 | `canControllerFocus` | 未声明 |
| 状态 | `alive/active/activeInHierarchy/visible` | 只读 |
| 标识 | `Id/prefabIndex` | 只读 |

对应成对方法：`Get/SetAnchoredPosition`、`Get/SetSizeDelta`、`Get/SetAnchorMin`、`Get/SetAnchorMax`、`Get/SetPivot`、`Get/SetLocalScale`、`Get/SetLocalRotation`。getter 分别返回两个或三个数值；setter 用冒号。

- 显隐/激活用 `SetVisible(bool)`、`SetActive(bool)`，不能写只读字段。
- 层序用 `GetSiblingIndex/SetSiblingIndex/SetAsFirstSibling/SetAsLastSibling`。与编辑器列表方向分开处理。
- 查询用 `GetChildren/GetChild/FindChild`；不存在文档化的“把某个任意控件 ID 设为蒙版目标”字段。遮罩作用对象通过父子层级组织。
- 普通 `ClientUIContainerControl` 另有 `isolateNavigation`、`disableKeyEventPassthrough`、`disableCursorEventPassthrough`、`showCursor`；没有图片羽化字段。

旋转/缩放字段存在，不等于每种蒙版+三轴组合均有精确渲染证据。方案中限制某些组合时应标为本工具的版本范围，不写成 API 不支持。

## 6. 文字、颜色及资源

`ClientUITextBoxControl` 的 10 个专用字段：

| 字段 | 类型 | Tweenable |
|---|---|---|
| `text` | string | 未声明 |
| `fontSize`、`minimumFontSize` | integer | 是 |
| `fontColor`、`bgColor`、`outlineColor` | ColorValue | 是 |
| `enableOutline`、`adaptiveFontSize` | boolean | 未声明 |
| `horizontalAlignment` | Left / Middle / Right | 未声明 |
| `verticalAlignment` | Top / Middle / Bottom | 未声明 |

文字没有 `enableMask/softEdgeMode`，需要放进图片遮罩下。没有文档化的字体资源选择、字符间距、独立描边宽度、文本渐变色标字段；不能照搬 CSS 属性作为 Lua 接口。

颜色：`Color.FromRGBA(r,g,b,a)` / `Color(r,g,b,a)` 使用 0–255 RGBA；alpha 省略或 nil 等于 255。UI 透明度需明确换算；没有公共 `opacity/alpha` 或 `SetOpacity()`。

图片模式：`Enum.ImageType.Basic/Stretch`，有资源/实例条件，不能无条件写。图片来源共有八项：`StaticReference/Item/Equipment/Skill/UnitStatus/Faction/Currency/Prefab`。绑定用 `image:SetImage(Enum.ImageSource.X, id)`，来源和 ID 共同决定资源。这里的 ImageType 是拉伸方式，不是矩形/圆形“蒙版形状”。

## 7. Tween 与其他控件

### Tween

创建用 `game.Tween(object, {field=target}, duration)`，`game` 使用点号。配置/播放方法用冒号：

- `SetEase`、`SetRelative`、`SetLoops`、`Play`、`SetOnComplete`、`SetOnStepComplete` 返回 Tween。
- `Pause/Resume/Restart/Complete/Kill(bool)` 文档未声明可继续链式调用。
- `SetLoops(integer)`，负数无限循环；没有 loopType / Yoyo 参数。往返效果用多个阶段编排。
- 31 种缓动：Linear，以及 Sine/Quad/Cubic/Quart/Quint/Expo/Circ/Back/Elastic/Bounce 的 In/Out/InOut。

Sequence 提供 `Append/Join/Insert`、`AppendInterval`、`AppendCallback/InsertCallback` 和同类生命周期/循环方法，可用于“扫过—停顿—下一次”。布尔、枚举、parent 未标 Tweenable，切换这些参数需要阶段回调。

静态设置无需逐帧逻辑；动画仅改变明确 Tweenable 的字段。字段可写与可插值是两种能力。TWALL 现有日志证明部分羽化字段数值插值，无需重测，但不能据此认定 Percentage 视觉公式已验证。

### 其他类型扫描结果

- 文本视窗：文字样式 + `interactable/showScrollBar`，没有额外羽化接口。
- 网格视窗：列表模板、交互、滚动条、`scrollProgress`（Tweenable）及刷新/定位方法；其裁切属于视窗机制。
- 预设按钮/光标区域：交互和 CursorEvent，不提供美术蒙版字段。
- 按键提示：键鼠/手柄按键枚举。
- 界面动效：`animationId/playSoundEffect/layer`，`PlayAnimation/StopAnimation` 播放已配置资源。
- 全屏动效：`animationId/playSoundEffect`；引用控件：只读 `referencedPrefabIndex`。

未发现可直接配置 shader、模糊、Bloom、混合模式、任意 SVG 路径蒙版、独立四边羽化或反向环绕方向的客户端 API。

## 8. 对效果页签的修订建议

```text
属性 | 效果 | 代码

效果
  遮罩
    启用遮罩
    遮罩区域反转
    作用内容（通过图层树组织）
    位置 / 尺寸（公共变换）

  边缘羽化
    启用羽化
    模式：像素 / 百分比
    水平宽度 / 垂直宽度
    水平范围 / 垂直范围

  按进度填充
    不使用 / 水平 / 垂直 / 90° / 180° / 360°
    对应方向或起点
    进度

  动画（后续）
    属性 / 目标值 / 时长 / 缓动 / 循环
```

此为完整属性覆盖，实施可分期。Pixel 及基础矩形已有真机观察；Percentage、反转、径向组合仍保留 API 字段但标明预览范围。与上层“双色渐变/高光”预设分开：预设可以选择 Pixel 生成，不能因此从原生属性模型里删除 Percentage。

建议效果数据保存原始值：

```ts
type NativeImageEffects = {
  enableMask: boolean;
  reverseMaskArea: boolean;
  enableSoftEdge: boolean;
  softEdgeMode: 'Pixel' | 'Percentage';
  softEdgeWidthX: number;
  softEdgeWidthY: number;
  horizontalSoftRange: number;
  verticalSoftRange: number;
  fillType: 'Unused' | 'Horizontal' | 'Vertical' | 'Radial90' | 'Radial180' | 'Radial360';
  fillHorizontalType: 'Left' | 'Right';
  fillVerticalType: 'Bottom' | 'Top';
  fillRadial90Type: 'BottomLeft' | 'TopLeft' | 'TopRight' | 'BottomRight';
  fillRadialType: 'Bottom' | 'Left' | 'Top' | 'Right';
  fillAmount: number;
};
```

数值字段不能因切换模式而清零或改成另一单位。产品默认值与限制需标来源，未核实的百分比不要输出自动除以 100 的逻辑。未接入的渲染能力可标“原生属性，预览待核验”，不能显示仿佛精确支持的效果。

## 9. 现有资料与 Lua 依赖结论

| 已提供/已有资料 | 可以证明 | 不能据此推出 |
|---|---|---|
| 用户提供的 `lua-gradient-effects` 技能及 references | 重合内容 + 图片遮罩羽化构造空间渐变；Tween 负责时间变化 | 名字带 Lua 不表示静态结构只能由 Lua 创建；配方不是全部真机通过 |
| 用户 A–G 真机截图及日志 | Lua 设置后的矩形遮罩、透明图片和像素羽化确实生效 | 脚本负责设置及切换测试状态，未单独验证无脚本导入后初始参数一致性 |
| 本地官方 API | 图片控件拥有遮罩/羽化/填充属性，Lua 可以设置 | 可由 Lua 设置不等于必须由 Lua 实现渲染 |
| 编辑器检视器 / GIA 样本 | 遮罩、羽化、填充、反转开关及部分参数可静态保存 | 任意羽化数值、模式/范围及目标版本的所有 wire 映射均已验证 |
| 当前模拟器 codec | 已有相关字段的 GIA 编解码实现 | 模拟器往返成功不是所有静态 GIA 属性的真机证明 |
| 拼图工具现有 `canvas.mask` | 旧素材组的全局裁切可以作为导出配置 | 旧素材组 mask_settings 与客户端图片羽化字段兼容 |

### 使用规则

- **静态裁切/羽化**：控件层级及参数预配置即可；若目标客户端 GIA 编码完整，设计上无需 Lua 持续运行。
- **静态渐变/高光**：编译器预先生成颜色副本与遮罩，仍可作为静态控件树保存；自动生成控件树是导出工具的工作，不必放到游戏中的 Lua 完成。
- **动态创建或按参数设置**：选择 Lua 输出时需要脚本初始化，这属于所选交付路径；某些字段暂时没法可靠编码时也可用最小启动脚本补齐。
- **扫光/呼吸/流动/进度联动**：本方案使用 Lua + Tween/事件修改原生属性。Lua 驱动变化，原生引擎负责裁切与羽化；不在 Lua 里逐像素绘制。
- **Pixel / Percentage**：两者都是原生模式，是否带脚本与模式选择没有必然关系；百分比的参数语义仍需补齐才能做准确预览。

因此右侧“效果”页签用于编辑原生属性和工具配方；导出时再选择“静态客户端 GIA”“Lua 绘制”或“GIA + 初始化/动画 Lua”。不要把所有蒙版功能统一绑定为脚本功能。
