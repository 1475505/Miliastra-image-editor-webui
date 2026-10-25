#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"
REQ_FILE="$BACKEND_DIR/requirements.txt"

# PM2 可能保留已失效的 fnm_multishells 临时 PATH，回退到稳定的默认版本。
if ! command -v npm >/dev/null 2>&1; then
    FNM_DEFAULT_BIN="${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}/aliases/default/bin"
    if [ -x "$FNM_DEFAULT_BIN/npm" ] && [ -x "$FNM_DEFAULT_BIN/node" ]; then
        export PATH="$FNM_DEFAULT_BIN:$PATH"
    fi
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm not found. Install Node.js 20+ or refresh PM2 PATH with pm2 restart qx-img --update-env." >&2
    exit 1
fi

cd "$BACKEND_DIR"

# 创建虚拟环境（如果不存在）
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# pip skips already satisfied requirements and installs missing dependencies.
"$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"

echo "Building frontend..."
cd "$FRONTEND_DIR"
# 启动时需要 TypeScript/Vite；即使 NODE_ENV=production 也必须安装构建依赖。
npm ci --include=dev --no-audit --no-fund
npm run build
cd "$BACKEND_DIR"

# 启动服务
echo "Starting uvicorn on 0.0.0.0:8439..."
exec "$VENV_DIR/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8439
