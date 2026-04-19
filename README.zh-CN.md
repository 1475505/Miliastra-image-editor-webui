# Miliastra Image Editor WebUI

[English README](README.md)

使用请遵守奇匠守则。不要生成任何不适宜的内容，不要侵权。

## 快速开始

运行环境说明：当前仓库按 Python `3.13` 部署运行。由于项目使用了 Python 3.13 相关的 `.pyc` 构建产物，为避免跨版本兼容问题，请统一使用 Python `3.13`。

### 1. Windows 本地启动

```powershell
start.bat
```

启动后访问：`http://localhost:8439`

### 2. Linux / macOS 本地启动

```bash
chmod +x start.sh
./start.sh
```

启动后访问：`http://localhost:8439`

### 3. Python 环境

后端需要 Python 虚拟环境。`start.sh` 会自动创建 `.venv`，但如果你手动启动后端，需先执行：

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> **注意：** 项目按 **Python 3.13** 设计。如果你的系统默认 Python 版本不同，请确保上面的 `python3` 指向 3.13。

### 4. 前后端开发模式

后端：

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

开发地址：

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:8000`

### 4. 构建前端静态资源

```powershell
cd frontend
npm install
npm run build
```

构建产物会写入 `backend/app/static/`。

> **部署注意：** 如果你要构建 Docker 镜像或部署到生产环境，请先执行此步骤，确保 `backend/app/static/` 中包含最新的前端构建产物。

### 5. 更多文档

- 项目主体说明：[docs/README.md](docs/README.md)
- ClawCloud 部署说明：[docs/deploy.md](docs/deploy.md)
