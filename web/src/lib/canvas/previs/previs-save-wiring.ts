import type { PrevisScene } from "@/types/previs";
import type { PrevisCloseDecision, PrevisDraftEnvelope, PrevisSaveSnapshot, StorageLike } from "@/lib/canvas/previs/previs-save";

/**
 * UI 只需要保存进度，不需要场景本体。
 * 去掉 scene 后 React state 不必再为「还没有 coordinator」编造一个假场景。
 */
export type PrevisSaveProgress = Omit<PrevisSaveSnapshot, "scene">;

export const idlePrevisSaveProgress: PrevisSaveProgress = {
    revision: 0,
    confirmedRevision: 0,
    status: "saved",
    draftStored: false,
};

/** 从完整快照投影出进度：订阅回调必须走它，避免只更新 status 而漏掉确认信息。 */
export function previsSaveProgress(snapshot: PrevisSaveSnapshot): PrevisSaveProgress {
    return {
        revision: snapshot.revision,
        confirmedRevision: snapshot.confirmedRevision,
        status: snapshot.status,
        draftStored: snapshot.draftStored,
    };
}

/** 头部状态展示：文案与语气必须由状态唯一决定，组件不得自己拼措辞。 */
export type PrevisSaveIndicator = {
    label: string;
    tone: "idle" | "pending" | "danger";
    /** 未确认或错误时提供重试；已保存态没有可重试的东西。 */
    retryable: boolean;
    busy: boolean;
};

export function describePrevisSaveStatus(progress: PrevisSaveProgress): PrevisSaveIndicator {
    const unconfirmed = progress.confirmedRevision < progress.revision;

    if (progress.status === "error") {
        return {
            label: progress.draftStored ? "保存失败 · 本地草稿已保留" : "保存失败 · 本地草稿也未写入",
            tone: "danger",
            retryable: true,
            busy: false,
        };
    }
    if (progress.status === "saving") {
        return { label: "正在保存…", tone: "pending", retryable: false, busy: true };
    }
    if (progress.status === "dirty" || unconfirmed) {
        return { label: "有未保存修改", tone: "pending", retryable: true, busy: false };
    }
    return { label: "已保存", tone: "idle", retryable: false, busy: false };
}

/**
 * 是否提示恢复：候选必须比权威场景更新才值得打断用户。
 * scene.updatedAt 是 canonical 保存时间，candidate.baseUpdatedAt 是草稿写入时的基线；
 * 基线落后于权威说明远端已保存过更新的内容，这份草稿是陈旧残留。
 */
export function shouldOfferPrevisDraftRecovery(input: { candidate: PrevisDraftEnvelope | null; authoritativeScene: PrevisScene | null }): boolean {
    const { candidate, authoritativeScene } = input;
    if (!candidate || !authoritativeScene) return false;
    if (candidate.sceneId !== authoritativeScene.id) return false;
    if (candidate.baseUpdatedAt !== authoritativeScene.updatedAt) return false;
    return candidate.scene.updatedAt > authoritativeScene.updatedAt;
}

/** 关闭决策的用户可见后果，组件按此分支决定退出/二次确认/留下。 */
export type PrevisCloseOutcome = { kind: "close" } | { kind: "confirm-draft-exit"; message: string } | { kind: "blocked"; message: string };

export function resolvePrevisCloseOutcome(decision: PrevisCloseDecision): PrevisCloseOutcome {
    if (decision === "close") return { kind: "close" };
    if (decision === "offer-draft-exit") {
        return {
            kind: "confirm-draft-exit",
            message: "远端保存失败，但本地草稿已安全保存。下次打开这个镜头可以恢复，确认离开吗？",
        };
    }
    return { kind: "blocked", message: "保存失败且本地草稿未写入，已留在预演台，请重试保存。" };
}

/**
 * beforeunload 是否要触发浏览器保护：只有「改动未确认」或「错误态且没有安全草稿」才拦。
 * 注意这里只能同步表达意图，异步 flush 无法阻塞卸载。
 */
export function shouldBlockPrevisUnload(progress: PrevisSaveProgress): boolean {
    if (progress.confirmedRevision < progress.revision) return true;
    return progress.status === "error" && !progress.draftStored;
}

/**
 * localStorage 不可用（隐私模式、被禁用、SSR）时的显式实现：
 * 读返回 null，写和删都抛，让 coordinator 如实得到 draftStored=false。
 * 绝不能降级成进程内 Map —— 那会让弹窗谎称「下次可恢复」。
 */
export const unavailablePrevisDraftStorage: StorageLike = {
    getItem: () => null,
    setItem: () => {
        throw new Error("localStorage unavailable");
    },
    removeItem: () => {
        throw new Error("localStorage unavailable");
    },
};

/** 纯 factory：注入 getter 便于测试不可用分支，不引入额外依赖。 */
export function resolvePrevisDraftStorage(readStorage: () => Storage | null | undefined): StorageLike {
    let local: Storage | null | undefined;
    try {
        local = readStorage();
    } catch {
        return unavailablePrevisDraftStorage;
    }
    if (!local) return unavailablePrevisDraftStorage;

    return {
        getItem: (key) => local.getItem(key),
        setItem: (key, value) => local.setItem(key, value),
        removeItem: (key) => local.removeItem(key),
    };
}
