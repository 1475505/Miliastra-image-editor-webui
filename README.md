# Miliastra Image Editor WebUI

[中文 README](README.zh-CN.md)

## How To Get Started

Runtime note: deploy with Python `3.13`. This repository currently assumes Python 3.13 compatibility for bundled Python build artifacts.

### 1. Local run on Windows

```powershell
start.bat
```

The app will start at `http://localhost:8439`.

### 2. Local run on Linux / macOS

```bash
chmod +x start.sh
./start.sh
```

The app will start at `http://localhost:8439`.

### 3. Frontend development mode

Backend:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Development URLs:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`

### 4. Build frontend static files

```powershell
cd frontend
npm install
npm run build
```

This writes the built frontend into `backend/app/static/`.

More documentation is in [docs/README.md](docs/README.md) and [docs/deploy.md](docs/deploy.md).
