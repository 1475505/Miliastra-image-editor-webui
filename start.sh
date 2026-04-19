#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"
REQ_FILE="$BACKEND_DIR/requirements.txt"

cd "$BACKEND_DIR"

# 创建虚拟环境（如果不存在）
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# 安装/更新依赖
echo "Installing dependencies..."
"$VENV_DIR/bin/pip" install -r "$REQ_FILE"

# 启动服务
echo "Starting uvicorn on 0.0.0.0:8439..."
"$VENV_DIR/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 8439
