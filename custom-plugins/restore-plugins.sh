#!/bin/bash
# 影策自定义协议插件一键恢复脚本
# 使用方法: ./restore-plugins.sh [backend_url] [username] [password]
# 默认: ./restore-plugins.sh http://127.0.0.1:3100 lmj881029 Yingce@2026

set -e

BACKEND_URL="${1:-http://127.0.0.1:3100}"
USERNAME="${2:-lmj881029}"
PASSWORD="${3:-Yingce@2026}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIE_FILE="/tmp/yingce_restore_cookies.txt"

echo "=== 影策自定义协议插件恢复工具 ==="
echo "后端地址: $BACKEND_URL"
echo "用户名: $USERNAME"
echo ""

# 登录
echo "1. 登录..."
curl -s -c "$COOKIE_FILE" -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" > /dev/null
echo "   登录完成"

# 插件列表
PLUGINS=("hongniao-video" "hongniao-image" "grsai-image" "agnes-image")

echo ""
echo "2. 上传并启用插件..."
for plugin in "${PLUGINS[@]}"; do
  PLUGIN_FILE="$SCRIPT_DIR/$plugin.yingce-plugin"
  if [ ! -f "$PLUGIN_FILE" ]; then
    echo "   ⚠️  $plugin: 插件文件不存在，跳过"
    continue
  fi
  
  echo -n "   $plugin: 上传中..."
  RESULT=$(curl -s -b "$COOKIE_FILE" -X POST "$BACKEND_URL/api/plugins" \
    -F "file=@$PLUGIN_FILE" 2>&1)
  CODE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code', -1))" 2>/dev/null || echo "-1")
  
  if [ "$CODE" = "0" ]; then
    echo -n " 上传成功，启用中..."
    ENABLE_RESULT=$(curl -s -b "$COOKIE_FILE" -X POST "$BACKEND_URL/api/plugins/$plugin/enable" 2>&1)
    ENABLE_CODE=$(echo "$ENABLE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code', -1))" 2>/dev/null || echo "-1")
    if [ "$ENABLE_CODE" = "0" ]; then
      echo " 启用成功 ✅"
    else
      echo " 启用失败 ⚠️"
    fi
  else
    echo " 上传失败 ❌"
    echo "   错误: $RESULT" | head -c 200
    echo ""
  fi
done

echo ""
echo "3. 验证插件状态..."
curl -s -b "$COOKIE_FILE" "$BACKEND_URL/api/plugins" 2>&1 | python3 -c "
import sys, json
d = json.load(sys.stdin)
plugins = d.get('data', {}).get('plugins', [])
custom_ids = ["hongniao-video", "hongniao-image", "grsai-image", "agnes-image"]
for p in plugins:
    m = p.get('manifest', {})
    if m.get('id') in custom_ids:
        state = p.get('state', {})
        status = '✅' if state.get('effectiveEnabled') else '❌'
        print(f'   {status} {m.get(\"id\")}: {m.get(\"name\")} v{m.get(\"version\")}')
"

echo ""
echo ""
echo "4. 启用官方 Agnes Video 2.5 插件..."
curl -s -b "$COOKIE_FILE" -X POST "$BACKEND_URL/api/plugins/agnes-video-25/enable" > /dev/null 2>&1
echo "   官方 agnes-video-25 插件已启用"

echo "=== 恢复完成 ==="
echo "提示: 渠道和模型配置存储在数据库中，更新影策后如数据库未重置则无需重新配置。"
echo "如需重新配置渠道，请参考 channel-config-backup/ 目录下的备份文件。"

# 清理
rm -f "$COOKIE_FILE"
