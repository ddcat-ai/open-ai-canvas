import type { PrevisRenderMode } from "@/types/previs";

/**
 * 世界引擎一级模式：只有「摆场」和「动画」两种。
 *
 * 旧版有摆场/姿态/动画/摄影机四个模式，但姿态和摄影机只是「选中了演员 / 选中了机位」时
 * 检查器该显示什么，并不是独立的工作阶段；拆成模式反而让人在模式之间来回找功能。
 * 现在：
 * - 摆场：静态布置。摆位、姿势、骨骼微调、机位与取景都在这里，由「选中了什么」决定检查器内容。
 * - 动画：在摆场的基础上打开时间轴，允许关键帧、Auto Key、动作片段与走位路径。
 *
 * mode 是工作台 UI 状态，绝不写入 PrevisScene —— 场景是内容，模式是当前怎么看内容。
 */

export type PrevisMode = "layout" | "animate";

export type PrevisModeCapabilities = {
    /** 时间轴是否显示。只有动画模式显示。 */
    timeline: boolean;
    /** 是否允许记录/删除关键帧与 Auto Key。只有动画模式允许。 */
    keyframes: boolean;
    /** 是否展示骨骼与姿势入口。两种模式都展示（选中演员时）。 */
    bones: boolean;
    /** 该模式允许的渲染视图。 */
    renderModes: PrevisRenderMode[];
};

const ALL_RENDER_MODES: PrevisRenderMode[] = ["beauty", "clay", "pose", "depth", "normal"];

const CAPABILITIES: Record<PrevisMode, PrevisModeCapabilities> = {
    layout: { timeline: false, keyframes: false, bones: true, renderModes: ALL_RENDER_MODES },
    animate: { timeline: true, keyframes: true, bones: true, renderModes: ALL_RENDER_MODES },
};

export const PREVIS_MODES: Array<{ mode: PrevisMode; label: string; hint: string }> = [
    { mode: "layout", label: "摆场", hint: "摆放演员、道具、灯光和机位，调整姿势与取景" },
    { mode: "animate", label: "动画", hint: "打开时间轴，让演员走位、做动作，让摄影机运镜" },
];

export const PREVIS_DEFAULT_MODE: PrevisMode = "layout";

/** 旧数据/旧引导里的 pose、camera 统一并入摆场。 */
export function normalizePrevisMode(mode: string | null | undefined): PrevisMode {
    return mode === "animate" ? "animate" : "layout";
}

export function previsModeCapabilities(mode: PrevisMode): PrevisModeCapabilities {
    return CAPABILITIES[normalizePrevisMode(mode)];
}

export type PrevisModeTransition = {
    mode: PrevisMode;
    playing: boolean;
    autoKey: boolean;
    renderMode: PrevisRenderMode;
};

/**
 * 切换模式时必须一起收敛的运行时状态。
 *
 * 关键安全边界：离开动画模式一定停播 + 关 Auto Key。
 * 否则播放循环仍在推进 playhead，而 Auto Key 会在用户以为只是「换了个模式」时
 * 继续往场景里写关键帧 —— 那是后台偷偷改内容。
 */
export function resolvePrevisModeTransition(input: { mode: PrevisMode; playing: boolean; autoKey: boolean; renderMode: PrevisRenderMode }): PrevisModeTransition {
    const mode = normalizePrevisMode(input.mode);
    const capabilities = CAPABILITIES[mode];
    return {
        mode,
        playing: capabilities.timeline ? input.playing : false,
        autoKey: capabilities.keyframes ? input.autoKey : false,
        renderMode: capabilities.renderModes.includes(input.renderMode) ? input.renderMode : "beauty",
    };
}
