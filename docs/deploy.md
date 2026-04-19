# 部署到 ClawCloud

## 部署结论

如果你要把这个项目部署到 ClawCloud，最稳妥的路径是：

1. 用仓库里的 `Dockerfile` 构建镜像
2. 把镜像推到镜像仓库，例如 `GHCR`
3. 在 `ClawCloud Run -> App Launchpad` 里按镜像方式创建应用

这样最贴近 ClawCloud Run 当前官方文档的使用方式。

## 运行版本要求

部署环境请固定使用 Python `3.13`。

原因：

- 当前仓库按 Python `3.13` 运行链路整理
- 项目说明里把 Python `3.13` 视为兼容基线
- 为避免 `.pyc` 构建产物带来的跨版本兼容问题，不建议在 `3.13` 之外的版本部署

仓库里的 `Dockerfile` 也已经固定为：

```dockerfile
FROM python:3.13-slim
```

## 当前仓库已经内置的内容

这个仓库已经自带：

- 前端静态资源：`backend/app/static/`
- GIA 转换依赖：
  - `backend/vendor/gia/json_to_gia.py`
  - `backend/vendor/gia/image_template.gia`

所以部署时不需要再额外拷贝 GIA 工具箱。

## 构建前端静态文件

如果你从源码开始构建镜像，或者 `backend/app/static/` 目录下缺少构建产物，需要先编译前端：

```bash
cd frontend
npm install
npm run build
```

这会生成前端静态文件并自动输出到 `backend/app/static/` 中，随后再进行镜像构建或部署。

## 后端环境准备

如果你从源码直接运行（非 Docker），需要先准备 Python 虚拟环境：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> **注意：** 项目按 **Python 3.13** 设计。请确保创建虚拟环境时使用的 `python3` 为 3.13 版本，以避免 `.pyc` 等构建产物的跨版本兼容问题。

## 推荐方案：ClawCloud Run + App Launchpad

这是最推荐的部署方式，因为它符合 ClawCloud Run 官方文档当前的"容器镜像部署"流程。

### 第 1 步：准备镜像仓库

你需要一个可拉取的镜像地址，例如：

- `ghcr.io/<你的 GitHub 用户名>/qianxing-image-editor-webui:latest`

如果你用 GitHub Container Registry，可以先在本地登录：

```bash
echo <YOUR_GITHUB_TOKEN> | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
```

## 第 2 步：本地构建镜像

在仓库根目录执行：

```bash
docker build -t ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest .
```

如果你在 Windows PowerShell 下执行，也可以直接用同样命令。

## 第 3 步：推送镜像

```bash
docker push ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest
```

推送完成后，确认这个镜像在 ClawCloud 所在环境可访问。

如果仓库是私有镜像仓库，你还需要在 ClawCloud 侧配置镜像拉取凭证。

### 替代方案：GitHub Actions 自动构建

仓库已内置 [`.github/workflows/docker-image.yml`](../../.github/workflows/docker-image.yml)。推送代码到 `main`/`master` 分支或打 `v*` 标签时，GitHub Actions 会自动：

1. 安装前端依赖并执行 `npm run build`
2. 构建 Docker 镜像
3. 推送到 `ghcr.io/<用户名>/<仓库名>:latest`

你需要在仓库 **Settings → Actions → General → Workflow permissions** 中确保 `Read and write permissions` 已开启，以便 `GITHUB_TOKEN` 能推送镜像到 GHCR。

## 第 4 步：进入 ClawCloud Run 控制台

打开：

- `https://console.run.claw.cloud`

然后进入：

- `App Launchpad`

根据 ClawCloud Run 官方文档，创建应用时会填写这些核心信息：

- 应用名称
- 镜像名称
- 部署模式
- CPU / 内存
- 端口
- 是否开启外网访问
- 启动命令
- 环境变量

## 第 5 步：创建应用时怎么填

建议这样填：

### 基础信息

- `Application Name`：
  - `qianxing-image-editor-webui`

- `Image Name`：
  - `ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest`

### Deployment Mode

建议先选：

- 固定实例数
- `1` 个实例

后面跑稳定了再考虑自动扩缩容。

### Compute Resources

建议起步配置：

- `0.5 vCPU`
- `512 MB` 内存

如果你后续发现导出 GIA 或图片处理时内存偏紧，可以升到：

- `1 vCPU`
- `1 GB` 内存

### Network Configuration

容器端口填写：

- `8439`

并且：

- 开启外网访问

因为容器内部启动的是：

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8439
```

### Startup Command

如果镜像直接使用仓库内 `Dockerfile` 构建，通常可以留空。

原因是 `Dockerfile` 已经自带默认启动命令：

```dockerfile
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8439"]
```

如果你在 ClawCloud 里想显式写一遍，也可以填：

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8439
```

### Environment Variables

当前项目基础运行不依赖必填环境变量。

所以这里可以先留空。

### Persistent Storage

当前项目默认也不依赖持久化卷。

所以可以先不挂载存储。

只有当你未来要保存用户上传文件、导出历史、数据库或日志时，才需要单独加存储卷。

## 第 6 步：点击部署

填写完成后，点击部署按钮。

部署后在应用详情页重点看三项：

- `Status`
- `Logs`
- `Public Address`

当状态变成 `running` 后，用 `Public Address` 打开网页即可。

## 第 7 步：如何验证是否部署成功

部署成功后，建议按这个顺序验证：

1. 打开主页 `/`
2. 看页面是否正常渲染
3. 测试导入 CSS / JSON / SVG
4. 测试导出 JSON / CSS / SVG
5. 测试导出 GIA

如果首页打不开，先去看日志。

如果首页能开，但导出失败，再分别看浏览器请求和应用日志。

## 常见问题排查

### 1. 应用一直起不来

优先检查：

- 镜像地址是否正确
- 镜像是否能被 ClawCloud 拉取
- 端口是否填成 `8439`
- 启动命令是否写错

### 2. 页面打开是 502 / 504

通常检查：

- 容器是不是已经 `running`
- uvicorn 是否真的监听了 `0.0.0.0:8439`
- ClawCloud 的外网访问是否开启

### 3. 镜像拉取失败

通常是：

- 镜像地址写错
- 仓库私有但没配置拉取凭证
- tag 不存在

### 4. 导出 GIA 失败

当前仓库已经内置 GIA 依赖，一般不需要额外处理。

如果仍然失败，请重点看日志里是否提到：

- `json_to_gia.py`
- `image_template.gia`
- 文件路径不存在

## 一条最短可执行路线

如果你只想最快跑起来，可以按这个最短流程做：

1. 本地执行：

```bash
docker build -t ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest .
docker push ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest
```

2. 打开 `https://console.run.claw.cloud`
3. 进入 `App Launchpad`
4. 新建应用
5. 填：
   - Image：`ghcr.io/<YOUR_GITHUB_USERNAME>/qianxing-image-editor-webui:latest`
   - Port：`8439`
   - External Access：开启
   - Startup Command：留空
6. 点击部署
7. 等状态变成 `running`
8. 打开 `Public Address`

## 参考资料

ClawCloud 官方文档：

- ClawCloud Run App Launchpad：
  - `https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad`
- 安装应用：
  - `https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad/install-application`
- 环境变量：
  - `https://docs.run.claw.cloud/clawcloud-run/guide/app-launchpad/environment-variables`

这些页面说明了 ClawCloud Run 当前推荐的容器部署方式、创建应用时可配置的字段，以及环境变量填写方式。
