import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 生产接线回归：模板与模式的领域函数正确，不代表真实入口用上了。
 * 这里锁住「新建必须选模板」「已有场景不弹模板」「时间轴只在动画模式」三条链路。
 */
const workbench = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-workbench.tsx"), "utf8");
const dock = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport-dock.tsx"), "utf8");
const viewport = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-viewport.tsx"), "utf8");
const hook = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/use-canvas-director.ts"), "utf8");
const project = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/project.tsx"), "utf8");
const modal = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/canvas-director-template-modal.tsx"), "utf8");
const store = readFileSync(resolve(import.meta.dir, "../src/stores/canvas/use-director-workbench-store.ts"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

function slice(source: string, from: string, to: string) {
    const start = source.indexOf(from);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(to, start + from.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("新建场景必须显式选模板", () => {
    test("createDirectorShot 第一个参数是 templateId，没有默认值", () => {
        expect(hook).toContain("const createDirectorShot = useCallback((templateId: DirectorTemplateId, position?: Position) => {");
        // 有默认模板等于又回到「无条件塞演员」。
        expect(hook).not.toContain("templateId: DirectorTemplateId = ");
    });

    test("新建走模板工厂，不再走带默认演员的 createDirectorScene", () => {
        expect(hook).toContain("createDirectorSceneFromTemplate(templateId, `镜头 ${shotIndex}`)");
        expect(hook).not.toContain("createDirectorScene(");
    });

    test("两个新建入口都先开模板选择，而不是直接建场景", () => {
        expect(project).toContain("onOpenDirector={() => setDirectorTemplateRequest({})}");
        expect(project).toContain("onOpenDirector={(position) => setDirectorTemplateRequest({ position })}");
        expect(project).not.toContain("onOpenDirector={() => createDirectorShot()}");
        expect(project).not.toContain("onOpenDirector={createDirectorShot}");
    });

    test("选中模板后带着 position 建场景", () => {
        const element = slice(project, "<CanvasDirectorTemplateModal", "/>");
        expect(element).toContain("open={Boolean(directorTemplateRequest)}");
        expect(element).toContain("onSelect={(templateId) => createDirectorShot(templateId, directorTemplateRequest?.position)}");
    });

    test("模板弹窗把 5 个模板全列出来，没有「默认」快捷项", () => {
        expect(modal).toContain("DIRECTOR_TEMPLATES.map");
        expect(modal).toContain("onSelect(template.id)");
        expect(modal).not.toContain("默认模板");
    });
});

describe("已有场景不触发模板选择", () => {
    test("openDirectorWorkbench 命中已存在场景时不建新场景、不弹模板", () => {
        const opener = slice(hook, "const openDirectorWorkbench = useCallback", "/** 每次保存都基于 store");
        // 只有找不到场景（孤儿节点修复）才补建。
        expect(opener).toContain("if (!scene) {");
        expect(opener).toContain('createDirectorSceneFromTemplate("empty"');
        expect(opener).not.toContain("setDirectorTemplateRequest");
    });

    test("孤儿修复用空场景兜底：用户没选过就不许塞演员", () => {
        const opener = slice(hook, "const openDirectorWorkbench = useCallback", "/** 每次保存都基于 store");
        expect(opener).not.toContain('createDirectorSceneFromTemplate("monologue"');
        expect(opener).not.toContain("createDirectorActor");
    });

    test("workbench 自身不含模板选择逻辑：打开已保存场景不改写内容", () => {
        expect(workbench).not.toContain("DIRECTOR_TEMPLATES");
        expect(workbench).not.toContain("createDirectorSceneFromTemplate");
    });
});

describe("模式接线", () => {
    test("workbench 从 store 读 mode，并按 capabilities 派生显示", () => {
        expect(workbench).toContain("const mode = useDirectorWorkbenchStore((state) => state.mode);");
        expect(workbench).toContain("const capabilities = directorModeCapabilities(mode);");
    });

    test("时间轴只在 capabilities.timeline 为真时渲染", () => {
        expect(workbench).toContain("{capabilities.timeline ? <DirectorSequencer");
    });

    test("动画模式把 Transform 轨迹接入视口，隐藏演员和零长度轨迹不显示", () => {
        expect(workbench).toContain("showMotionPaths={capabilities.timeline}");
        expect(viewport).toContain('object.visible && (object.kind === "actor" || object.primitive === "character")');
        expect(viewport).toContain("directorTransformPathLength(object.keyframes) > 0.001");
        expect(viewport).toContain("<Line points={points}");
        expect(viewport).toContain("interpolateDirectorTransform(sorted[0].transform, sorted, playhead).position");
    });

    test("骨骼/姿势入口只对演员开放，且由 bones 把关", () => {
        expect(workbench).toContain('{capabilities.bones && (object.kind === "actor" || object.primitive === "character") ? <>');
        // motionClips 不得再作为放行条件：带动画的普通模型不是演员。
        expect(workbench).not.toContain('object.primitive === "character" || motionClips.length) ? <>');
    });

    test("姿态模式提供全身与当前骨骼重置，不删除动画轨道", () => {
        const inspector = slice(workbench, "function ObjectInspector(", "function LightInspector(");
        expect(inspector).toContain('onClick={() => applyPose("stand")}>重置姿态</Button>');
        expect(inspector).toContain("delete boneOverrides[selectedBoneId]");
        expect(inspector).toContain(">重置当前骨骼</Button>");
        expect(inspector).not.toContain("boneTracks: []");
    });

    test("动作片段与骨骼入口解耦：任何带 Clip 的对象都能调播放速度/循环", () => {
        expect(workbench).toContain('{motionClips.length ? <><Field label="动作片段">');
    });

    test("关键帧入口由 keyframes 把关", () => {
        expect(workbench).toContain("{capabilities.keyframes ? <>");
    });

    test("渲染视图下拉按当前模式过滤，而不是写死五项", () => {
        expect(workbench).toContain("DIRECTOR_RENDER_MODE_LABELS.filter((option) => capabilities.renderModes.includes(option.value))");
        expect(workbench).toContain("options={renderModeOptions}");
    });

    test("dock 不是绕过模式门控的第二条路径：渲染视图按钮同样按 renderModes 过滤", () => {
        expect(dock).toContain("renderModes: DirectorRenderMode[];");
        expect(dock).toContain("RENDER_VIEW_BUTTONS.filter((item) => renderModes.includes(item.mode))");
        // 写死的按钮会绕过门控。
        expect(dock).not.toContain('onClick={() => onRenderModeChange("pose")}');
        expect(workbench).toContain("renderModes={capabilities.renderModes}");
    });

    test("store 层夹住 renderMode：任何路径都无法设置当前模式不允许的视图", () => {
        expect(store).toContain("setRenderMode: (renderMode) => set((state) => (directorModeCapabilities(state.mode).renderModes.includes(renderMode) ? { renderMode } : {})),");
    });

    test("摄影机模式固定显示 shot/camera 检查器", () => {
        expect(workbench).toContain("selectedObject && !capabilities.cameraTools ?");
        expect(workbench).toContain("selectedLight && !capabilities.cameraTools ?");
    });

    test("运镜生成只更新首尾帧并提示到动画模式继续编辑，不清空手工关键帧", () => {
        expect(workbench).toContain("resolveDirectorCameraMoveKeyframes(item.keyframes");
        expect(workbench).toContain("已更新运镜首尾关键帧，可在动画模式继续编辑");
        expect(workbench).not.toContain("keyframes: [{ id: nanoid(), time: 0, transform: start }");
    });

    test("小屏把属性检查器放到下方而不是隐藏，姿态与骨骼入口仍可达", () => {
        expect(workbench).toContain("max-lg:col-span-2 max-lg:max-h-[40vh] max-lg:border-l-0 max-lg:border-t");
        expect(workbench).not.toContain("border-l max-lg:hidden");
    });

    test("store 的 setMode 走 resolveDirectorModeTransition，清理不靠组件自觉", () => {
        expect(store).toContain("setMode: (mode) => set((state) => resolveDirectorModeTransition({ mode, playing: state.playing, autoKey: state.autoKey, renderMode: state.renderMode })),");
    });

    test("mode 不写进 DirectorScene：类型文件里没有 mode 字段", () => {
        const types = readFileSync(resolve(import.meta.dir, "../src/types/director.ts"), "utf8");
        const sceneType = slice(types, "export type DirectorScene = {", "};");
        expect(sceneType).not.toContain("mode");
    });

    test("切模式不重建会话：初始化 effect 的依赖里没有 mode", () => {
        const initEffect = slice(workbench, "// 会话初始化只认 scene id", "// 打开会话时检查合法本地恢复候选");
        // 依赖里出现 mode 就意味着换视图会 resetWorkbench + 清空 history。
        expect(initEffect).toContain("}, [open, resetWorkbench, scene, writeDraft]);");
        expect(initEffect).not.toContain("mode");
    });

    test("draft/history/save 的生命周期 effect 一律不依赖 mode", () => {
        // 逐个锁住依赖数组：任一处混入 mode，切模式就会掉草稿或掉历史。
        expect(workbench).toContain("}, [message, modal, open, scene, writeDraft]);");
        expect(workbench).toContain("}, [mirrorDraft, stagedTransaction]);");
        expect(workbench).toContain("}, [mirrorDraft]);");
        // 快捷键监听只随 open 装卸，不随 mode 反复重挂。
        expect(workbench).toContain("}, [open]);");
    });
});

describe("异步导演台输出使用最新权威状态", () => {
    test("上传后重新核验节点与场景，并把预览引用合入最新 scene", () => {
        expect(hook).toContain("const sourceNodeAtStart = nodesRef.current.find");
        expect(hook).toContain("const outputProjectId = projectId;");
        expect(hook).toContain("projectIdRef.current !== outputProjectId");
        expect(hook).toContain("const outputProject = useCanvasStore.getState().projects.find((item) => item.id === outputProjectId);");
        expect(hook).toContain("const sourceNode = nodesRef.current.find((item) => item.id === sourceNodeId);");
        expect(hook).toContain("const latestScene = outputProject?.directorScenes.find");
        expect(hook).toContain("mergeDirectorOutputPreview(latestScene");
        expect(hook).toContain("saveDirectorScene(mergedScene);");
        expect(hook).not.toContain("saveDirectorScene({ ...output.scene");
    });
});

describe("模式控件可发现、可键盘、小屏可达", () => {
    const nav = slice(workbench, '<nav className="director-mode-switch"', "</nav>");

    test("是真实 button 且用 aria-pressed 表达当前模式", () => {
        expect(nav).toContain('type="button"');
        expect(nav).toContain("aria-pressed={mode === item.mode}");
    });

    test("不用 primary 表示普通选中，只加 is-active class", () => {
        expect(nav).toContain('className={`director-mode-switch-button ${mode === item.mode ? "is-active" : ""}`}');
        expect(nav).not.toContain('type="primary"');
    });

    test("小屏不隐藏：整个开关没有 max-lg:hidden", () => {
        expect(nav).not.toContain("max-lg:hidden");
    });

    test("鼠标点选后释放焦点：否则交互控件守卫会吃掉 W/E/R/Delete", () => {
        expect(nav).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("焦点释放规则集中在共享 helper，不在按钮里各写一遍 blur", () => {
        // 无条件 blur 会破坏键盘 Tab 序列，判据必须留在 helper 内部。
        expect(nav).not.toContain("event.currentTarget.blur()");
    });

    test("有可见文字标签与 hint title，不是纯图标", () => {
        expect(nav).toContain("{item.label}");
        expect(nav).toContain("title={item.hint}");
        expect(nav).toContain('aria-label="导演台模式"');
    });

    test("带 data-mode 测试锚点：E2E 不靠中文文案定位模式按钮", () => {
        expect(nav).toContain("data-mode={item.mode}");
    });

    test("模式与模板样式只用主题感知语义 token，不新增硬编码颜色", () => {
        const block = slice(styles, "/* 一级模式切换。", ".director-actor-colors {");
        expect(block).toContain("var(--control-selected-bg)");
        expect(block).toContain("var(--control-focus-ring)");
        expect(block).not.toMatch(/rgba?\(/);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
});
