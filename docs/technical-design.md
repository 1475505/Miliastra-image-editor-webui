# 维护说明

用户操作见 [使用指南](README.md)，AI 接入见 [WebMCP](webmcp.md)。本文只保留源码入口、兼容契约和验证边界。

## 结构与检查

| 模块 | 入口 |
|---|---|
| 页面、场景状态与历史 | `frontend/src/App.tsx` |
| 人类多选与键盘操作 | `editorSelection.ts`、`ShortcutHelp.tsx` |
| 页面 AI 工具 | `webmcp.ts` |
| 图片和元件目录 | 前端 `imageLibrary.ts` / `prefabLibrary.ts`；后端同名模块 |
| 图片类型与切片 | `imageStretch.ts`、`SlicedSprite.tsx`、`ImageAssetControls.tsx`；后端 `image_stretch.py` |
| 蒙版编辑与预览 | `LuaMaskInspector.tsx`、`MaskImagePicker.tsx`、`maskPreview.ts`、`maskGuides.ts`、`useMaskPreview.ts` |
| 场景模型、格式解析与 HTTP API | `backend/app/main.py` |
| Lua 数据回导与导出适配 | `backend/app/lua_scene.py`、`lua_mask.py` |
| 三轴投影 | 前端 `rotation.ts`、后端 `rotation.py` |

前端：在 `frontend/` 执行 `npm test`、`npm run build`。后端：在 `backend/` 的虚拟环境中执行 `python -m unittest discover -s tests -v`。`FENGARI_MODULE_PATH` 指向已安装的 Fengari 模块时，后端测试还会执行 Lua 控件契约检查；未配置时相关用例跳过。依赖清单见各目录，不要求外部知识库或模拟器源码。

前端构建含 TypeScript 检查，输出到 `backend/app/static/`；Vite 配置以 `frontend/vite.config.ts` 为准。Docker 自动构建前端，运行方式见 [部署](deploy.md)。

## 场景与格式契约

- 场景为 `{canvas,elements,meta,library}`。`x/y` 是图元中心，X 右、Y 下；`rotation` 是逆时针 Z，`rotationX/Y` 缺省 0。`zIndex` 大的在上，提交后连续编号。
- 图片用 `imageAssetId`，元件用 `prefabId/prefabVariable`，文字设置在 `textBox`，图元蒙版在 `luaMask`。不要把这些 ID 与 Lua 控件模板索引混用。
- 查看背景不进场景，导出透明底；实底用矩形图元。`canvas.mask` 是 GIA 素材组遮罩，与 `luaMask` 分开。
- JSON 保留完整规范化场景。缺少画布的简化 JSON 根据内容拟合画布；不接受嵌套 `center/size` 替代扁平几何。
- CSS 画布支持 `-miliastra-canvas-size` 和 `-miliastra-canvas-fit: lock|expand|fit`。SVG 是有限子集，圆环导出省略并警告。详细生成约束留在对应 [CSS](../skills/miliastra-image-css-builder/SKILL.md) / [SVG](../skills/miliastra-image-svg-builder/SKILL.md) 技能。
- 含元件或活动 `luaMask` 的绘图出口只支持 Lua；JSON 始终可保存。浏览器辅助轮廓、候选蒙版、选择集合与撤销历史不序列化。
- 手工编辑与 WebMCP 共用 `commitScene`。批量修改先校验再原子提交，原值操作不创建历史。鼠标事务和方向键长按在结束时提交一次；历史保留最近 100 次编辑。

## Lua 兼容

上游导出器在 [vendor/primitive_shape](../backend/vendor/primitive_shape/PROVENANCE.md) 按原样保留；修改应用适配层，不修改来源文件或许可证。

支持 PALETTE/ELEMENTS、ROOT/ELEMENTS 和本编辑器 TEXTBOXES/DRAW_ORDER 等受限字面量，不执行上传代码。文件上限 10 MiB、表深度上限 64；拒绝非有限数、重复声明、无效引用及数据区表达式。

末尾 `MILIASTRA_EDITOR_SCENE_V1` 保存编辑快照及绘图摘要。模板索引更改不影响快照；绘图数据修改后重新解析当前记录，不能恢复陈旧元数据。`IMAGE_TYPES`、`ROTATIONS`、`IMAGE_MASKS/TEXT_MASKS` 参与摘要；新增默认字段时须保留旧摘要兼容。

文本框直接设置字号、自适应、颜色、描边、对齐和显隐；字号为整数。图片和文字使用独立模板。启用蒙版的文字也需要图片模板；蒙版父先子后创建。带蒙版路径防止 OnStart 重入，失败回收，宿主销毁时不重复销毁其子树。

## 渲染策略与证据边界

- 图片类型按素材边框判断：任一边界大于零可拉伸，无边框只支持基础。浏览器整数切片与 PNG 共用边界语义，缩略图不作绘图贴图。
- 图片原生 `imageType` 是条件能力，Lua 设置需兼容保护。模板实例化成功不表示图片绑定成功，蒙版读取来源和 ID 核对绑定。
- 正交投影采用 Z-X-Y（`Ry * Rx * Rz`）；单轴图片压缩/翻面有真机观察，混合轴及其它控件不据此宣称已通过。
- 矩形遮罩裁切后代、透明着色仍遮罩、Pixel 羽化向内有 MASK v1 真机观察。非矩形轮廓、百分比、反转及精确合成仍待验。网页以图片 alpha、扫描线向内羽化和 alpha 补集近似；辅助虚线来自原轮廓，非羽化等值线。
- 百分比网页过渡宽度为 `轴尺寸 × (1-clamp(range,0,100)/100)/2`，不回写原参数。不能当作原生公式。
- 预览缓冲最长边 2048、轮廓 1536、辅助轮廓提取 768。辅助轮廓先排除近透明噪声（全图峰值 1%，至少 alpha=1），分离连通图案，再按各图案自身峰值的 50% 插值；避免约半透明素材的 127/129 像素被固定 128 阈值割裂。此处理只用于辅助线，不改变实际蒙版 alpha。辅助描边、选框及手柄按视图缩放补偿屏幕尺寸。素材请求共享缓存、失败可重试，迟到结果不覆盖新选择。

### 必须保留的 GIA 差异

| 项目 | 依据／边界 |
|---|---|
| 文本框自适应 | 7.1.0 对照文件的 textbox(19) `506` 从 0 变 1，`503` 保持 1；原始消息在 `test_textbox_gia.py`。字号 `502`、最小字号 `507`、对齐 `508/509`；不要把 visible 写入 `506` |
| 拉伸类型 | 客户端 class=70 样本为 image_slot(84).field504；本项目旧素材组 class=15 尝试 image_settings(31).field5=1，**仍是未真机确认的映射** |
| 三轴 GIA | 四平台 RectTransform 508 写 XYZ；客户端单轴探针成功不替代旧素材组导出的真机验证 |

拉伸样本 SHA-256：`10f04eba8af9d18a3ada66e88f328e15bbccacf0567c4cf1070e76707fcaaf6b`；仓库模板：`212633c935566155ede68d5b9b4bb9feec1b5d98152c3646d91b5bad6f9fede3`。

Lua API 核对来源为[官方页面](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)的本地加工快照，SHA-256 `4a43f93f2b322be8336ff33d9cb07b3bc3a8d4c8a931a45d18f90e4e64941bab`；原始快照标记 `2026-08-26T2213_rev223`。上述运行观察来自 MASK v1、ROTXY2；不是本项目每个新导出文件的真机验收。维护时按测试断言保留边界，不把浏览器或 VM 通过写成真机通过。

## 接口入口

`POST /api/import` 接收 `{sourceType,content,sourceName?}`，返回 `{scene,warnings}`。

`POST /api/export/{json|css|svg|lua|png|gia}` 接收 `{scene,giaGroupName?}`。普通场景可经 PNG 出口验证导入后的渲染；受限场景查看网页截图。

素材目录、元数据、PNG 代理、总览和 ZIP 由 `/api/library/*` 提供；元件目录和 ID 查询由 `/api/prefabs/*` 提供。具体使用见 [WebMCP](webmcp.md)、[图片源](image-library-upload.md)、[元件源](prefab-library-upload.md)。
