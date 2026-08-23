# 模型目录开关功能部署指南

## 问题修复

已解决以下问题：
1. ✅ 后端路由未注册 - 已在 `cmd/server/main.go` 中注册 `RegisterModelCatalogRoutes`
2. ✅ 前端初始化仍调用旧接口 - 已修改 `user-session.ts` 在登录和刷新时调用统一目录接口
3. ✅ 前端菜单未根据开关隐藏 - 已修改 `admin-shell.tsx` 根据 `frontendModelsEnabled` 过滤菜单
4. ✅ 路由未拦截直接访问 - 已在 `router.tsx` 中添加 `RequireFeature` 检查

## 部署步骤

### 1. 重新编译后端

```bash
cd /Users/catdd/Desktop/work/infinite-canvas/backend
go build -o bin/server ./cmd/server
```

### 2. 重启后端服务

```bash
# 停止当前服务
pkill -f "infinite-canvas.*server"

# 启动新服务
./bin/server
```

### 3. 验证后端接口

```bash
# 测试统一目录接口
curl http://localhost:3000/api/model-catalog

# 应该返回类似：
# {
#   "source": "frontend",
#   "models": [...]
# }
```

### 4. 编译前端

```bash
cd /Users/catdd/Desktop/work/infinite-canvas/web
npm run build
```

### 5. 刷新浏览器

清除浏览器缓存并刷新页面，确保加载最新的前端代码。

## 功能测试

### 测试场景 1：前台模型开启（默认）

1. 登录管理后台
2. 进入"功能开放"页面
3. 确认"前台模型"开关为**开启**状态
4. 观察左侧菜单：应显示"前台模型"菜单项
5. 进入创作页面，查看模型选择器：应显示前台模型
6. 创建任务：应使用 `logicalModelId`

### 测试场景 2：关闭前台模型

1. 在"功能开放"页面，点击"前台模型"开关关闭
2. 确认二次确认对话框，点击"确认关闭"
3. 观察左侧菜单：**"前台模型"菜单项应消失**
4. 尝试直接访问 `/admin/models`：应显示"前台模型暂未开放"提示
5. 刷新页面，进入创作页面
6. 查看模型选择器：**应显示系统渠道中的模型**（不再是前台模型）
7. 创建任务：应使用 `channelId + model`（不再有 logicalModelId）

### 测试场景 3：重新开启前台模型

1. 在"功能开放"页面，点击"前台模型"开关开启
2. 观察左侧菜单：应重新显示"前台模型"菜单项
3. 刷新页面，进入创作页面
4. 查看模型选择器：应重新显示前台模型

## 关键验证点

### ✓ 管理后台
- [ ] "管理后台功能"卡片正常显示
- [ ] "前台模型"开关可以正常切换
- [ ] 关闭时显示二次确认对话框
- [ ] 关闭后左侧菜单隐藏"前台模型"项
- [ ] 开启后左侧菜单显示"前台模型"项

### ✓ 用户端（前台模型开启）
- [ ] 模型选择器显示前台模型列表
- [ ] 创建任务时带 `logicalModelId`
- [ ] 任务正常执行

### ✓ 用户端（前台模型关闭）
- [ ] 模型选择器显示系统渠道模型列表
- [ ] 创建任务时带 `channelId + model`，不带 `logicalModelId`
- [ ] 任务正常执行
- [ ] 刷新页面后仍然显示系统渠道模型

### ✓ 接口调用
- [ ] `/api/model-catalog` 返回正确的数据
- [ ] 开启时 `source: "frontend"`
- [ ] 关闭时 `source: "system"`

## 常见问题排查

### 问题1：接口返回 404
**原因**：后端未重启或路由未注册
**解决**：
```bash
# 确认路由注册
grep "RegisterModelCatalogRoutes" /Users/catdd/Desktop/work/infinite-canvas/backend/cmd/server/main.go

# 重新编译并重启
cd backend
go build -o bin/server ./cmd/server
./bin/server
```

### 问题2：关闭开关后仍显示前台模型
**原因**：前端未刷新或浏览器缓存
**解决**：
1. 硬刷新浏览器（Cmd+Shift+R / Ctrl+Shift+F5）
2. 清除浏览器缓存
3. 检查浏览器控制台是否有错误

### 问题3：菜单未隐藏
**原因**：前端代码未更新
**解决**：
```bash
cd web
npm run build
# 清除浏览器缓存并刷新
```

### 问题4：模型选择器为空
**原因**：系统渠道无可用模型或接口异常
**解决**：
1. 检查浏览器控制台网络请求
2. 查看 `/api/model-catalog` 返回的数据
3. 确认系统渠道中有启用且配置价格的模型

## API 对照表

| 场景 | 旧接口 | 新接口 | 返回数据 |
|------|--------|--------|----------|
| 前台模型开启 | `/api/models` | `/api/model-catalog` | `{source:"frontend", models:[...]}` |
| 前台模型关闭 | - | `/api/model-catalog` | `{source:"system", channels:[...]}` |

## 数据流图

### 前台模型开启
```
用户登录
  ↓
前端调用 /api/model-catalog
  ↓
后端检查 frontendModelsEnabled = true
  ↓
返回 {source:"frontend", models:[前台模型]}
  ↓
前端加载前台模型到选择器
  ↓
用户创建任务（带 logicalModelId）
```

### 前台模型关闭
```
用户登录
  ↓
前端调用 /api/model-catalog
  ↓
后端检查 frontendModelsEnabled = false
  ↓
返回 {source:"system", channels:[系统渠道模型]}
  ↓
前端加载系统渠道模型到选择器
  ↓
用户创建任务（带 channelId + model）
```

## 文件修改清单

### 后端
- ✅ `cmd/server/main.go` - 注册路由
- ✅ `internal/handler/model_catalog.go` - 新增统一目录接口
- ✅ `internal/service/model_catalog.go` - 实现目录逻辑
- ✅ `internal/service/task_creation.go` - 任务创建分流
- ✅ `internal/service/feature_availability.go` - 添加开关

### 前端
- ✅ `services/api/logical-models.ts` - 新增API函数
- ✅ `lib/user-session.ts` - 调用统一目录接口
- ✅ `stores/use-user-store.ts` - 添加类型定义
- ✅ `pages/admin/components/feature-availability-panel.tsx` - 添加开关UI
- ✅ `pages/admin/components/admin-shell.tsx` - 菜单过滤
- ✅ `components/auth/require-feature.tsx` - 添加权限检查
- ✅ `router.tsx` - 路由拦截

## 下一步工作

1. [ ] 数据库迁移（创建 logical_model_price_skus 表）
2. [ ] 编写单元测试
3. [ ] 压力测试
4. [ ] 文档更新

---

**创建时间**: 2026-08-22
**状态**: 待部署测试
