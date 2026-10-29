import type { DramaCastKind, DramaStatus } from "@/services/api/drama";

// 短剧文案与数字格式：制作台和精修画布共用，避免两边各写一份。

export const DRAMA_CAST_KIND_LABEL: Record<DramaCastKind, string> = { character: "角色", prop: "道具", scene: "场景" };

export const DRAMA_STATUS_LABEL: Record<DramaStatus, string> = { draft: "未开始", running: "制作中", paused: "已暂停", completed: "已完成" };

export function formatDramaCredits(microcredits: number) {
    const credits = microcredits / 1_000_000;
    if (credits >= 10_000) return `${(credits / 10_000).toFixed(credits >= 100_000 ? 0 : 1)}万`;
    return credits.toLocaleString("zh-CN", { maximumFractionDigits: credits >= 100 ? 0 : 2 });
}
