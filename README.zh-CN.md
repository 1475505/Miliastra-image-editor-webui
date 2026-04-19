# Miliastra Image Editor WebUI

[English README](README.md)

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

### 3. 前后端开发模式

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

### 5. 更多文档

- 项目主体说明：[docs/README.md](docs/README.md)
- ClawCloud 部署说明：[docs/deploy.md](docs/deploy.md)
