# X / Y / Z 旋转

选中图元，在右侧 **变换 → 旋转角度 X / Y / Z** 输入角度（度，支持小数）。复位按钮同时归零三轴。原 `rotation` 字段继续表示 Z；新增 `rotationX`、`rotationY`，缺省为 0，旧 JSON、收藏和 Lua 可以继续使用。

- X：沿竖直方向倾转，180° 上下翻面。
- Y：沿水平方向倾转，180° 左右翻面。
- Z：画面内逆时针旋转，与原版本一致。
- 90° 侧立时面不可见；从图层列表选中后仍可改角度。缩放手柄先逆投影再计算原始尺寸；旋转手柄继续修改 Z。撤销/重做、复制、收藏、批量 WebMCP 编辑保留三轴。

```json
{"id":"flip","type":"triangle","x":150,"y":150,"width":100,"height":60,
 "rotation":0,"rotationX":60,"rotationY":180,"color":"#87cafa","opacity":1}
```

## 格式链路

| 格式 | 行为 |
|---|---|
| JSON / 收藏 | 保存原始平面尺寸及 `rotationX/rotationY/rotation`；角度沿用旧 Z 的 -180～180 归一化规则 |
| GIA | 四平台 RectTransform 的 508 旋转向量均写 float field 1=X、2=Y、3=Z；不把倾转烘焙成缩小尺寸 |
| Lua | 图片增加与 ELEMENTS 对齐的 `ROTATIONS` 两列 X/Y；实际调用 `SetLocalRotation(x,y,z)`。TEXTBOXES 支持可选 X/Y；旧记录仍可读 |
| Lua 回导 | 旋转表参与绘图摘要；手动修改 ROTATIONS 后重新解析记录而非使用过期快照，去掉元数据也能保留 X/Y。导入不执行代码 |
| CSS | 导出可直接显示的二维投影 matrix，并用 `-miliastra-rotation-x/y/z` 保存欧拉角供回导。单独 rotateX/rotateY(deg) 也可导入；任意 CSS 三维变换列表不等价于编辑器组合策略 |
| SVG | 非零 X/Y 用 g 的 matrix 变换实际几何，并用 `data-miliastra-element` 保存原始可编辑参数，避免从奇异/镜像矩阵猜角度。此元数据用于本编辑器回导；SVG 原有圆环省略规则保持 |
| PNG / 画布预览 | 图元顶点或贴图先按原大小绘制/切片，再投影、镜像；90° 不画面，透明背景保持 |
| WebMCP | add/update 单项与批量工具均支持 `rotationX/rotationY`，区域查询按投影外接矩形计算 |

元件仍沿用原有“Lua 绘制、JSON 保存”的格式限制。上游 `vendor/primitive_shape` 文件未修改：Lua 出口先向其提供 Z-only 中间记录，应用层适配器从原场景补齐 X/Y 到最终脚本。正式 GIA 出口始终直接写三轴。

## 证据与策略

2026-10-11 的 ROTXY-20261011-v2 探针，PC / KeyboardAndMouse、矩形资源 100001，静态客户端 GIA / Lua 方法 / Lua 字段各测 0/30/60/90/120/180°。用户提供界面控件组与试玩截图、完整 126 次采样日志：X/Y 单轴压缩与翻面可见，90° 侧立、120/180° 背面可见，子图片跟随，三条路径一致，读写零错误。`evidence_source=observed`、运行端 `device`；本次单轴图片条件 `device_status=passed`。实际客户端版本未提供。

生成探针 GIA SHA-256：`2855f0b6cb01ab66356d231ec20c8fc31d7b359525e990e8089ee3ca1d4292cb`。完整知识工作区证据在 `E:/qxqy-lua/probes/image-rotation-xy-20261011/device-20261011.md`；项目测试只用仓库内合成样本，不依赖该外部路径。

画布及 PNG 使用**正交平面投影**，局部组合采用 Z-X-Y 顺序（`Ry * Rx * Rz`），与模拟器及已知等价欧拉角读回一致。单轴显示已验证；混合轴顺序、其他控件/资源/设备、透视和任意嵌套三维行为不是新增真机事实。本项目 GIA 使用旧素材组模板，虽然 RectTransform 布局相同，**新素材组导出的真机复验仍未取得**；客户端探针成功不能替代旧素材组类型的独立验证。

## 验证入口

- 后端：`python -m unittest discover -s tests -v`；`test_rotation_xy.py` 检查多格式回导、独立 GIA wire、PNG 翻面和侧立。设置 `FENGARI_MODULE_PATH` 后额外执行生成 Lua 的真实 Lua 5.3 VM，检查图片/元件/文本的三轴调用。
- 前端：`npm test` 与 `npm run build`。`rotation.test.mjs` 检查投影与缩放逆变换。
- 浏览器验收：构建后检查属性输入、WebMCP、撤销/重做、侧立恢复与缩放手柄。临时浏览器探针不随项目维护。

部署时重新构建前端并重启后端，已有浏览器页面刷新。测试通过属于本地实现验证，不自动升级为本项目新导出包已真机验收。

旧 `demo/demo.css` 导入和 PNG 冒烟由原测试继续覆盖。
