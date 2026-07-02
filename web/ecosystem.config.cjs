module.exports = {
  apps: [{
    name: 'autowriting',
    script: './server.js',
    
    // 多实例配置（根据 CPU 核心数）
    instances: 2,  // 单核服务器用 1，多核可用 'max' 或具体数字
    exec_mode: 'fork',  // cluster 模式适合无状态应用
    
    // 自动重启策略
    autorestart: true,
    max_restarts: 10,  // 10 次重启后停止（防止无限重启）
    min_uptime: '10s',  // 至少运行 10 秒才算成功启动
    max_memory_restart: '500M',  // 内存超过 500M 自动重启
    
    // 环境变量
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // 日志配置
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 优雅退出
    kill_timeout: 5000,  // 5 秒后强制杀死
    listen_timeout: 3000,  // 3 秒内未监听端口视为启动失败
    
    // 监控文件变化（生产环境关闭）
    watch: false,
    
    // cron 重启（可选，每天凌晨 4 点重启）
    // cron_restart: '0 4 * * *',
  }]
}