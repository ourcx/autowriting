module.exports = {
  apps: [{
    name: 'autowriting',
    // 后端入口为 server.ts（TypeScript），通过 tsx interpreter 运行
    // 注意：不要改为 server.js，项目不编译 TS 为 JS
    // 如果 PM2 报 ERR_MODULE_NOT_FOUND: server.js，说明缓存了旧进程配置
    // 解决：pm2 delete autowriting && pm2 start ecosystem.config.cjs
    script: './server.ts',

    // 使用 tsx 运行 TypeScript（项目后端为 .ts，未编译为 .js）
    interpreter: './node_modules/.bin/tsx',

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