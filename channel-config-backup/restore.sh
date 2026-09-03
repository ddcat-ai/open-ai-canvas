#!/bin/bash
# 影策渠道配置恢复脚本
# 使用方法: ./restore.sh
# 注意: 执行前请确保影策Docker容器已启动

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  影策渠道配置恢复工具"
echo "=========================================="
echo ""

# 检查Docker容器是否运行
if ! docker ps | grep -q "open-ai-canvas-postgres"; then
    echo "❌ 错误: 未找到 open-ai-canvas-postgres 容器"
    echo "请先启动影策Docker容器: docker compose up -d"
    exit 1
fi

echo "✅ 检测到PostgreSQL容器运行中"
echo ""

# 显示当前渠道
echo "当前数据库中的渠道:"
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas -c "
SELECT id, name, base_url, enabled FROM model_channels WHERE deleted_at IS NULL ORDER BY id;
" 2>/dev/null || echo "  (无渠道)"
echo ""

# 确认恢复
read -p "确认要恢复渠道配置吗？这将覆盖现有配置 (y/N): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "已取消恢复"
    exit 0
fi

echo ""
echo "正在恢复渠道配置..."

# 先删除现有渠道（软删除）
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas << 'EOF'
UPDATE model_channels SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL;
UPDATE channel_models SET deleted_at = NOW(), updated_at = NOW() WHERE deleted_at IS NULL;
EOF

# 恢复渠道数据
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas < channels.sql

# 恢复模型数据
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas < models.sql

echo ""
echo "✅ 渠道配置恢复完成!"
echo ""

# 显示恢复后的渠道
echo "恢复后的渠道:"
docker exec -i open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas -c "
SELECT c.id, c.name, c.base_url, c.enabled,
       COUNT(m.id) as model_count
FROM model_channels c
LEFT JOIN channel_models m ON c.id = m.channel_id AND m.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.base_url, c.enabled
ORDER BY c.id;
"

echo ""
echo "正在重启后端容器使配置生效..."
cd /Users/linmengjiang/open-ai-canvas
docker compose --env-file .env -f docker-compose.deploy.yml -f docker-compose.build.yml restart backend 2>/dev/null || echo "⚠️  后端重启失败，请手动重启"

echo ""
echo "=========================================="
echo "  恢复完成!"
echo "=========================================="
