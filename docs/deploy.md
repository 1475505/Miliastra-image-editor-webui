# 本地运行与部署

[使用指南](README.md) · [English quick start](../README.md#run-locally)

## 一键本地运行

安装 Python 3.13、Node.js 20+ 和 npm，在仓库根目录执行：

```powershell
# Windows
.\start.bat
```

```bash
# Linux / macOS
bash start.sh
```

脚本使用 `backend/.venv` 安装后端依赖，安装并构建前端，启动 `0.0.0.0:8439`。访问 **http://localhost:8439**，Ctrl+C 停止。Python 3.13 是当前部署基线，GIA/Lua 转换源码已随仓库提供，不需要其它本机工具目录。

## Docker

在仓库根目录执行：

```bash
docker build -t miliastra-image-editor .
docker run --rm -p 8439:8439 miliastra-image-editor
```

Dockerfile 会自动安装依赖并构建前端，无需先在宿主机运行 npm。容器内部端口为 `8439`。

仓库的 [GitHub Actions](../.github/workflows/docker-image.yml) 会在推送 main/master 或版本标签时构建并发布 GHCR 镜像。默认分支的标签为 `ghcr.io/<owner>/<repo>:latest`；私有镜像需要部署平台配置拉取凭证。

部署到 ClawCloud 或其它容器平台时，填写镜像地址、端口 `8439` 并开启需要的网络访问；启动命令沿用镜像默认值即可。应用不依赖数据库或持久化卷，也不会替用户自动保存作品。

## 开发模式

分别打开两个终端。

```powershell
# Windows：backend 目录
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```bash
# Linux / macOS：backend 目录
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

```bash
# frontend 目录
npm ci
npm run dev
```

前端为 `http://localhost:5173`，`/api` 代理到 `http://localhost:8000`。生产静态文件由 `npm run build` 写入 `backend/app/static/`；直接运行后端前需先构建，并在构建后重启后端。

## 可选配置

| 配置 | 用途 |
|---|---|
| `VITE_HYWENHEI_FONT_URL` | 前端构建时指定有权使用的字体 URL；留空时优先系统字体。见 [示例](../frontend/.env.example) |
| `MILIASTRA_LIBRARY_OSS_BASE` | 后端图片素材服务根地址，默认 `https://oss.070077.xyz/images` |
| `MILIASTRA_PREFAB_OSS_BASE` | 元件服务根地址，默认 `https://oss.070077.xyz/prefabs` |
| `MILIASTRA_LIBRARY_TIMEOUT` | 上游请求超时秒数 |

普通素材缩略图当前使用前端 `imageLibrary.ts` 的 `OSS_IMAGE_BASE`。自建图片服务时需要同步调整该地址并重新构建；仅修改后端环境变量不会切换所有浏览器图片请求。

## 排查

- 首页缺文件或空白：重新构建前端，重启后端，刷新页面。
- 502/504：检查服务是否监听 `0.0.0.0:8439`，平台端口是否一致。
- PM2 重启后日志报 `tsc: not found`：生产环境的 `npm ci` 默认跳过开发依赖；启动脚本须使用 `npm ci --include=dev` 安装 TypeScript/Vite，再构建并启动后端。重启期间安装、构建完成前服务会暂时不可用。
- 素材加载失败：检查素材源网络；在图形库点击刷新。
- 导出失败：先看界面错误，确认作品是否含仅 Lua 支持的元件或蒙版，再检查后端日志。

维护与测试命令见 [维护说明](technical-design.md)。
