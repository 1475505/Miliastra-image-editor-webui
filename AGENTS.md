# Agent 开发入口

本仓库是千星图片编辑器：React/TypeScript/Vite 前端，FastAPI/Pillow 后端；生产服务同时提供静态页面和 `/api`，默认端口 8439。

## 开工

- 修改前检查 `git status --short`，保留已有用户改动。按任务读相关文件，不依赖其它本机仓库。
- 用户文档入口：[中文 README](README.zh-CN.md)、[English README](README.md)、[使用指南](docs/README.md)、[WebMCP](docs/webmcp.md)。改变功能时同步相关说明。
- 源码分工、兼容契约与证据边界见 [维护说明](docs/technical-design.md)。Lua/API、GIA 映射和预览近似不能混为真机事实。
- `backend/vendor/primitive_shape/` 为按原样保留的上游源码，许可证与来源不可删改；扩展在应用适配层实现。

## 检查

- `frontend/`：`npm test`、`npm run build`（含类型检查）。构建输出到 `backend/app/static/`；不要提交 `assets/`、node_modules 或生成的 Vite 配置副本。
- `backend/`：使用虚拟环境执行 `python -m unittest discover -s tests -v`。`FENGARI_MODULE_PATH` 可启用 Lua VM 检查；未配置的跳过项如实说明。
- 涉及交互时核对页面实际操作；`demo/demo.css` 为导入回归示例。
- 保留可重复的回归测试。一次性探针、截图采样或生成脚本用完删除；不把逐轮测试数量和机器路径堆进用户指南。

## 保存与提交

场景、素材库与查看状态的边界以当前模型为准；临时选择、蒙版辅助线和候选预览不写入导出。新增字段要覆盖导入、复制、收藏、撤销与相关导出，保持旧文件兼容。

提交前检查暂存差异和文档链接；仅在用户明确要求时提交或推送，消息简短。使用请遵守奇匠守则，尊重版权。
