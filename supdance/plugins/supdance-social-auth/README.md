# SupDance 统一第三方社交登录插件 (`supdance-social-auth`)

## 1. 插件概述
`supdance-social-auth` 是面向 SupDance 平台的统一第三方社交登录插件，支持：
1. **动态 IP 智能分区**：
   - 访问者来自中国大陆 IP 时，前台展示：QQ、微信、抖音、哔哩哔哩；
   - 访问者来自海外或港澳台地区 IP 时，前台展示：Google、X (Twitter)、Instagram、TikTok；
   - 前台支持无缝一键切换分区预览与登录，服务端严格鉴权防篡改。
2. **多形态前台页面适配**：
   - 官网沉浸式深色登录页（`supdance.com/zh/login`，对应图1）；
   - 主工作台经典浅色卡片登录页（`one.supdance.com/login`，对应图2）。
3. **后台统一配置中心**（对应图3）：
   - 支持各平台 Client ID / App ID、Client Secret / App Secret 编辑；
   - 敏感密钥掩码回显与高强度对称加密存储（AES-GCM）；
   - 回调地址一键复制；
   - 连通性测试（Ping Test）；
   - QQ / 抖音 / B站沙盒 Mock 联调测试开关与自动化回调。

## 2. 运行时结构
- 后端：`backend/internal/supdance/socialauth/`
- 前端：`web/src/supdance/plugins/social-auth/`
- 路由挂载：`/zh/login`, `/login`, `/admin/settings/social-auth`
