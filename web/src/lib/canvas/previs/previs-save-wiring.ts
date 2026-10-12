import type { PrevisCloseDecision, PrevisSaveSnapshot } from "@/lib/canvas/previs/previs-save";

export type PrevisSaveProgress = PrevisSaveSnapshot;

export const idlePrevisSaveProgress: PrevisSaveProgress = {
    revision: 0,
    confirmedRevision: 0,
    status: "saved",
};

export function previsSaveProgress(snapshot: PrevisSaveSnapshot): PrevisSaveProgress {
    return {
        revision: snapshot.revision,
        confirmedRevision: snapshot.confirmedRevision,
        status: snapshot.status,
    };
}

export type PrevisSaveIndicator = {
    label: string;
    tone: "idle" | "pending" | "danger";
    busy: boolean;
};

export function describePrevisSaveStatus(progress: PrevisSaveProgress): PrevisSaveIndicator {
    const unconfirmed = progress.confirmedRevision < progress.revision;
    if (progress.status === "error") return { label: "保存暂时未完成 · 未确认操作将在后台继续处理", tone: "danger", busy: false };
    if (progress.status === "saving") return { label: "正在保存…", tone: "pending", busy: true };
    if (progress.status === "dirty" || unconfirmed) return { label: "有未确认操作，后台处理中", tone: "pending", busy: false };
    return { label: "已保存", tone: "idle", busy: false };
}

export type PrevisCloseOutcome = { kind: "close" } | { kind: "blocked"; message: string };

export function resolvePrevisCloseOutcome(decision: PrevisCloseDecision): PrevisCloseOutcome {
    if (decision === "close") return { kind: "close" };
    return { kind: "blocked", message: "保存暂时未完成，编辑内容已保留，未确认操作会在后台自动处理。" };
}

export function shouldBlockPrevisUnload(progress: PrevisSaveProgress): boolean {
    return progress.confirmedRevision < progress.revision || progress.status === "error";
}
