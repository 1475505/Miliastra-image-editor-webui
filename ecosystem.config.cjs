const isWin = process.platform === "win32";

module.exports = {
  apps: [
    {
      name: "qx-img",
      script: isWin ? "start.bat" : "./start.sh",
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
