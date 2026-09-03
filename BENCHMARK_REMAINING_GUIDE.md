# Storyboard Benchmark 剩余录制操作指南

## 当前状态
- 已完成：6/10（emotional baseline/director、dialogue baseline/director、action baseline/director）
- 待完成：4/10（reveal director/baseline、TVC baseline/director）
- 录制文件位置：`~/open-ai-canvas/benchmark-recordings/raw/`

## 环境信息
- 影策前端：http://127.0.0.1:3100
- 本地runtime端口：17371
- runtime启动命令：
  ```bash
  cd ~/open-ai-canvas/canvas-agent
  CODEX_CLI_PATH=/Applications/ChatGPT.app/Contents/Resources/codex \
  FRAMEFIELD_TRUSTED_WEB_ORIGINS='http://127.0.0.1:3100' \
  node dist/index.js > /tmp/canvas-agent.log 2>&1 &
  ```
- 已创建的projects：
  - reveal: `bf8o--s4xKTfRxiwsrxrtr`
  - TVC: `4RAU3oeXgQ18v6POcuW8la`

## 操作步骤（每个fixture+mode）

### 1. 准备
- 确保runtime正在运行：`ps aux | grep "node dist/index.js"`
- 确保浏览器已登录影策

### 2. 导航到对应canvas
- reveal: http://127.0.0.1:3100/canvas/bf8o--s4xKTfRxiwsrxrtr
- TVC: http://127.0.0.1:3100/canvas/4RAU3oeXgQ18v6POcuW8la

### 3. 打开Agent面板并连接
- 点击右侧"智能体"按钮
- 选择"本机"
- 点击"连接"
- 等待显示"已连接"

### 4. 设置benchmark模式（浏览器控制台执行）
```javascript
// director模式
localStorage.setItem('__benchmark_skill_mode', 'director');
localStorage.setItem('__benchmark_capture_enabled', '1');
localStorage.setItem('__benchmark_fixture_id', 'reveal-childhood-home'); // 或 'tvc-premium-ev'
localStorage.setItem('__benchmark_mode', 'storyboard-director');

// baseline模式
localStorage.setItem('__benchmark_skill_mode', 'baseline');
localStorage.setItem('__benchmark_capture_enabled', '1');
localStorage.setItem('__benchmark_fixture_id', 'reveal-childhood-home'); // 或 'tvc-premium-ev'
localStorage.setItem('__benchmark_mode', 'baseline');
```

### 5. 新建对话并发送prompt
- 点击"新建对话"
- 粘贴对应fixture的prompt（见下方）
- 点击"发送"

### 6. 及时点击"批准执行"
- 当出现"批准执行"按钮时，立即点击
- 可能会出现多次，每次都要点击

### 7. 等待执行完成
- 等待显示"执行完成"
- 不要中途刷新页面

### 8. 验证结果
```bash
# 检查shots数量（director应该>0，baseline应该=0）
docker exec open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas -c \
  "SELECT COUNT(*) FROM shots WHERE project_id='<canvas_id>';"

# 检查最新的Codex会话
ls -t ~/.codex/sessions/2026/09/03/*.jsonl | head -1
```

### 9. 创建benchmark recording文件
```bash
# 获取shots数据（director模式）
docker exec open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas -t -A -c "
SELECT json_agg(json_build_object(
    'id', t.id, 'position', t.position, 'title', t.title,
    'description', t.plot_description, 'action', t.action,
    'dialogue', t.dialogue, 'shotSize', t.shot_size,
    'cameraAngle', t.camera_angle, 'cameraMovement', t.camera_movement,
    'durationMs', t.duration_ms, 'status', t.status
))
FROM (
    SELECT s.id, s.position, s.title, s.duration_ms, s.status,
           sr.plot_description, sr.action, sr.dialogue, sr.shot_size,
           sr.camera_angle, sr.camera_movement
    FROM shots s JOIN shot_revisions sr ON sr.shot_id = s.id
    WHERE s.project_id='<canvas_id>' ORDER BY s.position
) t;" > /tmp/shots.json

# 创建recording JSON（参考已有的recording文件格式）
```

## Fixture Prompts

### reveal-childhood-home（9个分镜，50秒）
```
一个女人回到童年故居，寻找一张老照片。她在照片里发现了第二个孩子——一个被刻意从所有家族故事中剪掉的人。她在空房子里寻找这个被遗忘的孩子的痕迹。拆成9个专业分镜，只做分镜，不生成图片或视频。总时长约50秒。重点：信息 withholding、细节特写、揭示时机、揭示后的反应、结尾节拍。
```

### tvc-premium-ev（8个分镜，30秒）
```
30秒高端电动车广告。品牌调性：高端、安静、智能。重点：智能驾驶、静谧座舱、不要纯功能罗列。拆成8个专业分镜，只做分镜，不生成图片或视频。总时长30秒。重点：产品英雄镜头、利益点叙事、总时长内的节奏、视觉变化、品牌导向结尾。
```

## 配对交错顺序（剩余4个）
7. reveal director
8. reveal baseline
9. TVC baseline
10. TVC director

## Sanity Check
- baseline的`effectiveSkillIds`必须不包含`storyboard-director`
- director的`effectiveSkillIds`必须恰好包含一次`storyboard-director`
- 如果失败，该配对数据作废，不进入评分

## 已完成的录制文件
- benchmark-emotional-convenience-store-baseline-1788357973538.json
- benchmark-emotional-convenience-store-storyboard-director-1788421448995.json
- benchmark-dialogue-former-partners-storyboard-director-17884260123N.json
- benchmark-dialogue-former-partners-baseline-17884267553N.json
- benchmark-action-courier-escape-baseline-17884277553N.json
- benchmark-action-courier-escape-storyboard-director-17884278983N.json
