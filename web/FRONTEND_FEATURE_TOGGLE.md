# 前端功能开关维护页面修改说明

## 修改内容

### 1. 类型定义更新

**文件**: `web/src/stores/use-user-store.ts`

在 `FeatureAvailability` 类型中添加了 `frontendModelsEnabled` 字段：

```typescript
export type FeatureAvailability = {
    shortDramaEnabled: boolean;
    taskCenterEnabled: boolean;
    creditsEnabled: boolean;
    customChannelsEnabled: boolean;
    frontendModelsEnabled: boolean;  // 新增
    desktopLocalChannelsEnabled: boolean;
    configured?: boolean;
    updatedBy?: string;
    updatedAt?: string;
};
```

默认值设置为 `true`：

```typescript
export const defaultFeatureAvailability: FeatureAvailability = {
    shortDramaEnabled: true,
    taskCenterEnabled: true,
    creditsEnabled: true,
    customChannelsEnabled: true,
    frontendModelsEnabled: true,  // 新增
    desktopLocalChannelsEnabled: false,
};
```

### 2. 管理界面更新

**文件**: `web/src/pages/admin/components/feature-availability-panel.tsx`

#### 添加图标导入
```typescript
import { Sparkles } from "lucide-react";
```

#### 扩展 FeatureKey 类型
```typescript
type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled";
```

#### 添加功能配置项
在 `featureRows` 数组中添加了新的配置项：

```typescript
{ 
    key: "frontendModelsEnabled", 
    title: "前台模型目录", 
    menu: "/admin/models", 
    description: "开启时使用前台模型虚拟渠道（需配置路由），关闭时使用脱敏的系统渠道模型。管理员的模型配置入口始终保留。", 
    icon: <Sparkles className="size-4" /> 
}
```

#### 更新保存函数
在 `save` 函数中添加了对新字段的支持：

```typescript
const result = await updateAdminFeatureAvailability({
    shortDramaEnabled: next.shortDramaEnabled,
    taskCenterEnabled: next.taskCenterEnabled,
    creditsEnabled: next.creditsEnabled,
    customChannelsEnabled: next.customChannelsEnabled,
    frontendModelsEnabled: next.frontendModelsEnabled,  // 新增
});
```

#### 添加切换确认逻辑
在 `toggle` 函数中添加了关闭前台模型时的二次确认：

```typescript
// 前台模型关闭需要二次确认
if (key === "frontendModelsEnabled" && !enabled) {
    modal.confirm({
        title: "切换到系统渠道模型？",
        content: "关闭后，用户将使用脱敏的系统渠道模型目录，任务创建时将禁止 logicalModelId。管理员的前台模型配置入口保持可见。",
        okText: "确认切换",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => save(key, false),
    });
    return;
}
```

## 用户界面效果

### 功能开关面板

在"功能开放"页面（`/admin/features`）中，会显示一个新的开关项：

- **图标**: ✨ (Sparkles)
- **标题**: 前台模型目录
- **菜单路径**: /admin/models
- **描述**: 开启时使用前台模型虚拟渠道（需配置路由），关闭时使用脱敏的系统渠道模型。管理员的模型配置入口始终保留。
- **默认状态**: 开启（true）

### 交互流程

1. **开启前台模型**
   - 点击开关即可开启
   - 用户侧将使用前台模型虚拟渠道
   - 任务创建必须提供 `logicalModelId`

2. **关闭前台模型**
   - 点击开关会弹出确认对话框
   - 确认后切换到系统渠道模型模式
   - 用户侧将使用脱敏的系统渠道模型目录
   - 任务创建禁止 `logicalModelId`

3. **管理员权限**
   - 无论开关状态如何，管理员的 `/admin/models` 入口始终保留
   - 管理员可以随时查看和配置前台模型

## 视觉设计

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户功能开放                                      5/5 已开放    │
├─────────────────────────────────────────────────────────────────┤
│ 🎬 短剧创作                          /projects            [ON]  │
│    关闭后隐藏短剧入口...                                        │
├─────────────────────────────────────────────────────────────────┤
│ ☑️  任务                            /tasks                [ON]  │
│    关闭后仅隐藏并拦截任务中心页面...                            │
├─────────────────────────────────────────────────────────────────┤
│ 💰 积分中心                          /wallet               [ON]  │
│    关闭后隐藏用户积分入口...                                    │
├─────────────────────────────────────────────────────────────────┤
│ 📡 自定义渠道                        /settings?section... [ON]  │
│    关闭后隐藏用户自定义渠道入口...                              │
├─────────────────────────────────────────────────────────────────┤
│ ✨ 前台模型目录                      /admin/models        [ON]  │
│    开启时使用前台模型虚拟渠道（需配置路由），                  │
│    关闭时使用脱敏的系统渠道模型...                              │
└─────────────────────────────────────────────────────────────────┘
```

## 后端 API 适配

后端 API 已经支持 `frontendModelsEnabled` 字段：

- `GET /api/admin/feature-availability` - 读取配置（包含新字段）
- `PUT /api/admin/feature-availability` - 更新配置（接受新字段）

## 测试建议

1. **开关切换测试**
   - 测试开启/关闭前台模型开关
   - 验证二次确认对话框是否正常显示
   - 验证保存后状态是否正确更新

2. **权限测试**
   - 验证只有管理员可以访问此页面
   - 验证非管理员无法修改此配置

3. **联动测试**
   - 开启前台模型后，验证用户侧模型选择器是否使用前台模型
   - 关闭前台模型后，验证用户侧模型选择器是否使用系统渠道模型
   - 验证管理员的 `/admin/models` 入口在两种模式下都可访问

4. **数据持久化测试**
   - 修改配置后刷新页面，验证配置是否保存
   - 验证配置在用户登录时正确加载

## 注意事项

1. **后端同步**: 前端修改依赖后端 API 支持，确保后端已部署相关更新
2. **缓存清理**: 修改后建议清理浏览器缓存以确保类型更新生效
3. **用户影响**: 切换模型模式会影响所有用户的模型选择界面，建议在低峰时段操作
4. **回滚方案**: 如遇问题，可以通过管理界面快速切换回原模式

## 文件清单

### 修改的文件
- `web/src/stores/use-user-store.ts` - 添加类型定义和默认值
- `web/src/pages/admin/components/feature-availability-panel.tsx` - 添加UI和交互逻辑

### 依赖的后端文件
- `internal/service/feature_availability.go` - 后端功能开关服务

---

**修改日期**: 2026-08-22
**影响范围**: 管理员功能开关页面
**用户影响**: 无，仅管理员可见
