# Previs 预演台 UI 重构执行计划

## 执行原则

1. **严格按顺序执行**：每完成一个 Phase，运行验证命令通过后才继续下一个
2. **保持功能完整**：所有现有能力必须保留，E2E 测试必须通过
3. **增量提交**：每个 Phase 完成后独立提交，commit message 用 conventional-commits skill
4. **视觉优先**：UI 必须高端、有质感、专业，参考 Blender / Unreal / Unity 的深色专业界面

## 当前问题诊断

### P0 缺陷
1. **画布卡片无缩略图**：`canvas-previs-node-panel.tsx` 只在已回写构图时显示 `<img>`，未回写时显示文字占位
2. **高频工作流功能不全**：缺少新建物品（盒子/球体/圆柱/平面）、灯光、相机的直接入口
3. **角色人偶材质单薄**：当前 `applyActorReferenceMaterial` 只是纯色 `MeshStandardMaterial`，无层次感
4. **整体布局陈旧**：间距、圆角、字号、层次、对比度不足，缺少高级感

### 设计目标
- **画布卡片**：实时 3D 缩略图（俯视/透视小视口），显示对象数/机位数/时长，玻璃态卡片
- **高频工作流**：覆盖 100% 高频操作，分组清晰（演员/道具/灯光/机位/姿态/颜色/运镜），大图标+文字
- **角色人偶**：程序化生成质感材质（fresnel rim、ambient occlusion 近似、subtle gradient），不同演员默认不同鲜明颜色，面板可改色
- **工作台布局**：深色玻璃态、更大间距、清晰层次、减少嵌套、增加留白

---

## Phase 1: 角色人偶材质升级（独立，无 UI 依赖）

### 目标
高质量程序化人偶材质，不依赖贴图，纯 shader 实现 rim light + 环境色 + 颜色差异化。

### 实现文件
- `web/src/components/canvas/previs/previs-viewport-rig.ts`

### 具体改动

#### 1.1 新增高级材质构造函数

在 `previs-viewport-rig.ts` 中，找到 `applyActorReferenceMaterial` 函数，**完全替换**为：

```typescript
/**
 * 为演员人偶应用程序化高质感材质：
 * - 基础颜色由 object.color 控制
 * - Fresnel rim light 提供轮廓光
 * - 微妙的顶部-底部渐变模拟天光与地面反射
 * - roughness 0.7 + metalness 0.05 产生柔和但有质感的反射
 */
export function applyActorReferenceMaterial(model: Object3D, baseColor: string) {
    const color = new Color(baseColor);
    
    // 构造自定义 ShaderMaterial 提供 rim + gradient
    const material = new ShaderMaterial({
        uniforms: {
            uBaseColor: { value: color },
            uRimColor: { value: new Color(0xffffff) },
            uRimPower: { value: 3.0 },
            uRimIntensity: { value: 0.35 },
            uTopColor: { value: new Color(0x87ceeb).multiplyScalar(0.15) },
            uBottomColor: { value: new Color(0x2c2c2c).multiplyScalar(0.3) },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying float vHeight;
            
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                vHeight = position.y;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uBaseColor;
            uniform vec3 uRimColor;
            uniform float uRimPower;
            uniform float uRimIntensity;
            uniform vec3 uTopColor;
            uniform vec3 uBottomColor;
            
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying float vHeight;
            
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                
                // Fresnel rim
                float rim = 1.0 - max(dot(normal, viewDir), 0.0);
                rim = pow(rim, uRimPower) * uRimIntensity;
                
                // 顶部-底部渐变（模拟天光）
                float heightFactor = clamp((vHeight + 0.5) / 2.0, 0.0, 1.0);
                vec3 ambientGradient = mix(uBottomColor, uTopColor, heightFactor);
                
                // 合成
                vec3 finalColor = uBaseColor + ambientGradient + rim * uRimColor;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
    });

    model.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh && !mesh.userData.previsNoMaterialOverride) {
            disposePrevisMaterials(mesh.material);
            mesh.material = material;
        }
    });
}

export function updateActorReferenceColor(model: Object3D, baseColor: string) {
    const color = new Color(baseColor);
    model.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh && mesh.material && "uniforms" in mesh.material) {
            const uniforms = (mesh.material as ShaderMaterial).uniforms;
            if (uniforms.uBaseColor) uniforms.uBaseColor.value = color;
        }
    });
}
```

#### 1.2 确保新演员自动分配不同颜色

在 `web/src/components/canvas/previs/canvas-previs-workbench.tsx` 中，找到 `addActor` 函数，确保：

```typescript
const addActor = () => {
    const existingActors = draft.objects.filter((obj) => obj.kind === "actor" || obj.primitive === "character");
    const colorIndex = existingActors.length % PREVIS_ACTOR_COLORS.length;
    const nextColor = PREVIS_ACTOR_COLORS[colorIndex];
    addObject(createPrevisActor(`演员 ${existingActors.length + 1}`, [0, 0, 0], nextColor));
};
```

#### 1.3 验证命令

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
node scripts/previs-p0-chrome-e2e.mjs
```

**通过标准**：TypeScript 无错误，Vite 构建成功，E2E 62/62 通过。

**提交**：
```bash
git add web/src/components/canvas/previs/previs-viewport-rig.ts web/src/components/canvas/previs/canvas-previs-workbench.tsx
# 用 conventional-commits skill 生成 message
```

---

## Phase 2: 画布节点卡片实时 3D 缩略图

### 目标
未回写构图时，画布卡片也能显示场景内容：渲染一个小的 3D 俯视图。

### 实现文件
- `web/src/components/canvas/previs/canvas-previs-node-panel.tsx`
- `web/src/components/canvas/previs/previs-mini-viewport.tsx` (新建)

### 具体改动

#### 2.1 新建 `previs-mini-viewport.tsx`

创建 `web/src/components/canvas/previs/previs-mini-viewport.tsx`：

```typescript
import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { Suspense } from "react";
import type { PrevisScene } from "@/types/previs";

/**
 * 画布卡片缩略图：固定俯视正交视角，只显示对象轮廓。
 * 不加载真实模型，用简化几何体代替，确保快速渲染。
 */
export function PrevisMiniViewport({ scene }: { scene: PrevisScene }) {
    return (
        <div className="relative h-full w-full overflow-hidden rounded-lg" style={{ background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)" }}>
            <Canvas gl={{ alpha: true, antialias: true }} dpr={[1, 1.5]}>
                <OrthographicCamera makeDefault position={[0, 8, 0]} zoom={50} up={[0, 0, -1]} />
                <ambientLight intensity={0.4} />
                <directionalLight position={[5, 10, 5]} intensity={0.6} />
                <Suspense fallback={null}>
                    <group rotation={[-Math.PI / 2, 0, 0]}>
                        <gridHelper args={[20, 20, "#444", "#222"]} position={[0, 0, 0]} />
                        {scene.objects.filter((obj) => obj.visible !== false).map((obj) => {
                            const pos = obj.transform.position;
                            const color = obj.color || "#d6d9dd";
                            const primitive = obj.primitive || "box";
                            
                            if (primitive === "sphere") {
                                return <mesh key={obj.id} position={[pos[0], pos[2], -pos[1]]}><sphereGeometry args={[0.5, 16, 16]} /><meshStandardMaterial color={color} roughness={0.7} metalness={0.1} /></mesh>;
                            }
                            if (primitive === "cylinder") {
                                return <mesh key={obj.id} position={[pos[0], pos[2], -pos[1]]}><cylinderGeometry args={[0.5, 0.5, 1, 16]} /><meshStandardMaterial color={color} roughness={0.7} metalness={0.1} /></mesh>;
                            }
                            if (primitive === "character" || obj.kind === "actor") {
                                return <mesh key={obj.id} position={[pos[0], pos[2], -pos[1]]}><capsuleGeometry args={[0.3, 1.2, 8, 16]} /><meshStandardMaterial color={color} roughness={0.7} metalness={0.1} /></mesh>;
                            }
                            // 默认 box
                            return <mesh key={obj.id} position={[pos[0], pos[2], -pos[1]]}><boxGeometry args={[0.8, 0.8, 0.8]} /><meshStandardMaterial color={color} roughness={0.7} metalness={0.1} /></mesh>;
                        })}
                    </group>
                </Suspense>
            </Canvas>
        </div>
    );
}
```

#### 2.2 改造 `canvas-previs-node-panel.tsx`

在 `EmptyPreview` 组件中，**替换** `loading ? "正在准备场景" : "尚未生成预览"` 的分支为：

```typescript
if (scene && scene.objects.length > 0) {
    return (
        <div className="relative h-full w-full overflow-hidden rounded-lg">
            <PrevisMiniViewport scene={scene} />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-md px-2 py-1 text-xs backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}>
                <Stat icon={<Box className="size-3" />} value={scene.objects.length} label="对象" />
                <Stat icon={<Camera className="size-3" />} value={scene.cameras.length} label="机位" />
                <Stat icon={<Lightbulb className="size-3" />} value={scene.lights.length} label="灯光" />
            </div>
        </div>
    );
}

return (
    <div className="grid h-full place-items-center gap-2 p-4 text-center" style={{ background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)" }}>
        <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-lg)]" style={{ background: theme.toolbar.activeBg }}>
            <Clapperboard className="size-4" style={{ color: theme.node.muted }} aria-hidden />
        </span>
        <span className="max-w-full truncate text-[var(--fs-tiny)] font-semibold" style={{ color: theme.node.text }}>{loading ? "正在准备场景" : "进入预演台开始创作"}</span>
    </div>
);
```

导入新组件：
```typescript
import { PrevisMiniViewport } from "./previs-mini-viewport";
```

#### 2.3 验证命令

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
```

手动检查：打开画布，创建一个预演场景节点，确认卡片显示 3D 俯视缩略图。

**提交**：
```bash
git add web/src/components/canvas/previs/canvas-previs-node-panel.tsx web/src/components/canvas/previs/previs-mini-viewport.tsx
```

---

## Phase 3: 高频工作流功能完整化

### 目标
高频工作流模式包含所有高频操作：新建演员/盒子/球体/圆柱/平面、灯光、相机、姿态、颜色、景别、运镜。

### 实现文件
- `web/src/components/canvas/previs/canvas-previs-workbench.tsx`

### 具体改动

#### 3.1 高频工作流左侧面板重构

找到快速模式的 `<aside className="thin-scrollbar ...">` 部分，**完全替换**为：

```tsx
<aside className="thin-scrollbar min-h-0 overflow-y-auto border-r" style={{ background: "var(--pd-surface)", borderColor: "var(--pd-line)", padding: "16px 12px" }}>
    {/* 演员与道具 */}
    <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">演员与道具</div>
        <div className="grid grid-cols-2 gap-2">
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addActor()}>
                <User className="size-5" />
                <span className="text-xs">演员</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addPrimitive("box", "盒子")}>
                <Box className="size-5" />
                <span className="text-xs">盒子</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addPrimitive("sphere", "球体")}>
                <Circle className="size-5" />
                <span className="text-xs">球体</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addPrimitive("cylinder", "圆柱")}>
                <Cylinder className="size-5" />
                <span className="text-xs">圆柱</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addPrimitive("plane", "平面")}>
                <Square className="size-5" />
                <span className="text-xs">平面</span>
            </button>
        </div>
    </div>

    {/* 灯光与相机 */}
    <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">灯光与相机</div>
        <div className="grid grid-cols-2 gap-2">
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addLight("directional")}>
                <Lightbulb className="size-5" />
                <span className="text-xs">平行光</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => addLight("point")}>
                <Zap className="size-5" />
                <span className="text-xs">点光源</span>
            </button>
            <button type="button" className="flex flex-col items-center gap-1 rounded-lg border p-3 transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => commit((current) => ({ ...current, cameras: [...current.cameras, createPrevisCamera(`相机 ${current.cameras.length + 1}`, [0, 1.6, 5])] }))}>
                <Camera className="size-5" />
                <span className="text-xs">相机</span>
            </button>
        </div>
    </div>

    {/* 选中演员快捷操作 */}
    {quickSelectedActor ? (
        <>
            <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">姿态</div>
                <div className="grid grid-cols-3 gap-1">
                    {quickPoseOptions.map((pose) => (
                        <button key={pose.value} type="button" className="rounded border px-2 py-1.5 text-xs transition hover:bg-black/5" style={{ borderColor: "var(--pd-line)" }} onClick={() => applyQuickPose(pose.value)}>{pose.label}</button>
                    ))}
                </div>
            </div>
            <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">颜色</div>
                <div className="grid grid-cols-6 gap-1.5">
                    {PREVIS_ACTOR_COLORS.map((color) => (
                        <button key={color} type="button" className="size-8 rounded-md border-2 transition hover:scale-110" style={{ background: color, borderColor: quickSelectedActor.color === color ? "#2f8cff" : "transparent" }} onClick={() => updateObject(quickSelectedActor.id, { color })} />
                    ))}
                </div>
            </div>
            <div className="mb-4">
                <button type="button" className="w-full rounded-lg border bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700" onClick={placeQuickActor}>
                    <Move3d className="mr-1.5 inline size-4" />
                    落位到场景
                </button>
            </div>
        </>
    ) : (
        <div className="rounded-lg border p-3 text-center text-xs opacity-60" style={{ borderColor: "var(--pd-line)" }}>
            选择一个演员后显示姿态与颜色工具
        </div>
    )}
</aside>
```

导入缺失图标：
```typescript
import { User, Box, Circle, Cylinder, Square, Zap, Move3d } from "lucide-react";
```

添加缺失函数（如果不存在）：
```typescript
const addLight = (type: "directional" | "point" | "spot" | "ambient") => {
    commit((current) => ({
        ...current,
        lights: [...current.lights, createPrevisLight(type, `${type === "directional" ? "平行光" : type === "point" ? "点光源" : type === "spot" ? "聚光灯" : "环境光"} ${current.lights.length + 1}`, [3, 5, 3])],
    }));
};
```

#### 3.2 验证命令

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
node scripts/previs-p0-chrome-e2e.mjs
```

**通过标准**：E2E 62/62 通过，高频工作流面板能添加所有类型对象。

**提交**：
```bash
git add web/src/components/canvas/previs/canvas-previs-workbench.tsx
```

---

## Phase 4: 工作台整体视觉升级

### 目标
深色玻璃态、更大间距、更清晰的层次、专业配色。

### 实现文件
- `web/src/components/canvas/previs/canvas-previs-workbench.css`
- `web/src/components/canvas/previs/canvas-previs-workbench.tsx`

### 具体改动

#### 4.1 CSS 变量与全局样式升级

**完全替换** `canvas-previs-workbench.css` 的前 100 行为：

```css
/* 预演台专业深色主题 */
:root {
    --previs-bg-primary: #0a0a0a;
    --previs-bg-secondary: #141414;
    --previs-bg-surface: #1a1a1a;
    --previs-bg-elevated: #222222;
    --previs-border: rgba(255, 255, 255, 0.08);
    --previs-border-strong: rgba(255, 255, 255, 0.12);
    --previs-text-primary: #ffffff;
    --previs-text-secondary: rgba(255, 255, 255, 0.7);
    --previs-text-muted: rgba(255, 255, 255, 0.45);
    --previs-accent: #3b82f6;
    --previs-accent-hover: #2563eb;
    --previs-glass-bg: rgba(20, 20, 20, 0.85);
    --previs-glass-border: rgba(255, 255, 255, 0.1);
}

.previs-workbench {
    position: fixed;
    inset: 0;
    z-index: var(--z-editor);
    display: flex;
    flex-direction: column;
    background: var(--previs-bg-primary);
    color: var(--previs-text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

.previs-desk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--previs-border);
    background: var(--previs-bg-secondary);
    backdrop-filter: blur(20px);
}

.previs-desk-header-left {
    display: flex;
    align-items: center;
    gap: 16px;
}

.previs-desk-header-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
}

.previs-desk-header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}

.previs-desk-header-action {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--previs-border-strong);
    border-radius: 8px;
    background: var(--previs-bg-elevated);
    color: var(--previs-text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
}

.previs-desk-header-action:hover {
    background: var(--previs-bg-surface);
    border-color: var(--previs-border-strong);
    transform: translateY(-1px);
}

.previs-desk-header-action.is-primary {
    background: var(--previs-accent);
    border-color: var(--previs-accent);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.previs-desk-header-action.is-primary:hover {
    background: var(--previs-accent-hover);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}

.previs-desk-header-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
}

/* 视口容器 */
.previs-viewport-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--previs-bg-primary);
    border-radius: 12px;
    overflow: hidden;
}

/* 侧边栏 */
aside.thin-scrollbar {
    background: var(--previs-bg-secondary) !important;
    border-color: var(--previs-border) !important;
}

/* 按钮与控件 */
button[type="button"] {
    border-radius: 8px;
    transition: all 0.15s ease;
}

button[type="button"]:hover:not(:disabled) {
    transform: translateY(-1px);
}

/* 输入框 */
input, select, textarea {
    border-radius: 6px;
    border: 1px solid var(--previs-border);
    background: var(--previs-bg-elevated);
    color: var(--previs-text-primary);
    padding: 8px 12px;
    font-size: 13px;
    transition: all 0.15s ease;
}

input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--previs-accent);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

#### 4.2 工作台头部优化

在 `canvas-previs-workbench.tsx` 的 `<header className="previs-desk-header">` 部分，确保使用新的 class 和间距。

#### 4.3 验证命令

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
node scripts/previs-p0-chrome-e2e.mjs
```

手动检查：打开预演台，确认：
- 深色玻璃态背景
- 按钮有微妙的 hover 抬升效果
- 间距更宽松
- 整体更专业

**提交**：
```bash
git add web/src/components/canvas/previs/canvas-previs-workbench.css web/src/components/canvas/previs/canvas-previs-workbench.tsx
```

---

## Phase 5: E2E 测试适配与最终验收

### 目标
确保所有改动不破坏现有 E2E 测试契约。

### 检查点

1. **按钮选择器**：E2E 使用 `aria-label` 和 `data-testid`，确保新按钮都有对应属性
2. **统一工作区入口**：E2E 调用 `openUnifiedWorkbench`，确保单一入口仍然存在且可点击
3. **画布渲染**：E2E 等待 `.previs-viewport-shell canvas`，确保视口正常渲染

### 验证命令

```bash
cd web
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build
node scripts/previs-p0-chrome-e2e.mjs
```

**通过标准**：
- TypeScript 无错误
- Vite 构建成功
- E2E 62/62 通过

如果失败，根据错误信息调整 `aria-label` 或 `data-testid`。

**最终提交**：
```bash
git add -A
# 用 conventional-commits skill 生成总结 commit
```

---

## 交付检查清单

- [ ] Phase 1: 角色人偶材质有 rim light + gradient，不同演员默认不同颜色
- [ ] Phase 2: 画布卡片显示 3D 俯视缩略图，即使未回写构图
- [ ] Phase 3: 高频工作流包含演员/盒子/球体/圆柱/平面/灯光/相机的直接入口
- [ ] Phase 4: 工作台整体视觉为深色玻璃态，间距宽松，按钮有 hover 效果
- [ ] Phase 5: `./node_modules/.bin/tsc --noEmit` 通过
- [ ] Phase 5: `./node_modules/.bin/vite build` 通过
- [ ] Phase 5: `node scripts/previs-p0-chrome-e2e.mjs` 62/62 通过
- [ ] 手动截图确认：画布卡片、高频工作流面板、角色人偶、整体布局

---

## 执行给 GPT 的完整指令模板

```
你现在要执行 Previs 预演台 UI 重构。

1. 阅读 PREVIS_REDESIGN_EXECUTION_PLAN.md 的 Phase 1
2. 严格按照 Phase 1 的代码改动执行
3. 运行 Phase 1 的验证命令
4. 如果通过，提交 Phase 1，然后继续 Phase 2
5. 如果失败，修复错误直到通过，再继续

每个 Phase 完成后，回复：
- Phase X 完成
- 验证结果：[通过/失败 + 错误信息]
- commit hash: [实际 hash]

禁止跳过任何 Phase，禁止合并 Phase，禁止省略验证命令。
```

---

## 注意事项

1. **不要删除现有功能**：所有旧分裂工作台的能力必须保留
2. **E2E 是最高优先级**：任何改动导致 E2E 失败都必须回滚
3. **视觉一致性**：所有新增控件必须使用新的 CSS 变量
4. **渐进增强**：每个 Phase 独立可用，不依赖后续 Phase

---

## 参考设计

- **Blender** 深色主题：`#1a1a1a` 背景，`rgba(255,255,255,0.08)` 边框
- **Unreal Engine** 按钮：hover 时微妙抬升，accent 色为蓝色系
- **Unity** 侧边栏：宽松间距，清晰分组，大图标+小文字

---

## 最终交付物

- 所有改动的文件
- 通过的 E2E 报告截图
- 画布卡片、高频工作流、角色人偶、整体布局的截图各一张
- 一份简短的中文交付说明（100 字内）

---

**版本**: 1.0  
**更新日期**: 2026-10-04  
**责任人**: Kiro (规划) + GPT (执行)
