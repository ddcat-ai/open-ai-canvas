import type { DirectorRenderMode } from "@/types/director";

/**
 * 导演台一级模式。
 *
 * mode 是工作台 UI 状态，绝不写入 DirectorScene —— 场景是内容，模式是当前怎么看内容。
 * 这里只做纯粹的「模式 -> 能力」映射与切换清理，组件层照着 capabilities 决定显示什么。
 */

export type DirectorMode = "layout" | "pose" | "animate" | "camera";

export type DirectorModeCapabilities = {
    /** 时间轴是否显示。只有动画模式显示。 */
    timeline: boolean;
    /** 是否允许记录/删除关键帧与 Auto Key。只有动画模式允许。 */
    keyframes: boolean;
    /** 是否展示骨骼与姿势入口。姿态与动画模式展示。 */
    bones: boolean;
    /** 是否突出 shot/camera 检查器与运镜入口。摄影机模式突出。 */
    cameraTools: boolean;
    /** 该模式允许的渲染视图。摆场不给深度/法线这类高级视图。 */
    renderModes: DirectorRenderMode[];
};

const CAPABILITIES: Record<DirectorMode, DirectorModeCapabilities> = {
    // 摆场：先把人和物放对位置，隐藏骨骼、关键帧、Auto Key、深度/法线。
    layout: { timeline: false, keyframes: false, bones: false, cameraTools: false, renderModes: ["beauty", "clay"] },
    // 姿态：调骨骼与姿势，但不默认制造关键帧。
    pose: { timeline: false, keyframes: false, bones: true, cameraTools: false, renderModes: ["beauty", "clay", "pose"] },
    // 动画：唯一显示时间轴、允许 Auto Key 与录制关键帧的模式。
    animate: { timeline: true, keyframes: true, bones: true, cameraTools: false, renderModes: ["beauty", "clay", "pose"] },
    // 摄影机：突出机位、对齐视图与运镜；深度/法线在这里才有意义。
    camera: { timeline: false, keyframes: false, bones: false, cameraTools: true, renderModes: ["beauty", "clay", "depth", "normal"] },
};

export const DIRECTOR_MODES: Array<{ mode: DirectorMode; label: string; hint: string }> = [
    { mode: "layout", label: "摆场", hint: "摆放演员、道具与灯光" },
    { mode: "pose", label: "姿态", hint: "调整选中演员的骨骼与姿势" },
    { mode: "animate", label: "动画", hint: "时间轴、关键帧与 Auto Key" },
    { mode: "camera", label: "摄影机", hint: "机位、对齐视图与运镜" },
];

export const DIRECTOR_DEFAULT_MODE: DirectorMode = "layout";

export function directorModeCapabilities(mode: DirectorMode): DirectorModeCapabilities {
    return CAPABILITIES[mode] ?? CAPABILITIES[DIRECTOR_DEFAULT_MODE];
}

export type DirectorModeTransition = {
    mode: DirectorMode;
    playing: boolean;
    autoKey: boolean;
    renderMode: DirectorRenderMode;
};

/**
 * 切换模式时必须一起收敛的运行时状态。
 *
 * 关键安全边界：离开动画模式一定停播 + 关 Auto Key。
 * 否则播放循环仍在推进 playhead，而 Auto Key 会在用户以为只是「换了个模式」时
 * 继续往场景里写关键帧 —— 那是后台偷偷改内容。
 *
 * renderMode 同时被夹回目标模式允许的集合：不能带着深度视图退回摆场。
 */
export function resolveDirectorModeTransition(input: { mode: DirectorMode; playing: boolean; autoKey: boolean; renderMode: DirectorRenderMode }): DirectorModeTransition {
    const capabilities = directorModeCapabilities(input.mode);
    return {
        mode: input.mode,
        playing: capabilities.timeline ? input.playing : false,
        autoKey: capabilities.keyframes ? input.autoKey : false,
        renderMode: capabilities.renderModes.includes(input.renderMode) ? input.renderMode : "beauty",
    };
}
