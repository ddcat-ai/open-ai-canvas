import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { DirectorMode } from "@/lib/canvas/director/director-modes";

/**
 * 导演台首次上手引导（P2）。
 *
 * 为什么存在：导演台把模板、四个一级模式、对象操作、保存/导出堆在同一个工作台里，
 * 第一次进来的人没有任何线索该先做什么。引导给出一条确定的最短路径。
 *
 * 硬约束：
 * - 纯状态机 + 持久化，绝不触碰 DirectorScene，也不写 undo/redo 历史：
 *   引导是「用户看到什么提示」，不是场景内容。
 * - 进度按用户隔离。所有导出 API 必须显式收到非空 scope，禁止内部兜底成 guest ——
 *   默认 scope 会让 A 账号的引导状态泄漏给 B 账号。
 * - 只用 localforage（走 localForageStorageForScope），不用 localStorage：
 *   与项目里其他用户态持久化保持同一条通道。
 * - 缺失、损坏、版本不符的持久数据一律回落到初始进度；只有存储层本身失败才向上抛。
 */

export type DirectorOnboardingStepId = "actor" | "move" | "pose" | "path" | "camera" | "apply";

/** active 才展示。dismissed（用户跳过）与 completed（走完）都不再展示，且不可被 next/back 唤醒。 */
export type DirectorOnboardingStatus = "active" | "dismissed" | "completed";

/**
 * 进度 schema 版本。
 * 步骤集合发生语义变化（增删步骤、改变顺序）时必须 +1：
 * 旧进度里的 stepId 在新步骤表里可能不存在，继续沿用会把用户卡在不存在的步骤上。
 */
export const DIRECTOR_ONBOARDING_VERSION = 2;

/** localforage 键名。真实键由 localForageStorageForScope 追加 `:user:<scope>`。 */
export const DIRECTOR_ONBOARDING_KEY = "director-onboarding-v2";

export type DirectorOnboardingStep = {
    id: DirectorOnboardingStepId;
    title: string;
    /** 一句话说清「在哪儿点什么」，不解释概念。 */
    detail: string;
    /**
     * 该步骤应该在哪个一级模式里完成。
     * 模式巡览步骤本身没有单一归属，故为 undefined —— 由 UI 决定是否代为切换模式。
     */
    mode?: DirectorMode;
};

/** 顺序与 Issue #305 的首次任务一致：添加演员 → 移动 → 调姿 → 轨迹 → CAM → 应用。 */
export const DIRECTOR_ONBOARDING_STEPS: DirectorOnboardingStep[] = [
    { id: "actor", title: "添加并选中演员", detail: "在左侧「快速添加」点演员；模板已有演员时，直接在场景树或视口选中它。", mode: "layout" },
    { id: "move", title: "把演员移动到表演位置", detail: "保持摆场模式，在底部 dock 选移动工具（W），拖动轴手柄；右栏可输入精确坐标。", mode: "layout" },
    { id: "pose", title: "调整演员姿态", detail: "切到姿态模式，在右侧选择姿势预设；模型有骨骼时还可选择手臂、腿和躯干微调。", mode: "pose" },
    { id: "path", title: "记录一段走位", detail: "切到动画模式，在起点和终点分别移动播放头、摆放演员并记录 Transform 关键帧，再播放预览。", mode: "animate" },
    { id: "camera", title: "用 CAM 检查构图", detail: "切到摄影机模式，再点视口工具栏 CAM；调整焦距、焦点和机位，确认安全框内的画面。", mode: "camera" },
    { id: "apply", title: "应用到镜头", detail: "确认场景、姿态、走位和 CAM 构图后，点顶栏「应用到镜头」生成静帧并回写画布。", mode: "camera" },
];

export type DirectorOnboardingProgress = {
    version: number;
    status: DirectorOnboardingStatus;
    stepId: DirectorOnboardingStepId;
};

export const directorOnboardingInitial: DirectorOnboardingProgress = {
    version: DIRECTOR_ONBOARDING_VERSION,
    status: "active",
    stepId: DIRECTOR_ONBOARDING_STEPS[0].id,
};

export type DirectorOnboardingAction = "next" | "back" | "dismiss" | "complete" | "reset";

/**
 * 引导状态机。
 *
 * 关键不变量：
 * - 只有 reset 能让已 dismissed/completed 的引导重新活过来。next/back/dismiss/complete
 *   在非 active 状态下是恒等变换，否则「跳过引导」会被后续任何一次误触重新拉起来。
 * - 在最后一步 next 等于完成：完成必须是终态，而不是停在最后一步继续可 next。
 * - 首步 back 保持不动，不越界，也不隐式关闭引导。
 * - 当前 stepId 不在步骤表里（旧数据、被外部改写）时回到初始进度，而不是把 -1 当下标继续算。
 */
export function reduceDirectorOnboarding(progress: DirectorOnboardingProgress, action: DirectorOnboardingAction): DirectorOnboardingProgress {
    if (action === "reset") return directorOnboardingInitial;
    if (progress.status !== "active") return progress;
    if (action === "dismiss") return { ...progress, status: "dismissed" };
    if (action === "complete") return { ...progress, status: "completed" };

    const index = DIRECTOR_ONBOARDING_STEPS.findIndex((step) => step.id === progress.stepId);
    if (index < 0) return directorOnboardingInitial;

    if (action === "back") {
        if (index === 0) return progress;
        return { ...progress, stepId: DIRECTOR_ONBOARDING_STEPS[index - 1].id };
    }

    const next = DIRECTOR_ONBOARDING_STEPS[index + 1];
    if (!next) return { ...progress, status: "completed" };
    return { ...progress, stepId: next.id };
}

export type DirectorOnboardingView = {
    step: DirectorOnboardingStep;
    /** 1 起数，直接用于「第 N 步 / 共 M 步」。 */
    position: number;
    total: number;
    isFirst: boolean;
    isLast: boolean;
};

/**
 * 展示态。返回 null 表示不该显示引导 —— 组件层只看这一个判据，
 * 不自己再拼 status 与步骤下标，避免出现第二套可见性规则。
 */
export function resolveDirectorOnboardingView(progress: DirectorOnboardingProgress): DirectorOnboardingView | null {
    if (progress.status !== "active") return null;
    const index = DIRECTOR_ONBOARDING_STEPS.findIndex((step) => step.id === progress.stepId);
    if (index < 0) return null;
    return {
        step: DIRECTOR_ONBOARDING_STEPS[index],
        position: index + 1,
        total: DIRECTOR_ONBOARDING_STEPS.length,
        isFirst: index === 0,
        isLast: index === DIRECTOR_ONBOARDING_STEPS.length - 1,
    };
}

function isStepId(value: unknown): value is DirectorOnboardingStepId {
    return typeof value === "string" && DIRECTOR_ONBOARDING_STEPS.some((step) => step.id === value);
}

function isStatus(value: unknown): value is DirectorOnboardingStatus {
    return value === "active" || value === "dismissed" || value === "completed";
}

/**
 * 解析持久进度。
 *
 * 引导是提示，不是内容：任何无法确信的持久值都当成「没有进度」，宁可再引导一次，
 * 也不要把用户卡在一个无法解释的状态里。覆盖：非 JSON、非对象、数组、版本不符、
 * status/stepId 不在枚举内。
 */
export function parseDirectorOnboardingProgress(raw: string | null | undefined): DirectorOnboardingProgress {
    if (!raw) return directorOnboardingInitial;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return directorOnboardingInitial;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return directorOnboardingInitial;
    const candidate = parsed as Partial<DirectorOnboardingProgress>;
    if (candidate.version !== DIRECTOR_ONBOARDING_VERSION) return directorOnboardingInitial;
    if (!isStatus(candidate.status) || !isStepId(candidate.stepId)) return directorOnboardingInitial;
    return { version: DIRECTOR_ONBOARDING_VERSION, status: candidate.status, stepId: candidate.stepId };
}

/** 只要求读写能力：既是测试注入内存实现的接缝，也避免依赖 zustand StateStorage 的全量接口。 */
export type DirectorOnboardingStorage = {
    getItem: (name: string) => string | null | Promise<string | null>;
    setItem: (name: string, value: string) => void | Promise<void>;
};

/**
 * scope 归一化 + 守卫。前后空白裁掉后再校验/使用，这样 " user-a " 与 "user-a"
 * 落到同一把生产键上，不会分裂成两份互不可见的进度。
 *
 * 必须在每个导出的持久化函数入口无条件调用 —— 包括调用方已经注入自定义 storage 的分支。
 * 之前的实现写成 `storage ?? localForageStorageForScope(requireScope(scope))`，
 * `??` 短路导致「传了 storage」时 requireScope 根本不会执行，空 scope 就此绕过校验。
 */
function requireScope(scope: string) {
    const normalized = scope.trim();
    if (!normalized) throw new Error("缺少导演台引导的用户 scope");
    return normalized;
}

/**
 * 读取进度。
 * 数据脏 -> 初始进度；存储层（IndexedDB）失败 -> 向上抛，由调用方决定是否隐藏引导，
 * 不在这里 catch 成默认值假装读到了。
 */
export async function loadDirectorOnboardingProgress(scope: string, storage?: DirectorOnboardingStorage): Promise<DirectorOnboardingProgress> {
    const normalizedScope = requireScope(scope);
    const target = storage ?? localForageStorageForScope(normalizedScope);
    return parseDirectorOnboardingProgress(await target.getItem(DIRECTOR_ONBOARDING_KEY));
}

export async function saveDirectorOnboardingProgress(scope: string, progress: DirectorOnboardingProgress, storage?: DirectorOnboardingStorage): Promise<void> {
    const normalizedScope = requireScope(scope);
    const target = storage ?? localForageStorageForScope(normalizedScope);
    await target.setItem(DIRECTOR_ONBOARDING_KEY, JSON.stringify({ version: DIRECTOR_ONBOARDING_VERSION, status: progress.status, stepId: progress.stepId }));
}

/**
 * 推进并持久化。返回新进度；写失败向上抛，调用方拿到的进度与已落盘的进度保持一致，
 * 不存在「界面前进了但磁盘没动」这种静默分叉。
 *
 * scope 校验必须在「无变化动作提前返回」之前完成：否则对已 dismissed/completed 账号
 * 调用 next 之类的恒等动作会在校验之前就 return progress，空 scope 也能悄悄跑过去。
 * 无变化的动作仍然不写盘。
 */
export async function advanceDirectorOnboarding(scope: string, progress: DirectorOnboardingProgress, action: DirectorOnboardingAction, storage?: DirectorOnboardingStorage): Promise<DirectorOnboardingProgress> {
    const normalizedScope = requireScope(scope);
    const next = reduceDirectorOnboarding(progress, action);
    if (next === progress) return progress;
    await saveDirectorOnboardingProgress(normalizedScope, next, storage);
    return next;
}

/**
 * 独立的重启 API。不依赖调用方持有当前内存进度 —— 未来工作台设置里的
 * 「重新开始引导」按钮不必先加载一次旧进度才能重置，直接落盘初始状态即可，
 * 对已 dismissed/completed 的账号同样生效。
 */
export async function resetDirectorOnboardingProgress(scope: string, storage?: DirectorOnboardingStorage): Promise<DirectorOnboardingProgress> {
    const normalizedScope = requireScope(scope);
    await saveDirectorOnboardingProgress(normalizedScope, directorOnboardingInitial, storage);
    return directorOnboardingInitial;
}

export type DirectorOnboardingGate = {
    /** 尝试进入互斥区；已有一次未完成的调用时返回 false，调用方必须放弃本次动作。 */
    tryEnter: () => boolean;
    /** 释放互斥区。scope/enabled 变化（换账号）时也要调用，否则旧账号的占用会永久卡死新账号。 */
    release: () => void;
};

/**
 * 创建一次性写锁：保证同一 tick 内的重复调用（双击、程序化连点）只有一个能真正发起写入。
 *
 * 用同步闭包变量而不是 React state 做门禁：state 更新要等到下一次渲染才对外可见，
 * 两次点击完全可能发生在同一次渲染之间，仅靠 busy state 挡不住这种同步重入。
 * release 是幂等的：未锁定时调用不抛错，方便在 effect 里无条件清理。
 */
export function createDirectorOnboardingGate(): DirectorOnboardingGate {
    let locked = false;
    return {
        tryEnter: () => {
            if (locked) return false;
            locked = true;
            return true;
        },
        release: () => {
            locked = false;
        },
    };
}
