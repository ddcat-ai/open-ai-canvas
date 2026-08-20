# 画布列表卡片设计调研报告

## 一、图片风格分析

### 核心设计元素识别

通过对提供的文件夹卡片图片分析，识别出以下关键设计特征：

#### 1. **玻璃拟态（Glassmorphism）效果**
- 半透明背景：使用 `backdrop-filter: blur()` 实现背景模糊
- 磨砂玻璃质感：白色半透明叠加层（rgba(255,255,255,0.1) ~ 0.15）
- 边框高光：顶部和左侧有微妙的白色边框（1px solid rgba(255,255,255,0.18)）

#### 2. **渐变网格背景（Gradient Mesh）**
- 每个卡片顶部有独特的渐变色带（红橙、蓝青、橙红等色系）
- 渐变呈现流动的、非线性的网格状分布
- 类似 macOS Ventura 的壁纸风格，具有深度和立体感
- 渐变从顶部向下过渡到白色/透明

#### 3. **多层阴影系统**
- **主阴影**：较大的扩散阴影 `0 8px 32px rgba(0,0,0,0.12)`
- **环境阴影**：模拟物理深度 `0 2px 8px rgba(0,0,0,0.06)`
- **内阴影**：卡片内部微妙的阴影增强立体感
- 悬停时阴影加深并向上提升：`transform: translateY(-4px)`

#### 4. **圆角处理**
- 大圆角设计：约 `16px - 20px` (r-2xl ~ r-3xl)
- 所有元素保持一致的圆角系统
- 内部按钮使用更小的圆角（8-12px）

#### 5. **布局结构**
- **三态展示**：
  1. 正常态（左上）：紧凑文件夹样式 + 悬浮按钮
  2. 堆叠态（右侧）：多层卡片堆叠效果，展示深度
  3. 展开态（左下）：完整信息展示 + 时间戳
  
#### 6. **交互反馈**
- 悬停提升效果（Y轴 -4px）
- 鼠标跟随的光泽效果（Glare）
- 3D 倾斜动画（轻微的 rotateX/rotateY）
- 按钮悬浮显示/隐藏

---

## 二、当前项目状态分析

### 现有组件架构

#### 1. **CanvasProjectCard** (`canvas-project-card.tsx`)
```typescript
// 当前结构
<article className="app-canvas-project-card">
  <div className="app-canvas-project-preview">
    <button className="canvas-project-preview-button">
      <ProjectPreview /> // 图片或节点预览
    </button>
    <span className="canvas-project-select">复选框</span>
    <div className="canvas-project-cover-meta">节点数量</div>
  </div>
  <div className="app-canvas-project-body">
    <h2>标题</h2>
    <div className="canvas-project-stats">时间/类型</div>
  </div>
</article>
```

**当前特点**：
- 扁平化设计，缺少层次感
- 简单的边框和阴影
- 预览区域占比大（aspect-video）
- 无玻璃拟态效果
- 无渐变背景装饰

#### 2. **CometCard** (`comet-card.tsx`)
**已有能力**：
- ✅ 3D 倾斜动画（rotateX/rotateY）
- ✅ 鼠标跟随效果
- ✅ 光泽层（glare）
- ✅ 悬停提升动画
- ✅ 平滑的弹簧动画

**缺少**：
- ❌ 玻璃拟态背景
- ❌ 渐变网格装饰
- ❌ 多层阴影系统

---

## 三、Aceternity UI 调研

### 相关组件清单

#### 1. **3D Card Effect**
- 组件路径：`/components/3d-card-effect`
- 功能：鼠标跟随的3D倾斜效果
- 与 CometCard 功能重叠，我们已有类似实现

#### 2. **Card Hover Effect**
- 组件路径：`/components/card-hover-effect`
- 功能：悬停时的边框光晕和背景渐变
- 可借鉴：边框渐变的实现方式

#### 3. **Background Gradient**
- 组件路径：`/components/background-gradient`
- 功能：动态渐变背景
- **重要**：可用于卡片顶部的渐变网格效果

#### 4. **Meteors**
- 组件路径：`/components/meteors`
- 功能：流星划过的动画效果
- 可选：为卡片增加动态装饰

#### 5. **Glass Morphism**
- 虽然 Aceternity 没有专门的玻璃拟态组件
- 但在多个卡片组件中使用了 `backdrop-blur` 和半透明背景
- 需要自行实现

---

## 四、设计方案

### 方案 A：渐进式升级（推荐）

**目标**：在现有 CanvasProjectCard 基础上，逐步添加玻璃拟态和渐变效果。

#### 4.1 布局设计

**网格布局**：
```css
/* 响应式网格 */
.canvas-library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-6); /* 24px */
  padding: var(--space-6);
}

/* 断点优化 */
@media (min-width: 640px) {
  /* 2列：640px - 1024px */
  grid-template-columns: repeat(2, 1fr);
}

@media (min-width: 1024px) {
  /* 3列：1024px - 1440px */
  grid-template-columns: repeat(3, 1fr);
}

@media (min-width: 1440px) {
  /* 4列：>1440px */
  grid-template-columns: repeat(4, 1fr);
}
```

**每行显示数量**：
- 移动端（<640px）：1列（自适应宽度）
- 平板（640-1024px）：2列
- 桌面（1024-1440px）：3列
- 大屏（>1440px）：4列

#### 4.2 卡片尺寸

```typescript
// 卡片结构
<article className="canvas-card-folder">
  // 宽高比：16:10 (比现有的16:9更接近文件夹比例)
  // 最小宽度：280px
  // 最大宽度：360px（防止在大屏上过度拉伸）
</article>
```

**尺寸规范**：
- **宽度**：280-360px（由网格自动控制）
- **高度**：自适应（由内容决定）
- **预览区高度**：aspect-[16/10] (~175-225px)
- **内容区高度**：~80px（标题 + 元信息）

#### 4.3 视觉效果分层

```
[层级从底到顶]
├─ 1. 基础背景（白色/暗色，根据主题）
├─ 2. 渐变网格层（顶部装饰）
├─ 3. 玻璃拟态层（backdrop-blur + 半透明）
├─ 4. 内容层（文字、图标、预览）
├─ 5. 边框高光层（顶部和左侧）
└─ 6. 光泽层（hover时的glare效果）
```

---

## 五、CSS 实现方案

### 5.1 玻璃拟态基础样式

```css
.canvas-card-glass {
  position: relative;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--r-2xl); /* 16px */
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s ease;
}

/* 暗色主题 */
.dark .canvas-card-glass {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.canvas-card-glass:hover {
  transform: translateY(-4px);
  box-shadow: 
    0 16px 48px rgba(0, 0, 0, 0.18),
    0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
```

### 5.2 渐变网格装饰

```css
.canvas-card-gradient-mesh {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 120px;
  border-radius: var(--r-2xl) var(--r-2xl) 0 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.canvas-card-gradient-mesh::before {
  content: '';
  position: absolute;
  inset: 0;
  background: 
    radial-gradient(circle at 20% 30%, rgba(255, 100, 80, 0.6) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(100, 180, 255, 0.5) 0%, transparent 50%),
    radial-gradient(circle at 50% 70%, rgba(255, 180, 100, 0.4) 0%, transparent 60%);
  filter: blur(40px);
  opacity: 0.8;
}

.canvas-card-gradient-mesh::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, 
    rgba(255,255,255,0) 0%, 
    rgba(255,255,255,0.95) 80%
  );
}

/* 每张卡片随机不同的渐变色 */
.canvas-card-gradient-mesh[data-variant="1"]::before {
  background: 
    radial-gradient(circle at 25% 25%, rgba(255, 50, 100, 0.7) 0%, transparent 50%),
    radial-gradient(circle at 75% 30%, rgba(80, 120, 255, 0.6) 0%, transparent 50%);
}

.canvas-card-gradient-mesh[data-variant="2"]::before {
  background: 
    radial-gradient(circle at 30% 20%, rgba(0, 200, 180, 0.6) 0%, transparent 50%),
    radial-gradient(circle at 70% 40%, rgba(100, 255, 150, 0.5) 0%, transparent 50%);
}

.canvas-card-gradient-mesh[data-variant="3"]::before {
  background: 
    radial-gradient(circle at 20% 35%, rgba(255, 150, 0, 0.7) 0%, transparent 50%),
    radial-gradient(circle at 80% 25%, rgba(200, 50, 80, 0.6) 0%, transparent 50%);
}
```

### 5.3 完整卡片样式

```css
.canvas-card-folder {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 280px;
  cursor: pointer;
  isolation: isolate;
}

.canvas-card-folder-inner {
  position: relative;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--r-2xl);
  overflow: hidden;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.canvas-card-folder:hover .canvas-card-folder-inner {
  transform: translateY(-4px) scale(1.01);
  box-shadow: 
    0 16px 48px rgba(0, 0, 0, 0.18),
    0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

/* 预览区域 */
.canvas-card-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  z-index: 1;
}

.canvas-card-preview img,
.canvas-card-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.canvas-card-folder:hover .canvas-card-preview img,
.canvas-card-folder:hover .canvas-card-preview video {
  transform: scale(1.05);
}

/* 内容区域 */
.canvas-card-content {
  position: relative;
  padding: var(--space-4);
  z-index: 1;
}

.canvas-card-title {
  font-size: var(--fs-body);
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-neutral-900);
  margin-bottom: var(--space-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dark .canvas-card-title {
  color: var(--color-neutral-50);
}

.canvas-card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-caption);
  color: var(--color-neutral-600);
}

.dark .canvas-card-meta {
  color: var(--color-neutral-400);
}

/* 悬浮按钮 */
.canvas-card-action-button {
  position: absolute;
  bottom: var(--space-3);
  right: var(--space-3);
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  border-radius: var(--r-lg);
  color: white;
  opacity: 0;
  transform: translateY(8px);
  transition: all 0.25s ease;
  z-index: 10;
}

.canvas-card-folder:hover .canvas-card-action-button {
  opacity: 1;
  transform: translateY(0);
}

.canvas-card-action-button:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.1);
}
```

---

## 六、组件实现方案

### 6.1 新建组件：CanvasFolderCard

```tsx
// web/src/components/canvas/canvas-folder-card.tsx

import { motion } from "motion/react";
import { Plus, MoreHorizontal } from "lucide-react";
import { CometCard } from "@/components/ui/aceternity/comet-card";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

interface CanvasFolderCardProps {
  project: CanvasProject;
  variant?: number; // 1-3，决定渐变色方案
  onClick?: () => void;
  onAction?: () => void;
}

export function CanvasFolderCard({ 
  project, 
  variant = 1, 
  onClick, 
  onAction 
}: CanvasFolderCardProps) {
  return (
    <CometCard
      className="canvas-card-folder"
      glare={true}
      rotateDepth={3}
      translateDepth={3}
      onClick={onClick}
    >
      <div className="canvas-card-folder-inner">
        {/* 渐变网格装饰 */}
        <div 
          className="canvas-card-gradient-mesh" 
          data-variant={variant}
          aria-hidden="true"
        />
        
        {/* 预览区域 */}
        <div className="canvas-card-preview">
          <ProjectPreview project={project} />
        </div>
        
        {/* 内容区域 */}
        <div className="canvas-card-content">
          <h3 className="canvas-card-title">{project.title}</h3>
          <div className="canvas-card-meta">
            <span>{project.nodes.length} 节点</span>
            <span aria-hidden="true">·</span>
            <time dateTime={project.updatedAt}>
              {formatTime(project.updatedAt)}
            </time>
          </div>
        </div>
        
        {/* 悬浮按钮 */}
        <motion.button
          className="canvas-card-action-button"
          onClick={(e) => {
            e.stopPropagation();
            onAction?.();
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          aria-label="更多操作"
        >
          <MoreHorizontal className="size-5" />
        </motion.button>
      </div>
    </CometCard>
  );
}

// 预览组件保持原有逻辑
function ProjectPreview({ project }: { project: CanvasProject }) {
  // ... 复用现有的 ProjectPreview 逻辑
}

function formatTime(value: string) {
  // ... 复用现有的时间格式化逻辑
}
```

### 6.2 集成到现有页面

```tsx
// 在 pages/home/index.tsx 或 pages/canvas/index.tsx 中

import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";

// 替换现有的 CanvasProjectCard
<div className="canvas-library-grid">
  {canvasProjects.map((project, index) => (
    <CanvasFolderCard
      key={project.id}
      project={project}
      variant={(index % 3) + 1} // 循环使用3种渐变方案
      onClick={() => navigate(`/canvas/${project.id}`)}
      onAction={() => handleMore(project)}
    />
  ))}
</div>
```

---

## 七、技术要点

### 7.1 性能优化

```typescript
// 1. 渐变色方案预计算
const GRADIENT_VARIANTS = [
  { id: 1, colors: ['rgba(255,50,100,0.7)', 'rgba(80,120,255,0.6)'] },
  { id: 2, colors: ['rgba(0,200,180,0.6)', 'rgba(100,255,150,0.5)'] },
  { id: 3, colors: ['rgba(255,150,0,0.7)', 'rgba(200,50,80,0.6)'] },
];

// 2. 使用 CSS 变量动态注入
<div 
  style={{
    '--gradient-color-1': GRADIENT_VARIANTS[variant].colors[0],
    '--gradient-color-2': GRADIENT_VARIANTS[variant].colors[1],
  }}
/>

// 3. backdrop-filter 回退方案
@supports not (backdrop-filter: blur(12px)) {
  .canvas-card-folder-inner {
    background: rgba(255, 255, 255, 0.95); /* 完全不透明 */
  }
}
```

### 7.2 无障碍支持

```tsx
// 完整的 ARIA 标签
<article 
  role="button"
  tabIndex={0}
  aria-label={`画布：${project.title}，${project.nodes.length}个节点`}
  onClick={onClick}
  onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
>
  {/* ... */}
</article>
```

### 7.3 暗色主题适配

```css
/* 自动适配当前主题 */
@media (prefers-color-scheme: dark) {
  .canvas-card-folder-inner {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.12);
  }
  
  .canvas-card-gradient-mesh::after {
    background: linear-gradient(180deg, 
      rgba(10, 10, 15, 0) 0%, 
      rgba(10, 10, 15, 0.95) 80%
    );
  }
}
```

---

## 八、实施建议

### 阶段 1：基础重构（1-2天）
1. ✅ 创建 `CanvasFolderCard` 组件
2. ✅ 实现玻璃拟态样式
3. ✅ 集成 `CometCard` 实现3D效果
4. ✅ 调整网格布局为新的响应式方案

### 阶段 2：视觉增强（2-3天）
1. ✅ 添加渐变网格装饰层
2. ✅ 实现多层阴影系统
3. ✅ 优化悬停动画和过渡
4. ✅ 添加光泽层（glare effect）

### 阶段 3：细节打磨（1-2天）
1. ✅ 暗色主题适配
2. ✅ 无障碍测试和优化
3. ✅ 性能测试（backdrop-filter 的性能影响）
4. ✅ 跨浏览器兼容性测试

### 阶段 4：用户测试（1天）
1. ✅ A/B 测试（新旧卡片对比）
2. ✅ 收集用户反馈
3. ✅ 根据反馈微调

---

## 九、风险和注意事项

### 9.1 性能风险
- **backdrop-filter 性能消耗**：在大量卡片（50+）时可能影响滚动性能
  - 解决方案：使用虚拟滚动或懒加载
  - 回退方案：低性能设备禁用 backdrop-filter

### 9.2 兼容性
- **Safari < 15**：backdrop-filter 支持不完整
  - 解决方案：检测支持度，提供回退样式

### 9.3 可访问性
- 确保玻璃拟态效果不影响文字对比度（WCAG AA 标准：4.5:1）
- 光泽效果不应干扰屏幕阅读器

---

## 十、参考资源

### 设计灵感
- macOS Ventura 文件夹设计
- iOS 16+ 小组件玻璃拟态
- Figma Community: Glassmorphism UI Kit

### 技术文档
- [MDN: backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)
- [CSS Tricks: Glassmorphism](https://css-tricks.com/glassmorphism/)
- [Aceternity UI Components](https://ui.aceternity.com/components)

### 现有代码
- `/web/src/components/canvas/canvas-project-card.tsx`
- `/web/src/components/ui/aceternity/comet-card.tsx`
- `/web/src/styles/globals.css` (token system)

---

## 总结

这套设计方案结合了：
1. **玻璃拟态**的现代感和层次感
2. **渐变网格**的视觉吸引力和品牌差异化
3. **3D交互**的沉浸感（已有CometCard支持）
4. **响应式布局**的灵活性（1-4列自适应）

建议采用**渐进式升级**策略，先实现核心玻璃拟态效果，再逐步添加渐变装饰和高级交互，确保每个阶段都能交付可用版本。
