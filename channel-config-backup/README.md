# 影策渠道配置备份与恢复

本目录包含影策项目所有中转站渠道和模型的配置备份，以及一键恢复脚本。

## 包含的渠道

| 渠道ID | 渠道名称 | API地址 | 模型数量 | 类型 |
|--------|----------|---------|----------|------|
| CHANNEL_000005 | 红鸟AI | https://open.hongniaoai.com | 7 | 视频+图像 |
| CHANNEL_000006 | Grsai AI | https://grsai.dakka.com.cn | 5 | 图像 |
| CHANNEL_000007 | A6API | https://api.a6api.com/v1 | 16 | 文本 |
| CHANNEL_000008 | Agnes AI | https://apihub.agnes-ai.com/v1 | 4 | 文本+图像+视频 |
| CHANNEL_000009 | 米塔AI (metaso) | https://metaso.cn/api/minimax | 1 | 视频 |

## 文件说明

- `channels.sql` - 渠道配置数据（model_channels表）
- `models.sql` - 模型配置数据（channel_models表）
- `restore.sh` - 一键恢复脚本
- `README.md` - 本文档

## 恢复方法

### 方法一：使用恢复脚本（推荐）

```bash
cd /Users/linmengjiang/open-ai-canvas/channel-config-backup
./restore.sh
```

脚本会自动：
1. 检查Docker容器状态
2. 显示当前渠道配置
3. 软删除现有配置
4. 恢复渠道和模型数据
5. 重启后端容器

### 方法二：手动恢复

```bash
# 1. 软删除现有配置
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas << 'EOF'
UPDATE model_channels SET deleted_at = NOW() WHERE deleted_at IS NULL;
UPDATE channel_models SET deleted_at = NOW() WHERE deleted_at IS NULL;
EOF

# 2. 恢复渠道数据
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas < channels.sql

# 3. 恢复模型数据
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas < models.sql

# 4. 重启后端
cd /Users/linmengjiang/open-ai-canvas
docker compose --env-file .env -f docker-compose.deploy.yml -f docker-compose.build.yml restart backend
```

## 更新备份

当你添加或修改了渠道/模型配置后，重新运行导出命令更新备份：

```bash
cd /Users/linmengjiang/open-ai-canvas/channel-config-backup

# 导出渠道
docker exec open-ai-canvas-postgres-1 pg_dump -U open_ai_canvas -d open_ai_canvas \
  --data-only --table=model_channels --column-inserts > channels.sql

# 导出模型
docker exec open-ai-canvas-postgres-1 pg_dump -U open_ai_canvas -d open_ai_canvas \
  --data-only --table=channel_models --column-inserts > models.sql
```

## 注意事项

1. **API密钥安全**：SQL文件中包含各渠道的API Key，请妥善保管，不要提交到公开仓库
2. **协议适配器**：红鸟、Grsai、Agnes的协议适配器在代码中（backend/internal/protocol/builtin.go），更新影策后需要确保这些代码仍然存在
3. **环境变量**：确保 .env 文件中 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS 包含所有中转域名
4. **数据库版本**：恢复前确保数据库schema版本与备份时一致
