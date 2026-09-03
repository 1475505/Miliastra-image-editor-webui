const isWin = process.platform === "win32";

module.exports = {
  apps: [
    {
      name: "qx-img",
      // 直接跑 uvicorn：pm2 重启不再触发 npm install / npm run build / pip install，
      // 避免每次重启 2-3 分钟不可用 + 前端 hash 抖动导致 404 白屏。手动部署用 ./start.sh。
      script: isWin ? "start.bat" : "./backend/.venv/bin/python",
      args: isWin ? "" : "-m uvicorn app.main:app --host 0.0.0.0 --port 8439",
      cwd: isWin ? undefined : "./backend",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
