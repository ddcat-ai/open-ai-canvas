import { Tag } from "antd";
import type { ReactNode } from "react";

import type { ProjectDetail, ProjectUnit } from "@/services/api/projects";

export type ProjectDetailViewProps = {
    detail: ProjectDetail;
    refreshProject: () => void;
    onCreateCanvas: () => void;
};

export const categoryLabels: Record<string, string> = {
    character: "角色",
    environment: "场景",
    wardrobe: "服饰",
    prop: "道具",
    weapon: "武器",
    style: "画风",
    other: "其他",
};

export const mediaLabels: Record<string, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
    model: "3D 模型",
    entity: "角色卡",
};

const statusLabels: Record<string, string> = {
    active: "进行中",
    archived: "已归档",
    draft: "草稿",
    ready: "待制作",
    completed: "已完成",
    review: "待审核",
    confirmed: "已确认",
    pending: "待处理",
    pending_confirmation: "待确认",
    running: "进行中",
    failed: "失败",
    ignored: "已忽略",
    skipped: "已跳过",
    cancelled: "已取消",
    succeeded: "已完成",
    disabled: "已停用",
    idle: "待开始",
    loading: "处理中",
    queued: "排队中",
    success: "已完成",
    error: "异常",
    deleted: "已删除",
    reserved: "已冻结",
    settled: "已结算",
    refunded: "已退款",
    uncertain: "待核对",
};

const sourceTypeLabels: Record<string, string> = {
    blank: "空白开始",
    novel: "导入小说",
    text: "粘贴文本",
};

export function categoryLabel(value: string) {
    return categoryLabels[value] || "其他";
}

export function statusLabel(value: string) {
    return statusLabels[value] || "未知状态";
}

export function mediaLabel(value: string) {
    return mediaLabels[value] || "其他类型";
}

export function sourceTypeLabel(value: string) {
    return sourceTypeLabels[value] || "其他来源";
}

export function StatusPill({ status }: { status: string }) {
    const color = status === "completed" || status === "confirmed" || status === "succeeded" ? "success" : status === "failed" ? "error" : status === "running" || status === "active" ? "processing" : status === "review" || status === "pending_confirmation" ? "warning" : "default";
    return <Tag color={color} className="m-0 !rounded-full !px-2 !text-[var(--fs-label)]">{statusLabel(status)}</Tag>;
}

export function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col gap-2 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                {eyebrow ? <div className="mb-1 text-[var(--fs-tiny)] font-semibold text-foreground/40">{eyebrow}</div> : null}
                <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
                {description ? <p className="mt-1 text-sm leading-5 text-foreground/55">{description}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

export function MetricTile({ label, value, detail, accent = false }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
    return (
        <div className={`overflow-hidden rounded-lg border px-3 py-3 ${accent ? "border-[color-mix(in_srgb,var(--workspace-accent)_30%,transparent)] bg-[var(--workspace-accent-soft)]" : "border-border/80 bg-background/70"}`}>
            <div className="text-xs text-foreground/50">{label}</div>
            <div className="mt-2 flex items-end gap-2"><strong className="text-2xl font-semibold tracking-normal">{value}</strong>{detail ? <span className="pb-0.5 text-xs text-foreground/45">{detail}</span> : null}</div>
        </div>
    );
}

export function UnitProgress({ unit }: { unit: ProjectUnit }) {
    const progress = unit.status === "completed" ? 100 : unit.status === "ready" ? 66 : 24;
    return <div className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div>;
}

export function formatTime(value?: string) {
    if (!value) return "-";
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatCount(value: number) {
    return new Intl.NumberFormat("zh-CN").format(value);
}
