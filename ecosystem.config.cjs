const isWin = process.platform === "win32";

module.exports = {
  apps: [
    {
      name: "qx-img",
      // 每次 PM2 重启先构建前端，再启动 Uvicorn，确保 index.html 与 hash 资源同步。
      script: isWin ? "start.bat" : "./start.sh",
      args: "",
      cwd: isWin ? undefined : ".",
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
