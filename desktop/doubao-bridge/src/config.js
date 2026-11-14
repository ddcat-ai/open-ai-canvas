'use strict';
/* 配置加载 —— config.json + 环境变量覆盖（多实例部署）
 * 多账号形态：每个账号有独立的 Electron Chromium session partition：
 *   BRIDGE_PORT         监听端口（默认 config.port）
 *   BRIDGE_HOST         监听地址（默认 config.host）
 *   BRIDGE_PROFILE_DIR  账号会话数据目录（用于旧数据迁移与账号注册表）
 */
const base = require('../config.json');
const config = JSON.parse(JSON.stringify(base));

if (process.env.BRIDGE_PORT) config.port = parseInt(process.env.BRIDGE_PORT, 10);
if (process.env.BRIDGE_HOST) config.host = process.env.BRIDGE_HOST;
if (process.env.BRIDGE_ADMIN_TOKEN) config.adminToken = process.env.BRIDGE_ADMIN_TOKEN;

module.exports = config;
